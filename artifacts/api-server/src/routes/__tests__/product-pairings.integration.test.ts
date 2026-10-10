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

async function makeProduct(ownerId: string, opts: { status?: string; deleted?: boolean; stock?: number; price?: number; name?: string } = {}) {
  const [p] = await db.insert(products).values({
    ownerId,
    name: opts.name ?? `P-${crypto.randomBytes(3).toString("hex")}`,
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
});
