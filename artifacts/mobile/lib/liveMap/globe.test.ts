import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  dragView,
  globeRadius,
  globeRadius as radiusOf,
  hitTest,
  LAND_RING_STARTS,
  LAND_RINGS,
  landPath,
  projectLatLng,
  viewCenteredOn,
  ZOOM_MAX,
  ZOOM_MIN,
} from './globe';
import { globeActivities, globeSpots, recentOrderItemLabel, sessionLabel, timeAgo, type LiveMapRecentOrder, type LiveMapSession } from './liveMap';
import {
  ambientArcEnds,
  ARC_LIFE_MS,
  ARC_SLOTS,
  ARC_TRAVEL_MS,
  arcFrame,
  arcPhase,
  emptyArcSlots,
  liveArcCount,
  makeArc,
  NO_PATH,
  pushArc,
} from './arcs';
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

  it('zoom scales the radius and is clamped', () => {
    expect(clampZoom(0.2)).toBe(ZOOM_MIN);
    expect(clampZoom(99)).toBe(ZOOM_MAX);
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

});

/** Points of an SVG path string from landPath(), per subpath. */
function subpaths(d: string): Array<Array<[number, number]>> {
  return d.split('Z').filter(Boolean).map((part) => [...part.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as [number, number]));
}

/** Even-odd point-in-path test over all subpaths. */
function inside(rings: Array<Array<[number, number]>>, x: number, y: number): boolean {
  let hit = false;
  for (const poly of rings) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

describe('solid land', () => {
  it('ships the real coastline as closed rings of unit vectors', () => {
    expect(LAND_RING_STARTS.length).toBeGreaterThan(50);
    expect(LAND_RINGS.length / 3).toBe(LAND_RING_STARTS[LAND_RING_STARTS.length - 1]);
    expect(LAND_RINGS.length / 3).toBeGreaterThan(1500);
    for (let i = 0; i < LAND_RINGS.length; i += 3 * 97) {
      expect(Math.hypot(LAND_RINGS[i], LAND_RINGS[i + 1], LAND_RINGS[i + 2])).toBeCloseTo(1, 4);
    }
  });

  it('fills continents and leaves oceans empty, on the visible side only', () => {
    // Facing Africa/Europe.
    const view = { yaw: -20 * (Math.PI / 180), pitch: 0.2, zoom: 1 };
    const rings = subpaths(landPath(LAND_RINGS, LAND_RING_STARTS, view, SIZE));
    const at = (lat: number, lng: number) => {
      const [x, y] = projectLatLng(lat, lng, view, SIZE);
      return inside(rings, x, y);
    };
    expect(at(9, 20)).toBe(true); // Chad
    expect(at(48, 10)).toBe(true); // Germany
    expect(at(-20, 25)).toBe(true); // Botswana
    expect(at(0, -20)).toBe(false); // Atlantic
    expect(at(-30, 60)).toBe(false); // Indian Ocean
    // Every vertex is on or inside the globe's disc.
    const r = radiusOf(SIZE, 1);
    for (const ring of rings) for (const [x, y] of ring) expect(Math.hypot(x - SIZE / 2, y - SIZE / 2)).toBeLessThanOrEqual(r + 0.2);
  });

  it('keeps land solid up to the limb: where a continent crosses the horizon the outline follows the rim', () => {
    // Facing the Atlantic: the Americas and Africa/Europe are cut by the limb.
    const view = { yaw: 30 * (Math.PI / 180), pitch: 0, zoom: 1 };
    const rings = subpaths(landPath(LAND_RINGS, LAND_RING_STARTS, view, SIZE));
    const r = radiusOf(SIZE, 1);
    const c = SIZE / 2;
    let onRim = 0;
    for (const ring of rings) for (const [x, y] of ring) if (Math.abs(Math.hypot(x - c, y - c) - r) < 0.3) onRim += 1;
    expect(onRim).toBeGreaterThan(10);
    // Russia (lng ~100E) is behind the globe from here: no land drawn at the
    // matching screen point on the far side.
    expect(projectLatLng(60, 100, view, SIZE)[2]).toBeLessThan(0);
  });

  it('crosses the antimeridian without a lap round the globe (Chukotka, Fiji)', () => {
    // No outline step is longer than a couple of degrees of arc.
    for (let ring = 0; ring + 1 < LAND_RING_STARTS.length; ring += 1) {
      for (let i = LAND_RING_STARTS[ring]; i + 1 < LAND_RING_STARTS[ring + 1]; i += 1) {
        const dot = LAND_RINGS[i * 3] * LAND_RINGS[i * 3 + 3] + LAND_RINGS[i * 3 + 1] * LAND_RINGS[i * 3 + 4] + LAND_RINGS[i * 3 + 2] * LAND_RINGS[i * 3 + 5];
        expect(Math.acos(Math.min(1, dot)) * (180 / Math.PI)).toBeLessThan(2.2);
      }
    }
    // Facing the North Pacific: the Arctic Ocean is open water, Chukotka is land.
    const view = viewCenteredOn(60, 180);
    const rings = subpaths(landPath(LAND_RINGS, LAND_RING_STARTS, view, SIZE));
    const at = (lat: number, lng: number) => {
      const [x, y] = projectLatLng(lat, lng, view, SIZE);
      return inside(rings, x, y);
    };
    expect(at(66, -175)).toBe(true); // Chukotka
    expect(at(64, 100)).toBe(true); // Siberia
    expect(at(50, -170)).toBe(false); // North Pacific
    expect(at(85, 0)).toBe(false); // Arctic Ocean
  });

  it('never returns an empty path (Skia rejects one)', () => {
    expect(landPath([], [0], { yaw: 0, pitch: 0, zoom: 1 }, SIZE)).toBe('M0 0');
  });
});

describe('activity arcs', () => {
  const nyc = { key: 'nyc', lat: 40.71, lng: -74.01 };
  const tokyo = { key: 'tokyo', lat: 35.69, lng: 139.69 };
  const paris = { key: 'paris', lat: 48.85, lng: 2.35 };

  it('darts out, then the tail catches up and the line fades', () => {
    expect(arcPhase(-1)).toBeNull();
    expect(arcPhase(ARC_LIFE_MS)).toBeNull();
    const early = arcPhase(ARC_TRAVEL_MS * 0.25)!;
    const late = arcPhase(ARC_TRAVEL_MS * 0.75)!;
    expect(early.head).toBeGreaterThan(0.25); // ease-out: fast start
    expect(late.head).toBeGreaterThan(early.head);
    expect(early.alpha).toBe(1);
    const fading = arcPhase(ARC_TRAVEL_MS + 450)!;
    expect(fading.head).toBe(1);
    expect(fading.alpha).toBeLessThan(1);
    expect(fading.tail).toBeGreaterThan(late.tail);
  });

  it('caps arcs in flight and recycles the oldest slot', () => {
    let slots = emptyArcSlots();
    expect(slots).toHaveLength(ARC_SLOTS);
    for (let i = 0; i < ARC_SLOTS + 3; i += 1) slots = pushArc(slots, makeArc(paris, nyc, i * 10), i * 10);
    expect(slots).toHaveLength(ARC_SLOTS);
    expect(liveArcCount(slots, 100)).toBe(ARC_SLOTS);
    // The three oldest were replaced by the newest.
    expect(slots.map((s) => s.start).sort((a, b) => a - b)).toEqual([30, 40, 50, 60, 70]);
    // A finished slot is reused before a live one.
    slots = pushArc(slots, makeArc(paris, nyc, 10_000), 10_000);
    expect(liveArcCount(slots, 10_000)).toBe(1);
  });

  it('lifts longer hops higher, and draws only the part in front of the globe', () => {
    expect(makeArc(tokyo, nyc, 0).lift).toBeGreaterThan(makeArc(paris, nyc, 0).lift);
    const view = viewCenteredOn(45, -40); // over the Atlantic
    const arc = makeArc(paris, nyc, 0);
    const mid = arcFrame(arc, ARC_TRAVEL_MS * 0.6, view, SIZE);
    expect(mid.head).not.toBe(NO_PATH);
    expect(mid.headVisible).toBe(true);
    expect(mid.alpha).toBe(1);
    // Facing away (the Pacific), a Paris → New York arc is hidden.
    const away = arcFrame(arc, ARC_TRAVEL_MS * 0.6, viewCenteredOn(0, 160), SIZE);
    expect(away.headVisible).toBe(false);
    expect(away.head).toBe(NO_PATH);
    // Done: nothing drawn.
    expect(arcFrame(arc, ARC_LIFE_MS + 1, view, SIZE).alpha).toBe(0);
  });

  it('ambient arcs take turns from each activity to home, or across to another point', () => {
    const sources = [tokyo, paris, nyc];
    expect(ambientArcEnds(sources, nyc, 0)).toEqual({ from: tokyo, to: nyc });
    expect(ambientArcEnds(sources, nyc, 1)?.from).toBe(paris);
    // The source at home shoots elsewhere instead of to itself.
    const atHome = ambientArcEnds(sources, nyc, 2)!;
    expect(atHome.from).toBe(nyc);
    expect(atHome.to).not.toBe(nyc);
    const noHome = ambientArcEnds(sources, null, 0)!;
    expect(noHome.from).toBe(tokyo);
    expect(noHome.to).not.toBe(tokyo);
    expect(ambientArcEnds([], nyc, 0)).toBeNull();
    expect(ambientArcEnds([tokyo], null, 0)).toBeNull();
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

describe('activity dots', () => {
  const order = (id: string, key: string, at: string): LiveMapRecentOrder => ({
    id, key, at, orderNumber: id, item: 'Coat', itemCount: 1, amountCents: 100, city: key, region: '', country: 'GB', lat: 51.5, lng: -0.1,
  });
  const session = (key: string, count: number): LiveMapSession => ({ key, count, city: key, region: '', country: 'DE', lat: 52.5, lng: 13.4 });

  it('one dot per place with activity: orders first, then places with shoppers right now', () => {
    const list = globeActivities([order('a', 'london', '2'), order('b', 'london', '1')], [session('berlin', 2), session('london', 1), session('empty', 0)]);
    expect(list.map((a) => [a.kind, a.key])).toEqual([['order', 'london'], ['session', 'berlin']]);
    expect(list[0].kind === 'order' && [list[0].count, list[0].sessions]).toEqual([2, 1]);
    expect(globeActivities([], [])).toEqual([]);
  });

  it('labels a session dot "N sessions · City"', () => {
    expect(sessionLabel({ count: 1, city: 'Austin', region: 'TX', country: 'US' })).toBe('1 session · Austin, TX');
    expect(sessionLabel({ count: 3, city: 'Berlin', region: '16', country: 'DE' })).toBe('3 sessions · Berlin, DE');
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

  it('seeds a handful of shoppers right now and a home, so arcs fire in preview', () => {
    const data = previewLiveMap('demo', NOW);
    const sessions = data.sessions ?? [];
    expect(sessions.length).toBeGreaterThanOrEqual(5);
    expect(data.sessionsTotal).toBe(sessions.reduce((n, s) => n + s.count, 0));
    expect(data.home).toMatchObject({ city: 'New York', country: 'US' });
    const activities = globeActivities(data.recent ?? [], sessions);
    // Some shoppers are where no order came from (their own ring dots), some share an order's dot.
    expect(activities.filter((a) => a.kind === 'session').length).toBeGreaterThanOrEqual(4);
    expect(activities.some((a) => a.kind === 'order' && a.sessions > 0)).toBe(true);
    // Enough distinct places that every ambient tick has somewhere to fly.
    const sources = activities.map((a) => ({ key: a.key, lat: a.lat, lng: a.lng }));
    let fired = 0;
    for (let tick = 0; tick < sources.length; tick += 1) if (ambientArcEnds(sources, data.home ?? null, tick)) fired += 1;
    expect(fired).toBeGreaterThanOrEqual(sources.length - 1);
  });

  it('fresh preview has no dots, no sessions, no arcs', () => {
    const fresh = previewLiveMap('fresh', NOW);
    expect(fresh.recent).toEqual([]);
    expect(fresh.sessions).toEqual([]);
    expect(globeActivities(fresh.recent ?? [], fresh.sessions ?? [])).toEqual([]);
  });
});
