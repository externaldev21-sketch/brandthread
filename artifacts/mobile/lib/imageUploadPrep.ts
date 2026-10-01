/**
 * One shared client-side step that every image upload goes through
 * (lib/api.ts `uploadImage`, lib/uploadWithProgress.ts):
 *
 *  - downscale so the long edge is at most MAX_UPLOAD_EDGE (never upscale,
 *    aspect ratio preserved),
 *  - re-encode JPEG at ~0.8 (PNG stays PNG so cut-out transparency survives,
 *    WebP stays WebP),
 *  - drop EXIF/GPS: expo-image-manipulator decodes to pixels and writes a new
 *    file, which carries no metadata on iOS, Android or web.
 *
 * It fails open. Anything unexpected (no dimensions, unsupported type, native
 * error) returns the original image untouched so an upload is never blocked
 * by this optimisation. The server resizes and validates again regardless.
 */
import { getImageDimensions } from '@/lib/imageDimensions';

export const MAX_UPLOAD_EDGE = 2048;
export const UPLOAD_QUALITY = 0.8;

export type UploadImage = { uri: string; mimeType?: string | null };
export type OutputFormat = 'jpeg' | 'png' | 'webp';

/** Target size with the long edge capped at `maxEdge`. Never upscales; keeps aspect ratio. */
export function fitWithin(width: number, height: number, maxEdge: number = MAX_UPLOAD_EDGE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width, height };
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { width, height };
  const scale = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Output format for a source mime, or null when the file must be sent as is (GIF animation, non-images). */
export function outputFormatFor(mime: string | null | undefined, uri = ''): OutputFormat | null {
  const m = (mime ?? '').toLowerCase();
  if (m === 'image/gif') return null;
  if (m === 'image/png') return 'png';
  if (m === 'image/webp') return 'webp';
  if (m === 'image/jpeg' || m === 'image/jpg' || m === 'image/heic' || m === 'image/heif') return 'jpeg';
  if (m && !m.startsWith('image/')) return null;
  const ext = uri.split('?')[0].split('.').pop()?.toLowerCase();
  if (ext === 'gif') return null;
  if (ext === 'png') return 'png';
  if (ext === 'webp') return 'webp';
  return 'jpeg';
}

const MIME_BY_FORMAT: Record<OutputFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export async function prepareImageForUpload<T extends UploadImage>(image: T): Promise<T> {
  try {
    const format = outputFormatFor(image.mimeType, image.uri);
    if (!format) return image;
    const { width, height } = await getImageDimensions(image.uri);
    const target = fitWithin(width, height);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ImageManipulator = require('expo-image-manipulator') as typeof import('expo-image-manipulator');
    const saveFormat = format === 'png'
      ? ImageManipulator.SaveFormat.PNG
      : format === 'webp'
        ? ImageManipulator.SaveFormat.WEBP
        : ImageManipulator.SaveFormat.JPEG;
    const resized = target.width !== width || target.height !== height;
    const result = await ImageManipulator.manipulateAsync(
      image.uri,
      resized ? [{ resize: { width: target.width, height: target.height } }] : [],
      { compress: UPLOAD_QUALITY, format: saveFormat },
    );
    if (!result?.uri) return image;
    return { ...image, uri: result.uri, mimeType: MIME_BY_FORMAT[format] };
  } catch {
    return image;
  }
}
