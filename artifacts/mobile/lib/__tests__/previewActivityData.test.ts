/**
 * Preview Activity Center seed data tests.
 *
 * lib/previewActivityData.ts is pure (no react-native/expo-* imports), so it
 * can be imported directly here. lib/previewActivity.ts (the module the
 * screen actually uses) wraps this with bundled poster image URIs the same
 * way lib/previewInbox.ts wraps previewInboxData.ts — vitest cannot import
 * that wrapper directly (native/asset require() calls), matching
 * previewInbox.test.ts's established pattern for this exact limitation.
 */
import { describe, it, expect } from 'vitest';
import { PREVIEW_ACTIVITY_SEEDS, type PreviewActivitySeed } from '../previewActivityData';
import { buildActivitySections, groupByRecency, type ActivityItem } from '../activity';

function toActivityItem(seed: PreviewActivitySeed): ActivityItem {
  return {
    id: seed.id,
    category: seed.category,
    type: seed.type,
    title: seed.title,
    body: seed.body ?? '',
    isRead: seed.isRead,
    actorId: seed.actorId,
    actorName: seed.actorName,
    actorHandle: seed.actorHandle,
    actorInitials: seed.actorInitials,
    actorColor: seed.actorColor,
    targetId: seed.targetId,
    targetType: seed.targetType,
    targetImageUrl: typeof seed.posterIndex === 'number' ? `poster-${seed.posterIndex}` : undefined,
    cta: seed.cta,
    createdAt: new Date(Date.now() - seed.minutesAgo * 60_000).toISOString(),
  };
}

describe('previewActivityData — seed matches the real ActivityItem shape', () => {
  it('every seed id is unique and prefixed', () => {
    const ids = PREVIEW_ACTIVITY_SEEDS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('preview-activity-')).toBe(true);
  });

  it('every seed carries every field a real ActivityItem-derived row needs', () => {
    for (const seed of PREVIEW_ACTIVITY_SEEDS) {
      expect(typeof seed.type).toBe('string');
      expect(typeof seed.category).toBe('string');
      expect(typeof seed.title).toBe('string');
      expect(typeof seed.isRead).toBe('boolean');
      expect(typeof seed.minutesAgo).toBe('number');
    }
  });

  it('covers the required mix: likes, follows, comments, order shipped/delivered, a price drop, an agent nudge and Thread Cash', () => {
    const types = PREVIEW_ACTIVITY_SEEDS.map((s) => s.type);
    expect(types).toContain('post_like');
    expect(types).toContain('new_follower');
    expect(types).toContain('post_comment');
    expect(types).toContain('order_shipped');
    expect(types).toContain('order_delivered');
    expect(types).toContain('price_drop');
    expect(types).toContain('agent_nudge');
    expect(types).toContain('thread_cash_received');
  });

  it('the Brandthread Agent nudge uses the same identity as the preview inbox', () => {
    const nudge = PREVIEW_ACTIVITY_SEEDS.find((s) => s.type === 'agent_nudge');
    expect(nudge?.actorName).toBe('Brandthread Agent');
    expect(nudge?.actorInitials).toBe('BT');
    expect(nudge?.targetType).toBe('conversation');
  });

  it('follow rows carry a "Follow back" cta and a user target for the inline button', () => {
    const follows = PREVIEW_ACTIVITY_SEEDS.filter((s) => s.type === 'new_follower');
    expect(follows.length).toBeGreaterThan(0);
    for (const follow of follows) {
      expect(follow.cta).toBe('Follow back');
      expect(follow.targetType).toBe('user');
      expect(follow.targetId).toBeTruthy();
    }
  });

  it('has at least one unread row (so the feed demos the "New" state) and some read rows', () => {
    expect(PREVIEW_ACTIVITY_SEEDS.some((s) => !s.isRead)).toBe(true);
    expect(PREVIEW_ACTIVITY_SEEDS.some((s) => s.isRead)).toBe(true);
  });

  it('buckets into Today, This week and Earlier once run through groupByRecency (in addition to New for unread rows)', () => {
    const now = new Date();
    const items = PREVIEW_ACTIVITY_SEEDS.map(toActivityItem);
    const sections = groupByRecency(items, now);
    const keys = sections.map((s) => s.key);
    expect(keys).toContain('new');
    expect(keys).toContain('today');
    expect(keys).toContain('this_week');
    expect(keys).toContain('earlier');
  });

  it('produces non-empty, well-formed activity sections end to end', () => {
    const items = PREVIEW_ACTIVITY_SEEDS.map(toActivityItem);
    const sections = buildActivitySections(items);
    expect(sections.length).toBeGreaterThan(0);
    const totalRows = sections.reduce((sum, s) => sum + s.items.length, 0);
    expect(totalRows).toBeGreaterThan(0);
  });
});
