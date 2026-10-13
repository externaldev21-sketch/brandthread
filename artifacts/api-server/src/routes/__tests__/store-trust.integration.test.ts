/**
 * Store trust signals (features 64 + 65): detail ratings on reviews and the
 * public /api/public/store-trust/:sellerId summary ("Ships in N days").
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orders, orderItems, products, productVariants, reviews, shippingZones, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { homeProcessingDays } from "../../lib/storeTrust";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    req.clerkUserId = user;
    next();
  },
}));
vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityDownloadURL(path: string) { return `https://signed.example${path}`; }
  },
}));

const suffix = crypto.randomBytes(6).toString("hex");
const SELLER = `st-seller-${suffix}`;
const EMPTY_SELLER = `st-empty-${suffix}`;
const BUYERS = [`st-b1-${suffix}`, `st-b2-${suffix}`, `st-b3-${suffix}`];
const orderIds: string[] = [];
let productId = "";
let server: Server;
let base = "";

const post = (user: string, body: unknown) => fetch(`${base}/api/reviews`, {
  method: "POST", headers: { "content-type": "application/json", "x-test-user": user }, body: JSON.stringify(body),
});

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: SELLER, email: `${SELLER}@t.local`, name: "S", username: `sts_${suffix}`, role: "seller", accountType: "seller", sellerShipFromCountry: "US" },
    { clerkId: EMPTY_SELLER, email: `${EMPTY_SELLER}@t.local`, name: "E", username: `ste_${suffix}`, role: "seller", accountType: "seller" },
  ]);
  await db.insert(shippingZones).values([
    { id: `st-dom-${suffix}`, sellerId: SELLER, name: "United States", zoneType: "domestic", processingDays: 3 },
    { id: `st-row-${suffix}`, sellerId: SELLER, name: "Everywhere else", zoneType: "rest_of_world", processingDays: 6 },
  ]);
  const [p] = await db.insert(products).values({ ownerId: SELLER, name: `st-${suffix}`, status: "active" }).returning({ id: products.id });
  productId = p.id;
  const [v] = await db.insert(productVariants).values({ productId, sku: `st-sku-${suffix}`, priceCents: 1000, stock: 5 })
    .returning({ id: productVariants.id });
  for (const [i, buyerId] of BUYERS.entries()) {
    const [o] = await db.insert(orders).values({
      ownerId: SELLER, buyerId, orderNumber: `BT-ST-${i}-${suffix}`, status: "delivered",
      totalCents: 1000, subtotalCents: 1000, shippingCents: 0,
    }).returning({ id: orders.id });
    await db.insert(orderItems).values({ orderId: o.id, variantId: v.id, productName: "st", quantity: 1, priceCents: 1000 });
    orderIds.push(o.id);
  }
  const { default: reviewsRouter } = await import("../reviews");
  const { default: storeTrustRouter } = await import("../store-trust");
  const app = express();
  app.use(express.json());
  app.use("/api/reviews", reviewsRouter);
  app.use("/api/public/store-trust", storeTrustRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(reviews).where(inArray(reviews.buyerId, BUYERS));
  await db.delete(orderItems).where(inArray(orderItems.orderId, orderIds));
  await db.delete(orders).where(inArray(orders.id, orderIds));
  if (productId) await db.delete(products).where(eq(products.id, productId));
  await db.delete(shippingZones).where(eq(shippingZones.sellerId, SELLER));
  await db.delete(users).where(inArray(users.clerkId, [SELLER, EMPTY_SELLER]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("detail ratings on reviews", () => {
  it("rejects a detail rating outside 1–5", async () => {
    const res = await post(BUYERS[0], { orderId: orderIds[0], sellerId: SELLER, rating: 5, shipSpeedRating: 6 });
    expect(res.status).toBe(400);
    const res2 = await post(BUYERS[0], { orderId: orderIds[0], sellerId: SELLER, rating: 5, accuracyRating: 2.5 });
    expect(res2.status).toBe(400);
  });

  it("stores and returns them", async () => {
    const res = await post(BUYERS[0], { orderId: orderIds[0], sellerId: SELLER, rating: 5, shipSpeedRating: 5, accuracyRating: 4 });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body).toMatchObject({ shipSpeedRating: 5, accuracyRating: 4 });
  });

  it("keeps detail ratings when a review is edited without them", async () => {
    const res = await post(BUYERS[0], { orderId: orderIds[0], sellerId: SELLER, rating: 4, body: "Edited" });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(reviews).where(eq(reviews.orderId, orderIds[0]));
    expect(row).toMatchObject({ rating: 4, shipSpeedRating: 5, accuracyRating: 4 });
  });

  it("are optional", async () => {
    expect((await post(BUYERS[1], { orderId: orderIds[1], sellerId: SELLER, rating: 3 })).status).toBe(201);
    expect((await post(BUYERS[2], { orderId: orderIds[2], sellerId: SELLER, rating: 5, shipSpeedRating: 4, accuracyRating: 5 })).status).toBe(201);
  });

  it("are averaged on the seller's reviews, counting only reviews that gave one", async () => {
    const body = await (await fetch(`${base}/api/reviews/seller/${SELLER}`)).json() as any;
    expect(body.totalCount).toBe(3);
    expect(body.details).toEqual({ shipSpeed: { avg: 4.5, count: 2 }, accuracy: { avg: 4.5, count: 2 } });
  });
});

describe("GET /api/public/store-trust/:sellerId", () => {
  it("returns the home-country processing days and detail ratings", async () => {
    const res = await fetch(`${base}/api/public/store-trust/${SELLER}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      processingDays: 3,
      details: { shipSpeed: { avg: 4.5, count: 2 }, accuracy: { avg: 4.5, count: 2 } },
    });
  });

  it("returns null days for a store with no shipping set up", async () => {
    const body = await (await fetch(`${base}/api/public/store-trust/${EMPTY_SELLER}`)).json() as any;
    expect(body.processingDays).toBeNull();
    expect(body.details.shipSpeed.count).toBe(0);
  });

  it("returns empty signals for an unknown seller", async () => {
    const body = await (await fetch(`${base}/api/public/store-trust/nobody-${suffix}`)).json() as any;
    expect(body).toEqual({ processingDays: null, details: { shipSpeed: { avg: 0, count: 0 }, accuracy: { avg: 0, count: 0 } } });
  });
});

describe("homeProcessingDays", () => {
  const zone = (over: Record<string, unknown>) => ({
    id: "z", name: "z", zoneType: "domestic", countries: [], pricingModel: "flat", flatRateCents: 0, freeAboveCents: null,
    processingDays: 2, carrierLabel: null, shipsInternationally: true, dutiesHandling: "dap", active: true, sortOrder: 0, ...over,
  }) as any;

  it("uses the domestic zone over a broader one", () => {
    expect(homeProcessingDays([zone({ zoneType: "rest_of_world", processingDays: 7 }), zone({ processingDays: 1 })], "US")).toBe(1);
  });
  it("falls back to rest of world when there is no domestic zone", () => {
    expect(homeProcessingDays([zone({ zoneType: "rest_of_world", processingDays: 5 })], "GB")).toBe(5);
  });
  it("is null with no zones", () => {
    expect(homeProcessingDays([], "US")).toBeNull();
  });
});
