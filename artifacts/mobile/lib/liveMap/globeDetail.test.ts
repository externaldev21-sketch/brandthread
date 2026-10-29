import { describe, expect, it } from 'vitest';
import { autoRotateFactor, landPath, projectLatLng, viewCenteredOn, zoomViewAt, ZOOM_MAX, ZOOM_MIN } from './globe';
import {
  countryBorderLines,
  countryLabelTable,
  detailLevels,
  hasDetail,
  labelLayout,
  landHiRings,
  linesPath,
  regionBorderLines,
  regionLabelTable,
} from './globeDetail';

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
    expect(states.some((t) => t === 'Texas' || t === 'TX')).toBe(true);
    expect(states.some((t) => t === 'Kansas' || t === 'KS')).toBe(true);
    // The country name steps aside for its states.
    expect(states).not.toContain('United States');
    const northeast = layout(41.6, -72.5, ZOOM_MAX).map((l) => l.text);
    expect(northeast.some((t) => t === 'RI' || t === 'Rhode Island')).toBe(true);
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
