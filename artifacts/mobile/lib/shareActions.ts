/**
 * The one way the app shares a link or copies it.
 *
 *  - `shareLink`  — the native share sheet (UIActivityViewController /
 *    Android chooser) via `Share.share`; on web the Web Share API, falling
 *    back to copying. See `shareLinkWithFallback` in lib/shareProfile.ts.
 *  - `copyLink`   — the clipboard, then a short "Link copied" confirmation.
 */
import { Alert, Platform, Share } from 'react-native';
import { shareLinkWithFallback, type ShareLinkResult } from '@/lib/shareProfile';

function webNavigator() {
  return typeof navigator !== 'undefined' ? (navigator as unknown as Parameters<typeof shareLinkWithFallback>[0]['webNavigator']) : null;
}

export async function shareLink(url: string, message: string): Promise<ShareLinkResult> {
  try {
    const result = await shareLinkWithFallback({
      url,
      message,
      platformOS: Platform.OS,
      nativeShare: (content) => Share.share(content),
      webNavigator: webNavigator(),
    });
    if (result === 'copied') Alert.alert('Link copied');
    return result;
  } catch {
    return 'unavailable';
  }
}

export async function copyLink(url: string): Promise<boolean> {
  try {
    if (Platform.OS === 'web') {
      await (navigator as Navigator | undefined)?.clipboard?.writeText?.(url);
    } else {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(url);
    }
    Alert.alert('Link copied');
    return true;
  } catch {
    Alert.alert('Couldn’t copy link', 'Try again.');
    return false;
  }
}
