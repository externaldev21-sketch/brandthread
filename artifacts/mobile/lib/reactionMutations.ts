/**
 * Pure reaction-state helpers shared by app/buyer-conversation.tsx,
 * app/seller-conversation.tsx and lib/previewInbox.ts — one reducer for
 * "what does this message's reaction list look like after I tap emoji X",
 * used both to drive the optimistic UI update (before the network call
 * resolves) and to decide whether that call should PUT (set/replace) or
 * DELETE (toggle off) the caller's reaction.
 *
 * Kept dependency-free (no react-native/expo imports) so it's plain,
 * synchronous and directly unit-testable — see tests/reactionMutations.test.ts.
 */
import { reactionAuthorId, reactionKind } from '@/lib/reactionShapes';
import type { MessageReaction, ReactionType } from '@/services/socialTypes';

/** The reaction `myId` currently has on this message, if any. */
export function myReactionIn(reactions: MessageReaction[], myId: string): ReactionType | null {
  const mine = reactions.find((r) => reactionAuthorId(r) === myId);
  return mine ? reactionKind(mine) : null;
}

/**
 * Reducer: `reactions` after `myId` taps `type`. Re-tapping the same kind
 * toggles it off (matches the real one-reaction-per-user-per-message backend
 * rule in artifacts/api-server/src/routes/conversations.ts); tapping a
 * different kind replaces whatever reaction `myId` already had. Never
 * touches anyone else's reaction.
 */
export function applyOptimisticReaction(
  reactions: MessageReaction[],
  myId: string,
  myName: string,
  type: ReactionType,
): { next: MessageReaction[]; isToggleOff: boolean } {
  const isToggleOff = myReactionIn(reactions, myId) === type;
  const others = reactions.filter((r) => reactionAuthorId(r) !== myId);
  const next: MessageReaction[] = isToggleOff
    ? others
    : [
        ...others,
        {
          emoji: type,
          reactionType: type,
          fromId: myId,
          fromName: myName,
          createdAt: new Date().toISOString(),
        },
      ];
  return { next, isToggleOff };
}

/** Groups a message's reactions by kind → count, for the pill/summary row
 *  under a bubble. Ignores any entry with an unrecognized/missing kind. */
export function groupReactionCounts(reactions: MessageReaction[]): Array<[ReactionType, number]> {
  const grouped = new Map<ReactionType, number>();
  for (const r of reactions) {
    const kind = reactionKind(r);
    if (!kind) continue;
    grouped.set(kind, (grouped.get(kind) ?? 0) + 1);
  }
  return Array.from(grouped.entries());
}
