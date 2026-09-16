/**
 * Finance / Payouts dashboard — Stripe Connect data
 * Mounted at /api/finance
 *
 * GET  /balance                 available + pending balance, next payout date
 * GET  /payouts                 payout history list
 * GET  /transactions            balance transaction list (for finance P&L view)
 * GET  /statement.csv           download CSV of transactions
 * POST /payout                  manually trigger a payout (if manual schedule)
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { users, orderFundReservations, sellerCashoutAttempts } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole, teamContext } from "../middlewares/requireRole";
import { stripe } from "../lib/stripe";
import { cashOutableAmount, isValidPayoutIdempotencyKey } from "../lib/payoutSafety";

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

// ─── GET /api/finance/balance ─────────────────────────────────────────────────

// Finance data is owner-only: a joined-store member must not infer balances,
// payouts, fees, or account status after teamContext rewrites the store owner.
router.get("/balance", requireRole("owner"), async (req, res) => {
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
          inArray(orderFundReservations.status, ["reserved", "spent"]),
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

// ─── GET /api/finance/payouts ─────────────────────────────────────────────────

router.get("/payouts", requireRole("owner"), async (req, res) => {
  const sellerId = getSellerId(req);
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  try {
    const accountId = await getStripeAccount(sellerId);

    if (!stripe || !accountId) {
      res.json({ payouts: [], connected: false });
      return;
    }

    const result = await stripe.payouts.list(
      { limit },
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

router.get("/transactions", requireRole("owner"), async (req, res) => {
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

router.get("/statement.csv", requireRole("owner"), async (req, res) => {
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

router.post("/payout", requireRole("owner"), async (req, res) => {
  const sellerId = getSellerId(req);
  const { amount, currency, idempotencyKey } = req.body;

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
        if (existing.amountCents !== amount || existing.currency !== currency) {
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
            object: "bank_account",
            limit: 100,
          }),
          stripeClient.balance.retrieve({}, { stripeAccount: currentAccountId }),
          tx.select({ reserved: sql<number>`COALESCE(SUM(${orderFundReservations.amountCents}), 0)::int` })
            .from(orderFundReservations)
            .where(and(
              eq(orderFundReservations.ownerId, sellerId),
              inArray(orderFundReservations.status, ["reserved", "spent"]),
            )),
          tx.select({ amountCents: sellerCashoutAttempts.amountCents })
            .from(sellerCashoutAttempts)
            .where(and(
              eq(sellerCashoutAttempts.ownerId, sellerId),
              eq(sellerCashoutAttempts.status, "processing"),
              eq(sellerCashoutAttempts.currency, PAYOUT_CURRENCY),
            )),
        ]);
        const bankAccount = findEligibleBankAccount(externalAccounts.data);
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
        const availableAfterReservations = cashOutableAmount(providerAvailable, reserved + processingReserved);
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
        if (current.amountCents !== amount || current.currency !== currency) {
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
            method: "standard",
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

export default router;
