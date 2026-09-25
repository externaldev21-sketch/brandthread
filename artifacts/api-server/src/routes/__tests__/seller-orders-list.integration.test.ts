/**
 * Integration test for GET /api/orders — the endpoint the mobile app's
 * seller Orders screen depends on for order status, buyer, items and total.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orders, orderItems, customers } from "@workspace/db";
import { inArray } from "drizzle-orm";

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

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `ord-seller-${suffix}`;
const otherSellerId = `ord-other-seller-${suffix}`;
const orderIds: string[] = [];
const customerIds: string[] = [];
let server: Server;
let base = "";

beforeAll(async () => {
  const [customer] = await db.insert(customers).values({
    ownerId: sellerId,
    name: `Jamie Buyer ${suffix}`,
    email: `jamie-${suffix}@example.com`,
  }).returning({ id: customers.id });
  customerIds.push(customer.id);

  const [mine, theirs] = await db.insert(orders).values([
    {
      ownerId: sellerId,
      orderNumber: `ORD-${suffix}-1`,
      customerId: customer.id,
      status: "processing",
      totalCents: 8400,
      subtotalCents: 8400,
    },
    {
      ownerId: otherSellerId,
      orderNumber: `ORD-${suffix}-OTHER`,
      status: "processing",
      totalCents: 1000,
      subtotalCents: 1000,
    },
  ]).returning({ id: orders.id });
  orderIds.push(mine.id, theirs.id);

  await db.insert(orderItems).values([
    { orderId: mine.id, productName: "Test Hoodie", variantLabel: "M / Black", quantity: 2, priceCents: 4200 },
  ]);

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
  await db.delete(orderItems).where(inArray(orderItems.orderId, orderIds));
  await db.delete(orders).where(inArray(orders.id, orderIds));
  await db.delete(customers).where(inArray(customers.id, customerIds));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function getOrders(userId: string) {
  const response = await fetch(`${base}/api/orders`, {
    headers: { "x-test-user": userId },
  });
  const body = await response.json() as any[];
  return { status: response.status, body };
}

describe("GET /api/orders", () => {
  it("returns the authenticated seller's orders with customer, items and total", async () => {
    const { status, body } = await getOrders(sellerId);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);

    const order = body[0];
    expect(order.orderNumber).toBe(`ORD-${suffix}-1`);
    expect(order.status).toBe("processing");
    expect(order.totalCents).toBe(8400);
    expect(order.customerName).toBe(`Jamie Buyer ${suffix}`);
    expect(order.customerEmail).toBe(`jamie-${suffix}@example.com`);
    expect(order.itemCount).toBe(1);
    expect(order.createdAt).toBeTruthy();
    expect(order.updatedAt).toBeTruthy();
  });

  it("scopes strictly to the requesting seller (no cross-seller leakage)", async () => {
    const { status, body } = await getOrders(otherSellerId);
    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].orderNumber).toBe(`ORD-${suffix}-OTHER`);
    expect(body[0].itemCount).toBe(0);
  });

  it("returns an empty array for a seller with no orders", async () => {
    const { status, body } = await getOrders(`ord-empty-seller-${suffix}`);
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });
});
