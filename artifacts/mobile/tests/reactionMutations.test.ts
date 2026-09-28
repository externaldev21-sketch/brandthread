/**
 * Pure-logic coverage for the reaction reducer shared by
 * app/buyer-conversation.tsx, app/seller-conversation.tsx and
 * lib/previewInbox.ts's preview-mode mutator (item 68: chat reactions
 * glass) — the optimistic add/remove/replace transform applied to a
 * message's reaction list before the real network call resolves, and
 * rolled back to on failure by the caller.
 */
import { describe, expect, it } from 'vitest';
import { applyOptimisticReaction, myReactionIn, groupReactionCounts } from '@/lib/reactionMutations';
import type { MessageReaction } from '@/services/socialTypes';

const seller: MessageReaction = {
  emoji: 'like', reactionType: 'like', fromId: 'seller-1', fromName: 'Maison Vela', createdAt: '2024-01-01T00:00:00.000Z',
};

describe('myReactionIn', () => {
  it('finds the caller\'s own reaction by fromId', () => {
    expect(myReactionIn([seller], 'seller-1')).toBe('like');
  });
  it('returns null when the caller has no reaction on this message', () => {
    expect(myReactionIn([seller], 'buyer-1')).toBeNull();
  });
  it('also reads the server response shape (userId/reactionType)', () => {
    const serverShape = { userId: 'buyer-1', userName: 'You', reactionType: 'fire' } as unknown as MessageReaction;
    expect(myReactionIn([serverShape], 'buyer-1')).toBe('fire');
  });
});

describe('applyOptimisticReaction', () => {
  it('adds a new reaction for a caller with none yet, leaving others untouched', () => {
    const { next, isToggleOff } = applyOptimisticReaction([seller], 'buyer-1', 'You', 'love');
    expect(isToggleOff).toBe(false);
    expect(next).toHaveLength(2);
    expect(next.find(r => r.fromId === 'seller-1')).toEqual(seller);
    const mine = next.find(r => r.fromId === 'buyer-1')!;
    expect(mine.reactionType).toBe('love');
    expect(mine.emoji).toBe('love');
    expect(mine.fromName).toBe('You');
  });

  it('toggles the reaction OFF when re-tapping the same kind', () => {
    const mine: MessageReaction = { emoji: 'love', reactionType: 'love', fromId: 'buyer-1', fromName: 'You', createdAt: 'x' };
    const { next, isToggleOff } = applyOptimisticReaction([seller, mine], 'buyer-1', 'You', 'love');
    expect(isToggleOff).toBe(true);
    expect(next).toEqual([seller]);
  });

  it('replaces (not adds to) the caller\'s prior reaction when tapping a different kind', () => {
    const mine: MessageReaction = { emoji: 'love', reactionType: 'love', fromId: 'buyer-1', fromName: 'You', createdAt: 'x' };
    const { next, isToggleOff } = applyOptimisticReaction([seller, mine], 'buyer-1', 'You', 'haha');
    expect(isToggleOff).toBe(false);
    expect(next).toHaveLength(2);
    const myNext = next.find(r => r.fromId === 'buyer-1')!;
    expect(myNext.reactionType).toBe('haha');
    // Never a second entry for the same user.
    expect(next.filter(r => r.fromId === 'buyer-1')).toHaveLength(1);
  });

  it('never mutates the input array (callers roll back by keeping the old reference)', () => {
    const original = [seller];
    const before = [...original];
    applyOptimisticReaction(original, 'buyer-1', 'You', 'wow');
    expect(original).toEqual(before);
  });
});

describe('groupReactionCounts', () => {
  it('groups by kind and counts, ignoring unrecognized entries', () => {
    const reactions: MessageReaction[] = [
      seller,
      { emoji: 'like', reactionType: 'like', fromId: 'buyer-1', fromName: 'You', createdAt: 'x' },
      { emoji: 'fire', reactionType: 'fire', fromId: 'buyer-2', fromName: 'Alex', createdAt: 'x' },
    ];
    const grouped = groupReactionCounts(reactions);
    expect(new Map(grouped).get('like')).toBe(2);
    expect(new Map(grouped).get('fire')).toBe(1);
  });

  it('returns an empty list for no reactions', () => {
    expect(groupReactionCounts([])).toEqual([]);
  });
});
