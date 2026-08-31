import AsyncStorage from '@react-native-async-storage/async-storage';

export type NotificationClientEvent = {
  notificationId: string;
  eventType: 'receipt' | 'open' | 'tap';
  occurredAt: string;
};

type NotificationEventApi = {
  notifications: {
    trackEvent: (event: NotificationClientEvent) => Promise<unknown>;
  };
};

const keyForUser = (userId: string) => `bt:notification-events:${userId}:v1`;
let outboxOperation: Promise<unknown> = Promise.resolve();

function serializeOutbox<T>(operation: () => Promise<T>): Promise<T> {
  const result = outboxOperation.then(operation, operation);
  outboxOperation = result.then(() => undefined, () => undefined);
  return result;
}

async function flushUnlocked(api: NotificationEventApi, userId: string) {
  const key = keyForUser(userId);
  const queued = JSON.parse((await AsyncStorage.getItem(key)) || '[]') as NotificationClientEvent[];
  if (!queued.length) return;

  const remaining: NotificationClientEvent[] = [];
  for (const event of queued) {
    try {
      await api.notifications.trackEvent(event);
    } catch {
      remaining.push(event);
    }
  }
  if (remaining.length) await AsyncStorage.setItem(key, JSON.stringify(remaining));
  else await AsyncStorage.removeItem(key);
}

export async function captureNotificationEvent(
  api: NotificationEventApi,
  userId: string | null | undefined,
  event: NotificationClientEvent,
) {
  if (!userId) return;
  await serializeOutbox(async () => {
    const key = keyForUser(userId);
    const existing = JSON.parse((await AsyncStorage.getItem(key)) || '[]') as NotificationClientEvent[];
    const dedupeKey = `${event.notificationId}:${event.eventType}`;
    const queued = existing.some((item) => `${item.notificationId}:${item.eventType}` === dedupeKey)
      ? existing
      : [...existing, event];
    await AsyncStorage.setItem(key, JSON.stringify(queued));
    await flushUnlocked(api, userId);
  });
}

export async function flushNotificationEvents(
  api: NotificationEventApi,
  userId: string | null | undefined,
) {
  if (!userId) return;
  await serializeOutbox(() => flushUnlocked(api, userId));
}