/**
 * Pure launch-time math shared by checkout gating (checkoutPlan.ts) and the
 * public drop page (routes/public.ts). Kept dependency-free so it is testable
 * without a database: launch-time enforcement always compares against the
 * server's own clock, never a client-supplied "now" or timezone.
 */

/**
 * The instant a given viewer may see/buy a drop unlock. `releaseAt` is
 * always a UTC instant; `launchTimezone` is display-only (the seller's
 * chosen timezone for showing the launch date) and never affects this math.
 * Followers get pulled forward by the seller's early-access window.
 */
export function effectiveDropLaunchAt(
  releaseAt: Date,
  earlyAccessMinutes: number,
  hasEarlyAccess: boolean,
): Date {
  if (earlyAccessMinutes > 0 && hasEarlyAccess) {
    return new Date(releaseAt.getTime() - earlyAccessMinutes * 60_000);
  }
  return releaseAt;
}

/** Whether the drop is buyable/visible-as-live right now, server time. */
export function isDropLive(
  releaseAt: Date | null,
  earlyAccessMinutes: number,
  hasEarlyAccess: boolean,
  now: Date = new Date(),
): boolean {
  if (!releaseAt) return false;
  return effectiveDropLaunchAt(releaseAt, earlyAccessMinutes, hasEarlyAccess).getTime() <= now.getTime();
}

/** Upper bound on the head start a seller can set (one day). */
export const MAX_EARLY_ACCESS_MINUTES = 24 * 60;

export function isValidEarlyAccessMinutes(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_EARLY_ACCESS_MINUTES;
}

/**
 * Whether the follower early-access window is open right now: past
 * releaseAt − window, but before releaseAt (after that everyone is in).
 */
export function isEarlyAccessWindowOpen(
  releaseAt: Date | null,
  earlyAccessMinutes: number,
  now: Date = new Date(),
): boolean {
  if (!releaseAt || earlyAccessMinutes <= 0) return false;
  const t = now.getTime();
  return effectiveDropLaunchAt(releaseAt, earlyAccessMinutes, true).getTime() <= t && t < releaseAt.getTime();
}
