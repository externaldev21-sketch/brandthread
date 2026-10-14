/**
 * Seller dashboard Live map data for the signed-out web preview only
 * (`?bt_preview=seller`). Real sellers always read
 * GET /api/seller/live-map/today.
 *
 * `?demo=1` is derived from the SAME demo orders the dashboard counts for
 * today (lib/previewSellerOrders.ts `ordersForDay`, which also feeds the
 * preview "today" chart and Orders tile), so the Live count always equals
 * the Today Orders count on the same screen. Fresh shows the empty map.
 */
import { EMPTY_LIVE_MAP, type LiveMapCity, type LiveMapToday } from '@/lib/liveMap/liveMap';
import { ordersForDay } from '@/lib/previewSellerOrders';

// City-level points for the demo customers' shipping cities, in the same
// shape the server's gazetteer returns (key, display name, admin1, country).
const DEMO_CITY_POINTS: Record<string, Omit<LiveMapCity, 'count' | 'lastAt'>> = {
  'US|new york': { key: 'US:NY:new york city', city: 'New York', region: 'NY', country: 'US', lat: 40.71, lng: -74.01 },
  'US|brooklyn': { key: 'US:NY:brooklyn', city: 'Brooklyn', region: 'NY', country: 'US', lat: 40.65, lng: -73.95 },
  'US|los angeles': { key: 'US:CA:los angeles', city: 'Los Angeles', region: 'CA', country: 'US', lat: 34.05, lng: -118.24 },
  'US|austin': { key: 'US:TX:austin', city: 'Austin', region: 'TX', country: 'US', lat: 30.27, lng: -97.74 },
  'US|portland': { key: 'US:OR:portland', city: 'Portland', region: 'OR', country: 'US', lat: 45.52, lng: -122.68 },
  'US|seattle': { key: 'US:WA:seattle', city: 'Seattle', region: 'WA', country: 'US', lat: 47.61, lng: -122.33 },
  'US|miami': { key: 'US:FL:miami', city: 'Miami', region: 'FL', country: 'US', lat: 25.77, lng: -80.19 },
  'GB|london': { key: 'GB:ENG:london', city: 'London', region: 'ENG', country: 'GB', lat: 51.51, lng: -0.13 },
};

export function previewLiveMap(mode: 'demo' | 'fresh', now: Date = new Date()): LiveMapToday {
  if (mode === 'fresh') return EMPTY_LIVE_MAP;
  // Same predicate as the server: paid and not cancelled, today (local).
  const today = ordersForDay(now.getFullYear(), now.getMonth(), now.getDate(), now)
    .filter((o) => o.paidAt && o.status !== 'cancelled');
  const byKey = new Map<string, LiveMapCity>();
  for (const order of today) {
    const addr = order.shippingAddress;
    const point = addr ? DEMO_CITY_POINTS[`${addr.country}|${addr.city.toLowerCase()}`] : undefined;
    if (!point) continue;
    const at = order.paidAt as string;
    const existing = byKey.get(point.key);
    if (existing) {
      existing.count += 1;
      if (at > existing.lastAt) existing.lastAt = at;
    } else {
      byKey.set(point.key, { ...point, count: 1, lastAt: at });
    }
  }
  const cities = [...byKey.values()].sort((a, b) => b.count - a.count || (a.lastAt < b.lastAt ? 1 : -1));
  return { total: today.length, cities };
}
