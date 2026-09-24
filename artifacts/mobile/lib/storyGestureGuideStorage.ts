import AsyncStorage from '@react-native-async-storage/async-storage';

function storageKey(userId: string): string {
  return `bt:story-gesture-guide-shown:${userId}:v1`;
}

/** Call once, e.g. on story-viewer mount, to decide whether to render the guide. */
export async function shouldShowStoryGestureGuide(userId: string): Promise<boolean> {
  try {
    const shown = await AsyncStorage.getItem(storageKey(userId));
    return !shown;
  } catch {
    return false;
  }
}

export async function markStoryGestureGuideShown(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(userId), '1');
  } catch {
    // best-effort — worst case the guide shows again next session
  }
}
