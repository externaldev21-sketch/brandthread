import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { getEffectiveEntitlement } from "../nativeEntitlements";
import { logger } from "../logger";
import { LOW_CREDITS_FRACTION, creditPolicyForPlan, getSpendCaps, type AiCreditPlan } from "./catalogue";
import { raiseSpendAlerts } from "./alerts";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const GLOBAL_SCOPE = "*";

export type AccountSnapshot = {
  plan: AiCreditPlan;
  /** Pro: no balance concept. */
  unlimited: boolean;
  rolloverBalance: number;
  monthlyBalance: number;
  purchasedBalance: number;
  /** Everything spendable now. 0 for unlimited accounts (callers must check `unlimited`). */
  balance: number;
  /** null when unlimited. */
  monthlyAllowance: number | null;
  resetsAt: string;
  /** 20% of the allowance; `balance` at or below it counts as low. */
  lowCreditsThreshold: number;
  isLow: boolean;
  packsEligible: boolean;
};

export type DebitFailure = "insufficient_credits" | "global_daily_cap" | "rate_limited";

export type DebitResult =
  | { ok: true; entryId: string; balance: number; unlimited: boolean; lowPriority: boolean }
  | { ok: false; reason: DebitFailure; balance: number };

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
    // Entitlement lookup must never block the user; fall back to no plan.
    logger.warn({ err }, "AI credits: plan lookup failed, treating as no plan");
    return "free";
  }
}

type AccountRow = {
  rollover_balance: number; monthly_balance: number; purchased_balance: number;
  monthly_allowance: number; monthly_period: string;
};

async function ledgerRow(tx: Tx, userId: string, r: {
  kind: string; monthly?: number; rollover?: number; purchased?: number; balanceAfter: number; reference?: string | null;
}): Promise<void> {
  const monthly = r.monthly ?? 0, rollover = r.rollover ?? 0, purchased = r.purchased ?? 0;
  await tx.execute(sql`INSERT INTO ai_credit_ledger (clerk_user_id, kind, delta, monthly_delta, rollover_delta, purchased_delta, balance_after, reference)
    VALUES (${userId}, ${r.kind}, ${monthly + rollover + purchased}, ${monthly}, ${rollover}, ${purchased}, ${r.balanceAfter}, ${r.reference ?? null})`);
}

/**
 * Locks (creating if needed) the user's account row and applies the monthly
 * roll. New period: last period's rollover expires, the monthly leftover moves
 * to rollover (capped at one allowance, Starter/Growth only) and a fresh
 * allowance is granted, so rollover + monthly never exceeds 2x the allowance.
 * A mid-month upgrade tops the monthly bucket up by the difference.
 * `allowance` null (Pro) leaves the buckets untouched.
 */
async function lockAccount(tx: Tx, userId: string, plan: AiCreditPlan, now: Date): Promise<AccountRow> {
  const policy = creditPolicyForPlan(plan);
  const allowance = policy.monthlyAllowance;
  const period = currentPeriod(now);
  await tx.execute(sql`INSERT INTO ai_credit_accounts (clerk_user_id) VALUES (${userId}) ON CONFLICT DO NOTHING`);
  const res = await tx.execute(sql`SELECT rollover_balance, monthly_balance, purchased_balance, monthly_allowance, monthly_period
    FROM ai_credit_accounts WHERE clerk_user_id = ${userId} FOR UPDATE`);
  let row = res.rows[0] as AccountRow;
  if (allowance === null) return row;

  if (row.monthly_period !== period) {
    const newRollover = policy.rollover ? Math.min(row.monthly_balance, allowance) : 0;
    let running = row.rollover_balance + row.monthly_balance + row.purchased_balance;
    if (row.rollover_balance > 0) {
      running -= row.rollover_balance;
      await ledgerRow(tx, userId, { kind: "rollover_expire", rollover: -row.rollover_balance, balanceAfter: running, reference: row.monthly_period });
    }
    if (newRollover > 0) {
      // Moves credits between buckets; the total does not change.
      await ledgerRow(tx, userId, { kind: "rollover", monthly: -newRollover, rollover: newRollover, balanceAfter: running, reference: period });
    }
    const expired = row.monthly_balance - newRollover;
    if (expired > 0) {
      running -= expired;
      await ledgerRow(tx, userId, { kind: "monthly_expire", monthly: -expired, balanceAfter: running, reference: row.monthly_period });
    }
    if (allowance > 0) {
      running += allowance;
      await ledgerRow(tx, userId, { kind: "monthly_grant", monthly: allowance, balanceAfter: running, reference: period });
    }
    await tx.execute(sql`UPDATE ai_credit_accounts SET rollover_balance = ${newRollover}, monthly_balance = ${allowance},
      monthly_allowance = ${allowance}, monthly_period = ${period}, updated_at = NOW() WHERE clerk_user_id = ${userId}`);
    row = { ...row, rollover_balance: newRollover, monthly_balance: allowance, monthly_allowance: allowance, monthly_period: period };
  } else if (allowance > row.monthly_allowance) {
    const topUp = allowance - row.monthly_allowance;
    await ledgerRow(tx, userId, {
      kind: "monthly_grant", monthly: topUp,
      balanceAfter: row.rollover_balance + row.monthly_balance + topUp + row.purchased_balance, reference: `${period}:upgrade`,
    });
    await tx.execute(sql`UPDATE ai_credit_accounts SET monthly_balance = monthly_balance + ${topUp},
      monthly_allowance = ${allowance}, updated_at = NOW() WHERE clerk_user_id = ${userId}`);
    row = { ...row, monthly_balance: row.monthly_balance + topUp, monthly_allowance: allowance };
  }
  return row;
}

function snapshotOf(plan: AiCreditPlan, row: AccountRow | null, now: Date): AccountSnapshot {
  const policy = creditPolicyForPlan(plan);
  const allowance = policy.monthlyAllowance;
  const unlimited = allowance === null;
  const rollover = row?.rollover_balance ?? 0;
  const monthly = row?.monthly_balance ?? 0;
  const purchased = row?.purchased_balance ?? 0;
  const balance = unlimited ? 0 : rollover + monthly + purchased;
  const threshold = unlimited ? 0 : Math.floor((allowance ?? 0) * LOW_CREDITS_FRACTION);
  return {
    plan, unlimited,
    rolloverBalance: unlimited ? 0 : rollover,
    monthlyBalance: unlimited ? 0 : monthly,
    purchasedBalance: unlimited ? 0 : purchased,
    balance,
    monthlyAllowance: allowance,
    resetsAt: nextPeriodStart(now),
    lowCreditsThreshold: threshold,
    isLow: !unlimited && balance <= threshold,
    packsEligible: policy.packsEligible,
  };
}

export async function getAccount(clerkUserId: string, now = new Date()): Promise<AccountSnapshot> {
  const plan = await resolvePlan(clerkUserId);
  if (creditPolicyForPlan(plan).monthlyAllowance === null) return snapshotOf(plan, null, now);
  const row = await db.transaction((tx) => lockAccount(tx, clerkUserId, plan, now));
  return snapshotOf(plan, row, now);
}

type UsageRow = { period: string; credits_used: number; day: string; generations_today: number };

/**
 * Atomically reserves `cost` credits for one tool call.
 *  - Starter / Growth / no plan: spends rollover, then monthly, then purchased
 *    credits. There is no per-user daily cap; only the balance and the global
 *    emergency cap apply.
 *  - Pro: never blocked by balance. Usage is tracked for the hidden fair-use
 *    queue and a hidden per-day generation ceiling.
 * Everything happens in one transaction, so concurrent requests can never
 * overspend a balance or the cap.
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
  const unlimited = creditPolicyForPlan(plan).monthlyAllowance === null;
  const caps = getSpendCaps();
  const day = currentDay(now);
  const period = currentPeriod(now);

  const result = await db.transaction(async (tx): Promise<DebitResult & { globalSpent?: number }> => {
    const acct = await lockAccount(tx, clerkUserId, plan, now);
    const total = unlimited ? 0 : acct.rollover_balance + acct.monthly_balance + acct.purchased_balance;

    let usage: UsageRow | null = null;
    if (unlimited) {
      await tx.execute(sql`INSERT INTO ai_pro_usage (clerk_user_id) VALUES (${clerkUserId}) ON CONFLICT DO NOTHING`);
      usage = (await tx.execute(sql`SELECT period, credits_used, day, generations_today FROM ai_pro_usage
        WHERE clerk_user_id = ${clerkUserId} FOR UPDATE`)).rows[0] as UsageRow;
      if (usage.period !== period) usage = { ...usage, period, credits_used: 0 };
      if (usage.day !== day) usage = { ...usage, day, generations_today: 0 };
      if (usage.generations_today + 1 > caps.proDailyGenerations) return { ok: false, reason: "rate_limited", balance: 0 };
    }

    // Fixed lock order (account -> usage -> global counter) avoids deadlocks.
    await tx.execute(sql`INSERT INTO ai_spend_daily (day, clerk_user_id, spent) VALUES (${day}, ${GLOBAL_SCOPE}, 0) ON CONFLICT DO NOTHING`);
    const globalRow = (await tx.execute(sql`SELECT spent FROM ai_spend_daily WHERE day = ${day} AND clerk_user_id = ${GLOBAL_SCOPE} FOR UPDATE`)).rows[0] as { spent: number };
    if (globalRow.spent + cost > caps.globalDaily) return { ok: false, reason: "global_daily_cap", balance: total, globalSpent: globalRow.spent };

    const entryId = randomUUID();
    if (unlimited) {
      const lowPriority = usage!.credits_used >= caps.proFairUseCredits;
      await tx.execute(sql`UPDATE ai_pro_usage SET period = ${period}, credits_used = ${usage!.credits_used + cost},
        day = ${day}, generations_today = ${usage!.generations_today + 1}, updated_at = NOW() WHERE clerk_user_id = ${clerkUserId}`);
      await tx.execute(sql`UPDATE ai_spend_daily SET spent = spent + ${cost} WHERE day = ${day} AND clerk_user_id = ${GLOBAL_SCOPE}`);
      await tx.execute(sql`INSERT INTO ai_credit_ledger (id, clerk_user_id, kind, delta, tool_key, balance_after, meta)
        VALUES (${entryId}, ${clerkUserId}, 'usage', 0, ${toolKey}, 0, ${JSON.stringify({ day, period, cost })}::jsonb)`);
      return { ok: true, entryId, balance: 0, unlimited: true, lowPriority, globalSpent: globalRow.spent + cost };
    }

    if (total < cost) return { ok: false, reason: "insufficient_credits", balance: total };
    const fromRollover = Math.min(acct.rollover_balance, cost);
    const fromMonthly = Math.min(acct.monthly_balance, cost - fromRollover);
    const fromPurchased = cost - fromRollover - fromMonthly;
    await tx.execute(sql`UPDATE ai_credit_accounts SET rollover_balance = rollover_balance - ${fromRollover},
      monthly_balance = monthly_balance - ${fromMonthly}, purchased_balance = purchased_balance - ${fromPurchased},
      updated_at = NOW() WHERE clerk_user_id = ${clerkUserId}`);
    await tx.execute(sql`UPDATE ai_spend_daily SET spent = spent + ${cost} WHERE day = ${day} AND clerk_user_id = ${GLOBAL_SCOPE}`);
    await tx.execute(sql`INSERT INTO ai_credit_ledger (id, clerk_user_id, kind, delta, tool_key, rollover_delta, monthly_delta, purchased_delta, balance_after, meta)
      VALUES (${entryId}, ${clerkUserId}, 'debit', ${-cost}, ${toolKey}, ${-fromRollover}, ${-fromMonthly}, ${-fromPurchased}, ${total - cost}, ${JSON.stringify({ day })}::jsonb)`);
    return { ok: true, entryId, balance: total - cost, unlimited: false, lowPriority: false, globalSpent: globalRow.spent + cost };
  });

  if (result.ok || result.reason === "global_daily_cap") {
    // Alerting is best effort and must never fail the request.
    void raiseSpendAlerts({
      day,
      clerkUserId,
      globalSpent: result.globalSpent,
      blocked: result.ok ? null : "global_daily_cap",
    }).catch((err) => logger.warn({ err }, "AI spend alert failed"));
  }
  const { globalSpent: _g, ...publicResult } = result;
  return publicResult as DebitResult;
}

/** Gives a debit back (same buckets, same spend counters). Safe to call twice. */
export async function refundDebit(entryId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const found = await tx.execute(sql`SELECT clerk_user_id, kind, delta, rollover_delta, monthly_delta, purchased_delta, tool_key, meta
      FROM ai_credit_ledger WHERE id = ${entryId} AND kind IN ('debit', 'usage')`);
    const debit = found.rows[0] as undefined | {
      clerk_user_id: string; kind: "debit" | "usage"; delta: number; rollover_delta: number; monthly_delta: number;
      purchased_delta: number; tool_key: string | null; meta: { day?: string; period?: string; cost?: number } | null;
    };
    if (!debit) return false;

    if (debit.kind === "usage") {
      const inserted = await tx.execute(sql`INSERT INTO ai_credit_ledger (clerk_user_id, kind, delta, tool_key, reference, idempotency_key)
        VALUES (${debit.clerk_user_id}, 'usage_refund', 0, ${debit.tool_key}, ${entryId}, ${`refund:${entryId}`})
        ON CONFLICT DO NOTHING RETURNING id`);
      if (inserted.rows.length === 0) return false;
      const cost = debit.meta?.cost ?? 0;
      const day = debit.meta?.day ?? currentDay();
      await tx.execute(sql`UPDATE ai_pro_usage SET
          credits_used = CASE WHEN period = ${debit.meta?.period ?? currentPeriod()} THEN GREATEST(0, credits_used - ${cost}) ELSE credits_used END,
          generations_today = CASE WHEN day = ${day} THEN GREATEST(0, generations_today - 1) ELSE generations_today END,
          updated_at = NOW()
        WHERE clerk_user_id = ${debit.clerk_user_id}`);
      await tx.execute(sql`UPDATE ai_spend_daily SET spent = GREATEST(0, spent - ${cost}) WHERE day = ${day} AND clerk_user_id = ${GLOBAL_SCOPE}`);
      return true;
    }

    const inserted = await tx.execute(sql`INSERT INTO ai_credit_ledger (clerk_user_id, kind, delta, tool_key, reference, idempotency_key, rollover_delta, monthly_delta, purchased_delta)
      VALUES (${debit.clerk_user_id}, 'refund', ${-debit.delta}, ${debit.tool_key}, ${entryId}, ${`refund:${entryId}`}, ${-debit.rollover_delta}, ${-debit.monthly_delta}, ${-debit.purchased_delta})
      ON CONFLICT DO NOTHING RETURNING id`);
    if (inserted.rows.length === 0) return false;
    // Monthly / rollover credits from a past period have expired; only same-period refunds go back to them.
    const acct = await tx.execute(sql`SELECT monthly_period FROM ai_credit_accounts WHERE clerk_user_id = ${debit.clerk_user_id} FOR UPDATE`);
    const samePeriod = (acct.rows[0] as { monthly_period: string } | undefined)?.monthly_period === (debit.meta?.day ?? currentDay()).slice(0, 7);
    const rolloverBack = samePeriod ? -debit.rollover_delta : 0;
    const monthlyBack = samePeriod ? -debit.monthly_delta : 0;
    const purchasedBack = -debit.purchased_delta;
    await tx.execute(sql`UPDATE ai_credit_accounts SET rollover_balance = rollover_balance + ${rolloverBack},
      monthly_balance = monthly_balance + ${monthlyBack}, purchased_balance = purchased_balance + ${purchasedBack},
      updated_at = NOW() WHERE clerk_user_id = ${debit.clerk_user_id}`);
    const day = debit.meta?.day ?? currentDay();
    await tx.execute(sql`UPDATE ai_spend_daily SET spent = GREATEST(0, spent - ${-debit.delta})
      WHERE day = ${day} AND clerk_user_id = ${GLOBAL_SCOPE}`);
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
    const acct = await lockAccount(tx, input.clerkUserId, plan, new Date());
    const inserted = await tx.execute(sql`INSERT INTO ai_credit_ledger (clerk_user_id, kind, delta, reference, idempotency_key, purchased_delta, balance_after, meta)
      VALUES (${input.clerkUserId}, 'pack_purchase', ${input.credits}, ${input.reference ?? null}, ${input.idempotencyKey}, ${input.credits},
        ${acct.rollover_balance + acct.monthly_balance + acct.purchased_balance + input.credits}, ${JSON.stringify(input.meta ?? {})}::jsonb)
      ON CONFLICT DO NOTHING RETURNING id`);
    if (inserted.rows.length === 0) return { granted: false };
    await tx.execute(sql`UPDATE ai_credit_accounts SET purchased_balance = purchased_balance + ${input.credits}, updated_at = NOW()
      WHERE clerk_user_id = ${input.clerkUserId}`);
    return { granted: true };
  });
}

/**
 * Silent anti-abuse ceiling for free text requests (chat). Counts every call
 * and answers false once the user passes the configured per-day limit.
 */
export async function allowTextRequest(clerkUserId: string, now = new Date()): Promise<boolean> {
  const limit = getSpendCaps().textDailyPerUser;
  const res = await db.execute(sql`INSERT INTO ai_spend_daily (day, clerk_user_id, spent) VALUES (${currentDay(now)}, ${`text:${clerkUserId}`}, 1)
    ON CONFLICT (day, clerk_user_id) DO UPDATE SET spent = ai_spend_daily.spent + 1 RETURNING spent`);
  return ((res.rows[0] as { spent: number }).spent) <= limit;
}

export type LedgerEntry = {
  id: string; kind: string; delta: number; toolKey: string | null; balanceAfter: number; createdAt: string;
};

/** Newest first. A 'rollover' row reports the credits carried over (its net effect on the total is zero). Pro usage rows are never listed. */
export async function listHistory(clerkUserId: string, opts: { limit?: number; before?: string } = {}): Promise<{ entries: LedgerEntry[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const before = opts.before && !Number.isNaN(Date.parse(opts.before)) ? opts.before : null;
  const res = await db.execute(sql`SELECT id, kind, CASE WHEN kind = 'rollover' THEN rollover_delta ELSE delta END AS delta, tool_key, balance_after, created_at FROM ai_credit_ledger
    WHERE clerk_user_id = ${clerkUserId} AND kind NOT IN ('usage', 'usage_refund') ${before ? sql`AND created_at < ${before}` : sql``}
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
