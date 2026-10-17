/**
 * Share sheet "Send to" row (polish #145), TikTok's share sheet: the people
 * you've messaged most recently come first, then accepted friends you
 * haven't chatted with, no duplicates. Pure.
 */
import type { Conversation, Friendship, AccountType } from '@/services/socialTypes';
import { isOfficialAccountId } from '@/lib/officialAccount';

function httpUri(...values: unknown[]): string | undefined {
  const hit = values.find((v) => typeof v === 'string' && /^https?:\/\//.test(v));
  return typeof hit === 'string' ? hit : undefined;
}

export type ShareTarget = {
  userId: string;
  name: string;
  handle: string;
  initials: string;
  color: string;
  accountType: AccountType;
  /** Real profile photo when the API sent one; absent = initials. */
  avatarUri?: string;
  /** The official @brandthread account — always shows the bundled B mark. */
  isOfficial?: boolean;
  /** Set when there's already a chat with this person — send straight into it. */
  conversationId?: string;
};

export const SHARE_ROW_MAX = 10;

export function recentShareTargets(
  conversations: Conversation[],
  friends: Friendship[],
  myUserId: string | null | undefined,
  max = SHARE_ROW_MAX,
): ShareTarget[] {
  const seen = new Set<string>();
  const out: ShareTarget[] = [];
  const recent = conversations
    .filter((c) => !c.isRequest && !c.isOfficial && c.participants.length > 0)
    .sort((a, b) => (b.lastMessageTs ?? 0) - (a.lastMessageTs ?? 0));
  for (const conv of recent) {
    const others = conv.participants.filter((p) => p.userId !== myUserId && p.userId !== 'me');
    if (others.length !== 1) continue; // groups don't belong in a one-tap row
    const p = others[0];
    if (seen.has(p.userId)) continue;
    seen.add(p.userId);
    out.push({
      userId: p.userId, name: p.name, handle: p.handle, initials: p.initials, color: p.color,
      accountType: p.accountType, conversationId: conv.id,
      avatarUri: httpUri(p.avatarUri), isOfficial: isOfficialAccountId(p.userId),
    });
  }
  for (const f of friends) {
    if (seen.has(f.userId)) continue;
    seen.add(f.userId);
    out.push({ userId: f.userId, name: f.name, handle: f.handle, initials: f.initials, color: f.color, accountType: 'buyer',
      avatarUri: httpUri((f as { avatarUri?: unknown }).avatarUri, (f as { avatarUrl?: unknown }).avatarUrl),
      isOfficial: isOfficialAccountId(f.userId) });
  }
  return out.slice(0, max);
}
