/**
 * Shared "take a photo or choose from library" flow for profile images
 * (buyer avatar, seller avatar/logo/banner). Crop is square/circle for
 * avatars and wide for banners depending on the aspect passed in.
 */
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

export async function pickProfileImage(opts: {
  aspect: [number, number];
  title?: string;
}): Promise<ImagePicker.ImagePickerAsset | null> {
  return new Promise((resolve) => {
    const openLibrary = async () => {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Allow photo library access to choose a photo.');
        resolve(null);
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        aspect: opts.aspect,
        quality: 0.9,
        mediaTypes: ['images'],
      });
      resolve(res.canceled || !res.assets[0] ? null : res.assets[0]);
    };
    const openCamera = async () => {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Allow camera access to take a photo.');
        resolve(null);
        return;
      }
      const res = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: opts.aspect,
        quality: 0.9,
      });
      resolve(res.canceled || !res.assets[0] ? null : res.assets[0]);
    };
    Alert.alert(opts.title ?? 'Update photo', undefined, [
      { text: 'Take Photo', onPress: () => { void openCamera(); } },
      { text: 'Choose from Library', onPress: () => { void openLibrary(); } },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
    ]);
  });
}
