/**
 * Integration test for GET /api/inventory — the endpoint the mobile app's
 * Inventory screen depends on for stock levels, low/out-of-stock status and
 * per-variant SKU labels.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, products, productVariants } from "@workspace/db";
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
const sellerId = `inv-seller-${suffix}`;
const otherSellerId = `inv-other-seller-${suffix}`;
const productIds: string[] = [];
let server: Server;
let base = "";

beforeAll(async () => {
  const [mine, theirs] = await db.insert(products).values([
    { ownerId: sellerId, name: `Test Hoodie ${suffix}`, status: "active" },
    { ownerId: otherSellerId, name: `Other Seller Product ${suffix}`, status: "active" },
  ]).returning({ id: products.id });
  productIds.push(mine.id, theirs.id);

  await db.insert(productVariants).values([
    { productId: mine.id, size: "M", color: "Black", sku: `SKU-INSTOCK-${suffix}`, priceCents: 4200, stock: 50, lowStockThreshold: 10 },
    { productId: mine.id, size: "S", color: "Black", sku: `SKU-LOW-${suffix}`, priceCents: 4200, stock: 3, lowStockThreshold: 10 },
    { productId: mine.id, size: "L", color: "Black", sku: `SKU-OUT-${suffix}`, priceCents: 4200, stock: 0, lowStockThreshold: 10 },
    { productId: theirs.id, size: "M", color: "White", sku: `SKU-OTHER-${suffix}`, priceCents: 3000, stock: 25, lowStockThreshold: 5 },
  ]);

  const { default: inventoryRouter } = await import("../inventory");
  const app = express();
  app.use(express.json());
  app.use("/api/inventory", inventoryRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(productVariants).where(inArray(productVariants.productId, productIds));
  await db.delete(products).where(inArray(products.id, productIds));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function getInventory(userId: string) {
  const response = await fetch(`${base}/api/inventory`, {
    headers: { "x-test-user": userId },
  });
  const body = await response.json() as any[];
  return { status: response.status, body };
}

describe("GET /api/inventory", () => {
  it("returns only the authenticated seller's variants with computed status", async () => {
    const { status, body } = await getInventory(sellerId);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(3);

    const bySku = Object.fromEntries(body.map((row: any) => [row.sku, row]));
    expect(bySku[`SKU-INSTOCK-${suffix}`].status).toBe("in_stock");
    expect(bySku[`SKU-LOW-${suffix}`].status).toBe("low_stock");
    expect(bySku[`SKU-OUT-${suffix}`].status).toBe("out_of_stock");
    expect(bySku[`SKU-INSTOCK-${suffix}`].variantLabel).toBe("M / Black");

    expect(body.some((row: any) => row.sku === `SKU-OTHER-${suffix}`)).toBe(false);
  });

  it("scopes strictly to the requesting seller (no cross-seller leakage)", async () => {
    const { status, body } = await getInventory(otherSellerId);
    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].sku).toBe(`SKU-OTHER-${suffix}`);
  });

  it("returns an empty array for a seller with no products", async () => {
    const { status, body } = await getInventory(`inv-empty-seller-${suffix}`);
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });
});
