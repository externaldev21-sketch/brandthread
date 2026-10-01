/**
 * Per-slide crop for the create flow. Each slide stores a zoom (1 = the post
 * frame exactly covered by the photo) and the crop centre in normalized source
 * coordinates; the frame's aspect ratio comes from the post-wide choice
 * (1:1 / 3:4 / 9:16). Pure math so it can be unit-tested.
 */
import type { NormalizedCropRect } from '@/lib/mediaCrop';

export interface SlideCrop { zoom: number; cx: number; cy: number }

export const DEFAULT_SLIDE_CROP: SlideCrop = { zoom: 1, cx: 0.5, cy: 0.5 };
export const MAX_SLIDE_ZOOM = 4;

/** Largest box of `ratio` (w/h) inside the source, divided by zoom. Source pixels. */
export function cropBox(sourceW: number, sourceH: number, ratio: number, zoom: number) {
  let w = sourceW;
  let h = w / ratio;
  if (h > sourceH) { h = sourceH; w = h * ratio; }
  return { w: w / zoom, h: h / zoom };
}

export function clampSlideCrop(crop: SlideCrop, sourceW: number, sourceH: number, ratio: number): SlideCrop {
  const zoom = Math.max(1, Math.min(MAX_SLIDE_ZOOM, crop.zoom));
  const { w, h } = cropBox(sourceW, sourceH, ratio, zoom);
  const halfW = w / sourceW / 2;
  const halfH = h / sourceH / 2;
  return {
    zoom,
    cx: Math.max(halfW, Math.min(1 - halfW, crop.cx)),
    cy: Math.max(halfH, Math.min(1 - halfH, crop.cy)),
  };
}

export function slideCropToRect(crop: SlideCrop, sourceW: number, sourceH: number, ratio: number): NormalizedCropRect {
  const c = clampSlideCrop(crop, sourceW, sourceH, ratio);
  const { w, h } = cropBox(sourceW, sourceH, ratio, c.zoom);
  const width = w / sourceW;
  const height = h / sourceH;
  return { x: c.cx - width / 2, y: c.cy - height / 2, width, height };
}
