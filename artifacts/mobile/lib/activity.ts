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
import { fmtRelativeDay } from './format';

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

export type ActivitySectionKey = 'new' | 'today' | 'this_week' | 'earlier';

export interface ActivitySection<T = ActivityItem> {
  key: ActivitySectionKey;
  title: string;
  items: T[];
}

export type ActivityFilter = 'all' | 'orders' | 'social' | 'money';

export const ACTIVITY_PAGE_SIZE = 30;

// ─── Relative time ────────────────────────────────────────────────────────────

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Shared relative-time formatter. The default style is the app's voice
 * (fmtRelativeDay): "now", "5m", "3h", "Yesterday", "Mar 4"; `compact`
 * matches the inbox lists ("now", "5m", "3h", "2d", "3w").
 */
export function relativeTime(
  date: string | number | Date,
  now: number | Date = Date.now(),
  options: { compact?: boolean } = {},
): string {
  const then = new Date(date).getTime();
  const current = typeof now === 'number' ? now : now.getTime();
  if (!Number.isFinite(then)) return '';
  if (!options.compact) return fmtRelativeDay(Math.min(then, current), current);
  const diff = Math.max(0, current - then);
  const mins = Math.floor(diff / MINUTE);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
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
 * Bucket items into New / Today / This week / Earlier (Instagram's
 * Notifications sections, https://mobbin.com/flows/374133d6-fd99-418b-ae02-f92694ae4fe0).
 *
 * Unread items always land in "New", whatever their age. Read items are
 * bucketed by `createdAt` against local calendar days: "Today" since local
 * midnight, "This week" the six days before that, "Earlier" everything
 * older. Input order is preserved inside each section and empty sections
 * are omitted.
 */
export function groupByRecency<T extends Pick<ActivityItem, 'isRead' | 'createdAt'>>(
  items: readonly T[],
  now: Date = new Date(),
): ActivitySection<T>[] {
  const todayStart = startOfLocalDay(now);
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
  const buckets: Record<ActivitySectionKey, T[]> = {
    new: [], today: [], this_week: [], earlier: [],
  };

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
 * Merge repeat social events (same aggregation key) into single rows
 * carrying the distinct actors — every like on one post becomes "Jay and 12
 * others liked your post", even when other events landed in between.
 * Follows merge only when back to back.
 * Each merged row sits where its newest event was. Call once per section
 * so a merged row never spans New and read items. Non-aggregating types
 * pass through as single-item rows.
 */
export function aggregateActivity(items: readonly ActivityItem[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  const rowByKey = new Map<string, ActivityRow>();

  for (const item of items) {
    const key = aggregationKey(item);
    // Follows only merge when back to back — Instagram keeps a lone
    // follower as its own row with an inline "Follow back".
    const last = rows[rows.length - 1];
    const existing = !key
      ? undefined
      : key === 'new_follower'
        ? (last && last.type === 'new_follower' && rowByKey.get(key) === last ? last : undefined)
        : rowByKey.get(key);
    if (existing) {
      existing.ids.push(item.id);
      existing.isRead = existing.isRead && item.isRead;
      const actor = actorOf(item);
      if (actor && !existing.actors.some((a) => sameActor(a, actor))) {
        existing.actors.push(actor);
      }
      existing.actorCount = existing.actors.length;
      existing.extraCount = Math.max(0, existing.actorCount - 1);
      continue;
    }
    const row = toRow(item);
    rows.push(row);
    if (key) rowByKey.set(key, row);
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
  // Order updates read as plain text ("Your order has shipped"), not a bold
  // headline — the product photo beside it carries the row.
  if (isOrderUpdateRow(row.type)) {
    return [{ text: stripEmoji(row.title).replace(/!+$/, '') }];
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
  if (row.type === 'post_comment' || row.type === 'comment_reply' || row.type === 'mention' || row.type === 'comment_like') {
    return `“${body}”`;
  }
  return body;
}

/**
 * The unread-row background: #FFFFFF08 laid over `background`, blended to
 * one opaque hex so a row stays solid (swipe actions sit behind it).
 */
export function unreadRowTint(background: string): string {
  const hex = background.replace('#', '').slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return background;
  const alpha = 0x08 / 0xff;
  const mix = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16);
    return Math.round(c + (255 - c) * alpha).toString(16).padStart(2, '0');
  };
  return `#${mix(0)}${mix(2)}${mix(4)}`.toUpperCase();
}

// ─── Classification ───────────────────────────────────────────────────────────

/**
 * The Activity Center's three groups — Orders / Social / Money — mirror the
 * server's `filter=orders|social|money` definitions in notifications-feed.ts.
 * Money wins over the other two so the groups never overlap: a payout, a
 * refund or a Thread Cash credit is Money even when it was published under an
 * "orders", "returns", "production" or "social" category.
 */
const ORDER_CATEGORIES = new Set(['orders', 'order', 'production', 'returns', 'disputes']);
const ORDER_TYPES = new Set(['low_stock', 'out_of_stock']);
const MONEY_CATEGORIES = new Set(['payout', 'payouts', 'payment', 'finance', 'subscription', 'money']);
/**
 * Money rows actually published to notifications_feed (grep publishNotification
 * / insert(notificationsFeed) in artifacts/api-server/src): payouts
 * (finance.ts, webhooks.ts), manufacturer payments & payout readiness
 * (webhooks.ts, sample-orders.ts), refunds (returns.ts, returnLabels.ts,
 * lib/delivery/notifications.ts), Thread Cash and referral rewards
 * (activityEvents.ts, threadCash/expiry.ts) and subscription billing
 * (jobs/sellerTrialReminder.ts).
 */
export const MONEY_ACTIVITY_TYPES: readonly string[] = [
  'payout_sent', 'payout_setup_restricted',
  'manufacturer_payment_received', 'manufacturer_payment_reversed',
  'manufacturer_payouts_ready', 'manufacturer_payouts_restricted',
  'return_refunded', 'order_auto_refunded', 'order_auto_refunded_seller',
  'thread_cash_received', 'thread_cash_expiring', 'referral_reward', 'referral_joined',
  'subscription_trial_day_4', 'subscription_trial_will_end',
];
const MONEY_TYPES = new Set(MONEY_ACTIVITY_TYPES);

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
  // Post-delivery review request (api-server jobs/reviewRequest.ts)
  'review_request',
]);

/** Order updates published to the SELLER about their own sales. */
const SELLER_ORDER_TYPES = new Set(['new_order_received', 'order_cancelled_by_buyer', 'shopify_order_cancelled']);

/** True for any order update row (buyer or seller side). */
export function isOrderUpdateRow(type: string | undefined | null): boolean {
  return !!type && (BUYER_ORDER_TYPES.has(type) || SELLER_ORDER_TYPES.has(type));
}

export function isBuyerOrderNotification(type: string | undefined | null): boolean {
  return !!type && BUYER_ORDER_TYPES.has(type);
}

/** The buyer's order screen; a review request opens its review sheet. */
export function buyerOrderHref(id: string, type?: string | null): string {
  return `/buyer-order-detail?id=${encodeURIComponent(id)}${type === 'review_request' ? '&review=1' : ''}`;
}
// price_drop/back_in_stock/new_product are published under category "stock"
// (seller alerts) or "social" (buyer alerts) depending on the publisher, but
// they're always a buyer-facing "things you follow/saved" event for the
// Activity Center's purposes.
const SOCIAL_TYPES = new Set(['price_drop', 'back_in_stock', 'waitlist_restock', 'product_restocked', 'new_product']);
// Restock pushes to buyers who bagged the item (category "cart") or whose
// saved size is back (category "stock").
SOCIAL_TYPES.add('bag_restock');
SOCIAL_TYPES.add('size_back');

export type ActivityGroup = 'orders' | 'social' | 'money' | 'other';

export function activityKind(item: Pick<ActivityItem, 'category' | 'type'>): ActivityGroup {
  if (MONEY_CATEGORIES.has(item.category) || MONEY_TYPES.has(item.type)) return 'money';
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
export type ActivityChip = 'all' | 'follows' | 'likes' | 'comments' | 'orders' | 'money';

export const ACTIVITY_CHIPS: readonly { key: ActivityChip; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'follows', label: 'Follows' },
  { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Comments' },
  { key: 'orders', label: 'Orders' },
  { key: 'money', label: 'Money' },
];

const FOLLOW_TYPES = new Set(['new_follower']);
const LIKE_TYPES = new Set(['post_like', 'story_like', 'comment_like']);
const COMMENT_TYPES = new Set(['post_comment', 'comment_reply', 'mention', 'story_mention']);

/**
 * Which chip an item belongs to; 'other' rows (reposts, drops…) show under All
 * only. Money (payouts, payments, refunds, Thread Cash, billing) is checked
 * first, so it is a superset of the old Thread Cash chip.
 */
export function activityCategory(item: Pick<ActivityItem, 'category' | 'type'>): Exclude<ActivityChip, 'all'> | 'other' {
  const kind = activityKind(item);
  if (kind === 'money') return 'money';
  if (kind === 'orders') return 'orders';
  if (FOLLOW_TYPES.has(item.type)) return 'follows';
  if (LIKE_TYPES.has(item.type)) return 'likes';
  if (COMMENT_TYPES.has(item.type)) return 'comments';
  return 'other';
}

/**
 * Whether an item shows under a chip. "All" leaves out order and inventory
 * updates (they stay under "Orders" so shopping noise doesn't sit between
 * likes and follows); Money rows — Thread Cash, payouts, refunds — show.
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
      ? { icon: 'package', title: 'No orders yet', message: 'When someone buys from your store, new orders and shipping updates will show up here.', action: shareStore }
      : { icon: 'package', title: 'No order updates yet', message: 'Shipping and delivery updates for your orders will show up here.', action: { label: 'Start shopping', href: '/(buyer)/discover' } };
    case 'money': return seller
      ? { icon: 'dollar-sign', title: 'No money updates yet', message: 'Payouts, refunds, Thread Cash and billing updates will show up here.', action: { label: 'Open payouts', href: '/payouts' } }
      : {
        icon: 'dollar-sign', title: 'No money updates yet', message: 'Refunds, Thread Cash and payments will show up here.',
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
    case 'comment_like':
    case 'story_like': return 'heart';
    case 'post_comment':
    case 'comment_reply': return 'message-circle';
    case 'mention':
    case 'story_mention': return 'at-sign';
    case 'new_follower': return 'user-plus';
    case 'live_started': return 'radio';
    case 'post_save': return 'bookmark';
    case 'post_share': return 'send';
    case 'post_tag': return 'tag';
    case 'repost':
    case 'story_reshare': return 'repeat';
    case 'thread_cash_received':
    case 'referral_reward': return 'dollar-sign';
    case 'referral_joined': return 'user-plus';
    case 'live_started': return 'video';
    case 'live_cohost_invite': return 'users';
    case 'price_drop': return 'trending-down';
    case 'back_in_stock':
    case 'waitlist_restock':
    case 'bag_restock':
    case 'size_back':
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
    case 'payouts':
    case 'money':
    case 'payment': return 'dollar-sign';
    case 'disputes': return 'alert-circle';
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

/** Screens a seller setup reminder / weekly summary may open (server sends the route as targetId). */
const SELLER_SETUP_ROUTES = new Set(['/add-product', '/payouts', '/launch-publish', '/onboarding', '/share-store', '/(tabs)/orders', '/(tabs)/analytics']);

export function sellerSetupHref(route: string | null | undefined): string | null {
  return route && SELLER_SETUP_ROUTES.has(route) ? route : null;
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
        return id ? buyerOrderHref(id, row.type) : '/(buyer)/orders';
      }
      return id ? `/order-detail?id=${q(id)}` : '/(tabs)/orders';
    case 'login_session':
      return role === 'seller' ? '/login-activity' : '/buyer-login-activity';
    case 'return':
      // Same screen the return-status push opens (lib/notificationNavigation.ts).
      return id ? `/return-detail?returnId=${q(id)}` : null;
    case 'dispute':
      // Chargeback opened/closed (seller) — same screen the push opens.
      return id ? `/dispute-detail?disputeId=${q(id)}` : null;
    case 'buyer_order':
      return id ? buyerOrderHref(id, row.type) : '/(buyer)/orders';
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
      return row.type === 'post_comment' || row.type === 'comment_reply' || row.type === 'mention' || row.type === 'comment_like'
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
    case 'live':
      return id ? `/buyer-live?streamId=${q(id)}` : null;

    case 'cart':
      return '/(buyer)/cart';
    case 'giveaway':
      return id ? `/giveaway?code=${q(id)}` : null;
    case 'thread_cash_transfer':
      return '/thread-cash';
    case 'referral':
      return '/buyer-invite';
    case 'live_cohost':
      // "Invited you to co-host their live" — opens the accept / decline screen.
      return id ? `/live-cohost-invite?streamId=${q(id)}` : '/live-cohost-invite';
    case 'live_stream':
      // "<Brand> is live" — straight into the stream.
      return id ? `/buyer-live?streamId=${q(id)}` : '/live';
    case 'live_cohost':
      // "Invited you to co-host their live" — opens the accept / decline screen.
      return id ? `/live-cohost-invite?streamId=${q(id)}` : '/live-cohost-invite';
    case 'product':
      return id ? `/buyer-product-detail?productId=${q(id)}` : null;
    case 'product_question':
      return '/seller-questions';
    case 'review':
      // "username left a 5-star review" (api-server routes/reviews.ts).
      return '/seller-reviews';
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
    case 'dispute':
      return id ? `/dispute-detail?disputeId=${q(id)}` : '/disputes';
    case 'payout':
      return '/payouts';
    case 'recovery':
      // Lost-chargeback recovery opened / cleared (seller).
      return '/recoveries';
    case 'freelancer_job':
      return '/freelancer-jobs';
    case 'seller_setup':
      return sellerSetupHref(id);
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

// ─── Suggested people ─────────────────────────────────────────────────────────

/**
 * "Suggested for you" never lists someone already in the loaded feed — a
 * person who just liked, followed or commented isn't a discovery, and a
 * "New on Brandthread" reason under someone who liked your post six weeks
 * ago contradicts itself.
 */
export function excludeActivityActors<T extends { userId: string }>(
  people: readonly T[],
  items: readonly Pick<ActivityItem, 'actorId'>[],
): T[] {
  const actors = new Set(items.map((item) => item.actorId).filter((id): id is string => !!id));
  if (actors.size === 0) return [...people];
  return people.filter((person) => !actors.has(person.userId));
}

// ─── Filter chip spacing ──────────────────────────────────────────────────────

const CHIP_GAP_DEFAULT = 8;
const CHIP_GAP_TIGHT = 6;
/** A chip must show at least this much to read as "the row scrolls". */
const CHIP_MIN_PEEK = 8;

function chipRowReads(widths: readonly number[], containerWidth: number, inset: number, gap: number): boolean {
  let left = inset;
  for (const width of widths) {
    const right = left + width;
    // The first chip reaching the screen edge must be visibly cut by it
    // (peeking in), never ending flush against it with the next chip
    // entirely off-screen — that reads as a clipped last chip.
    if (right > containerWidth - CHIP_MIN_PEEK) {
      return right > containerWidth && left <= containerWidth - CHIP_MIN_PEEK;
    }
    left = right + gap;
  }
  return true; // everything fits
}

/**
 * Gap for a horizontally scrolling chip row. A row whose last visible chip
 * ends right at the screen edge with the next one fully off-screen looks
 * clipped and hides that it scrolls; when the default 8pt gap lands there,
 * a 6pt gap makes the next chip peek in instead (the two gaps' "flush"
 * widths never overlap).
 */
export function chipRowGap(widths: readonly number[], containerWidth: number, inset = 16): number {
  if (widths.length === 0 || containerWidth <= 0) return CHIP_GAP_DEFAULT;
  if (chipRowReads(widths, containerWidth, inset, CHIP_GAP_DEFAULT)) return CHIP_GAP_DEFAULT;
  if (chipRowReads(widths, containerWidth, inset, CHIP_GAP_TIGHT)) return CHIP_GAP_TIGHT;
  return CHIP_GAP_DEFAULT;
}
