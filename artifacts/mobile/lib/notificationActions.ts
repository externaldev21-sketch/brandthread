/**
 * Actionable notifications (iOS long-press / Android expand on a push):
 *  - a DM push gets "Reply" with an inline text field — the reply is sent
 *    without opening the app (Messages / Instagram DMs pattern);
 *  - a seller's new-order push gets "Mark shipped", which opens the
 *    fulfil flow for that order.
 * The API tags pushes with the matching `categoryId`
 * (artifacts/api-server/src/lib/notificationCategories.ts).
 */
import { Platform } from 'react-native';
import type * as NotificationsTypes from 'expo-notifications';
import {
  NOTIFICATION_ACTION, NOTIFICATION_CATEGORY, planNotificationAction,
} from '@/lib/nativeSystemLogic';

let registered = false;

/** Registers the two categories once per launch. Safe everywhere: web has
 *  no categories, and a failure just leaves pushes as plain taps. */
export async function registerNotificationCategories(): Promise<void> {
  if (registered || Platform.OS === 'web') return;
  registered = true;
  try {
    const Notifications = require('expo-notifications') as typeof NotificationsTypes;
    await Notifications.setNotificationCategoryAsync(NOTIFICATION_CATEGORY.DM_REPLY, [
      {
        identifier: NOTIFICATION_ACTION.REPLY,
        buttonTitle: 'Reply',
        textInput: { submitButtonTitle: 'Send', placeholder: 'Message' },
        options: { opensAppToForeground: false },
      },
    ]);
    await Notifications.setNotificationCategoryAsync(NOTIFICATION_CATEGORY.NEW_ORDER, [
      {
        identifier: NOTIFICATION_ACTION.MARK_SHIPPED,
        buttonTitle: 'Mark shipped',
        options: { opensAppToForeground: true },
      },
    ]);
  } catch {
    registered = false;
  }
}

/**
 * Runs a notification action. Returns true when it handled the response
 * (so the caller skips its normal tap navigation), false for a plain tap.
 */
export function handleNotificationAction(
  response: Pick<NotificationsTypes.NotificationResponse, 'actionIdentifier' | 'userText' | 'notification'>,
  router: { push: (href: string) => void },
): boolean {
  const data = (response.notification?.request?.content?.data ?? {}) as Record<string, unknown>;
  const plan = planNotificationAction({ actionIdentifier: response.actionIdentifier, userText: response.userText, data });
  if (plan.kind === 'send-reply') {
    void import('@/services/socialService')
      .then(({ sendMessage }) => sendMessage(plan.conversationId, plan.text))
      .catch(() => {});
    return true;
  }
  if (plan.kind === 'open') {
    router.push(plan.route);
    return true;
  }
  return false;
}
