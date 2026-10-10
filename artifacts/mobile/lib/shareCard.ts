/**
 * Helpers for rendering a profile to a shareable 1080x1920 (9:16) image and
 * getting that image into Instagram Stories, the Photos library, or the
 * system share sheet.
 *
 * Kept separate from lib/shareProfile.ts (canonical URL construction) so the
 * pure URL logic stays testable without touching native modules.
 */
import { Linking, Platform, Share } from 'react-native';
import { getMediaLibrary } from '@/lib/mediaLibraryCompat';

export const STORY_CARD_WIDTH = 1080;
export const STORY_CARD_HEIGHT = 1920;

/**
 * Renders an arbitrary view (e.g. the share-profile QR card, not a fixed
 * story-sized frame) to a PNG, scaled up from its on-screen dp size for a
 * crisp download. Used by the share-profile "Download" tile, which saves
 * just the QR + handle card — never the surrounding background.
 */
export async function captureCardAtNaturalSize(
  ref: React.RefObject<any>,
  onScreenSize: number,
  scale = 3,
): Promise<string> {
  const { captureRef } = await import('react-native-view-shot');
  return captureRef(ref, {
    format: 'png',
    quality: 1,
    result: Platform.OS === 'web' ? 'data-uri' : 'tmpfile',
    width: onScreenSize * scale,
    height: onScreenSize * scale,
  });
}

/**
 * Triggers a browser download of a data-URI image. Web-only counterpart to
 * `saveCardImageToLibrary` (native), reusing the same anchor-click pattern
 * used elsewhere in the app (see app/design-canvas.tsx `triggerWebDownload`).
 */
export function triggerWebImageDownload(dataUrl: string, filename: string): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export type ShareCardVariant = 'portrait' | 'grid';

export interface CardThumbnail {
  id: string;
  uri?: string;
}

export interface BuyerShareCardData {
  kind: 'buyer';
  name: string;
  handle: string;
  avatarUri: string | null;
  statLabel: string;
  statValue: number;
  topPosts: CardThumbnail[];
}

export interface SellerShareCardData {
  kind: 'seller';
  brandName: string;
  handle: string;
  logoUri: string | null;
  rating: { avgRating: number; totalCount: number } | null;
  products: CardThumbnail[];
}

export type ShareCardData = BuyerShareCardData | SellerShareCardData;

/**
 * Renders the given view-shot ref to a PNG file sized exactly
 * STORY_CARD_WIDTH x STORY_CARD_HEIGHT, regardless of its on-screen dp size.
 */
export async function captureShareCard(ref: React.RefObject<any>): Promise<string> {
  const { captureRef } = await import('react-native-view-shot');
  return captureRef(ref, {
    format: 'png',
    quality: 1,
    result: 'tmpfile',
    width: STORY_CARD_WIDTH,
    height: STORY_CARD_HEIGHT,
  });
}

/**
 * Shares an already-rendered card image straight to Instagram Stories when
 * the Instagram app is installed and a native share module is available;
 * otherwise falls back to the system share sheet.
 */
export async function shareCardToInstagramStories(imageUri: string): Promise<'stories' | 'system' | 'cancelled'> {
  if (Platform.OS !== 'web') {
    try {
      const canOpenStories = await Linking.canOpenURL('instagram-stories://share');
      if (canOpenStories) {
        const RNShare = (await import('react-native-share')).default;
        await RNShare.shareSingle({
          social: RNShare.Social.INSTAGRAM_STORIES,
          backgroundImage: imageUri,
          appId: 'com.brandthread.app',
        } as never);
        return 'stories';
      }
    } catch {
      // Instagram Stories share unavailable or dismissed — fall back below.
    }
  }
  try {
    await Share.share(Platform.OS === 'ios' ? { url: imageUri } : { message: imageUri });
    return 'system';
  } catch {
    return 'cancelled';
  }
}

export type SaveCardResult = { ok: true } | { ok: false; canAskAgain: boolean; unavailable?: boolean };

/** Saves a rendered card image to the device's Photos library. */
export async function saveCardImageToLibrary(imageUri: string): Promise<SaveCardResult> {
  const MediaLibrary = getMediaLibrary();
  if (!MediaLibrary) return { ok: false, canAskAgain: false, unavailable: true };
  const permission = await MediaLibrary.requestPermissionsAsync();
  if (!permission.granted) {
    return { ok: false, canAskAgain: permission.canAskAgain };
  }
  await MediaLibrary.createAssetAsync(imageUri);
  return { ok: true };
}
