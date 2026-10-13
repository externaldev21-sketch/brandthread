/**
 * Seller milestone cards (GET /api/seller/milestones/next). The server owns
 * the thresholds and the "seen" state; this module holds the response type
 * and the demo (`?demo=1`) milestone, derived from the same demo orders the
 * dashboard shows so the number on the card is one the dashboard backs up.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type MilestoneKey = 'first_sale' | 'sales_1k' | 'orders_100' | 'sales_10k' | 'orders_1000' | 'sales_100k';

export interface SellerMilestone {
  key: MilestoneKey;
  label: string;
  reachedAt: string;
  storeName: string;
  handle: string | null;
  productImageUrl: string | null;
}

/** Same order and thresholds as api-server lib/sellerMilestones.ts, lowest first. */
const DEMO_MILESTONES: Array<{ key: MilestoneKey; label: string; metric: 'orders' | 'salesCents'; threshold: number }> = [
  { key: 'first_sale', label: 'First sale', metric: 'orders', threshold: 1 },
  { key: 'sales_1k', label: '$1,000 in sales', metric: 'salesCents', threshold: 100_000 },
  { key: 'orders_100', label: '100 orders', metric: 'orders', threshold: 100 },
  { key: 'sales_10k', label: '$10,000 in sales', metric: 'salesCents', threshold: 1_000_000 },
  { key: 'orders_1000', label: '1,000 orders', metric: 'orders', threshold: 1_000 },
  { key: 'sales_100k', label: '$100,000 in sales', metric: 'salesCents', threshold: 10_000_000 },
];

/** The highest milestone the demo store's paid, non-cancelled orders reach. */
export function buildPreviewMilestone(
  orders: Array<{ status: string; paidAt: string | null; totalCents: number }>,
  identity: { storeName: string; handle: string; productImageUrl: string | null },
  now: Date,
): SellerMilestone | null {
  const paid = orders.filter((o) => o.paidAt && o.status !== 'cancelled');
  const totals = { orders: paid.length, salesCents: paid.reduce((sum, o) => sum + Math.max(0, o.totalCents), 0) };
  const reached = DEMO_MILESTONES.filter((m) => totals[m.metric] >= m.threshold);
  const top = reached[reached.length - 1];
  if (!top) return null;
  return {
    key: top.key,
    label: top.label,
    reachedAt: new Date(now.getTime() - 2 * 3600_000).toISOString(),
    storeName: identity.storeName,
    handle: identity.handle,
    productImageUrl: identity.productImageUrl,
  };
}

/** "Oct 13, 2026" for the story card. */
export function formatReachedDate(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// The signed-out preview has no server: its "seen" lives on this device.
const PREVIEW_SEEN_KEY = 'bt:milestones:preview-seen';

export async function readPreviewSeen(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(PREVIEW_SEEN_KEY);
  } catch {
    return null;
  }
}

export async function writePreviewSeen(key: MilestoneKey): Promise<void> {
  try {
    await AsyncStorage.setItem(PREVIEW_SEEN_KEY, key);
  } catch {
    // Best effort; the card is already hidden for this session.
  }
}
