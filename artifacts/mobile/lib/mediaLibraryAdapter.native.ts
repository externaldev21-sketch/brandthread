import * as MediaLibrary from 'expo-media-library';

export async function saveImageToMediaLibrary(uri: string): Promise<'saved' | 'denied' | 'unavailable'> {
  const permission = await MediaLibrary.requestPermissionsAsync();
  if (!permission.granted) return 'denied';
  await MediaLibrary.createAssetAsync(uri);
  return 'saved';
}