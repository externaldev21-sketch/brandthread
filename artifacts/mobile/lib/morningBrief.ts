/**
 * Morning brief: the once-a-day card at the top of the seller dashboard
 * (GET /api/seller/morning-brief). This module holds the response type, the
 * visibility rule, the per-device dismiss/turn-off storage and the demo
 * (`?demo=1`) brief. Pure apart from AsyncStorage, which is wrapped so a
 * blocked store never throws.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type MorningBriefSuggestionKind = 'restock' | 'ship' | 'low_stock';

export interface MorningBriefSuggestion {
  kind: MorningBriefSuggestionKind;
  title: string;
  detail: string;
  target: { type: 'product' | 'order'; id: string };
}

export interface MorningBrief {
  /** Seller-local today, YYYY-MM-DD. */
  date: string;
  timeZone?: string;
  hasPaidOrder: boolean;
  yesterday: { netCents: number; orderCount: number };
  toShip: number;
  suggestion: MorningBriefSuggestion | null;
}

/** The brief appears from 05:00 local time onward. */
export const MORNING_BRIEF_FROM_HOUR = 5;

export const dismissedKey = (userId: string) => `bt:morning-brief:dismissed:${userId}`;
export const offKey = (userId: string) => `bt:morning-brief:off:${userId}`;

/** The device's IANA zone, sent as `?tz=` so the server's "yesterday" is the seller's. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function localDateString(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

export function hasSomethingToSay(brief: MorningBrief): boolean {
  return brief.yesterday.netCents > 0 || brief.toShip > 0 || brief.suggestion !== null;
}

/**
 * Visible only: after 05:00 local, for a seller with at least one paid order,
 * when there is something to say, not turned off, and not dismissed today.
 * A brief fetched for a different local date (the app stayed open overnight)
 * is stale and stays hidden until the refetch lands.
 */
export function shouldShowMorningBrief(
  brief: MorningBrief | null,
  opts: { now: Date; dismissedDate: string | null; off: boolean },
): boolean {
  if (!brief || opts.off) return false;
  if (!brief.hasPaidOrder) return false;
  if (opts.now.getHours() < MORNING_BRIEF_FROM_HOUR) return false;
  if (brief.date !== localDateString(opts.now)) return false;
  if (opts.dismissedDate === brief.date) return false;
  return hasSomethingToSay(brief);
}

export async function readMorningBriefPrefs(userId: string): Promise<{ dismissedDate: string | null; off: boolean }> {
  try {
    const [dismissedDate, off] = await Promise.all([
      AsyncStorage.getItem(dismissedKey(userId)),
      AsyncStorage.getItem(offKey(userId)),
    ]);
    return { dismissedDate, off: off === '1' };
  } catch {
    return { dismissedDate: null, off: false };
  }
}

export async function dismissMorningBriefFor(userId: string, date: string): Promise<void> {
  try {
    await AsyncStorage.setItem(dismissedKey(userId), date);
  } catch {
    // Best effort: the card is already hidden for this session.
  }
}

export async function turnOffMorningBrief(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(offKey(userId), '1');
  } catch {
    // Best effort, as above.
  }
}

/** One sentence for yesterday and the shipping queue. */
export function summarySentence(brief: MorningBrief, formatMoney: (cents: number) => string): string {
  const { netCents, orderCount } = brief.yesterday;
  const sales = netCents > 0
    ? `${formatMoney(netCents)} from ${orderCount} ${orderCount === 1 ? 'order' : 'orders'} yesterday.`
    : 'No sales yesterday.';
  if (brief.toShip <= 0) return sales;
  return `${sales} ${brief.toShip} to ship.`;
}

/** The card's one action: the suggestion's own verb, else the orders queue. */
export function primaryActionLabel(brief: MorningBrief): string {
  switch (brief.suggestion?.kind) {
    case 'restock':
    case 'low_stock':
      return 'Restock';
    case 'ship':
      return 'Ship order';
    default:
      return brief.toShip > 0 ? 'Ship orders' : 'View orders';
  }
}

/** Where the action goes: the product's stock screen, the order, or Orders. */
export function primaryActionRoute(brief: MorningBrief): string {
  const s = brief.suggestion;
  if (s?.target.type === 'product') return `/product-variants?productId=${encodeURIComponent(s.target.id)}`;
  if (s?.target.type === 'order') return `/order-detail?id=${encodeURIComponent(s.target.id)}`;
  return '/(tabs)/orders';
}

// ── Demo (`?demo=1`) brief ─────────────────────────────────────────────────

export interface PreviewBriefOrder {
  status: string;
  createdAt: string;
  paidAt: string | null;
  totalCents: number;
  items: Array<{ productId: string; quantity: number }>;
}

export interface PreviewBriefProduct {
  id: string;
  name: string;
  stocks: number[];
}

/**
 * Builds the demo brief from the same demo orders and products the
 * dashboard and Products tab show, so its numbers match theirs. The
 * suggestion follows the server's first rule (a sold-out product that sold
 * in the last 30 days).
 */
export function buildPreviewMorningBrief(now: Date, orders: PreviewBriefOrder[], products: PreviewBriefProduct[]): MorningBrief {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const since = now.getTime() - 30 * 86_400_000;
  const paid = orders.filter((o) => o.paidAt && o.status !== 'cancelled');

  let netCents = 0;
  let orderCount = 0;
  const units = new Map<string, number>();
  for (const o of paid) {
    const at = new Date(o.createdAt).getTime();
    if (at >= yesterday.getTime() && at < today.getTime()) {
      netCents += o.totalCents;
      orderCount += 1;
    }
    if (at >= since) {
      for (const item of o.items) units.set(item.productId, (units.get(item.productId) ?? 0) + item.quantity);
    }
  }

  const soldOut = products
    .filter((p) => p.stocks.length > 0 && p.stocks.every((s) => s <= 0) && (units.get(p.id) ?? 0) > 0)
    .sort((a, b) => (units.get(b.id) ?? 0) - (units.get(a.id) ?? 0))[0];
  const sold = soldOut ? units.get(soldOut.id) ?? 0 : 0;

  return {
    date: localDateString(now),
    hasPaidOrder: paid.length > 0,
    yesterday: { netCents, orderCount },
    toShip: paid.filter((o) => o.status === 'pending' || o.status === 'processing').length,
    suggestion: soldOut ? {
      kind: 'restock',
      title: `Restock ${soldOut.name}`,
      detail: `Sold out. It sold ${sold} in the last 30 days.`,
      target: { type: 'product', id: soldOut.id },
    } : null,
  };
}
