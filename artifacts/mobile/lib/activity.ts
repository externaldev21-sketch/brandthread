/**
 * Activity Center — pure, platform-free logic.
 *
 * The Activity Center reads the same `notifications_feed` rows as the push
 * notifications system (GET /api/buyer/notifications) for buyers and sellers
 * alike. Everything here is deterministic and unit-tested: bucketing rows by
 * recency, merging repeat social events into one row ("Jay and 12 others liked
 * your post"), relative timestamps, filter classification, tap routing, and
 * the dwell-based mark-as-read tracker used by the list.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** One notifications-feed row as returned by the API. */
export interface ActivityItem {
  id: string;
  category: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  isMuted?: boolean;
  actorId?: string;
  actorName?: string;
  actorHandle?: string;
  actorInitials?: string;
  actorColor?: string;
  targetId?: string;
  targetType?: string;
  targetImageUrl?: string;
  cta?: string;
  createdAt: string;
}

export interface ActivityActor {
  id?: string;
  name: string;
  initials: string;
  color?: string;
}

/** A display row: one feed item, or several merged repeat events. */
export interface ActivityRow extends ActivityItem {
  /** Stable React key (the newest merged item's id). */
  key: string;
  /** Every feed item id this row represents (for read / dismiss). */
  ids: string[];
  /** Distinct actors, newest first. */
  actors: ActivityActor[];
  actorCount: number;
  /** Actors beyond the first ("Jay and 12 others" → 12). */
  extraCount: number;
}

export type ActivitySectionKey = 'new' | 'today' | 'this_week' | 'earlier';

export interface ActivitySection<T = ActivityItem> {
  key: ActivitySectionKey;
  title: string;
  items: T[];
}

export type ActivityFilter = 'all' | 'orders' | 'social';

export const ACTIVITY_FILTERS: ReadonlyArray<{ key: ActivityFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'orders', label: 'Orders' },
  { key: 'social', label: 'Social' },
];

export const ACTIVITY_PAGE_SIZE = 30;

// ─── Relative time ────────────────────────────────────────────────────────────

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Shared relative-time formatter. The default style matches the notifications
 * screen ("5m ago", "3h ago", then a date after a week); `compact` matches the
 * inbox lists ("5m", "3h", "2d", "3w").
 */
export function relativeTime(
  date: string | number | Date,
  now: number | Date = Date.now(),
  options: { compact?: boolean } = {},
): string {
  const then = new Date(date).getTime();
  const current = typeof now === 'number' ? now : now.getTime();
  if (!Number.isFinite(then)) return '';
  const diff = Math.max(0, current - then);
  const mins = Math.floor(diff / MINUTE);
  const suffix = options.compact ? '' : ' ago';
  if (mins < 1) return options.compact ? 'now' : 'just now';
  if (mins < 60) return `${mins}m${suffix}`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h${suffix}`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d${suffix}`;
  if (options.compact) return `${Math.floor(days / 7)}w`;
  return new Date(then).toLocaleDateString();
}

// ─── Recency sections ─────────────────────────────────────────────────────────

const SECTION_TITLES: Record<ActivitySectionKey, string> = {
  new: 'New',
  today: 'Today',
  this_week: 'This week',
  earlier: 'Earlier',
};

function startOfLocalDay(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/**
 * Bucket items into New / Today / This week / Earlier.
 *
 * Unread items always land in "New", whatever their age. Read items are
 * bucketed by `createdAt` against local calendar days: "Today" since local
 * midnight, "This week" the six days before that, "Earlier" everything older.
 * Input order is preserved inside each section and empty sections are omitted.
 */
export function groupByRecency<T extends Pick<ActivityItem, 'isRead' | 'createdAt'>>(
  items: readonly T[],
  now: Date = new Date(),
): ActivitySection<T>[] {
  const todayStart = startOfLocalDay(now);
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
  const buckets: Record<ActivitySectionKey, T[]> = { new: [], today: [], this_week: [], earlier: [] };

  for (const item of items) {
    if (!item.isRead) {
      buckets.new.push(item);
      continue;
    }
    const at = new Date(item.createdAt).getTime();
    if (at >= todayStart) buckets.today.push(item);
    else if (at >= weekStart) buckets.this_week.push(item);
    else buckets.earlier.push(item);
  }

  return (Object.keys(SECTION_TITLES) as ActivitySectionKey[])
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ key, title: SECTION_TITLES[key], items: buckets[key] }));
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

/** Types where repeat events read better as one row. Orders/payments never merge. */
export const AGGREGATED_TYPES: ReadonlySet<string> = new Set(['post_like', 'post_comment', 'new_follower']);

/**
 * Merge key for an item, or null when it never merges. Likes and comments
 * merge per post. Each follow targets a different follower, so follows merge
 * by type alone.
 */
function aggregationKey(item: ActivityItem): string | null {
  if (!AGGREGATED_TYPES.has(item.type)) return null;
  if (item.type === 'new_follower') return 'new_follower';
  return item.targetId ? `${item.type}:${item.targetId}` : null;
}

function actorOf(item: ActivityItem): ActivityActor | null {
  if (!item.actorName && !item.actorId) return null;
  const name = item.actorName || 'Someone';
  return {
    id: item.actorId,
    name,
    initials: item.actorInitials || name.slice(0, 2).toUpperCase(),
    color: item.actorColor,
  };
}

function toRow(item: ActivityItem): ActivityRow {
  const actor = actorOf(item);
  const actors = actor ? [actor] : [];
  return {
    ...item,
    key: item.id,
    ids: [item.id],
    actors,
    actorCount: actors.length,
    extraCount: 0,
  };
}

function sameActor(a: ActivityActor, b: ActivityActor): boolean {
  return a.id && b.id ? a.id === b.id : a.name === b.name;
}

/**
 * Merge consecutive repeat social events (same aggregation key) into single
 * rows carrying the distinct actors. Call once per section so a merged row
 * never spans New and read items. Non-aggregating types pass through as
 * single-item rows.
 */
export function aggregateActivity(items: readonly ActivityItem[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  let currentKey: string | null = null;

  for (const item of items) {
    const key = aggregationKey(item);
    const last = rows[rows.length - 1];
    if (key && last && key === currentKey) {
      last.ids.push(item.id);
      last.isRead = last.isRead && item.isRead;
      const actor = actorOf(item);
      if (actor && !last.actors.some((existing) => sameActor(existing, actor))) {
        last.actors.push(actor);
      }
      last.actorCount = last.actors.length;
      last.extraCount = Math.max(0, last.actorCount - 1);
      continue;
    }
    rows.push(toRow(item));
    currentKey = key;
  }
  return rows;
}

/** Sections of display rows: recency buckets, each aggregated. */
export function buildActivitySections(
  items: readonly ActivityItem[],
  now: Date = new Date(),
): ActivitySection<ActivityRow>[] {
  return groupByRecency(items.filter((item) => !item.isMuted), now).map((section) => ({
    key: section.key,
    title: section.title,
    items: aggregateActivity(section.items),
  }));
}

// ─── Copy ─────────────────────────────────────────────────────────────────────

export interface MessagePart {
  text: string;
  bold?: boolean;
}

/** "Jay", "Jay and Mina", "Jay and 12 others". */
export function actorNames(row: Pick<ActivityRow, 'actors' | 'actorCount'>): MessagePart[] {
  const [first, second] = row.actors;
  if (!first) return [];
  if (row.actorCount === 2 && second) {
    return [{ text: first.name, bold: true }, { text: ' and ' }, { text: second.name, bold: true }];
  }
  if (row.actorCount > 2) {
    const others = row.actorCount - 1;
    return [{ text: first.name, bold: true }, { text: ' and ' }, { text: `${others} others`, bold: true }];
  }
  return [{ text: first.name, bold: true }];
}

/**
 * Rich sentence for a row with bold actor names. Server titles are written as
 * "<actor> <verb phrase>", so the verb phrase is reused for merged rows:
 * "Jay Park liked your post" → "Jay Park and 12 others liked your post".
 * Rows without an actor show their title as the sentence.
 */
export function activityMessage(row: ActivityRow): MessagePart[] {
  const first = row.actors[0];
  if (first && row.title.startsWith(first.name)) {
    const verb = row.title.slice(first.name.length);
    return [...actorNames(row), { text: verb }];
  }
  if (first && row.actorCount > 1) {
    return [...actorNames(row), { text: ` · ${row.title}` }];
  }
  return [{ text: row.title, bold: true }];
}

/** Secondary line under the sentence (comment excerpt, amount, etc.). */
export function activityDetail(row: ActivityRow): string | null {
  // Merged comment rows would show only the newest excerpt; keep them tidy.
  if (row.type === 'post_comment' && row.ids.length > 1) return null;
  if (row.type === 'post_like' || row.type === 'new_follower') return null;
  const body = row.body?.trim();
  if (!body) return null;
  if (row.type === 'post_comment' || row.type === 'comment_reply' || row.type === 'mention') {
    return `“${body}”`;
  }
  return body;
}

// ─── Classification ───────────────────────────────────────────────────────────

/** Mirrors the server's `filter=orders` definition in notifications-feed.ts. */
const ORDER_CATEGORIES = new Set(['orders', 'order', 'payout', 'payouts', 'payment', 'production']);
const ORDER_TYPES = new Set(['low_stock', 'out_of_stock']);
// price_drop/back_in_stock/new_product are published under category "stock"
// (seller alerts) or "social" (buyer alerts) depending on the publisher, but
// they're always a buyer-facing "things you follow/saved" event for the
// Activity Center's purposes.
const SOCIAL_TYPES = new Set(['price_drop', 'back_in_stock', 'waitlist_restock', 'product_restocked', 'new_product']);

export function activityKind(item: Pick<ActivityItem, 'category' | 'type'>): 'orders' | 'social' | 'other' {
  if (ORDER_CATEGORIES.has(item.category) || ORDER_TYPES.has(item.type)) return 'orders';
  if (item.category === 'social' || SOCIAL_TYPES.has(item.type)) return 'social';
  return 'other';
}

export function matchesFilter(item: Pick<ActivityItem, 'category' | 'type'>, filter: ActivityFilter): boolean {
  return filter === 'all' || activityKind(item) === filter;
}

/** Feather icon used when a row has no actor avatar or thumbnail. */
export function activityIcon(item: Pick<ActivityItem, 'type' | 'category'>): string {
  switch (item.type) {
    case 'post_like': return 'heart';
    case 'post_comment':
    case 'comment_reply': return 'message-circle';
    case 'mention': return 'at-sign';
    case 'new_follower': return 'user-plus';
    case 'price_drop': return 'trending-down';
    case 'back_in_stock':
    case 'waitlist_restock':
    case 'product_restocked': return 'refresh-cw';
    case 'new_product': return 'star';
    case 'new_order_received': return 'shopping-bag';
    case 'payout_sent': return 'dollar-sign';
    case 'low_stock': return 'alert-triangle';
    case 'out_of_stock': return 'alert-octagon';
    case 'order_shipped':
    case 'order_out_for_delivery': return 'truck';
    case 'order_delivered': return 'package';
    case 'order_cancelled': return 'x-circle';
    case 'order_exception': return 'alert-triangle';
    case 'thread_cash_received': return 'dollar-sign';
    case 'agent_nudge': return 'zap';
    default:
      break;
  }
  if (item.type.startsWith('order_')) return 'package';
  switch (item.category) {
    case 'messages':
    case 'message': return 'message-square';
    case 'orders':
    case 'order': return 'package';
    case 'payout':
    case 'payment': return 'dollar-sign';
    case 'production': return 'tool';
    case 'subscription': return 'credit-card';
    case 'social': return 'users';
    default: return 'bell';
  }
}

// ─── Routing ──────────────────────────────────────────────────────────────────

/** True for rows that render an inline "Follow back" button instead of navigating. */
export function isFollowBackRow(row: ActivityRow): boolean {
  return row.type === 'new_follower' && row.cta === 'Follow back' && row.actorCount === 1 && !!row.targetId;
}

const q = encodeURIComponent;

/**
 * Where tapping a row goes, or null when there is nowhere useful to go.
 * Routes match the push-notification handler (lib/notificationNavigation.ts)
 * and existing screens.
 */
export function activityHref(row: ActivityItem, role: 'buyer' | 'seller' | null = 'buyer'): string | null {
  const id = row.targetId;
  switch (row.targetType) {
    case 'order':
      return id ? `/order-detail?id=${q(id)}` : '/(tabs)/orders';
    case 'buyer_order':
      return id ? `/buyer-order-detail?id=${q(id)}` : '/(buyer)/orders';
    case 'sample_order':
      return id ? `/sample-detail?id=${q(id)}` : null;
    case 'bulk_order':
      return id ? `/production-detail?id=${q(id)}` : null;
    case 'manufacturer_thread':
      return id ? `/manufacturer-messages?threadId=${q(id)}` : null;
    case 'post':
      if (!id) return null;
      return row.type === 'post_comment' || row.type === 'comment_reply' || row.type === 'mention'
        ? `/buyer-post-comments?postId=${q(id)}`
        : `/buyer-post-viewer?postId=${q(id)}`;
    case 'product':
      return id ? `/buyer-product-detail?productId=${q(id)}` : null;
    case 'user': {
      if (!id) return null;
      const params = [`userId=${q(id)}`];
      if (row.actorName) params.push(`name=${q(row.actorName)}`);
      if (row.actorHandle) params.push(`handle=${q(row.actorHandle)}`);
      if (row.actorInitials) params.push(`initials=${q(row.actorInitials)}`);
      if (row.actorColor) params.push(`color=${q(row.actorColor)}`);
      return `/buyer-other-profile?${params.join('&')}`;
    }
    case 'conversation':
      if (!id) return null;
      return role === 'seller' ? `/seller-conversation?id=${q(id)}` : `/buyer-conversation?id=${q(id)}`;
    case 'variant':
      return '/inventory';
    case 'payout':
      return '/payouts';
    case 'subscription_invoice':
      return '/subscription';
    default:
      break;
  }
  if (row.type.startsWith('order_')) return role === 'seller' ? '/(tabs)/orders' : '/(buyer)/orders';
  return null;
}

// ─── Read state ───────────────────────────────────────────────────────────────

/** Items with the given ids marked read (same array when nothing changes). */
export function applyRead<T extends { id: string; isRead: boolean }>(items: T[], ids: Iterable<string>): T[] {
  const set = new Set(ids);
  if (set.size === 0) return items;
  let changed = false;
  const next = items.map((item) => {
    if (!set.has(item.id) || item.isRead) return item;
    changed = true;
    return { ...item, isRead: true };
  });
  return changed ? next : items;
}

export interface ReadTrackerOptions {
  /** Persist one id as read. Called at most once per id while it succeeds. */
  markRead: (id: string) => Promise<unknown>;
  /** Called with each batch of ids once they are handed to `markRead`. */
  onMarked?: (ids: string[]) => void;
  /** How long an unread row must stay on screen before it counts as seen. */
  dwellMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface ReadTracker {
  /** Report the unread ids currently on screen (replaces the previous set). */
  setVisible(ids: Iterable<string>): void;
  /** Mark ids immediately (e.g. on tap), still de-duplicated. */
  markNow(ids: Iterable<string>): void;
  /** Whether an id has already been sent. */
  hasMarked(id: string): boolean;
  dispose(): void;
}

/**
 * Marks unread rows read once they have stayed visible for `dwellMs`.
 * Rows that scroll away before the dwell elapses are not marked. Ids that
 * become due together are sent as one batch of per-id requests, and an id is
 * never sent twice (re-renders and repeated viewability callbacks are free).
 * A failed request releases its id so a later view can retry.
 */
export function createReadTracker(options: ReadTrackerOptions): ReadTracker {
  const dwellMs = options.dwellMs ?? 500;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const pending = new Map<string, unknown>();
  const sent = new Set<string>();
  let disposed = false;

  const flush = (ids: string[]) => {
    const fresh = ids.filter((id) => !sent.has(id));
    if (fresh.length === 0 || disposed) return;
    for (const id of fresh) sent.add(id);
    options.onMarked?.(fresh);
    for (const id of fresh) {
      options.markRead(id).catch(() => { sent.delete(id); });
    }
  };

  let batch: string[] = [];
  let batchHandle: unknown = null;
  const enqueue = (id: string) => {
    batch.push(id);
    if (batchHandle !== null) return;
    // Rows that come due in the same moment go out together.
    batchHandle = setTimer(() => {
      const due = batch;
      batch = [];
      batchHandle = null;
      flush(due);
    }, 0);
  };

  return {
    setVisible(ids) {
      if (disposed) return;
      const visible = new Set(ids);
      for (const [id, handle] of pending) {
        if (!visible.has(id)) {
          clearTimer(handle);
          pending.delete(id);
        }
      }
      for (const id of visible) {
        if (sent.has(id) || pending.has(id)) continue;
        pending.set(id, setTimer(() => {
          pending.delete(id);
          enqueue(id);
        }, dwellMs));
      }
    },
    markNow(ids) {
      const list = [...ids];
      for (const id of list) {
        const handle = pending.get(id);
        if (handle !== undefined) {
          clearTimer(handle);
          pending.delete(id);
        }
      }
      flush(list);
    },
    hasMarked(id) {
      return sent.has(id);
    },
    dispose() {
      disposed = true;
      for (const handle of pending.values()) clearTimer(handle);
      pending.clear();
      if (batchHandle !== null) clearTimer(batchHandle);
      batch = [];
      batchHandle = null;
    },
  };
}
