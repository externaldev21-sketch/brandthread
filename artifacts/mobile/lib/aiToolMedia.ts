/**
 * Brandthread AI Tools — shared save/share helpers
 *
 * Save-to-camera-roll + share logic used across the AI-tools family
 * (Mockup to Model, Remove Background, AI Photoshoot, ...). One
 * implementation instead of each screen growing its own: native saves go
 * through expo-media-library with a real permission prompt; web has no
 * media library, so it falls back to a programmatic anchor-click download.
 */
import { Platform, Share } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { getMediaLibrary } from '@/lib/mediaLibraryCompat';

/** Programmatically download a data/http(s) URL in the browser. */
export function triggerWebDownload(url: string, filename: string) {
  // data: URIs go through a Blob URL: print-size images are many MB, which
  // browsers can refuse to download straight from an href.
  let href = url;
  let objectUrl: string | null = null;
  if (url.startsWith('data:') && typeof Blob !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const comma = url.indexOf(',');
    const meta = url.slice(5, comma);
    const mime = meta.split(';')[0] || 'application/octet-stream';
    const body = url.slice(comma + 1);
    let bytes: Uint8Array<ArrayBuffer>;
    if (meta.includes(';base64')) {
      const bin = atob(body);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(body));
    }
    objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
    href = objectUrl;
  }
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl!), 30_000);
}

/** File extension matching a data URL's image type (the AI tools return PNG cutouts and JPEG photos). */
export function imageExtension(imageUri: string): 'png' | 'jpg' | 'webp' {
  const mime = /^data:image\/([a-z]+);/.exec(imageUri)?.[1];
  if (mime === 'jpeg' || mime === 'jpg') return 'jpg';
  if (mime === 'webp') return 'webp';
  return 'png';
}

export async function dataUrlToLocalFile(imageUri: string, prefix: string): Promise<string> {
  if (!imageUri.startsWith('data:')) return imageUri;
  const b64 = imageUri.replace(/^data:image\/[a-z]+;base64,/, '');
  const file = new File(Paths.cache, `${prefix}-${Date.now()}.${imageExtension(imageUri)}`);
  file.write(b64, { encoding: 'base64' });
  return file.uri;
}

/**
 * Saves one image to the device's camera roll (native) or downloads it
 * (web). Returns whether it succeeded — the caller decides how to
 * communicate that (toast, Alert, etc — deliberately left to the caller
 * since screens differ on how loud that confirmation should be).
 */
export async function saveImageToCameraRoll(imageUri: string, filenamePrefix = 'brandthread'): Promise<
  { ok: true } | { ok: false; reason: 'permission' | 'error' | 'unavailable' }
> {
  if (Platform.OS === 'web') {
    triggerWebDownload(imageUri, `${filenamePrefix}-${Date.now()}.${imageExtension(imageUri)}`);
    return { ok: true };
  }
  try {
    const MediaLibrary = getMediaLibrary();
    if (!MediaLibrary) return { ok: false, reason: 'unavailable' };
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') return { ok: false, reason: 'permission' };
    const fileUri = await dataUrlToLocalFile(imageUri, filenamePrefix);
    await MediaLibrary.createAssetAsync(fileUri);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/** Saves several images in sequence; returns how many succeeded. */
export async function saveAllToCameraRoll(
  imageUris: string[],
  filenamePrefix = 'brandthread',
): Promise<{ succeeded: number; failed: number; unavailable: number }> {
  let succeeded = 0;
  let failed = 0;
  let unavailable = 0;
  for (const uri of imageUris) {
    const result = await saveImageToCameraRoll(uri, filenamePrefix);
    if (result.ok) succeeded++;
    else {
      failed++;
      if (result.reason === 'unavailable') unavailable++;
    }
  }
  return { succeeded, failed, unavailable };
}

/** Opens the native share sheet (native) or downloads (web, no share sheet exists). */
export async function shareImage(imageUri: string, filenamePrefix = 'brandthread'): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      triggerWebDownload(imageUri, `${filenamePrefix}-${Date.now()}.${imageExtension(imageUri)}`);
      return;
    }
    const fileUri = await dataUrlToLocalFile(imageUri, `${filenamePrefix}-share`);
    await Share.share({ url: fileUri });
  } catch {
    // user cancelled the share sheet — not an error worth surfacing
  }
}
