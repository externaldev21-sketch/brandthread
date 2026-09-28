/**
 * Shared countdown-label formatting — one implementation for every "In Xh" /
 * "Ends in Xh" badge in Discover (drop rows, Just Dropped rail tiles) so
 * they never drift into slightly different wording/rounding.
 */

/** For a future start time (a drop that hasn't released yet). */
export function formatTimeUntil(iso?: string | null): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Live now';
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `In ${hours}h`;
  return `In ${Math.round(hours / 24)}d`;
}

/** For a closing/ending time (a limited-window item about to end). Returns
 *  null once it's already passed, so callers can drop the badge entirely
 *  instead of showing a stale/negative countdown. */
export function formatTimeRemaining(iso?: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const exactHours = ms / 3_600_000;
  if (exactHours < 1) return `Ends in ${Math.max(1, Math.round(ms / 60_000))}m`;
  const hours = Math.round(exactHours);
  if (hours < 24) return `Ends in ${hours}h`;
  return `Ends in ${Math.round(hours / 24)}d`;
}
