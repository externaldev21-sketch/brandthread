/**
 * GET /api/products (the seller's own catalog, read by the mobile Products tab)
 * returns a real per-row price (min variant price) and only the caller's rows.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { inArray } from "drizzle-orm";
import { db, productVariants, products } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.header("x-test-user");
    next();
  },
}));
vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `plist-seller-${suffix}`;
const otherId = `plist-other-${suffix}`;
let server: Server;
let base = "";
const productIds: string[] = [];

beforeAll(async () => {
  const [mine] = await db.insert(products).values({ ownerId: sellerId, name: "Mine", status: "active" }).returning();
  const [draft] = await db.insert(products).values({ ownerId: sellerId, name: "Draft", status: "draft" }).returning();
  const [theirs] = await db.insert(products).values({ ownerId: otherId, name: "Theirs", status: "active" }).returning();
  productIds.push(mine.id, draft.id, theirs.id);
  await db.insert(productVariants).values([
    { productId: mine.id, sku: `pl-${suffix}-1`, priceCents: 5000, stock: 2 },
    { productId: mine.id, sku: `pl-${suffix}-2`, priceCents: 4200, stock: 3 },
  ]);

  const { default: productsRouter } = await import("../products");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  app.use("/api/products", productsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (productIds.length) {
    await db.delete(productVariants).where(inArray(productVariants.productId, productIds));
    await db.delete(products).where(inArray(products.id, productIds));
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/products", () => {
  it("lists the caller's products (drafts included) with minPriceCents and stock", async () => {
    const res = await fetch(`${base}/api/products`, { headers: { "x-test-user": sellerId } });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ id: string; name: string; minPriceCents: number | null; totalStock: number }>;
    expect(rows.map((r) => r.name).sort()).toEqual(["Draft", "Mine"]);
    const mine = rows.find((r) => r.name === "Mine")!;
    expect(mine.minPriceCents).toBe(4200);
    expect(mine.totalStock).toBe(5);
    expect(rows.find((r) => r.name === "Draft")!.minPriceCents).toBeNull();
  });

  it("GET /api/products/:id works for the owner and 404s for anyone else", async () => {
    const id = productIds[0];
    const own = await fetch(`${base}/api/products/${id}`, { headers: { "x-test-user": sellerId } });
    expect(own.status).toBe(200);
    expect(((await own.json()) as { variants: unknown[] }).variants).toHaveLength(2);
    const other = await fetch(`${base}/api/products/${id}`, { headers: { "x-test-user": otherId } });
    expect(other.status).toBe(404);
  });
});
