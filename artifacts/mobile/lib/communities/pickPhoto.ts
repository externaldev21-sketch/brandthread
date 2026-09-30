/**
 * Pick a square photo and run it through the moderated community upload.
 * Resolves null when the person cancels. Throws with calm copy otherwise
 * (a 422 IMAGE_REJECTED carries the server's own message).
 */
import * as ImagePicker from 'expo-image-picker';
import type { CommunityClient } from './useCommunityClient';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function pickAndUploadCommunityPhoto(client: CommunityClient): Promise<{ uri: string; url: string } | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Allow photo access in Settings to add a group photo.');
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.7,
    base64: true,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  if (!asset.base64) throw new Error("We couldn't read that photo. Try another one.");
  const mimeType = asset.mimeType && ALLOWED.has(asset.mimeType) ? asset.mimeType : 'image/jpeg';
  const { url } = await client.uploadPhoto({ data: asset.base64, mimeType });
  return { uri: asset.uri, url };
}
