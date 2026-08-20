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
import { users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole, teamContext } from "../middlewares/requireRole";
import { stripe } from "../lib/stripe";

const router = Router();
router.use(requireAuth);
router.use(teamContext());

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

// ─── GET /api/finance/balance ─────────────────────────────────────────────────

router.get("/balance", requireRole("manager"), async (req, res) => {
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

    const [balance, payouts] = await Promise.all([
      stripe.balance.retrieve({}, { stripeAccount: accountId }),
      stripe.payouts.list({ limit: 1, status: "pending" }, { stripeAccount: accountId }),
    ]);

    const avail   = balance.available[0] ?? { amount: 0, currency: "usd" };
    const pending = balance.pending[0]   ?? { amount: 0, currency: "usd" };
    const nextP   = payouts.data[0] ?? null;

    res.json({
      available: {
        amount:    avail.amount,
        currency:  avail.currency,
        formatted: formatCents(avail.amount, avail.currency),
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
    });
  } catch (err: any) {
    console.error(err);
    res.status(err.status ?? 500).json({ error: err.message ?? "Failed to load balance" });
  }
});

// ─── GET /api/finance/payouts ─────────────────────────────────────────────────

router.get("/payouts", requireRole("manager"), async (req, res) => {
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
    console.error(err);
    res.status(err.status ?? 500).json({ error: err.message ?? "Failed to load payouts" });
  }
});

// ─── GET /api/finance/transactions ───────────────────────────────────────────

router.get("/transactions", requireRole("manager"), async (req, res) => {
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
    console.error(err);
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
    console.error(err);
    res.status(500).json({ error: "Failed to generate statement" });
  }
});

// ─── POST /api/finance/payout — manual instant payout ─────────────────────────

router.post("/payout", requireRole("owner"), async (req, res) => {
  const sellerId = getSellerId(req);
  const { amount, currency = "usd" } = req.body;

  try {
    const accountId = await getStripeAccount(sellerId);
    if (!stripe || !accountId) {
      res.status(400).json({ error: "Stripe not connected" }); return;
    }

    const payout = await stripe.payouts.create(
      {
        amount:   amount ?? undefined, // undefined = full available balance
        currency,
        method:   "instant",
      },
      { stripeAccount: accountId },
    );

    res.status(201).json({
      id:          payout.id,
      amount:      payout.amount,
      currency:    payout.currency,
      formatted:   formatCents(payout.amount, payout.currency),
      status:      payout.status,
      arrivalDate: new Date(payout.arrival_date * 1000).toISOString(),
    });
  } catch (err: any) {
    console.error(err);
    res.status(err.status ?? 500).json({ error: err.message ?? "Payout failed" });
  }
});

export default router;
