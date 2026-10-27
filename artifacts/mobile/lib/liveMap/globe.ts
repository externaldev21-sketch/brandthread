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
 *
 * Functions are plain math marked 'worklet' so Reanimated can run them on
 * the UI thread; on web and in tests they are ordinary functions.
 */
import { WORLD_LAND_PATH, WORLD_LAT_TOP } from './worldLand';

export interface GlobeView { yaw: number; pitch: number; zoom: number }

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 1.7;
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

/** Applies a drag of (dx, dy) points to a view. Dragging right turns the globe right; down tilts the north toward you. */
export function dragView(view: GlobeView, dx: number, dy: number, size: number): GlobeView {
  'worklet';
  const r = Math.max(1, globeRadius(size, view.zoom));
  return { yaw: view.yaw + (dx / r) * DRAG_GAIN, pitch: clampPitch(view.pitch + (dy / r) * DRAG_GAIN), zoom: view.zoom };
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
    let started = false;
    let exitAngle = 0;
    let out = '';
    const emit = (x: number, y: number) => {
      out += `${started ? 'L' : 'M'}${(c + x * r).toFixed(1)} ${(c - y * r).toFixed(1)}`;
      started = true;
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
          const steps = Math.ceil(Math.abs(delta) / LIMB_STEP);
          for (let s = 0; s <= steps; s += 1) {
            const ang = exitAngle + (delta * s) / Math.max(1, steps);
            emit(Math.cos(ang), Math.sin(ang));
          }
        }
      }
    }
    d += `${out}Z`;
  }
  // Skia rejects an empty path string; a bare move draws nothing.
  return d || 'M0 0';
}
