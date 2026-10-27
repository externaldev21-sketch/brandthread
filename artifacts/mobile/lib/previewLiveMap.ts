/**
 * Seller dashboard Live map / order globe data for the signed-out web
 * preview only (`?bt_preview=seller`). Real sellers always read
 * GET /api/seller/live-map/today.
 *
 * `?demo=1` is derived from the SAME demo orders the dashboard counts
 * (lib/previewSellerOrders.ts `ordersForDay`, which also feeds the preview
 * chart and Orders tile), with the server's own rules: `total`/`cities` are
 * today's paid, non-cancelled orders (so the Live count equals the Today
 * Orders count on the same screen), and `recent` is the last 7 days of them,
 * newest first, capped like the server. Demo also has a handful of
 * shoppers on the store right now (`sessions`, the globe's visitor dots) and
 * a home (New York, where the demo store ships from) for order arcs to land
 * on, so the preview shows the whole effect. Fresh shows the empty globe.
 */
import { EMPTY_LIVE_MAP, type LiveMapCity, type LiveMapHome, type LiveMapRecentOrder, type LiveMapSession, type LiveMapToday } from '@/lib/liveMap/liveMap';
import { ordersForDay, type PreviewSellerOrder } from '@/lib/previewSellerOrders';

/** Same window and cap as routes/seller-live-map.ts (RECENT_WINDOW_DAYS / RECENT_LIMIT). */
const RECENT_WINDOW_DAYS = 7;
const RECENT_LIMIT = 60;

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
  'JP|tokyo': { key: 'JP:40:tokyo', city: 'Tokyo', region: '40', country: 'JP', lat: 35.69, lng: 139.69 },
  'FR|paris': { key: 'FR:11:paris', city: 'Paris', region: '11', country: 'FR', lat: 48.85, lng: 2.35 },
  'AU|sydney': { key: 'AU:02:sydney', city: 'Sydney', region: '02', country: 'AU', lat: -33.87, lng: 151.21 },
  'BR|são paulo': { key: 'BR:27:sao paulo', city: 'São Paulo', region: '27', country: 'BR', lat: -23.55, lng: -46.64 },
  'DE|berlin': { key: 'DE:16:berlin', city: 'Berlin', region: '16', country: 'DE', lat: 52.52, lng: 13.41 },
  'CA|toronto': { key: 'CA:08:toronto', city: 'Toronto', region: '08', country: 'CA', lat: 43.7, lng: -79.42 },
  'KR|seoul': { key: 'KR:11:seoul', city: 'Seoul', region: '11', country: 'KR', lat: 37.57, lng: 126.98 },
  'AE|dubai': { key: 'AE:03:dubai', city: 'Dubai', region: '03', country: 'AE', lat: 25.08, lng: 55.31 },
  'MX|mexico city': { key: 'MX:09:mexico city', city: 'Mexico City', region: '09', country: 'MX', lat: 19.43, lng: -99.13 },
  'ZA|cape town': { key: 'ZA:11:cape town', city: 'Cape Town', region: '11', country: 'ZA', lat: -33.93, lng: 18.42 },
};

/**
 * Demo shoppers browsing right now, by city: mostly places with no recent
 * order (so their own ring dots show), two where orders came from too.
 */
const DEMO_SESSIONS: Array<[Omit<LiveMapSession, 'count'>, number]> = [
  [{ key: 'US:IL:chicago', city: 'Chicago', region: 'IL', country: 'US', lat: 41.88, lng: -87.63 }, 2],
  [{ key: 'SE:26:stockholm', city: 'Stockholm', region: '26', country: 'SE', lat: 59.33, lng: 18.07 }, 1],
  [{ key: 'IN:16:mumbai', city: 'Mumbai', region: '16', country: 'IN', lat: 19.08, lng: 72.88 }, 1],
  [{ key: 'SG:01:singapore', city: 'Singapore', region: '01', country: 'SG', lat: 1.29, lng: 103.85 }, 1],
  [{ key: 'NG:05:lagos', city: 'Lagos', region: '05', country: 'NG', lat: 6.45, lng: 3.39 }, 1],
  [{ key: 'AR:07:buenos aires', city: 'Buenos Aires', region: '07', country: 'AR', lat: -34.6, lng: -58.38 }, 1],
  [DEMO_CITY_POINTS['US|austin'], 2],
  [DEMO_CITY_POINTS['GB|london'], 1],
];

const DEMO_HOME: LiveMapHome = { ...DEMO_CITY_POINTS['US|new york'] };

function pointFor(order: PreviewSellerOrder) {
  const addr = order.shippingAddress;
  return addr ? DEMO_CITY_POINTS[`${addr.country}|${addr.city.toLowerCase()}`] : undefined;
}

/** Same predicate as the server: paid and not cancelled. */
function counts(order: PreviewSellerOrder): boolean {
  return !!order.paidAt && order.status !== 'cancelled';
}

/** The order's largest line by product name, like the server's `item`. */
function mainItem(order: PreviewSellerOrder): string {
  const [top] = [...(order.items ?? [])].sort((a, b) => b.priceCents * b.quantity - a.priceCents * a.quantity || a.productName.localeCompare(b.productName));
  return top?.productName ?? '';
}

export function previewLiveMap(mode: 'demo' | 'fresh', now: Date = new Date()): LiveMapToday {
  if (mode === 'fresh') return EMPTY_LIVE_MAP;
  const today = ordersForDay(now.getFullYear(), now.getMonth(), now.getDate(), now).filter(counts);
  const byKey = new Map<string, LiveMapCity>();
  for (const order of today) {
    const point = pointFor(order);
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

  const since = now.getTime() - RECENT_WINDOW_DAYS * 86_400_000;
  const window: PreviewSellerOrder[] = [];
  for (let back = 0; back <= RECENT_WINDOW_DAYS; back += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    window.push(...ordersForDay(day.getFullYear(), day.getMonth(), day.getDate(), now));
  }
  const recent: LiveMapRecentOrder[] = window
    .filter((o) => counts(o) && new Date(o.paidAt as string).getTime() >= since)
    .sort((a, b) => (b.paidAt as string).localeCompare(a.paidAt as string) || b.id.localeCompare(a.id))
    .flatMap((order) => {
      const point = pointFor(order);
      if (!point) return [];
      return [{
        id: order.id,
        orderNumber: order.orderNumber,
        item: mainItem(order),
        itemCount: order.items?.length ?? order.itemCount ?? 0,
        amountCents: order.totalCents,
        key: point.key,
        city: point.city,
        region: point.region,
        country: point.country,
        lat: point.lat,
        lng: point.lng,
        at: order.paidAt as string,
      }];
    })
    .slice(0, RECENT_LIMIT);

  const sessions: LiveMapSession[] = DEMO_SESSIONS
    .map(([place, count]) => ({ ...place, count }))
    .sort((a, b) => b.count - a.count);
  return { total: today.length, cities, recent, sessions, sessionsTotal: sessions.reduce((n, x) => n + x.count, 0), home: DEMO_HOME };
}
