import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { getEffectiveEntitlement } from "../nativeEntitlements";
import { logger } from "../logger";
import { LOW_CREDITS_FRACTION, creditPolicyForPlan, getSpendCaps, trialAllowance, type AiCreditPlan } from "./catalogue";
import { raiseSpendAlerts } from "./alerts";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const GLOBAL_SCOPE = "*";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Where a subscription is in its billing life. Only 'paid' (an invoice has
 * been paid for the current period) earns the full monthly allowance.
 */
export type AiBillingState = "paid" | "trial" | "past_due";

export type AiAccess = { plan: AiCreditPlan; billing: AiBillingState };

export type AccountSnapshot = {
  plan: AiCreditPlan;
  billing: AiBillingState;
  /** Always false: no plan is unlimited. Kept for API compatibility. */
  unlimited: boolean;
  rolloverBalance: number;
  monthlyBalance: number;
  purchasedBalance: number;
  /** Everything spendable now. */
  balance: number;
  /** This month's allowance (reduced while trialing or past due). */
  monthlyAllowance: number;
  resetsAt: string;
  /** 20% of the allowance; `balance` at or below it counts as low. */
  lowCreditsThreshold: number;
  isLow: boolean;
  packsEligible: boolean;
};

export type DebitFailure = "insufficient_credits" | "global_daily_cap" | "rate_limited" | "billing_issue";

export type DebitResult =
  | { ok: true; entryId: string; balance: number; unlimited: boolean; lowPriority: boolean }
  | { ok: false; reason: DebitFailure; balance: number };

export type MeterResult =
  | { ok: true; entryId: string }
  | { ok: false; reason: "rate_limited" | "global_daily_cap" };

export function currentPeriod(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}
export function currentDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
function nextPeriodStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

/** Stripe 'trialing' / store 'trial' are trials; Stripe 'past_due' / store 'grace' are past due. */
export function billingStateOf(status: string | null | undefined): AiBillingState {
  const s = (status ?? "").toLowerCase();
  if (s === "trial" || s === "trialing") return "trial";
  if (s === "past_due" || s === "grace") return "past_due";
  return "paid";
}

export async function resolveAccess(clerkUserId: string): Promise<AiAccess> {
  try {
    const ent = await getEffectiveEntitlement(clerkUserId);
    if (ent.provider === "none") return { plan: "free", billing: "paid" };
    return { plan: ent.planId, billing: billingStateOf(ent.status) };
  } catch (err) {
    // Entitlement lookup must never block the user; fall back to no plan.
    logger.warn({ err }, "AI credits: plan lookup failed, treating as no plan");
    return { plan: "free", billing: "paid" };
  }
}

export async function resolvePlan(clerkUserId: string): Promise<AiCreditPlan> {
  return (await resolveAccess(clerkUserId)).plan;
}

type AccountRow = {
  rollover_balance: number; monthly_balance: number; purchased_balance: number;
  monthly_allowance: number; monthly_period: string; billing_issue_since: Date | string | null;
};

type LockedAccount = {
  row: AccountRow;
  allowance: number;
  /** Past due beyond the grace period: AI tools are off until a payment succeeds. */
  blocked: boolean;
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
 * to rollover (capped at one allowance, paid Starter/Growth/Pro only) and a
 * fresh allowance is granted, so rollover + monthly never exceeds 2x the
 * allowance. A raised allowance mid-month (upgrade, or the first paid invoice
 * after a trial) tops the monthly bucket up by the difference.
 *
 * Trials and past-due subscriptions get the reduced trialAllowance(). A
 * past-due subscription keeps it for AI_PAST_DUE_GRACE_DAYS from the first time
 * it is seen past due, then is blocked (and earns nothing new) until paid.
 */
async function lockAccount(tx: Tx, userId: string, access: AiAccess, now: Date): Promise<LockedAccount> {
  const policy = creditPolicyForPlan(access.plan);
  const period = currentPeriod(now);
  await tx.execute(sql`INSERT INTO ai_credit_accounts (clerk_user_id) VALUES (${userId}) ON CONFLICT DO NOTHING`);
  const res = await tx.execute(sql`SELECT rollover_balance, monthly_balance, purchased_balance, monthly_allowance, monthly_period, billing_issue_since
    FROM ai_credit_accounts WHERE clerk_user_id = ${userId} FOR UPDATE`);
  let row = res.rows[0] as AccountRow;

  let blocked = false;
  if (access.billing === "past_due") {
    let since = row.billing_issue_since ? new Date(row.billing_issue_since) : null;
    if (!since) {
      since = now;
      await tx.execute(sql`UPDATE ai_credit_accounts SET billing_issue_since = ${now.toISOString()}::timestamptz WHERE clerk_user_id = ${userId}`);
      row = { ...row, billing_issue_since: now };
    }
    blocked = now.valueOf() - since.valueOf() >= getSpendCaps().pastDueGraceDays * DAY_MS;
  } else if (row.billing_issue_since) {
    await tx.execute(sql`UPDATE ai_credit_accounts SET billing_issue_since = NULL WHERE clerk_user_id = ${userId}`);
    row = { ...row, billing_issue_since: null };
  }

  const allowance = blocked ? 0 : access.billing === "paid" ? policy.monthlyAllowance : trialAllowance(access.plan);
  const rollover = policy.rollover && access.billing === "paid";

  if (row.monthly_period !== period) {
    const newRollover = rollover ? Math.min(row.monthly_balance, allowance) : 0;
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
  return { row, allowance: Math.max(allowance, blocked ? 0 : row.monthly_allowance), blocked };
}

function snapshotOf(access: AiAccess, locked: LockedAccount, now: Date): AccountSnapshot {
  const policy = creditPolicyForPlan(access.plan);
  const { row, allowance } = locked;
  const balance = locked.blocked ? 0 : row.rollover_balance + row.monthly_balance + row.purchased_balance;
  const threshold = Math.floor(allowance * LOW_CREDITS_FRACTION);
  return {
    plan: access.plan,
    billing: access.billing,
    unlimited: false,
    rolloverBalance: locked.blocked ? 0 : row.rollover_balance,
    monthlyBalance: locked.blocked ? 0 : row.monthly_balance,
    purchasedBalance: locked.blocked ? 0 : row.purchased_balance,
    balance,
    monthlyAllowance: allowance,
    resetsAt: nextPeriodStart(now),
    lowCreditsThreshold: threshold,
    isLow: balance <= threshold,
    packsEligible: policy.packsEligible,
  };
}

export async function getAccount(clerkUserId: string, now = new Date()): Promise<AccountSnapshot> {
  const access = await resolveAccess(clerkUserId);
  const locked = await db.transaction((tx) => lockAccount(tx, clerkUserId, access, now));
  return snapshotOf(access, locked, now);
}

/** Per-user per-day counter row in ai_spend_daily, locked for the transaction. */
async function lockCounter(tx: Tx, day: string, key: string): Promise<number> {
  await tx.execute(sql`INSERT INTO ai_spend_daily (day, clerk_user_id, spent) VALUES (${day}, ${key}, 0) ON CONFLICT DO NOTHING`);
  const row = (await tx.execute(sql`SELECT spent FROM ai_spend_daily WHERE day = ${day} AND clerk_user_id = ${key} FOR UPDATE`)).rows[0] as { spent: number };
  return row.spent;
}

const generationCounterKey = (clerkUserId: string) => `gen:${clerkUserId}`;
const toolCounterKey = (toolKey: string, clerkUserId: string) => `tool:${toolKey}:${clerkUserId}`;

/**
 * Atomically reserves `cost` credits for one tool call of `units` generations
 * (a Mockup to Model run with 3 references is 3 units).
 *  - Spends rollover, then monthly, then purchased credits.
 *  - A per-user daily generation ceiling counts units (tighter while trialing
 *    or past due), and the global emergency cap counts credits.
 *  - A past-due subscription beyond its grace period is refused.
 * Everything happens in one transaction, so concurrent requests can never
 * overspend a balance, a ceiling or the cap.
 */
export async function debitCredits(input: {
  clerkUserId: string;
  cost: number;
  toolKey: string;
  units?: number;
  now?: Date;
}): Promise<DebitResult> {
  const { clerkUserId, cost, toolKey } = input;
  const units = input.units ?? 1;
  const now = input.now ?? new Date();
  if (!Number.isInteger(cost) || cost <= 0) throw new Error("AI credit cost must be a positive integer");
  if (!Number.isInteger(units) || units <= 0) throw new Error("AI credit units must be a positive integer");
  const access = await resolveAccess(clerkUserId);
  const caps = getSpendCaps();
  const day = currentDay(now);
  const ceiling = access.billing === "paid" ? caps.dailyGenerations : caps.trialDailyGenerations;

  const result = await db.transaction(async (tx): Promise<DebitResult & { globalSpent?: number }> => {
    // Fixed lock order (account -> user counter -> global counter) avoids deadlocks.
    const { row: acct, blocked } = await lockAccount(tx, clerkUserId, access, now);
    if (blocked) return { ok: false, reason: "billing_issue", balance: 0 };
    const total = acct.rollover_balance + acct.monthly_balance + acct.purchased_balance;
    if (total < cost) return { ok: false, reason: "insufficient_credits", balance: total };

    const genKey = generationCounterKey(clerkUserId);
    const generationsToday = await lockCounter(tx, day, genKey);
    if (generationsToday + units > ceiling) return { ok: false, reason: "rate_limited", balance: total };

    const globalSpent = await lockCounter(tx, day, GLOBAL_SCOPE);
    if (globalSpent + cost > caps.globalDaily) return { ok: false, reason: "global_daily_cap", balance: total, globalSpent };

    const entryId = randomUUID();
    const fromRollover = Math.min(acct.rollover_balance, cost);
    const fromMonthly = Math.min(acct.monthly_balance, cost - fromRollover);
    const fromPurchased = cost - fromRollover - fromMonthly;
    await tx.execute(sql`UPDATE ai_credit_accounts SET rollover_balance = rollover_balance - ${fromRollover},
      monthly_balance = monthly_balance - ${fromMonthly}, purchased_balance = purchased_balance - ${fromPurchased},
      updated_at = NOW() WHERE clerk_user_id = ${clerkUserId}`);
    await tx.execute(sql`UPDATE ai_spend_daily SET spent = spent + ${units} WHERE day = ${day} AND clerk_user_id = ${genKey}`);
    await tx.execute(sql`UPDATE ai_spend_daily SET spent = spent + ${cost} WHERE day = ${day} AND clerk_user_id = ${GLOBAL_SCOPE}`);
    await tx.execute(sql`INSERT INTO ai_credit_ledger (id, clerk_user_id, kind, delta, tool_key, rollover_delta, monthly_delta, purchased_delta, balance_after, meta)
      VALUES (${entryId}, ${clerkUserId}, 'debit', ${-cost}, ${toolKey}, ${-fromRollover}, ${-fromMonthly}, ${-fromPurchased}, ${total - cost}, ${JSON.stringify({ day, units })}::jsonb)`);
    return { ok: true, entryId, balance: total - cost, unlimited: false, lowPriority: false, globalSpent: globalSpent + cost };
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

/**
 * Records one call of a metered tool (free to the user): counts it toward the
 * user's daily ceiling for that tool and adds its credits-worth of provider
 * cost to the global emergency cap. Refunded like a debit if the call fails.
 */
export async function meterRequest(input: {
  clerkUserId: string;
  toolKey: string;
  cost: number;
  dailyLimit: number;
  now?: Date;
}): Promise<MeterResult> {
  const { clerkUserId, toolKey, cost, dailyLimit } = input;
  const now = input.now ?? new Date();
  const day = currentDay(now);
  const caps = getSpendCaps();
  const counter = toolCounterKey(toolKey, clerkUserId);

  const result = await db.transaction(async (tx): Promise<MeterResult & { globalSpent?: number }> => {
    const usedToday = await lockCounter(tx, day, counter);
    if (usedToday + 1 > dailyLimit) return { ok: false, reason: "rate_limited" };
    const globalSpent = await lockCounter(tx, day, GLOBAL_SCOPE);
    if (globalSpent + cost > caps.globalDaily) return { ok: false, reason: "global_daily_cap", globalSpent };
    const entryId = randomUUID();
    await tx.execute(sql`UPDATE ai_spend_daily SET spent = spent + 1 WHERE day = ${day} AND clerk_user_id = ${counter}`);
    await tx.execute(sql`UPDATE ai_spend_daily SET spent = spent + ${cost} WHERE day = ${day} AND clerk_user_id = ${GLOBAL_SCOPE}`);
    await tx.execute(sql`INSERT INTO ai_credit_ledger (id, clerk_user_id, kind, delta, tool_key, balance_after, meta)
      VALUES (${entryId}, ${clerkUserId}, 'metered', 0, ${toolKey}, 0, ${JSON.stringify({ day, cost, counter })}::jsonb)`);
    return { ok: true, entryId, globalSpent: globalSpent + cost };
  });

  if (result.ok || result.reason === "global_daily_cap") {
    void raiseSpendAlerts({
      day,
      clerkUserId,
      globalSpent: result.globalSpent,
      blocked: result.ok ? null : "global_daily_cap",
    }).catch((err) => logger.warn({ err }, "AI spend alert failed"));
  }
  const { globalSpent: _g, ...publicResult } = result;
  return publicResult as MeterResult;
}

type DebitRow = {
  clerk_user_id: string; kind: "debit" | "usage" | "metered"; delta: number; rollover_delta: number; monthly_delta: number;
  purchased_delta: number; tool_key: string | null;
  meta: { day?: string; period?: string; cost?: number; units?: number; counter?: string } | null;
};

/**
 * Gives a debit back (same buckets, same spend counters). With `units`, gives
 * back only that many of the debit's units (the failed references of a
 * partly successful run). A debit is refunded at most once, fully or partly.
 */
export async function refundDebit(entryId: string, opts: { units?: number } = {}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const found = await tx.execute(sql`SELECT clerk_user_id, kind, delta, rollover_delta, monthly_delta, purchased_delta, tool_key, meta
      FROM ai_credit_ledger WHERE id = ${entryId} AND kind IN ('debit', 'usage', 'metered')`);
    const debit = found.rows[0] as DebitRow | undefined;
    if (!debit) return false;
    const day = debit.meta?.day ?? currentDay();

    if (debit.kind === "metered") {
      const inserted = await tx.execute(sql`INSERT INTO ai_credit_ledger (clerk_user_id, kind, delta, tool_key, reference, idempotency_key)
        VALUES (${debit.clerk_user_id}, 'metered_refund', 0, ${debit.tool_key}, ${entryId}, ${`refund:${entryId}`})
        ON CONFLICT DO NOTHING RETURNING id`);
      if (inserted.rows.length === 0) return false;
      if (debit.meta?.counter) {
        await tx.execute(sql`UPDATE ai_spend_daily SET spent = GREATEST(0, spent - 1) WHERE day = ${day} AND clerk_user_id = ${debit.meta.counter}`);
      }
      await tx.execute(sql`UPDATE ai_spend_daily SET spent = GREATEST(0, spent - ${debit.meta?.cost ?? 0}) WHERE day = ${day} AND clerk_user_id = ${GLOBAL_SCOPE}`);
      return true;
    }

    if (debit.kind === "usage") {
      // Usage rows from when Pro was unlimited.
      const inserted = await tx.execute(sql`INSERT INTO ai_credit_ledger (clerk_user_id, kind, delta, tool_key, reference, idempotency_key)
        VALUES (${debit.clerk_user_id}, 'usage_refund', 0, ${debit.tool_key}, ${entryId}, ${`refund:${entryId}`})
        ON CONFLICT DO NOTHING RETURNING id`);
      if (inserted.rows.length === 0) return false;
      const cost = debit.meta?.cost ?? 0;
      await tx.execute(sql`UPDATE ai_pro_usage SET
          credits_used = CASE WHEN period = ${debit.meta?.period ?? currentPeriod()} THEN GREATEST(0, credits_used - ${cost}) ELSE credits_used END,
          generations_today = CASE WHEN day = ${day} THEN GREATEST(0, generations_today - 1) ELSE generations_today END,
          updated_at = NOW()
        WHERE clerk_user_id = ${debit.clerk_user_id}`);
      await tx.execute(sql`UPDATE ai_spend_daily SET spent = GREATEST(0, spent - ${cost}) WHERE day = ${day} AND clerk_user_id = ${GLOBAL_SCOPE}`);
      return true;
    }

    const debitUnits = debit.meta?.units ?? 1;
    const refundUnits = Math.min(Math.max(opts.units ?? debitUnits, 0), debitUnits);
    if (refundUnits <= 0) return false;
    const cost = -debit.delta;
    const amount = refundUnits === debitUnits ? cost : Math.floor((cost * refundUnits) / debitUnits);
    // A partial refund goes back in reverse spend order: purchased, monthly, rollover.
    let left = amount;
    const purchased = Math.min(-debit.purchased_delta, left); left -= purchased;
    const monthly = Math.min(-debit.monthly_delta, left); left -= monthly;
    const rollover = Math.min(-debit.rollover_delta, left);

    const inserted = await tx.execute(sql`INSERT INTO ai_credit_ledger (clerk_user_id, kind, delta, tool_key, reference, idempotency_key, rollover_delta, monthly_delta, purchased_delta, meta)
      VALUES (${debit.clerk_user_id}, 'refund', ${amount}, ${debit.tool_key}, ${entryId}, ${`refund:${entryId}`}, ${rollover}, ${monthly}, ${purchased}, ${JSON.stringify({ units: refundUnits })}::jsonb)
      ON CONFLICT DO NOTHING RETURNING id`);
    if (inserted.rows.length === 0) return false;
    // Monthly / rollover credits from a past period have expired; only same-period refunds go back to them.
    const acct = await tx.execute(sql`SELECT monthly_period FROM ai_credit_accounts WHERE clerk_user_id = ${debit.clerk_user_id} FOR UPDATE`);
    const samePeriod = (acct.rows[0] as { monthly_period: string } | undefined)?.monthly_period === day.slice(0, 7);
    await tx.execute(sql`UPDATE ai_credit_accounts SET rollover_balance = rollover_balance + ${samePeriod ? rollover : 0},
      monthly_balance = monthly_balance + ${samePeriod ? monthly : 0}, purchased_balance = purchased_balance + ${purchased},
      updated_at = NOW() WHERE clerk_user_id = ${debit.clerk_user_id}`);
    await tx.execute(sql`UPDATE ai_spend_daily SET spent = GREATEST(0, spent - ${refundUnits})
      WHERE day = ${day} AND clerk_user_id = ${generationCounterKey(debit.clerk_user_id)}`);
    await tx.execute(sql`UPDATE ai_spend_daily SET spent = GREATEST(0, spent - ${amount})
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
  const access = await resolveAccess(input.clerkUserId);
  return db.transaction(async (tx) => {
    const { row: acct } = await lockAccount(tx, input.clerkUserId, access, new Date());
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

/** Newest first. A 'rollover' row reports the credits carried over (its net effect on the total is zero). Usage and metered rows are never listed. */
export async function listHistory(clerkUserId: string, opts: { limit?: number; before?: string } = {}): Promise<{ entries: LedgerEntry[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const before = opts.before && !Number.isNaN(Date.parse(opts.before)) ? opts.before : null;
  const res = await db.execute(sql`SELECT id, kind, CASE WHEN kind = 'rollover' THEN rollover_delta ELSE delta END AS delta, tool_key, balance_after, created_at FROM ai_credit_ledger
    WHERE clerk_user_id = ${clerkUserId} AND kind NOT IN ('usage', 'usage_refund', 'metered', 'metered_refund') ${before ? sql`AND created_at < ${before}` : sql``}
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
