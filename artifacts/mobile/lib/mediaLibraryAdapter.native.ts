import { getMediaLibrary } from '@/lib/mediaLibraryCompat';

export async function saveImageToMediaLibrary(uri: string): Promise<'saved' | 'denied' | 'unavailable'> {
  const MediaLibrary = getMediaLibrary();
  if (!MediaLibrary) return 'unavailable';
  const permission = await MediaLibrary.requestPermissionsAsync();
  if (!permission.granted) return 'denied';
  await MediaLibrary.createAssetAsync(uri);
  return 'saved';
}