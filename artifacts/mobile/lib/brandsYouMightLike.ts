/**
 * "Brands you might like" row — visibility rules + persisted dismissal (pure
 * apart from AsyncStorage, which is wrapped so a blocked store never throws).
 *
 * The row shows on Discover (For You) after signup until the buyer follows
 * FOLLOW_THRESHOLD brands or dismisses it; it is hidden entirely when there is
 * nothing honest to recommend.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const FOLLOW_THRESHOLD = 5;
export const dismissKey = (userId: string) => `bt:brands-you-might-like:dismissed:v1:${userId}`;

export function shouldShowBrandsRow(input: {
  signedIn: boolean;
  dismissed: boolean;
  brandCount: number;
  followedBrandCount: number;
}): boolean {
  return input.signedIn
    && !input.dismissed
    && input.brandCount > 0
    && input.followedBrandCount < FOLLOW_THRESHOLD;
}

export async function readDismissed(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(dismissKey(userId))) === '1';
  } catch {
    return false;
  }
}

export async function writeDismissed(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(dismissKey(userId), '1');
  } catch { /* the row just reappears next launch */ }
}
