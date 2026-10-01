import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, products, productVariants, productStockRules } from "@workspace/db";

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

const suffix = crypto.randomBytes(5).toString("hex");
const seller = `pv-seller-${suffix}`;
const other = `pv-other-${suffix}`;
const productIds: string[] = [];
let server: Server;
let base = "";

async function call(path: string, user: string | null, method = "GET", body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(user ? { "x-test-user": user } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => ({}))) as any };
}

async function newProduct(owner: string, patch: Partial<typeof products.$inferInsert> = {}) {
  const [p] = await db.insert(products).values({ ownerId: owner, name: `Tee ${suffix}`, status: "active", ...patch }).returning();
  productIds.push(p.id);
  return p;
}
async function productStatus(id: string) {
  return (await db.select({ s: products.status }).from(products).where(eq(products.id, id)))[0].s;
}

beforeAll(async () => {
  const { default: variantsRouter } = await import("../product-variants");
  const { default: publicRouter } = await import("../catalog-public");
  const { default: inventoryRouter } = await import("../inventory");
  const app = express();
  app.use(express.json());
  app.use("/api/product-variants", variantsRouter);
  app.use("/api/inventory", inventoryRouter);
  app.use("/api/catalog-public", publicRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(products).where(inArray(products.id, productIds));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("axes + generate", () => {
  it("scopes by owner", async () => {
    const p = await newProduct(seller);
    expect((await call(`/api/product-variants/${p.id}`, other)).status).toBe(404);
    expect((await call(`/api/product-variants/${p.id}/axes`, other, "PUT", { axes: [{ name: "Size", values: ["S"] }] })).status).toBe(404);
    expect((await call(`/api/product-variants/${p.id}/generate`, other, "POST", { priceCents: 1000 })).status).toBe(404);
    expect((await call(`/api/product-variants/not-a-uuid`, seller)).status).toBe(404);
  });

  it("generates the size x colour x fit matrix once (idempotent) with unique SKUs", async () => {
    const p = await newProduct(seller);
    const axes = [{ name: "Size", values: ["S", "M"] }, { name: "Colour", values: ["Black", "White"] }, { name: "Fit", values: ["Slim", "Regular"] }];
    expect((await call(`/api/product-variants/${p.id}/axes`, seller, "PUT", { axes })).status).toBe(200);

    const first = await call(`/api/product-variants/${p.id}/generate`, seller, "POST", { priceCents: 3500, stock: 4, baseSku: `T${suffix}` });
    expect(first.status).toBe(201);
    expect(first.body.created).toBe(8);
    expect(first.body.variants).toHaveLength(8);
    const slim = first.body.variants.find((v: any) => v.size === "S" && v.color === "Black" && v.options.Fit === "Slim");
    expect(slim).toMatchObject({ priceCents: 3500, stock: 4 });
    expect(new Set(first.body.variants.map((v: any) => v.sku)).size).toBe(8);

    const again = await call(`/api/product-variants/${p.id}/generate`, seller, "POST", { priceCents: 3500 });
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(0);
    expect(again.body.variants).toHaveLength(8);

    // Adding a value only creates the new combos.
    await call(`/api/product-variants/${p.id}/axes`, seller, "PUT", { axes: [...axes.slice(0, 2), { name: "Fit", values: ["Slim", "Regular", "Relaxed"] }] });
    const grown = await call(`/api/product-variants/${p.id}/generate`, seller, "POST", { priceCents: 3500 });
    expect(grown.body.created).toBe(4);
    expect(grown.body.axes.map((a: any) => a.name)).toEqual(["Size", "Colour", "Fit"]);
  });

  it("avoids SKUs already used by another product (global unique)", async () => {
    const a = await newProduct(seller);
    const b = await newProduct(other);
    for (const p of [a, b]) {
      await call(`/api/product-variants/${p.id}/axes`, p.ownerId, "PUT", { axes: [{ name: "Size", values: ["S", "M"] }] });
    }
    const one = await call(`/api/product-variants/${a.id}/generate`, seller, "POST", { priceCents: 1000, baseSku: `CLASH${suffix}` });
    const two = await call(`/api/product-variants/${b.id}/generate`, other, "POST", { priceCents: 1000, baseSku: `CLASH${suffix}` });
    expect(one.status).toBe(201);
    expect(two.status).toBe(201);
    const skus = [...one.body.variants, ...two.body.variants].map((v: any) => v.sku);
    expect(new Set(skus).size).toBe(4);
  });

  it("refuses a matrix over the cap and a missing price", async () => {
    const p = await newProduct(seller);
    const vals = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i}`);
    const big = await call(`/api/product-variants/${p.id}/axes`, seller, "PUT", { axes: [{ name: "Size", values: vals(11, "s") }, { name: "Colour", values: vals(10, "c") }] });
    expect(big.status).toBe(422);
    await call(`/api/product-variants/${p.id}/axes`, seller, "PUT", { axes: [{ name: "Size", values: ["S"] }] });
    expect((await call(`/api/product-variants/${p.id}/generate`, seller, "POST", {})).status).toBe(400);
  });
});

describe("bulk update", () => {
  it("updates price/stock/SKU/threshold transactionally and rejects a SKU collision without partial writes", async () => {
    const p = await newProduct(seller);
    await call(`/api/product-variants/${p.id}/axes`, seller, "PUT", { axes: [{ name: "Size", values: ["S", "M"] }] });
    const gen = await call(`/api/product-variants/${p.id}/generate`, seller, "POST", { priceCents: 2000, stock: 5, baseSku: `B${suffix}` });
    const [v1, v2] = gen.body.variants;

    const ok = await call(`/api/product-variants/${p.id}/variants/bulk`, seller, "PATCH", {
      updates: [{ variantId: v1.id, priceCents: 2500, stock: 9, lowStockThreshold: 3 }, { variantId: v2.id, sku: `NEW-${suffix}` }],
    });
    expect(ok.status).toBe(200);
    const got1 = ok.body.variants.find((v: any) => v.id === v1.id);
    expect(got1).toMatchObject({ priceCents: 2500, stock: 9, lowStockThreshold: 3 });

    const clash = await call(`/api/product-variants/${p.id}/variants/bulk`, seller, "PATCH", {
      updates: [{ variantId: v1.id, stock: 1 }, { variantId: v2.id, sku: got1.sku }],
    });
    expect(clash.status).toBe(409);
    const after = await call(`/api/product-variants/${p.id}`, seller);
    expect(after.body.variants.find((v: any) => v.id === v1.id).stock).toBe(9);

    expect((await call(`/api/product-variants/${p.id}/variants/bulk`, seller, "PATCH", { updates: [{ variantId: v1.id, stock: -1 }] })).status).toBe(400);
    const foreign = await newProduct(other);
    expect((await call(`/api/product-variants/${foreign.id}/variants/bulk`, seller, "PATCH", { updates: [{ variantId: v1.id, stock: 1 }] })).status).toBe(404);
    expect((await call(`/api/product-variants/${p.id}/variants/bulk`, other, "PATCH", { updates: [{ variantId: v1.id, stock: 1 }] })).status).toBe(404);
  });
});

async function soldOutFlow(behavior: "hide" | "archive" | "show") {
  const p = await newProduct(seller);
  await call(`/api/product-variants/${p.id}/axes`, seller, "PUT", { axes: [{ name: "Size", values: ["S", "M"] }] });
  const gen = await call(`/api/product-variants/${p.id}/generate`, seller, "POST", { priceCents: 1000, stock: 2 });
  const rules = await call(`/api/product-variants/${p.id}/stock-rules`, seller, "PUT", { soldOutBehavior: behavior });
  expect(rules.status).toBe(200);
  return { p, variants: gen.body.variants as Array<{ id: string }> };
}

describe("auto sold-out", () => {
  it("hide: hides at zero total stock, restores on restock, public 404 meanwhile", async () => {
    const { p, variants } = await soldOutFlow("hide");
    await call(`/api/inventory/${variants[0].id}/adjust`, seller, "PATCH", { newStock: 0 });
    expect(await productStatus(p.id)).toBe("active"); // one variant still has stock
    await call(`/api/inventory/${variants[1].id}/adjust`, seller, "PATCH", { newStock: 0 });
    expect(await productStatus(p.id)).toBe("draft");
    expect((await call(`/api/catalog-public/products/${p.id}/stock-info`, null)).status).toBe(404);
    await call(`/api/inventory/${variants[1].id}/adjust`, seller, "PATCH", { delta: 3 });
    expect(await productStatus(p.id)).toBe("active");
    expect((await call(`/api/catalog-public/products/${p.id}/stock-info`, null)).status).toBe(200);
  });

  it("archive: archives at zero and does not restore on its own", async () => {
    const { p, variants } = await soldOutFlow("archive");
    await call(`/api/product-variants/${p.id}/variants/bulk`, seller, "PATCH", { updates: variants.map((v) => ({ variantId: v.id, stock: 0 })) });
    expect(await productStatus(p.id)).toBe("archived");
    await call(`/api/inventory/${variants[0].id}/adjust`, seller, "PATCH", { delta: 3 });
    expect(await productStatus(p.id)).toBe("archived");
  });

  it("show: stays listed and reports soldOut", async () => {
    const { p, variants } = await soldOutFlow("show");
    await call(`/api/product-variants/${p.id}/variants/bulk`, seller, "PATCH", { updates: variants.map((v) => ({ variantId: v.id, stock: 0 })) });
    expect(await productStatus(p.id)).toBe("active");
    const info = await call(`/api/catalog-public/products/${p.id}/stock-info`, null);
    expect(info.body).toMatchObject({ soldOut: true, remaining: null });
  });

  it("never hides pre-order products", async () => {
    const p = await newProduct(seller, { isPreOrder: true });
    await call(`/api/product-variants/${p.id}/axes`, seller, "PUT", { axes: [{ name: "Size", values: ["S"] }] });
    const gen = await call(`/api/product-variants/${p.id}/generate`, seller, "POST", { priceCents: 1000, stock: 1 });
    await call(`/api/product-variants/${p.id}/stock-rules`, seller, "PUT", { soldOutBehavior: "hide" });
    await call(`/api/inventory/${gen.body.variants[0].id}/adjust`, seller, "PATCH", { newStock: 0 });
    expect(await productStatus(p.id)).toBe("active");
  });

  it("applies when an order reserves the last unit (order path)", async () => {
    const { reserveStockForOrder } = await import("../../lib/stockReservation");
    const { flushQueuedStockChanges, setStockChangeDelayMs } = await import("../../lib/stockRules");
    setStockChangeDelayMs(60_000);
    const { p, variants } = await soldOutFlow("hide");
    const result = await db.transaction((tx) => reserveStockForOrder(tx as any, variants.map((v) => ({ variantId: v.id, quantity: 2 }))));
    expect(result.ok).toBe(true);
    await flushQueuedStockChanges();
    expect(await productStatus(p.id)).toBe("draft");
    const [rule] = await db.select().from(productStockRules).where(eq(productStockRules.productId, p.id));
    expect(rule.autoHiddenAt).not.toBeNull();
  });

  it("switching a hidden product back to 'show' restores it", async () => {
    const { p, variants } = await soldOutFlow("hide");
    await call(`/api/product-variants/${p.id}/variants/bulk`, seller, "PATCH", { updates: variants.map((v) => ({ variantId: v.id, stock: 0 })) });
    expect(await productStatus(p.id)).toBe("draft");
    await call(`/api/product-variants/${p.id}/stock-rules`, seller, "PUT", { soldOutBehavior: "show" });
    expect(await productStatus(p.id)).toBe("active");
  });
});

describe("public stock-info privacy", () => {
  it("exposes only soldOut/limited/editionSize/remaining, and remaining only when meant to be public", async () => {
    const p = await newProduct(seller);
    await call(`/api/product-variants/${p.id}/axes`, seller, "PUT", { axes: [{ name: "Size", values: ["S"] }] });
    await call(`/api/product-variants/${p.id}/generate`, seller, "POST", { priceCents: 1000, stock: 12 });

    const plain = await call(`/api/catalog-public/products/${p.id}/stock-info`, null);
    expect(Object.keys(plain.body).sort()).toEqual(["editionSize", "limited", "remaining", "soldOut"]);
    expect(plain.body).toEqual({ soldOut: false, limited: false, editionSize: null, remaining: null });

    await call(`/api/product-variants/${p.id}/stock-rules`, seller, "PUT", { showRemainingCounter: true, counterThreshold: 5 });
    expect((await call(`/api/catalog-public/products/${p.id}/stock-info`, null)).body.remaining).toBeNull(); // 12 > 5

    await call(`/api/product-variants/${p.id}/stock-rules`, seller, "PUT", { limitedQuantityEnabled: true, limitedQuantityTotal: 50 });
    expect((await call(`/api/catalog-public/products/${p.id}/stock-info`, null)).body).toEqual({ soldOut: false, limited: true, editionSize: 50, remaining: 12 });

    const draft = await newProduct(seller, { status: "draft" });
    expect((await call(`/api/catalog-public/products/${draft.id}/stock-info`, null)).status).toBe(404);
    expect((await call(`/api/catalog-public/products/${crypto.randomUUID()}/stock-info`, null)).status).toBe(404);
  });

  it("rejects invalid stock rules and scopes rule writes to the owner", async () => {
    const p = await newProduct(seller);
    expect((await call(`/api/product-variants/${p.id}/stock-rules`, seller, "PUT", { soldOutBehavior: "nuke" })).status).toBe(400);
    expect((await call(`/api/product-variants/${p.id}/stock-rules`, seller, "PUT", { limitedQuantityEnabled: true })).status).toBe(400);
    expect((await call(`/api/product-variants/${p.id}/stock-rules`, other, "PUT", { soldOutBehavior: "hide" })).status).toBe(404);
    expect((await call(`/api/product-variants/${p.id}/stock-rules`, other)).status).toBe(404);
  });
});
