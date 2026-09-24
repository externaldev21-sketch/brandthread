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
