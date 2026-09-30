import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";

export type AgeBand = "under_13" | "13_17" | "18_plus";

export const MAX_PLAUSIBLE_AGE_YEARS = 120;
const DOB_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type DobParse = { ok: true; y: number; m: number; d: number } | { ok: false };

/** Strict YYYY-MM-DD calendar parse (rejects 2011-02-30 etc). */
export function parseDob(dob: unknown): DobParse {
  if (typeof dob !== "string") return { ok: false };
  const match = DOB_RE.exec(dob);
  if (!match) return { ok: false };
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return { ok: false };
  }
  return { ok: true, y, m, d };
}

/**
 * Whole years completed on `now`, compared on the UTC calendar date. A Feb 29
 * birthday counts as reached on Mar 1 in non-leap years (the conservative
 * reading for a child-safety gate). Returns null for unparseable, future, or
 * implausible (> 120y) dates.
 */
export function ageInYears(dob: unknown, now: Date = new Date()): number | null {
  const parsed = parseDob(dob);
  if (!parsed.ok) return null;
  const ny = now.getUTCFullYear();
  const nm = now.getUTCMonth() + 1;
  const nd = now.getUTCDate();
  if (parsed.y > ny || (parsed.y === ny && (parsed.m > nm || (parsed.m === nm && parsed.d > nd)))) {
    return null; // born in the future
  }
  let age = ny - parsed.y;
  if (nm < parsed.m || (nm === parsed.m && nd < parsed.d)) age -= 1;
  if (age > MAX_PLAUSIBLE_AGE_YEARS) return null;
  return age;
}

/** Derived band for a date of birth, or null when the date is invalid. The DOB is never persisted. */
export function ageBandFromDob(dob: unknown, now: Date = new Date()): AgeBand | null {
  const age = ageInYears(dob, now);
  if (age === null) return null;
  if (age < 13) return "under_13";
  if (age < 18) return "13_17";
  return "18_plus";
}

export function isAgeBand(value: unknown): value is AgeBand {
  return value === "under_13" || value === "13_17" || value === "18_plus";
}

export const AGE_RESTRICTED_MESSAGE =
  "You must be 18 or older to sell, go live, or receive payouts on Brandthread.";

/**
 * Whether a stored band may sell/go live/receive payouts. NULL (legacy account
 * created before the gate) is allowed so existing sellers keep working.
 */
export function bandMaySellOrEarn(band: string | null | undefined): boolean {
  return band !== "13_17" && band !== "under_13";
}

export class AgeRestrictedError extends Error {
  readonly status = 403;
  readonly code = "AGE_RESTRICTED";
  constructor(message = AGE_RESTRICTED_MESSAGE) {
    super(message);
    this.name = "AgeRestrictedError";
  }
}

/** Throws AgeRestrictedError when the account's known age band forbids selling/earning. */
export async function assertCanSellOrEarn(clerkUserId: string): Promise<void> {
  const [row] = await db
    .select({ ageBand: users.ageBand })
    .from(users)
    .where(eq(users.clerkId, clerkUserId))
    .limit(1);
  if (!bandMaySellOrEarn(row?.ageBand)) throw new AgeRestrictedError();
}

/** Express helper: returns true (and sends the typed 403) when the request must stop. */
export async function denyIfAgeRestricted(
  clerkUserId: string,
  res: { status(code: number): { json(body: unknown): unknown } },
): Promise<boolean> {
  try {
    await assertCanSellOrEarn(clerkUserId);
    return false;
  } catch (err) {
    if (err instanceof AgeRestrictedError) {
      res.status(403).json({ error: err.message, code: err.code });
      return true;
    }
    throw err;
  }
}
