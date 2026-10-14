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

/** Early window for a buyer the seller granted early access (Superfans) when the drop sets none. */
export const DEFAULT_GRANT_EARLY_ACCESS_MINUTES = 60;

/**
 * The head start a granted buyer gets: the drop's own early-access window, or
 * 60 minutes when the seller left it at 0. Additive to follower early access —
 * a grant never shortens a window the buyer already has.
 */
export function grantEarlyAccessMinutes(earlyAccessMinutes: number | null | undefined): number {
  return earlyAccessMinutes && earlyAccessMinutes > 0 ? earlyAccessMinutes : DEFAULT_GRANT_EARLY_ACCESS_MINUTES;
}
