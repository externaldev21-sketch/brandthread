/**
 * Pure math for the circular profile-picture cropper
 * (components/profile/AvatarCropper.tsx).
 *
 * Model: the image is drawn centred on the crop circle, scaled by
 * `coverScale * zoom`, then shifted by (tx, ty) screen points. `zoom` runs
 * from 1 (the image just covers the circle — no empty edge is ever visible)
 * to MAX_ZOOM. Offsets are clamped so the circle's bounding square always
 * stays inside the image.
 *
 * Every helper is a Reanimated worklet so the gesture handlers can clamp on
 * the UI thread; the 'worklet' directive is a plain string outside Babel, so
 * the same functions run unchanged in unit tests and on web.
 */

export const MAX_ZOOM = 4;
/** Output side of the cropped square, in pixels. */
export const AVATAR_OUTPUT_SIZE = 800;

export type CropRect = { originX: number; originY: number; width: number; height: number };

/** Scale at which the image's shorter side exactly spans the circle (zoom = 1). */
export function coverScale(imageW: number, imageH: number, diameter: number): number {
  'worklet';
  return diameter / Math.min(imageW, imageH);
}

export function clampZoom(zoom: number): number {
  'worklet';
  return Math.min(MAX_ZOOM, Math.max(1, zoom));
}

/** Largest |offset| on one axis that still keeps the circle covered. */
export function maxOffset(imageSide: number, scale: number, diameter: number): number {
  'worklet';
  return Math.max(0, (imageSide * scale - diameter) / 2);
}

export function clampOffset(offset: number, imageSide: number, scale: number, diameter: number): number {
  'worklet';
  const m = maxOffset(imageSide, scale, diameter);
  return Math.min(m, Math.max(-m, offset));
}

/**
 * Offset after zooming from `fromZoom` to `toZoom` around a focal point
 * (`focal`, measured from the circle centre) so the pixel under the fingers
 * stays put — the Instagram feel, rather than always zooming about the centre.
 */
export function offsetForFocalZoom(offset: number, focal: number, fromZoom: number, toZoom: number): number {
  'worklet';
  return focal - (focal - offset) * (toZoom / fromZoom);
}

/**
 * The square of source-image pixels that is visible inside the circle, for
 * expo-image-manipulator's `crop` action. Rounded to whole pixels and kept
 * inside the image bounds.
 */
export function cropRectFor(params: {
  imageW: number;
  imageH: number;
  diameter: number;
  zoom: number;
  tx: number;
  ty: number;
}): CropRect {
  const { imageW, imageH, diameter } = params;
  const zoom = clampZoom(params.zoom);
  const scale = coverScale(imageW, imageH, diameter) * zoom;
  const tx = clampOffset(params.tx, imageW, scale, diameter);
  const ty = clampOffset(params.ty, imageH, scale, diameter);

  const side = Math.min(imageW, imageH, Math.round(diameter / scale));
  const centreX = imageW / 2 - tx / scale;
  const centreY = imageH / 2 - ty / scale;
  const originX = Math.min(imageW - side, Math.max(0, Math.round(centreX - side / 2)));
  const originY = Math.min(imageH - side, Math.max(0, Math.round(centreY - side / 2)));
  return { originX, originY, width: side, height: side };
}
