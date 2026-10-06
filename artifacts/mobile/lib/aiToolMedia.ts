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
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function dataUrlToLocalFile(imageUri: string, prefix: string): Promise<string> {
  if (!imageUri.startsWith('data:')) return imageUri;
  const b64 = imageUri.replace(/^data:image\/[a-z]+;base64,/, '');
  const file = new File(Paths.cache, `${prefix}-${Date.now()}.png`);
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
    triggerWebDownload(imageUri, `${filenamePrefix}-${Date.now()}.png`);
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
      triggerWebDownload(imageUri, `${filenamePrefix}-${Date.now()}.png`);
      return;
    }
    const fileUri = await dataUrlToLocalFile(imageUri, `${filenamePrefix}-share`);
    await Share.share({ url: fileUri });
  } catch {
    // user cancelled the share sheet — not an error worth surfacing
  }
}
