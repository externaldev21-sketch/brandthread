/**
 * Shared crop math for the app-wide media aspect-ratio system: photos crop
 * to 3:4 everywhere (post photos, product photos, Discover/profile/shop
 * tiles), story/video cover frames crop to 9:16. One fixed target ratio per
 * context — no aspect-toggle UI — the creator only pans and pinch-zooms the
 * source image inside that fixed frame.
 *
 * Adapted from the crop math in stuck PR #251 (`lib/photoCrop.ts`, Instagram
 * post-creation crop step): same clamp-to-bounds approach (scale >= 1 so the
 * crop box can never show empty space around the source image — "min zoom =
 * image fills the frame"), generalized from a 3-way aspect toggle to a
 * single arbitrary `targetRatio`, and changed to store the result as a
 * normalized (0–1) rect rather than only applying it immediately — so a
 * saved crop can be re-opened and re-edited later without re-deriving it
 * from pixel coordinates that may no longer match a re-fetched image.
 *
 * Pure math, no React/RN imports (besides the pixel-application helper at
 * the bottom) — unit-testable without a device or DOM.
 */
// Type-only import — erased at compile time, so it doesn't pull in the real
// module (and transitively react-native) at module-eval time; see the lazy
// require() in applyCropRect below for why that matters for testability.
import type * as ImageManipulatorTypes from 'expo-image-manipulator';

/** Pan/zoom state while framing a crop — scale >= 1, tx/ty are pan offsets
 *  in source-image pixels from centered. */
export interface CropTransform {
  scale: number;
  tx: number;
  ty: number;
}

export const DEFAULT_CROP_TRANSFORM: CropTransform = { scale: 1, tx: 0, ty: 0 };

/** A saved crop, normalized (0–1) against the ORIGINAL image's own pixel
 *  dimensions — survives re-fetching/resizing the source and is what
 *  persists for "Edit crop" later. */
export interface NormalizedCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_SCALE_DEFAULT = 1;
export const MAX_SCALE_DEFAULT = 4;
const MIN_SCALE = MIN_SCALE_DEFAULT;
const MAX_SCALE = MAX_SCALE_DEFAULT;

/** Clamp a pan/zoom transform so the resulting crop rect never exits the
 *  source image bounds, for a given target aspect ratio (width / height). */
export function clampCropTransform(
  transform: CropTransform,
  sourceW: number,
  sourceH: number,
  targetRatio: number,
): CropTransform {
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, transform.scale));
  const { width, height } = cropBoxSize(sourceW, sourceH, targetRatio, scale);
  const maxTx = Math.max(0, (sourceW - width) / 2);
  const maxTy = Math.max(0, (sourceH - height) / 2);
  return {
    scale,
    tx: Math.max(-maxTx, Math.min(maxTx, transform.tx)),
    ty: Math.max(-maxTy, Math.min(maxTy, transform.ty)),
  };
}

/** The crop box size (source-image pixels) for a target ratio at a given
 *  zoom scale — the largest box of that ratio that fits inside the source
 *  image, divided by scale (higher scale = smaller box = more "zoomed in").
 *  This is what guarantees the box can never show empty space: at scale 1
 *  it's already the largest box of that ratio the source can fill. */
function cropBoxSize(sourceW: number, sourceH: number, targetRatio: number, scale: number) {
  let width = sourceW;
  let height = width / targetRatio;
  if (height > sourceH) {
    height = sourceH;
    width = height * targetRatio;
  }
  return { width: width / scale, height: height / scale };
}

/** Resolve a pixel-space crop rect (for expo-image-manipulator's `crop`
 *  action) from a source image size, target ratio and pan/zoom transform. */
export function resolvePixelCropRect(
  sourceW: number,
  sourceH: number,
  targetRatio: number,
  transform: CropTransform,
): { originX: number; originY: number; width: number; height: number } {
  const clamped = clampCropTransform(transform, sourceW, sourceH, targetRatio);
  const { width, height } = cropBoxSize(sourceW, sourceH, targetRatio, clamped.scale);
  const originX = Math.max(0, Math.min(sourceW - width, (sourceW - width) / 2 + clamped.tx));
  const originY = Math.max(0, Math.min(sourceH - height, (sourceH - height) / 2 + clamped.ty));
  return {
    originX: Math.round(originX), originY: Math.round(originY),
    width: Math.round(width), height: Math.round(height),
  };
}

/** Normalize a pixel crop rect against its source size — this is the shape
 *  that gets persisted for "Edit crop" later. */
export function normalizeCropRect(
  pixelRect: { originX: number; originY: number; width: number; height: number },
  sourceW: number,
  sourceH: number,
): NormalizedCropRect {
  return {
    x: sourceW > 0 ? pixelRect.originX / sourceW : 0,
    y: sourceH > 0 ? pixelRect.originY / sourceH : 0,
    width: sourceW > 0 ? pixelRect.width / sourceW : 1,
    height: sourceH > 0 ? pixelRect.height / sourceH : 1,
  };
}

/** The inverse of normalizeCropRect — resolves a saved normalized rect back
 *  to pixel space against a (possibly re-fetched, same-aspect) source size,
 *  for re-applying or for re-deriving the pan/zoom transform to re-open the
 *  cropper already framed the way the creator left it. */
export function denormalizeCropRect(rect: NormalizedCropRect, sourceW: number, sourceH: number) {
  return {
    originX: Math.round(rect.x * sourceW),
    originY: Math.round(rect.y * sourceH),
    width: Math.round(rect.width * sourceW),
    height: Math.round(rect.height * sourceH),
  };
}

/** Re-derive the pan/zoom transform that produces a given normalized rect,
 *  so re-opening the cropper for "Edit crop" starts framed exactly where
 *  the creator left it instead of resetting to centered/scale=1. */
export function transformFromNormalizedRect(
  rect: NormalizedCropRect,
  sourceW: number,
  sourceH: number,
): CropTransform {
  const pixelWidth = rect.width * sourceW;
  const pixelHeight = rect.height * sourceH;
  if (pixelWidth <= 0 || pixelHeight <= 0) return DEFAULT_CROP_TRANSFORM;
  const scale = sourceW / pixelWidth;
  const centerX = (rect.x + rect.width / 2) * sourceW;
  const centerY = (rect.y + rect.height / 2) * sourceH;
  return {
    scale,
    tx: centerX - sourceW / 2,
    ty: centerY - sourceH / 2,
  };
}

/** Whether a crop would be a no-op (no zoom/pan at all). */
export function isIdentityCrop(transform: CropTransform): boolean {
  return transform.scale === 1 && transform.tx === 0 && transform.ty === 0;
}

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  // Lazy require — keeps this module's pure math functions importable
  // (and unit-testable) without pulling in react-native at module-eval time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Image } = require('react-native');
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width: number, height: number) => resolve({ width, height }), reject);
  });
}

/** Minimum output size for a cropped 3:4 render, so a tightly-zoomed crop of
 *  a modest source photo never uploads a soft/undersized image. */
export const MIN_CROP_OUTPUT_WIDTH = 1080;
export const MIN_CROP_OUTPUT_HEIGHT = 1440;

/**
 * Applies a normalized crop rect to a source image via
 * expo-image-manipulator, resizing up to at least MIN_CROP_OUTPUT_WIDTH x
 * MIN_CROP_OUTPUT_HEIGHT when the cropped region is smaller, and returns the
 * new local URI. Falls back to the original URI on any failure — a failed
 * crop must never block the creator from continuing with the photo they
 * picked.
 */
export async function applyCropRect(
  uri: string,
  rect: NormalizedCropRect,
): Promise<string> {
  try {
    const { width: sourceW, height: sourceH } = await getImageSize(uri);
    if (!sourceW || !sourceH) return uri;
    const pixelRect = denormalizeCropRect(rect, sourceW, sourceH);
    if (pixelRect.width <= 0 || pixelRect.height <= 0) return uri;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ImageManipulator: typeof ImageManipulatorTypes = require('expo-image-manipulator');
    const actions: ImageManipulatorTypes.Action[] = [{ crop: pixelRect }];
    if (pixelRect.width < MIN_CROP_OUTPUT_WIDTH || pixelRect.height < MIN_CROP_OUTPUT_HEIGHT) {
      const upscale = Math.max(MIN_CROP_OUTPUT_WIDTH / pixelRect.width, MIN_CROP_OUTPUT_HEIGHT / pixelRect.height);
      actions.push({ resize: { width: Math.round(pixelRect.width * upscale), height: Math.round(pixelRect.height * upscale) } });
    }

    const result = await ImageManipulator.manipulateAsync(
      uri,
      actions,
      { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG },
    );
    return result.uri;
  } catch {
    return uri;
  }
}

/** Convenience: crop from a live pan/zoom transform (used when saving
 *  straight out of the cropper UI, before a normalized rect exists yet). */
export async function applyCropTransform(
  uri: string,
  targetRatio: number,
  transform: CropTransform,
): Promise<{ uri: string; rect: NormalizedCropRect }> {
  const { width: sourceW, height: sourceH } = await getImageSize(uri);
  if (!sourceW || !sourceH) return { uri, rect: { x: 0, y: 0, width: 1, height: 1 } };
  const pixelRect = resolvePixelCropRect(sourceW, sourceH, targetRatio, transform);
  const rect = normalizeCropRect(pixelRect, sourceW, sourceH);
  const croppedUri = await applyCropRect(uri, rect);
  return { uri: croppedUri, rect };
}

/** The default crop for media that predates this system (no saved rect) —
 *  a centered crop at the target ratio, never showing more than the source
 *  (matches "existing uploads without a saved crop: default to a centered
 *  crop, never letterboxed/9:16 for photos"). */
export function centeredDefaultCropRect(sourceW: number, sourceH: number, targetRatio: number): NormalizedCropRect {
  const pixelRect = resolvePixelCropRect(sourceW, sourceH, targetRatio, DEFAULT_CROP_TRANSFORM);
  return normalizeCropRect(pixelRect, sourceW, sourceH);
}
