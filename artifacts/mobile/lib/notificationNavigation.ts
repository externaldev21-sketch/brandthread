import type * as Notifications from 'expo-notifications';

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
    } | undefined;

    if (data?.route === '/subscription') {
      router.push('/subscription');
      return;
    }
    if (data?.targetType === 'order' && typeof data.targetId === 'string' && data.targetId) {
      router.push(`/order-detail?id=${encodeURIComponent(data.targetId)}`);
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
    if (data?.targetType === 'conversation' && typeof data.targetId === 'string' && data.targetId) {
      router.push(`/chat/${encodeURIComponent(data.targetId)}`);
      return;
    }
    if (data?.targetType === 'drop' && typeof data.targetId === 'string' && data.targetId) {
      router.push(`/buyer-drop-detail?id=${encodeURIComponent(data.targetId)}`);
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
    if (data?.targetType === 'post' && typeof data.targetId === 'string' && data.targetId) {
      router.push('/(tabs)/feed');
    }
  };
}