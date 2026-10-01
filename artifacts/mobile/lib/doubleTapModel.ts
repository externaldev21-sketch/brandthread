/**
 * doubleTapModel.ts — pure math for design-canvas.tsx's double-tap-to-edit
 * gesture (Transform tool, text layers): whether two touch-starts count as
 * a double-tap, and whether a tap point lands inside a layer's bounds.
 * Kept dependency-free (no react-native import) so it can be unit tested
 * directly with vitest, the same reasoning as lib/transformModel.ts and
 * lib/layersPanelModel.ts.
 */
import type { DesignTransform } from '@/services/designTypes';

export interface TapRecord {
  t: number;  // timestamp (ms)
  lx: number; // location-space x (local to the canvas view)
  ly: number; // location-space y
}

/**
 * isDoubleTap — true when `current` follows `last` closely enough in both
 * time and position to count as a double-tap. `last` is null for the very
 * first tap of a sequence (never a double-tap).
 */
export function isDoubleTap(
  last: TapRecord | null,
  current: TapRecord,
  maxIntervalMs: number,
  maxDistance: number,
): boolean {
  if (!last) return false;
  const dt = current.t - last.t;
  if (dt < 0 || dt >= maxIntervalMs) return false;
  const dist = Math.hypot(current.lx - last.lx, current.ly - last.ly);
  return dist < maxDistance;
}

/**
 * isPointInTransformBounds — whether a LOGICAL-space point (lx, ly) falls
 * within a layer's (unrotated) transform bounds. Used to require that a
 * double-tap lands on the selected text layer itself, not just anywhere on
 * the canvas.
 */
export function isPointInTransformBounds(lx: number, ly: number, t: DesignTransform): boolean {
  return lx >= t.x && lx <= t.x + t.width && ly >= t.y && ly <= t.y + t.height;
}
