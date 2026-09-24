import { describe, expect, it } from "vitest";
import {
  buildExpoPushMessages,
  isWithinQuietHours,
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

  it("maps new event categories to their buyer/seller preference keys", () => {
    expect(preferenceKey("buyer", "stock")).toBe("price_alerts");
    expect(preferenceKey("buyer", "return")).toBe("return_updates");
    expect(preferenceKey("seller", "stock")).toBe("inventory_alerts");
    expect(preferenceKey("seller", "fulfillment")).toBe("new_orders");
    expect(normalizePushEventCategory("returns")).toBe("return");
    expect(normalizePushEventCategory("pricing")).toBe("stock");
  });
});

describe("quiet hours", () => {
  const at = (hhmm: string) => new Date(`2026-01-15T${hhmm}:00Z`);

  it("is off when start or end is unset", () => {
    expect(isWithinQuietHours(at("23:00"), null, null, "UTC")).toBe(false);
    expect(isWithinQuietHours(at("23:00"), "22:00", undefined, "UTC")).toBe(false);
  });

  it("matches a same-day window", () => {
    expect(isWithinQuietHours(at("13:00"), "09:00", "17:00", "UTC")).toBe(true);
    expect(isWithinQuietHours(at("08:00"), "09:00", "17:00", "UTC")).toBe(false);
    expect(isWithinQuietHours(at("17:00"), "09:00", "17:00", "UTC")).toBe(false); // end exclusive
  });

  it("matches a window that wraps midnight", () => {
    expect(isWithinQuietHours(at("23:30"), "22:00", "07:00", "UTC")).toBe(true);
    expect(isWithinQuietHours(at("03:00"), "22:00", "07:00", "UTC")).toBe(true);
    expect(isWithinQuietHours(at("12:00"), "22:00", "07:00", "UTC")).toBe(false);
  });

  it("evaluates the window in the recipient's timezone, not UTC", () => {
    // 23:30 UTC is 15:30 in America/Los_Angeles (UTC-8 in January) — well
    // outside a 22:00-07:00 LA-local quiet window.
    expect(isWithinQuietHours(at("23:30"), "22:00", "07:00", "America/Los_Angeles")).toBe(false);
  });
});