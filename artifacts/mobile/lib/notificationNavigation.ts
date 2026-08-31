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
    } | undefined;

    if (data?.route === '/subscription') {
      router.push('/subscription');
      return;
    }
    if (data?.targetType === 'order' && typeof data.targetId === 'string' && data.targetId) {
      router.push(`/order-detail?id=${encodeURIComponent(data.targetId)}`);
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
    }
  };
}