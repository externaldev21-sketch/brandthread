/**
 * Integration tests for reviews v2 (migration 113): photos, size/fit, the
 * server-derived verified-purchase flag, persisted idempotent "Helpful" votes
 * and seller-reply authorization.
 *
 * Runs against the real test database. requireAuth is mocked (x-test-user,
 * 401 when absent so signed-out writes are covered); object storage is mocked
 * so no bucket is needed.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orders, orderItems, products, productVariants, reviews } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const BUYER = `rv2-buyer-${suffix}`;
const BUYER_2 = `rv2-buyer2-${suffix}`;
const SELLER = `rv2-seller-${suffix}`;
const OTHER_SELLER = `rv2-other-seller-${suffix}`;

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
    async createObjectEntityFromBuffer(_b: Buffer, _t: string, path: string) { return path; }
    async trySetObjectEntityAclPolicy() {}
    async deleteObjectEntity() {}
    async getObjectEntityDownloadURL(path: string) { return `https://signed.example${path}?sig=1`; }
  },
}));

let server: Server;
let base = "";
let productId = "";
let orderId = "";
let order2Id = "";

const json = { "Content-Type": "application/json" };
const as = (user?: string) => (user ? { ...json, "x-test-user": user } : json);

beforeAll(async () => {
  const { default: reviewsRouter } = await import("../reviews");
  const app = express();
  app.use(express.json());
  app.use("/api/reviews", reviewsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const [p] = await db.insert(products).values({ ownerId: SELLER, name: `rv2-product-${suffix}`, status: "active" })
    .returning({ id: products.id });
  productId = p.id;
  const [variant] = await db.insert(productVariants)
    .values({ productId, sku: `rv2-sku-${suffix}`, size: "M", priceCents: 1000, stock: 5 })
    .returning({ id: productVariants.id });
  for (const [buyerId, label] of [[BUYER, "a"], [BUYER_2, "b"]] as const) {
    const [o] = await db.insert(orders).values({
      ownerId: SELLER, buyerId, orderNumber: `BT-RV2-${label}-${suffix}`, status: "delivered",
      totalCents: 1000, subtotalCents: 1000, shippingCents: 0,
    }).returning({ id: orders.id });
    await db.insert(orderItems).values({
      orderId: o.id, variantId: variant.id, productName: "rv2", quantity: 1, priceCents: 1000,
    });
    if (label === "a") orderId = o.id; else order2Id = o.id;
  }
});

afterAll(async () => {
  await db.delete(reviews).where(inArray(reviews.buyerId, [BUYER, BUYER_2]));
  for (const id of [orderId, order2Id]) {
    if (!id) continue;
    await db.delete(orderItems).where(eq(orderItems.orderId, id));
    await db.delete(orders).where(eq(orders.id, id));
  }
  if (productId) await db.delete(products).where(eq(products.id, productId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const photoPath = (buyer: string) => `/objects/reviews/${buyer.replace(/[^A-Za-z0-9_-]/g, "_")}/${crypto.randomUUID()}`;
let reviewId = "";

describe("review creation with photos / fit", () => {
  it("401 when signed out", async () => {
    const res = await fetch(`${base}/api/reviews`, {
      method: "POST", headers: as(), body: JSON.stringify({ orderId, sellerId: SELLER, rating: 5 }),
    });
    expect(res.status).toBe(401);
  });

  it("400 for photos that are not under the buyer's own upload prefix", async () => {
    const res = await fetch(`${base}/api/reviews`, {
      method: "POST", headers: as(BUYER),
      body: JSON.stringify({ orderId, sellerId: SELLER, rating: 5, photos: [photoPath(BUYER_2)] }),
    });
    expect(res.status).toBe(400);
  });

  it("400 for more than four photos and for an unknown fit note", async () => {
    const many = Array.from({ length: 5 }, () => photoPath(BUYER));
    const tooMany = await fetch(`${base}/api/reviews`, {
      method: "POST", headers: as(BUYER), body: JSON.stringify({ orderId, sellerId: SELLER, rating: 5, photos: many }),
    });
    expect(tooMany.status).toBe(400);
    const badFit = await fetch(`${base}/api/reviews`, {
      method: "POST", headers: as(BUYER), body: JSON.stringify({ orderId, sellerId: SELLER, rating: 5, fitNote: "Huge" }),
    });
    expect(badFit.status).toBe(400);
  });

  it("201 stores photos, fit, and derives product + size from the order", async () => {
    const path = photoPath(BUYER);
    const res = await fetch(`${base}/api/reviews`, {
      method: "POST", headers: as(BUYER),
      body: JSON.stringify({
        orderId, sellerId: SELLER, rating: 4, body: "Nice fabric", photos: [path], fitNote: "Runs small",
        // Client-supplied size/verified flags are ignored.
        sizeBought: "XXL", verifiedPurchase: false,
      }),
    });
    expect(res.status).toBe(201);
    const row = await res.json() as Record<string, any>;
    reviewId = row.id;
    expect(row.productId).toBe(productId);
    expect(row.sizeBought).toBe("M");
    expect(row.fitNote).toBe("Runs small");
    expect(row.fitScale).toBe(-1);
    expect(row.verifiedPurchase).toBe(true);
    expect(row.photos).toEqual([`https://signed.example${path}?sig=1`]);
  });

  it("the public product list shows the badge flag, photos and helpful count without auth", async () => {
    const res = await fetch(`${base}/api/reviews/product/${productId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { reviews: Array<Record<string, any>>; totalCount: number };
    const mine = body.reviews.find((r) => r.id === reviewId)!;
    expect(mine.verifiedPurchase).toBe(true);
    expect(mine.photos).toHaveLength(1);
    expect(mine.photos[0]).toMatch(/^https:\/\/signed\.example/);
    expect(mine.helpfulCount).toBe(0);
    expect(mine.viewerHelpful).toBe(false);
    expect(mine).not.toHaveProperty("orderId");
    expect(mine).not.toHaveProperty("order_id");
  });
});

describe("helpful votes", () => {
  it("401 when signed out", async () => {
    const res = await fetch(`${base}/api/reviews/${reviewId}/helpful`, { method: "PUT" });
    expect(res.status).toBe(401);
  });

  it("the author can't vote on their own review", async () => {
    const res = await fetch(`${base}/api/reviews/${reviewId}/helpful`, { method: "PUT", headers: as(BUYER) });
    expect(res.status).toBe(400);
  });

  it("is idempotent: repeated PUT counts once, repeated DELETE clears once", async () => {
    const put = () => fetch(`${base}/api/reviews/${reviewId}/helpful`, { method: "PUT", headers: as(BUYER_2) });
    const a = await (await put()).json() as Record<string, any>;
    const b = await (await put()).json() as Record<string, any>;
    expect(a).toEqual({ helpfulCount: 1, viewerHelpful: true });
    expect(b).toEqual({ helpfulCount: 1, viewerHelpful: true });

    // A signed-in viewer sees their own vote on the public list; a visitor doesn't.
    const list = await (await fetch(`${base}/api/reviews/product/${productId}`, { headers: as(BUYER_2) })).json() as any;
    expect(list.reviews.find((r: any) => r.id === reviewId).helpfulCount).toBe(1);

    const del = () => fetch(`${base}/api/reviews/${reviewId}/helpful`, { method: "DELETE", headers: as(BUYER_2) });
    expect(await (await del()).json()).toEqual({ helpfulCount: 0, viewerHelpful: false });
    expect(await (await del()).json()).toEqual({ helpfulCount: 0, viewerHelpful: false });
  });

  it("404 for an unknown review", async () => {
    const res = await fetch(`${base}/api/reviews/${crypto.randomUUID()}/helpful`, { method: "PUT", headers: as(BUYER_2) });
    expect(res.status).toBe(404);
  });
});

describe("seller reply", () => {
  it("403 for a different seller", async () => {
    const res = await fetch(`${base}/api/reviews/${reviewId}/reply`, {
      method: "POST", headers: as(OTHER_SELLER), body: JSON.stringify({ replyText: "Thanks" }),
    });
    expect(res.status).toBe(403);
  });

  it("403 for another buyer", async () => {
    const res = await fetch(`${base}/api/reviews/${reviewId}/reply`, {
      method: "POST", headers: as(BUYER_2), body: JSON.stringify({ replyText: "Thanks" }),
    });
    expect(res.status).toBe(403);
  });

  it("the product's seller can reply and the reply is public", async () => {
    const res = await fetch(`${base}/api/reviews/${reviewId}/reply`, {
      method: "POST", headers: as(SELLER), body: JSON.stringify({ replyText: "Thank you for the feedback!" }),
    });
    expect(res.status).toBe(200);
    const list = await (await fetch(`${base}/api/reviews/product/${productId}`)).json() as any;
    const r = list.reviews.find((x: any) => x.id === reviewId);
    expect(r.sellerReply).toBe("Thank you for the feedback!");
    expect(r.sellerRepliedAt).toBeTruthy();
  });

  it("rejects an empty reply", async () => {
    const res = await fetch(`${base}/api/reviews/${reviewId}/reply`, {
      method: "POST", headers: as(SELLER), body: JSON.stringify({ replyText: "  " }),
    });
    expect(res.status).toBe(400);
  });
});

describe("no review without a purchase", () => {
  it("403 when the order belongs to someone else", async () => {
    const res = await fetch(`${base}/api/reviews`, {
      method: "POST", headers: as(BUYER), body: JSON.stringify({ orderId: order2Id, sellerId: SELLER, rating: 5 }),
    });
    expect(res.status).toBe(403);
  });

  it("400 without an orderId", async () => {
    const res = await fetch(`${base}/api/reviews`, {
      method: "POST", headers: as(BUYER), body: JSON.stringify({ sellerId: SELLER, rating: 5 }),
    });
    expect(res.status).toBe(400);
  });
});

describe("photo upload", () => {
  it("401 signed out, 400 for non-images, 400 for mismatched bytes, 201 for a real JPEG", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
    const signedOut = await fetch(`${base}/api/reviews/photos`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: jpeg });
    expect(signedOut.status).toBe(401);
    const text = await fetch(`${base}/api/reviews/photos`, { method: "POST", headers: { "Content-Type": "text/plain", "x-test-user": BUYER }, body: "hi" });
    expect(text.status).toBe(400);
    const fake = await fetch(`${base}/api/reviews/photos`, { method: "POST", headers: { "Content-Type": "image/png", "x-test-user": BUYER }, body: jpeg });
    expect(fake.status).toBe(400);
    const ok = await fetch(`${base}/api/reviews/photos`, { method: "POST", headers: { "Content-Type": "image/jpeg", "x-test-user": BUYER }, body: jpeg });
    expect(ok.status).toBe(201);
    const { objectPath } = await ok.json() as { objectPath: string };
    expect(objectPath.startsWith(`/objects/reviews/${BUYER.replace(/[^A-Za-z0-9_-]/g, "_")}/`)).toBe(true);
  });

  it("screens the photo before storing it: flagged → 422, provider outage still uploads", async () => {
    const { setMediaModerationProvider } = await import("../../lib/mediaModeration");
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
    const post = () => fetch(`${base}/api/reviews/photos`, { method: "POST", headers: { "Content-Type": "image/jpeg", "x-test-user": BUYER }, body: jpeg });
    try {
      setMediaModerationProvider(async () => ({ flags: { sexual: true }, scores: { sexual: 0.9 } }));
      const flagged = await post();
      expect(flagged.status).toBe(422);
      expect(await flagged.json()).toMatchObject({ code: "IMAGE_REJECTED" });
      // Unverified (provider down / unconfigured) never blocks the upload.
      setMediaModerationProvider(async () => { throw new Error("provider down"); });
      expect((await post()).status).toBe(201);
    } finally {
      setMediaModerationProvider();
    }
  });
});
