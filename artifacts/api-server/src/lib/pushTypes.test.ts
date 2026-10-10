import { describe, expect, it } from "vitest";
import { decidePushType, isPushPaused, isValidValueFor, pushTypeDefByKey, pushTypeDefFor, pushTypeView, readPushTypeValue } from "./pushTypes";
import { accountLabelledContent } from "./push";
import { accountsToKeep } from "../routes/push";

describe("per-type push settings", () => {
  it("maps every event Dev listed to a setting", () => {
    const expected: Record<string, string> = {
      new_order_received: "new_orders", new_friend_message: "messages", new_order_message: "messages",
      new_follower: "new_followers", post_comment: "comments", post_like: "likes", live_started: "live",
      order_shipped: "shipped", order_delivered: "delivered", payout_sent: "payouts", new_review: "reviews",
      manufacturer_message: "manufacturer_messages", missed_call: "missed_calls",
    };
    for (const [type, key] of Object.entries(expected)) expect(pushTypeDefFor(type)?.key, type).toBe(key);
  });

  it("defaults to on and ignores malformed stored values", () => {
    expect(readPushTypeValue({}, "likes")).toBe("everyone");
    expect(readPushTypeValue({ "pushType:likes": true }, "likes")).toBe("everyone");
    expect(readPushTypeValue({ "pushType:messages": "following" }, "messages")).toBe("everyone"); // no audience option
    expect(readPushTypeValue({ "pushType:likes": "off" }, "likes")).toBe("off");
  });

  it("only offers From profiles I follow where Instagram does", () => {
    expect(isValidValueFor(pushTypeDefByKey("likes")!, "following")).toBe(true);
    expect(isValidValueFor(pushTypeDefByKey("new_followers")!, "following")).toBe(false);
    expect(isValidValueFor(pushTypeDefByKey("new_followers")!, "off")).toBe(true);
  });

  it("decides send / skip / follow check", () => {
    const prefs = { "pushType:likes": "following", "pushType:comments": "off" };
    expect(decidePushType(prefs, "post_like", "u1")).toBe("needs_follow_check");
    expect(decidePushType(prefs, "post_liked", null)).toBe("skip"); // batched, no single actor
    expect(decidePushType(prefs, "post_comment", "u1")).toBe("skip");
    expect(decidePushType(prefs, "order_shipped", null)).toBe("send");
    expect(decidePushType(prefs, "subscription_trial_will_end", null)).toBe("send");
  });

  it("shows each account type only its own settings", () => {
    expect(Object.keys(pushTypeView("seller", {}))).toContain("new_orders");
    expect(Object.keys(pushTypeView("seller", {}))).not.toContain("shipped");
    expect(Object.keys(pushTypeView("buyer", {}))).toContain("shipped");
    expect(Object.keys(pushTypeView("buyer", {}))).not.toContain("payouts");
  });

  it("treats a past or missing pause as not paused", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    expect(isPushPaused(null, now)).toBe(false);
    expect(isPushPaused(new Date("2026-10-09T11:59:00Z"), now)).toBe(false);
    expect(isPushPaused("2026-10-09T12:15:00Z", now)).toBe(true);
  });
});

describe("multi-account labelling", () => {
  it("labels shared devices only, by platform", () => {
    expect(accountLabelledContent({ token: "t" }, "Hi", "ana")).toEqual({ title: "Hi" });
    expect(accountLabelledContent({ token: "t", sharedWithOtherAccount: true, platform: "ios" }, "Hi", "@ana")).toEqual({ title: "Hi", subtitle: "@ana" });
    expect(accountLabelledContent({ token: "t", sharedWithOtherAccount: true, platform: "android" }, "Hi", "ana")).toEqual({ title: "@ana · Hi" });
    expect(accountLabelledContent({ token: "t", sharedWithOtherAccount: true, platform: "ios" }, "Hi", null)).toEqual({ title: "Hi" });
  });

  it("keeps the caller plus the listed signed-in accounts", () => {
    expect(accountsToKeep("a", undefined)).toEqual(["a"]);
    expect(accountsToKeep("a", ["b", "a", "", 5, "c"])).toEqual(["a", "b", "c"]);
  });
});
