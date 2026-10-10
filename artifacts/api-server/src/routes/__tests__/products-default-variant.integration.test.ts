/**
 * BT-205: a product listed without size/colour options gets one default
 * variant priced from the product, so buyers can add it to the bag.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
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
vi.mock("../../lib/planAccess", () => ({
  getVerifiedPlanAccess: async () => ({ planId: "growth", limits: { products: null } }),
  sendPlanLimitReached: vi.fn(),
  sendPlanLookupUnavailable: vi.fn(),
}));

const suffix = crypto.randomBytes(5).toString("hex");
const sellerA = `dv-seller-a-${suffix}`;
const sellerB = `dv-seller-b-${suffix}`;
let server: Server;
let base = "";

async function create(user: string, body: Record<string, unknown>) {
  const res = await fetch(`${base}/api/products`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-user": user },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

async function update(user: string, id: string, body: Record<string, unknown>) {
  const res = await fetch(`${base}/api/products/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-test-user": user },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

async function variantsOf(productId: string) {
  return db.select().from(productVariants).where(eq(productVariants.productId, productId));
}

beforeAll(async () => {
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
  const rows = await db.select({ id: products.id }).from(products).where(inArray(products.ownerId, [sellerA, sellerB]));
  if (rows.length) await db.delete(products).where(inArray(products.id, rows.map((r) => r.id)));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /api/products without options (BT-205)", () => {
  it("creates one default variant with the product's price and stock", async () => {
    const res = await create(sellerA, { name: "Canvas Tote", status: "active", priceCents: 4_200, stock: 7, compareAtPriceCents: 5_000 });
    expect(res.status).toBe(201);
    const variants = await variantsOf(res.body.id);
    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({ priceCents: 4_200, stock: 7, compareAtPriceCents: 5_000, size: null, color: null });
  });

  it("two sellers with the same product name never collide on SKU", async () => {
    const a = await create(sellerA, { name: "Logo Tee", status: "active", priceCents: 3_000 });
    const b = await create(sellerB, { name: "Logo Tee", status: "active", priceCents: 3_000 });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const [va] = await variantsOf(a.body.id);
    const [vb] = await variantsOf(b.body.id);
    expect(va.sku).not.toBe(vb.sku);
  });

  it("leaves listed variants alone and still saves a draft with no price", async () => {
    const withOptions = await create(sellerA, {
      name: "Hoodie", status: "active", priceCents: 9_999,
      variants: [{ size: "M", sku: `HOODIE-M-${suffix}`, priceCents: 6_500, stock: 3 }],
    });
    expect((await variantsOf(withOptions.body.id)).map((v) => v.priceCents)).toEqual([6_500]);

    const draft = await create(sellerA, { name: "Idea", status: "draft" });
    expect(draft.status).toBe(201);
    expect(await variantsOf(draft.body.id)).toHaveLength(0);
  });

  it("rejects an invalid product price before writing anything", async () => {
    const res = await create(sellerA, { name: "Bad", status: "active", priceCents: -5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("priceCents");
  });
});

describe("PUT /api/products/:id on a simple product with no variant (BT-205)", () => {
  it("adds the missing default variant once, and never touches existing ones", async () => {
    const [legacy] = await db.insert(products).values({ ownerId: sellerA, name: "Old Print", status: "active" }).returning();
    expect((await update(sellerA, legacy.id, { priceCents: 2_500, stock: 4 })).status).toBe(200);
    expect((await update(sellerA, legacy.id, { priceCents: 9_900, stock: 1 })).status).toBe(200);
    const variants = await variantsOf(legacy.id);
    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({ priceCents: 2_500, stock: 4 });
    expect(variants[0].sku).toMatch(/^OLD-PRINT-/);
  });
});
