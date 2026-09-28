import { beforeEach, describe, expect, it, vi } from "vitest";

const published = vi.hoisted(() => [] as any[]);
const profiles = vi.hoisted(() => new Map<string, any>());

vi.mock("../routes/notifications-feed", () => ({
  publishNotification: vi.fn(async (n: any) => { published.push(n); }),
}));
vi.mock("./safety", () => ({
  profilesById: vi.fn(async (ids: string[]) => new Map(ids.filter((id) => profiles.has(id)).map((id) => [id, profiles.get(id)]))),
}));
vi.mock("./activityEvents", () => ({
  actorFieldsFromProfile: (p: any) => ({ actorId: p.userId, actorName: p.name, actorInitials: "JR", actorColor: "#3F3F46" }),
}));

import {
  formatOrderCents,
  notifyBuyerOrderCancelled,
  notifyBuyerOrderConfirmed,
  notifySellerOrderCancelledByBuyer,
} from "./orderNotifications";

beforeEach(() => {
  published.length = 0;
  profiles.clear();
});

describe("order lifecycle notifications", () => {
  it("formats money like the existing order notifications", () => {
    expect(formatOrderCents(12345)).toBe("$123.45");
  });

  it("tells the buyer their order is confirmed, opening the buyer order screen", async () => {
    await notifyBuyerOrderConfirmed({ buyerId: "b1", orderId: "o1", orderNumber: "BT-00012", totalCents: 8900, targetImageUrl: "https://img/x.jpg" });
    expect(published).toEqual([expect.objectContaining({
      userId: "b1", category: "orders", type: "order_confirmed", title: "Order confirmed",
      body: "Order #BT-00012 for $89.00 is confirmed. We'll let you know when it ships.",
      targetId: "o1", targetType: "buyer_order", targetImageUrl: "https://img/x.jpg",
    })]);
  });

  it("tells the buyer about their own cancellation and the refund", async () => {
    await notifyBuyerOrderCancelled({ buyerId: "b1", orderId: "o1", orderNumber: "BT-00012", refundedCents: 8900, reason: "buyer_cancelled" });
    expect(published[0]).toMatchObject({
      type: "order_cancelled", title: "Order cancelled", targetType: "buyer_order",
      body: "You cancelled order #BT-00012. Your refund of $89.00 is on its way.",
    });
  });

  it("explains a sold-out auto-cancel", async () => {
    await notifyBuyerOrderCancelled({ buyerId: "b1", orderId: "o1", orderNumber: "BT-00012", refundedCents: 0, reason: "sold_out" });
    expect(published[0].title).toBe("Order cancelled: item sold out");
    expect(published[0].body).toBe("An item in order #BT-00012 sold out while you were paying, so the order was cancelled.");
  });

  it("tells the seller which buyer cancelled, with the buyer as the row's actor", async () => {
    profiles.set("b1", { userId: "b1", name: "Jordan Reyes", deleted: false, suspended: false });
    await notifySellerOrderCancelledByBuyer({ sellerId: "s1", buyerId: "b1", orderId: "o1", orderNumber: "BT-00012", refundedCents: 8900 });
    expect(published[0]).toMatchObject({
      userId: "s1", category: "orders", type: "order_cancelled_by_buyer",
      title: "Jordan Reyes cancelled order #BT-00012",
      body: "The items were restocked. $89.00 was refunded.",
      actorId: "b1", targetId: "o1", targetType: "order",
    });
  });

  it("falls back to a generic actor for a deleted buyer account", async () => {
    profiles.set("b1", { userId: "b1", name: "Gone", deleted: true, suspended: false });
    await notifySellerOrderCancelledByBuyer({ sellerId: "s1", buyerId: "b1", orderId: "o1", orderNumber: "BT-1", refundedCents: 0 });
    expect(published[0].title).toBe("A buyer cancelled order #BT-1");
    expect(published[0]).not.toHaveProperty("actorId");
  });

  it("never throws when publishing fails", async () => {
    const { publishNotification } = await import("../routes/notifications-feed");
    (publishNotification as any).mockRejectedValueOnce(new Error("db down"));
    await expect(notifyBuyerOrderConfirmed({ buyerId: "b1", orderId: "o1", orderNumber: "BT-1", totalCents: 100 })).resolves.toBeUndefined();
  });
});
