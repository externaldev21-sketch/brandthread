import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orders, orderItems } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const publishNotification = vi.fn(async () => {});
const sendOrderShippingEmail = vi.fn(async () => true);

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));

vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../notifications-feed", () => ({ publishNotification }));
vi.mock("../../lib/brandthreadEmail", () => ({ sendOrderShippingEmail }));
vi.mock("../../lib/delivery/trackingSync", () => ({ registerTrackingWithCarrier: async () => {} }));

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `ship-notify-seller-${suffix}`;
const buyerId = `ship-notify-buyer-${suffix}`;
const created: string[] = [];
let server: Server;
let base = "";
let n = 0;

async function newOrder(items = 1): Promise<{ id: string; itemIds: string[] }> {
  n += 1;
  const [order] = await db.insert(orders).values({
    ownerId: sellerId,
    buyerId,
    guestEmail: `ship-notify-${suffix}@example.com`,
    orderNumber: `SHIPQ-${suffix}-${n}`,
    status: "processing",
    totalCents: 2500 * items,
    subtotalCents: 2500 * items,
    stripeCheckoutSessionId: `cs_ship_notify_${suffix}_${n}`,
  }).returning({ id: orders.id });
  created.push(order.id);
  const rows = await db.insert(orderItems).values(
    Array.from({ length: items }, (_, i) => ({ orderId: order.id, productName: `Tee ${i + 1}`, quantity: 1, priceCents: 2500 })),
  ).returning({ id: orderItems.id });
  return { id: order.id, itemIds: rows.map((r) => r.id) };
}

async function patch(path: string, body: unknown) {
  const response = await fetch(`${base}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-test-user": sellerId },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

beforeAll(async () => {
  const { default: ordersRouter } = await import("../orders");
  const app = express();
  app.use(express.json());
  app.use("/api/orders", ordersRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  publishNotification.mockClear();
  sendOrderShippingEmail.mockClear();
});

afterAll(async () => {
  if (created.length) await db.delete(orders).where(inArray(orders.id, created));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("fulfil sheet: Send notification to customer", () => {
  it("PATCH /tracking ships and notifies the buyer by default", async () => {
    const order = await newOrder();
    const res = await patch(`/api/orders/${order.id}/tracking`, { trackingNumber: "1Z999AA10000000001", carrier: "UPS" });
    await settle();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("shipped");
    expect(publishNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: buyerId, type: "order_shipped" }));
    expect(publishNotification).toHaveBeenCalledTimes(1);
    expect(sendOrderShippingEmail).toHaveBeenCalledTimes(1);
  });

  it("PATCH /tracking with notifyCustomer:false ships without the push or the email", async () => {
    const order = await newOrder();
    const res = await patch(`/api/orders/${order.id}/tracking`, { trackingNumber: "1Z999AA10000000002", carrier: "UPS", notifyCustomer: false });
    await settle();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("shipped");
    expect(res.body.trackingNumber).toBe("1Z999AA10000000002");
    expect(publishNotification).not.toHaveBeenCalled();
    expect(sendOrderShippingEmail).not.toHaveBeenCalled();
  });

  it("PATCH /items-tracking with notifyCustomer:false ships the item quietly", async () => {
    const order = await newOrder(2);
    const res = await patch(`/api/orders/${order.id}/items-tracking`, {
      itemIds: [order.itemIds[0]], trackingNumber: "9400100000000000000003", carrier: "USPS", notifyCustomer: false,
    });
    await settle();
    expect(res.status).toBe(200);
    const shipped = res.body.items.find((item: { id: string }) => item.id === order.itemIds[0]);
    expect(shipped.trackingNumber).toBe("9400100000000000000003");
    expect(publishNotification).not.toHaveBeenCalled();
  });

  it("PATCH /items-tracking notifies by default", async () => {
    const order = await newOrder(2);
    const res = await patch(`/api/orders/${order.id}/items-tracking`, {
      itemIds: [order.itemIds[0]], trackingNumber: "9400100000000000000004", carrier: "USPS",
    });
    await settle();
    expect(res.status).toBe(200);
    expect(publishNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: buyerId, type: "order_shipped" }));
  });

  it("PATCH /status shipped with notifyCustomer:false skips only the shipped message", async () => {
    const order = await newOrder();
    const res = await patch(`/api/orders/${order.id}/status`, { status: "shipped", notifyCustomer: false });
    await settle();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("shipped");
    expect(publishNotification).not.toHaveBeenCalled();
    expect(sendOrderShippingEmail).not.toHaveBeenCalled();
  });

  it("PATCH /status cancelled always notifies, even with notifyCustomer:false", async () => {
    const order = await newOrder();
    const res = await patch(`/api/orders/${order.id}/status`, { status: "cancelled", reason: "out_of_stock", notifyCustomer: false });
    await settle();
    expect(res.status).toBe(200);
    expect(publishNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: buyerId, type: "order_cancelled" }));
    const [row] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, order.id));
    expect(row.status).toBe("cancelled");
  });
});
