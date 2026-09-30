/**
 * Live tips feature flag. `live_tips` gates POST /api/thread-cash/live-gift
 * (and the client's gift button) until Thread Cash is finalised. It is read
 * from the existing feature_flags table (migration 047; seeded OFF by
 * migration 130), is OFF when the row is missing, and FAILS CLOSED: if the
 * flag lookup errors, gifts are rejected rather than allowed.
 *
 * Only gates; never touches Thread Cash ledger semantics.
 */
import type { RequestHandler } from "express";

export const LIVE_TIPS_FLAG = "live_tips";
export const LIVE_TIPS_DISABLED_CODE = "LIVE_TIPS_DISABLED";

export async function isLiveTipsEnabled(): Promise<boolean> {
  try {
    const { pool } = await import("@workspace/db");
    const result = await pool.query<{ enabled: boolean }>(
      `SELECT enabled FROM feature_flags WHERE key = $1`,
      [LIVE_TIPS_FLAG],
    );
    return result.rows[0]?.enabled === true;
  } catch {
    return false;
  }
}

/** Express gate; `check` is injectable for tests. */
export function liveTipsGate(check: () => Promise<boolean> = isLiveTipsEnabled): RequestHandler {
  return async (_req, res, next) => {
    let enabled = false;
    try {
      enabled = await check();
    } catch {
      enabled = false;
    }
    if (!enabled) {
      res.status(403).json({ error: "Tipping in live isn't available right now.", code: LIVE_TIPS_DISABLED_CODE });
      return;
    }
    next();
  };
}
