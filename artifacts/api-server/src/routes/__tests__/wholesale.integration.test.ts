import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { inArray } from "drizzle-orm";
import { db, productVariants, products, users, wholesaleBuyers, wholesalePrices, wholesaleSettings } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id");
    next();
  },
}));
vi.mock("../../middlewares/requireRole", () => ({
  requirePermission: () => (_req: any, _res: any, next: () => void) => next(),
}));

const sfx = crypto.randomBytes(5).toString("hex");
const id = (name: string) => `wh-${sfx}-${name}`;
const SELLER = id("seller");
const OTHER_SELLER = id("other");
const BUYER = id("buyer");
const BUYER2 = id("buyer2");
const allUsers = [SELLER, OTHER_SELLER, BUYER, BUYER2];

let server: Server;
let base = "";
let productId = "";
let variantId = "";
let otherProductId = "";

async function call(method: string, path: string, as: string | null, body?: unknown) {
  const r = await fetch(`${base}/api/wholesale${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(as ? { "x-test-user-id": as } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() as any };
}

beforeAll(async () => {
  await db.insert(users).values(allUsers.map((clerkId) => ({
    clerkId, email: `${clerkId}@test.local`, name: clerkId, role: clerkId.includes("seller") || clerkId.includes("other") ? "seller" : "buyer",
  })));
  const [p] = await db.insert(products).values({ ownerId: SELLER, name: "Wholesale tee", status: "active" }).returning();
  productId = p.id;
  const [v] = await db.insert(productVariants).values({ productId, sku: id("sku"), size: "M", priceCents: 4_000, stock: 50 }).returning();
  variantId = v.id;
  const [o] = await db.insert(products).values({ ownerId: OTHER_SELLER, name: "Not mine", status: "active" }).returning();
  otherProductId = o.id;

  const { default: router } = await import("../wholesale");
  const app = express();
  app.use(express.json());
  app.use("/api/wholesale", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await db.delete(wholesaleBuyers).where(inArray(wholesaleBuyers.sellerId, [SELLER, OTHER_SELLER]));
  await db.delete(wholesalePrices).where(inArray(wholesalePrices.sellerId, [SELLER, OTHER_SELLER]));
  await db.delete(wholesaleSettings).where(inArray(wholesaleSettings.sellerId, [SELLER, OTHER_SELLER]));
  await db.delete(products).where(inArray(products.ownerId, [SELLER, OTHER_SELLER]));
  await db.delete(users).where(inArray(users.clerkId, allUsers));
});

describe("wholesale price list routes", () => {
  it("starts off, and buyers can't apply until the seller turns it on", async () => {
    expect((await call("GET", `/store/${SELLER}`, null)).body).toEqual({ enabled: false, minOrderCents: 0 });
    const seller = await call("GET", "/seller", SELLER);
    expect(seller.body.settings).toEqual({ enabled: false, minOrderCents: 0, defaultPercentOff: 0 });
    expect(seller.body.products.map((p: any) => p.id)).toEqual([productId]);
    expect((await call("POST", `/store/${SELLER}/apply`, BUYER, { businessName: "Corner Shop" })).status).toBe(404);
  });

  it("validates and saves settings", async () => {
    expect((await call("PUT", "/seller/settings", SELLER, { defaultPercentOff: 95 })).status).toBe(400);
    expect((await call("PUT", "/seller/settings", SELLER, { minOrderCents: -1 })).status).toBe(400);
    const r = await call("PUT", "/seller/settings", SELLER, { enabled: true, defaultPercentOff: 25, minOrderCents: 20_000 });
    expect(r.body).toEqual({ enabled: true, minOrderCents: 20_000, defaultPercentOff: 25 });
    // Partial update keeps the rest.
    expect((await call("PUT", "/seller/settings", SELLER, { minOrderCents: 15_000 })).body).toEqual({ enabled: true, minOrderCents: 15_000, defaultPercentOff: 25 });
    expect((await call("GET", `/store/${SELLER}`, null)).body).toEqual({ enabled: true, minOrderCents: 15_000 });
  });

  it("upserts fixed prices for own products only", async () => {
    expect((await call("PUT", "/seller/prices", SELLER, { productId: otherProductId, priceCents: 100 })).status).toBe(404);
    expect((await call("PUT", "/seller/prices", SELLER, { productId, minQuantity: 0 })).status).toBe(400);
    const first = await call("PUT", "/seller/prices", SELLER, { productId, priceCents: 2_000, minQuantity: 6 });
    expect(first.body).toMatchObject({ productId, variantId: null, priceCents: 2_000, minQuantity: 6 });
    const again = await call("PUT", "/seller/prices", SELLER, { productId, priceCents: 2_200, minQuantity: 12 });
    expect(again.body.id).toBe(first.body.id);
    const variantRule = await call("PUT", "/seller/prices", SELLER, { productId, variantId, priceCents: null, minQuantity: 3 });
    expect(variantRule.body).toMatchObject({ variantId, priceCents: null, minQuantity: 3 });
    const list = await call("GET", "/seller", SELLER);
    expect(list.body.prices).toHaveLength(2);
    expect((await call("DELETE", `/seller/prices/${variantRule.body.id}`, OTHER_SELLER)).status).toBe(404);
    expect((await call("DELETE", `/seller/prices/${variantRule.body.id}`, SELLER)).status).toBe(200);
  });

  it("lets a buyer apply once, and the seller approve or decline", async () => {
    expect((await call("POST", `/store/${SELLER}/apply`, BUYER, { businessName: " " })).status).toBe(400);
    expect((await call("POST", `/store/${SELLER}/apply`, SELLER, { businessName: "Me" })).status).toBe(400);
    const applied = await call("POST", `/store/${SELLER}/apply`, BUYER, { businessName: "Corner Shop" });
    expect(applied.status).toBe(201);
    expect(applied.body).toEqual({ status: "pending", businessName: "Corner Shop" });
    // Re-applying while pending changes nothing.
    expect((await call("POST", `/store/${SELLER}/apply`, BUYER, { businessName: "Other" })).body.businessName).toBe("Corner Shop");

    const pendingView = await call("GET", `/store/${SELLER}/me`, BUYER);
    expect(pendingView.body).toMatchObject({ enabled: true, status: "pending", priceList: [] });

    const seller = await call("GET", "/seller", SELLER);
    const request = seller.body.buyers.find((b: any) => b.buyerId === BUYER);
    expect(request).toMatchObject({ status: "pending", businessName: "Corner Shop" });
    expect((await call("PATCH", `/seller/buyers/${request.id}`, OTHER_SELLER, { status: "approved" })).status).toBe(404);
    expect((await call("PATCH", `/seller/buyers/${request.id}`, SELLER, { status: "maybe" })).status).toBe(400);
    expect((await call("PATCH", `/seller/buyers/${request.id}`, SELLER, { status: "approved" })).body.status).toBe("approved");

    const approvedView = await call("GET", `/store/${SELLER}/me`, BUYER);
    expect(approvedView.body).toMatchObject({ status: "approved", minOrderCents: 15_000 });
    expect(approvedView.body.priceList).toHaveLength(1);
    expect(approvedView.body.priceList[0].variants[0]).toMatchObject({ id: variantId, priceCents: 4_000, wholesaleCents: 2_200, minQuantity: 12 });
  });

  it("lets a declined buyer apply again", async () => {
    await call("POST", `/store/${SELLER}/apply`, BUYER2, { businessName: "Pop-up" });
    const seller = await call("GET", "/seller", SELLER);
    const request = seller.body.buyers.find((b: any) => b.buyerId === BUYER2);
    await call("PATCH", `/seller/buyers/${request.id}`, SELLER, { status: "declined" });
    expect((await call("GET", `/store/${SELLER}/me`, BUYER2)).body).toMatchObject({ status: "declined", priceList: [] });
    const again = await call("POST", `/store/${SELLER}/apply`, BUYER2, { businessName: "Pop-up Ltd" });
    expect(again.body).toEqual({ status: "pending", businessName: "Pop-up Ltd" });
  });
});
