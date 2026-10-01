import { describe, expect, it } from 'vitest';
import type { ActivityItem } from './activity';
import {
  buildSellerActivitySections, hasUnreadSellerActivity, isSellerActivityItem, matchesSellerChip,
} from './sellerActivity';

const NOW = new Date('2026-10-01T12:00:00Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3600_000).toISOString();
const item = (id: string, type: string, hours: number, extra: Partial<ActivityItem> = {}): ActivityItem => ({
  id, category: 'social', type, title: `${id} ${type}`, body: '', isRead: true, createdAt: ago(hours),
  actorId: `actor-${id}`, actorName: `Actor ${id}`, ...extra,
});

describe('seller activity classification', () => {
  it('keeps only activity around the seller, not orders or payouts', () => {
    expect(isSellerActivityItem({ type: 'post_like' })).toBe(true);
    expect(isSellerActivityItem({ type: 'post_save' })).toBe(true);
    expect(isSellerActivityItem({ type: 'post_tag' })).toBe(true);
    expect(isSellerActivityItem({ type: 'new_order_received' })).toBe(false);
    expect(isSellerActivityItem({ type: 'payout_sent' })).toBe(false);
    expect(isSellerActivityItem({ type: 'price_drop' })).toBe(false);
  });

  it('maps each chip to its types, with saves under All only', () => {
    expect(matchesSellerChip({ type: 'story_like' }, 'likes')).toBe(true);
    expect(matchesSellerChip({ type: 'comment_reply' }, 'comments')).toBe(true);
    expect(matchesSellerChip({ type: 'mention' }, 'mentions')).toBe(true);
    expect(matchesSellerChip({ type: 'post_tag' }, 'mentions')).toBe(true);
    expect(matchesSellerChip({ type: 'repost' }, 'reposts')).toBe(true);
    expect(matchesSellerChip({ type: 'post_share' }, 'reposts')).toBe(true);
    expect(matchesSellerChip({ type: 'new_follower' }, 'followers')).toBe(true);
    expect(matchesSellerChip({ type: 'post_save' }, 'all')).toBe(true);
    expect(matchesSellerChip({ type: 'post_save' }, 'likes')).toBe(false);
    expect(matchesSellerChip({ type: 'payout_sent' }, 'all')).toBe(false);
  });
});

describe('hasUnreadSellerActivity', () => {
  it('flags unread, unmuted seller activity only', () => {
    expect(hasUnreadSellerActivity([item('a', 'post_like', 1, { isRead: false })])).toBe(true);
    expect(hasUnreadSellerActivity([item('a', 'post_like', 1, { isRead: false, isMuted: true })])).toBe(false);
    expect(hasUnreadSellerActivity([item('a', 'new_order_received', 1, { isRead: false })])).toBe(false);
    expect(hasUnreadSellerActivity([item('a', 'post_like', 1)])).toBe(false);
  });
});

describe('buildSellerActivitySections', () => {
  it('groups into Today / This week / Earlier and merges repeat likes', () => {
    const sections = buildSellerActivitySections([
      item('a', 'post_like', 1, { targetId: 'p1' }),
      item('b', 'post_like', 2, { targetId: 'p1' }),
      item('c', 'new_follower', 24 * 3, { targetId: 'u1' }),
      item('d', 'post_comment', 24 * 40),
    ], NOW);
    expect(sections.map((s) => s.title)).toEqual(['Today', 'This week', 'Earlier']);
    expect(sections[0]!.items).toHaveLength(1);
    expect(sections[0]!.items[0]!.actorCount).toBe(2);
  });

  it('folds old unread rows into Today and omits empty groups', () => {
    const sections = buildSellerActivitySections([item('a', 'post_like', 24 * 20, { isRead: false })], NOW);
    expect(sections.map((s) => s.key)).toEqual(['today']);
  });
});
