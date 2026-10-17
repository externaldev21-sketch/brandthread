/**
 * Share sheet "More" contact picker: every 1:1 DM conversation plus every
 * accepted friend (deduped, recent chats first) and a name/handle search.
 * Pure — the sheet loads the data and sends through its own sendToFriend.
 */
import type { Conversation, Friendship } from '@/services/socialTypes';
import { recentShareTargets, type ShareTarget } from '@/lib/shareRecents';

export function allShareTargets(
  conversations: Conversation[],
  friends: Friendship[],
  myUserId: string | null | undefined,
): ShareTarget[] {
  return recentShareTargets(conversations, friends, myUserId, Number.MAX_SAFE_INTEGER);
}

export function filterShareTargets(targets: ShareTarget[], query: string): ShareTarget[] {
  const q = query.trim().replace(/^@/, '').toLowerCase();
  if (!q) return targets;
  return targets.filter((t) =>
    t.name.toLowerCase().includes(q) || (t.handle ?? '').replace(/^@/, '').toLowerCase().includes(q));
}
