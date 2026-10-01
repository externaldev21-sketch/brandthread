import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orders, orderItems, products, productVariants } from "@workspace/db";
import { eq } from "drizzle-orm";

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
vi.mock("../../lib/shippo", () => ({
  createShipment: vi.fn(), purchaseTransaction: vi.fn(), findTransaction: vi.fn(), refundTransaction: vi.fn(),
}));

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `parcel-seller-${suffix}`;
let orderId = "";
let productId = "";
let server: Server;
let base = "";

beforeAll(async () => {
  [{ id: productId }] = await db.insert(products).values({
    ownerId: sellerId, name: `Parcel tee ${suffix}`, category: "apparel", status: "active",
  }).returning({ id: products.id });
  const [heavy, unweighted] = await db.insert(productVariants).values([
    { productId, size: "M", sku: `PS-M-${suffix}`, priceCents: 2000, weightGrams: 300 },
    { productId, size: "L", sku: `PS-L-${suffix}`, priceCents: 2000, weightGrams: 0 },
  ]).returning({ id: productVariants.id });
  const [order] = await db.insert(orders).values({
    ownerId: sellerId, orderNumber: `PS-${suffix}`, status: "processing", totalCents: 6000, subtotalCents: 6000,
  }).returning({ id: orders.id });
  orderId = order.id;
  await db.insert(orderItems).values([
    { orderId, variantId: heavy.id, productName: "Tee", quantity: 2, priceCents: 2000 },
    { orderId, variantId: unweighted.id, productName: "Tee", quantity: 1, priceCents: 2000 },
  ]);

  const { default: router } = await import("../shipping-labels");
  const app = express();
  app.use(express.json());
  app.use("/api/shipping-labels", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(orders).where(eq(orders.id, orderId));
  await db.delete(productVariants).where(eq(productVariants.productId, productId));
  await db.delete(products).where(eq(products.id, productId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/shipping-labels/:orderId/parcel-suggestion", () => {
  it("totals stored item weights and flags items without one", async () => {
    const res = await fetch(`${base}/api/shipping-labels/${orderId}/parcel-suggestion`, { headers: { "x-test-user": sellerId } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ weightGrams: 600, weightOz: 21.2, weightKnown: false, unweightedUnits: 1 });
  });

  it("does not reveal another seller's order", async () => {
    const res = await fetch(`${base}/api/shipping-labels/${orderId}/parcel-suggestion`, { headers: { "x-test-user": `other-${suffix}` } });
    expect(res.status).toBe(404);
  });

  it("rejects a rates request with an invalid parcel", async () => {
    const res = await fetch(`${base}/api/shipping-labels/${orderId}/rates`, {
      method: "POST", headers: { "content-type": "application/json", "x-test-user": sellerId },
      body: JSON.stringify({ length: 10, width: 8, height: 4, weight: 0 }),
    });
    expect(res.status).toBe(400);
  });
});
