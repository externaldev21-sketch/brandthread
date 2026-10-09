/**
 * GET /api/buyer/cart — each stored line keeps its snapshot shape and gains
 * `live` (current price / stock / availability) from the catalog, so a
 * seller's price edit or sell-out reaches the buyer's bag before checkout.
 * POST /sync never persists `live`, and overlapping syncs never interleave.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, users, products, productVariants, cartItems, sales, productSales } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const sfx = crypto.randomBytes(5).toString("hex");
const SELLER = `cartlive-seller-${sfx}`;
const BUYER = `cartlive-buyer-${sfx}`;
const OTHER = `cartlive-other-${sfx}`;

const authState = vi.hoisted(() => ({ clerkUserId: null as string | null }));
vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: authState.clerkUserId }) }));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!authState.clerkUserId) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = authState.clerkUserId;
    next();
  },
}));

let server: Server;
let base = "";
const ids = {
  active: "", activeVar: "", lowVar: "",
  soldOut: "", soldOutVar: "",
  draft: "", draftVar: "",
  deleted: "", deletedVar: "",
  noVariants: "",
  onSale: "", onSaleVar: "",
};

const call = (method: string, path: string, body?: unknown, as: string | null = BUYER) => {
  authState.clerkUserId = as;
  return fetch(`${base}${path}`, {
    method, headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
};
const line = (productId: string, variantId: string, priceCents: number, extra: Record<string, unknown> = {}) => ({
  id: `line-${variantId.slice(0, 8)}`, productId, variantId, productName: "Tee", priceCents, quantity: 1,
  maxQuantity: 99, isAvailable: true, sellerId: SELLER, ...extra,
});

beforeAll(async () => {
  await db.insert(users).values([SELLER, BUYER, OTHER].map((id) => ({
    clerkId: id, email: `${id}@test.local`, name: id,
    role: id === SELLER ? "seller" : "buyer", accountType: id === SELLER ? "seller" : "buyer",
  })));
  const mk = async (name: string, extra: Partial<typeof products.$inferInsert> = {}) =>
    (await db.insert(products).values({ ownerId: SELLER, name, status: "active", ...extra }).returning())[0].id;
  const mv = async (productId: string, tag: string, priceCents: number, stock: number) =>
    (await db.insert(productVariants).values({ productId, sku: `CL-${tag}-${sfx}`, priceCents, stock }).returning())[0].id;

  ids.active = await mk("Active Tee");
  ids.activeVar = await mv(ids.active, "A", 2500, 8);
  ids.lowVar = await mv(ids.active, "L", 2700, 1);
  ids.soldOut = await mk("Sold Out Tee");
  ids.soldOutVar = await mv(ids.soldOut, "S", 3000, 0);
  ids.draft = await mk("Draft Tee", { status: "draft" });
  ids.draftVar = await mv(ids.draft, "D", 3000, 5);
  ids.deleted = await mk("Deleted Tee", { deletedAt: new Date() });
  ids.deletedVar = await mv(ids.deleted, "X", 3000, 5);
  ids.noVariants = await mk("No Variant Tee");
  ids.onSale = await mk("Sale Tee");
  ids.onSaleVar = await mv(ids.onSale, "O", 4000, 3);
  const [sale] = await db.insert(sales).values({
    sellerId: SELLER, name: "Half off", discountType: "percent", value: 50, scope: "products",
    startsAt: new Date(Date.now() - 60_000), active: true,
  }).returning();
  await db.insert(productSales).values({ saleId: sale.id, productId: ids.onSale });

  const app = express();
  app.use(express.json() as any);
  const { default: cartDb } = await import("../cart-db");
  app.use("/api/buyer/cart", cartDb);
  await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(cartItems).where(inArray(cartItems.userId, [BUYER, OTHER]));
  await db.delete(sales).where(eq(sales.sellerId, SELLER));
  await db.delete(products).where(eq(products.ownerId, SELLER));
  await db.delete(users).where(inArray(users.clerkId, [SELLER, BUYER, OTHER]));
  await new Promise<void>((r) => server.close(() => r()));
});

describe("GET /api/buyer/cart live fields", () => {
  it("rejects signed-out callers", async () => {
    expect((await call("GET", "/api/buyer/cart", undefined, null)).status).toBe(401);
  });

  it("adds live price/stock/availability to every line and keeps the stored shape", async () => {
    const items = [
      line(ids.active, ids.activeVar, 2500, { variantTitle: "M" }),
      line(ids.active, ids.lowVar, 2000), // seller raised the price since add-to-cart
      line(ids.soldOut, ids.soldOutVar, 3000),
      line(ids.draft, ids.draftVar, 3000),
      line(ids.deleted, ids.deletedVar, 3000),
      line(ids.noVariants, crypto.randomUUID(), 1500),
      line(ids.active, "not-a-uuid", 2100), // product-level line: falls back to the product's variants
      line(ids.onSale, ids.onSaleVar, 4000),
    ];
    const saved = [line(ids.soldOut, ids.soldOutVar, 3000, { id: "saved-1", savedAt: "2026-01-01" })];
    expect((await call("POST", "/api/buyer/cart/sync", { items, savedItems: saved })).status).toBe(200);

    const r = await call("GET", "/api/buyer/cart");
    expect(r.status).toBe(200);
    const body = await r.json() as any;
    expect(body.items).toHaveLength(items.length);
    const byVar = (v: string) => body.items.find((i: any) => i.variantId === v);

    expect(byVar(ids.activeVar)).toMatchObject({ variantTitle: "M", priceCents: 2500, quantity: 1 });
    expect(byVar(ids.activeVar).live).toEqual({ priceCents: 2500, compareAtPriceCents: null, stock: 8, available: true, reason: null, priceChanged: false });
    expect(byVar(ids.lowVar).live).toMatchObject({ priceCents: 2700, stock: 1, available: true, priceChanged: true });
    expect(byVar(ids.soldOutVar).live).toMatchObject({ stock: 0, available: false, reason: "out_of_stock" });
    expect(byVar(ids.draftVar).live).toMatchObject({ available: false, reason: "unavailable", stock: 0 });
    expect(byVar(ids.deletedVar).live).toMatchObject({ available: false, reason: "unavailable", stock: 0 });
    expect(body.items.find((i: any) => i.productId === ids.noVariants).live).toMatchObject({ available: false, reason: "unavailable" });
    expect(byVar("not-a-uuid").live).toMatchObject({ priceCents: 2500, stock: 9, available: true, priceChanged: true });
    // Live price is the charged price: the automatic sale applies.
    expect(byVar(ids.onSaleVar).live).toMatchObject({ priceCents: 2000, compareAtPriceCents: 4000, available: true, priceChanged: true });

    expect(body.savedItems).toHaveLength(1);
    expect(body.savedItems[0]).toMatchObject({ id: "saved-1", savedAt: "2026-01-01" });
    expect(body.savedItems[0].live).toMatchObject({ available: false, reason: "out_of_stock" });
  });

  it("reflects a seller's stock and price edit on the next read", async () => {
    await call("POST", "/api/buyer/cart/sync", { items: [line(ids.active, ids.activeVar, 2500)] });
    await db.update(productVariants).set({ stock: 0, priceCents: 2900 }).where(eq(productVariants.id, ids.activeVar));
    const body = await (await call("GET", "/api/buyer/cart")).json() as any;
    expect(body.items[0].live).toMatchObject({ priceCents: 2900, stock: 0, available: false, reason: "out_of_stock", priceChanged: true });
    await db.update(productVariants).set({ stock: 4 }).where(eq(productVariants.id, ids.activeVar));
    const after = await (await call("GET", "/api/buyer/cart")).json() as any;
    expect(after.items[0].live).toMatchObject({ stock: 4, available: true, reason: null });
    await db.update(productVariants).set({ stock: 8, priceCents: 2500 }).where(eq(productVariants.id, ids.activeVar));
  });

  it("never stores `live` from a client payload", async () => {
    const tampered = { ...line(ids.active, ids.activeVar, 2500), live: { available: true, stock: 999 } };
    await call("POST", "/api/buyer/cart/sync", { items: [tampered] });
    const [row] = await db.select().from(cartItems).where(eq(cartItems.userId, BUYER));
    expect((row.itemData as any).live).toBeUndefined();
  });

  it("returns an empty bag for a buyer with no lines, and only the caller's lines", async () => {
    const body = await (await call("GET", "/api/buyer/cart", undefined, OTHER)).json() as any;
    expect(body).toEqual({ items: [], savedItems: [] });
  });

  it("overlapping full-replace syncs never interleave into duplicates", async () => {
    const a = { items: [line(ids.active, ids.activeVar, 2500), line(ids.active, ids.lowVar, 2700)] };
    const b = { items: [line(ids.soldOut, ids.soldOutVar, 3000)] };
    await Promise.all(Array.from({ length: 6 }, (_, i) => call("POST", "/api/buyer/cart/sync", i % 2 ? a : b)));
    const rows = await db.select().from(cartItems).where(eq(cartItems.userId, BUYER));
    expect([1, 2]).toContain(rows.length);
    expect(new Set(rows.map((r) => r.variantId)).size).toBe(rows.length);
  });
});
