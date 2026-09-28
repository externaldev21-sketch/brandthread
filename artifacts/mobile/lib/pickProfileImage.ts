/**
 * Shared "take a photo or choose from library" flow for profile images
 * (buyer avatar, seller avatar/logo/banner). Crop is square/circle for
 * avatars and wide for banners depending on the aspect passed in.
 */
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

/** Opens the camera and returns the captured asset, or null if cancelled/denied. */
export async function pickFromCamera(aspect: [number, number]): Promise<ImagePicker.ImagePickerAsset | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Permission needed', 'Allow camera access to take a photo.');
    return null;
  }
  const res = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect, quality: 0.9 });
  return res.canceled || !res.assets[0] ? null : res.assets[0];
}

/** Opens the photo library and returns the chosen asset, or null if cancelled/denied. */
export async function pickFromLibrary(aspect: [number, number]): Promise<ImagePicker.ImagePickerAsset | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Permission needed', 'Allow photo library access to choose a photo.');
    return null;
  }
  const res = await ImagePicker.launchImageLibraryAsync({
    allowsEditing: true, aspect, quality: 0.9, mediaTypes: ['images'],
  });
  return res.canceled || !res.assets[0] ? null : res.assets[0];
}

/**
 * Opens the video library for an avatar video pick. No `allowsEditing` (RN's
 * video trim UI is unreliable across platforms) — the caller checks
 * `asset.duration` (ms) against the 10s avatar-video limit itself and shows
 * its own "too long" message; the server re-validates and rejects again
 * regardless, so a client bypass can never actually land a longer clip.
 */
export async function pickVideoFromLibrary(): Promise<ImagePicker.ImagePickerAsset | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Permission needed', 'Allow photo library access to choose a video.');
    return null;
  }
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 1 });
  return res.canceled || !res.assets[0] ? null : res.assets[0];
}

/** Records a fresh avatar video, capped at the source (camera can enforce this directly). */
export async function recordAvatarVideo(maxDurationSeconds: number): Promise<ImagePicker.ImagePickerAsset | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Permission needed', 'Allow camera access to record a video.');
    return null;
  }
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], quality: 1, videoMaxDuration: maxDurationSeconds });
  return res.canceled || !res.assets[0] ? null : res.assets[0];
}

/**
 * @deprecated The source choice ("Take Photo" / "Choose from Library") is
 * now presented as a real `<BottomSheet>` — see `useImageSourceSheet` in
 * components/profile/ImageSourceSheet.tsx — because `Alert.alert` with
 * multiple buttons is a silent no-op on react-native-web, which made this
 * a dead tap on web. Kept only for any native-only caller; every screen in
 * this app now uses the sheet.
 */
export async function pickProfileImage(opts: {
  aspect: [number, number];
  title?: string;
}): Promise<ImagePicker.ImagePickerAsset | null> {
  return new Promise((resolve) => {
    Alert.alert(opts.title ?? 'Update photo', undefined, [
      { text: 'Take Photo', onPress: () => { void pickFromCamera(opts.aspect).then(resolve); } },
      { text: 'Choose from Library', onPress: () => { void pickFromLibrary(opts.aspect).then(resolve); } },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
    ]);
  });
}
