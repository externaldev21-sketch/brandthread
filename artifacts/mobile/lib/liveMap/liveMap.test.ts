import { describe, expect, it } from 'vitest';
import { applyOrderCity, EMPTY_LIVE_MAP, isOrderCityEvent, liveMapCityLabel, liveMapDotRadius, type OrderCityEvent } from './liveMap';
import { projectLatLng, WORLD_LAND_PATH, WORLD_VIEWBOX } from './worldLand';
import { previewLiveMap } from '../previewLiveMap';
import { buildPreviewSellerAnalytics } from '../previewSellerChartData';

const ev = (key: string, at: string, extra: Partial<OrderCityEvent> = {}): OrderCityEvent => ({
  type: 'order_city', key, city: 'Austin', region: 'TX', country: 'US', lat: 30.27, lng: -97.74, at, ...extra,
});

describe('live map helpers', () => {
  it('labels cities US-style, elsewhere by country, and fallbacks by region/country', () => {
    expect(liveMapCityLabel({ city: 'Austin', region: 'TX', country: 'US' })).toBe('Austin, TX');
    expect(liveMapCityLabel({ city: 'Berlin', region: '16', country: 'DE' })).toBe('Berlin, DE');
    expect(liveMapCityLabel({ city: '', region: 'TX', country: 'US' })).toBe('TX, US');
    expect(['Germany', 'DE']).toContain(liveMapCityLabel({ city: '', region: '', country: 'DE' }));
  });

  it('keeps dots small: min for one order, capped for the busiest city', () => {
    expect(liveMapDotRadius(1, 1)).toBeCloseTo(2.6);
    expect(liveMapDotRadius(1, 9)).toBeCloseTo(2.6);
    expect(liveMapDotRadius(9, 9)).toBeCloseTo(5.2);
    expect(liveMapDotRadius(4, 9)).toBeGreaterThan(2.6);
    expect(liveMapDotRadius(4, 9)).toBeLessThan(5.2);
  });

  it('folds an order_city event into today: new city, then increments', () => {
    const a = applyOrderCity(EMPTY_LIVE_MAP, ev('US:TX:austin', '2026-10-13T10:00:00.000Z'));
    expect(a.total).toBe(1);
    expect(a.cities).toHaveLength(1);
    const b = applyOrderCity(a, ev('US:TX:austin', '2026-10-13T11:00:00.000Z'));
    expect(b.total).toBe(2);
    expect(b.cities[0]).toMatchObject({ key: 'US:TX:austin', count: 2, lastAt: '2026-10-13T11:00:00.000Z' });
    const c = applyOrderCity(b, ev('DE:16:berlin', '2026-10-13T12:00:00.000Z', { city: 'Berlin', region: '16', country: 'DE' }));
    expect(c.cities.map((x) => x.key)).toEqual(['US:TX:austin', 'DE:16:berlin']);
    expect(EMPTY_LIVE_MAP.total).toBe(0);
  });

  it('accepts only well-formed order_city events', () => {
    expect(isOrderCityEvent(ev('k', 'x'))).toBe(true);
    expect(isOrderCityEvent({ type: 'order_city', key: 'k' })).toBe(false);
    expect(isOrderCityEvent({ type: 'comment' })).toBe(false);
    expect(isOrderCityEvent(null)).toBe(false);
  });

  it('projects lat/lng onto the land path grid', () => {
    expect(projectLatLng(0, 0)).toEqual({ x: 360, y: 168 });
    expect(projectLatLng(84, -180)).toEqual({ x: 0, y: 0 });
    expect(projectLatLng(-90, 180)).toEqual({ x: 720, y: WORLD_VIEWBOX.height });
    expect(WORLD_LAND_PATH.length).toBeLessThan(16_000);
  });

  it('preview: demo is the same set of orders the dashboard counts for today; fresh is empty', () => {
    // Several clocks, including the screenshot harness's (2026-09-18 16:30 LA).
    const clocks = [new Date(Date.parse('2026-09-18T23:30:00Z')), new Date(2026, 9, 13, 15, 0, 0), new Date(2026, 9, 17, 21, 30, 0)];
    for (const now of clocks) {
      const demo = previewLiveMap('demo', now);
      const tile = buildPreviewSellerAnalytics('today', 'demo', now);
      expect(demo.total).toBe(tile.orderCount);
      expect(demo.cities.reduce((s, c) => s + c.count, 0)).toBe(demo.total);
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      for (const c of demo.cities) {
        expect(new Date(c.lastAt).getTime()).toBeGreaterThanOrEqual(midnight);
        expect(new Date(c.lastAt).getTime()).toBeLessThanOrEqual(now.getTime());
      }
    }
    expect(previewLiveMap('fresh', clocks[0])).toEqual({ total: 0, cities: [] });
  });
});
