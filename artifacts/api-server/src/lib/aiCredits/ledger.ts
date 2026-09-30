import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { getEffectiveEntitlement } from "../nativeEntitlements";
import { logger } from "../logger";
import { MONTHLY_ALLOWANCE, getSpendCaps, type AiCreditPlan } from "./catalogue";
import { raiseSpendAlerts } from "./alerts";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const GLOBAL_SCOPE = "*";

export type AccountSnapshot = {
  monthlyBalance: number;
  purchasedBalance: number;
  balance: number;
  monthlyAllowance: number;
  plan: AiCreditPlan;
  resetsAt: string;
};

export type DebitResult =
  | { ok: true; entryId: string; balance: number }
  | { ok: false; reason: "insufficient_credits" | "user_daily_cap" | "global_daily_cap"; balance: number };

export function currentPeriod(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}
export function currentDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
function nextPeriodStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

export async function resolvePlan(clerkUserId: string): Promise<AiCreditPlan> {
  try {
    const ent = await getEffectiveEntitlement(clerkUserId);
    return ent.provider === "none" ? "free" : ent.planId;
  } catch (err) {
    // Entitlement lookup must never block credits; fall back to the free tier.
    logger.warn({ err }, "AI credits: plan lookup failed, using free allowance");
    return "free";
  }
}

type AccountRow = { monthly_balance: number; purchased_balance: number; monthly_allowance: number; monthly_period: string };

/**
 * Locks (creating if needed) the user's account row and applies the monthly
 * grant: a new period expires what is left and grants the full allowance; a
 * mid-month upgrade tops the balance up by the difference.
 */
async function lockAccount(tx: Tx, userId: string, allowance: number, now: Date): Promise<AccountRow> {
  const period = currentPeriod(now);
  await tx.execute(sql`INSERT INTO ai_credit_accounts (clerk_user_id) VALUES (${userId}) ON CONFLICT DO NOTHING`);
  const res = await tx.execute(sql`SELECT monthly_balance, purchased_balance, monthly_allowance, monthly_period
    FROM ai_credit_accounts WHERE clerk_user_id = ${userId} FOR UPDATE`);
  let row = res.rows[0] as AccountRow;

  if (row.monthly_period !== period) {
    const expired = row.monthly_balance;
    if (expired > 0) {
      await tx.execute(sql`INSERT INTO ai_credit_ledger (clerk_user_id, kind, delta, monthly_delta, balance_after, reference)
        VALUES (${userId}, 'monthly_expire', ${-expired}, ${-expired}, ${row.purchased_balance}, ${row.monthly_period})`);
    }
    await tx.execute(sql`INSERT INTO ai_credit_ledger (clerk_user_id, kind, delta, monthly_delta, balance_after, reference)
      VALUES (${userId}, 'monthly_grant', ${allowance}, ${allowance}, ${row.purchased_balance + allowance}, ${period})`);
    await tx.execute(sql`UPDATE ai_credit_accounts SET monthly_balance = ${allowance}, monthly_allowance = ${allowance},
      monthly_period = ${period}, updated_at = NOW() WHERE clerk_user_id = ${userId}`);
    row = { ...row, monthly_balance: allowance, monthly_allowance: allowance, monthly_period: period };
  } else if (allowance > row.monthly_allowance) {
    const topUp = allowance - row.monthly_allowance;
    await tx.execute(sql`INSERT INTO ai_credit_ledger (clerk_user_id, kind, delta, monthly_delta, balance_after, reference)
      VALUES (${userId}, 'monthly_grant', ${topUp}, ${topUp}, ${row.monthly_balance + topUp + row.purchased_balance}, ${`${period}:upgrade`})`);
    await tx.execute(sql`UPDATE ai_credit_accounts SET monthly_balance = monthly_balance + ${topUp},
      monthly_allowance = ${allowance}, updated_at = NOW() WHERE clerk_user_id = ${userId}`);
    row = { ...row, monthly_balance: row.monthly_balance + topUp, monthly_allowance: allowance };
  }
  return row;
}

export async function getAccount(clerkUserId: string, now = new Date()): Promise<AccountSnapshot> {
  const plan = await resolvePlan(clerkUserId);
  const allowance = MONTHLY_ALLOWANCE[plan];
  const row = await db.transaction((tx) => lockAccount(tx, clerkUserId, allowance, now));
  return {
    monthlyBalance: row.monthly_balance,
    purchasedBalance: row.purchased_balance,
    balance: row.monthly_balance + row.purchased_balance,
    monthlyAllowance: row.monthly_allowance,
    plan,
    resetsAt: nextPeriodStart(now),
  };
}

/**
 * Atomically reserves `cost` credits for one tool call. Enforces the per-user
 * and global daily caps in the same transaction as the debit, so concurrent
 * requests can never overspend either the balance or a cap.
 */
export async function debitCredits(input: {
  clerkUserId: string;
  cost: number;
  toolKey: string;
  now?: Date;
}): Promise<DebitResult> {
  const { clerkUserId, cost, toolKey } = input;
  const now = input.now ?? new Date();
  if (!Number.isInteger(cost) || cost <= 0) throw new Error("AI credit cost must be a positive integer");
  const plan = await resolvePlan(clerkUserId);
  const caps = getSpendCaps();
  const day = currentDay(now);

  const result = await db.transaction(async (tx): Promise<DebitResult & { userSpent?: number; globalSpent?: number }> => {
    const acct = await lockAccount(tx, clerkUserId, MONTHLY_ALLOWANCE[plan], now);
    const total = acct.monthly_balance + acct.purchased_balance;

    await tx.execute(sql`INSERT INTO ai_spend_daily (day, clerk_user_id, spent) VALUES (${day}, ${clerkUserId}, 0) ON CONFLICT DO NOTHING`);
    await tx.execute(sql`INSERT INTO ai_spend_daily (day, clerk_user_id, spent) VALUES (${day}, ${GLOBAL_SCOPE}, 0) ON CONFLICT DO NOTHING`);
    // Fixed lock order (account -> user counter -> global counter) avoids deadlocks.
    const userRow = (await tx.execute(sql`SELECT spent FROM ai_spend_daily WHERE day = ${day} AND clerk_user_id = ${clerkUserId} FOR UPDATE`)).rows[0] as { spent: number };
    const globalRow = (await tx.execute(sql`SELECT spent FROM ai_spend_daily WHERE day = ${day} AND clerk_user_id = ${GLOBAL_SCOPE} FOR UPDATE`)).rows[0] as { spent: number };

    if (userRow.spent + cost > caps.perUserDaily) return { ok: false, reason: "user_daily_cap", balance: total, userSpent: userRow.spent };
    if (globalRow.spent + cost > caps.globalDaily) return { ok: false, reason: "global_daily_cap", balance: total, globalSpent: globalRow.spent };
    if (total < cost) return { ok: false, reason: "insufficient_credits", balance: total };

    const fromMonthly = Math.min(acct.monthly_balance, cost);
    const fromPurchased = cost - fromMonthly;
    const entryId = randomUUID();
    await tx.execute(sql`UPDATE ai_credit_accounts SET monthly_balance = monthly_balance - ${fromMonthly},
      purchased_balance = purchased_balance - ${fromPurchased}, updated_at = NOW() WHERE clerk_user_id = ${clerkUserId}`);
    await tx.execute(sql`UPDATE ai_spend_daily SET spent = spent + ${cost} WHERE day = ${day} AND clerk_user_id IN (${clerkUserId}, ${GLOBAL_SCOPE})`);
    await tx.execute(sql`INSERT INTO ai_credit_ledger (id, clerk_user_id, kind, delta, tool_key, monthly_delta, purchased_delta, balance_after, meta)
      VALUES (${entryId}, ${clerkUserId}, 'debit', ${-cost}, ${toolKey}, ${-fromMonthly}, ${-fromPurchased}, ${total - cost}, ${JSON.stringify({ day })}::jsonb)`);
    return { ok: true, entryId, balance: total - cost, userSpent: userRow.spent + cost, globalSpent: globalRow.spent + cost };
  });

  if (result.ok || result.reason !== "insufficient_credits") {
    // Alerting is best effort and must never fail the request.
    void raiseSpendAlerts({
      day,
      clerkUserId,
      userSpent: result.userSpent,
      globalSpent: result.globalSpent,
      blocked: result.ok ? null : result.reason,
    }).catch((err) => logger.warn({ err }, "AI spend alert failed"));
  }
  const { userSpent: _u, globalSpent: _g, ...publicResult } = result;
  return publicResult as DebitResult;
}

/** Gives a debit back (same buckets, same spend counters). Safe to call twice. */
export async function refundDebit(entryId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const found = await tx.execute(sql`SELECT clerk_user_id, delta, monthly_delta, purchased_delta, tool_key, meta
      FROM ai_credit_ledger WHERE id = ${entryId} AND kind = 'debit'`);
    const debit = found.rows[0] as undefined | {
      clerk_user_id: string; delta: number; monthly_delta: number; purchased_delta: number; tool_key: string | null; meta: { day?: string } | null;
    };
    if (!debit) return false;
    const inserted = await tx.execute(sql`INSERT INTO ai_credit_ledger (clerk_user_id, kind, delta, tool_key, reference, idempotency_key, monthly_delta, purchased_delta)
      VALUES (${debit.clerk_user_id}, 'refund', ${-debit.delta}, ${debit.tool_key}, ${entryId}, ${`refund:${entryId}`}, ${-debit.monthly_delta}, ${-debit.purchased_delta})
      ON CONFLICT DO NOTHING RETURNING id`);
    if (inserted.rows.length === 0) return false;
    // A refund to the monthly bucket from a past period is dropped: that credit has expired.
    const acct = await tx.execute(sql`SELECT monthly_period FROM ai_credit_accounts WHERE clerk_user_id = ${debit.clerk_user_id} FOR UPDATE`);
    const samePeriod = (acct.rows[0] as { monthly_period: string } | undefined)?.monthly_period === currentPeriod();
    const monthlyBack = samePeriod ? -debit.monthly_delta : 0;
    const purchasedBack = -debit.purchased_delta;
    await tx.execute(sql`UPDATE ai_credit_accounts SET monthly_balance = monthly_balance + ${monthlyBack},
      purchased_balance = purchased_balance + ${purchasedBack}, updated_at = NOW() WHERE clerk_user_id = ${debit.clerk_user_id}`);
    const day = debit.meta?.day ?? currentDay();
    await tx.execute(sql`UPDATE ai_spend_daily SET spent = GREATEST(0, spent - ${-debit.delta})
      WHERE day = ${day} AND clerk_user_id IN (${debit.clerk_user_id}, ${GLOBAL_SCOPE})`);
    return true;
  });
}

/** Adds purchased credits. `idempotencyKey` makes payment retries and webhooks harmless. */
export async function grantPurchasedCredits(input: {
  clerkUserId: string;
  credits: number;
  idempotencyKey: string;
  reference?: string;
  meta?: Record<string, unknown>;
}): Promise<{ granted: boolean }> {
  const plan = await resolvePlan(input.clerkUserId);
  return db.transaction(async (tx) => {
    const acct = await lockAccount(tx, input.clerkUserId, MONTHLY_ALLOWANCE[plan], new Date());
    const inserted = await tx.execute(sql`INSERT INTO ai_credit_ledger (clerk_user_id, kind, delta, reference, idempotency_key, purchased_delta, balance_after, meta)
      VALUES (${input.clerkUserId}, 'pack_purchase', ${input.credits}, ${input.reference ?? null}, ${input.idempotencyKey}, ${input.credits},
        ${acct.monthly_balance + acct.purchased_balance + input.credits}, ${JSON.stringify(input.meta ?? {})}::jsonb)
      ON CONFLICT DO NOTHING RETURNING id`);
    if (inserted.rows.length === 0) return { granted: false };
    await tx.execute(sql`UPDATE ai_credit_accounts SET purchased_balance = purchased_balance + ${input.credits}, updated_at = NOW()
      WHERE clerk_user_id = ${input.clerkUserId}`);
    return { granted: true };
  });
}

export type LedgerEntry = {
  id: string; kind: string; delta: number; toolKey: string | null; balanceAfter: number; createdAt: string;
};

/** Newest first. Expiry/grant bookkeeping rows are included so the list reconciles with the balance. */
export async function listHistory(clerkUserId: string, opts: { limit?: number; before?: string } = {}): Promise<{ entries: LedgerEntry[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const before = opts.before && !Number.isNaN(Date.parse(opts.before)) ? opts.before : null;
  const res = await db.execute(sql`SELECT id, kind, delta, tool_key, balance_after, created_at FROM ai_credit_ledger
    WHERE clerk_user_id = ${clerkUserId} ${before ? sql`AND created_at < ${before}` : sql``}
    ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}`);
  const rows = res.rows as Array<{ id: string; kind: string; delta: number; tool_key: string | null; balance_after: number; created_at: Date }>;
  const page = rows.slice(0, limit);
  return {
    entries: page.map((r) => ({
      id: r.id, kind: r.kind, delta: r.delta, toolKey: r.tool_key, balanceAfter: r.balance_after,
      createdAt: new Date(r.created_at).toISOString(),
    })),
    nextCursor: rows.length > limit ? new Date(page[page.length - 1]!.created_at).toISOString() : null,
  };
}
