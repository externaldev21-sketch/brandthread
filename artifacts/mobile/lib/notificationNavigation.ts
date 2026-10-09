import type * as Notifications from 'expo-notifications';
import { activityHref, isBuyerOrderNotification } from './activity';

export type NotificationRouter = {
  push: (href: string) => void;
};

type NotificationResponseIdentifier = {
  notification?: {
    request?: {
      identifier?: string;
      content?: {
        data?: unknown;
      };
    };
  };
};

/**
 * The exact screen a notification opens (the same destination its Activity
 * row opens), or null when it has no target.
 */
export function notificationHref(rawData: unknown): string | null {
  const data = rawData as {
    route?: unknown;
    targetId?: unknown;
    targetType?: unknown;
    type?: unknown;
    commentId?: unknown;
    communityId?: unknown;
  } | undefined;

  if (data?.route === '/subscription') {
    return '/subscription';
  }
  if (data?.targetType === 'order' && typeof data.targetId === 'string' && data.targetId) {
    // Buyer order updates (shipped/delivered/…) open the buyer's order
    // screen; only seller-side order pushes open /order-detail.
    return isBuyerOrderNotification(typeof data.type === 'string' ? data.type : null)
      ? `/buyer-order-detail?id=${encodeURIComponent(data.targetId)}`
      : `/order-detail?id=${encodeURIComponent(data.targetId)}`;
  }
  if (data?.targetType === 'buyer_order' && typeof data.targetId === 'string' && data.targetId) {
    return `/buyer-order-detail?id=${encodeURIComponent(data.targetId)}`;
  }
  if (data?.targetType === 'manufacturer_thread' && typeof data.targetId === 'string' && data.targetId) {
    return `/manufacturer-messages?threadId=${encodeURIComponent(data.targetId)}`;
  }
  if (data?.targetType === 'sample_order' && typeof data.targetId === 'string' && data.targetId) {
    return `/sample-detail?id=${encodeURIComponent(data.targetId)}`;
  }
  if (data?.targetType === 'bulk_order' && typeof data.targetId === 'string' && data.targetId) {
    return `/production-detail?id=${encodeURIComponent(data.targetId)}`;
  }
  // Community (topic group chat) pushes carry `communityId` alongside
  // targetId (see api-server lib/communityPush.ts) — never a DM thread.
  if (data?.type === 'community_message' || data?.targetType === 'community') {
    const communityId = typeof data.communityId === 'string' && data.communityId
      ? data.communityId
      : typeof data.targetId === 'string' ? data.targetId : '';
    return communityId ? `/community-chat?id=${encodeURIComponent(communityId)}` : null;
  }
  if (data?.targetType === 'conversation' && typeof data.targetId === 'string' && data.targetId) {
    // There is no `/chat/:id` route — the real 1:1 conversation screens are
    // `/buyer-conversation` (buyer_to_buyer threads, the common case — see
    // `notifType` in routes/conversations.ts) and `/seller-conversation`
    // (order-context threads, notified as `new_order_message`), both keyed
    // by `?id=`.
    return data.type === 'new_order_message'
      ? `/seller-conversation?id=${encodeURIComponent(data.targetId)}`
      : `/buyer-conversation?id=${encodeURIComponent(data.targetId)}`;
  }
  if (data?.targetType === 'live' && typeof data.targetId === 'string' && data.targetId) {
    return `/buyer-live?streamId=${encodeURIComponent(data.targetId)}`;
  }
  if (data?.targetType === 'cart') {
    return '/(buyer)/cart';
  }
  if (data?.targetType === 'drop' && typeof data.targetId === 'string' && data.targetId) {
    return `/buyer-drop-detail?id=${encodeURIComponent(data.targetId)}`;
  }
  // Price drop / back-in-stock alerts are buyer-facing; low-stock alerts on
  // the same "product" targetType are seller-facing. Distinguish by
  // notification type, which the server always includes alongside targetId.
  if (data?.targetType === 'product' && typeof data.targetId === 'string' && data.targetId) {
    return data.type === 'low_stock'
      ? `/product-detail?id=${encodeURIComponent(data.targetId)}`
      : `/buyer-product-detail?productId=${encodeURIComponent(data.targetId)}`;
  }
  // A buyer asked a question on the seller's product: open the seller's answer inbox.
  if (data?.targetType === 'product_question') {
    return '/seller-questions';
  }
  if (data?.targetType === 'giveaway' && typeof data.targetId === 'string' && data.targetId) {
    return `/giveaway?code=${encodeURIComponent(data.targetId)}`;
  }
  if (data?.targetType === 'return' && typeof data.targetId === 'string' && data.targetId) {
    return `/return-detail?returnId=${encodeURIComponent(data.targetId)}`;
  }
  if (data?.targetType === 'dispute' && typeof data.targetId === 'string' && data.targetId) {
    return `/dispute-detail?disputeId=${encodeURIComponent(data.targetId)}`;
  }
  if (data?.targetType === 'payout') {
    return '/payouts';
  }
  // A buyer reviewed the seller (api-server routes/reviews.ts).
  if (data?.targetType === 'review') {
    return '/seller-reviews';
  }
  // Social pushes (likes, comments, replies, mentions, reposts, story likes,
  // follows, Thread Cash) open the same exact destination the Activity row
  // does — the post, the comment itself, the story, the profile — instead
  // of a generic feed.
  if (
    (data?.targetType === 'post' || data?.targetType === 'story' || data?.targetType === 'user'
      || data?.targetType === 'thread_cash_transfer' || data?.targetType === 'referral')
    && typeof data.targetId === 'string' && data.targetId
  ) {
    const href = activityHref({
      id: '', category: 'social', title: '', body: '', isRead: true, createdAt: '',
      type: typeof data.type === 'string' ? data.type : '',
      targetType: data.targetType,
      targetId: data.targetId,
      commentId: typeof data.commentId === 'string' && data.commentId ? data.commentId : undefined,
    });
    return href;
  }
  return null;
}

/**
 * Multi-account: a push says which account it is for (`data.accountId`, set
 * by api-server lib/push.ts). When that isn't the active account, a tap
 * switches to it first and then opens the screen. Wired once from the root
 * layout, which owns Clerk's session list.
 */
export interface NotificationAccountSwitcher {
  currentAccountId: () => string | null | undefined;
  /** Makes `accountId` the active account; resolves false if it isn't signed in here. */
  switchTo: (accountId: string) => Promise<boolean>;
}

let accountSwitcher: NotificationAccountSwitcher | null = null;

export function configureNotificationAccountSwitcher(next: NotificationAccountSwitcher | null): void {
  accountSwitcher = next;
}

/** Time for the root layout to re-route to the switched account's home before opening the target. */
export const ACCOUNT_SWITCH_SETTLE_MS = 700;

export function createNotificationResponseHandler(
  router: NotificationRouter,
  handledResponseIds = new Set<string>(),
) {
  return (response: Notifications.NotificationResponse | NotificationResponseIdentifier) => {
    const request = response.notification?.request;
    const responseId = request?.identifier;
    if (responseId) {
      if (handledResponseIds.has(responseId)) return;
      handledResponseIds.add(responseId);
    }

    const data = request?.content?.data as { accountId?: unknown } | undefined;
    const href = notificationHref(data);
    const accountId = typeof data?.accountId === 'string' ? data.accountId : null;
    const switcher = accountSwitcher;
    const current = switcher?.currentAccountId() ?? null;
    if (switcher && accountId && current && accountId !== current) {
      void switcher.switchTo(accountId).then((switched) => {
        if (!switched || !href) return;
        setTimeout(() => router.push(href), ACCOUNT_SWITCH_SETTLE_MS);
      }).catch(() => {});
      return;
    }
    if (href) router.push(href);
  };
}
