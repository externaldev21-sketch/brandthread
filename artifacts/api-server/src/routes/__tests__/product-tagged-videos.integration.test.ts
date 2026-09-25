import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, posts, postTaggedProducts, products, productVariants, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const seller = `tagged-video-seller-${suffix}`;
let productId = "";
const postIds: string[] = [];
let server: Server;
let base = "";

beforeAll(async () => {
  await db.insert(users).values({
    clerkId: seller,
    email: `${seller}@test.local`,
    name: "Video Seller",
    displayName: "Video Seller",
    role: "seller",
    accountType: "seller",
  });

  const [product] = await db.insert(products).values({
    ownerId: seller,
    name: "Tagged Video Jacket",
    category: "apparel",
    status: "active",
  }).returning();
  productId = product.id;
  await db.insert(productVariants).values({
    productId: product.id,
    sku: `${suffix}-1`,
    priceCents: 4_000,
    stock: 5,
  });

  const [videoPost] = await db.insert(posts).values({
    userId: seller,
    mediaUrl: "https://example.test/video.mp4",
    thumbnailUrl: "https://example.test/video-thumb.jpg",
    mediaType: "video",
    caption: "Wearing the jacket",
    postStatus: "published",
    moderationStatus: "visible",
  }).returning();
  postIds.push(videoPost.id);

  const [photoPost] = await db.insert(posts).values({
    userId: seller,
    mediaUrl: "https://example.test/photo.jpg",
    mediaType: "photo",
    caption: "Photo of the jacket",
    postStatus: "published",
    moderationStatus: "visible",
  }).returning();
  postIds.push(photoPost.id);

  const [draftVideoPost] = await db.insert(posts).values({
    userId: seller,
    mediaUrl: "https://example.test/draft.mp4",
    mediaType: "video",
    caption: "Unpublished draft",
    postStatus: "draft",
    moderationStatus: "visible",
  }).returning();
  postIds.push(draftVideoPost.id);

  await db.insert(postTaggedProducts).values([
    { postId: videoPost.id, productId, position: 0 },
    { postId: photoPost.id, productId, position: 0 },
    { postId: draftVideoPost.id, productId, position: 0 },
  ]);

  const { default: publicRouter } = await import("../public");
  const app = express();
  app.use(express.json());
  app.use("/api/public", publicRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(postTaggedProducts).where(inArray(postTaggedProducts.postId, postIds));
  await db.delete(posts).where(inArray(posts.id, postIds));
  await db.delete(productVariants).where(eq(productVariants.productId, productId));
  await db.delete(products).where(eq(products.id, productId));
  await db.delete(users).where(eq(users.clerkId, seller));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/public/products/:id/videos", () => {
  it("returns only published videos that tagged the product, not photos or drafts", async () => {
    const response = await fetch(`${base}/api/public/products/${productId}/videos`);
    expect(response.status).toBe(200);
    const rows = await response.json() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].postId).toBe(postIds[0]);
    expect(rows[0].mediaUrl).toBe("https://example.test/video.mp4");
    expect(rows[0].authorName).toBe("Video Seller");
  });

  it("returns an empty array for a product with no tagged videos", async () => {
    const [other] = await db.insert(products).values({
      ownerId: seller,
      name: "Untagged product",
      category: "apparel",
      status: "active",
    }).returning();
    try {
      const response = await fetch(`${base}/api/public/products/${other.id}/videos`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([]);
    } finally {
      await db.delete(products).where(eq(products.id, other.id));
    }
  });
});
