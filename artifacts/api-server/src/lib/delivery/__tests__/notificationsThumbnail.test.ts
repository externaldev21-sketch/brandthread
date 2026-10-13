import { beforeEach, describe, expect, it, vi } from "vitest";

// Item 55: delivery-guarantee notifications carry the order's product photo.
const published = vi.hoisted(() => [] as any[]);
const thumbs = vi.hoisted(() => new Map<string, string>());

vi.mock("@workspace/db", () => ({ db: {}, users: {} }));
vi.mock("../../../routes/notifications-feed", () => ({
  publishNotification: vi.fn(async (n: any) => { published.push(n); }),
}));
vi.mock("../../orderItemImages", () => ({
  withOrderImage: vi.fn(async (orderId: string, input: any) =>
    thumbs.has(orderId) && !input.targetImageUrl ? { ...input, targetImageUrl: thumbs.get(orderId) } : input),
}));
vi.mock("../../orderNotifications", () => ({
  formatOrderCents: (cents: number) => `$${(cents / 100).toFixed(2)}`,
}));

import {
  notifyAutoRefunded,
  notifyBuyerDelivered,
  notifyBuyerDisputePaused,
  notifyBuyerOutForDelivery,
  notifyBuyerPreparing,
} from "../notifications";

const order = { id: "o1", orderNumber: "BT-7", buyerId: "b1", ownerId: "s1" };

beforeEach(() => {
  published.length = 0;
  thumbs.clear();
});

describe("delivery notifications thumbnail", () => {
  it("adds the order's product image to every buyer and seller row", async () => {
    thumbs.set("o1", "/objects/uploads/tee");
    await notifyBuyerPreparing(order);
    await notifyBuyerOutForDelivery(order);
    await notifyBuyerDelivered(order, false);
    await notifyBuyerDisputePaused(order);
    await notifyAutoRefunded({ ...order, refundedCents: 2500, partial: false, windowDays: 30 });
    expect(published.map((n) => [n.type, n.targetId, n.targetImageUrl])).toEqual([
      ["order_preparing", "o1", "/objects/uploads/tee"],
      ["order_out_for_delivery", "o1", "/objects/uploads/tee"],
      ["order_delivered", "o1", "/objects/uploads/tee"],
      ["order_refund_paused", "o1", "/objects/uploads/tee"],
      ["order_auto_refunded", "o1", "/objects/uploads/tee"],
      ["order_auto_refunded_seller", "o1", "/objects/uploads/tee"],
    ]);
  });

  it("keeps the payload unchanged when the order has no product image", async () => {
    await notifyBuyerDelivered(order, true);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      type: "order_delivered", title: "Part of your order was delivered", targetType: "buyer_order",
    });
    expect(published[0].targetImageUrl).toBeUndefined();
  });
});
