/**
 * One shared client-side step that every image upload goes through
 * (lib/api.ts `uploadImage` / `uploadMediaFile` / ad media,
 * lib/uploadWithProgress.ts, community and DM photos):
 *
 *  - downscale so the long edge is at most the preset's edge for that kind
 *    of upload (avatars 1080, messages 1600, everything else 2048 — never
 *    upscale, aspect ratio preserved),
 *  - re-encode JPEG at ~0.8 (PNG stays PNG so cut-out / logo transparency
 *    survives, WebP stays WebP),
 *  - drop EXIF/GPS: expo-image-manipulator decodes to pixels and writes a new
 *    file, which carries no metadata on iOS, Android or web (canvas).
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
  avatar: { maxEdge: 1080, quality: UPLOAD_QUALITY },
  logo: { maxEdge: 1080, quality: UPLOAD_QUALITY },
  banner: { maxEdge: MAX_UPLOAD_EDGE, quality: UPLOAD_QUALITY },
  product: { maxEdge: MAX_UPLOAD_EDGE, quality: UPLOAD_QUALITY },
  post: { maxEdge: MAX_UPLOAD_EDGE, quality: UPLOAD_QUALITY },
  // 1600 keeps screenshots (receipts, size charts) readable in a chat.
  message: { maxEdge: 1600, quality: UPLOAD_QUALITY },
  evidence: { maxEdge: MAX_UPLOAD_EDGE, quality: UPLOAD_QUALITY },
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
