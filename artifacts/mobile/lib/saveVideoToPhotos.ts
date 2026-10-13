/**
 * Downloads a feed video and adds it to the camera roll. Same steps as the
 * Share sheet's "Save video" (components/ThreadShareSheet.tsx), pulled into a
 * helper so the long-press "Video options" sheet can use it without a second
 * copy of the permission + temp-file handling inside a component.
 */
import { Alert, Linking } from 'react-native';
import { getMediaLibrary, mediaLibraryUnavailableMessage } from '@/lib/mediaLibraryCompat';

export type SaveVideoResult =
  | { ok: true }
  | { ok: false; reason: 'cancelled' | 'denied' | 'unavailable' | 'failed'; message: string };

export async function saveVideoToPhotos(
  mediaUri: string,
  postId: string,
  opts: { signal?: AbortSignal; onProgress?: (percent: number) => void } = {},
): Promise<SaveVideoResult> {
  let destination: InstanceType<typeof import('expo-file-system').File> | null = null;
  try {
    const { File, Paths } = await import('expo-file-system');
    const MediaLibrary = getMediaLibrary();
    if (!MediaLibrary) return { ok: false, reason: 'unavailable', message: mediaLibraryUnavailableMessage() };
    const permission = await MediaLibrary.requestPermissionsAsync();
    if (!permission.granted) {
      if (!permission.canAskAgain) {
        Alert.alert(
          'Photos access is off',
          'Allow Brandthread to add videos in Settings, then try again.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open Settings', onPress: () => { void Linking.openSettings().catch(() => {}); } },
          ],
        );
      }
      return { ok: false, reason: 'denied', message: 'Photos permission is required to save this video.' };
    }
    destination = new File(Paths.cache, `brandthread-${postId}-${Date.now()}.mp4`);
    let downloaded;
    if (/^https?:\/\//i.test(mediaUri)) {
      downloaded = await File.downloadFileAsync(mediaUri, destination, {
        idempotent: true,
        signal: opts.signal,
        onProgress: ({ bytesWritten, totalBytes }) => {
          if (totalBytes > 0) opts.onProgress?.(Math.min(99, Math.round((bytesWritten / totalBytes) * 100)));
        },
      });
    } else {
      new File(mediaUri).copy(destination);
      downloaded = destination;
    }
    await MediaLibrary.createAssetAsync(downloaded.uri);
    opts.onProgress?.(100);
    return { ok: true };
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return { ok: false, reason: 'cancelled', message: 'Video save cancelled.' };
    return { ok: false, reason: 'failed', message: "Couldn't save video. Try again." };
  } finally {
    if (destination?.exists) {
      try { destination.delete(); } catch { /* already handed off */ }
    }
  }
}
