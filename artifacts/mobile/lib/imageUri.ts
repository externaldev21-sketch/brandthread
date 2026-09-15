/**
 * imageUri — platform-aware durable URI helper
 *
 * Rules:
 *  - Data URLs (data:image/…;base64,…) pass through unchanged on all platforms.
 *  - Native (iOS/Android): transient picker URIs are copied into app-owned
 *    Paths.document using File.copy() so they survive cache eviction.
 *  - Web: blob: / object-URL from ImagePicker are ephemeral; we must convert
 *    them to a bounded base64 data URL via fetch+FileReader before persisting.
 *    Plain https:// remote URLs are retained as-is (they are not transient).
 *  - Fails explicitly (throws) if:
 *      • size > MAX_DATA_URL_BYTES after conversion
 *      • FileReader conversion fails
 *    Callers must catch and surface the error; never persist a transient blob URL.
 *
 * MAX_DATA_URL_BYTES = 10 MB (base64 overhead ~33 %, so ~7.5 MB source).
 * Thumbnails rendered from these URIs will never show a broken image after
 * the blob URL is revoked.
 */

import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';

// ─── Constants ────────────────────────────────────────────────────────────────

export const MAX_DATA_URL_BYTES = 10 * 1024 * 1024; // 10 MB

let _uid = 0;
function uid(): string { return `img_${Date.now()}_${++_uid}`; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** True if uri is already a durable data URL. */
export function isDataUrl(uri: string): boolean {
  return uri.startsWith('data:image/');
}

/** True if uri is a web blob / object URL (ephemeral, must be converted). */
export function isBlobUrl(uri: string): boolean {
  return uri.startsWith('blob:');
}

/** True if uri is a remote https URL (durable, no conversion needed on web). */
export function isRemoteUrl(uri: string): boolean {
  return uri.startsWith('https://') || uri.startsWith('http://');
}

function assertDataUrlWithinLimit(dataUrl: string): string {
  // Data URLs are ASCII, so string length is their persisted byte length.
  if (dataUrl.length > MAX_DATA_URL_BYTES) {
    throw new Error(
      `imageUri: encoded image too large to persist (${(dataUrl.length / 1024 / 1024).toFixed(1)} MB > ${MAX_DATA_URL_BYTES / 1024 / 1024} MB limit)`,
    );
  }
  return dataUrl;
}

/**
 * Convert a blob URL or fetch-able URI to a base64 data URL.
 * Throws if conversion fails or the result exceeds MAX_DATA_URL_BYTES.
 */
export async function blobUriToDataUrl(uri: string): Promise<string> {
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`imageUri: could not fetch image (${response.status}): ${uri.slice(0, 80)}`);
  }
  const blob = await response.blob();
  if (blob.size > MAX_DATA_URL_BYTES) {
    throw new Error(
      `imageUri: image too large to persist (${(blob.size / 1024 / 1024).toFixed(1)} MB > ${MAX_DATA_URL_BYTES / 1024 / 1024} MB limit)`,
    );
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error('imageUri: FileReader failed to convert blob to data URL'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('imageUri: FileReader returned unexpected result type'));
        return;
      }
      try {
        resolve(assertDataUrlWithinLimit(reader.result));
      } catch (error) {
        reject(error);
      }
    };
    reader.readAsDataURL(blob);
  });
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * makeDurableUri — turn any picker/clipboard URI into a durable stored URI.
 *
 * @param pickerUri  The URI returned by ImagePicker, Clipboard, or similar.
 * @param ext        File extension hint for native copy (default 'jpg').
 * @returns          A durable URI: data URL on web, Paths.document URI on native.
 * @throws           If conversion fails or the image is too large.
 */
export async function makeDurableUri(pickerUri: string, ext = 'jpg'): Promise<string> {
  // 1. Already a data URL — pass through regardless of platform.
  if (isDataUrl(pickerUri)) return assertDataUrlWithinLimit(pickerUri);

  if (Platform.OS === 'web') {
    // 2. Web: blob URLs are ephemeral; convert to base64 data URL.
    if (isBlobUrl(pickerUri)) {
      return blobUriToDataUrl(pickerUri);
    }
    // 3. Web: remote https:// URLs are durable; retain as-is.
    if (isRemoteUrl(pickerUri)) return pickerUri;
    // 4. Web: anything else (e.g. local file:// on web) — attempt conversion.
    return blobUriToDataUrl(pickerUri);
  }

  // 5. Native: copy picker temp file into app-owned document directory.
  const safeExt = (pickerUri.split('.').pop()?.split('?')[0] ?? ext).toLowerCase();
  const dest = new File(Paths.document, `${uid()}.${safeExt}`);
  const src = new File(pickerUri);
  await src.copy(dest);
  return dest.uri;
}
