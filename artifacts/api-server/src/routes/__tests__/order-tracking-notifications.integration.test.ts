import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orders } from "@workspace/db";
import { eq } from "drizzle-orm";

const publishNotification = vi.fn(async () => {});

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

vi.mock("../notifications-feed", () => ({
  publishNotification,
}));

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `tracking-alert-seller-${suffix}`;
const buyerId = `tracking-alert-buyer-${suffix}`;
let orderId = "";
let server: Server;
let base = "";

async function updateTrackingStatus(trackingStatus: string) {
  const response = await fetch(`${base}/api/orders/${orderId}/tracking`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-test-user": sellerId,
    },
    body: JSON.stringify({ trackingStatus }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  const [order] = await db.insert(orders).values({
    ownerId: sellerId,
    buyerId,
    orderNumber: `TRACK-${suffix}`,
    status: "shipped",
    trackingStatus: "in_transit",
    totalCents: 2500,
    subtotalCents: 2500,
    stripeCheckoutSessionId: `cs_tracking_alert_${suffix}`,
  }).returning({ id: orders.id });
  orderId = order.id;

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
});

afterAll(async () => {
  await db.delete(orders).where(eq(orders.id, orderId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("PATCH /api/orders/:id/tracking buyer alerts", () => {
  it("publishes one buyer-order alert for repeated out-for-delivery saves", async () => {
    const first = await updateTrackingStatus("out_for_delivery");
    const repeated = await updateTrackingStatus("out_for_delivery");

    expect(first.status).toBe(200);
    expect(repeated.status).toBe(200);
    expect(publishNotification).toHaveBeenCalledTimes(1);
    expect(publishNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: buyerId,
      type: "order_out_for_delivery",
      pushCategory: "order",
      targetId: orderId,
      targetType: "buyer_order",
    }));
  });

  it.each([
    ["exception", "order_exception"],
    ["returned_to_sender", "order_returned_to_sender"],
  ])("publishes a clear %s alert", async (trackingStatus, type) => {
    const response = await updateTrackingStatus(trackingStatus);

    expect(response.status).toBe(200);
    expect(publishNotification).toHaveBeenCalledTimes(1);
    expect(publishNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: buyerId,
      type,
      pushCategory: "order",
      targetId: orderId,
      targetType: "buyer_order",
    }));
  });
});