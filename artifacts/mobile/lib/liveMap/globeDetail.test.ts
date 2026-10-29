import { describe, expect, it } from 'vitest';
import { autoRotateFactor, landPath, projectLatLng, viewCenteredOn, zoomViewAt, ZOOM_MAX, ZOOM_MIN } from './globe';
import {
  countryBorderLines,
  countryLabelTable,
  detailLevels,
  fadeLabels,
  hasDetail,
  LABEL_FADE_MS,
  labelLayout,
  landHiRings,
  linesPath,
  regionBorderLines,
  regionLabelTable,
} from './globeDetail';
import { COUNTRY_LABEL_ROWS, REGION_LABEL_ROWS } from './globeDetailData';

const SIZE = 358;
/** The view with (lat, lng) dead centre (viewCenteredOn tilts north a little). */
const facing = (lat: number, lng: number, zoom: number) => ({ yaw: (-lng * Math.PI) / 180, pitch: (lat * Math.PI) / 180, zoom });
const layout = (lat: number, lng: number, zoom: number) =>
  labelLayout(countryLabelTable(), regionLabelTable(), facing(lat, lng, zoom), SIZE);

function numbers(path: string): number[] {
  return [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

describe('globe zoom detail', () => {
  it('draws nothing at the default zoom', () => {
    expect(hasDetail(ZOOM_MIN)).toBe(false);
    expect(Object.values(detailLevels(ZOOM_MIN)).every((v) => v === 0)).toBe(true);
    expect(layout(39, -96, ZOOM_MIN)).toEqual([]);
  });

  it('fades layers in with zoom: borders, then country labels, then states', () => {
    const at = (z: number) => detailLevels(z);
    expect(at(1.6).countryBorders).toBeGreaterThan(0);
    expect(at(1.6).regionBorders).toBe(0);
    expect(at(2).countryLabels).toBe(1);
    expect(at(2).regionLabels).toBe(0);
    expect(at(4).regionBorders).toBe(1);
    expect(at(4).regionLabels).toBe(1);
    // Monotonic, no jumps between nearby zooms.
    for (let z = 1; z < 4; z += 0.01) {
      const a = at(z);
      const b = at(z + 0.01);
      expect(b.countryBorders - a.countryBorders).toBeLessThan(0.05);
      expect(b.regionLabels - a.regionLabels).toBeGreaterThanOrEqual(0);
    }
  });

  it('decodes the bundled geometry', () => {
    for (const lines of [landHiRings(), countryBorderLines(), regionBorderLines()]) {
      expect(lines.starts.length).toBeGreaterThan(50);
      expect(lines.pts.length).toBe(lines.starts[lines.starts.length - 1] * 3);
      // Unit vectors.
      expect(Math.hypot(lines.pts[0], lines.pts[1], lines.pts[2])).toBeCloseTo(1, 6);
    }
  });

  it('shows US states over the US once zoomed in, and countries before that', () => {
    const country = layout(39, -96, 2.2).map((l) => l.text);
    expect(country).toContain('United States');
    expect(country.some((t) => t === 'Texas' || t === 'TX')).toBe(false);
    const states = layout(39, -96, 5).map((l) => l.text);
    expect(states).toContain('TX');
    expect(states).toContain('KS');
    // The country name steps aside for its states.
    expect(states).not.toContain('United States');
    const northeast = layout(41.6, -72.5, ZOOM_MAX).map((l) => l.text);
    expect(northeast).toContain('RI');
  });

  it('writes every country out in full and every state as its abbreviation, at any zoom', () => {
    for (const [abbr, name] of COUNTRY_LABEL_ROWS) {
      expect(abbr).toBe(name);
      expect(name).not.toMatch(/\./);
      expect(name).not.toMatch(/^[A-Z]{2,3}$/);
    }
    const stateNames = new Set(REGION_LABEL_ROWS.map((row) => row[1]));
    const codes = new Set(REGION_LABEL_ROWS.map((row) => row[0]));
    for (let zoom = 2.6; zoom <= ZOOM_MAX; zoom *= 1.25) {
      for (const [lat, lng] of [[39, -96], [41.6, -72.5], [-25, 134], [-12, -50], [56, -100]]) {
        for (const l of layout(lat, lng, zoom)) {
          expect(stateNames.has(l.text) && !codes.has(l.text), `${l.text} ×${zoom.toFixed(1)}`).toBe(false);
        }
      }
    }
    // Central America at country level: names, not codes.
    const central = layout(15, -90, 10).map((l) => l.text);
    expect(central).toContain('Guatemala');
    expect(central.some((t) => /^[A-Z]{3}$/.test(t))).toBe(false);
  });

  it('never overlaps two labels or cuts one at the box edge, across views and zooms', () => {
    for (const [lat, lng] of [[39, -96], [50, 10], [-25, 134], [-12, -50], [56, -100], [35, 105], [5, 20]]) {
      for (let zoom = 1.3; zoom <= ZOOM_MAX; zoom *= 1.17) {
        for (const dyaw of [0, 0.3, -0.45]) {
          const v = facing(lat, lng, zoom);
          const items = labelLayout(countryLabelTable(), regionLabelTable(), { ...v, yaw: v.yaw + dyaw / zoom }, SIZE).filter((l) => l.alpha > 0.15);
          for (const l of items) {
            expect(l.x - l.width / 2).toBeGreaterThanOrEqual(0);
            expect(l.x + l.width / 2).toBeLessThanOrEqual(SIZE);
          }
          for (let i = 0; i < items.length; i += 1) {
            for (let j = i + 1; j < items.length; j += 1) {
              const a = items[i];
              const b = items[j];
              const ox = Math.min(a.x + a.width / 2, b.x + b.width / 2) - Math.max(a.x - a.width / 2, b.x - b.width / 2);
              const oy = Math.min(a.y + a.font / 2, b.y + b.font / 2) - Math.max(a.y - a.font / 2, b.y - b.font / 2);
              expect(ox > 0.5 && oy > 0.5, `${a.text} / ${b.text} at ${lat},${lng} ×${zoom.toFixed(2)}`).toBe(false);
            }
          }
        }
      }
    }
  });

  it('borders and the zoomed coastline stay inside the box', () => {
    const view = facing(39, -96, 8);
    const cb = countryBorderLines();
    const rb = regionBorderLines();
    const hi = landHiRings();
    for (const d of [linesPath(cb.pts, cb.starts, view, SIZE), linesPath(rb.pts, rb.starts, view, SIZE), landPath(hi.pts, hi.starts, view, SIZE)]) {
      const xs = numbers(d);
      expect(xs.length).toBeGreaterThan(10);
      for (const x of xs) {
        expect(x).toBeGreaterThanOrEqual(-60);
        expect(x).toBeLessThanOrEqual(SIZE + 60);
      }
    }
    // Land is clipped to the box (4 pt slack).
    for (const x of numbers(landPath(hi.pts, hi.starts, view, SIZE))) {
      expect(x).toBeGreaterThanOrEqual(-4.05);
      expect(x).toBeLessThanOrEqual(SIZE + 4.05);
    }
    // Borders on the far side of the globe draw nothing.
    expect(linesPath(rb.pts, rb.starts, viewCenteredOn(-50, -150, 3), SIZE)).toBe('M0 0');
  });
});

describe('label fade', () => {
  const label = (key: string, alpha: number) => ({ key, text: key, x: 10, y: 10, alpha, font: 10, width: 20 });

  it('shows labels in full or not at all once settled, fading between over a short time', () => {
    const items = [label('a', 0.9), label('b', 0.3), label('c', 0.5)];
    const start = fadeLabels(items, {}, 16, false);
    expect(start.settled).toBe(false);
    expect(start.draw.map((l) => l.key)).toEqual(['a', 'c']);
    expect(start.draw[0].alpha).toBeCloseTo(16 / LABEL_FADE_MS);
    let state = start.state;
    let res = start;
    for (let t = 0; t < LABEL_FADE_MS; t += 16) {
      res = fadeLabels(items, state, 16, false);
      state = res.state;
    }
    expect(res.settled).toBe(true);
    expect(res.draw.map((l) => [l.key, l.alpha])).toEqual([['a', 1], ['c', 1]]);
    // Switching off fades out, then drops the label.
    const off = fadeLabels([label('a', 0.1), label('c', 1)], state, LABEL_FADE_MS / 2, false);
    expect(off.draw.find((l) => l.key === 'a')?.alpha).toBeCloseTo(0.5);
    expect(fadeLabels([label('a', 0.1)], off.state, LABEL_FADE_MS, false).draw).toEqual([]);
  });

  it('skips the fade with Reduce Motion', () => {
    const res = fadeLabels([label('a', 0.8)], {}, 1, true);
    expect(res.settled).toBe(true);
    expect(res.draw[0].alpha).toBe(1);
  });

  it('settled layouts draw every label at the same full strength', () => {
    for (const zoom of [1.8, 2.3, 4, 8, 16]) {
      const items = layout(39, -96, zoom);
      const drawn = fadeLabels(items, {}, 0, true).draw;
      expect(drawn.every((l) => l.alpha === 1)).toBe(true);
    }
  });
});

describe('order globe zoom gestures', () => {
  it('zooms about the focal point: the place under the fingers stays put', () => {
    const view = viewCenteredOn(39, -96, 2);
    const [fx, fy] = projectLatLng(41, -88, view, SIZE);
    const next = zoomViewAt(view, 5, fx, fy, SIZE);
    expect(next.zoom).toBe(5);
    const [x, y] = projectLatLng(41, -88, next, SIZE);
    expect(Math.hypot(x - fx, y - fy)).toBeLessThan(3);
    expect(zoomViewAt(view, 999, fx, fy, SIZE).zoom).toBe(ZOOM_MAX);
  });

  it('keeps auto-rotation at the default zoom and stops it once zoomed in', () => {
    expect(autoRotateFactor(ZOOM_MIN)).toBe(1);
    expect(autoRotateFactor(1.15)).toBe(1);
    expect(autoRotateFactor(2)).toBe(0);
  });
});
