import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, products, productVariants, productPairings } from "@workspace/db";

const auth = vi.hoisted(() => ({ userId: "", role: "manager" as "manager" | "staff" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = auth.userId;
    next();
  },
}));
vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: any, _res: any, next: () => void) => next(),
  requireRole: () => (_req: any, res: any, next: () => void) => {
    if (auth.role === "staff") { res.status(403).json({ error: "Forbidden" }); return; }
    next();
  },
}));

let server: Server;
let base = "";
const prefix = `pairing-${crypto.randomBytes(6).toString("hex")}`;
const seller = `${prefix}-seller`;
const otherSeller = `${prefix}-other`;
const created: string[] = [];

async function request(path: string, method = "GET", body?: unknown) {
  return fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function makeProduct(ownerId: string, opts: { status?: string; deleted?: boolean; stock?: number; price?: number; name?: string; category?: string; preOrder?: boolean } = {}) {
  const [p] = await db.insert(products).values({
    ownerId,
    name: opts.name ?? `P-${crypto.randomBytes(3).toString("hex")}`,
    ...(opts.category ? { category: opts.category } : {}),
    isPreOrder: opts.preOrder ?? false,
    status: opts.status ?? "active",
    deletedAt: opts.deleted ? new Date() : null,
    images: ["https://example.test/a.jpg"],
  }).returning();
  created.push(p.id);
  await db.insert(productVariants).values({
    productId: p.id, sku: `${prefix}-${crypto.randomBytes(4).toString("hex")}`,
    priceCents: opts.price ?? 5000, stock: opts.stock ?? 3, size: "M",
  });
  return p.id;
}

beforeAll(async () => {
  const { default: router } = await import("../product-pairings");
  const app = express();
  app.use((req, _res, next) => { (req as any).log = { error: () => undefined, warn: () => undefined }; next(); });
  app.use(express.json());
  app.use("/api/product-pairings", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => { auth.userId = ""; auth.role = "manager"; });

afterAll(async () => {
  if (created.length) await db.delete(products).where(inArray(products.id, created));
  await new Promise<void>((resolve, reject) => { server.close((e) => e ? reject(e) : resolve()); });
});

describe("product pairings", () => {
  it("saves an ordered list and supports reorder", async () => {
    auth.userId = seller;
    const main = await makeProduct(seller);
    const a = await makeProduct(seller, { name: "A" });
    const b = await makeProduct(seller, { name: "B" });
    const c = await makeProduct(seller, { name: "C" });

    let res = await request(`/api/product-pairings/${main}`, "PUT", { pairedProductIds: [a, b, c] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).pairings.map((p: any) => p.name)).toEqual(["A", "B", "C"]);

    res = await request(`/api/product-pairings/${main}`, "PUT", { pairedProductIds: [c, a] });
    expect(((await res.json()) as any).pairings.map((p: any) => p.name)).toEqual(["C", "A"]);

    res = await request(`/api/product-pairings/${main}`);
    expect(((await res.json()) as any).pairings.map((p: any) => p.name)).toEqual(["C", "A"]);
  });

  it("rejects self pairing, duplicates, over-cap and bad bodies", async () => {
    auth.userId = seller;
    const main = await makeProduct(seller);
    expect((await request(`/api/product-pairings/${main}`, "PUT", { pairedProductIds: [main] })).status).toBe(400);
    const a = await makeProduct(seller);
    expect((await request(`/api/product-pairings/${main}`, "PUT", { pairedProductIds: [a, a] })).status).toBe(400);
    expect((await request(`/api/product-pairings/${main}`, "PUT", { pairedProductIds: "nope" })).status).toBe(400);
    expect((await request(`/api/product-pairings/${main}`, "PUT", { pairedProductIds: ["x"] })).status).toBe(400);
    const seven: string[] = [];
    for (let i = 0; i < 7; i++) seven.push(await makeProduct(seller));
    const over = await request(`/api/product-pairings/${main}`, "PUT", { pairedProductIds: seven });
    expect(over.status).toBe(400);
    expect(((await over.json()) as any).code).toBe("pairing_cap");
    const six = await request(`/api/product-pairings/${main}`, "PUT", { pairedProductIds: seven.slice(0, 6) });
    expect(six.status).toBe(200);
  });

  it("enforces same-owner, ownership of the main product, and active-only additions", async () => {
    const main = await makeProduct(seller);
    const theirs = await makeProduct(otherSeller);
    const archived = await makeProduct(seller, { status: "archived" });
    const deleted = await makeProduct(seller, { deleted: true });

    auth.userId = seller;
    expect((await request(`/api/product-pairings/${main}`, "PUT", { pairedProductIds: [theirs] })).status).toBe(404);
    expect((await request(`/api/product-pairings/${main}`, "PUT", { pairedProductIds: [archived] })).status).toBe(400);
    expect((await request(`/api/product-pairings/${main}`, "PUT", { pairedProductIds: [deleted] })).status).toBe(400);

    auth.userId = otherSeller;
    expect((await request(`/api/product-pairings/${main}`)).status).toBe(404);
    expect((await request(`/api/product-pairings/${main}`, "PUT", { pairedProductIds: [theirs] })).status).toBe(404);
  });

  it("requires auth and manager role for writes", async () => {
    const main = await makeProduct(seller);
    const a = await makeProduct(seller);
    expect((await request(`/api/product-pairings/${main}`)).status).toBe(401);
    auth.userId = seller;
    auth.role = "staff";
    expect((await request(`/api/product-pairings/${main}`, "PUT", { pairedProductIds: [a] })).status).toBe(403);
    expect((await request(`/api/product-pairings/${main}`)).status).toBe(200);
  });

  it("public endpoint hides inactive/deleted pairings and needs no auth", async () => {
    auth.userId = seller;
    const main = await makeProduct(seller);
    const ok = await makeProduct(seller, { name: "OK", price: 4200 });
    const soldOut = await makeProduct(seller, { name: "SoldOut", stock: 0 });
    const later = await makeProduct(seller, { name: "Later" });
    const laterDeleted = await makeProduct(seller, { name: "Gone" });
    await request(`/api/product-pairings/${main}`, "PUT", { pairedProductIds: [ok, soldOut, later, laterDeleted] });

    // Goes stale after being paired.
    await db.update(products).set({ status: "archived" }).where(eq(products.id, later));
    await db.update(products).set({ deletedAt: new Date() }).where(eq(products.id, laterDeleted));

    auth.userId = "";
    const res = await request(`/api/product-pairings/public/${main}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];
    expect(body.map((p) => p.name)).toEqual(["OK", "SoldOut"]);
    expect(body[0]).toMatchObject({ priceCents: 4200, available: true, image: "https://example.test/a.jpg" });
    expect(body[1].available).toBe(false);
    expect(body.every((p) => p.source === "curated")).toBe(true);
    // The seller's management view still shows the hidden ones, flagged.
    auth.userId = seller;
    const mine = (await (await request(`/api/product-pairings/${main}`)).json()) as any;
    expect(mine.pairings.map((p: any) => [p.name, p.active])).toEqual([["OK", true], ["SoldOut", true], ["Later", false], ["Gone", false]]);
    // Saving again keeps an existing hidden one.
    const keep = await request(`/api/product-pairings/${main}`, "PUT", { pairedProductIds: [ok, later] });
    expect(keep.status).toBe(200);
  });

  it("public endpoint is empty for unknown, malformed and archived main products", async () => {
    const main = await makeProduct(seller, { status: "archived" });
    const a = await makeProduct(seller);
    await db.insert(productPairings).values({ productId: main, pairedProductId: a, position: 0 });
    expect(await (await request(`/api/product-pairings/public/${main}`)).json()).toEqual([]);
    expect(await (await request(`/api/product-pairings/public/${crypto.randomUUID()}`)).json()).toEqual([]);
    expect(await (await request(`/api/product-pairings/public/not-a-uuid`)).json()).toEqual([]);
  });

  it("deleting a product cascades its pairings", async () => {
    auth.userId = seller;
    const main = await makeProduct(seller);
    const a = await makeProduct(seller);
    await request(`/api/product-pairings/${main}`, "PUT", { pairedProductIds: [a] });
    await db.delete(products).where(eq(products.id, a));
    expect(await db.select().from(productPairings).where(eq(productPairings.productId, main))).toHaveLength(0);
  });

  it("public endpoint fills with complementary same-seller products when nothing is curated", async () => {
    const brand = `${prefix}-auto-${crypto.randomBytes(3).toString("hex")}`;
    const tee = await makeProduct(brand, { name: "Box Tee" });
    await makeProduct(brand, { name: "Heavy Hoodie" }); // same slot (top) → excluded
    await makeProduct(brand, { name: "Loop Tee" }); // same slot → excluded
    await makeProduct(brand, { name: "Wide Jeans" });
    await makeProduct(brand, { name: "Sold Out Cargo Pants", stock: 0 }); // sold out → excluded
    await makeProduct(brand, { name: "Pre-order Boots", stock: 0, preOrder: true }); // pre-order stays
    await makeProduct(brand, { name: "Logo Cap", category: "accessories" });
    await makeProduct(brand, { name: "Coach Jacket", status: "archived" }); // inactive → excluded
    await makeProduct(brand, { name: "Deleted Shorts", deleted: true }); // deleted → excluded
    await makeProduct(brand, { name: "Mystery piece" }); // unclassifiable → excluded
    await makeProduct(`${brand}-other`, { name: "Other Brand Jeans" }); // other seller → excluded

    const body = (await (await request(`/api/product-pairings/public/${tee}`)).json()) as any[];
    expect(body.map((p) => p.name).sort()).toEqual(["Logo Cap", "Pre-order Boots", "Wide Jeans"]);
    // Interleaved by outfit slot: bottom, (outerwear), footwear, accessory.
    expect(body.map((p) => p.name)).toEqual(["Wide Jeans", "Pre-order Boots", "Logo Cap"]);
    expect(body.every((p) => p.source === "auto" && p.available && p.sellerId === brand)).toBe(true);
    expect(body[0]).toMatchObject({ priceCents: 5000, image: "https://example.test/a.jpg" });
    expect(body[0].variants).toHaveLength(1);
  });

  it("curated pairings come first, auto items fill up to the cap without duplicates", async () => {
    const brand = `${prefix}-mix-${crypto.randomBytes(3).toString("hex")}`;
    const tee = await makeProduct(brand, { name: "Main Tee" });
    const curatedJeans = await makeProduct(brand, { name: "Curated Jeans" });
    const curatedHoodie = await makeProduct(brand, { name: "Curated Hoodie" }); // curated keeps the seller's choice
    for (let i = 0; i < 10; i++) await makeProduct(brand, { name: `Track Pants ${i}` });
    await db.insert(productPairings).values([
      { productId: tee, pairedProductId: curatedJeans, position: 0 },
      { productId: tee, pairedProductId: curatedHoodie, position: 1 },
    ]);

    const body = (await (await request(`/api/product-pairings/public/${tee}`)).json()) as any[];
    expect(body).toHaveLength(8);
    expect(body.slice(0, 2).map((p) => [p.name, p.source])).toEqual([["Curated Jeans", "curated"], ["Curated Hoodie", "curated"]]);
    expect(body.slice(2).every((p) => p.source === "auto" && p.name.startsWith("Track Pants"))).toBe(true);
    expect(new Set(body.map((p) => p.id)).size).toBe(8);
  });

  it("public endpoint stays empty when nothing complements the product", async () => {
    const brand = `${prefix}-none-${crypto.randomBytes(3).toString("hex")}`;
    const tee = await makeProduct(brand, { name: "Only Tee" });
    await makeProduct(brand, { name: "Another Tee" });
    expect(await (await request(`/api/product-pairings/public/${tee}`)).json()).toEqual([]);
  });
});
