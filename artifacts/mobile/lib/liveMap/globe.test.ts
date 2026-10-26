import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  dragView,
  globeRadius,
  hitTest,
  LAND_DOT_COUNT,
  LAND_UNIT,
  projectLatLng,
  viewCenteredOn,
  ZOOM_MAX,
  ZOOM_MIN,
} from './globe';
import { globeSpots, recentOrderItemLabel, timeAgo, type LiveMapRecentOrder } from './liveMap';
import { previewLiveMap } from '../previewLiveMap';
import { popoverPosition, POPOVER_WIDTH } from '../../components/globe/OrderGlobePopover';

const SIZE = 340;

describe('order globe projection', () => {
  it('puts the centred point in the middle of the box, facing the viewer', () => {
    const view = { yaw: 0, pitch: 0, zoom: 1 };
    const [x, y, z] = projectLatLng(0, 0, view, SIZE);
    expect(x).toBeCloseTo(SIZE / 2);
    expect(y).toBeCloseTo(SIZE / 2);
    expect(z).toBeCloseTo(1);
    // The antipode is behind the globe.
    expect(projectLatLng(0, 180, view, SIZE)[2]).toBeCloseTo(-1);
  });

  it('viewCenteredOn faces a city (Tokyo) toward the viewer', () => {
    const view = viewCenteredOn(35.69, 139.69);
    const [x, , z] = projectLatLng(35.69, 139.69, view, SIZE);
    expect(x).toBeCloseTo(SIZE / 2, 0);
    expect(z).toBeGreaterThan(0.9);
  });

  it('places east to the right and north up', () => {
    const view = { yaw: 0, pitch: 0, zoom: 1 };
    expect(projectLatLng(0, 30, view, SIZE)[0]).toBeGreaterThan(SIZE / 2);
    expect(projectLatLng(30, 0, view, SIZE)[1]).toBeLessThan(SIZE / 2);
  });

  it('dragging right turns the globe so content moves right; pitch is clamped', () => {
    const view = { yaw: 0, pitch: 0, zoom: 1 };
    const before = projectLatLng(10, 0, view, SIZE)[0];
    const after = projectLatLng(10, 0, dragView(view, 40, 0, SIZE), SIZE)[0];
    expect(after).toBeGreaterThan(before);
    expect(Math.abs(dragView(view, 0, 100_000, SIZE).pitch)).toBeLessThanOrEqual(1.1);
  });

  it('zoom scales the radius and stays light', () => {
    expect(clampZoom(0.2)).toBe(ZOOM_MIN);
    expect(clampZoom(9)).toBe(ZOOM_MAX);
    expect(globeRadius(SIZE, 1.5)).toBeCloseTo(globeRadius(SIZE, 1) * 1.5);
  });

  it('tap hit-testing finds the visible dot under the finger and ignores dots behind the globe', () => {
    const view = { yaw: 0, pitch: 0, zoom: 1 };
    const front = { id: 'front', lat: 10, lng: 10 };
    const back = { id: 'back', lat: 10, lng: 190 };
    const [fx, fy] = projectLatLng(front.lat, front.lng, view, SIZE);
    expect(hitTest([front, back], view, SIZE, fx + 5, fy - 5)?.id).toBe('front');
    expect(hitTest([front, back], view, SIZE, fx + 60, fy)).toBeNull();
    const [bx, by] = projectLatLng(back.lat, back.lng, view, SIZE);
    expect(hitTest([back], view, SIZE, bx, by)).toBeNull();
  });

  it('ships a real landmass: a few thousand unit vectors', () => {
    expect(LAND_DOT_COUNT).toBeGreaterThan(1500);
    for (let i = 0; i < LAND_UNIT.length; i += 3 * 97) {
      expect(Math.hypot(LAND_UNIT[i], LAND_UNIT[i + 1], LAND_UNIT[i + 2])).toBeCloseTo(1, 4);
    }
  });
});

describe('one dot per place', () => {
  const order = (id: string, key: string, at: string): LiveMapRecentOrder => ({
    id, key, at, orderNumber: id, item: 'Coat', itemCount: 1, amountCents: 100, city: key, region: '', country: 'GB', lat: 51.5, lng: -0.1,
  });

  it('keeps the newest order of each place and counts the rest', () => {
    const spots = globeSpots([order('new', 'london', '3'), order('mid', 'paris', '2'), order('old', 'london', '1')]);
    expect(spots.map((s) => [s.order.id, s.count])).toEqual([['new', 2], ['mid', 1]]);
  });

  it('a tap on two dots at the same point opens the newest (listed first)', () => {
    const view = { yaw: 0, pitch: 0, zoom: 1 };
    const pts = [order('newest', 'a', '2'), order('older', 'b', '1')];
    const [x, y] = projectLatLng(51.5, -0.1, view, SIZE);
    expect(hitTest(pts, view, SIZE, x, y)?.id).toBe('newest');
  });
});

describe('order globe popover', () => {
  it('labels items and time like the popover shows them', () => {
    expect(recentOrderItemLabel({ item: 'Wool Overcoat', itemCount: 1 })).toBe('Wool Overcoat');
    expect(recentOrderItemLabel({ item: 'Wool Overcoat', itemCount: 3 })).toBe('Wool Overcoat + 2 more');
    expect(recentOrderItemLabel({ item: '', itemCount: 2 })).toBe('2 items');
    const now = Date.parse('2026-10-26T12:00:00Z');
    expect(timeAgo('2026-10-26T11:59:30Z', now)).toBe('just now');
    expect(timeAgo('2026-10-26T11:48:00Z', now)).toBe('12m ago');
    expect(timeAgo('2026-10-26T09:00:00Z', now)).toBe('3h ago');
    expect(timeAgo('2026-10-24T09:00:00Z', now)).toBe('2d ago');
  });

  it('stays inside the globe box: above the dot, below it near the top, clamped at the sides', () => {
    expect(popoverPosition(170, 200, 340, 340).top).toBeLessThan(200);
    expect(popoverPosition(170, 30, 340, 340).top).toBeGreaterThan(30);
    expect(popoverPosition(5, 200, 340, 340).left).toBe(8);
    expect(popoverPosition(335, 200, 340, 340).left).toBe(340 - POPOVER_WIDTH - 8);
  });
});

describe('preview globe data (demo store)', () => {
  const NOW = new Date(2026, 9, 26, 15, 30);

  it('seeds ~10 recent orders across varied world cities, newest first, from the one demo order set', () => {
    const data = previewLiveMap('demo', NOW);
    const recent = data.recent ?? [];
    expect(recent.length).toBeGreaterThan(8);
    const countries = new Set(recent.map((o) => o.country));
    expect(countries.size).toBeGreaterThanOrEqual(8);
    for (const c of ['JP', 'FR', 'AU', 'BR', 'DE']) expect(countries.has(c)).toBe(true);
    for (let i = 1; i < recent.length; i += 1) expect(recent[i - 1].at >= recent[i].at).toBe(true);
    for (const order of recent) {
      expect(NOW.getTime() - Date.parse(order.at)).toBeLessThanOrEqual(7 * 86_400_000);
      expect(order.amountCents).toBeGreaterThan(0);
      expect(order.item).not.toBe('');
      expect(order.orderNumber).toMatch(/^BT-/);
    }
  });

  it('fresh preview has no dots', () => {
    expect(previewLiveMap('fresh', NOW).recent).toEqual([]);
  });
});
