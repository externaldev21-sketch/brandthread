/**
 * "Share your store" — the store link every seller surface hands out and the
 * on-device record that the seller has shared it (the last step of the
 * dashboard's first-sale checklist). One link everywhere: the canonical
 * public address the dashboard title row already copies
 * (lib/shareProfile — brandthread.app/u/<username>), which the API serves as
 * a real landing page with link previews.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { buildCanonicalProfileUrl } from '@/lib/shareProfile';

const KEY_PREFIX = '@brandthread/store_shared:';

export function storeSharedKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

/** The seller's public store link, or null until they have a valid username. */
export function sellerStoreLink(username: string | null | undefined): string | null {
  return buildCanonicalProfileUrl(username);
}

/** "brandthread.app/store/name" — the link without the scheme, for display. */
export function displayStoreLink(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

export async function hasSharedStore(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  try {
    return (await AsyncStorage.getItem(storeSharedKey(userId))) === '1';
  } catch {
    return false;
  }
}

export async function markStoreShared(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(storeSharedKey(userId), '1');
  } catch {
    /* best effort — the checklist simply keeps showing the step */
  }
}
