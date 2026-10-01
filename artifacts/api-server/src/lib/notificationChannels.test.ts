import { describe, expect, it } from "vitest";
import { channelPrefKey, channelView, isChannelEnabled, parseChannelKey } from "./notificationChannels";

describe("notification channel preferences", () => {
  it("defaults push and in-app on, and chatty email types off", () => {
    expect(isChannelEnabled({}, "order_updates", "push")).toBe(true);
    expect(isChannelEnabled({}, "order_updates", "inApp")).toBe(true);
    expect(isChannelEnabled({}, "order_updates", "email")).toBe(true);
    expect(isChannelEnabled({}, "friend_activity", "email")).toBe(false);
    expect(isChannelEnabled(null, "friend_activity", "inApp")).toBe(true);
  });

  it("keeps push on its legacy bare key and namespaces the other channels", () => {
    expect(channelPrefKey("push", "messages")).toBe("messages");
    expect(channelPrefKey("inApp", "messages")).toBe("inapp:messages");
    expect(channelPrefKey("email", "messages")).toBe("email:messages");
  });

  it("lets a stored value override the default, per channel", () => {
    const prefs = { "email:order_updates": false, "inapp:messages": false, messages: true };
    expect(isChannelEnabled(prefs, "order_updates", "email")).toBe(false);
    expect(isChannelEnabled(prefs, "messages", "inApp")).toBe(false);
    expect(isChannelEnabled(prefs, "messages", "push")).toBe(true);
  });

  it("renders a role-specific channel view", () => {
    const seller = channelView("seller", { "email:new_orders": false });
    expect(Object.keys(seller.push)).toContain("new_orders");
    expect(Object.keys(seller.push)).not.toContain("order_updates");
    expect(seller.email.new_orders).toBe(false);
    expect(channelView("buyer", {}).email.cart_reminders).toBe(true);
  });

  it("rejects keys that do not belong to the account type", () => {
    expect(parseChannelKey("buyer", "email:order_updates")).toEqual({ channel: "email", key: "order_updates" });
    expect(parseChannelKey("buyer", "email:new_orders")).toBeNull();
    expect(parseChannelKey("seller", "bogus:new_orders")).toBeNull();
  });
});
