/**
 * Storage for the buyer feed's first-time gesture coach — kept separate
 * from FeedGestureGuide.tsx (which pulls in RN UI components) so this pure
 * logic can be unit tested directly.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export function feedGestureGuideKey(userId: string | null | undefined): string {
  return `feed_gesture_guide_seen:${userId ?? 'anon'}`;
}

export async function hasSeenFeedGestureGuide(userId: string | null | undefined): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(feedGestureGuideKey(userId))) != null;
  } catch {
    return true; // fail closed — never re-show on a storage error
  }
}

export async function markFeedGestureGuideSeen(userId: string | null | undefined): Promise<void> {
  try { await AsyncStorage.setItem(feedGestureGuideKey(userId), '1'); } catch {}
}
