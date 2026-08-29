import { describe, expect, it } from "vitest";
import { buildExpoPushMessages, preferenceKey } from "./push";

describe("push notification delivery contract", () => {
  it("enables message delivery through the correct buyer and seller preferences", () => {
    expect(preferenceKey("buyer", "message")).toBe("messages");
    expect(preferenceKey("seller", "message")).toBe("customer_messages");
  });

  it("keeps message notifications on the platform default sound", () => {
    expect(buildExpoPushMessages([{ token: "ExponentPushToken[message]" }], {
      title: "New message",
      body: "Hello",
    })[0]).toMatchObject({ sound: "default" });
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