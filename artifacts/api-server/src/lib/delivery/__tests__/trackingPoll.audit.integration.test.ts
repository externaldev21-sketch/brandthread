/**
 * Audit B04: the hourly tracking poll must reach newly shipped orders (never
 * polled, tracking_polled_at NULL) even when a backlog of re-polls exceeds the
 * per-run limit. Postgres sorts NULL last in ASC, which starved them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../stripe")>();
  const { fake, TEST_WEBHOOK_SECRET } = await import("../../money/__tests__/fakeStripe");
  return { ...actual, stripe: fake.stripe, requireStripe: () => fake.stripe, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
});
vi.mock("../../push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../push")>()),
  sendPushToUser: async () => {},
}));
vi.mock("../../brandthreadEmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../brandthreadEmail")>()),
  sendOrderConfirmationEmail: async () => true,
  sendOrderShippingEmail: async () => true,
}));

import { db, orderItems, orders } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { fake } from "../../money/__tests__/fakeStripe";
import { pay, seedBuyer, seedProduct, seedSeller, uid } from "../../money/__tests__/moneyHarness";
import { pollShippedOrders } from "../trackingSync";

beforeEach(async () => {
  // The poll is global: park every order other tests left behind.
  await db.update(orders).set({ status: "cancelled" }).where(sql`${orders.status} = 'shipped'`);
  fake.reset();
});

async function shippedOrder(polledAt: Date | null) {
  const seller = await seedSeller("poll");
  const buyer = await seedBuyer("poll");
  const product = await seedProduct(seller, { priceCents: 4000 });
  const { order } = await pay({
    sellerId: seller, buyerId: buyer, chargeModel: "transfer",
    items: [{ variantId: product.variantId, productName: product.productName, priceCents: 4000, quantity: 1 }],
  });
  const trackingNumber = `1Z${uid("poll").replace(/[^A-Za-z0-9]/g, "")}`;
  await db.update(orders).set({
    trackingNumber, carrier: "UPS", status: "shipped", shippedAt: new Date(), trackingPolledAt: polledAt,
  }).where(eq(orders.id, order.id));
  await db.update(orderItems).set({ trackingNumber, carrier: "UPS", shippedAt: new Date() })
    .where(eq(orderItems.orderId, order.id));
  return { orderId: order.id, trackingNumber };
}

describe("pollShippedOrders", () => {
  it("polls a never-polled order before re-polling older ones when the limit is reached", async () => {
    const now = new Date();
    const old = await shippedOrder(new Date(now.valueOf() - 2 * 3_600_000));
    const fresh = await shippedOrder(null);
    const polled: string[] = [];
    const fetchTrack = async (_carrier: string, trackingNumber: string) => {
      polled.push(trackingNumber);
      return {
        tracking_number: trackingNumber,
        tracking_status: { status: "TRANSIT", status_details: "In transit", status_date: now.toISOString() },
        tracking_history: [],
      } as any;
    };

    expect(await pollShippedOrders({ now, limit: 1, fetchTrack })).toBe(1);
    expect(polled).toEqual([fresh.trackingNumber]);
    expect(polled).not.toContain(old.trackingNumber);
    const [row] = await db.select({ at: orders.trackingPolledAt }).from(orders).where(eq(orders.id, fresh.orderId));
    expect(row.at).not.toBeNull();
  });
});
