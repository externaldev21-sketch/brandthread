/**
 * Save / share / add-to-product for a generated AI image (base64 PNG).
 * Shared by Lifestyle Images and AI Clothing Mockups so both offer the same
 * actions through the same code paths.
 *
 * "Add to product" uploads the image through the product photo pipeline
 * (lib/mockupProductHandoff.ts → api.products.uploadImage) and stores the
 * uploaded object path, never a device cache file:// URI that the OS can
 * purge and that never reaches other devices or buyers.
 */
import { Platform, Share } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { saveImageToMediaLibrary } from '@/lib/mediaLibraryAdapter';
import { mediaLibraryUnavailableMessage } from '@/lib/mediaLibraryCompat';
import { triggerWebDownload } from '@/lib/aiToolMedia';
import { attachMockupToListedProduct } from '@/lib/mockupProductHandoff';
import { updateProduct } from '@/services/productService';
import type { Product } from '@/services/productTypes';

export function generatedImageDataUrl(b64: string): string {
  return `data:image/png;base64,${b64}`;
}

/** A URI the upload/save pipelines can read: a data: URI on web, a cache file on native. */
export function generatedImageLocalUri(b64: string, prefix: string): string {
  if (Platform.OS === 'web') return generatedImageDataUrl(b64);
  const file = new File(Paths.cache, `${prefix}-${Date.now()}.png`);
  file.write(b64, { encoding: 'base64' });
  return file.uri;
}

export type SaveGeneratedImageOutcome =
  | { ok: true; message: string }
  | { ok: false; title: string; message: string };

/** Saves to Photos (native) or downloads the PNG (web, which has no photo library). */
export async function saveGeneratedImage(b64: string, prefix: string): Promise<SaveGeneratedImageOutcome> {
  try {
    if (Platform.OS === 'web') {
      triggerWebDownload(generatedImageDataUrl(b64), `${prefix}-${Date.now()}.png`);
      return { ok: true, message: 'Downloaded.' };
    }
    const outcome = await saveImageToMediaLibrary(generatedImageLocalUri(b64, prefix));
    if (outcome === 'saved') return { ok: true, message: 'Saved to Photos.' };
    if (outcome === 'denied') {
      return { ok: false, title: 'Permission required', message: 'Allow photo library access to save this image.' };
    }
    return { ok: false, title: 'Unavailable', message: mediaLibraryUnavailableMessage() };
  } catch {
    return { ok: false, title: 'Save failed', message: 'Could not save this image. Please try again.' };
  }
}

/** Native share sheet; web downloads instead (there is no share sheet). */
export async function shareGeneratedImage(b64: string, prefix: string): Promise<void> {
  if (Platform.OS === 'web') {
    triggerWebDownload(generatedImageDataUrl(b64), `${prefix}-${Date.now()}.png`);
    return;
  }
  try {
    await Share.share({ url: generatedImageLocalUri(b64, `${prefix}-share`) });
  } catch {
    // The person closed the share sheet — not an error.
  }
}

type ProductImagesApi = Parameters<typeof attachMockupToListedProduct>[0]['api'];

/** Uploads the image and appends it to the product's photos (server + local catalog). */
export async function addGeneratedImageToProduct(
  api: ProductImagesApi,
  product: Pick<Product, 'id' | 'media'>,
  b64: string,
  prefix: string,
): Promise<void> {
  await attachMockupToListedProduct(
    { api, updateLocal: (id, patch) => updateProduct(id, patch as Partial<Product>) },
    product,
    generatedImageLocalUri(b64, prefix),
  );
}
