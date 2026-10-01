/**
 * IP takedown policy helpers (App Store 5.2 / DMCA-style process).
 *
 * Pure functions only, so the strike and counter-notice rules are unit-tested
 * without a database. routes/ip-cases.ts applies them inside transactions.
 *
 * Policy:
 *  - One strike per case in which a moderator takes a listing down. A case can
 *    only ever count once (ip_cases.strike_applied_at).
 *  - At IP_REPEAT_INFRINGER_STRIKES (default 3) the seller is flagged as a
 *    repeat infringer for moderator review. The flag is sticky: reinstating a
 *    listing after a successful counter-notice removes that case's strike but a
 *    moderator must clear the flag explicitly.
 */

export const DEFAULT_REPEAT_INFRINGER_STRIKES = 3;

export function repeatInfringerThreshold(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number.parseInt(env.IP_REPEAT_INFRINGER_STRIKES ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_REPEAT_INFRINGER_STRIKES;
}

export interface StrikeState {
  count: number;
  flagged: boolean;
  /** True only on the strike that crosses the threshold for an unflagged seller. */
  newlyFlagged: boolean;
}

export function addStrike(count: number, flagged: boolean, threshold = repeatInfringerThreshold()): StrikeState {
  const next = Math.max(0, count) + 1;
  const crosses = !flagged && next >= threshold;
  return { count: next, flagged: flagged || crosses, newlyFlagged: crosses };
}

export function removeStrike(count: number, flagged: boolean): StrikeState {
  return { count: Math.max(0, count - 1), flagged, newlyFlagged: false };
}

export const COUNTER_NOTICE_STATUSES = ["none", "received", "reinstated", "upheld"] as const;
export type CounterNoticeStatus = typeof COUNTER_NOTICE_STATUSES[number];

/** A counter-notice can be filed once per case, and only after a takedown. */
export function canReceiveCounterNotice(input: { takedownAt: Date | null; counterNoticeStatus: string }): boolean {
  return input.takedownAt !== null && input.counterNoticeStatus === "none";
}

export function canResolveCounterNotice(counterNoticeStatus: string): boolean {
  return counterNoticeStatus === "received";
}

const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Pulls a product id out of a pasted listing URL (e.g. /product/<uuid>), or null. */
export function extractProductId(listingUrl: string | null | undefined): string | null {
  if (!listingUrl) return null;
  return listingUrl.match(UUID_IN_TEXT)?.[0]?.toLowerCase() ?? null;
}

export interface NoticeInput {
  channel?: unknown;
  goodFaithStatement?: unknown;
  accuracyStatement?: unknown;
  signature?: unknown;
}

/**
 * The public web notice form must carry the statements a DMCA notice requires
 * (good-faith belief, accuracy under penalty of perjury, electronic
 * signature). The in-app report keeps its own on-screen certification and is
 * not required to send them.
 */
export function validateNotice(body: NoticeInput): { ok: true; channel: "app" | "web_notice"; signature: string | null } | { ok: false; error: string } {
  const channel = body.channel === "web_notice" ? "web_notice" : "app";
  const signature = typeof body.signature === "string" ? body.signature.trim().slice(0, 200) : "";
  if (channel === "app") return { ok: true, channel, signature: signature || null };
  if (body.goodFaithStatement !== true) return { ok: false, error: "Confirm your good-faith belief statement" };
  if (body.accuracyStatement !== true) return { ok: false, error: "Confirm the accuracy and authority statement" };
  if (signature.length < 2) return { ok: false, error: "An electronic signature (full name) is required" };
  return { ok: true, channel, signature };
}
