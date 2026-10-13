import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, follows, posts, postTaggedProducts, products, productVariants, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

/**
 * "Shop the look": a seller tags their own products on a Thread post, and the
 * Thread feed returns those products (name, images, lowest variant price) on
 * the post. Another seller's product id is dropped, never tagged.
 */

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `shop-look-seller-${suffix}`;
const otherSellerId = `shop-look-other-${suffix}`;
const buyerId = `shop-look-buyer-${suffix}`;
const postIds: string[] = [];
const productIds: string[] = [];
const authState = vi.hoisted(() => ({ clerkUserId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = authState.clerkUserId;
    next();
  },
}));

let server: Server;
let base = "";

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  return { status: response.status, body: response.status === 204 ? null : (await response.json() as any) };
}

async function seedProduct(ownerId: string, prices: number[]) {
  const [product] = await db.insert(products).values({
    ownerId, name: `Look tee ${crypto.randomBytes(3).toString("hex")}`, status: "active",
    images: ["https://cdn.test/look-tee.jpg"],
  }).returning();
  productIds.push(product.id);
  await db.insert(productVariants).values(prices.map((priceCents, i) => ({
    productId: product.id, sku: `look-${suffix}-${product.id.slice(0, 6)}-${i}`, size: ["S", "M", "L"][i] ?? "XL", priceCents, stock: 5,
  })));
  return product;
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: sellerId, email: `${sellerId}@test.local`, name: "Look Seller", displayName: "Look Seller", role: "seller", accountType: "seller" },
    { clerkId: otherSellerId, email: `${otherSellerId}@test.local`, name: "Other Seller", displayName: "Other Seller", role: "seller", accountType: "seller" },
    { clerkId: buyerId, email: `${buyerId}@test.local`, name: "Look Buyer", displayName: "Look Buyer", role: "buyer", accountType: "buyer" },
  ]);
  await db.insert(follows).values({ followerId: buyerId, followingId: sellerId });

  const { default: postsRouter } = await import("../posts");
  const app = express();
  app.use(express.json());
  app.use("/api/posts", postsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (postIds.length > 0) {
    await db.delete(postTaggedProducts).where(inArray(postTaggedProducts.postId, postIds));
    await db.delete(posts).where(inArray(posts.id, postIds));
  }
  if (productIds.length > 0) {
    await db.delete(productVariants).where(inArray(productVariants.productId, productIds));
    await db.delete(products).where(inArray(products.id, productIds));
  }
  await db.delete(follows).where(eq(follows.followerId, buyerId));
  await db.delete(users).where(inArray(users.clerkId, [sellerId, otherSellerId, buyerId]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("shop the look", () => {
  it("tags the seller's own products and the feed returns them on the post", async () => {
    const own = await seedProduct(sellerId, [4_500, 3_900]);
    const foreign = await seedProduct(otherSellerId, [1_000]);

    authState.clerkUserId = sellerId;
    const created = await request("/api/posts", {
      method: "POST",
      body: JSON.stringify({
        mediaType: "photo",
        mediaUrls: ["https://cdn.test/look.jpg"],
        caption: "Weekend look",
        taggedProductIds: [own.id, foreign.id],
      }),
    });
    expect(created.status).toBe(201);
    postIds.push(created.body.id);
    expect(created.body.taggedProducts.map((p: any) => p.id)).toEqual([own.id]);

    authState.clerkUserId = buyerId;
    const feed = await request("/api/posts/feed");
    expect(feed.status).toBe(200);
    const post = feed.body.find((p: any) => p.id === created.body.id);
    expect(post).toBeTruthy();
    expect(post.taggedProducts).toEqual([
      expect.objectContaining({ productId: own.id, position: 0, name: own.name, priceCents: 3_900 }),
    ]);
  });
});
