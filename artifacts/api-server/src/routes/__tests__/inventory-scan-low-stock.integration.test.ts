/**
 * Store-wide low-stock level (variant → product default → store default → 5)
 * and the inventory scanner's barcode / SKU lookup.
 *
 *   GET/PUT /api/inventory/settings
 *   GET     /api/inventory/lookup?code=
 *   PATCH   /api/inventory/:variantId/adjust          (alert crossing with the store level)
 *   PUT     /api/product-variants/:id/stock-rules     (product default in the chain)
 *   PATCH   /api/product-variants/:id/variants/bulk   (own level + barcode)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, notificationsFeed, productStockRules, productVariants, products, sellerInventorySettings, users,
} from "@workspace/db";

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

const sfx = crypto.randomBytes(5).toString("hex");
const SELLER = `inv-scan-${sfx}-seller`;
const OTHER = `inv-scan-${sfx}-other`;
const productIds: string[] = [];
let server: Server;
let base = "";
const realFetch = globalThis.fetch;

async function call(method: string, path: string, as: string, body?: unknown) {
  const r = await realFetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-test-user": as },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as any };
}

async function makeProduct(owner: string, name: string, opts: { deleted?: boolean } = {}) {
  const [p] = await db.insert(products).values({
    ownerId: owner, name: `${name} ${sfx}`, status: "active", ...(opts.deleted ? { deletedAt: new Date() } : {}),
  }).returning({ id: products.id });
  productIds.push(p.id);
  return p.id;
}

async function makeVariant(productId: string, sku: string, values: { stock?: number; lowStockThreshold?: number; barcode?: string } = {}) {
  const [v] = await db.insert(productVariants).values({
    productId, sku: `${sku}-${sfx}`, priceCents: 2500, stock: values.stock ?? 20,
    ...(values.lowStockThreshold !== undefined && { lowStockThreshold: values.lowStockThreshold }),
    ...(values.barcode !== undefined && { barcode: values.barcode }),
  }).returning();
  return v;
}

async function level(variantId: string) {
  const [v] = await db.select({ level: productVariants.lowStockThreshold, inherit: productVariants.lowStockThresholdInherit })
    .from(productVariants).where(eq(productVariants.id, variantId));
  return v;
}

beforeAll(async () => {
  // Push delivery is never exercised for real: the seller has no device tokens,
  // and anything that isn't the loopback server fails loudly.
  vi.stubGlobal("fetch", async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://exp.host/")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
    if (!url.startsWith("http://127.0.0.1")) throw new Error(`Unexpected network call: ${url}`);
    return realFetch(input, init);
  });
  await db.insert(users).values([SELLER, OTHER].map((clerkId) => ({
    clerkId, email: `${clerkId}@test.local`, name: clerkId, username: clerkId.replace(/[^a-z0-9]/gi, "").slice(0, 28),
    role: "seller", accountType: "seller",
  })));

  const { default: inventoryRouter } = await import("../inventory");
  const { default: variantsRouter } = await import("../product-variants");
  const app = express();
  app.use(express.json());
  app.use("/api/inventory", inventoryRouter);
  app.use("/api/product-variants", variantsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, [SELLER, OTHER]));
  await db.delete(productVariants).where(inArray(productVariants.productId, productIds));
  await db.delete(productStockRules).where(inArray(productStockRules.productId, productIds));
  await db.delete(products).where(inArray(products.id, productIds));
  await db.delete(sellerInventorySettings).where(inArray(sellerInventorySettings.sellerId, [SELLER, OTHER]));
  await db.delete(users).where(inArray(users.clerkId, [SELLER, OTHER]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("store-wide low stock level", () => {
  let tee: string; let teeInherit: string; let teeOwn: string;
  let cap: string; let capInherit: string;

  it("defaults to 5 before the seller sets one", async () => {
    const r = await call("GET", "/api/inventory/settings", SELLER);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ lowStockThresholdDefault: 5, isCustom: false, platformDefault: 5 });

    tee = await makeProduct(SELLER, "Tee");
    teeInherit = (await makeVariant(tee, "TEE-M")).id;
    teeOwn = (await makeVariant(tee, "TEE-L", { lowStockThreshold: 9 })).id;
    expect(await level(teeInherit)).toEqual({ level: 5, inherit: true });
    expect(await level(teeOwn)).toEqual({ level: 9, inherit: false });

    cap = await makeProduct(SELLER, "Cap");
    await db.insert(productStockRules).values({ productId: cap, lowStockThresholdDefault: 2 });
    capInherit = (await makeVariant(cap, "CAP-OS")).id;
    expect(await level(capInherit)).toEqual({ level: 2, inherit: true });
  });

  it("rejects a level that isn't a whole number of 0 or more", async () => {
    for (const bad of [-1, 2.5, "7", null]) {
      const r = await call("PUT", "/api/inventory/settings", SELLER, { lowStockThresholdDefault: bad });
      expect(r.status).toBe(400);
    }
  });

  it("applies to variants without their own level whose product has no default", async () => {
    const r = await call("PUT", "/api/inventory/settings", SELLER, { lowStockThresholdDefault: 7 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ lowStockThresholdDefault: 7, isCustom: true });
    expect(await level(teeInherit)).toEqual({ level: 7, inherit: true });
    expect(await level(teeOwn)).toEqual({ level: 9, inherit: false });   // own level wins
    expect(await level(capInherit)).toEqual({ level: 2, inherit: true }); // product default wins
    // New variants pick it up on insert.
    expect(await level((await makeVariant(tee, "TEE-S")).id)).toEqual({ level: 7, inherit: true });
    // Another seller is untouched.
    expect((await call("GET", "/api/inventory/settings", OTHER)).body.lowStockThresholdDefault).toBe(5);
  });

  it("follows the product default while one is set, and the store level when it is cleared", async () => {
    const set = await call("PUT", `/api/product-variants/${tee}/stock-rules`, SELLER, { lowStockThresholdDefault: 3, soldOutBehavior: "show" });
    expect(set.status).toBe(200);
    expect(set.body.storeLowStockThreshold).toBe(7);
    expect(await level(teeInherit)).toEqual({ level: 3, inherit: true });
    expect(await level(teeOwn)).toEqual({ level: 9, inherit: false });

    await call("PUT", `/api/product-variants/${tee}/stock-rules`, SELLER, { lowStockThresholdDefault: null, soldOutBehavior: "show" });
    expect(await level(teeInherit)).toEqual({ level: 7, inherit: true });
  });

  it("a level typed on the variant becomes its own and stops following the store level", async () => {
    const r = await call("PATCH", `/api/product-variants/${tee}/variants/bulk`, SELLER, { updates: [{ variantId: teeInherit, lowStockThreshold: 4 }] });
    expect(r.status).toBe(200);
    expect(await level(teeInherit)).toEqual({ level: 4, inherit: false });
    await call("PUT", "/api/inventory/settings", SELLER, { lowStockThresholdDefault: 6 });
    expect(await level(teeInherit)).toEqual({ level: 4, inherit: false });
  });

  it("applyToExisting makes variants with their own level follow the store level again", async () => {
    const r = await call("PUT", "/api/inventory/settings", SELLER, { lowStockThresholdDefault: 7, applyToExisting: true });
    expect(r.status).toBe(200);
    expect(await level(teeInherit)).toEqual({ level: 7, inherit: true });
    expect(await level(teeOwn)).toEqual({ level: 7, inherit: true });
    expect(await level(capInherit)).toEqual({ level: 2, inherit: true }); // the product's own default still wins
  });

  it("alerts once when stock crosses into the store level, and lists the variant in the summary", async () => {
    const hoodie = await makeProduct(SELLER, "Hoodie");
    const v = await makeVariant(hoodie, "HOOD-M", { stock: 9 });
    expect(await level(v.id)).toEqual({ level: 7, inherit: true });

    const feedRows = () => db.select().from(notificationsFeed)
      .where(and(eq(notificationsFeed.userId, SELLER), eq(notificationsFeed.type, "low_stock"), eq(notificationsFeed.targetId, hoodie)));

    // 9 → 8: still above 7, no alert.
    expect((await call("PATCH", `/api/inventory/${v.id}/adjust`, SELLER, { delta: -1 })).body.status).toBe("in_stock");
    await new Promise((r) => setTimeout(r, 300));
    expect(await feedRows()).toHaveLength(0);

    // 8 → 7: crosses into low at the store level.
    const low = await call("PATCH", `/api/inventory/${v.id}/adjust`, SELLER, { delta: -1 });
    expect(low.body.status).toBe("low_stock");
    for (let i = 0; i < 20 && (await feedRows()).length === 0; i++) await new Promise((r) => setTimeout(r, 100));
    const rows = await feedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Low stock alert");

    const summary = await call("GET", "/api/inventory/settings", SELLER);
    expect(summary.body.lowStock.map((x: any) => x.variantId)).toContain(v.id);
    expect(summary.body.lowStock.find((x: any) => x.variantId === v.id)).toMatchObject({ stock: 7, lowStockThreshold: 7, status: "low_stock" });
  });
});

describe("GET /api/inventory/lookup", () => {
  let jacket: string; let jacketVariant: string;

  beforeAll(async () => {
    jacket = await makeProduct(SELLER, "Jacket");
    jacketVariant = (await makeVariant(jacket, "JKT-BLK-M")).id;
    const gone = await makeProduct(SELLER, "Deleted", { deleted: true });
    await makeVariant(gone, "GONE-1", { barcode: `9${sfx}` });
    const theirs = await makeProduct(OTHER, "Theirs");
    await makeVariant(theirs, "THEIRS-1", { barcode: "036000291452" });
  });

  it("saves a barcode from the variant editor", async () => {
    const r = await call("PATCH", `/api/product-variants/${jacket}/variants/bulk`, SELLER, { updates: [{ variantId: jacketVariant, barcode: " 036000291452 " }] });
    expect(r.status).toBe(200);
    expect(r.body.variants.find((v: any) => v.id === jacketVariant).barcode).toBe("036000291452");
    const bad = await call("PATCH", `/api/product-variants/${jacket}/variants/bulk`, SELLER, { updates: [{ variantId: jacketVariant, barcode: "has space" }] });
    expect(bad.status).toBe(400);
  });

  it("matches the seller's barcode, including the EAN-13 form of a UPC-A", async () => {
    for (const code of ["036000291452", "0036000291452"]) {
      const r = await call("GET", `/api/inventory/lookup?code=${code}`, SELLER);
      expect(r.status).toBe(200);
      expect(r.body.matches).toHaveLength(1); // the other seller's identical barcode is not visible
      expect(r.body.matches[0]).toMatchObject({ variantId: jacketVariant, matchedOn: "barcode", stock: 20, status: "in_stock" });
    }
  });

  it("matches a SKU ignoring case", async () => {
    const r = await call("GET", `/api/inventory/lookup?code=${encodeURIComponent(`jkt-blk-m-${sfx}`)}`, SELLER);
    expect(r.body.matches.map((m: any) => m.variantId)).toEqual([jacketVariant]);
    expect(r.body.matches[0].matchedOn).toBe("sku");
  });

  it("returns no match for unknown codes and deleted products", async () => {
    expect((await call("GET", "/api/inventory/lookup?code=000000000000", SELLER)).body.matches).toEqual([]);
    expect((await call("GET", `/api/inventory/lookup?code=9${sfx}`, SELLER)).body.matches).toEqual([]);
  });

  it("rejects an empty or oversized code", async () => {
    expect((await call("GET", "/api/inventory/lookup?code=", SELLER)).status).toBe(400);
    expect((await call("GET", "/api/inventory/lookup", SELLER)).status).toBe(400);
    expect((await call("GET", `/api/inventory/lookup?code=${"1".repeat(65)}`, SELLER)).status).toBe(400);
  });
});
