/**
 * One shared client-side step that every image upload goes through
 * (lib/api.ts `uploadImage` / `uploadMediaFile` / ad media,
 * lib/uploadWithProgress.ts, community and DM photos):
 *
 * Normal JPEG/PNG/WebP originals up to 4096px pass through untouched; the
 * server strips EXIF/GPS and performs the final encode. HEIC and oversized
 * originals are converted at quality 1. Message/evidence presets retain
 * their bandwidth and provider-size boundaries.
 *
 * It fails open. Anything unexpected (no dimensions, unsupported type, native
 * error) returns the original image untouched so an upload is never blocked
 * by this optimisation. The server resizes and validates again regardless.
 */
import { getImageDimensions } from '@/lib/imageDimensions';

export const MAX_UPLOAD_EDGE = 4096;
export const UPLOAD_QUALITY = 1;

export type UploadImage = { uri: string; mimeType?: string | null };
export type OutputFormat = 'jpeg' | 'png' | 'webp';

export type UploadImageKind =
  | 'avatar'   // profile photo, shown as a circle (≤ ~200pt)
  | 'logo'     // storefront logo
  | 'banner'   // storefront banner / cover, full width
  | 'product'  // product photos, size charts, cut-outs, sample-order images
  | 'post'     // feed photo slides
  | 'message'  // DM / community / manufacturer-thread photos
  | 'evidence' // reviews, returns, disputes, production updates (must stay legible)
  | 'default';

export interface ImageUploadPreset { maxEdge: number; quality: number }

export const IMAGE_UPLOAD_PRESETS: Record<UploadImageKind, ImageUploadPreset> = {
  avatar: { maxEdge: MAX_UPLOAD_EDGE, quality: UPLOAD_QUALITY },
  logo: { maxEdge: MAX_UPLOAD_EDGE, quality: UPLOAD_QUALITY },
  banner: { maxEdge: MAX_UPLOAD_EDGE, quality: UPLOAD_QUALITY },
  product: { maxEdge: MAX_UPLOAD_EDGE, quality: UPLOAD_QUALITY },
  post: { maxEdge: MAX_UPLOAD_EDGE, quality: UPLOAD_QUALITY },
  // 1600 keeps screenshots (receipts, size charts) readable in a chat.
  message: { maxEdge: 1600, quality: 0.9 },
  evidence: { maxEdge: 2048, quality: 0.8 },
  default: { maxEdge: MAX_UPLOAD_EDGE, quality: UPLOAD_QUALITY },
};

/** Which preset an API upload route gets. Unknown routes keep the 2048 default. */
export function presetForUploadPath(path: string): UploadImageKind {
  const p = path.split('?')[0].toLowerCase();
  if (/\/avatar(\/|$)/.test(p)) return 'avatar';
  if (/\/logo(\/|$)/.test(p)) return 'logo';
  if (/\/banner(\/|$)/.test(p)) return 'banner';
  if (/\/photo-slides(\/|$)/.test(p)) return 'post';
  if (/\/attachments(\/|$)/.test(p)) return 'message';
  if (/^\/api\/(reviews|returns|disputes)\//.test(p) || /\/updates\/photo$/.test(p) || /\/me\/photos$/.test(p)) return 'evidence';
  if (/^\/api\/products\/images$/.test(p) || /^\/api\/sample-orders\//.test(p)) return 'product';
  return 'default';
}

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

export const MIME_BY_FORMAT: Record<OutputFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function isHeic(mime: string | null | undefined, uri = ''): boolean {
  return /image\/hei[cf]/i.test(mime ?? '') || /\.hei[cf](?:\?|$)/i.test(uri);
}

export function uploadPlan(
  mime: string | null | undefined, uri: string, width: number, height: number,
): { reencode: false } | { reencode: true; resize: { width: number; height: number } | null } {
  if (!outputFormatFor(mime, uri)) return { reencode: false };
  const target = fitWithin(width, height);
  const resize = target.width !== width || target.height !== height ? target : null;
  return resize || isHeic(mime, uri) ? { reencode: true, resize } : { reencode: false };
}

type Manipulated = { uri: string; base64?: string; mimeType: string };

async function manipulate(image: UploadImage, kind: UploadImageKind, base64: boolean): Promise<Manipulated | null> {
  const format = outputFormatFor(image.mimeType, image.uri);
  if (!format) return null;
  const preset = IMAGE_UPLOAD_PRESETS[kind] ?? IMAGE_UPLOAD_PRESETS.default;
  const { width, height } = await getImageDimensions(image.uri);
  const target = fitWithin(width, height, preset.maxEdge);
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
    { compress: preset.quality, format: saveFormat, base64 },
  );
  if (!result?.uri) return null;
  return { uri: result.uri, base64: result.base64, mimeType: MIME_BY_FORMAT[format] };
}

export async function prepareImageForUpload<T extends UploadImage>(image: T, kind: UploadImageKind = 'default'): Promise<T> {
  try {
    if (kind !== 'message' && kind !== 'evidence') {
      let width = 0, height = 0;
      try { ({ width, height } = await getImageDimensions(image.uri)); }
      catch { if (!isHeic(image.mimeType, image.uri)) return image; }
      if (!uploadPlan(image.mimeType, image.uri, width, height).reencode) return image;
    }
    const out = await manipulate(image, kind, false);
    if (!out) return image;
    return { ...image, uri: out.uri, mimeType: out.mimeType };
  } catch {
    return image;
  }
}

/**
 * For the JSON/base64 upload endpoints (DM and community photos): the
 * compressed image as base64. Falls back to the picker's own base64 (and its
 * mime) when compression is unavailable; null only when neither exists.
 */
export async function prepareImageBase64ForUpload(
  image: UploadImage & { base64?: string | null },
  kind: UploadImageKind,
  /** Mime to report for the untouched picker bytes (callers that always labelled them JPEG keep doing so). */
  fallbackMimeType?: string,
): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const out = await manipulate(image, kind, true);
    if (out?.base64) return { base64: out.base64, mimeType: out.mimeType };
  } catch {
    // fall through to the original bytes
  }
  return image.base64 ? { base64: image.base64, mimeType: fallbackMimeType ?? (image.mimeType || 'image/jpeg') } : null;
}
