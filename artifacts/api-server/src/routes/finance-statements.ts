/**
 * Monthly seller statements. Mounted at /api/finance/statements.
 *
 * GET /                 months available since the seller's first sale, newest first
 * GET /:month           statement as JSON           (month = YYYY-MM, UTC)
 * GET /:month.csv       RFC 4180 CSV, injection-safe cells
 * GET /:month.pdf       PDF statement
 *
 * Additive to routes/finance.ts (whose /statement.csv is untouched). The data
 * source and reconciliation rules are documented in lib/money/statement.ts.
 * Stripe / DB access is behind `StatementDeps` so the routes are unit-testable
 * and never crash when Stripe is not configured (409 STRIPE_NOT_CONNECTED).
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requirePayoutsRead, teamContext } from "../middlewares/requireRole";
import {
  buildStatement, monthLabel, monthsBetween, parseMonth, statementToCsv,
  StatementError, StatementReconciliationError,
  type Statement, type StatementTxn,
} from "../lib/money/statement";
import { renderStatementPdf } from "../lib/money/statementPdf";

const MAX_TRANSACTIONS = 20_000;

export type StatementDeps = {
  now: () => Date;
  /** null when Stripe is not configured or the seller has no connected account. */
  getStripeAccount: (sellerId: string) => Promise<string | null>;
  /** Auto-paginates every balance transaction with created in [startSec, endSec). */
  listTransactions: (accountId: string, startSec: number, endSec: number) => Promise<StatementTxn[]>;
  orderNumbersBySource: (sellerId: string, sources: string[]) => Promise<Map<string, string>>;
  firstSaleAt: (sellerId: string) => Promise<Date | null>;
  sellerName: (sellerId: string) => Promise<string | undefined>;
};

const defaultDeps: StatementDeps = {
  now: () => new Date(),
  async getStripeAccount(sellerId) {
    const [{ db, users }, { eq }, { stripe }] = await Promise.all([
      import("@workspace/db"), import("drizzle-orm"), import("../lib/stripe"),
    ]);
    if (!stripe) return null;
    const [u] = await db.select({ a: users.stripeAccountId }).from(users).where(eq(users.clerkId, sellerId)).limit(1);
    return u?.a ?? null;
  },
  async listTransactions(accountId, startSec, endSec) {
    const { stripe } = await import("../lib/stripe");
    if (!stripe) return [];
    const out: StatementTxn[] = [];
    const iter = stripe.balanceTransactions.list(
      { created: { gte: startSec, lt: endSec }, limit: 100 },
      { stripeAccount: accountId },
    );
    for await (const t of iter) {
      out.push({
        id: t.id, created: t.created, type: t.type, reportingCategory: t.reporting_category ?? null,
        amount: t.amount, fee: t.fee, net: t.net, currency: t.currency,
        description: t.description, source: typeof t.source === "string" ? t.source : (t.source as any)?.id ?? null,
        feeDetails: (t.fee_details ?? []).map((d) => ({ type: d.type, amount: d.amount })),
      });
      if (out.length > MAX_TRANSACTIONS) throw new Error("Too many transactions for one statement");
    }
    return out;
  },
  async orderNumbersBySource(sellerId, sources) {
    const map = new Map<string, string>();
    if (sources.length === 0) return map;
    try {
      const [{ db, orders }, { and, eq, inArray, or }] = await Promise.all([import("@workspace/db"), import("drizzle-orm")]);
      const rows = await db
        .select({ n: orders.orderNumber, c: orders.stripeChargeId, t: orders.stripeTransferId })
        .from(orders)
        .where(and(eq(orders.ownerId, sellerId), or(inArray(orders.stripeChargeId, sources), inArray(orders.stripeTransferId, sources))));
      for (const r of rows) {
        if (r.c) map.set(r.c, r.n);
        if (r.t) map.set(r.t, r.n);
      }
    } catch { /* labels are best effort; totals never depend on them */ }
    return map;
  },
  async firstSaleAt(sellerId) {
    const [{ db, orders }, { eq, sql, and, isNotNull }] = await Promise.all([import("@workspace/db"), import("drizzle-orm")]);
    const [row] = await db
      .select({ first: sql<Date | null>`min(${orders.paidAt})` })
      .from(orders)
      .where(and(eq(orders.ownerId, sellerId), isNotNull(orders.paidAt)));
    const v = row?.first as unknown;
    return v ? new Date(v as string | Date) : null;
  },
  async sellerName(sellerId) {
    try {
      const [{ db, users }, { eq }] = await Promise.all([import("@workspace/db"), import("drizzle-orm")]);
      const [u] = await db.select({ n: users.brandName }).from(users).where(eq(users.clerkId, sellerId)).limit(1);
      return u?.n ?? undefined;
    } catch { return undefined; }
  },
};

function sellerIdOf(req: Request): string {
  return (req as any).clerkUserId as string;
}

function sendNotConnected(res: Response) {
  res.status(409).json({ error: "Connect a payout account to view statements.", code: "STRIPE_NOT_CONNECTED" });
}

export function createStatementsRouter(overrides: Partial<StatementDeps> = {}): Router {
  const deps: StatementDeps = { ...defaultDeps, ...overrides };
  const router = Router();
  router.use(requireAuth);
  router.use(teamContext());

  const summaryCache = new Map<string, { at: number; value: Statement }>();
  const CACHE_MS = 5 * 60 * 1000;

  async function load(sellerId: string, accountId: string, month: string): Promise<Statement> {
    const now = deps.now();
    const { start, end } = parseMonth(month, now);
    const key = `${accountId}:${month}`;
    const hit = summaryCache.get(key);
    const closed = end.getTime() < now.getTime() - 24 * 3600 * 1000;
    if (hit && closed && now.getTime() - hit.at < CACHE_MS) return hit.value;
    const txns = await deps.listTransactions(accountId, start.getTime() / 1000, end.getTime() / 1000);
    const sources = Array.from(new Set(txns.map((t) => t.source).filter((s): s is string => !!s)));
    const orderNumbersBySource = await deps.orderNumbersBySource(sellerId, sources);
    const value = buildStatement({ month, now, transactions: txns, orderNumbersBySource });
    if (closed) summaryCache.set(key, { at: now.getTime(), value });
    return value;
  }

  router.get("/", requirePayoutsRead(), async (req, res) => {
    const sellerId = sellerIdOf(req);
    try {
      const accountId = await deps.getStripeAccount(sellerId);
      if (!accountId) { res.json({ connected: false, months: [] }); return; }
      const first = await deps.firstSaleAt(sellerId);
      if (!first) { res.json({ connected: true, months: [] }); return; }
      const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 36);
      const all = monthsBetween(first, deps.now());
      const months: any[] = [];
      for (let i = 0; i < all.length; i += 3) {
        const batch = all.slice(i, i + 3);
        const rows = await Promise.all(batch.map(async (month, j) => {
          const base = { month, label: monthLabel(month) };
          if (i + j >= limit) return { ...base, netCents: null, payoutsCents: null, grossSalesCents: null, transactionCount: null };
          try {
            const s = await load(sellerId, accountId, month);
            return { ...base, netCents: s.totals.netCents, payoutsCents: s.totals.payoutsCents, grossSalesCents: s.totals.grossSalesCents, transactionCount: s.counts.lines };
          } catch (err) {
            req.log?.warn?.({ err, month }, "statement summary failed");
            return { ...base, netCents: null, payoutsCents: null, grossSalesCents: null, transactionCount: null };
          }
        }));
        months.push(...rows);
      }
      res.json({ connected: true, months });
    } catch (err) {
      req.log?.error?.({ err }, "Failed to list statements");
      res.status(500).json({ error: "Failed to load statements" });
    }
  });

  router.get("/:file", requirePayoutsRead(), async (req, res) => {
    const file = String(req.params.file ?? "");
    const m = /^(.+?)(?:\.(csv|pdf))?$/.exec(file);
    const monthParam = m?.[1] ?? file;
    const ext = (m?.[2] ?? "json") as "json" | "csv" | "pdf";
    const sellerId = sellerIdOf(req);
    try {
      parseMonth(monthParam, deps.now());
      const accountId = await deps.getStripeAccount(sellerId);
      if (!accountId) { sendNotConnected(res); return; }
      const statement = await load(sellerId, accountId, monthParam);
      const base = `brandthread-statement-${monthParam}`;
      res.setHeader("Cache-Control", "private, no-store");
      if (ext === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${base}.csv"`);
        res.send(statementToCsv(statement));
      } else if (ext === "pdf") {
        const pdf = await renderStatementPdf(statement, { sellerName: await deps.sellerName(sellerId), generatedAt: deps.now() });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${base}.pdf"`);
        res.setHeader("Content-Length", String(pdf.length));
        res.end(pdf);
      } else {
        res.json(statement);
      }
    } catch (err: any) {
      if (err instanceof StatementError) {
        res.status(400).json({ error: err.message, code: err.code });
        return;
      }
      if (err instanceof StatementReconciliationError) {
        req.log?.error?.({ err }, "Statement failed to reconcile");
        res.status(500).json({ error: "Statement could not be reconciled", code: "RECONCILIATION_FAILED" });
        return;
      }
      req.log?.error?.({ err }, "Failed to generate statement");
      res.status(500).json({ error: "Failed to generate statement" });
    }
  });

  return router;
}

export default createStatementsRouter();
