/**
 * When to show the "What's new" sheet (content/whatsNew.ts), per account.
 * Pure decision + AsyncStorage bookkeeping; the sheet itself lives in
 * components/whats-new/.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WhatsNewNotes } from '@/content/whatsNew';

const KEY_PREFIX = 'bt:whats-new:last-seen:v1:';

export type WhatsNewDecision = 'show' | 'record-silently' | 'nothing';

/**
 * - No record yet: a new install (or the first build with this sheet). Record
 *   the current notes without showing them.
 * - Record differs from the current notes: an update. Show once.
 * - Same notes, or no notes to show: nothing.
 */
export function whatsNewDecision(lastSeenId: string | null, notes: WhatsNewNotes): WhatsNewDecision {
  if (!notes.id || notes.items.length === 0) return 'nothing';
  if (lastSeenId === null) return 'record-silently';
  return lastSeenId === notes.id ? 'nothing' : 'show';
}

export async function readLastSeenWhatsNew(userId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY_PREFIX + userId);
  } catch {
    return null;
  }
}

export function markWhatsNewSeen(userId: string, notesId: string): void {
  void AsyncStorage.setItem(KEY_PREFIX + userId, notesId).catch(() => {});
}
