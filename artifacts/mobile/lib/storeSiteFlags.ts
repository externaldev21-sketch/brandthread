/**
 * On-device flags for the store website checklist (My store): whether the
 * seller has shared their link, which steps they skipped, and whether they
 * closed the checklist. Keyed by @username so accounts never share them.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { StoreSiteStepId } from '@/lib/storeSiteChecklist';

export interface StoreSiteFlags {
  linkShared: boolean;
  skipped: StoreSiteStepId[];
  checklistClosed: boolean;
}

const EMPTY: StoreSiteFlags = { linkShared: false, skipped: [], checklistClosed: false };
const key = (username: string) => `@brandthread/store_site_flags:${username.toLowerCase()}`;

export async function readStoreSiteFlags(username: string | null | undefined): Promise<StoreSiteFlags> {
  if (!username) return EMPTY;
  try {
    const raw = await AsyncStorage.getItem(key(username));
    const parsed = raw ? (JSON.parse(raw) as Partial<StoreSiteFlags>) : {};
    return {
      linkShared: parsed.linkShared === true,
      skipped: Array.isArray(parsed.skipped) ? parsed.skipped : [],
      checklistClosed: parsed.checklistClosed === true,
    };
  } catch {
    return EMPTY;
  }
}

export async function updateStoreSiteFlags(username: string | null | undefined, patch: Partial<StoreSiteFlags>): Promise<StoreSiteFlags> {
  const next = { ...(await readStoreSiteFlags(username)), ...patch };
  if (username) await AsyncStorage.setItem(key(username), JSON.stringify(next)).catch(() => {});
  return next;
}
