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

    const data = request?.content?.data as {
      route?: unknown;
      targetId?: unknown;
      targetType?: unknown;
      type?: unknown;
      commentId?: unknown;
      communityId?: unknown;
    } | undefined;

    if (data?.route === '/subscription') {
      router.push('/subscription');
      return;
    }
    if (data?.targetType === 'order' && typeof data.targetId === 'string' && data.targetId) {
      // Buyer order updates (shipped/delivered/…) open the buyer's order
      // screen; only seller-side order pushes open /order-detail.
      router.push(isBuyerOrderNotification(typeof data.type === 'string' ? data.type : null)
        ? `/buyer-order-detail?id=${encodeURIComponent(data.targetId)}`
        : `/order-detail?id=${encodeURIComponent(data.targetId)}`);
      return;
    }
    if (data?.targetType === 'buyer_order' && typeof data.targetId === 'string' && data.targetId) {
      router.push(`/buyer-order-detail?id=${encodeURIComponent(data.targetId)}`);
      return;
    }
    if (data?.targetType === 'manufacturer_thread' && typeof data.targetId === 'string' && data.targetId) {
      router.push(`/manufacturer-messages?threadId=${encodeURIComponent(data.targetId)}`);
      return;
    }
    if (data?.targetType === 'sample_order' && typeof data.targetId === 'string' && data.targetId) {
      router.push(`/sample-detail?id=${encodeURIComponent(data.targetId)}`);
      return;
    }
    if (data?.targetType === 'bulk_order' && typeof data.targetId === 'string' && data.targetId) {
      router.push(`/production-detail?id=${encodeURIComponent(data.targetId)}`);
      return;
    }
    // Community (topic group chat) pushes carry `communityId` alongside
    // targetId (see api-server lib/communityPush.ts) — never a DM thread.
    if (data?.type === 'community_message' || data?.targetType === 'community') {
      const communityId = typeof data.communityId === 'string' && data.communityId
        ? data.communityId
        : typeof data.targetId === 'string' ? data.targetId : '';
      if (communityId) router.push(`/community-chat?id=${encodeURIComponent(communityId)}`);
      return;
    }
    if (data?.targetType === 'conversation' && typeof data.targetId === 'string' && data.targetId) {
      // There is no `/chat/:id` route — the real 1:1 conversation screens are
      // `/buyer-conversation` (buyer_to_buyer threads, the common case — see
      // `notifType` in routes/conversations.ts) and `/seller-conversation`
      // (order-context threads, notified as `new_order_message`), both keyed
      // by `?id=`.
      if (data.type === 'new_order_message') {
        router.push(`/seller-conversation?id=${encodeURIComponent(data.targetId)}`);
      } else {
        router.push(`/buyer-conversation?id=${encodeURIComponent(data.targetId)}`);
      }
      return;
    }
    if (data?.targetType === 'drop' && typeof data.targetId === 'string' && data.targetId) {
      router.push(`/buyer-drop-detail?dropId=${encodeURIComponent(data.targetId)}`);
      return;
    }
    // Price drop / back-in-stock alerts are buyer-facing; low-stock alerts on
    // the same "product" targetType are seller-facing. Distinguish by
    // notification type, which the server always includes alongside targetId.
    if (data?.targetType === 'product' && typeof data.targetId === 'string' && data.targetId) {
      if (data.type === 'low_stock') {
        router.push(`/product-detail?id=${encodeURIComponent(data.targetId)}`);
      } else {
        router.push(`/buyer-product-detail?productId=${encodeURIComponent(data.targetId)}`);
      }
      return;
    }
    if (data?.targetType === 'return' && typeof data.targetId === 'string' && data.targetId) {
      router.push(`/return-detail?returnId=${encodeURIComponent(data.targetId)}`);
      return;
    }
    if (data?.targetType === 'payout') {
      router.push('/payouts');
      return;
    }
    // Social pushes (likes, comments, replies, mentions, reposts, story likes,
    // follows, Thread Cash) open the same exact destination the Activity row
    // does — the post, the comment itself, the story, the profile — instead
    // of a generic feed.
    if (
      (data?.targetType === 'post' || data?.targetType === 'story' || data?.targetType === 'user'
        || data?.targetType === 'thread_cash_transfer')
      && typeof data.targetId === 'string' && data.targetId
    ) {
      const href = activityHref({
        id: '', category: 'social', title: '', body: '', isRead: true, createdAt: '',
        type: typeof data.type === 'string' ? data.type : '',
        targetType: data.targetType,
        targetId: data.targetId,
        commentId: typeof data.commentId === 'string' && data.commentId ? data.commentId : undefined,
      });
      if (href) router.push(href);
    }
  };
}