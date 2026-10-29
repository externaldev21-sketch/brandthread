/**
 * Order globe math, shared by every renderer (Skia on native, canvas on
 * web) and by tap hit-testing, so a dot is drawn and tapped at the same
 * place. Orthographic projection of a unit sphere: screen X right, Y down,
 * Z toward the viewer; a point is on the visible hemisphere when z > 0.
 *
 * View state is two angles and a zoom:
 *   yaw   rotates about the polar axis (drag sideways, auto-rotate),
 *   pitch tilts the poles toward/away from the viewer (drag up/down),
 *   zoom  scales the radius (pinch / scroll), clamped to [ZOOM_MIN, ZOOM_MAX].
 *         Zoomed in, lib/liveMap/globeDetail.ts fades in borders and names.
 *
 * Functions are plain math marked 'worklet' so Reanimated can run them on
 * the UI thread; on web and in tests they are ordinary functions.
 */
import { WORLD_LAND_PATH, WORLD_LAT_TOP } from './worldLand';

export interface GlobeView { yaw: number; pitch: number; zoom: number }

export const ZOOM_MIN = 1;
/** Close enough to read a small US state (Rhode Island) on a phone-width globe. */
export const ZOOM_MAX = 18;
export const PITCH_LIMIT = 1.1;
/** Radians per second: one lap in ~70s, slow enough to read the dots. */
export const AUTO_ROTATE_SPEED = 0.09;
/** Auto-rotate waits this long after the seller lets go. */
export const AUTO_ROTATE_RESUME_MS = 2500;
/** Radians per screen point of drag at zoom 1, scaled by the radius. */
export const DRAG_GAIN = 1;
/** Tap radius around a dot, in screen points. */
export const HIT_SLOP = 22;

const DEG = Math.PI / 180;

/**
 * The landmass as closed rings of unit vectors, parsed once from the Live
 * map's own outline (lib/liveMap/worldLand.ts, Natural Earth 1:110m), so the
 * globe and the flat fallback show the same coastlines. Long outline edges
 * are split so no step exceeds LAND_MAX_STEP_DEG: a straight 3D chord between
 * far-apart vertices would cut inside the sphere once projected.
 *
 * LAND_RINGS holds [x, y, z, …] for every vertex of every ring;
 * LAND_RING_STARTS[i] is ring i's first vertex index, with a final sentinel.
 */
const LAND_MAX_STEP_DEG = 1.5;

function parseLandRings(): { rings: number[]; starts: number[] } {
  const rings: number[] = [];
  const starts: number[] = [];
  let vertex = 0;
  for (const part of WORLD_LAND_PATH.split('Z')) {
    const pts = [...part.matchAll(/[ML](-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g)].map((m) => [
      WORLD_LAT_TOP - Number(m[2]) / 2,
      Number(m[1]) / 2 - 180,
    ]);
    if (pts.length < 3) continue;
    starts.push(vertex);
    for (let i = 0; i < pts.length; i += 1) {
      const [la0, lo0] = pts[i];
      const [la1, lo1Raw] = pts[(i + 1) % pts.length];
      // Eurasia and Fiji cross the antimeridian: the flat outline jumps from
      // -180 to 180 there, which on the sphere is a step of zero, not a lap.
      const lo1 = lo1Raw - lo0 > 180 ? lo1Raw - 360 : lo1Raw - lo0 < -180 ? lo1Raw + 360 : lo1Raw;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(la1 - la0), Math.abs(lo1 - lo0)) / LAND_MAX_STEP_DEG));
      for (let k = 0; k < steps; k += 1) {
        const la = (la0 + ((la1 - la0) * k) / steps) * DEG;
        const lo = (lo0 + ((lo1 - lo0) * k) / steps) * DEG;
        rings.push(Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo));
        vertex += 1;
      }
    }
  }
  starts.push(vertex);
  return { rings, starts };
}

const PARSED_LAND = parseLandRings();
export const LAND_RINGS: readonly number[] = PARSED_LAND.rings;
export const LAND_RING_STARTS: readonly number[] = PARSED_LAND.starts;

export function clampZoom(zoom: number): number {
  'worklet';
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

export function clampPitch(pitch: number): number {
  'worklet';
  return Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, pitch));
}

/** Globe radius in points for a square box of `size` at `zoom`, leaving room for the rim glow. */
export function globeRadius(size: number, zoom: number): number {
  'worklet';
  return size * 0.42 * zoom;
}

/**
 * Rotates a unit vector by the view and projects it into a box of `size`.
 * Returns [screenX, screenY, depth] with depth = rotated z in [-1, 1].
 */
export function projectUnit(x: number, y: number, z: number, view: GlobeView, size: number): [number, number, number] {
  'worklet';
  const cy = Math.cos(view.yaw);
  const sy = Math.sin(view.yaw);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const cp = Math.cos(view.pitch);
  const sp = Math.sin(view.pitch);
  const y2 = y * cp - z1 * sp;
  const z2 = y * sp + z1 * cp;
  const r = globeRadius(size, view.zoom);
  return [size / 2 + x1 * r, size / 2 - y2 * r, z2];
}

export function projectLatLng(lat: number, lng: number, view: GlobeView, size: number): [number, number, number] {
  'worklet';
  const la = lat * DEG;
  const lo = lng * DEG;
  return projectUnit(Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo), view, size);
}

/** The view that puts (lat, lng) in the middle of the globe, slightly tilted toward the north. */
export function viewCenteredOn(lat: number, lng: number, zoom = ZOOM_MIN): GlobeView {
  return { yaw: -lng * DEG, pitch: clampPitch(lat * DEG * 0.6 + 0.12), zoom };
}

/**
 * How much of the auto-rotation runs at a zoom: all of it at the default
 * zoom, easing to none once zoomed in, so a country or state being read
 * doesn't drift away.
 */
export function autoRotateFactor(zoom: number): number {
  'worklet';
  return Math.min(1, Math.max(0, (1.6 - zoom) / 0.45));
}

/** Applies a drag of (dx, dy) points to a view. Dragging right turns the globe right; down tilts the north toward you. */
export function dragView(view: GlobeView, dx: number, dy: number, size: number): GlobeView {
  'worklet';
  const r = Math.max(1, globeRadius(size, view.zoom));
  return { yaw: view.yaw + (dx / r) * DRAG_GAIN, pitch: clampPitch(view.pitch + (dy / r) * DRAG_GAIN), zoom: view.zoom };
}

/**
 * The view zoomed to `zoom` about a focal point (fx, fy) in the box (the
 * pinch midpoint, the cursor), so the place under the fingers stays put.
 * Finds that place on the sphere, then turns the zoomed globe until it is
 * back under (fx, fy); off the globe, zooms about the centre.
 */
export function zoomViewAt(view: GlobeView, zoom: number, fx: number, fy: number, size: number): GlobeView {
  'worklet';
  const next = clampZoom(zoom);
  const c = size / 2;
  const r0 = Math.max(1, globeRadius(size, view.zoom));
  const sx = (fx - c) / r0;
  const sy = (c - fy) / r0;
  const d2 = sx * sx + sy * sy;
  if (d2 >= 0.95) return { yaw: view.yaw, pitch: view.pitch, zoom: next };
  const sz = Math.sqrt(1 - d2);
  // projectUnit's rotation, undone: pitch, then yaw.
  const cp = Math.cos(view.pitch);
  const sp = Math.sin(view.pitch);
  const y = sy * cp + sz * sp;
  const z1 = -sy * sp + sz * cp;
  const cy = Math.cos(view.yaw);
  const syw = Math.sin(view.yaw);
  const x = sx * cy - z1 * syw;
  const z = sx * syw + z1 * cy;
  let v: GlobeView = { yaw: view.yaw, pitch: view.pitch, zoom: next };
  for (let i = 0; i < 4; i += 1) {
    const p = projectUnit(x, y, z, v, size);
    v = dragView(v, fx - p[0], fy - p[1], size);
  }
  return v;
}

/**
 * The visible dot nearest a tap, within HIT_SLOP points, or null. Only the
 * front hemisphere is tappable (a dot behind the globe isn't drawn).
 */
export function hitTest<T extends { lat: number; lng: number }>(
  points: readonly T[],
  view: GlobeView,
  size: number,
  tapX: number,
  tapY: number,
): T | null {
  let best: T | null = null;
  let bestDist = HIT_SLOP * HIT_SLOP + 1e-6;
  for (const point of points) {
    const [sx, sy, depth] = projectLatLng(point.lat, point.lng, view, size);
    if (depth <= 0.05) continue;
    const dist = (sx - tapX) ** 2 + (sy - tapY) ** 2;
    // Strictly closer wins, so on a tie the earlier (newest) point is kept.
    if (dist < bestDist) {
      best = point;
      bestDist = dist;
    }
  }
  return best;
}

/** 0 → 1 → 0 pulse for an order dot, staggered per dot so they don't blink in unison. */
export function pulsePhase(timeMs: number, index: number, periodMs = 2400): number {
  'worklet';
  const t = ((timeMs + index * 377) % periodMs) / periodMs;
  return t;
}

/** Off-box slack for clipped land, so the fill's edge never shows. */
const BOX_MARGIN = 4;

function ringPath(px: readonly number[], py: readonly number[]): string {
  'worklet';
  let out = '';
  for (let i = 0; i < px.length; i += 1) out += `${i === 0 ? 'M' : 'L'}${px[i].toFixed(1)} ${py[i].toFixed(1)}`;
  return out ? `${out}Z` : '';
}

/**
 * A closed ring clipped to the square [lo, hi]² (Sutherland–Hodgman, one
 * box edge at a time). Zoomed in, most of the globe is off the box; clipping
 * keeps the path (and the fill's work) to what is on screen, and clipping
 * each ring on its own keeps the even-odd fill right inside the box.
 */
function ringPathClipped(px: readonly number[], py: readonly number[], lo: number, hi: number): string {
  'worklet';
  let xs: number[] = px.slice();
  let ys: number[] = py.slice();
  for (let edge = 0; edge < 4 && xs.length > 0; edge += 1) {
    const ox: number[] = [];
    const oy: number[] = [];
    const n = xs.length;
    for (let i = 0; i < n; i += 1) {
      const ax = xs[i];
      const ay = ys[i];
      const bx = xs[(i + 1) % n];
      const by = ys[(i + 1) % n];
      // Signed distance inside the edge: x ≥ lo, x ≤ hi, y ≥ lo, y ≤ hi.
      const da = edge === 0 ? ax - lo : edge === 1 ? hi - ax : edge === 2 ? ay - lo : hi - ay;
      const db = edge === 0 ? bx - lo : edge === 1 ? hi - bx : edge === 2 ? by - lo : hi - by;
      if (da >= 0) {
        ox.push(ax);
        oy.push(ay);
      }
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        ox.push(ax + (bx - ax) * t);
        oy.push(ay + (by - ay) * t);
      }
    }
    xs = ox;
    ys = oy;
  }
  return xs.length >= 3 ? ringPath(xs, ys) : '';
}

/** Angle step (radians) for the stretch of a land ring that runs along the horizon. */
const LIMB_STEP = 0.12;

/**
 * The visible half of the landmass as one SVG path string (screen points,
 * fill with the even-odd rule), for a view and a box of `size`.
 *
 * Each ring is rotated by the view and clipped against the horizon plane
 * (z = 0, Sutherland–Hodgman). Where a coastline goes behind the globe, the
 * clipped outline follows the limb circle from where it left to where it
 * comes back (the short way round; no land ring spans a hemisphere), so land
 * at the edge of the globe stays solid up to the rim instead of being cut by
 * a chord.
 */
export function landPath(rings: readonly number[], starts: readonly number[], view: GlobeView, size: number): string {
  'worklet';
  const cy = Math.cos(view.yaw);
  const sy = Math.sin(view.yaw);
  const cp = Math.cos(view.pitch);
  const sp = Math.sin(view.pitch);
  const r = globeRadius(size, view.zoom);
  const c = size / 2;
  // Zoomed in past the box, rings are clipped to it; otherwise drawn whole.
  const overflows = r > c;
  // The limb stays a smooth curve on a globe zoomed past the box.
  const limbStep = overflows ? Math.min(LIMB_STEP, 24 / r) : LIMB_STEP;
  let d = '';
  for (let ring = 0; ring + 1 < starts.length; ring += 1) {
    const from = starts[ring];
    const n = starts[ring + 1] - from;
    // Rotate the ring once; X right, Y up, Z toward the viewer.
    const xs: number[] = new Array(n);
    const ys: number[] = new Array(n);
    const zs: number[] = new Array(n);
    let firstVisible = -1;
    for (let i = 0; i < n; i += 1) {
      const o = (from + i) * 3;
      const x = rings[o];
      const y = rings[o + 1];
      const z = rings[o + 2];
      const x1 = x * cy + z * sy;
      const z1 = -x * sy + z * cy;
      xs[i] = x1;
      ys[i] = y * cp - z1 * sp;
      zs[i] = y * sp + z1 * cp;
      if (firstVisible < 0 && zs[i] >= 0) firstVisible = i;
    }
    if (firstVisible < 0) continue;
    let exitAngle = 0;
    const px: number[] = [];
    const py: number[] = [];
    const emit = (x: number, y: number) => {
      px.push(c + x * r);
      py.push(c - y * r);
    };
    for (let k = 0; k < n; k += 1) {
      const a = (firstVisible + k) % n;
      const b = (a + 1) % n;
      const za = zs[a];
      const zb = zs[b];
      if (za >= 0) emit(xs[a], ys[a]);
      if ((za >= 0) !== (zb >= 0)) {
        const t = za / (za - zb);
        const ix = xs[a] + (xs[b] - xs[a]) * t;
        const iy = ys[a] + (ys[b] - ys[a]) * t;
        const angle = Math.atan2(iy, ix);
        if (za >= 0) {
          exitAngle = angle;
        } else {
          let delta = angle - exitAngle;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          const steps = Math.ceil(Math.abs(delta) / limbStep);
          for (let s = 0; s <= steps; s += 1) {
            const ang = exitAngle + (delta * s) / Math.max(1, steps);
            emit(Math.cos(ang), Math.sin(ang));
          }
        }
      }
    }
    d += overflows ? ringPathClipped(px, py, -BOX_MARGIN, size + BOX_MARGIN) : ringPath(px, py);
  }
  // Skia rejects an empty path string; a bare move draws nothing.
  return d || 'M0 0';
}
