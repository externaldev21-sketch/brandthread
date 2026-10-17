/**
 * iOS photo-library assets come back from expo-media-library as `ph://<id>`.
 * Reading those through React Native's image loader can hand back a
 * screen-sized rendition instead of the camera original, and `fetch()` can't
 * read a ph:// video at all. Resolve them to the full-resolution local file
 * (downloading from iCloud if needed) before cropping or uploading.
 * Anything that isn't ph:// is returned unchanged; failures fall back to the
 * original uri so publishing is never blocked by this step.
 */
export function photoLibraryAssetId(uri: string): string | null {
  return uri.startsWith('ph://') ? uri.slice('ph://'.length) || null : null;
}

export async function resolveLocalAssetUri(uri: string): Promise<string> {
  const id = photoLibraryAssetId(uri);
  if (!id) return uri;
  try {
    // Lazy: keeps react-native out of module evaluation (pure callers/tests).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getMediaLibrary } = require('@/lib/mediaLibraryCompat') as typeof import('@/lib/mediaLibraryCompat');
    const MediaLibrary = getMediaLibrary();
    if (!MediaLibrary) return uri;
    const info = await MediaLibrary.getAssetInfoAsync(id, { shouldDownloadFromNetwork: true });
    return info.localUri || uri;
  } catch {
    return uri;
  }
}
