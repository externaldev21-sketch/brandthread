/**
 * backend.ts — the handful of raster primitives the paint engine needs.
 *
 * lib/paint/engine.ts implements every brush behaviour (stroke buffering,
 * opacity cap, grain, eraser-to-transparency, alpha lock, smudge, replay)
 * purely in terms of these calls, so the web (canvas2d,
 * canvas2dBackend.ts) and native (Skia, skiaBackend.ts) renderers only have
 * to provide pixels-in / pixels-out primitives and produce identical art.
 */

import type { GrainKind, TipShape } from './tips';

export interface IRect { x: number; y: number; w: number; h: number }

/**
 * How `src` lands on `dst`:
 *  - over:  normal paint (source-over)
 *  - erase: punches transparency (destination-out) — the eraser
 *  - atop:  paints only where dst is already opaque (source-atop) — Alpha Lock
 *  - copy:  replaces dst pixels inside the rect
 *  - mask:  keeps dst only where src is opaque (destination-in)
 */
export type CompositeMode = 'over' | 'erase' | 'atop' | 'copy' | 'mask';

/** A dab in SURFACE pixels (already multiplied by the resolution scale). */
export interface SurfaceDab {
  x: number; y: number; size: number; alpha: number; angle: number; roundness: number;
}

export interface RasterBackend<S> {
  createSurface(width: number, height: number): S;
  width(s: S): number;
  height(s: S): number;
  clear(s: S, rect?: IRect): void;
  /** Composites a region of `src` onto `dst` (rects may differ in size → scaled). */
  draw(dst: S, src: S, srcRect: IRect, dstRect: IRect, alpha: number, mode: CompositeMode): void;
  /** Prints dabs of a tinted tip onto `dst` (source-over), or as a mask (destination-in) when mode is 'mask'. */
  stamp(dst: S, tip: TipShape, color: string, dabs: SurfaceDab[], mode?: 'over' | 'mask'): void;
  /** Multiplies dst's alpha by the tiled grain texture inside `rect`. */
  applyGrain(dst: S, grain: GrainKind, tilePx: number, depth: number, rect: IRect): void;
  /** Multiplies every pixel's alpha inside `rect` by `factor` (0..1). */
  multiplyAlpha(dst: S, factor: number, rect: IRect): void;
  /** Fills `rect` with a solid colour (source-over). */
  fill(dst: S, color: string, rect: IRect): void;
  /** RGBA (0..255, unpremultiplied) of one pixel. */
  readPixel(s: S, x: number, y: number): [number, number, number, number];
  dispose(s: S): void;
}

export function rectUnion(a: IRect | null, b: IRect): IRect {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** Rounds a rect outward to whole pixels and clips it to the surface. Null if empty. */
export function clipRect(r: IRect, width: number, height: number): IRect | null {
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(width, Math.ceil(r.x + r.w)), y1 = Math.min(height, Math.ceil(r.y + r.h));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
