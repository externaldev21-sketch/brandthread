import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orders } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const publishNotification = vi.fn(async () => {});
const sendOrderShippingEmail = vi.fn(async () => true);
const sendOrderDeliveredEmail = vi.fn(async () => true);

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
vi.mock("../../lib/brandthreadEmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/brandthreadEmail")>()),
  sendOrderShippingEmail,
  sendOrderDeliveredEmail,
}));
vi.mock("../../lib/delivery/trackingSync", () => ({ registerTrackingWithCarrier: async () => {} }));

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `order-events-seller-${suffix}`;
const buyerId = `order-events-buyer-${suffix}`;
const created: string[] = [];
let server: Server;
let base = "";

async function seedOrder(values: Partial<typeof orders.$inferInsert> = {}): Promise<string> {
  const [order] = await db.insert(orders).values({
    ownerId: sellerId,
    buyerId,
    guestEmail: "buyer@example.com",
    orderNumber: `EVT-${suffix}-${created.length}`,
    status: "pending",
    totalCents: 2500,
    subtotalCents: 2500,
    ...values,
  }).returning({ id: orders.id });
  created.push(order.id);
  return order.id;
}

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}/api/orders${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user": sellerId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeAll(async () => {
  const { default: ordersRouter } = await import("../orders");
  const app = express();
  app.use(express.json());
  app.use("/api/orders", ordersRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  publishNotification.mockClear();
  sendOrderShippingEmail.mockClear();
  sendOrderDeliveredEmail.mockClear();
});

afterAll(async () => {
  if (created.length) await db.delete(orders).where(inArray(orders.id, created));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /api/orders/:id/ship", () => {
  it("rejects a tracking number in the wrong format and leaves the order unshipped", async () => {
    const id = await seedOrder();
    const response = await call("POST", `/${id}/ship`, { carrier: "UPS", trackingNumber: "12345" });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "INVALID_TRACKING", field: "trackingNumber" });
    const [row] = await db.select().from(orders).where(eq(orders.id, id));
    expect(row.status).toBe("pending");
    expect(publishNotification).not.toHaveBeenCalled();
  });

  it("ships the order (pending → shipped), stores the normalized number, and tells the buyer once", async () => {
    const id = await seedOrder();
    const first = await call("POST", `/${id}/ship`, { carrier: "ups", trackingNumber: "1z 999aa1 0123456784" });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: "shipped", carrier: "UPS", trackingNumber: "1Z999AA10123456784" });

    const again = await call("POST", `/${id}/ship`, { carrier: "UPS", trackingNumber: "1Z999AA10123456784" });
    expect(again.status).toBe(409);
    await flush();

    const shipped = publishNotification.mock.calls.filter(([n]: any[]) => n.type === "order_shipped");
    expect(shipped).toHaveLength(1);
    expect(shipped[0][0]).toMatchObject({
      userId: buyerId, pushCategory: "order", targetId: id, targetType: "buyer_order",
      title: "Your order has shipped",
      body: expect.stringContaining("via UPS. Tracking number: 1Z999AA10123456784."),
    });
    expect(sendOrderShippingEmail).toHaveBeenCalledTimes(1);
    expect(sendOrderShippingEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "buyer@example.com",
      trackingUrl: "https://www.ups.com/track?tracknum=1Z999AA10123456784",
    }));
  });

  it("refuses to ship a cancelled order", async () => {
    const id = await seedOrder({ status: "cancelled" });
    const response = await call("POST", `/${id}/ship`, { carrier: "USPS", trackingNumber: "9400111899223344556677" });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("ILLEGAL_STATUS_TRANSITION");
  });
});

describe("POST /api/orders/:id/mark-delivered", () => {
  it("is offered and works when the carrier can't report delivery (shipped → delivered)", async () => {
    const id = await seedOrder({ status: "shipped", carrier: "Local courier", trackingNumber: "LC123456", shippedAt: new Date() });
    const detail = await call("GET", `/${id}`);
    expect(detail.body.sellerCanMarkDelivered).toBe(true);

    const response = await call("POST", `/${id}/mark-delivered`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "delivered", deliveryConfirmedBy: "seller" });
    await flush();

    expect(publishNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: buyerId, type: "order_delivered", targetType: "buyer_order",
      title: "Your order was delivered",
      body: expect.stringContaining("The seller marked order"),
    }));
    expect(sendOrderDeliveredEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "buyer@example.com", confirmedBy: "seller", idempotencyKey: `order-delivered/${id}`,
    }));

    const repeat = await call("POST", `/${id}/mark-delivered`);
    expect(repeat.status).toBe(200);
  });

  it("leaves a carrier-tracked order to the carrier", async () => {
    const id = await seedOrder({ status: "shipped", carrier: "UPS", trackingNumber: "1Z999AA10123456784", shippedAt: new Date() });
    expect((await call("GET", `/${id}`)).body.sellerCanMarkDelivered).toBe(false);
    const response = await call("POST", `/${id}/mark-delivered`);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("CARRIER_TRACKED");
    const [row] = await db.select().from(orders).where(eq(orders.id, id));
    expect(row.status).toBe("shipped");
  });

  it("refuses an order that hasn't shipped", async () => {
    const id = await seedOrder({ status: "processing" });
    const response = await call("POST", `/${id}/mark-delivered`);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("NOT_SHIPPED");
  });

  it("still blocks the generic status endpoint from marking delivered", async () => {
    const id = await seedOrder({ status: "shipped", carrier: "Local courier", trackingNumber: "LC654321" });
    const response = await call("PATCH", `/${id}/status`, { status: "delivered" });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("DELIVERY_NOT_SELLER_CONFIRMED");
  });
});
