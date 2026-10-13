/**
 * GET /api/products/sales-flags — best-seller / slow-mover badges for the
 * seller's Products list, computed from the last 30 days of paid orders.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orders, orderItems, products, productVariants } from "@workspace/db";
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
const seller = `flags-seller-${suffix}`;
const other = `flags-other-${suffix}`;
const DAY = 24 * 60 * 60 * 1000;
const productIds: string[] = [];
const orderIds: string[] = [];
let server: Server;
let base = "";
let n = 0;

async function seedProduct(owner: string, name: string, opts: { status?: string; stock?: number; ageDays?: number } = {}) {
  const [p] = await db.insert(products).values({
    ownerId: owner, name, status: opts.status ?? "active",
    createdAt: new Date(Date.now() - (opts.ageDays ?? 60) * DAY),
  }).returning({ id: products.id });
  productIds.push(p.id);
  const [v] = await db.insert(productVariants).values({
    productId: p.id, sku: `${name}-${suffix}`.replace(/\s+/g, "-"), priceCents: 2000, stock: opts.stock ?? 5,
  }).returning({ id: productVariants.id });
  return { productId: p.id, variantId: v.id };
}

async function sell(owner: string, variantId: string, quantity: number, opts: { paidDaysAgo?: number | null; status?: string } = {}) {
  const paidDaysAgo = opts.paidDaysAgo === undefined ? 2 : opts.paidDaysAgo;
  const [o] = await db.insert(orders).values({
    ownerId: owner, orderNumber: `FLAGS-${suffix}-${++n}`, status: opts.status ?? "processing",
    totalCents: 2000 * quantity, subtotalCents: 2000 * quantity,
    paidAt: paidDaysAgo === null ? null : new Date(Date.now() - paidDaysAgo * DAY),
  }).returning({ id: orders.id });
  orderIds.push(o.id);
  await db.insert(orderItems).values({ orderId: o.id, variantId, productName: "x", quantity, priceCents: 2000 });
}

beforeAll(async () => {
  const { default: router } = await import("../products");
  const app = express();
  app.use((req, _res, next) => { (req as any).log = { error: (o: unknown) => console.error(o), warn: () => undefined }; next(); });
  app.use(express.json());
  app.use("/api/products", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (orderIds.length) await db.delete(orders).where(inArray(orders.id, orderIds));
  if (productIds.length) await db.delete(products).where(inArray(products.id, productIds));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/products/sales-flags", () => {
  it("flags the seller's best seller and slow movers from the last 30 days", async () => {
    const hit = await seedProduct(seller, "Flag Hit");
    const steady = await seedProduct(seller, "Flag Steady");
    const stale = await seedProduct(seller, "Flag Stale");
    const fresh = await seedProduct(seller, "Flag Fresh", { ageDays: 5 });
    const soldOut = await seedProduct(seller, "Flag Soldout", { stock: 0 });
    const oldSales = await seedProduct(seller, "Flag Oldsales");
    const unpaid = await seedProduct(seller, "Flag Unpaid");
    const cancelled = await seedProduct(seller, "Flag Cancelled");
    await seedProduct(seller, "Flag Draft", { status: "draft" });

    await sell(seller, hit.variantId, 2);
    await sell(seller, hit.variantId, 3);
    await sell(seller, steady.variantId, 1);
    await sell(seller, oldSales.variantId, 9, { paidDaysAgo: 40 });
    await sell(seller, unpaid.variantId, 9, { paidDaysAgo: null, status: "pending" });
    await sell(seller, cancelled.variantId, 9, { status: "cancelled" });

    // Someone else's catalog never leaks in.
    const theirs = await seedProduct(other, "Flag Theirs");
    await sell(other, theirs.variantId, 10);

    const res = await fetch(`${base}/api/products/sales-flags`, { headers: { "x-test-user": seller } });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, string>;
    expect(body).toEqual({
      [hit.productId]: "best_seller",
      [stale.productId]: "slow_mover",
      [oldSales.productId]: "slow_mover",
      [unpaid.productId]: "slow_mover",
      [cancelled.productId]: "slow_mover",
    });
    expect(body[fresh.productId]).toBeUndefined();
    expect(body[soldOut.productId]).toBeUndefined();
    expect(body[steady.productId]).toBeUndefined();
  });
});
