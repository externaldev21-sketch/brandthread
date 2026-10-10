/**
 * Finance / Payouts dashboard — Stripe Connect data
 * Mounted at /api/finance
 *
 * GET  /balance                 available + pending balance, next payout date
 * GET  /payouts                 payout history list
 * GET  /transactions            balance transaction list (for finance P&L view)
 * GET  /statement.csv           download CSV of transactions
 * POST /payout                  manually trigger a payout (if manual schedule);
 *                               body.method 'standard' (default) | 'instant'
 * GET  /payout-schedule         current schedule, instant eligibility + fee quote, next payout
 * PATCH /payout-schedule        set daily | weekly(+anchor) | manual
 * GET  /payouts/:id             per-payout breakdown (sales, fees, refunds, holds)
 * GET  /summary                 held vs releasing vs available vs paid out
 */
import { denyIfAgeRestricted } from "../lib/ageGate";
import { Router } from "express";
import { db } from "@workspace/db";
import {
  users, orderFundReservations, sellerCashoutAttempts, drops, orders, orderReleases,
  ledgerPostings, ledgerTransactions,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requirePermission, requirePayoutsRead, teamContext } from "../middlewares/requireRole";
import { stripe } from "../lib/stripe";
import { cashOutableAmount, isValidPayoutIdempotencyKey } from "../lib/payoutSafety";
import { publishNotification } from "./notifications-feed";
import {
  computeHeldFunds, estimateNextPayout, instantPayoutFeeCents, maxInstantPayoutCents,
  payoutPolicySnapshot, type HoldableOrder, type NextPayoutEstimate, type PayoutScheduleInterval,
  type WeeklyAnchor,
} from "../lib/money/payoutPolicy";
import {
  currentScheduleOf, findInstantDestination, scheduleMatches, stripeScheduleParams,
  validateScheduleInput,
} from "../lib/money/payoutSchedule";
import { assertBreakdownReconciles, buildPayoutBreakdown } from "../lib/money/payoutBreakdown";
import { isPayoutHeld } from "../lib/admin/payoutControls";

const PAYOUTS_ON_HOLD = {
  error: "Payouts on this account are paused while our team reviews it. Contact support for details.",
  code: "PAYOUTS_ON_HOLD",
} as const;

const router = Router();
router.use(requireAuth);
router.use(teamContext());
const PAYOUT_CURRENCY = "usd";
const SAFE_PROVIDER_RETRY_WINDOW_MS = 20 * 60 * 60 * 1000;

function getSellerId(req: any): string {
  return (req as any).clerkUserId as string;
}

async function getStripeAccount(sellerId: string): Promise<string | null> {
  const [user] = await db
    .select({ stripeAccountId: users.stripeAccountId })
    .from(users)
    .where(eq(users.clerkId, sellerId))
    .limit(1);
  return user?.stripeAccountId ?? null;
}

function formatCents(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function findEligibleBankAccount(accounts: any[]): any | undefined {
  return accounts.find((externalAccount) =>
    externalAccount?.object === "bank_account"
    && externalAccount.currency?.toLowerCase() === PAYOUT_CURRENCY
    && externalAccount.default_for_currency === true
    && externalAccount.status !== "errored"
    && externalAccount.status !== "verification_failed",
  );
}

function formatNextPayout(estimate: NextPayoutEstimate) {
  return {
    kind: estimate.kind,
    date: estimate.date ? estimate.date.toISOString() : null,
    amount: estimate.amountCents,
    formatted: formatCents(estimate.amountCents),
    payoutId: estimate.kind === "existing" ? estimate.payoutId : null,
  };
}

/**
 * Orders still inside their payout-policy hold window, from the orders table.
 * Preorder escrow is excluded: Brandthread already holds that money itself
 * (see /summary "held"), it is not in the seller's Stripe balance.
 */
async function loadHoldableOrders(sellerId: string, now: Date): Promise<HoldableOrder[]> {
  const since = new Date(now.valueOf() - 31 * 86_400_000);
  const rows = await db.select({
    gross: orders.grossChargedCents,
    platformFee: orders.platformFeeCents,
    processingFee: orders.processingFeeChargedCents,
    refunded: orders.refundedCents,
    paidAt: orders.paidAt,
    shippingAddress: orders.shippingAddress,
  }).from(orders)
    .where(and(
      eq(orders.ownerId, sellerId),
      sql`${orders.chargeModel} IS NOT NULL`,
      sql`${orders.paidAt} >= ${since}`,
      sql`(${orders.fundsState} IS NULL OR ${orders.fundsState} = 'released')`,
    ));
  return rows.flatMap((row) => {
    if (!row.paidAt) return [];
    const net = Math.max(0, row.gross - (row.platformFee ?? 0) - (row.processingFee ?? 0) - (row.refunded ?? 0));
    return [{ netCents: net, paidAt: row.paidAt, country: row.shippingAddress?.country ?? null }];
  });
}

type CashoutResult =
  | { kind: "continue" }
  | {
      kind: "error";
      httpStatus: number;
      code: string;
      message: string;
      availableAfterReservations?: number;
    }
  | {
      kind: "success";
      duplicate: boolean;
      payout: {
        id: string;
        amount: number;
        currency: string;
        status: string;
        arrivalDate: Date;
      };
    };

// Additive /balance fields: policy holds and the next payout estimate. Never
// throws; a failure only omits the new fields.
async function balanceExtras(input: {
  sellerId: string;
  account: any;
  available: number;
  existing: any | null;
  log: { warn: (...args: any[]) => void };
}) {
  try {
    const now = new Date();
    const holdable = await loadHoldableOrders(input.sellerId, now);
    const held = computeHeldFunds(holdable, now);
    const policy = payoutPolicySnapshot();
    const schedule = currentScheduleOf(input.account);
    const heldCents = Math.min(held.heldCents, input.available);
    const estimate = estimateNextPayout({
      now,
      interval: (schedule?.interval ?? null) as PayoutScheduleInterval | null,
      weeklyAnchor: (schedule?.weeklyAnchor ?? null) as WeeklyAnchor | null,
      monthlyAnchor: schedule?.monthlyAnchor ?? null,
      availableCents: input.available,
      heldCents: policy.enforced ? heldCents : 0,
      existing: input.existing
        ? { id: input.existing.id, amountCents: input.existing.amount, arrivalDate: new Date(input.existing.arrival_date * 1000) }
        : null,
    });
    return {
      held: {
        amount: heldCents,
        formatted: formatCents(heldCents),
        count: held.count,
        nextReleaseAt: held.nextReleaseAt ? held.nextReleaseAt.toISOString() : null,
        mode: held.mode,
        enforced: policy.enforced,
      },
      nextPayoutEstimate: formatNextPayout(estimate),
      payoutSchedule: schedule,
    };
  } catch (err) {
    input.log.warn({ err }, "Payout policy extras unavailable for balance");
    return {};
  }
}

// ─── GET /api/finance/balance ─────────────────────────────────────────────────

// Reads are owner + manager + finance/admin (requirePayoutsRead — manager
// already has the "analytics" permission on their team role, and the mobile
// app renders a read-only Payouts/Finance view for managers) — writes that
// move money (POST /payout below) or reveal/alter bank destinations stay on
// requirePermission("payouts") alone. A joined-store staff/orders/marketing/
// viewer member still can't see any of this after teamContext rewrites the
// store owner.
router.get("/balance", requirePayoutsRead(), async (req, res) => {
  const sellerId = getSellerId(req);
  try {
    const accountId = await getStripeAccount(sellerId);

    if (!stripe || !accountId) {
      res.json({
        available: { amount: 0, currency: "usd", formatted: "$0.00" },
        pending:   { amount: 0, currency: "usd", formatted: "$0.00" },
        nextPayout: null,
        connected:  false,
      });
      return;
    }

    const [balance, payouts, reservationRows, processingRows, account, externalAccounts] = await Promise.all([
      stripe.balance.retrieve({}, { stripeAccount: accountId }),
      stripe.payouts.list({ limit: 1, status: "pending" }, { stripeAccount: accountId }),
      db.select({ reserved: sql<number>`COALESCE(SUM(${orderFundReservations.amountCents}), 0)::int` })
        .from(orderFundReservations)
        .where(and(
          eq(orderFundReservations.ownerId, sellerId),
          // Only labels still being bought are in flight. A bought label's
          // cost is recovered from the Stripe balance itself (transfer
          // reversal), so counting "spent" here would charge it twice and
          // shrink the balance forever.
          eq(orderFundReservations.status, "reserved"),
        )),
      db.select({
        idempotencyKey: sellerCashoutAttempts.idempotencyKey,
        amountCents: sellerCashoutAttempts.amountCents,
        currency: sellerCashoutAttempts.currency,
        createdAt: sellerCashoutAttempts.createdAt,
      })
        .from(sellerCashoutAttempts)
        .where(and(
          eq(sellerCashoutAttempts.ownerId, sellerId),
          eq(sellerCashoutAttempts.status, "processing"),
        )),
      stripe.accounts.retrieve(accountId),
      stripe.accounts.listExternalAccounts(accountId, {
        object: "bank_account",
        limit: 100,
      }),
    ]);

    const avail = balance.available.find((entry) => entry.currency === PAYOUT_CURRENCY)
      ?? { amount: 0, currency: PAYOUT_CURRENCY };
    const pending = balance.pending.find((entry) => entry.currency === PAYOUT_CURRENCY)
      ?? { amount: 0, currency: PAYOUT_CURRENCY };
    const nextP   = payouts.data[0] ?? null;
    const reserved = Number(reservationRows[0]?.reserved ?? 0);
    const processingReserved = processingRows
      .filter((row) => row.currency === PAYOUT_CURRENCY)
      .reduce((sum, row) => sum + row.amountCents, 0);
    const availableAfterReservations = cashOutableAmount(avail.amount, reserved + processingReserved);
    const processingCashout = processingRows
      .filter((row) => row.currency === PAYOUT_CURRENCY)
      .sort((a, b) => b.createdAt.valueOf() - a.createdAt.valueOf())[0];

    res.json({
      available: {
        amount:    availableAfterReservations,
        currency:  avail.currency,
        formatted: formatCents(availableAfterReservations, avail.currency),
      },
      pending: {
        amount:    pending.amount,
        currency:  pending.currency,
        formatted: formatCents(pending.amount, pending.currency),
      },
      nextPayout: nextP ? {
        id:          nextP.id,
        amount:      nextP.amount,
        currency:    nextP.currency,
        formatted:   formatCents(nextP.amount, nextP.currency),
        arrivalDate: new Date(nextP.arrival_date * 1000).toISOString(),
        status:      nextP.status,
      } : null,
      connected: true,
      payoutsEnabled: account.payouts_enabled === true,
      bankConnected: Boolean(findEligibleBankAccount(externalAccounts.data)),
      ...(await balanceExtras({
        sellerId, account, available: availableAfterReservations, existing: nextP,
        log: req.log,
      })),
      processingCashout: processingCashout ? {
        idempotencyKey: processingCashout.idempotencyKey,
        amount: processingCashout.amountCents,
        currency: processingCashout.currency,
        formatted: formatCents(processingCashout.amountCents, processingCashout.currency),
      } : null,
    });
  } catch (err: any) {
    req.log.error({ err }, "Failed to load balance");
    res.status(err.status ?? 500).json({ error: err.message ?? "Failed to load balance" });
  }
});

// ─── GET /api/finance/summary ─────────────────────────────────────────────────
// Where every dollar of the seller's sales is right now, from the money
// ledger (lib/money/ledger.ts) plus Stripe's live balance:
//   held       preorder money Brandthread is holding until each order ships
//   releasing  shipped preorders whose transfer to the seller is in flight
//   available  in the seller's Stripe balance, ready to cash out
//   pending    in the seller's Stripe balance, still settling
//   paidOut    everything Brandthread has sent to the seller's Stripe account
//   owed       what the seller owes Brandthread (e.g. a failed drop's
//              refunds after the bulk order was paid, unrecovered labels)
router.get("/summary", requirePayoutsRead(), async (req, res) => {
  const sellerId = getSellerId(req);
  try {
    const sellerSums = await db.select({
      account: ledgerPostings.account,
      total: sql<string>`COALESCE(SUM(${ledgerPostings.amountCents}), 0)`,
    }).from(ledgerPostings)
      .where(and(
        eq(ledgerPostings.partyId, sellerId),
        inArray(ledgerPostings.account, ["seller_held", "seller_paid_out", "platform_funds_advanced"]),
      ))
      .groupBy(ledgerPostings.account);
    const sum = (account: string) => Number(sellerSums.find((row) => row.account === account)?.total ?? 0);
    const advanced = sum("platform_funds_advanced");
    // Per drop: a positive balance is held for the seller; a negative
    // balance on a finished drop is a shortfall the seller owes.
    const heldByDrop = await db.execute(sql`
      SELECT
        COALESCE(SUM(GREATEST(x.total, 0)), 0) AS held,
        COALESCE(SUM(CASE WHEN x.total < 0 AND d.escrow_state IN ('failed', 'completed') THEN -x.total ELSE 0 END), 0) AS owed
      FROM (
        SELECT drop_id, SUM(amount_cents) AS total FROM ledger_postings
        WHERE account = 'seller_held' AND party_id = ${sellerId}
        GROUP BY drop_id
      ) x
      LEFT JOIN drops d ON d.id = x.drop_id
    `);
    const heldRow = heldByDrop.rows[0] as { held: string; owed: string } | undefined;
    const heldTotal = Number(heldRow?.held ?? 0);
    const dropShortfallOwed = Number(heldRow?.owed ?? 0);

    const [dropRows, releasing, fees, activity] = await Promise.all([
      db.select({
        dropId: drops.id,
        name: drops.name,
        escrowState: drops.escrowState,
        fulfillmentDeadlineAt: drops.fulfillmentDeadlineAt,
        heldCents: sql<string>`COALESCE((
          SELECT SUM(p.amount_cents) FROM ledger_postings p
          WHERE p.account = 'seller_held' AND p.party_id = ${sellerId} AND p.drop_id = drops.id
        ), 0)`,
        ordersHeld: sql<number>`(SELECT count(*)::int FROM orders o WHERE o.drop_id = drops.id AND o.funds_state = 'held')`,
        ordersReleased: sql<number>`(SELECT count(*)::int FROM orders o WHERE o.drop_id = drops.id AND o.funds_state = 'released')`,
        ordersRefunded: sql<number>`(SELECT count(*)::int FROM orders o WHERE o.drop_id = drops.id AND o.funds_state = 'refunded')`,
      }).from(drops)
        .where(and(eq(drops.ownerId, sellerId), eq(drops.type, "pre-order")))
        .orderBy(desc(drops.createdAt))
        .limit(50),
      db.select({
        count: sql<number>`count(*)::int`,
        total: sql<string>`COALESCE(SUM(${orderReleases.amountCents}), 0)`,
      }).from(orderReleases)
        .where(and(
          eq(orderReleases.sellerId, sellerId),
          inArray(orderReleases.state, ["pending", "transferring", "failed"]),
        )),
      db.select({
        platformFees: sql<string>`COALESCE(SUM(${orders.platformFeeCents} - ${orders.platformFeeRefundedCents}), 0)`,
        processingFees: sql<string>`COALESCE(SUM(${orders.processingFeeChargedCents}), 0)`,
        grossSales: sql<string>`COALESCE(SUM(${orders.grossChargedCents}), 0)`,
        refunded: sql<string>`COALESCE(SUM(${orders.refundedCents}), 0)`,
      }).from(orders)
        .where(and(eq(orders.ownerId, sellerId), sql`${orders.chargeModel} IS NOT NULL`)),
      db.select({
        id: ledgerTransactions.id,
        kind: ledgerTransactions.kind,
        memo: ledgerTransactions.memo,
        orderId: ledgerTransactions.orderId,
        dropId: ledgerTransactions.dropId,
        occurredAt: ledgerTransactions.occurredAt,
        sellerEffectCents: sql<string>`COALESCE((
          SELECT SUM(p.amount_cents) FROM ledger_postings p
          WHERE p.transaction_id = ledger_transactions.id AND p.party_id = ${sellerId}
            AND p.account IN ('seller_held', 'seller_paid_out', 'platform_funds_advanced')
        ), 0)`,
      }).from(ledgerTransactions)
        .where(eq(ledgerTransactions.sellerId, sellerId))
        .orderBy(desc(ledgerTransactions.occurredAt))
        .limit(25),
    ]);

    // Live Stripe balance. The ledger part of the summary still renders if
    // Stripe is unreachable; the app shows those two figures as unavailable.
    let stripeBalance: { available: number; pending: number } | null = null;
    let paidToBankCents: number | null = null;
    let stripeError = false;
    const accountId = await getStripeAccount(sellerId);
    if (stripe && accountId) {
      try {
        const [balance, reservationRows, payoutPage] = await Promise.all([
          stripe.balance.retrieve({}, { stripeAccount: accountId }),
          db.select({ reserved: sql<number>`COALESCE(SUM(${orderFundReservations.amountCents}), 0)::int` })
            .from(orderFundReservations)
            .where(and(eq(orderFundReservations.ownerId, sellerId), eq(orderFundReservations.status, "reserved"))),
          stripe.payouts.list({ limit: 100 }, { stripeAccount: accountId }),
        ]);
        const avail = balance.available.find((entry) => entry.currency === PAYOUT_CURRENCY)?.amount ?? 0;
        const pend = balance.pending.find((entry) => entry.currency === PAYOUT_CURRENCY)?.amount ?? 0;
        stripeBalance = {
          available: cashOutableAmount(avail, Number(reservationRows[0]?.reserved ?? 0)),
          pending: pend,
        };
        paidToBankCents = payoutPage.data
          .filter((payout) => payout.status === "paid" && payout.currency === PAYOUT_CURRENCY)
          .reduce((total, payout) => total + payout.amount, 0);
      } catch (err) {
        stripeError = true;
        req.log.warn({ err }, "Stripe balance unavailable for finance summary");
      }
    }

    const money = (cents: number) => ({ amount: cents, formatted: formatCents(cents) });
    res.json({
      currency: PAYOUT_CURRENCY,
      connected: Boolean(accountId),
      stripeError,
      held: {
        ...money(heldTotal),
        drops: dropRows.map((row) => {
          const held = Number(row.heldCents);
          return {
            dropId: row.dropId,
            name: row.name,
            escrowState: row.escrowState,
            fulfillmentDeadlineAt: row.fulfillmentDeadlineAt?.toISOString() ?? null,
            heldCents: Math.max(0, held),
            shortfallCents: held < 0 ? -held : 0,
            ordersHeld: row.ordersHeld,
            ordersReleased: row.ordersReleased,
            ordersRefunded: row.ordersRefunded,
          };
        }),
      },
      releasing: { ...money(Number(releasing[0]?.total ?? 0)), count: releasing[0]?.count ?? 0 },
      available: stripeBalance ? money(stripeBalance.available) : null,
      pending: stripeBalance ? money(stripeBalance.pending) : null,
      paidOut: {
        ...money(sum("seller_paid_out")),
        toBank: paidToBankCents === null ? null : money(paidToBankCents),
      },
      owed: money(Math.max(0, -advanced) + dropShortfallOwed),
      credit: money(Math.max(0, advanced)),
      lifetime: {
        grossSales: money(Number(fees[0]?.grossSales ?? 0)),
        refunded: money(Number(fees[0]?.refunded ?? 0)),
        platformFees: money(Number(fees[0]?.platformFees ?? 0)),
        processingFees: money(Number(fees[0]?.processingFees ?? 0)),
      },
      activity: activity.map((row) => ({
        id: row.id,
        kind: row.kind,
        description: row.memo,
        orderId: row.orderId,
        dropId: row.dropId,
        occurredAt: row.occurredAt.toISOString(),
        sellerEffectCents: Number(row.sellerEffectCents),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load finance summary");
    res.status(500).json({ error: "Failed to load finance summary" });
  }
});

// ─── GET /api/finance/payouts ─────────────────────────────────────────────────

router.get("/payouts", requirePayoutsRead(), async (req, res) => {
  const sellerId = getSellerId(req);
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  try {
    const accountId = await getStripeAccount(sellerId);

    if (!stripe || !accountId) {
      res.json({ payouts: [], connected: false });
      return;
    }

    const result = await stripe.payouts.list(
      { limit, expand: ["data.destination"] },
      { stripeAccount: accountId },
    );

    res.json({
      payouts: result.data.map(p => ({
        id:          p.id,
        amount:      p.amount,
        currency:    p.currency,
        formatted:   formatCents(p.amount, p.currency),
        status:      p.status,
        arrivalDate: new Date(p.arrival_date * 1000).toISOString(),
        created:     new Date(p.created * 1000).toISOString(),
        description: p.description,
        failureCode: (p as any).failure_code ?? null,
        failureMessage: (p as any).failure_message ?? null,
        method:      (p as any).method ?? null,
        // Bank last4 comes from destination
        destination: (p as any).destination
          ? { last4: (p as any).destination?.last4 ?? null, brand: (p as any).destination?.brand ?? null }
          : null,
      })),
      hasMore:   result.has_more,
      connected: true,
    });
  } catch (err: any) {
    req.log.error({ err }, "Failed to load payouts");
    res.status(err.status ?? 500).json({ error: err.message ?? "Failed to load payouts" });
  }
});

// ─── GET /api/finance/transactions ───────────────────────────────────────────

router.get("/transactions", requirePayoutsRead(), async (req, res) => {
  const sellerId = getSellerId(req);
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const type  = req.query.type as string | undefined; // e.g. 'charge', 'payout', 'refund'
  try {
    const accountId = await getStripeAccount(sellerId);

    if (!stripe || !accountId) {
      res.json({ transactions: [], connected: false });
      return;
    }

    const params: any = { limit };
    if (type) params.type = type;

    const result = await stripe.balanceTransactions.list(
      params,
      { stripeAccount: accountId },
    );

    res.json({
      transactions: result.data.map(t => ({
        id:          t.id,
        type:        t.type,
        amount:      t.amount,
        net:         t.net,
        fee:         t.fee,
        currency:    t.currency,
        formatted:   formatCents(t.amount, t.currency),
        netFormatted: formatCents(t.net, t.currency),
        description: t.description,
        status:      t.status,
        created:     new Date(t.created * 1000).toISOString(),
        reportingCategory: t.reporting_category,
      })),
      hasMore:   result.has_more,
      connected: true,
    });
  } catch (err: any) {
    req.log.error({ err }, "Failed to load transactions");
    res.status(err.status ?? 500).json({ error: err.message ?? "Failed to load transactions" });
  }
});

// ─── GET /api/finance/statement.csv ──────────────────────────────────────────

router.get("/statement.csv", requirePayoutsRead(), async (req, res) => {
  const sellerId = getSellerId(req);
  try {
    const accountId = await getStripeAccount(sellerId);

    if (!stripe || !accountId) {
      res.status(400).json({ error: "Stripe not connected" }); return;
    }

    // Fetch up to 100 balance transactions for the statement
    const result = await stripe.balanceTransactions.list(
      { limit: 100 },
      { stripeAccount: accountId },
    );

    const rows = result.data.map(t => [
      new Date(t.created * 1000).toISOString(),
      t.type,
      (t.amount / 100).toFixed(2),
      (t.net / 100).toFixed(2),
      (t.fee / 100).toFixed(2),
      t.currency.toUpperCase(),
      t.status,
      t.reporting_category,
      `"${(t.description ?? "").replace(/"/g, '""')}"`,
    ].join(","));

    const header = "Date,Type,Amount,Net,Fee,Currency,Status,Category,Description";
    const csv    = [header, ...rows].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="brandthread-statement-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (err: any) {
    req.log.error({ err }, "Failed to generate statement");
    res.status(500).json({ error: "Failed to generate statement" });
  }
});

// ─── POST /api/finance/payout — manual bank payout ────────────────────────────

router.post("/payout", requirePermission("payouts"), async (req, res) => {
  const sellerId = getSellerId(req);
  if (await denyIfAgeRestricted(sellerId, res)) return;
  if (await isPayoutHeld("seller", sellerId)) { res.status(409).json(PAYOUTS_ON_HOLD); return; }
  const { amount, currency, idempotencyKey } = req.body;
  const methodInput = req.body?.method;

  try {
    if (!isValidPayoutIdempotencyKey(idempotencyKey)) {
      res.status(400).json({
        error: "A valid idempotency key is required",
        code: "INVALID_IDEMPOTENCY_KEY",
      });
      return;
    }
    if (!Number.isSafeInteger(amount) || amount <= 0 || currency !== PAYOUT_CURRENCY) {
      res.status(400).json({
        error: "A positive integer USD amount is required",
        code: "INVALID_PAYOUT_AMOUNT",
      });
      return;
    }
    if (methodInput !== undefined && methodInput !== "standard" && methodInput !== "instant") {
      res.status(400).json({
        error: "method must be standard or instant",
        code: "INVALID_PAYOUT_METHOD",
      });
      return;
    }
    const method: "standard" | "instant" = methodInput === "instant" ? "instant" : "standard";
    const currentAccountId = await getStripeAccount(sellerId);
    if (!stripe) {
      res.status(503).json({ error: "Stripe is unavailable" }); return;
    }
    const stripeClient = stripe;
    const claimResult: CashoutResult = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${sellerId}))`);

      const [existing] = await tx.select()
        .from(sellerCashoutAttempts)
        .where(and(
          eq(sellerCashoutAttempts.ownerId, sellerId),
          eq(sellerCashoutAttempts.idempotencyKey, idempotencyKey),
        ))
        .limit(1);

      if (existing) {
        if (existing.amountCents !== amount || existing.currency !== currency || existing.method !== method) {
          return {
            kind: "error" as const,
            httpStatus: 409,
            code: "IDEMPOTENCY_CONFLICT",
            message: "This cash-out retry does not match the originally confirmed amount",
          };
        }
        if (existing.status === "succeeded" && existing.stripePayoutId && existing.responseStatus && existing.responseArrivalDate) {
          return {
            kind: "success" as const,
            duplicate: true,
            payout: {
              id: existing.stripePayoutId,
              amount: existing.amountCents,
              currency: existing.currency,
              status: existing.responseStatus,
              arrivalDate: existing.responseArrivalDate,
            },
          };
        }
        if (existing.status === "failed") {
          return {
            kind: "error" as const,
            httpStatus: existing.errorHttpStatus ?? 409,
            code: existing.errorCode ?? "PAYOUT_FAILED",
            message: existing.errorMessage ?? "Payout failed",
          };
        }
        return { kind: "continue" as const };
      } else {
        if (!currentAccountId) {
          return {
            kind: "error" as const,
            httpStatus: 409,
            code: "PAYOUTS_NOT_ENABLED",
            message: "Connect and verify a bank account before cashing out",
          };
        }
        const [account, externalAccounts, balance, reservationRows, processingRows] = await Promise.all([
          stripeClient.accounts.retrieve(currentAccountId),
          stripeClient.accounts.listExternalAccounts(currentAccountId, {
            // Instant Payouts go to a debit card (or instant-capable bank), so
            // the standard bank-only filter must not apply to them.
            ...(method === "standard" ? { object: "bank_account" as const } : {}),
            limit: 100,
          }),
          stripeClient.balance.retrieve({}, { stripeAccount: currentAccountId }),
          tx.select({ reserved: sql<number>`COALESCE(SUM(${orderFundReservations.amountCents}), 0)::int` })
            .from(orderFundReservations)
            .where(and(
              eq(orderFundReservations.ownerId, sellerId),
              // Only labels still being bought are in flight. A bought label's
          // cost is recovered from the Stripe balance itself (transfer
          // reversal), so counting "spent" here would charge it twice and
          // shrink the balance forever.
          eq(orderFundReservations.status, "reserved"),
            )),
          tx.select({ amountCents: sellerCashoutAttempts.amountCents })
            .from(sellerCashoutAttempts)
            .where(and(
              eq(sellerCashoutAttempts.ownerId, sellerId),
              eq(sellerCashoutAttempts.status, "processing"),
              eq(sellerCashoutAttempts.currency, PAYOUT_CURRENCY),
            )),
        ]);
        let bankAccount = findEligibleBankAccount(externalAccounts.data);
        if (method === "instant") {
          const instant = findInstantDestination(externalAccounts.data, PAYOUT_CURRENCY);
          if (!instant.eligible) {
            return {
              kind: "error" as const,
              httpStatus: 409,
              code: "INSTANT_PAYOUT_UNAVAILABLE",
              message: "Instant payouts need a debit card that Stripe has enabled for instant payouts",
            };
          }
          bankAccount = { id: instant.destination.id };
        }
        if (account.payouts_enabled !== true || !bankAccount) {
          return {
            kind: "error" as const,
            httpStatus: 409,
            code: "PAYOUTS_NOT_ENABLED",
            message: "Bank payouts are not enabled for this Stripe account",
          };
        }
        const providerAvailable = balance.available.find((entry) => entry.currency === PAYOUT_CURRENCY)?.amount ?? 0;
        const reserved = Number(reservationRows[0]?.reserved ?? 0);
        const processingReserved = processingRows.reduce((sum, row) => sum + row.amountCents, 0);
        const spendable = cashOutableAmount(providerAvailable, reserved + processingReserved);
        // An instant payout's fee comes out of the same balance, so "cash out
        // everything" is the largest amount whose amount + fee still fits.
        const availableAfterReservations = method === "instant" ? maxInstantPayoutCents(spendable) : spendable;
        if (amount !== availableAfterReservations) {
          return {
            kind: "error" as const,
            httpStatus: 409,
            code: "BALANCE_CHANGED",
            message: "The available balance changed. Review the new balance and confirm again.",
            availableAfterReservations,
          };
        }
        await tx.insert(sellerCashoutAttempts).values({
          ownerId: sellerId,
          idempotencyKey,
          amountCents: amount,
          currency,
          stripeAccountId: currentAccountId,
          bankDestinationId: bankAccount.id,
          method,
          status: "processing",
        });
        return { kind: "continue" as const };
      }
    });

    let result: CashoutResult = claimResult;
    if (claimResult.kind === "continue") {
      result = await db.transaction(async (tx): Promise<CashoutResult> => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${sellerId}))`);
        const [current] = await tx.select()
          .from(sellerCashoutAttempts)
          .where(and(
            eq(sellerCashoutAttempts.ownerId, sellerId),
            eq(sellerCashoutAttempts.idempotencyKey, idempotencyKey),
          ))
          .limit(1);
        if (!current) {
          return {
            kind: "error",
            httpStatus: 500,
            code: "PAYOUT_ATTEMPT_MISSING",
            message: "The cash-out attempt could not be loaded",
          };
        }
        if (current.amountCents !== amount || current.currency !== currency || current.method !== method) {
          return {
            kind: "error",
            httpStatus: 409,
            code: "IDEMPOTENCY_CONFLICT",
            message: "This cash-out retry does not match the originally confirmed amount",
          };
        }
        if (current.status === "succeeded" && current.stripePayoutId && current.responseStatus && current.responseArrivalDate) {
          return {
            kind: "success",
            duplicate: true,
            payout: {
              id: current.stripePayoutId,
              amount: current.amountCents,
              currency: current.currency,
              status: current.responseStatus,
              arrivalDate: current.responseArrivalDate,
            },
          };
        }
        if (current.status === "failed") {
          return {
            kind: "error",
            httpStatus: current.errorHttpStatus ?? 409,
            code: current.errorCode ?? "PAYOUT_FAILED",
            message: current.errorMessage ?? "Payout failed",
          };
        }
        if (!current.stripeAccountId || !current.bankDestinationId) {
          return {
            kind: "error",
            httpStatus: 409,
            code: "PAYOUT_REVIEW_REQUIRED",
            message: "This cash-out attempt needs review before it can continue",
          };
        }

        let reconciledPayout: any | undefined;
        try {
          const recentPayouts = await stripeClient.payouts.list(
            { limit: 100 },
            { stripeAccount: current.stripeAccountId },
          );
          reconciledPayout = recentPayouts.data.find(
            (payout) => payout.metadata?.brandthread_cashout_attempt === current.id,
          );
        } catch {
          return {
            kind: "error",
            httpStatus: 502,
            code: "PAYOUT_PROVIDER_UNCONFIRMED",
            message: "The payout provider result could not be confirmed",
          };
        }
        if (reconciledPayout) {
          const arrivalDate = new Date(reconciledPayout.arrival_date * 1000);
          await tx.update(sellerCashoutAttempts)
            .set({
              status: "succeeded",
              stripePayoutId: reconciledPayout.id,
              responseStatus: reconciledPayout.status,
              responseArrivalDate: arrivalDate,
              errorHttpStatus: null,
              errorCode: null,
              errorMessage: null,
              updatedAt: new Date(),
            })
            .where(eq(sellerCashoutAttempts.id, current.id));
          return {
            kind: "success",
            duplicate: true,
            payout: {
              id: reconciledPayout.id,
              amount: reconciledPayout.amount,
              currency: reconciledPayout.currency,
              status: reconciledPayout.status,
              arrivalDate,
            },
          };
        }
        if (Date.now() - current.createdAt.valueOf() > SAFE_PROVIDER_RETRY_WINDOW_MS) {
          return {
            kind: "error",
            httpStatus: 409,
            code: "PAYOUT_REVIEW_REQUIRED",
            message: "This cash-out attempt is too old to retry automatically and needs review",
          };
        }

      try {
        const payout = await stripeClient.payouts.create(
          {
            amount: current.amountCents,
            currency: current.currency,
            method: current.method === "instant" ? "instant" : "standard",
            destination: current.bankDestinationId,
            metadata: { brandthread_cashout_attempt: current.id },
          },
          {
            stripeAccount: current.stripeAccountId,
            idempotencyKey: `brandthread-cashout/${current.id}`,
          },
        );
        const arrivalDate = new Date(payout.arrival_date * 1000);
        await tx.update(sellerCashoutAttempts)
          .set({
            status: "succeeded",
            stripePayoutId: payout.id,
            responseStatus: payout.status,
            responseArrivalDate: arrivalDate,
            errorHttpStatus: null,
            errorCode: null,
            errorMessage: null,
            updatedAt: new Date(),
          })
          .where(and(
            eq(sellerCashoutAttempts.ownerId, sellerId),
            eq(sellerCashoutAttempts.idempotencyKey, idempotencyKey),
          ));
        return {
          kind: "success" as const,
          duplicate: false,
          payout: {
            id: payout.id,
            amount: payout.amount,
            currency: payout.currency,
            status: payout.status,
            arrivalDate,
          },
        };
      } catch (providerError: any) {
        const providerStatus = Number(providerError?.statusCode ?? providerError?.status);
        const definitive = Number.isInteger(providerStatus) && providerStatus >= 400 && providerStatus < 500;
        const httpStatus = definitive ? providerStatus : 502;
        const code = typeof providerError?.code === "string" ? providerError.code : "PAYOUT_PROVIDER_UNCONFIRMED";
        const message = definitive
          ? (providerError?.message ?? "Stripe rejected the payout")
          : "The payout provider result could not be confirmed";
        await tx.update(sellerCashoutAttempts)
          .set({
            status: definitive ? "failed" : "processing",
            errorHttpStatus: httpStatus,
            errorCode: code,
            errorMessage: message,
            updatedAt: new Date(),
          })
          .where(and(
            eq(sellerCashoutAttempts.ownerId, sellerId),
            eq(sellerCashoutAttempts.idempotencyKey, idempotencyKey),
          ));
        return { kind: "error" as const, httpStatus, code, message };
      }
      });
    }

    if (result.kind === "continue") {
      res.status(500).json({ error: "The payout attempt did not finish", code: "PAYOUT_ATTEMPT_INCOMPLETE" });
      return;
    }
    if (result.kind === "error") {
      res.status(result.httpStatus).json({
        error: result.message,
        code: result.code,
        ...("availableAfterReservations" in result
          ? { availableAfterReservations: result.availableAfterReservations }
          : {}),
      });
      return;
    }

    if (!result.duplicate) {
      void publishNotification({
        userId: sellerId,
        category: "payout",
        type: "payout_sent",
        title: "Payout sent",
        body: `${formatCents(result.payout.amount, result.payout.currency)} is on its way to your bank — arriving ${result.payout.arrivalDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`,
        targetId: result.payout.id,
        targetType: "payout",
        cta: "View payouts",
        pushChannelId: "payout",
      }).catch((err) => req.log.error({ err, sellerId }, "Payout sent notification failed"));
    }

    res.status(result.duplicate ? 200 : 201).json({
      id: result.payout.id,
      amount: result.payout.amount,
      currency: result.payout.currency,
      formatted: formatCents(result.payout.amount, result.payout.currency),
      status: result.payout.status,
      arrivalDate: result.payout.arrivalDate.toISOString(),
      duplicate: result.duplicate,
    });
  } catch (err: any) {
    req.log.error({ err }, "Failed to request payout");
    res.status(err.status ?? 500).json({
      error: err.message ?? "Payout failed",
      ...(err.code && { code: err.code }),
      ...(err.availableAfterReservations !== undefined && { availableAfterReservations: err.availableAfterReservations }),
    });
  }
});

// ─── GET / PATCH /api/finance/payout-schedule ─────────────────────────────────
// "Instant" is the manual schedule plus on-demand instant payouts, available
// only when Stripe reports an instant-capable debit card on the account.

const INSTANT_INFO = {
  feeBps: payoutPolicySnapshot().instantFeeBps,
  minFeeCents: payoutPolicySnapshot().instantMinFeeCents,
};

function scheduleView(account: any) {
  const schedule = currentScheduleOf(account);
  return schedule
    ? { interval: schedule.interval, weeklyAnchor: schedule.weeklyAnchor, delayDays: schedule.delayDays }
    : null;
}

router.get("/payout-schedule", requirePayoutsRead(), async (req, res) => {
  const sellerId = getSellerId(req);
  try {
    const accountId = await getStripeAccount(sellerId);
    if (!stripe || !accountId) {
      res.json({
        connected: false,
        providerConfigured: Boolean(stripe),
        payoutsEnabled: false,
        schedule: null,
        instant: { eligible: false, reason: "not_connected", destination: null, ...INSTANT_INFO, maxAmount: null, quote: null },
        nextPayoutEstimate: null,
        policy: payoutPolicySnapshot(),
      });
      return;
    }
    const [account, externalAccounts, balance, pendingPayouts, reservationRows, processingRows] = await Promise.all([
      stripe.accounts.retrieve(accountId),
      stripe.accounts.listExternalAccounts(accountId, { limit: 100 }),
      stripe.balance.retrieve({}, { stripeAccount: accountId }),
      stripe.payouts.list({ limit: 1, status: "pending" }, { stripeAccount: accountId }),
      db.select({ reserved: sql<number>`COALESCE(SUM(${orderFundReservations.amountCents}), 0)::int` })
        .from(orderFundReservations)
        .where(and(eq(orderFundReservations.ownerId, sellerId), eq(orderFundReservations.status, "reserved"))),
      db.select({ amountCents: sellerCashoutAttempts.amountCents })
        .from(sellerCashoutAttempts)
        .where(and(
          eq(sellerCashoutAttempts.ownerId, sellerId),
          eq(sellerCashoutAttempts.status, "processing"),
          eq(sellerCashoutAttempts.currency, PAYOUT_CURRENCY),
        )),
    ]);
    const providerAvailable = balance.available.find((entry) => entry.currency === PAYOUT_CURRENCY)?.amount ?? 0;
    const spendable = cashOutableAmount(
      providerAvailable,
      Number(reservationRows[0]?.reserved ?? 0) + processingRows.reduce((sum, row) => sum + row.amountCents, 0),
    );
    const eligibility = findInstantDestination(externalAccounts.data, PAYOUT_CURRENCY);
    const maxInstant = maxInstantPayoutCents(spendable);
    const requested = req.query.amount === undefined ? null : Number(req.query.amount);
    if (requested !== null && (!Number.isSafeInteger(requested) || requested <= 0)) {
      res.status(400).json({ error: "amount must be a positive integer number of cents", code: "INVALID_PAYOUT_AMOUNT" });
      return;
    }
    const quoteAmount = requested ?? maxInstant;
    const fee = quoteAmount > 0 ? instantPayoutFeeCents(quoteAmount) : 0;
    const extras = await balanceExtras({
      sellerId, account, available: spendable, existing: pendingPayouts.data[0] ?? null, log: req.log,
    });
    res.json({
      connected: true,
      providerConfigured: true,
      payoutsEnabled: account.payouts_enabled === true,
      schedule: scheduleView(account),
      instant: {
        eligible: account.payouts_enabled === true && eligibility.eligible,
        reason: !account.payouts_enabled ? "payouts_disabled" : eligibility.eligible ? null : eligibility.reason,
        destination: eligibility.eligible ? eligibility.destination : null,
        ...INSTANT_INFO,
        maxAmount: { amount: maxInstant, formatted: formatCents(maxInstant) },
        quote: quoteAmount > 0
          ? {
              amount: quoteAmount,
              fee: fee,
              feeFormatted: formatCents(fee),
              total: quoteAmount + fee,
              withinBalance: quoteAmount + fee <= spendable,
            }
          : null,
      },
      nextPayoutEstimate: "nextPayoutEstimate" in extras ? extras.nextPayoutEstimate : null,
      held: "held" in extras ? extras.held : null,
      policy: payoutPolicySnapshot(),
    });
  } catch (err: any) {
    req.log.error({ err }, "Failed to load payout schedule");
    res.status(err.status ?? 500).json({ error: err.message ?? "Failed to load payout schedule" });
  }
});

router.patch("/payout-schedule", requirePermission("payouts"), async (req, res) => {
  const sellerId = getSellerId(req);
  if (await isPayoutHeld("seller", sellerId)) { res.status(409).json(PAYOUTS_ON_HOLD); return; }
  try {
    const parsed = validateScheduleInput(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.message, code: parsed.code });
      return;
    }
    if (!stripe) {
      res.status(503).json({ error: "Stripe is unavailable", code: "STRIPE_UNAVAILABLE" });
      return;
    }
    const accountId = await getStripeAccount(sellerId);
    if (!accountId) {
      res.status(409).json({ error: "Connect Stripe before choosing a payout schedule", code: "PAYOUTS_NOT_ENABLED" });
      return;
    }
    const account = await stripe.accounts.retrieve(accountId);
    if (scheduleMatches(currentScheduleOf(account), parsed.update)) {
      res.json({ changed: false, schedule: scheduleView(account) });
      return;
    }
    let updated: any;
    try {
      updated = await stripe.accounts.update(accountId, {
        settings: { payouts: { schedule: stripeScheduleParams(parsed.update) } },
      });
    } catch (providerError: any) {
      const status = Number(providerError?.statusCode ?? providerError?.status);
      if (Number.isInteger(status) && status >= 400 && status < 500) {
        res.status(409).json({
          error: providerError?.message ?? "Stripe did not accept this payout schedule",
          code: "SCHEDULE_REJECTED",
        });
        return;
      }
      throw providerError;
    }
    res.json({ changed: true, schedule: scheduleView(updated) });
  } catch (err: any) {
    req.log.error({ err }, "Failed to update payout schedule");
    res.status(err.status ?? 500).json({ error: "Failed to update payout schedule" });
  }
});

// ─── GET /api/finance/payouts/:id — per-payout breakdown ─────────────────────

const PAYOUT_ID = /^po_[A-Za-z0-9]{6,64}$/;
const BREAKDOWN_PAGE_LIMIT = 5; // x100 balance transactions per payout

router.get("/payouts/:id", requirePayoutsRead(), async (req, res) => {
  const sellerId = getSellerId(req);
  const payoutId = String(req.params.id);
  try {
    if (!PAYOUT_ID.test(payoutId)) {
      res.status(400).json({ error: "Invalid payout id", code: "INVALID_PAYOUT_ID" });
      return;
    }
    const accountId = await getStripeAccount(sellerId);
    if (!stripe || !accountId) {
      res.json({ connected: false, payout: null, breakdown: null });
      return;
    }
    // Retrieving with the connected-account header means a payout that does
    // not belong to this seller simply does not exist for them.
    let payout: any;
    try {
      payout = await stripe.payouts.retrieve(
        payoutId,
        { expand: ["destination", "balance_transaction"] },
        { stripeAccount: accountId },
      );
    } catch (providerError: any) {
      if (Number(providerError?.statusCode ?? providerError?.status) === 404) {
        res.status(404).json({ error: "Payout not found", code: "PAYOUT_NOT_FOUND" });
        return;
      }
      throw providerError;
    }

    // Stripe only attributes balance transactions to automatic payouts.
    const automatic = payout.automatic === true;
    const transactions: any[] = [];
    let truncated = false;
    if (automatic) {
      let startingAfter: string | undefined;
      for (let page = 0; page < BREAKDOWN_PAGE_LIMIT; page += 1) {
        const result = await stripe.balanceTransactions.list(
          { payout: payoutId, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) },
          { stripeAccount: accountId },
        );
        transactions.push(...result.data);
        if (!result.has_more) break;
        startingAfter = result.data[result.data.length - 1]?.id;
        if (page === BREAKDOWN_PAGE_LIMIT - 1) truncated = true;
      }
    }
    const breakdown = automatic
      ? buildPayoutBreakdown({ payoutAmountCents: payout.amount, transactions })
      : null;
    if (breakdown) assertBreakdownReconciles(breakdown);

    const instantFee = payout.method === "instant" && typeof payout.balance_transaction === "object"
      ? Math.max(0, Number(payout.balance_transaction?.fee ?? 0))
      : 0;
    const destination = typeof payout.destination === "object" && payout.destination ? payout.destination : null;
    const money = (cents: number) => ({ amount: cents, formatted: formatCents(cents, payout.currency) });
    res.json({
      connected: true,
      payout: {
        id: payout.id,
        amount: payout.amount,
        currency: payout.currency,
        formatted: formatCents(payout.amount, payout.currency),
        status: payout.status,
        method: payout.method ?? "standard",
        automatic,
        arrivalDate: new Date(payout.arrival_date * 1000).toISOString(),
        created: new Date(payout.created * 1000).toISOString(),
        failureCode: payout.failure_code ?? null,
        failureMessage: payout.failure_message ?? null,
        destination: destination
          ? { last4: destination.last4 ?? null, brand: destination.brand ?? destination.bank_name ?? null }
          : null,
        instantFee: instantFee > 0 ? money(instantFee) : null,
      },
      breakdown: breakdown
        ? {
            lines: Object.fromEntries(
              Object.entries(breakdown.lines).map(([key, cents]) => [key, money(cents)]),
            ),
            net: money(breakdown.payoutCents),
            reconciled: breakdown.reconciled,
            remainder: money(breakdown.remainderCents),
            transactionCount: breakdown.transactionCount,
            truncated,
          }
        : null,
    });
  } catch (err: any) {
    req.log.error({ err }, "Failed to load payout breakdown");
    res.status(err.status ?? 500).json({ error: err.message ?? "Failed to load payout" });
  }
});

export default router;
