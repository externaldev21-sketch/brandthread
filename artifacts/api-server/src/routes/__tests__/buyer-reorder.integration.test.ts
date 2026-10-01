import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orders, orderItems, products, productVariants } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const buyerId = `reorder-test-buyer-${suffix}`;
const otherBuyerId = `reorder-test-other-${suffix}`;
const sellerId = `reorder-test-seller-${suffix}`;
const orderNumber = `BT-REORDER-${suffix}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));

let server: Server;
let base = "";
let orderId = "";
let productId = "";
let variantId = "";

beforeAll(async () => {
  const { default: buyerRouter } = await import("../buyer");
  const app = express();
  app.use(express.json());
  app.use("/api/buyer", buyerRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const [product] = await db.insert(products).values({
    ownerId: sellerId, name: `Reorder Tee ${suffix}`, status: "active",
  }).returning({ id: products.id });
  productId = product!.id;
  const [variant] = await db.insert(productVariants).values({
    productId, size: "M", color: "Black", sku: `REORDER-${suffix}`, priceCents: 5000, stock: 2,
  }).returning({ id: productVariants.id });
  variantId = variant!.id;
  const [order] = await db.insert(orders).values({
    ownerId: sellerId, buyerId, orderNumber, status: "delivered",
    totalCents: 8000, subtotalCents: 8000, shippingCents: 0,
    shippingAddress: { name: "Buyer", street: "1 Test St", city: "Austin", state: "TX", zip: "78701", country: "US" },
  }).returning({ id: orders.id });
  orderId = order!.id;
  await db.insert(orderItems).values({
    orderId, variantId, productName: `Reorder Tee ${suffix}`, variantLabel: "M / Black", quantity: 4, priceCents: 4000,
  });
});

afterAll(async () => {
  // Only rows this test created.
  await db.delete(orders).where(eq(orders.orderNumber, orderNumber));
  await db.delete(products).where(inArray(products.id, productId ? [productId] : []));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const reorder = (id: string, user: string) =>
  fetch(`${base}/api/buyer/orders/${id}/reorder`, { method: "POST", headers: { "x-test-user": user } });

describe("POST /api/buyer/orders/:id/reorder", () => {
  it("resolves the buyer's own order with current price and clamped stock", async () => {
    const response = await reorder(orderId, buyerId);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.unavailable).toEqual([]);
    expect(body.addable).toEqual([
      expect.objectContaining({
        productId, variantId, quantity: 2, quantityClamped: true,
        currentPriceCents: 5000, priceChanged: true, previousPriceCents: 4000,
      }),
    ]);
  });

  it("returns 404 (never the order's contents) to a different buyer", async () => {
    const response = await reorder(orderId, otherBuyerId);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Order not found" });
  });

  it("rejects a malformed order id", async () => {
    const response = await reorder("not-a-uuid", buyerId);
    expect(response.status).toBe(400);
  });
});
