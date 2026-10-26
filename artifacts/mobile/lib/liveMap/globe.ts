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
import { GLOBE_LAND_DOTS } from './globeLand';

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

/** Unit vectors for every land dot: [x0, y0, z0, x1, …], computed once. */
export const LAND_UNIT: Float32Array = (() => {
  const n = GLOBE_LAND_DOTS.length / 2;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    const lat = (GLOBE_LAND_DOTS[i * 2] / 10) * DEG;
    const lng = (GLOBE_LAND_DOTS[i * 2 + 1] / 10) * DEG;
    out[i * 3] = Math.cos(lat) * Math.sin(lng);
    out[i * 3 + 1] = Math.sin(lat);
    out[i * 3 + 2] = Math.cos(lat) * Math.cos(lng);
  }
  return out;
})();

export const LAND_DOT_COUNT = LAND_UNIT.length / 3;

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

/** Land dot brightness by depth: the limb fades so the sphere reads as round. */
export function landAlpha(depth: number): number {
  'worklet';
  return 0.18 + 0.62 * Math.max(0, depth);
}

/** 0 → 1 → 0 pulse for an order dot, staggered per dot so they don't blink in unison. */
export function pulsePhase(timeMs: number, index: number, periodMs = 2400): number {
  'worklet';
  const t = ((timeMs + index * 377) % periodMs) / periodMs;
  return t;
}
