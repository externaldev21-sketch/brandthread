/**
 * platform.ts — picks the raster backend for this runtime and does the few
 * encode/decode jobs that differ per platform (surface → PNG/JPEG, encoded
 * image → surface).
 *
 *   web     → Canvas2DBackend (HTML canvas)
 *   native  → SkiaBackend, when the Skia native module is linked (dev client /
 *             store builds). Expo Go has no Skia; there the canvas reports
 *             `null` and the screen keeps its vector fallback.
 */

import { Platform } from 'react-native';
import type { RasterBackend } from './backend';
import { Canvas2DBackend } from './canvas2dBackend';
import { isSkiaAvailable } from '@/lib/skiaAvailability';

/* eslint-disable @typescript-eslint/no-explicit-any */

let cached: RasterBackend<any> | null | undefined;

export function getPlatformBackend(): RasterBackend<any> | null {
  if (cached !== undefined) return cached;
  try {
    if (Platform.OS === 'web') {
      cached = typeof document !== 'undefined' ? new Canvas2DBackend() : null;
    } else if (isSkiaAvailable()) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { SkiaBackend } = require('./skiaBackend');
      cached = new SkiaBackend();
    } else {
      cached = null;
    }
  } catch {
    cached = null;
  }
  return cached ?? null;
}

export type EncodeFormat = 'png' | 'jpeg';

/**
 * Encodes a surface to a data URI, optionally downscaled so its long side is
 * at most `maxSide`. PNG keeps the alpha channel; JPEG is flattened onto
 * `jpegMatte` first (JPEG has no alpha).
 */
export function encodeSurface(
  backend: RasterBackend<any>,
  surface: any,
  opts: { format?: EncodeFormat; quality?: number; maxSide?: number; jpegMatte?: string } = {},
): string {
  const format = opts.format ?? 'png';
  const w = backend.width(surface), h = backend.height(surface);
  const k = opts.maxSide ? Math.min(1, opts.maxSide / Math.max(w, h)) : 1;
  let src = surface;
  let tmp: any = null;
  if (k < 1 || format === 'jpeg') {
    const tw = Math.max(1, Math.round(w * k)), th = Math.max(1, Math.round(h * k));
    tmp = backend.createSurface(tw, th);
    if (format === 'jpeg') backend.fill(tmp, opts.jpegMatte ?? '#FFFFFF', { x: 0, y: 0, w: tw, h: th });
    backend.draw(tmp, surface, { x: 0, y: 0, w, h }, { x: 0, y: 0, w: tw, h: th }, 1, 'over');
    src = tmp;
  }
  try {
    if (Platform.OS === 'web') {
      return (src as HTMLCanvasElement).toDataURL(format === 'jpeg' ? 'image/jpeg' : 'image/png', opts.quality ?? 0.95);
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sk = require('@shopify/react-native-skia');
    const img = src.makeImageSnapshot();
    const b64 = img.encodeToBase64(format === 'jpeg' ? sk.ImageFormat.JPEG : sk.ImageFormat.PNG, Math.round((opts.quality ?? 0.95) * 100));
    return `data:image/${format === 'jpeg' ? 'jpeg' : 'png'};base64,${b64}`;
  } finally {
    if (tmp) backend.dispose(tmp);
  }
}

/** Draws an encoded image (data URI / URL) into `dst` at `rect`, source-over. */
export async function drawEncodedImage(
  backend: RasterBackend<any>,
  dst: any,
  uri: string,
  rect: { x: number; y: number; w: number; h: number },
): Promise<void> {
  if (Platform.OS === 'web') {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new window.Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode image for export'));
      el.src = uri;
    });
    const ctx = (dst as HTMLCanvasElement).getContext('2d')!;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sk = require('@shopify/react-native-skia');
  const b64 = uri.startsWith('data:') ? uri.slice(uri.indexOf(',') + 1) : null;
  const data = b64 ? sk.Skia.Data.fromBase64(b64) : await sk.Skia.Data.fromURI(uri);
  const image = sk.Skia.Image.MakeImageFromEncoded(data);
  if (!image) throw new Error('Could not decode image for export');
  const paint = sk.Skia.Paint();
  dst.getCanvas().drawImageRect(image, sk.Skia.XYWHRect(0, 0, image.width(), image.height()), sk.Skia.XYWHRect(rect.x, rect.y, rect.w, rect.h), paint);
  dst.flush();
}
