/**
 * A Shopify fulfillment must never flip a cancelled / refunding / delivered
 * Brandthread order to "shipped" (or request a payout release for it); the
 * same pre-shipment states PATCH /api/orders/:id/tracking allows still work.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import { db, orders, shopifyOrderLinks, shopifyWebhookEvents } from "@workspace/db";

const requestOrderRelease = vi.fn(async (_orderId: string, _trigger: string) => ({ status: "requested", releaseId: null }) as any);
vi.mock("../../lib/money/escrow", () => ({
  requestOrderRelease: (orderId: string, trigger: string) => requestOrderRelease(orderId, trigger),
  executeOrderRelease: async () => ({}),
}));
vi.mock("../notifications-feed", () => ({ publishNotification: async () => {} }));
vi.mock("../../lib/orderNotifications", () => ({ notifyBuyerOrderShipped: async () => {} }));

const SECRET = "s14-shopify-secret";
process.env.SHOPIFY_APP_API_SECRET = SECRET;

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `s14-shop-seller-${suffix}`;
const shopDomain = `s14-${suffix}.myshopify.com`;
const orderIds: string[] = [];
let server: Server;
let base = "";

async function makeLinkedOrder(status: string) {
  const [order] = await db.insert(orders).values({
    ownerId: sellerId, buyerId: `s14-shop-buyer-${suffix}`, orderNumber: `S14SH-${status}-${suffix}`,
    status, totalCents: 2000, subtotalCents: 2000, chargeModel: "held", fundsState: "held",
    stripeCheckoutSessionId: `cs_s14sh_${status}_${suffix}`,
  }).returning({ id: orders.id });
  orderIds.push(order.id);
  const shopifyOrderId = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  await db.insert(shopifyOrderLinks).values({ brandthreadOrderId: order.id, ownerId: sellerId, shopifyOrderId, status: "sent" });
  return { orderId: order.id, shopifyOrderId };
}

async function fulfil(shopifyOrderId: string, trackingNumber: string) {
  const body = JSON.stringify({ order_id: shopifyOrderId, tracking_number: trackingNumber, tracking_company: "UPS" });
  return fetch(`${base}/api/webhooks/shopify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-hmac-sha256": crypto.createHmac("sha256", SECRET).update(body).digest("base64"),
      "x-shopify-topic": "fulfillments/create",
      "x-shopify-shop-domain": shopDomain,
      "x-shopify-webhook-id": crypto.randomUUID(),
    },
    body,
  });
}

beforeAll(async () => {
  const { default: router } = await import("../webhooks-shopify");
  const app = express();
  app.use("/api/webhooks/shopify", express.raw({ type: "application/json" }), router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => requestOrderRelease.mockClear());

afterAll(async () => {
  if (orderIds.length) {
    await db.delete(shopifyOrderLinks).where(inArray(shopifyOrderLinks.brandthreadOrderId, orderIds));
    await db.delete(orders).where(inArray(orders.id, orderIds));
  }
  await db.delete(shopifyWebhookEvents).where(eq(shopifyWebhookEvents.shopDomain, shopDomain));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Shopify fulfillment webhook status guard", () => {
  for (const status of ["cancelled", "refund_pending", "delivered"]) {
    it(`leaves a ${status} order alone`, async () => {
      const { orderId, shopifyOrderId } = await makeLinkedOrder(status);
      expect((await fulfil(shopifyOrderId, `1ZS14${status}`)).status).toBe(200);
      const [row] = await db.select().from(orders).where(eq(orders.id, orderId));
      expect(row.status).toBe(status);
      expect(row.trackingNumber).toBeNull();
      expect(requestOrderRelease).not.toHaveBeenCalled();
    });
  }

  it("still ships a processing order and updates tracking on an already-shipped one", async () => {
    const { orderId, shopifyOrderId } = await makeLinkedOrder("processing");
    await fulfil(shopifyOrderId, "1ZS14FIRST");
    let [row] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(row).toMatchObject({ status: "shipped", trackingNumber: "1ZS14FIRST" });
    await fulfil(shopifyOrderId, "1ZS14SECOND");
    [row] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(row).toMatchObject({ status: "shipped", trackingNumber: "1ZS14SECOND" });
    expect(requestOrderRelease).toHaveBeenCalledTimes(2);
  });
});
