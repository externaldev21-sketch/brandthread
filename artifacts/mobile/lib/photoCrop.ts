/**
 * Crop math + apply helper for the Thread creation flow's photo-crop step
 * (Instagram's post-creation crop screen — square/original/4:5 aspect toggle
 * + pinch-to-zoom-and-pan crop box, see app/create-post.tsx `photo-crop`
 * step). Pure math is split out here so it's unit-testable without a device.
 */
import * as ImageManipulator from 'expo-image-manipulator';
import { Image } from 'react-native';

export type CropAspect = 'original' | 'square' | '4:5';

/** A photo's pan/zoom state within its crop box — scale >= 1 (never lets the
 *  crop box show more than the source image), tx/ty are pan offsets in
 *  source-image pixels from centered. */
export interface CropTransform {
  scale: number;
  tx: number;
  ty: number;
}

export const DEFAULT_CROP_TRANSFORM: CropTransform = { scale: 1, tx: 0, ty: 0 };

/** The target aspect ratio (width / height) for a given toggle value, or
 *  null for 'original' (no crop needed unless the user has panned/zoomed). */
export function aspectRatioFor(aspect: CropAspect, sourceW: number, sourceH: number): number | null {
  if (aspect === 'square') return 1;
  if (aspect === '4:5') return 4 / 5;
  return sourceW > 0 && sourceH > 0 ? sourceW / sourceH : null;
}

/** Clamp a pan/zoom transform so the resulting crop rect never exits the
 *  source image bounds, for a given target aspect. */
export function clampCropTransform(
  transform: CropTransform,
  sourceW: number,
  sourceH: number,
  aspect: CropAspect,
): CropTransform {
  const ratio = aspectRatioFor(aspect, sourceW, sourceH) ?? sourceW / Math.max(1, sourceH);
  const scale = Math.max(1, Math.min(4, transform.scale));
  const { width, height } = cropBoxSize(sourceW, sourceH, ratio, scale);
  const maxTx = Math.max(0, (sourceW - width) / 2);
  const maxTy = Math.max(0, (sourceH - height) / 2);
  return {
    scale,
    tx: Math.max(-maxTx, Math.min(maxTx, transform.tx)),
    ty: Math.max(-maxTy, Math.min(maxTy, transform.ty)),
  };
}

/** The crop box size (source-image pixels) for a target aspect at a given
 *  zoom scale — the largest box of that aspect that fits the source image,
 *  divided by scale (higher scale = smaller box = more "zoomed in"). */
function cropBoxSize(sourceW: number, sourceH: number, ratio: number, scale: number) {
  let width = sourceW;
  let height = width / ratio;
  if (height > sourceH) {
    height = sourceH;
    width = height * ratio;
  }
  return { width: width / scale, height: height / scale };
}

/** Resolve a normalized (0-1) crop rect for expo-image-manipulator's `crop`
 *  action, from a source image size, target aspect and pan/zoom transform. */
export function resolveCropRect(
  sourceW: number,
  sourceH: number,
  aspect: CropAspect,
  transform: CropTransform,
): { originX: number; originY: number; width: number; height: number } {
  const ratio = aspectRatioFor(aspect, sourceW, sourceH) ?? sourceW / Math.max(1, sourceH);
  const clamped = clampCropTransform(transform, sourceW, sourceH, aspect);
  const { width, height } = cropBoxSize(sourceW, sourceH, ratio, clamped.scale);
  const originX = Math.max(0, Math.min(sourceW - width, (sourceW - width) / 2 + clamped.tx));
  const originY = Math.max(0, Math.min(sourceH - height, (sourceH - height) / 2 + clamped.ty));
  return {
    originX: Math.round(originX), originY: Math.round(originY),
    width: Math.round(width), height: Math.round(height),
  };
}

/** Whether a crop would be a no-op (original aspect, no zoom/pan) — skips
 *  re-encoding a photo the user didn't actually touch. */
export function isIdentityCrop(aspect: CropAspect, transform: CropTransform): boolean {
  return aspect === 'original' && transform.scale === 1 && transform.tx === 0 && transform.ty === 0;
}

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

/** Apply the crop for real via expo-image-manipulator, returning a new local
 *  URI. Falls back to the original URI (no-op) on any failure, since a
 *  failed crop must never block the user from continuing with the photo
 *  they picked. */
export async function applyPhotoCrop(
  uri: string,
  aspect: CropAspect,
  transform: CropTransform,
): Promise<string> {
  if (isIdentityCrop(aspect, transform)) return uri;
  try {
    const { width, height } = await getImageSize(uri);
    if (!width || !height) return uri;
    const rect = resolveCropRect(width, height, aspect, transform);
    if (rect.width <= 0 || rect.height <= 0) return uri;
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ crop: rect }],
      { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG },
    );
    return result.uri;
  } catch {
    return uri;
  }
}
