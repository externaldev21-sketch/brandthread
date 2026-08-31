import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orders } from "@workspace/db";
import { eq } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `order-detail-seller-${suffix}`;
let orderId = "";
let server: Server;
let base = "";

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

async function getOrder(id: string) {
  const response = await fetch(`${base}/api/orders/${id}`, {
    headers: { "x-test-user": sellerId },
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  const [order] = await db.insert(orders).values({
    ownerId: sellerId,
    buyerId: null,
    guestEmail: `guest-${suffix}@test.local`,
    orderNumber: `STRIPE-${suffix}`,
    status: "processing",
    totalCents: 2500,
    subtotalCents: 2500,
    stripeCheckoutSessionId: `cs_order_detail_${suffix}`,
    shippingAddress: {
      name: "Guest Checkout Buyer",
      street: "123 Test Street",
      city: "Portland",
      state: "OR",
      zip: "97205",
      country: "US",
    },
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

afterAll(async () => {
  await db.delete(orders).where(eq(orders.id, orderId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/orders/:id buyer identity", () => {
  it("keeps guest checkout identity when buyerId and customerId are missing", async () => {
    const response = await getOrder(orderId);

    expect(response.status).toBe(200);
    expect(response.body.buyerId).toBeNull();
    expect(response.body.customerId).toBeNull();
    expect(response.body.guestEmail).toBe(`guest-${suffix}@test.local`);
    expect(response.body.shippingAddress).toMatchObject({
      name: "Guest Checkout Buyer",
      street: "123 Test Street",
    });
    expect(response.body.customer).toMatchObject({
      id: "",
      name: "Guest Checkout Buyer",
      email: `guest-${suffix}@test.local`,
    });
  });
});