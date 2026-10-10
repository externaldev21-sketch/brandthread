/**
 * Actionable notification categories (iOS UNNotificationCategory / Android
 * notification actions, registered by the mobile app with
 * expo-notifications' setNotificationCategoryAsync). The server only tags a
 * push with the category id; the app owns the buttons ("Reply",
 * "View order", ...). The ids below MUST match what the app registers.
 */
export const NOTIFICATION_CATEGORY = {
  DM_REPLY: "dm_reply",
  NEW_ORDER: "new_order",
} as const;

export type NotificationCategoryId = typeof NOTIFICATION_CATEGORY[keyof typeof NOTIFICATION_CATEGORY];

/**
 * Direct-message push types, as published by routes/conversations.ts
 * (`notifType`: buyer_to_buyer threads → new_friend_message, order-context
 * threads → new_order_message). `new_message` is the generic DM type.
 */
const DM_PUSH_TYPES: ReadonlySet<string> = new Set([
  "new_friend_message",
  "new_order_message",
  "new_message",
]);

/** The seller's "New order!" push (routes/webhooks.ts, Stripe checkout). */
const NEW_ORDER_PUSH_TYPES: ReadonlySet<string> = new Set(["new_order_received"]);

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Picks the actionable category for a push from its data payload, or
 * undefined for a plain notification. Pure — safe to call on every send.
 *
 *  - dm_reply:  a DM push that identifies its conversation, either as
 *    `conversationId` or as the feed target (`targetType: "conversation"`).
 *  - new_order: the seller's new-order push that identifies its order,
 *    either as `orderId` or as the feed target (`targetType: "order"`).
 */
export function inferNotificationCategoryId(
  data: Record<string, unknown> | null | undefined,
): NotificationCategoryId | undefined {
  if (!data || typeof data.type !== "string") return undefined;
  const type = data.type;

  if (DM_PUSH_TYPES.has(type)) {
    const conversationId = nonEmptyString(data.conversationId)
      ? data.conversationId
      : data.targetType === "conversation" && nonEmptyString(data.targetId)
        ? data.targetId
        : undefined;
    return conversationId ? NOTIFICATION_CATEGORY.DM_REPLY : undefined;
  }

  if (NEW_ORDER_PUSH_TYPES.has(type)) {
    const orderId = nonEmptyString(data.orderId)
      ? data.orderId
      : data.targetType === "order" && nonEmptyString(data.targetId)
        ? data.targetId
        : undefined;
    return orderId ? NOTIFICATION_CATEGORY.NEW_ORDER : undefined;
  }

  return undefined;
}

/**
 * The app's action handlers read `data.conversationId` (Reply) and
 * `data.orderId` (View order), while feed-published pushes identify their
 * subject as `targetId` + `targetType`. For a push that gets an actionable
 * category, copy the id under the explicit key (never overwriting one the
 * sender set). Other pushes are returned unchanged.
 */
export function withNotificationCategoryData(
  data: Record<string, unknown>,
  categoryId: string | undefined = inferNotificationCategoryId(data),
): Record<string, unknown> {
  if (categoryId === NOTIFICATION_CATEGORY.DM_REPLY && !nonEmptyString(data.conversationId)
    && data.targetType === "conversation" && nonEmptyString(data.targetId)) {
    return { ...data, conversationId: data.targetId };
  }
  if (categoryId === NOTIFICATION_CATEGORY.NEW_ORDER && !nonEmptyString(data.orderId)
    && data.targetType === "order" && nonEmptyString(data.targetId)) {
    return { ...data, orderId: data.targetId };
  }
  return data;
}
