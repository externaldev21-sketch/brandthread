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

import { storyMentionViewerHref } from './storyMentionsRail';

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
  actorAvatarUrl?: string;
  targetId?: string;
  targetType?: string;
  targetImageUrl?: string;
  cta?: string;
  /** Comment / reply / mention rows: the exact comment (targetId is the post). */
  commentId?: string;
  /**
   * New-follower rows only: whether the viewer follows this person right
   * now (live, from the feed endpoint). Absent from older servers/rows, in
   * which case the stored `cta` is the only signal.
   */
  isFollowingActor?: boolean;
  createdAt: string;
}

export interface ActivityActor {
  id?: string;
  name: string;
  initials: string;
  color?: string;
  avatarUrl?: string;
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

export type ActivitySectionKey = 'new' | 'today' | 'this_week' | 'this_month' | 'earlier';

export interface ActivitySection<T = ActivityItem> {
  key: ActivitySectionKey;
  title: string;
  items: T[];
}

export type ActivityFilter = 'all' | 'orders' | 'social';

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
  this_month: 'This month',
  earlier: 'Earlier',
};

function startOfLocalDay(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/**
 * Bucket items into New / Today / This week / This month / Earlier.
 *
 * Unread items always land in "New", whatever their age. Read items are
 * bucketed by `createdAt` against local calendar days: "Today" since local
 * midnight, "This week" the six days before that, "This month" the rest of
 * the last 30 days, "Earlier" everything older. Input order is preserved
 * inside each section and empty sections are omitted.
 */
export function groupByRecency<T extends Pick<ActivityItem, 'isRead' | 'createdAt'>>(
  items: readonly T[],
  now: Date = new Date(),
): ActivitySection<T>[] {
  const todayStart = startOfLocalDay(now);
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29).getTime();
  const buckets: Record<ActivitySectionKey, T[]> = {
    new: [], today: [], this_week: [], this_month: [], earlier: [],
  };

  for (const item of items) {
    if (!item.isRead) {
      buckets.new.push(item);
      continue;
    }
    const at = new Date(item.createdAt).getTime();
    if (at >= todayStart) buckets.today.push(item);
    else if (at >= weekStart) buckets.this_week.push(item);
    else if (at >= monthStart) buckets.this_month.push(item);
    else buckets.earlier.push(item);
  }

  return (Object.keys(SECTION_TITLES) as ActivitySectionKey[])
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ key, title: SECTION_TITLES[key], items: buckets[key] }));
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

/** Types where repeat events read better as one row. Orders/payments never merge. */
export const AGGREGATED_TYPES: ReadonlySet<string> = new Set([
  'post_like', 'post_comment', 'new_follower', 'story_like', 'repost', 'post_save', 'post_share',
]);

/**
 * Merge key for an item, or null when it never merges. Likes, comments and
 * reposts merge per post/story. Each follow targets a different follower, so
 * follows merge by type alone.
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
    avatarUrl: item.actorAvatarUrl,
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
  return [{ text: stripEmoji(row.title), bold: true }];
}

// Explicit ranges rather than \p{Extended_Pictographic}, which Hermes
// doesn't reliably support. Pictographs, symbols & dingbats (minus the plain
// ✓/✔ check glyphs, which are monochrome text), flags, VS16 and ZWJ.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{2712}\u{2715}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;

/**
 * System titles without emoji. Older order rows were stored as "Your order
 * has shipped! 🚚" / "…delivered! 📦" / "New order! 🛍️" (the server copy no
 * longer has them); colour emoji break the monochrome brand, and each row
 * already carries its own monochrome icon (activityIcon). Only system rows
 * are cleaned — never a person's name.
 */
export function stripEmoji(text: string): string {
  return text.replace(EMOJI, '').replace(/\s{2,}/g, ' ').trim();
}

/** Secondary line under the sentence (comment excerpt, amount, etc.). */
export function activityDetail(row: ActivityRow): string | null {
  // Merged comment rows would show only the newest excerpt; keep them tidy.
  if (row.type === 'post_comment' && row.ids.length > 1) return null;
  if (row.type === 'post_like' || row.type === 'new_follower' || row.type === 'story_like' || row.type === 'repost'
    || row.type === 'story_mention' || row.type === 'story_reshare' || row.type === 'post_save'
    || row.type === 'post_share' || row.type === 'post_tag') return null;
  const body = row.body?.trim();
  if (!body) return null;
  if (row.type === 'post_comment' || row.type === 'comment_reply' || row.type === 'mention') {
    return `“${body}”`;
  }
  return body;
}

// ─── Classification ───────────────────────────────────────────────────────────

/** Mirrors the server's `filter=orders` definition in notifications-feed.ts. */
const ORDER_CATEGORIES = new Set(['orders', 'order', 'payout', 'payouts', 'payment', 'production', 'returns']);
const ORDER_TYPES = new Set(['low_stock', 'out_of_stock']);

/**
 * Order updates published to the BUYER (routes/orders.ts, webhooks-shippo,
 * webhooks-shopify, dropLifecycle, lib/orderNotifications.ts). Seller-side
 * order types (new_order_received, order_cancelled_by_buyer,
 * shopify_order_cancelled) are deliberately absent.
 */
const BUYER_ORDER_TYPES = new Set([
  'order_confirmed', 'order_shipped', 'order_out_for_delivery', 'order_delivered',
  'order_cancelled', 'order_exception', 'order_returned_to_sender',
  // Delivery guarantee (docs/payments/delivery-guarantee.md)
  'order_preparing', 'order_auto_refunded', 'order_refund_warning',
]);

export function isBuyerOrderNotification(type: string | undefined | null): boolean {
  return !!type && BUYER_ORDER_TYPES.has(type);
}
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

// ─── Filter chips ─────────────────────────────────────────────────────────────

/**
 * The Activity tab's filter chips — Threads' own Activity pattern (a pill
 * row over one feed: https://mobbin.com/screens/cb296e3d-df9e-4c48-a030-0f08248197d5).
 * Same set for buyers and sellers: the feed is per account, not per role,
 * so every category below can show up in either mode.
 */
export type ActivityChip = 'all' | 'follows' | 'likes' | 'comments' | 'orders' | 'thread_cash';

export const ACTIVITY_CHIPS: readonly { key: ActivityChip; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'follows', label: 'Follows' },
  { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Comments' },
  { key: 'orders', label: 'Orders' },
  { key: 'thread_cash', label: 'Thread Cash' },
];

const FOLLOW_TYPES = new Set(['new_follower']);
const LIKE_TYPES = new Set(['post_like', 'story_like']);
const COMMENT_TYPES = new Set(['post_comment', 'comment_reply', 'mention', 'story_mention']);
const THREAD_CASH_TYPES = new Set(['thread_cash_received']);

/** Which chip an item belongs to; 'other' rows (reposts, drops…) show under All only. */
export function activityCategory(item: Pick<ActivityItem, 'category' | 'type'>): Exclude<ActivityChip, 'all'> | 'other' {
  if (activityKind(item) === 'orders') return 'orders';
  if (FOLLOW_TYPES.has(item.type)) return 'follows';
  if (LIKE_TYPES.has(item.type)) return 'likes';
  if (COMMENT_TYPES.has(item.type)) return 'comments';
  if (THREAD_CASH_TYPES.has(item.type)) return 'thread_cash';
  return 'other';
}

/**
 * Whether an item shows under a chip. "All" is the social feed: order,
 * payout and inventory updates stay under "Orders" so shopping noise doesn't
 * sit between likes and follows.
 */
export function matchesActivityChip(item: Pick<ActivityItem, 'category' | 'type'>, chip: ActivityChip): boolean {
  const category = activityCategory(item);
  return chip === 'all' ? category !== 'orders' : category === chip;
}

/** What an empty chip says instead of a blank list. */
export interface ActivityChipEmpty {
  icon: string;
  /** Short heading (item 85) — the plain-language state, e.g. "No likes yet". */
  title: string;
  message: string;
  /** One next step, only where there is a real one to take (Mobbin: SoundCloud
   *  "Find artists to follow", AllTrails "Connect with friends"). Likes and
   *  comments have none — there's no honest one-tap way to get them. */
  action?: { label: string; href: string };
}

/**
 * What an empty chip says instead of a blank list, per role (item 85). A
 * seller's followers follow their store and their orders are sales, so
 * those read differently; everything else is the same for both.
 */
export function activityChipEmpty(chip: ActivityChip, role: 'buyer' | 'seller' | null = 'buyer'): ActivityChipEmpty {
  const seller = role === 'seller';
  const findPeople = { label: 'Find people to follow', href: '/buyer-search' };
  const shareStore = { label: 'Share your store', href: '/share-store' };
  switch (chip) {
    case 'follows': return seller
      ? { icon: 'user-plus', title: 'No followers yet', message: "When someone follows your store, you'll see it here.", action: shareStore }
      : { icon: 'user-plus', title: 'No followers yet', message: "When someone follows you, you'll see it here.", action: findPeople };
    case 'likes': return { icon: 'heart', title: 'No likes yet', message: "When someone likes your posts or stories, you'll see it here." };
    case 'comments': return { icon: 'message-circle', title: 'No comments yet', message: 'Comments, replies and mentions of you will show up here.' };
    case 'orders': return seller
      ? { icon: 'package', title: 'No orders yet', message: 'When someone buys from your store, new orders and payout updates will show up here.', action: shareStore }
      : { icon: 'package', title: 'No order updates yet', message: 'Shipping and delivery updates for your orders will show up here.', action: { label: 'Start shopping', href: '/(buyer)/discover' } };
    case 'thread_cash': return {
      icon: 'dollar-sign', title: 'No Thread Cash yet', message: "When someone sends you Thread Cash, you'll see it here.",
      // The Thread Cash screen itself (where a Thread Cash row also opens) —
      // not /thread-explainer, which is onboarding-only and bounces anyone
      // who has already seen it (and every seller) elsewhere.
      action: { label: 'Open Thread Cash', href: '/thread-cash' },
    };
    default: return seller
      ? { icon: 'activity', title: 'No activity yet', message: 'New followers, likes and comments on your posts, and order updates will show up here.', action: shareStore }
      : { icon: 'activity', title: 'No activity yet', message: 'When people follow you, like or comment on your posts, or send you Thread Cash, it will show up here.', action: findPeople };
  }
}

/** Feather icon used when a row has no actor avatar or thumbnail. */
export function activityIcon(item: Pick<ActivityItem, 'type' | 'category'>): string {
  switch (item.type) {
    case 'post_like':
    case 'story_like': return 'heart';
    case 'post_comment':
    case 'comment_reply': return 'message-circle';
    case 'mention':
    case 'story_mention': return 'at-sign';
    case 'new_follower': return 'user-plus';
    case 'post_save': return 'bookmark';
    case 'post_share': return 'send';
    case 'post_tag': return 'tag';
    case 'repost':
    case 'story_reshare': return 'repeat';
    case 'thread_cash_received': return 'dollar-sign';
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
    case 'order_preparing': return 'box';
    case 'order_auto_refunded': return 'rotate-ccw';
    case 'order_refund_warning': return 'clock';
    case 'order_cancelled':
    case 'order_cancelled_by_buyer': return 'x-circle';
    case 'order_confirmed': return 'check-circle';
    case 'order_exception': return 'alert-triangle';
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
    case 'returns': return 'rotate-ccw';
    case 'subscription': return 'credit-card';
    case 'social': return 'users';
    default: return 'bell';
  }
}

// ─── Routing ──────────────────────────────────────────────────────────────────

/** True for rows that render an inline "Follow back" button instead of navigating. */
export function isFollowBackRow(row: ActivityRow): boolean {
  return row.type === 'new_follower' && row.cta === 'Follow back' && row.actorCount === 1 && !!row.targetId
    && row.isFollowingActor !== true;
}

/**
 * The inline Follow back / Following pill on a single-person follow row
 * ("bear.2123374 started following you · Follow back" — Instagram iOS
 * Activity, https://mobbin.com/screens/1f627db9-fb0f-4870-b58d-35bec67239c7),
 * or null when the row has no pill (merged rows, non-follow rows).
 *
 * `following` prefers the server's live `isFollowingActor`; without it, a
 * row whose stored `cta` isn't "Follow back" was a follow-back ("…followed
 * you back"), so the viewer already follows them.
 */
export function followControlState(row: ActivityRow): { userId: string; following: boolean } | null {
  if (row.type !== 'new_follower' || row.actorCount !== 1 || !row.targetId) return null;
  const following = typeof row.isFollowingActor === 'boolean'
    ? row.isFollowingActor
    : row.cta !== 'Follow back';
  return { userId: row.targetId, following };
}

const q = encodeURIComponent;

// ─── Grouped rows → people list ───────────────────────────────────────────────

/** Most feed ids a people-list link carries (matches the server's cap). */
export const GROUPED_PEOPLE_MAX_IDS = 100;

/**
 * True for a merged row of two or more people ("Jay and 12 others liked your
 * post"). Tapping one opens the list of those people — Instagram's "View
 * likes" pattern (https://mobbin.com/flows/c575ad7c-8644-4b26-a3d0-ae737f855c13)
 * — instead of jumping straight to the post.
 */
export function isGroupedRow(row: Pick<ActivityRow, 'type' | 'actorCount'>): boolean {
  return row.actorCount > 1 && AGGREGATED_TYPES.has(row.type);
}

/**
 * Where tapping a row goes. A merged like / repost / follow row opens the
 * people list; a merged comment row ("Jay and 2 others commented") opens the
 * post's comments at the newest one instead — a list of names alone never
 * shows what they said (item 82).
 */
export function activityRowHref(row: ActivityRow, role: 'buyer' | 'seller' | null = 'buyer'): string | null {
  if (isGroupedRow(row) && row.type !== 'post_comment') return groupedPeopleHref(row);
  return activityHref(row, role);
}

/** Header for the people list a grouped row opens. */
export function groupedPeopleTitle(type: string): string {
  switch (type) {
    case 'post_like':
    case 'story_like': return 'Likes';
    case 'post_comment': return 'Comments';
    case 'repost': return 'Reposts';
    case 'new_follower': return 'New followers';
    default: return 'People';
  }
}

/** Route for the people list behind a grouped row. */
export function groupedPeopleHref(row: Pick<ActivityRow, 'type' | 'ids'>): string {
  const ids = row.ids.slice(0, GROUPED_PEOPLE_MAX_IDS).join(',');
  return `/activity-people?type=${q(row.type)}&ids=${q(ids)}`;
}

/**
 * Where tapping a row goes, or null when there is nowhere useful to go.
 * Routes match the push-notification handler (lib/notificationNavigation.ts)
 * and existing screens.
 */
export function activityHref(row: ActivityItem, role: 'buyer' | 'seller' | null = 'buyer'): string | null {
  const id = row.targetId;
  switch (row.targetType) {
    case 'order':
      // Older buyer rows (shipped/delivered/cancelled…) were published with
      // targetType "order" too — send those to the buyer's own order screen,
      // not the seller's /order-detail.
      if (isBuyerOrderNotification(row.type)) {
        return id ? `/buyer-order-detail?id=${q(id)}` : '/(buyer)/orders';
      }
      return id ? `/order-detail?id=${q(id)}` : '/(tabs)/orders';
    case 'return':
      // Same screen the return-status push opens (lib/notificationNavigation.ts).
      return id ? `/return-detail?returnId=${q(id)}` : null;
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
      // Comment rows land on that exact comment (scrolled to + highlighted,
      // its reply thread opened) when the row carries one.
      return row.type === 'post_comment' || row.type === 'comment_reply' || row.type === 'mention'
        ? `/buyer-post-comments?postId=${q(id)}${row.commentId ? `&commentId=${q(row.commentId)}` : ''}`
        : `/buyer-post-viewer?postId=${q(id)}`;
    case 'story':
      if (!id) return null;
      // "@name mentioned you in their story" plays in the mention viewer
      // (reply / heart / Add to your story); every other story row opens the
      // plain viewer.
      return row.type === 'story_mention'
        ? storyMentionViewerHref(id)
        : `/buyer-story-viewer?storyId=${q(id)}&allStoryIds=${q(id)}`;
    case 'thread_cash_transfer':
      return '/thread-cash';
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
      // Inventory folded into Products (no more standalone /inventory) —
      // the low-stock filter is the closest equivalent destination without
      // a product id to deep-link straight to one variant's stock editor.
      return '/(tabs)/products?filter=low-stock';
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

// ─── New followers summary ────────────────────────────────────────────────────

export interface NewFollowersSummary {
  /** Distinct followers, newest first, capped for the stacked-avatar row. */
  actors: ActivityActor[];
  count: number;
  hasUnread: boolean;
}

/** The compact "New followers" row at the top of Activity, or null when there are none. */
export function newFollowersSummary(items: readonly ActivityItem[]): NewFollowersSummary | null {
  const rows = items.filter((item) => item.type === 'new_follower' && !item.isMuted);
  if (rows.length === 0) return null;
  const seen = new Set<string>();
  const actors: ActivityActor[] = [];
  for (const item of rows) {
    if (!item.actorName && !item.actorId) continue;
    const key = item.actorId || item.actorName!;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = item.actorName || 'Someone';
    actors.push({
      id: item.actorId,
      name,
      initials: item.actorInitials || name.slice(0, 2).toUpperCase(),
      color: item.actorColor,
      avatarUrl: item.actorAvatarUrl,
    });
  }
  return { actors, count: actors.length, hasUnread: rows.some((item) => !item.isRead) };
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

// ─── Live arrivals (item 84) ──────────────────────────────────────────────────

/**
 * Ids in `next` that genuinely arrived since `prev` was on screen: not shown
 * before, and at least as new as the newest row that was. Anything older
 * that shows up (a later page, a restored row) isn't an arrival, and the
 * first load has nothing to compare against, so it never animates.
 */
export function findActivityArrivals(prev: readonly ActivityItem[], next: readonly ActivityItem[]): string[] {
  if (prev.length === 0) return [];
  const known = new Set(prev.map((item) => item.id));
  let newest = '';
  for (const item of prev) if (item.createdAt > newest) newest = item.createdAt;
  return next.filter((item) => !known.has(item.id) && item.createdAt >= newest).map((item) => item.id);
}

// ─── Delete with Undo (item 83) ───────────────────────────────────────────────

/** How long a swiped-away notification can be brought back (the Undo toast). */
export const ACTIVITY_UNDO_MS = 5000;

export interface DeferredDeleteOptions {
  delayMs: number;
  /** Deletes the ids for real; resolves with the ids that failed. */
  commit: (ids: string[]) => Promise<string[]>;
  /** Called with the ids whose delete failed, so the screen can put them back. */
  onFailed?: (ids: string[]) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface DeferredDelete {
  /** Deletes `ids` after `delayMs` unless undone. Returns a token for `undo`. */
  schedule(ids: string[]): number;
  /** Cancels a delete that hasn't been sent yet. False once it's too late. */
  undo(token: number): boolean;
  /** Sends any waiting delete now (a newer delete, or leaving the screen). */
  flush(): void;
  /** True while an id is waiting or its delete is in flight — keep it off screen. */
  isPending(id: string): boolean;
}

/**
 * The server delete is a real, permanent delete, so Undo works by holding the
 * request back for the Undo window instead of trying to recreate the row —
 * the "Notification deleted · Undo" pattern (LinkedIn, OpenPhone on Mobbin).
 * One delete waits at a time (the toast shows one); a newer delete sends the
 * previous one straight away.
 */
export function createDeferredDelete(options: DeferredDeleteOptions): DeferredDelete {
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let nextToken = 1;
  let waiting: { token: number; ids: string[]; handle: unknown } | null = null;
  const inFlight = new Map<string, number>();

  const send = (ids: string[]) => {
    for (const id of ids) inFlight.set(id, (inFlight.get(id) ?? 0) + 1);
    const release = () => {
      for (const id of ids) {
        const left = (inFlight.get(id) ?? 1) - 1;
        if (left <= 0) inFlight.delete(id); else inFlight.set(id, left);
      }
    };
    void options.commit(ids).then(
      (failed) => { release(); if (failed.length > 0) options.onFailed?.(failed); },
      () => { release(); options.onFailed?.(ids); },
    );
  };

  const flush = () => {
    if (!waiting) return;
    const { ids, handle } = waiting;
    waiting = null;
    clearTimer(handle);
    send(ids);
  };

  return {
    schedule(ids) {
      flush();
      const token = nextToken++;
      const handle = setTimer(() => {
        if (waiting?.token !== token) return;
        waiting = null;
        send(ids);
      }, options.delayMs);
      waiting = { token, ids: [...ids], handle };
      return token;
    },
    undo(token) {
      if (!waiting || waiting.token !== token) return false;
      clearTimer(waiting.handle);
      waiting = null;
      return true;
    },
    flush,
    isPending(id) {
      return inFlight.has(id) || !!waiting?.ids.includes(id);
    },
  };
}
