/**
 * Crop + downscale for the store logo / banner. Kept apart from
 * lib/storeSetup.ts so that file stays free of native imports.
 */
import { Image } from 'react-native';
import { denormalizeCropRect, type NormalizedCropRect } from '@/lib/mediaCrop';

function imageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

/**
 * Crops `uri` to the cropper's normalized rect and scales it down to at most
 * `maxWidth` wide. Always re-crops from the original pick.
 */
export async function cropToRect(uri: string, rect: NormalizedCropRect, maxWidth: number): Promise<{ uri: string; mimeType: string }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ImageManipulator: typeof import('expo-image-manipulator') = require('expo-image-manipulator');
  const { width, height } = await imageSize(uri);
  const pixels = denormalizeCropRect(rect, width, height);
  const actions: import('expo-image-manipulator').Action[] = [{ crop: pixels }];
  if (pixels.width > maxWidth) actions.push({ resize: { width: maxWidth } });
  const result = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: 0.9,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return { uri: result.uri, mimeType: 'image/jpeg' };
}
