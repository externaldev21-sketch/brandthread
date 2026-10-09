import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orders, shippingLabels, shippoWebhookEvents } from "@workspace/db";
import { eq, like } from "drizzle-orm";

const publishNotification = vi.fn(async () => {});
const sendOrderShippingEmail = vi.fn(async () => true);

const getTrack = vi.fn();

vi.mock("../notifications-feed", () => ({ publishNotification }));
vi.mock("../../lib/shippo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/shippo")>()),
  getTrack,
}));
vi.mock("../../lib/brandthreadEmail", () => ({ sendOrderShippingEmail }));

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `shippo-webhook-seller-${suffix}`;
const buyerId = `shippo-webhook-buyer-${suffix}`;
let orderId = "";
let labelId = "";
let server: Server;
let base = "";

beforeAll(async () => {
  const [order] = await db.insert(orders).values({
    ownerId: sellerId,
    buyerId,
    orderNumber: `WHK-${suffix}`,
    status: "processing",
    totalCents: 3000,
    subtotalCents: 3000,
  }).returning({ id: orders.id });
  orderId = order.id;

  const [label] = await db.insert(shippingLabels).values({
    orderId,
    ownerId: sellerId,
    idempotencyKey: `fulfill-${orderId}`,
    providerRateId: "rate_webhook_test",
    carrier: "UPS",
    service: "Ground",
    priceCents: 899,
    status: "active",
    providerTransactionId: `txn_webhook_${suffix}`,
    trackingNumber: "1Z999AA10123456784",
  }).returning({ id: shippingLabels.id });
  labelId = label.id;

  const { default: webhookRouter } = await import("../webhooks-shippo");
  const app = express();
  app.use(express.json());
  app.use("/api/webhooks/shippo", webhookRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

const SECRET = `shippo-secret-${suffix}`;

beforeEach(() => {
  process.env.SHIPPO_WEBHOOK_SECRET = SECRET;
  getTrack.mockReset();
  publishNotification.mockClear();
  sendOrderShippingEmail.mockClear();
});

afterAll(async () => {
  delete process.env.SHIPPO_WEBHOOK_SECRET;
  await db.delete(shippoWebhookEvents).where(like(shippoWebhookEvents.id, `txn_webhook_${suffix}:%`));
  await db.delete(shippingLabels).where(eq(shippingLabels.id, labelId));
  await db.delete(orders).where(eq(orders.id, orderId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function transitPayload(status: string) {
  return {
    event: "track_updated",
    data: {
      transaction: `txn_webhook_${suffix}`,
      tracking_number: "1Z999AA10123456784",
      metadata: `brandthread-label/${labelId}`,
      tracking_status: { status },
    },
  };
}

async function post(body: unknown, secret: string | null = SECRET, path = "/api/webhooks/shippo") {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { "x-shippo-webhook-secret": secret } : {}) },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

describe("POST /api/webhooks/shippo", () => {
  it("moves the order to shipped/in_transit and is idempotent on duplicate delivery", async () => {
    const first = await post(transitPayload("TRANSIT"));
    expect(first.status).toBe(200);
    expect(first.body.duplicate).toBeUndefined();

    const [afterFirst] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(afterFirst.trackingStatus).toBe("in_transit");
    expect(afterFirst.status).toBe("shipped");

    const duplicate = await post(transitPayload("TRANSIT"));
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.duplicate).toBe(true);
  });

  it("moves the order to delivered and fires a delivered notification", async () => {
    const response = await post(transitPayload("DELIVERED"));
    expect(response.status).toBe(200);

    const [after] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(after.trackingStatus).toBe("delivered");
    expect(after.status).toBe("delivered");
    expect(publishNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: buyerId,
      type: "order_delivered",
      targetId: orderId,
    }));
  });

  it("ignores an unrecognized status without error", async () => {
    const response = await post(transitPayload("UNKNOWN"));
    expect(response.status).toBe(200);
    expect(response.body.ignored).toBe(true);
  });

  it("rejects a delivery carrying the wrong secret", async () => {
    const response = await post(transitPayload("DELIVERED"), "not-the-secret");
    expect(response.status).toBe(401);
  });

  it("accepts the secret as a ?secret= query parameter (the form Shippo's dashboard supports)", async () => {
    const response = await post(transitPayload("UNKNOWN"), null, `/api/webhooks/shippo?secret=${SECRET}`);
    expect(response.status).toBe(200);
    expect(response.body.ignored).toBe(true);
  });
});

describe("POST /api/webhooks/shippo without a configured secret", () => {
  let unsignedOrderId = "";
  let unsignedLabelId = "";
  const txn = `txn_webhook_${suffix}_unsigned`;
  const trackingNumber = `1ZUNSIGNED${suffix}`.slice(0, 30);

  beforeAll(async () => {
    const [order] = await db.insert(orders).values({
      ownerId: sellerId,
      buyerId,
      orderNumber: `WHK-U-${suffix}`,
      status: "shipped",
      totalCents: 3000,
      subtotalCents: 3000,
    }).returning({ id: orders.id });
    unsignedOrderId = order.id;
    const [label] = await db.insert(shippingLabels).values({
      orderId: unsignedOrderId,
      ownerId: sellerId,
      idempotencyKey: `fulfill-${unsignedOrderId}`,
      providerRateId: "rate_webhook_test_unsigned",
      carrier: "UPS",
      service: "Ground",
      priceCents: 899,
      status: "active",
      providerTransactionId: txn,
      trackingNumber,
    }).returning({ id: shippingLabels.id });
    unsignedLabelId = label.id;
  });

  afterAll(async () => {
    await db.delete(shippingLabels).where(eq(shippingLabels.id, unsignedLabelId));
    await db.delete(orders).where(eq(orders.id, unsignedOrderId));
  });

  function forged(status: string) {
    return {
      event: "track_updated",
      data: {
        transaction: txn,
        tracking_number: "ATTACKER-CHOSEN-NUMBER",
        metadata: `brandthread-label/${unsignedLabelId}`,
        tracking_status: { status },
      },
    };
  }

  it("does not trust a forged DELIVERED: it applies what Shippo reports for the number on file", async () => {
    delete process.env.SHIPPO_WEBHOOK_SECRET;
    getTrack.mockResolvedValue({ tracking_status: { status: "TRANSIT", status_date: "2026-10-01T10:00:00Z" } });

    const response = await post(forged("DELIVERED"), null);
    expect(response.status).toBe(200);
    expect(getTrack).toHaveBeenCalledWith("ups", trackingNumber);

    const [after] = await db.select().from(orders).where(eq(orders.id, unsignedOrderId));
    expect(after.status).not.toBe("delivered");
    expect(after.deliveredAt).toBeNull();
    expect(after.trackingStatus).toBe("in_transit");
  });

  it("acks without changing anything when Shippo can't confirm the status", async () => {
    delete process.env.SHIPPO_WEBHOOK_SECRET;
    getTrack.mockRejectedValue(new Error("shippo down"));

    const response = await post(forged("DELIVERED"), null);
    expect(response.status).toBe(200);
    expect(response.body.unverified).toBe(true);
    const [after] = await db.select().from(orders).where(eq(orders.id, unsignedOrderId));
    expect(after.deliveredAt).toBeNull();
  });

  it("applies a real delivery once Shippo confirms it", async () => {
    delete process.env.SHIPPO_WEBHOOK_SECRET;
    getTrack.mockResolvedValue({ tracking_status: { status: "DELIVERED", status_date: "2026-10-02T10:00:00Z" } });

    const response = await post(forged("DELIVERED"), null);
    expect(response.status).toBe(200);
    const [after] = await db.select().from(orders).where(eq(orders.id, unsignedOrderId));
    expect(after.trackingStatus).toBe("delivered");
  });
});
