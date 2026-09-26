/**
 * Pure seed data for the preview buyer Activity Center (see
 * lib/previewActivity.ts, which wraps this with the real gating + bundled
 * poster image URIs).
 *
 * This file intentionally imports nothing from `react-native`/`expo-*` so it
 * can be imported directly in Vitest (which cannot transform native/asset
 * modules) — every field here is a plain value, keyed by a `posterIndex`
 * (0-9, into the same 10 fashion preview posters lib/previewCatalog.ts uses)
 * for a row's thumbnail, or nothing for rows with no thumbnail (follows,
 * order/agent/Thread Cash rows).
 *
 * The Brandthread Agent identity (name/handle/initials/color) mirrors
 * lib/previewInboxData.ts's BRANDTHREAD_AGENT_SEED exactly, so the same AI
 * account reads consistently across the preview inbox and preview activity
 * feed.
 */
import { BRANDTHREAD_AGENT_SEED } from './previewInboxData';

export type PreviewActivitySeed = {
  id: string;
  type: string;
  category: string;
  title: string;
  body?: string;
  isRead: boolean;
  actorId?: string;
  actorName?: string;
  actorHandle?: string;
  actorInitials?: string;
  actorColor?: string;
  targetId?: string;
  targetType?: string;
  posterIndex?: number;
  cta?: string;
  minutesAgo: number;
};

const HOUR = 60;
const DAY = 24 * HOUR;

/**
 * A realistic mix of buyer activity: likes, follows, comments, an order
 * shipped/delivered pair, a price drop on a saved item, a Brandthread Agent
 * nudge, and a Thread Cash received notice — spanning New (unread), Today,
 * This week and Earlier once run through lib/activity.ts's groupByRecency.
 */
export const PREVIEW_ACTIVITY_SEEDS: PreviewActivitySeed[] = [
  // ── New (unread) ──────────────────────────────────────────────────────────
  {
    id: 'preview-activity-like-1',
    type: 'post_like',
    category: 'social',
    title: 'Jamie liked your post',
    isRead: false,
    actorId: 'preview-user-jamie',
    actorName: 'Jamie',
    actorHandle: '@jamie.wears',
    actorInitials: 'JW',
    actorColor: '#DB2777',
    targetId: 'preview-post-1',
    targetType: 'post',
    posterIndex: 0,
    minutesAgo: 12,
  },
  {
    id: 'preview-activity-follow-1',
    type: 'new_follower',
    category: 'social',
    title: 'Alex started following you',
    isRead: false,
    actorId: 'preview-user-alex',
    actorName: 'Alex',
    actorHandle: '@alexthread',
    actorInitials: 'AL',
    actorColor: '#2563EB',
    targetId: 'preview-user-alex',
    targetType: 'user',
    cta: 'Follow back',
    minutesAgo: 40,
  },
  {
    id: 'preview-activity-threadcash-1',
    type: 'thread_cash_received',
    category: 'rewards',
    title: 'You received $5.00 in Thread Cash',
    body: 'From your last order — use it on your next checkout.',
    isRead: false,
    minutesAgo: 55,
  },

  // ── Today (read) ─────────────────────────────────────────────────────────
  {
    id: 'preview-activity-comment-1',
    type: 'post_comment',
    category: 'social',
    title: 'Sam commented on your post',
    body: 'nice fit',
    isRead: true,
    actorId: 'preview-user-sam',
    actorName: 'Sam',
    actorHandle: '@sam.styles',
    actorInitials: 'SS',
    actorColor: '#059669',
    targetId: 'preview-post-2',
    targetType: 'post',
    posterIndex: 1,
    minutesAgo: 3 * HOUR,
  },
  {
    id: 'preview-activity-agent-nudge-1',
    type: 'agent_nudge',
    category: 'agent',
    title: `${BRANDTHREAD_AGENT_SEED.participantName} has a tip for you`,
    body: 'want me to show you how Thread Cash works?',
    isRead: true,
    actorId: BRANDTHREAD_AGENT_SEED.participantUserId,
    actorName: BRANDTHREAD_AGENT_SEED.participantName,
    actorHandle: BRANDTHREAD_AGENT_SEED.participantHandle,
    actorInitials: BRANDTHREAD_AGENT_SEED.participantInitials,
    actorColor: BRANDTHREAD_AGENT_SEED.participantColor,
    targetId: BRANDTHREAD_AGENT_SEED.id,
    targetType: 'conversation',
    minutesAgo: 6 * HOUR,
  },
  {
    id: 'preview-activity-order-shipped-1',
    type: 'order_shipped',
    category: 'orders',
    title: 'Your order has shipped',
    body: 'Order #BT-10482 is on its way.',
    isRead: true,
    targetId: 'preview-order-10482',
    targetType: 'buyer_order',
    minutesAgo: 10 * HOUR,
  },

  // ── This week (read) ─────────────────────────────────────────────────────
  {
    id: 'preview-activity-price-drop-1',
    type: 'price_drop',
    category: 'social',
    title: 'Price drop on an item you saved',
    body: 'Now $38.00, down from $52.00.',
    isRead: true,
    targetId: 'preview-product-1',
    targetType: 'product',
    posterIndex: 2,
    minutesAgo: 2 * DAY,
  },
  {
    id: 'preview-activity-follow-2',
    type: 'new_follower',
    category: 'social',
    title: 'Mina started following you',
    isRead: true,
    actorId: 'preview-user-mina',
    actorName: 'Mina',
    actorHandle: '@mina.k',
    actorInitials: 'MK',
    actorColor: '#7C3AED',
    targetId: 'preview-user-mina',
    targetType: 'user',
    cta: 'Follow back',
    minutesAgo: 3 * DAY,
  },
  {
    id: 'preview-activity-order-delivered-1',
    type: 'order_delivered',
    category: 'orders',
    title: 'Your order was delivered',
    body: 'Order #BT-10317 was delivered.',
    isRead: true,
    targetId: 'preview-order-10317',
    targetType: 'buyer_order',
    minutesAgo: 4 * DAY,
  },

  // ── Earlier (read) ───────────────────────────────────────────────────────
  {
    id: 'preview-activity-like-2',
    type: 'post_like',
    category: 'social',
    title: 'Priya liked your post',
    isRead: true,
    actorId: 'preview-user-priya',
    actorName: 'Priya',
    actorHandle: '@priya.fit',
    actorInitials: 'PF',
    actorColor: '#EA580C',
    targetId: 'preview-post-3',
    targetType: 'post',
    posterIndex: 3,
    minutesAgo: 12 * DAY,
  },
];
