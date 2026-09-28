/**
 * Pure helpers for reading a `MessageReaction` across its two shapes — the
 * local/optimistic one (`emoji`/`fromId`/`fromName`) and the server response
 * shape (`reactionType`/`userId`/`userName`) — with no react-native import,
 * so this can be pulled into lib/reactionMutations.ts (and, through it,
 * unit-tested under Vitest, which cannot transform react-native's own
 * source — see tests/reactionMutations.test.ts's doc comment) without
 * dragging react-native in via components/chat/ReactionBar.tsx, which
 * re-exports these for its own (RN) call sites.
 */
import type { ReactionType } from '@/services/socialTypes';

export function reactionKind(r: { emoji?: string; reactionType?: string }): ReactionType {
  return (r.reactionType ?? r.emoji) as ReactionType;
}

export function reactionAuthorId(r: { fromId?: string; userId?: string }): string {
  return r.fromId ?? r.userId ?? '';
}

export function reactionAuthorName(r: { fromName?: string; userName?: string }): string {
  return r.fromName ?? r.userName ?? '?';
}
