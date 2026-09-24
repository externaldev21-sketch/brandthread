import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activityHref,
  activityKind,
  activityMessage,
  aggregateActivity,
  applyRead,
  buildActivitySections,
  createReadTracker,
  groupByRecency,
  isFollowBackRow,
  relativeTime,
  type ActivityItem,
} from './activity';

// Local-time "now": Wednesday 24 Sept 2026, 15:00.
const NOW = new Date(2026, 8, 24, 15, 0, 0);

function at(daysAgo: number, hour = 12, minute = 0): string {
  return new Date(2026, 8, 24 - daysAgo, hour, minute).toISOString();
}

let seq = 0;
function item(overrides: Partial<ActivityItem> = {}): ActivityItem {
  seq += 1;
  return {
    id: `n${seq}`,
    category: 'social',
    type: 'post_like',
    title: 'Jay Park liked your post',
    body: '',
    isRead: true,
    createdAt: at(0),
    ...overrides,
  };
}

function like(actor: string, postId: string, overrides: Partial<ActivityItem> = {}): ActivityItem {
  return item({
    type: 'post_like',
    title: `${actor} liked your post`,
    actorId: `user_${actor}`,
    actorName: actor,
    actorInitials: actor.slice(0, 2).toUpperCase(),
    actorColor: '#8B5CF6',
    targetId: postId,
    targetType: 'post',
    targetImageUrl: `https://cdn.test/${postId}.jpg`,
    ...overrides,
  });
}

describe('groupByRecency', () => {
  it('puts unread items in New regardless of age', () => {
    const old = item({ isRead: false, createdAt: at(40) });
    const fresh = item({ isRead: false, createdAt: at(0, 14) });
    const sections = groupByRecency([fresh, old], NOW);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ key: 'new', title: 'New' });
    expect(sections[0].items.map((i) => i.id)).toEqual([fresh.id, old.id]);
  });

  it('buckets read items by local calendar day boundaries', () => {
    const justAfterMidnight = item({ createdAt: at(0, 0, 1) });
    const lateYesterday = item({ createdAt: at(1, 23, 59) });
    const sixDaysAgo = item({ createdAt: at(6, 0, 1) });
    const sevenDaysAgo = item({ createdAt: at(7, 23, 59) });
    const sections = groupByRecency([justAfterMidnight, lateYesterday, sixDaysAgo, sevenDaysAgo], NOW);

    expect(sections.map((s) => s.key)).toEqual(['today', 'this_week', 'earlier']);
    expect(sections.map((s) => s.title)).toEqual(['Today', 'This week', 'Earlier']);
    expect(sections[0].items).toEqual([justAfterMidnight]);
    expect(sections[1].items).toEqual([lateYesterday, sixDaysAgo]);
    expect(sections[2].items).toEqual([sevenDaysAgo]);
  });

  it('omits empty sections and orders New, Today, This week, Earlier', () => {
    const sections = groupByRecency([
      item({ createdAt: at(30) }),
      item({ isRead: false, createdAt: at(3) }),
    ], NOW);
    expect(sections.map((s) => s.key)).toEqual(['new', 'earlier']);
    expect(groupByRecency([], NOW)).toEqual([]);
  });
});

describe('aggregateActivity', () => {
  it('merges multiple likes on the same post into one row with distinct actors', () => {
    const rows = aggregateActivity([
      like('Jay', 'post1'),
      like('Mina', 'post1'),
      like('Jay', 'post1'), // repeat actor — counted once
      like('Ola', 'post1'),
    ]);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.ids).toHaveLength(4);
    expect(row.actors.map((a) => a.name)).toEqual(['Jay', 'Mina', 'Ola']);
    expect(row.actorCount).toBe(3);
    expect(row.extraCount).toBe(2);
    expect(row.targetImageUrl).toBe('https://cdn.test/post1.jpg');
    expect(activityMessage(row)).toEqual([
      { text: 'Jay', bold: true },
      { text: ' and ' },
      { text: '2 others', bold: true },
      { text: ' liked your post' },
    ]);
  });

  it('names both actors when exactly two people acted', () => {
    const [row] = aggregateActivity([like('Jay', 'post1'), like('Mina', 'post1')]);
    expect(activityMessage(row).map((p) => p.text).join('')).toBe('Jay and Mina liked your post');
  });

  it('does not merge different targets, different types, or non-consecutive runs', () => {
    const rows = aggregateActivity([
      like('Jay', 'post1'),
      like('Mina', 'post2'),
      item({ type: 'post_comment', title: 'Ola commented on your post', actorName: 'Ola', targetId: 'post2' }),
      like('Ola', 'post2'),
      like('Kai', 'post1'),
    ]);
    expect(rows.map((r) => r.ids.length)).toEqual([1, 1, 1, 1, 1]);
  });

  it('never merges orders or payments', () => {
    const order = (id: string) => item({ category: 'orders', type: 'new_order_received', title: 'New order!', targetId: id, targetType: 'order' });
    const rows = aggregateActivity([order('o1'), order('o1'), order('o2')]);
    expect(rows).toHaveLength(3);
  });

  it('merges consecutive new followers by type and only offers Follow back to a single follower', () => {
    const follow = (name: string) => item({
      type: 'new_follower', title: `${name} started following you`, actorId: `u_${name}`,
      actorName: name, targetId: `u_${name}`, targetType: 'user', cta: 'Follow back',
    });
    const [single] = aggregateActivity([follow('Jay')]);
    expect(isFollowBackRow(single)).toBe(true);

    const [merged] = aggregateActivity([follow('Jay'), follow('Mina'), follow('Ola')]);
    expect(merged.actorCount).toBe(3);
    expect(isFollowBackRow(merged)).toBe(false);
    expect(activityMessage(merged).map((p) => p.text).join('')).toBe('Jay and 2 others started following you');
  });

  it('never merges across the New / read boundary when built into sections', () => {
    const sections = buildActivitySections([
      like('Jay', 'post1', { isRead: false }),
      like('Mina', 'post1', { isRead: true }),
    ], NOW);
    expect(sections.map((s) => [s.key, s.items.length])).toEqual([['new', 1], ['today', 1]]);
  });
});

describe('read state', () => {
  it('marking an item read moves it out of New', () => {
    const unread = like('Jay', 'post1', { isRead: false });
    const other = like('Mina', 'post2', { isRead: false });
    const before = buildActivitySections([unread, other], NOW);
    expect(before.map((s) => s.key)).toEqual(['new']);

    const after = buildActivitySections(applyRead([unread, other], [unread.id]), NOW);
    expect(after.map((s) => s.key)).toEqual(['new', 'today']);
    expect(after[0].items.map((r) => r.id)).toEqual([other.id]);
    expect(after[1].items.map((r) => r.id)).toEqual([unread.id]);
  });

  it('applyRead returns the same array when nothing changes', () => {
    const items = [like('Jay', 'post1', { isRead: true })];
    expect(applyRead(items, [items[0].id])).toBe(items);
    expect(applyRead(items, [])).toBe(items);
  });

  describe('createReadTracker', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('marks a row once after it stays visible for the dwell time, despite repeated callbacks', async () => {
      const markRead = vi.fn(async (_id: string) => undefined);
      const onMarked = vi.fn();
      const tracker = createReadTracker({ markRead, onMarked, dwellMs: 500 });

      tracker.setVisible(['a', 'b']);
      vi.advanceTimersByTime(300);
      tracker.setVisible(['a', 'b']); // re-render / viewability churn
      vi.advanceTimersByTime(250);
      tracker.setVisible(['a', 'b']);
      await vi.runAllTimersAsync();

      expect(markRead.mock.calls.map(([id]) => id).sort()).toEqual(['a', 'b']);
      expect(onMarked).toHaveBeenCalledTimes(1);
      expect(onMarked).toHaveBeenCalledWith(['a', 'b']);

      tracker.setVisible(['a', 'b']);
      tracker.markNow(['a']);
      await vi.runAllTimersAsync();
      expect(markRead).toHaveBeenCalledTimes(2);
      tracker.dispose();
    });

    it('does not mark rows that scroll away before the dwell elapses', async () => {
      const markRead = vi.fn(async (_id: string) => undefined);
      const tracker = createReadTracker({ markRead, dwellMs: 500 });
      tracker.setVisible(['a']);
      vi.advanceTimersByTime(200);
      tracker.setVisible([]);
      await vi.runAllTimersAsync();
      expect(markRead).not.toHaveBeenCalled();
      tracker.dispose();
    });

    it('releases an id after a failed request so a later view retries', async () => {
      const markRead = vi.fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue(undefined);
      const tracker = createReadTracker({ markRead, dwellMs: 100 });
      tracker.setVisible(['a']);
      await vi.runAllTimersAsync();
      expect(tracker.hasMarked('a')).toBe(false);

      tracker.setVisible([]);
      tracker.setVisible(['a']);
      await vi.runAllTimersAsync();
      expect(markRead).toHaveBeenCalledTimes(2);
      expect(tracker.hasMarked('a')).toBe(true);
      tracker.dispose();
    });
  });
});

describe('relativeTime', () => {
  const now = new Date(2026, 8, 24, 15, 0).getTime();
  it('formats the notification style', () => {
    expect(relativeTime(now - 20_000, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2d ago');
  });
  it('formats the compact style', () => {
    expect(relativeTime(now - 20_000, now, { compact: true })).toBe('now');
    expect(relativeTime(now - 5 * 60_000, now, { compact: true })).toBe('5m');
    expect(relativeTime(now - 15 * 86_400_000, now, { compact: true })).toBe('2w');
  });
});

describe('classification and routing', () => {
  it('sorts rows into the Orders and Social filters', () => {
    expect(activityKind({ category: 'orders', type: 'new_order_received' })).toBe('orders');
    expect(activityKind({ category: 'system', type: 'low_stock' })).toBe('orders');
    expect(activityKind({ category: 'social', type: 'price_drop' })).toBe('social');
    expect(activityKind({ category: 'messages', type: 'new_friend_message' })).toBe('other');
  });

  it('routes rows to existing screens', () => {
    expect(activityHref(item({ type: 'new_order_received', targetType: 'order', targetId: 'o 1' }), 'seller'))
      .toBe('/order-detail?id=o%201');
    expect(activityHref(item({ type: 'order_shipped', targetType: 'buyer_order', targetId: 'o1' })))
      .toBe('/buyer-order-detail?id=o1');
    expect(activityHref(item({ type: 'post_like', targetType: 'post', targetId: 'p1' })))
      .toBe('/buyer-post-viewer?postId=p1');
    expect(activityHref(item({ type: 'mention', targetType: 'post', targetId: 'p1' })))
      .toBe('/buyer-post-comments?postId=p1');
    expect(activityHref(item({ type: 'price_drop', targetType: 'product', targetId: 'pr1' })))
      .toBe('/buyer-product-detail?productId=pr1');
    expect(activityHref(item({ type: 'new_order_message', targetType: 'conversation', targetId: 'c1' }), 'seller'))
      .toBe('/seller-conversation?id=c1');
    expect(activityHref(item({ type: 'system', category: 'system' }))).toBeNull();
  });
});
