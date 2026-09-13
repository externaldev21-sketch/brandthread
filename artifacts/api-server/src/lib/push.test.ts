import { describe, expect, it } from "vitest";
import {
  buildExpoPushMessages,
  normalizePushEventCategory,
  preferenceKey,
  unsentPushTokens,
} from "./push";

describe("push notification delivery contract", () => {
  it("normalizes plural feed labels to push event categories", () => {
    expect(normalizePushEventCategory("orders")).toBe("order");
    expect(normalizePushEventCategory("messages")).toBe("message");
    expect(normalizePushEventCategory("drops")).toBe("drop");
    expect(normalizePushEventCategory("disputes")).toBe("dispute");
  });

  it("enables buyer and seller delivery through their role-specific preferences", () => {
    expect(preferenceKey("buyer", "message")).toBe("messages");
    expect(preferenceKey("seller", "message")).toBe("customer_messages");
    expect(preferenceKey("buyer", "order")).toBe("order_updates");
    expect(preferenceKey("seller", "order")).toBe("new_orders");
    expect(preferenceKey("buyer", "drop")).toBe("new_drops");
    expect(preferenceKey("seller", "production")).toBe("production_milestones");
  });

  it("fails visibly for an unmapped feed category outside production", () => {
    expect(() => normalizePushEventCategory("new_category")).toThrow(
      'No push event category mapping for notification feed category "new_category"',
    );
  });

  it("keeps message notifications on the platform default sound", () => {
    expect(buildExpoPushMessages([{ token: "ExponentPushToken[message]" }], {
      title: "New message",
      body: "Hello",
    })[0]).toMatchObject({ sound: "default" });
  });

  it("retries only the unsent device in a mixed multi-device delivery", () => {
    expect(unsentPushTokens(
      [{ token: "device-a" }, { token: "device-b" }, { token: "device-c" }],
      ["device-a", "device-c"],
    )).toEqual([{ token: "device-b" }]);
  });

  it("uses the bundled order sound and Android order channel for seller orders", () => {
    expect(buildExpoPushMessages([{ token: "ExponentPushToken[order]" }], {
      title: "New order! 🛍️",
      body: "Order ready to review",
      sound: "order-received.wav",
      channelId: "orders",
    })[0]).toMatchObject({
      sound: "order-received.wav",
      channelId: "orders",
    });
  });
});