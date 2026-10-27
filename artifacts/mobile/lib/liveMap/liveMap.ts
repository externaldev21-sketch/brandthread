/**
 * Seller dashboard Live map / order globe: shared types and pure helpers.
 *
 * Data comes from GET /api/seller/live-map/today: today's paid orders
 * aggregated by city, plus `recent` (the seller's own last 7 days of paid
 * orders, one globe dot each, with what the dot's popover shows). Places are
 * city level only: no street, zip or buyer name. `order_city` events on
 * /ws/seller say "an order just landed here"; the hook then refetches.
 */

export interface LiveMapCity {
  key: string;
  /** "" when the server could only place the order at state/country level. */
  city: string;
  region: string;
  country: string;
  lat: number;
  lng: number;
  count: number;
  lastAt: string;
}

/** One recent paid order, placed on the globe (GET /api/seller/live-map/today `recent`). */
export interface LiveMapRecentOrder {
  id: string;
  orderNumber: string;
  /** The order's largest line, by product name; "" when unknown. */
  item: string;
  itemCount: number;
  amountCents: number;
  key: string;
  city: string;
  region: string;
  country: string;
  lat: number;
  lng: number;
  /** When it was paid (ISO). */
  at: string;
}

/**
 * Shoppers browsing the store right now, by city (GET /api/seller/live-map/today
 * `sessions`): signed-in visitors of the last few minutes, placed at the
 * city of their saved address. City level only, never who.
 */
export interface LiveMapSession {
  key: string;
  city: string;
  region: string;
  country: string;
  lat: number;
  lng: number;
  count: number;
}

/** The store's own place (seller profile location), where order arcs land. */
export interface LiveMapHome {
  key: string;
  city: string;
  region: string;
  country: string;
  lat: number;
  lng: number;
}

export interface LiveMapToday {
  total: number;
  cities: LiveMapCity[];
  /** Newest first. Older servers omit it; read through `recentOrders()`. */
  recent?: LiveMapRecentOrder[];
  /** Busiest first. Older servers omit it; read through `liveSessions()`. */
  sessions?: LiveMapSession[];
  /** Every active session, including ones that can't be placed (signed out). */
  sessionsTotal?: number;
  home?: LiveMapHome | null;
}

export interface OrderCityEvent {
  type: 'order_city';
  key: string;
  city: string;
  region: string;
  country: string;
  lat: number;
  lng: number;
  at: string;
}

/** The server's cap on `recent` (routes/seller-live-map.ts RECENT_LIMIT). */
export const RECENT_ORDERS_LIMIT = 60;

/** One globe dot per place: the newest order there, and how many recent orders share the spot. */
export interface GlobeSpot { order: LiveMapRecentOrder; count: number }

export function globeSpots(recent: LiveMapRecentOrder[]): GlobeSpot[] {
  const byKey = new Map<string, GlobeSpot>();
  for (const order of recent) {
    const spot = byKey.get(order.key);
    if (spot) spot.count += 1;
    else byKey.set(order.key, { order, count: 1 });
  }
  return [...byKey.values()];
}

export const EMPTY_LIVE_MAP: LiveMapToday = { total: 0, cities: [], recent: [], sessions: [], sessionsTotal: 0, home: null };

// Stable empties, so a missing list doesn't look like a new one every render.
const NO_RECENT: LiveMapRecentOrder[] = [];
const NO_SESSIONS: LiveMapSession[] = [];

export function recentOrders(state: LiveMapToday | null | undefined): LiveMapRecentOrder[] {
  return Array.isArray(state?.recent) ? state.recent : NO_RECENT;
}

export function liveSessions(state: LiveMapToday | null | undefined): LiveMapSession[] {
  return Array.isArray(state?.sessions) ? state.sessions : NO_SESSIONS;
}

/**
 * Everything the globe draws a dot for: one per place with recent orders
 * (newest first), then one per place with shoppers on the store right now.
 * A place with both shows the order dot; its session count rides along.
 * No activity, no dot.
 */
export type GlobeActivity =
  | { kind: 'order'; id: string; key: string; lat: number; lng: number; order: LiveMapRecentOrder; count: number; sessions: number }
  | { kind: 'session'; id: string; key: string; lat: number; lng: number; session: LiveMapSession };

export function globeActivities(recent: LiveMapRecentOrder[], sessions: LiveMapSession[]): GlobeActivity[] {
  const sessionsByKey = new Map(sessions.map((s) => [s.key, s.count]));
  const out: GlobeActivity[] = globeSpots(recent).map(({ order, count }) => ({
    kind: 'order', id: order.id, key: order.key, lat: order.lat, lng: order.lng, order, count, sessions: sessionsByKey.get(order.key) ?? 0,
  }));
  const taken = new Set(out.map((a) => a.key));
  for (const session of sessions) {
    if (session.count <= 0 || taken.has(session.key)) continue;
    taken.add(session.key);
    out.push({ kind: 'session', id: `session:${session.key}`, key: session.key, lat: session.lat, lng: session.lng, session });
  }
  return out;
}

/** "1 session · Austin, TX" / "3 sessions · Berlin, DE". */
export function sessionLabel(s: Pick<LiveMapSession, 'count' | 'city' | 'region' | 'country'>): string {
  return `${s.count} ${s.count === 1 ? 'session' : 'sessions'} · ${liveMapCityLabel(s)}`;
}

/** "3 items" / "Wool Overcoat" / "Wool Overcoat + 1 more". */
export function recentOrderItemLabel(order: Pick<LiveMapRecentOrder, 'item' | 'itemCount'>): string {
  const more = Math.max(0, order.itemCount - 1);
  if (!order.item) return order.itemCount > 0 ? `${order.itemCount} ${order.itemCount === 1 ? 'item' : 'items'}` : 'Order';
  return more > 0 ? `${order.item} + ${more} more` : order.item;
}

/** "just now", "12m ago", "3h ago", "2d ago". */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function countryName(code: string): string {
  try {
    const DisplayNames = (Intl as any).DisplayNames;
    if (DisplayNames) {
      const name = new DisplayNames(['en'], { type: 'region' }).of(code);
      if (name && name !== code) return name;
    }
  } catch { /* Hermes without Intl.DisplayNames */ }
  return code;
}

/** "Austin, TX", "Berlin, DE", "TX, US" (state-level), "Germany" (country-level). */
export function liveMapCityLabel(c: Pick<LiveMapCity, 'city' | 'region' | 'country'>): string {
  if (c.city) return `${c.city}, ${c.country === 'US' ? c.region : c.country}`;
  if (c.region) return `${c.region}, ${c.country}`;
  return countryName(c.country);
}

/** Dot radius in map view-box units (720 wide): small and restrained, grows with count. */
export function liveMapDotRadius(count: number, maxCount: number): number {
  const MIN = 2.6;
  const MAX = 5.2;
  if (maxCount <= 1) return MIN;
  const t = Math.sqrt(Math.max(0, count - 1) / (maxCount - 1));
  return MIN + (MAX - MIN) * t;
}

/** Folds a socket `order_city` event into today's state (the next poll stays authoritative). */
export function applyOrderCity(state: LiveMapToday, ev: OrderCityEvent): LiveMapToday {
  const idx = state.cities.findIndex((c) => c.key === ev.key);
  const cities = idx >= 0
    ? state.cities.map((c, i) => (i === idx ? { ...c, count: c.count + 1, lastAt: ev.at > c.lastAt ? ev.at : c.lastAt } : c))
    : [...state.cities, {
      key: ev.key, city: ev.city, region: ev.region, country: ev.country, lat: ev.lat, lng: ev.lng, count: 1, lastAt: ev.at,
    }];
  cities.sort((a, b) => b.count - a.count || (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
  return { ...state, total: state.total + 1, cities };
}

export function isOrderCityEvent(value: unknown): value is OrderCityEvent {
  const v = value as Partial<OrderCityEvent> | null;
  return !!v && v.type === 'order_city' && typeof v.key === 'string'
    && typeof v.lat === 'number' && typeof v.lng === 'number' && typeof v.at === 'string';
}
