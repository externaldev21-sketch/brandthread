import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  applyNewOrderSoundPreference,
  buildExpoPushMessages,
  NEW_ORDER_PUSH_SOUND,
  SILENT_ORDERS_CHANNEL_ID,
  isWithinQuietHours,
  normalizePushEventCategory,
  preferenceKey,
  unsentPushTokens,
} from "./push";

describe("push notification delivery contract", () => {
  it("normalizes plural feed labels to push event categories", () => {
    expect(normalizePushEventCategory("orders")).toBe("order");
    expect(normalizePushEventCategory("messages")).toBe("message");
    expect(normalizePushEventCategory("announcements")).toBe("announcement");
    expect(normalizePushEventCategory("giveaways")).toBe("giveaway");
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
      sound: NEW_ORDER_PUSH_SOUND,
      channelId: "orders",
    })[0]).toMatchObject({
      sound: NEW_ORDER_PUSH_SOUND,
      channelId: "orders",
    });
  });

  it("names a sound file that the mobile app actually bundles", () => {
    const mobile = path.resolve(__dirname, "../../../mobile");
    expect(NEW_ORDER_PUSH_SOUND).toBe("order_received.wav");
    expect(existsSync(path.join(mobile, "assets/sounds", NEW_ORDER_PUSH_SOUND))).toBe(true);
    expect(readFileSync(path.join(mobile, "app.json"), "utf8")).toContain(`./assets/sounds/${NEW_ORDER_PUSH_SOUND}`);
    // The paid-order webhook sends exactly this file name.
    const webhooks = readFileSync(path.resolve(__dirname, "../routes/webhooks.ts"), "utf8");
    expect(webhooks).toContain(`pushSound: "${NEW_ORDER_PUSH_SOUND}"`);
    expect(webhooks).not.toContain("order-received.wav");
  });

  it("keeps the new-order sound when the seller has not turned it off", () => {
    const payload = { title: "New order", body: "b", data: { type: "new_order_received" }, sound: NEW_ORDER_PUSH_SOUND, channelId: "orders" };
    expect(applyNewOrderSoundPreference(payload, {})).toBe(payload);
    expect(applyNewOrderSoundPreference(payload, { new_order_sound: true })).toBe(payload);
    expect(buildExpoPushMessages([{ token: "t" }], applyNewOrderSoundPreference(payload, null))[0].sound).toBe("order_received.wav");
  });

  it("sends new-order pushes silently when the seller turned the sound off", () => {
    const payload = { title: "New order", body: "b", data: { type: "new_order_received", targetId: "o1" }, sound: NEW_ORDER_PUSH_SOUND, channelId: "orders" };
    const silenced = applyNewOrderSoundPreference(payload, { new_order_sound: false });
    const [message] = buildExpoPushMessages([{ token: "t" }], silenced);
    expect(message.sound).toBeNull();
    expect(message.channelId).toBe(SILENT_ORDERS_CHANNEL_ID);
    expect(message.data).toMatchObject({ type: "new_order_received", targetId: "o1", silent: true });
  });

  it("never silences other notification types", () => {
    const payload = { title: "Message", body: "b", data: { type: "message" } };
    expect(applyNewOrderSoundPreference(payload, { new_order_sound: false })).toBe(payload);
    expect(buildExpoPushMessages([{ token: "t" }], payload)[0].sound).toBe("default");
  });

  it("maps new event categories to their buyer/seller preference keys", () => {
    expect(preferenceKey("buyer", "stock")).toBe("price_alerts");
    expect(preferenceKey("buyer", "return")).toBe("return_updates");
    expect(preferenceKey("buyer", "announcement")).toBe("seller_announcements");
    expect(preferenceKey("seller", "announcement")).toBe("seller_announcements");
    expect(preferenceKey("buyer", "giveaway")).toBeNull();
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