/**
 * Seller-only drop waitlist ("hype") helpers: types for
 * GET /api/drops/:id/hype and which drops count as upcoming.
 */

export interface DropHypePoint { date: string; cumulative: number }

export interface DropHype {
  dropId: string;
  name: string;
  releaseAt: string | null;
  /** People on the notify-me list. */
  total: number;
  /** Signups on the seller's local today. */
  today: number;
  /** Of `total`, how many follow the store. */
  followers: number;
  series: DropHypePoint[];
}

/**
 * Before release: a future release time, or (with no release time set) a
 * draft/active drop. Released, closed and fulfilled drops have no waitlist
 * left to watch.
 */
export function isUpcomingDrop(drop: { status: string; releaseAt?: string | null }, now: Date = new Date()): boolean {
  if (drop.releaseAt) {
    const t = Date.parse(drop.releaseAt);
    return Number.isFinite(t) && t > now.getTime();
  }
  return drop.status === 'draft' || drop.status === 'active';
}

/** "Oct 3" for a "YYYY-MM-DD" day key (no timezone shift). */
export function formatDayKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
