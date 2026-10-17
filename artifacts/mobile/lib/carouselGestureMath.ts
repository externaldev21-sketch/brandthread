/**
 * Pure (worklet-safe) math for the shared photo carousel: direction lock,
 * rubber-band paging, momentum snap, focal-anchored pinch and pan clamping.
 * Every function is a worklet so the UI thread can call it from RNGH
 * callbacks; they are plain functions under tests.
 */
export const DIRECTION_LOCK_PT = 10;
export const MAX_ZOOM = 4;
export const ZOOM_EPSILON = 1.01;

export type LockDirection = 'h' | 'v' | null;
export type ZoomMode = 'reset' | 'persistent';
export type ZoomState = { scale: number; tx: number; ty: number };

/** null until the finger travelled `threshold` pt; ties go vertical (parent scroll). */
export function decideDirection(dx: number, dy: number, threshold: number = DIRECTION_LOCK_PT): LockDirection {
  'worklet';
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < threshold) return null;
  return ax > ay ? 'h' : 'v';
}

/** Once a direction is locked it never changes for the rest of the touch. */
export function stickyDirection(current: LockDirection, dx: number, dy: number, threshold: number = DIRECTION_LOCK_PT): LockDirection {
  'worklet';
  return current ?? decideDirection(dx, dy, threshold);
}

/** iOS-style rubber band: diminishing resistance past an edge. */
export function rubberBand(overshoot: number, dimension: number, coefficient = 0.55): number {
  'worklet';
  if (dimension <= 0 || overshoot === 0) return 0;
  const sign = overshoot < 0 ? -1 : 1;
  const x = Math.abs(overshoot);
  return sign * ((coefficient * x * dimension) / (dimension + coefficient * x));
}

/** Pager x offset while dragging; rubber-bands at first/last page (no wrap). */
export function pagerOffset(dx: number, index: number, count: number, pageWidth: number): number {
  'worklet';
  const raw = -index * pageWidth + dx;
  const max = 0;
  const min = -Math.max(0, count - 1) * pageWidth;
  if (raw > max) return max + rubberBand(raw - max, pageWidth);
  if (raw < min) return min - rubberBand(min - raw, pageWidth);
  return raw;
}

/** Target page on release: projected distance + velocity, at most one page, clamped. */
export function snapIndex(index: number, dx: number, vx: number, count: number, pageWidth: number): number {
  'worklet';
  if (count <= 1 || pageWidth <= 0) return 0;
  const projected = dx + vx * 0.18;
  let next = index;
  if (projected <= -pageWidth / 2) next = index + 1;
  else if (projected >= pageWidth / 2) next = index - 1;
  return Math.max(0, Math.min(count - 1, next));
}

/** Clamp a pan so the scaled content never reveals beyond its own edges. */
export function clampPan(tx: number, ty: number, scale: number, viewW: number, viewH: number, contentW: number, contentH: number): { tx: number; ty: number } {
  'worklet';
  const maxX = Math.max(0, (contentW * scale - viewW) / 2);
  const maxY = Math.max(0, (contentH * scale - viewH) / 2);
  return { tx: Math.max(-maxX, Math.min(maxX, tx)) + 0, ty: Math.max(-maxY, Math.min(maxY, ty)) + 0 };
}

/**
 * Focal-anchored zoom. Coordinates are relative to the content centre.
 * The content point under the starting focal stays under the current focal,
 * so moving two fingers pans while pinching.
 */
export function focalZoom(
  start: ZoomState, f0x: number, f0y: number, fx: number, fy: number, pinchScale: number,
  minScale = 1, maxScale: number = MAX_ZOOM,
): ZoomState {
  'worklet';
  const s0 = start.scale > 0 ? start.scale : 1;
  const scale = Math.max(minScale, Math.min(maxScale, s0 * pinchScale));
  const r = scale / s0;
  return { scale, tx: fx - (f0x - start.tx) * r, ty: fy - (f0y - start.ty) * r };
}

/** Where zoom goes on release: feed springs home; viewer stays zoomed (clamped) unless pinched out. */
export function releaseZoom(
  mode: ZoomMode, z: ZoomState, viewW: number, viewH: number, contentW: number, contentH: number,
): ZoomState & { zoomed: boolean } {
  'worklet';
  if (mode === 'reset' || z.scale <= ZOOM_EPSILON) return { scale: 1, tx: 0, ty: 0, zoomed: false };
  const scale = Math.min(MAX_ZOOM, z.scale);
  const c = clampPan(z.tx, z.ty, scale, viewW, viewH, contentW, contentH);
  return { scale, tx: c.tx, ty: c.ty, zoomed: true };
}

/**
 * Per-touch-sequence lock used by the production pan/pinch gestures.
 * '' = undecided, 'h'/'v' = sticky single-finger direction, 'p' = a second
 * finger landed before any lock (the remaining finger may never page).
 */
export type TouchLock = '' | 'h' | 'v' | 'p';
export type TouchAction = 'none' | 'activate' | 'fail';

/** Touch down: the first finger starts a fresh sequence; extra fingers never unlock. */
export function touchDownLock(lock: TouchLock, touches: number): TouchLock {
  'worklet';
  if (touches <= 1) return '';
  return lock === '' ? 'p' : lock;
}

/** Pan decision for a touch move. Once locked, the decision never flips. */
export function panMoveDecision(
  lock: TouchLock, dx: number, dy: number, touches: number, zoomed: boolean, count: number,
  threshold: number = DIRECTION_LOCK_PT,
): { lock: TouchLock; action: TouchAction } {
  'worklet';
  if (touches >= 2) return { lock: lock === '' ? 'p' : lock, action: 'none' };
  if (lock === 'p') return { lock, action: zoomed ? 'activate' : 'fail' };
  if (lock === 'h' || lock === 'v') return { lock, action: 'none' };
  const d = stickyDirection(null, dx, dy, threshold);
  if (d === null) return { lock: '', action: 'none' };
  if (zoomed) return { lock: d, action: 'activate' };
  return { lock: d, action: d === 'h' && count > 1 ? 'activate' : 'fail' };
}

/** Pinch decision: two fingers activate; a vertical single-finger lock fails it so the parent can scroll. */
export function pinchTouchDecision(lock: TouchLock, touches: number, enabled: boolean): TouchAction {
  'worklet';
  if (!enabled) return 'fail';
  if (touches >= 2) return 'activate';
  if (lock === 'v') return 'fail';
  return 'none';
}

/** Authored ratio: number (w/h) or "w:h" / "w/h" strings. */
export function parseAspect(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const m = value.trim().match(/^(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)$/);
  if (!m) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : undefined; }
  const w = Number(m[1]), h = Number(m[2]);
  return w > 0 && h > 0 ? w / h : undefined;
}
