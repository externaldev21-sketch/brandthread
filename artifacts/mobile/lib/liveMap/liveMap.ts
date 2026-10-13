/**
 * Seller dashboard Live map: shared types and pure helpers.
 *
 * Data comes from GET /api/seller/live-map/today (today's paid orders,
 * city level) and `order_city` events on /ws/seller. Neither carries
 * anything finer than a city: no street, zip, name or order total.
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

export interface LiveMapToday {
  total: number;
  cities: LiveMapCity[];
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

export const EMPTY_LIVE_MAP: LiveMapToday = { total: 0, cities: [] };

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
  return { total: state.total + 1, cities };
}

export function isOrderCityEvent(value: unknown): value is OrderCityEvent {
  const v = value as Partial<OrderCityEvent> | null;
  return !!v && v.type === 'order_city' && typeof v.key === 'string'
    && typeof v.lat === 'number' && typeof v.lng === 'number' && typeof v.at === 'string';
}
