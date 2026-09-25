import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { db, orders, shopifyConnections, shopifyOrderLinks, shopifyWebhookEvents } from "@workspace/db";

const requestOrderRelease = vi.fn(async (_orderId: string, _trigger: string) => ({ status: "requested", releaseId: "release-1" }) as any);
const executeOrderRelease = vi.fn(async (_releaseId: string, _opts?: unknown) => ({}) as any);

vi.mock("../../lib/money/escrow", () => ({
  requestOrderRelease: (orderId: string, trigger: string) => requestOrderRelease(orderId, trigger),
  executeOrderRelease: (releaseId: string, opts?: unknown) => executeOrderRelease(releaseId, opts),
}));

const publishNotification = vi.fn(async () => {});
vi.mock("../notifications-feed", () => ({ publishNotification }));

const WEBHOOK_SECRET = "webhook-test-secret";
process.env.SHOPIFY_APP_API_SECRET = WEBHOOK_SECRET;
process.env.SHOPIFY_APP_API_KEY = "unused-in-this-test";

function sign(body: string): string {
  return crypto.createHmac("sha256", WEBHOOK_SECRET).update(body).digest("base64");
}

async function postWebhook(base: string, topic: string, payload: unknown, opts?: { shopDomain?: string; webhookId?: string; badHmac?: boolean }) {
  const body = JSON.stringify(payload);
  const hmac = opts?.badHmac ? "invalid==" : sign(body);
  return fetch(`${base}/api/webhooks/shopify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-hmac-sha256": hmac,
      "x-shopify-topic": topic,
      "x-shopify-shop-domain": opts?.shopDomain ?? "webhook-test.myshopify.com",
      "x-shopify-webhook-id": opts?.webhookId ?? crypto.randomUUID(),
    },
    body,
  });
}

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `shopify-webhook-seller-${suffix}`;
const buyerId = `shopify-webhook-buyer-${suffix}`;
const shopDomain = `webhook-test-${suffix}.myshopify.com`;
const shopifyOrderId = `${Date.now()}`;
let orderId = "";
let server: Server;
let base = "";

beforeAll(async () => {
  const [order] = await db.insert(orders).values({
    ownerId: sellerId,
    buyerId,
    orderNumber: `SHOPWHK-${suffix}`,
    status: "pending",
    totalCents: 3000,
    subtotalCents: 3000,
    chargeModel: "held",
    fundsState: "held",
    stripeCheckoutSessionId: `cs_shopwhk_${suffix}`,
  }).returning({ id: orders.id });
  orderId = order.id;

  await db.insert(shopifyOrderLinks).values({
    brandthreadOrderId: orderId, ownerId: sellerId, shopifyOrderId, status: "sent",
  });

  await db.insert(shopifyConnections).values({
    ownerId: sellerId, shopDomain, accessTokenEncrypted: "unused.unused.unused",
    connectionType: "custom_app", scopes: "read_products", fulfillmentEnabled: true,
  });

  const { default: webhooksShopifyRouter } = await import("../webhooks-shopify");
  const app = express();
  app.use("/api/webhooks/shopify", express.raw({ type: "application/json" }), webhooksShopifyRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  requestOrderRelease.mockClear();
  executeOrderRelease.mockClear();
  publishNotification.mockClear();
});

afterAll(async () => {
  await db.delete(shopifyOrderLinks).where(eq(shopifyOrderLinks.brandthreadOrderId, orderId));
  await db.delete(orders).where(eq(orders.id, orderId));
  await db.delete(shopifyConnections).where(eq(shopifyConnections.ownerId, sellerId));
  await db.delete(shopifyWebhookEvents).where(eq(shopifyWebhookEvents.shopDomain, shopDomain));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /api/webhooks/shopify", () => {
  it("rejects a delivery with an invalid HMAC signature", async () => {
    const res = await postWebhook(base, "app/uninstalled", { id: 1 }, { badHmac: true, shopDomain });
    expect(res.status).toBe(401);
  });

  it("fulfillments/create writes tracking and releases held funds through the existing escrow path", async () => {
    const res = await postWebhook(base, "fulfillments/create", {
      order_id: shopifyOrderId,
      tracking_number: "1Z999AA10123456784",
      tracking_company: "UPS",
    }, { shopDomain, webhookId: "wh-1" });
    expect(res.status).toBe(200);

    const [updated] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(updated.trackingNumber).toBe("1Z999AA10123456784");
    expect(updated.carrier).toBe("UPS");
    expect(updated.status).toBe("shipped");

    expect(requestOrderRelease).toHaveBeenCalledTimes(1);
    expect(requestOrderRelease).toHaveBeenCalledWith(orderId, "tracking");
  });

  it("a redelivered fulfillment webhook (same webhook id) is a no-op", async () => {
    await postWebhook(base, "fulfillments/create", {
      order_id: shopifyOrderId, tracking_number: "1Z999AA10123456784", tracking_company: "UPS",
    }, { shopDomain, webhookId: "wh-1" }); // same id as the previous test

    expect(requestOrderRelease).not.toHaveBeenCalled();
  });

  it("app/uninstalled marks the connection disconnected", async () => {
    const res = await postWebhook(base, "app/uninstalled", {}, { shopDomain, webhookId: "wh-uninstall" });
    expect(res.status).toBe(200);

    const [conn] = await db.select().from(shopifyConnections).where(eq(shopifyConnections.shopDomain, shopDomain));
    expect(conn.status).toBe("disconnected");
  });
});
