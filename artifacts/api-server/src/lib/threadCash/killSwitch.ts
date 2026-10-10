/**
 * Runtime Thread Cash kill switches (BT-448), toggled from the admin
 * dashboard without a deploy. Stored as rows in the existing feature_flags
 * table; a missing row means "not paused".
 *
 *  - rewards:  daily check-in / active-time rewards (POST /thread-cash/check-in
 *              and /daily/claim) pay nothing while paused.
 *  - checkout: Thread Cash can't be reserved (POST /thread-cash/redeem) or
 *              applied to a new checkout while paused. Releasing an existing
 *              reservation still works so no balance is ever stranded.
 */
import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";

export const THREAD_CASH_PAUSE_FLAGS = {
  rewards: "threadCashRewardsPaused",
  checkout: "threadCashCheckoutPaused",
} as const;

export type ThreadCashPauseKind = keyof typeof THREAD_CASH_PAUSE_FLAGS;

export const THREAD_CASH_PAUSE_KINDS = Object.keys(THREAD_CASH_PAUSE_FLAGS) as ThreadCashPauseKind[];

export function isThreadCashPauseKind(value: unknown): value is ThreadCashPauseKind {
  return typeof value === "string" && value in THREAD_CASH_PAUSE_FLAGS;
}

export async function isThreadCashPaused(kind: ThreadCashPauseKind): Promise<boolean> {
  const { rows } = await pool.query<{ enabled: boolean }>(`SELECT enabled FROM feature_flags WHERE key = $1`, [THREAD_CASH_PAUSE_FLAGS[kind]]);
  return rows[0]?.enabled === true;
}

export async function threadCashPauseState(): Promise<Record<ThreadCashPauseKind, { paused: boolean; updatedAt: string | null; updatedBy: string | null }>> {
  const keys = THREAD_CASH_PAUSE_KINDS.map((k) => THREAD_CASH_PAUSE_FLAGS[k]);
  const { rows } = await pool.query<{ key: string; enabled: boolean; updated_at: Date | null; updated_by: string | null }>(
    `SELECT key, enabled, updated_at, updated_by FROM feature_flags WHERE key = ANY($1::text[])`,
    [keys],
  );
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const out = {} as Record<ThreadCashPauseKind, { paused: boolean; updatedAt: string | null; updatedBy: string | null }>;
  for (const kind of THREAD_CASH_PAUSE_KINDS) {
    const row = byKey.get(THREAD_CASH_PAUSE_FLAGS[kind]);
    out[kind] = { paused: row?.enabled ?? false, updatedAt: row?.updated_at?.toISOString() ?? null, updatedBy: row?.updated_by ?? null };
  }
  return out;
}

/** Upserts the flag row. Returns the previous paused value. */
export async function setThreadCashPaused(kind: ThreadCashPauseKind, paused: boolean, actorClerkId: string, executor: Pick<typeof db, "execute"> = db): Promise<boolean> {
  const key = THREAD_CASH_PAUSE_FLAGS[kind];
  const description = kind === "rewards" ? "Admin kill switch: pause daily Thread Cash rewards" : "Admin kill switch: pause Thread Cash at checkout";
  const [previous] = ((await executor.execute(sql`SELECT enabled FROM feature_flags WHERE key = ${key} FOR UPDATE`)) as unknown as { rows: { enabled: boolean }[] }).rows;
  await executor.execute(sql`
    INSERT INTO feature_flags (key, enabled, description, updated_by, updated_at)
    VALUES (${key}, ${paused}, ${description}, ${actorClerkId}, now())
    ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()`);
  return previous?.enabled ?? false;
}

/** Response body for a paused daily reward claim — 200 so clients mark the day done and stop retrying. */
export function pausedRewardBody(balanceCents: number) {
  return {
    ok: true,
    awarded: false,
    paused: true,
    code: "THREAD_CASH_REWARDS_PAUSED",
    message: "Daily rewards are paused right now.",
    earnedCents: 0,
    streakBonusCents: 0,
    streakBroken: false,
    balanceCents,
  };
}

export const CHECKOUT_PAUSED_ERROR = {
  error: "Thread Cash can't be used at checkout right now.",
  code: "THREAD_CASH_CHECKOUT_PAUSED",
} as const;
