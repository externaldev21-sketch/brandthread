/**
 * Seller dashboard Live map data for the signed-out web preview only
 * (`?bt_preview=seller`). `?demo=1` shows a handful of real US/EU cities;
 * a fresh preview shows the honest empty map. Real sellers always read
 * GET /api/seller/live-map/today.
 */
import { EMPTY_LIVE_MAP, type LiveMapToday } from '@/lib/liveMap/liveMap';

const DEMO_CITIES: Array<[key: string, city: string, region: string, country: string, lat: number, lng: number, count: number]> = [
  ['US:TX:austin', 'Austin', 'TX', 'US', 30.27, -97.74, 3],
  ['US:NY:new york city', 'New York City', 'NY', 'US', 40.71, -74.01, 2],
  ['GB:ENG:london', 'London', 'ENG', 'GB', 51.51, -0.13, 2],
  ['US:CA:los angeles', 'Los Angeles', 'CA', 'US', 34.05, -118.24, 1],
  ['US:IL:chicago', 'Chicago', 'IL', 'US', 41.85, -87.65, 1],
  ['FR:11:paris', 'Paris', '11', 'FR', 48.85, 2.35, 1],
  ['DE:16:berlin', 'Berlin', '16', 'DE', 52.52, 13.41, 1],
];

export function previewLiveMap(mode: 'demo' | 'fresh', now: Date = new Date()): LiveMapToday {
  if (mode === 'fresh') return EMPTY_LIVE_MAP;
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const cities = DEMO_CITIES.map(([key, city, region, country, lat, lng, count], i) => ({
    key, city, region, country, lat, lng, count,
    // Spread over the day so far, most recent first; never before midnight.
    lastAt: new Date(Math.max(midnight + 60_000, now.getTime() - (i + 1) * 23 * 60_000)).toISOString(),
  }));
  return { total: cities.reduce((sum, c) => sum + c.count, 0), cities };
}
