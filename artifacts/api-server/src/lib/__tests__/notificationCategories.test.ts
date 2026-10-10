import { describe, expect, it, vi } from "vitest";

// push.ts imports the db client; these tests only exercise pure builders.
vi.mock("@workspace/db", () => ({
  db: {}, notificationBatchQueue: {}, notificationDeliveries: {}, notificationEvents: {}, pushTokens: {}, users: {},
}));
import { NOTIFICATION_CATEGORY, inferNotificationCategoryId } from "../notificationCategories";
import { buildExpoPushMessages } from "../push";

describe("NOTIFICATION_CATEGORY", () => {
  it("uses the exact ids the mobile app registers", () => {
    expect(NOTIFICATION_CATEGORY).toEqual({ DM_REPLY: "dm_reply", NEW_ORDER: "new_order" });
  });
});

describe("inferNotificationCategoryId", () => {
  it("tags direct-message pushes that identify their conversation", () => {
    // Shape published by routes/conversations.ts via publishNotification.
    for (const type of ["new_friend_message", "new_order_message", "new_message"]) {
      expect(inferNotificationCategoryId({ type, targetType: "conversation", targetId: "c1" })).toBe("dm_reply");
    }
    expect(inferNotificationCategoryId({ type: "new_friend_message", conversationId: "c1" })).toBe("dm_reply");
  });

  it("leaves a DM push without a conversation id un-actionable", () => {
    expect(inferNotificationCategoryId({ type: "new_friend_message" })).toBeUndefined();
    expect(inferNotificationCategoryId({ type: "new_friend_message", targetType: "conversation", targetId: "" })).toBeUndefined();
    expect(inferNotificationCategoryId({ type: "new_order_message", targetType: "order", targetId: "o1" })).toBeUndefined();
  });

  it("tags the seller's new-order push that identifies its order", () => {
    // Shape published by routes/webhooks.ts (Stripe checkout completed).
    expect(inferNotificationCategoryId({ type: "new_order_received", targetType: "order", targetId: "o1" })).toBe("new_order");
    expect(inferNotificationCategoryId({ type: "new_order_received", orderId: "o1" })).toBe("new_order");
    expect(inferNotificationCategoryId({ type: "new_order_received" })).toBeUndefined();
  });

  it("ignores every other push", () => {
    expect(inferNotificationCategoryId(undefined)).toBeUndefined();
    expect(inferNotificationCategoryId(null)).toBeUndefined();
    expect(inferNotificationCategoryId({})).toBeUndefined();
    expect(inferNotificationCategoryId({ type: "order_shipped", targetType: "order", targetId: "o1" })).toBeUndefined();
    expect(inferNotificationCategoryId({ type: "message_reaction", targetType: "conversation", targetId: "c1" })).toBeUndefined();
    expect(inferNotificationCategoryId({ type: "community_message", communityId: "x", conversationId: "c1" })).toBeUndefined();
    expect(inferNotificationCategoryId({ type: 42, conversationId: "c1" })).toBeUndefined();
  });
});

describe("buildExpoPushMessages categoryId", () => {
  const token = [{ token: "ExponentPushToken[x]" }];

  it("infers the category from the data payload", () => {
    const [message] = buildExpoPushMessages(token, {
      title: "New message", body: "hi",
      data: { type: "new_friend_message", targetType: "conversation", targetId: "c1" },
    });
    expect(message.categoryId).toBe("dm_reply");
    // The app's Reply action reads data.conversationId.
    expect(message.data).toMatchObject({ conversationId: "c1", targetId: "c1", targetType: "conversation" });
  });

  it("adds orderId for the seller's new-order push", () => {
    const [message] = buildExpoPushMessages(token, {
      title: "New order!", body: "Order #1",
      data: { type: "new_order_received", targetType: "order", targetId: "o1" },
    });
    expect(message.categoryId).toBe("new_order");
    expect(message.data.orderId).toBe("o1");
  });

  it("prefers an explicit categoryId", () => {
    const [message] = buildExpoPushMessages(token, {
      title: "New order!", body: "Order #1", categoryId: "custom",
      data: { type: "new_order_received", targetType: "order", targetId: "o1" },
    });
    expect(message.categoryId).toBe("custom");
  });

  it("omits the key entirely for plain pushes", () => {
    const [message] = buildExpoPushMessages(token, { title: "Shipped", body: "b", data: { type: "order_shipped" } });
    expect("categoryId" in message).toBe(false);
    expect(message.data).toEqual({ type: "order_shipped" });
  });
});
