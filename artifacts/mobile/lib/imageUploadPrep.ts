/**
 * One shared client-side step that every image upload goes through
 * (lib/api.ts `uploadImage`, lib/uploadWithProgress.ts).
 *
 * Full quality first: the server does the single optimized encode
 * (api-server lib/productImageResize — 2160 wide, q90, EXIF/GPS stripped), so
 * this step leaves a normal phone photo's bytes exactly as picked. It only
 * re-encodes when it has to:
 *  - HEIC/HEIF (the server can't decode it) → JPEG at quality 1;
 *  - a giant original (48 MP, long edge > MAX_UPLOAD_EDGE) → downscaled to
 *    MAX_UPLOAD_EDGE at quality 1, still well above what the server keeps.
 * It never upscales and never lowers quality below 1.
 *
 * It fails open. Anything unexpected (no dimensions, unsupported type, native
 * error) returns the original image untouched so an upload is never blocked
 * by this step. The server resizes and validates again regardless.
 */
import { getImageDimensions } from '@/lib/imageDimensions';

/** Twice the server's 2160 stored width: headroom, but a 48 MP original isn't sent raw. */
export const MAX_UPLOAD_EDGE = 4096;
/** Only used when a re-encode is unavoidable (HEIC → JPEG, giant originals). */
export const UPLOAD_QUALITY = 1;

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

function isHeic(mime: string | null | undefined, uri = ''): boolean {
  const m = (mime ?? '').toLowerCase();
  if (m === 'image/heic' || m === 'image/heif') return true;
  const ext = uri.split('?')[0].split('.').pop()?.toLowerCase();
  return ext === 'heic' || ext === 'heif';
}

/**
 * Whether the picked file must be re-encoded on device before upload. A
 * JPEG/PNG/WebP within MAX_UPLOAD_EDGE is sent byte-for-byte as picked.
 */
export function uploadPlan(
  mime: string | null | undefined,
  uri: string,
  width: number,
  height: number,
): { reencode: false } | { reencode: true; resize: { width: number; height: number } | null } {
  if (!outputFormatFor(mime, uri)) return { reencode: false };
  const target = fitWithin(width, height);
  const resize = target.width !== width || target.height !== height ? target : null;
  if (resize) return { reencode: true, resize };
  if (isHeic(mime, uri)) return { reencode: true, resize: null };
  return { reencode: false };
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
    let width = 0;
    let height = 0;
    try {
      ({ width, height } = await getImageDimensions(image.uri));
    } catch {
      if (!isHeic(image.mimeType, image.uri)) return image;
    }
    const plan = uploadPlan(image.mimeType, image.uri, width, height);
    if (!plan.reencode) return image;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ImageManipulator = require('expo-image-manipulator') as typeof import('expo-image-manipulator');
    const saveFormat = format === 'png'
      ? ImageManipulator.SaveFormat.PNG
      : format === 'webp'
        ? ImageManipulator.SaveFormat.WEBP
        : ImageManipulator.SaveFormat.JPEG;
    const result = await ImageManipulator.manipulateAsync(
      image.uri,
      plan.resize ? [{ resize: plan.resize }] : [],
      { compress: UPLOAD_QUALITY, format: saveFormat },
    );
    if (!result?.uri) return image;
    return { ...image, uri: result.uri, mimeType: MIME_BY_FORMAT[format] };
  } catch {
    return image;
  }
}
