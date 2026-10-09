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
  return copyText(url, 'Link copied', 'Couldn’t copy link');
}

/** Copies any text (an order number, a code) with a short confirmation. */
export async function copyText(text: string, done = 'Copied', failed = 'Couldn’t copy'): Promise<boolean> {
  try {
    if (Platform.OS === 'web') {
      await (navigator as Navigator | undefined)?.clipboard?.writeText?.(text);
    } else {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(text);
    }
    Alert.alert(done);
    return true;
  } catch {
    Alert.alert(failed, 'Try again.');
    return false;
  }
}
