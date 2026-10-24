/**
 * Pure logic for the seller Dashboard home (Shopify Home layout): the
 * Today / 7D / 30D / 90D range set, the hero delta line, the "To do"
 * visibility rule, the payout progress math and the recent-activity merge.
 * No React Native imports, so all of it is unit tested directly
 * (tests/seller-dashboard-home.test.ts).
 */
import { computeMetricChange } from './sellerMetricChange';
import type { DashboardActionCounts } from './sellerDashboardStats';

// ─── Ranges ────────────────────────────────────────────────────────────────

/** The Dashboard's own range set. 7D/30D/90D are ROLLING windows (last N
 *  days, today included) on the API — the calendar week/month/year keys
 *  stay for the Analytics screens' range pills. */
export type SellerHomeDashboardRange = 'today' | '7d' | '30d' | '90d';

export const HOME_DASHBOARD_RANGES: Array<{ id: SellerHomeDashboardRange; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7D' },
  { id: '30d', label: '30D' },
  { id: '90d', label: '90D' },
];

/** What the period-over-period delta compares against, per range. */
export const HOME_RANGE_COMPARISON: Record<SellerHomeDashboardRange, string> = {
  today: 'vs yesterday',
  '7d': 'vs previous 7 days',
  '30d': 'vs previous 30 days',
  '90d': 'vs previous 90 days',
};

export const HOME_RANGE_EMPTY_MESSAGE: Record<SellerHomeDashboardRange, string> = {
  today: 'No sales yet today',
  '7d': 'No sales in the last 7 days',
  '30d': 'No sales in the last 30 days',
  '90d': 'No sales in the last 90 days',
};

// ─── Delta line ────────────────────────────────────────────────────────────

export interface HomeDeltaLine {
  direction: 'up' | 'down' | 'flat';
  /** "+12% vs yesterday", "−4.5% vs previous 7 days", "0% vs yesterday". */
  label: string;
}

/**
 * The hero's delta line. Percent only (Shopify's format), signed, with the
 * range's comparison copy. Returns null when there is no honest percentage:
 * an empty/brand-new store, or a prior period of 0 (any percentage would be
 * made up).
 */
export function describeHomeDelta(
  current: number,
  previous: number,
  range: SellerHomeDashboardRange,
  opts: { isEmpty?: boolean } = {},
): HomeDeltaLine | null {
  if (opts.isEmpty) return null;
  const change = computeMetricChange(current, previous);
  if (change.percent == null) return null;
  const comparison = HOME_RANGE_COMPARISON[range];
  if (change.direction === 'flat') return { direction: 'flat', label: `0% ${comparison}` };
  // Unsigned: the hero draws an up/down arrow next to it.
  return { direction: change.direction, label: `${Math.abs(change.percent)}% ${comparison}` };
}

// ─── To do ─────────────────────────────────────────────────────────────────

/** True only when something actually needs the seller (orders to ship, low
 *  stock, messages, returns). The "To do" section is hidden otherwise. */
export function hasTodo(counts: DashboardActionCounts | null | undefined): boolean {
  if (!counts) return false;
  return counts.toShip > 0 || counts.lowStock > 0 || counts.toAnswer > 0 || counts.returns > 0;
}

// ─── Payout progress ───────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

export interface NextPayoutEstimate {
  kind: string;
  date: string | null;
  amount: number;
  formatted: string;
}

export interface PayoutScheduleSummary {
  interval?: string | null;
}

/** Length of one payout cycle for a Stripe schedule interval, or null when unknown/manual. */
export function payoutCycleMs(interval: string | null | undefined): number | null {
  switch (interval) {
    case 'daily': return DAY_MS;
    case 'weekly': return 7 * DAY_MS;
    case 'monthly': return 30 * DAY_MS;
    default: return null;
  }
}

/**
 * How far through the current payout cycle "now" is (0..1), measured back
 * from the real next payout date by one real schedule cycle. Null when there
 * is no dated payout or no known schedule — the bar is then hidden, never
 * guessed.
 */
export function payoutProgress(
  estimate: NextPayoutEstimate | null | undefined,
  schedule: PayoutScheduleSummary | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!estimate?.date) return null;
  const cycle = payoutCycleMs(schedule?.interval);
  if (!cycle) return null;
  const due = Date.parse(estimate.date);
  if (!Number.isFinite(due)) return null;
  const remaining = due - now;
  if (remaining <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - remaining / cycle));
}

/** The card's real next payout, or null when nothing dated is scheduled. */
export function datedNextPayout(estimate: NextPayoutEstimate | null | undefined): NextPayoutEstimate | null {
  if (!estimate || !estimate.date || estimate.amount <= 0) return null;
  if (estimate.kind !== 'scheduled' && estimate.kind !== 'existing') return null;
  return estimate;
}

// ─── Recent activity ───────────────────────────────────────────────────────

export type ActivityKind = 'order' | 'follower' | 'review';

export interface DashboardActivityItem {
  id: string;
  kind: ActivityKind;
  title: string;
  /** ISO timestamp. */
  at: string;
  /** Route to open on tap. */
  route: string | null;
}

/** Normalizes the three real sources into one newest-first list. Rows with no valid timestamp are dropped. */
export function mergeDashboardActivity(
  sources: {
    orders?: Array<{ id?: unknown; createdAt?: unknown; created_at?: unknown; customerName?: unknown; buyerName?: unknown; customer?: { name?: unknown } | null; orderNumber?: unknown; totalCents?: unknown }>;
    followers?: Array<{ userId?: unknown; name?: unknown; handle?: unknown; followedAt?: unknown }>;
    reviews?: Array<{ id?: unknown; created_at?: unknown; createdAt?: unknown; rating?: unknown; buyer_display_name?: unknown; buyer_name?: unknown; product_name?: unknown }>;
  },
  limit = 6,
): DashboardActivityItem[] {
  const out: DashboardActivityItem[] = [];
  const valid = (value: unknown): string | null => {
    if (typeof value !== 'string' && !(value instanceof Date)) return null;
    const ms = new Date(value as string).getTime();
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  };
  const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

  for (const order of sources.orders ?? []) {
    const at = valid(order.createdAt ?? order.created_at);
    if (!at || order.id == null) continue;
    const who = str(order.customerName) ?? str(order.buyerName) ?? str(order.customer?.name);
    out.push({
      id: `order-${String(order.id)}`,
      kind: 'order',
      title: who ? `New order from ${who}` : 'New order',
      at,
      route: `/order-detail?id=${encodeURIComponent(String(order.id))}`,
    });
  }
  for (const follower of sources.followers ?? []) {
    const at = valid(follower.followedAt);
    if (!at || follower.userId == null) continue;
    const who = str(follower.name) ?? str(follower.handle);
    out.push({
      id: `follower-${String(follower.userId)}`,
      kind: 'follower',
      title: who ? `${who} followed you` : 'New follower',
      at,
      route: null,
    });
  }
  for (const review of sources.reviews ?? []) {
    const at = valid(review.created_at ?? review.createdAt);
    if (!at || review.id == null) continue;
    const rating = Number(review.rating);
    const stars = Number.isFinite(rating) && rating > 0 ? `${Math.round(rating)}-star review` : 'New review';
    const product = str(review.product_name);
    out.push({
      id: `review-${String(review.id)}`,
      kind: 'review',
      title: product ? `${stars} on ${product}` : stars,
      at,
      route: '/seller-reviews',
    });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

// ─── 90D chart points ──────────────────────────────────────────────────────

type ChartBucket = { bucket: string; totalCents: number; netCents: number; orderCount: number; visitorCount: number };

/**
 * Folds daily buckets into 7-day points counted back from the newest day
 * (the oldest point may cover fewer days), so a 90-day line reads as a
 * trend instead of 90 daily spikes. Sums are exact — every day lands in one
 * point — and each point is keyed by its first day.
 */
export function groupBucketsByWeek(daily: ChartBucket[]): ChartBucket[] {
  const out: ChartBucket[] = [];
  for (let end = daily.length; end > 0; end -= 7) {
    const chunk = daily.slice(Math.max(0, end - 7), end);
    out.unshift({
      bucket: chunk[0].bucket,
      totalCents: chunk.reduce((s, b) => s + b.totalCents, 0),
      netCents: chunk.reduce((s, b) => s + b.netCents, 0),
      orderCount: chunk.reduce((s, b) => s + b.orderCount, 0),
      visitorCount: chunk.reduce((s, b) => s + b.visitorCount, 0),
    });
  }
  return out;
}

/** Short relative time: "now", "2m", "3h", "4d", "5w", then "Mar 4". */
export function shortRelativeTime(iso: string, now: number = Date.now()): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const diff = Math.max(0, now - ms);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const d = new Date(ms);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
