import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, follows, posts, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

/**
 * RULE: only SELLER posts appear in the main (Thread) feed. Buyers can post
 * photo/carousel posts to their own profile, but those posts must never
 * surface in GET /api/posts/feed no matter what the buyer sends.
 */

const suffix = crypto.randomBytes(6).toString("hex");
const buyerId = `posts-buyer-rules-buyer-${suffix}`;
const sellerId = `posts-buyer-rules-seller-${suffix}`;
const postIds: string[] = [];
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
  return {
    status: response.status,
    body: response.status === 204 ? null : (await response.json() as any),
  };
}

beforeAll(async () => {
  await db.insert(users).values([
    {
      clerkId: buyerId,
      email: `${buyerId}@test.local`,
      name: "Rules Buyer",
      displayName: "Rules Buyer",
      role: "buyer",
      accountType: "buyer",
    },
    {
      clerkId: sellerId,
      email: `${sellerId}@test.local`,
      name: "Rules Seller",
      displayName: "Rules Seller",
      role: "seller",
      accountType: "seller",
    },
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
  if (postIds.length > 0) await db.delete(posts).where(inArray(posts.id, postIds));
  await db.delete(follows).where(eq(follows.followerId, buyerId));
  await db.delete(users).where(inArray(users.clerkId, [buyerId, sellerId]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("buyer posting rules", () => {
  it("lets a buyer create a single photo post", async () => {
    authState.clerkUserId = buyerId;
    const res = await request("/api/posts", {
      method: "POST",
      body: JSON.stringify({
        mediaType: "photo",
        mediaUrls: ["https://cdn.test/buyer-photo.jpg"],
        caption: "My new outfit",
      }),
    });
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(buyerId);
    postIds.push(res.body.id);
  });

  it("lets a buyer create a carousel (slideshow) post", async () => {
    authState.clerkUserId = buyerId;
    const res = await request("/api/posts", {
      method: "POST",
      body: JSON.stringify({
        mediaType: "slideshow",
        mediaUrls: ["https://cdn.test/buyer-1.jpg", "https://cdn.test/buyer-2.jpg"],
        caption: "Carousel",
      }),
    });
    expect(res.status).toBe(201);
    postIds.push(res.body.id);
  });

  it("rejects a buyer video post", async () => {
    authState.clerkUserId = buyerId;
    const res = await request("/api/posts", {
      method: "POST",
      body: JSON.stringify({ mediaType: "video", mediaUrls: ["https://cdn.test/buyer.mp4"] }),
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("BUYER_PHOTO_ONLY");
  });

  it("rejects a buyer scheduling a post", async () => {
    authState.clerkUserId = buyerId;
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await request("/api/posts", {
      method: "POST",
      body: JSON.stringify({
        mediaType: "photo",
        mediaUrls: ["https://cdn.test/buyer-photo.jpg"],
        scheduledAt: future,
      }),
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("BUYER_NO_SCHEDULING");
  });

  it("rejects a buyer tagging products", async () => {
    authState.clerkUserId = buyerId;
    const res = await request("/api/posts", {
      method: "POST",
      body: JSON.stringify({
        mediaType: "photo",
        mediaUrls: ["https://cdn.test/buyer-photo.jpg"],
        taggedProductIds: ["11111111-1111-1111-1111-111111111111"],
      }),
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("BUYER_NO_PRODUCT_TAGS");
  });

  it("a buyer's published post never appears in the seller-only Thread feed, even though the buyer follows a seller", async () => {
    authState.clerkUserId = buyerId;
    const feed = await request("/api/posts/feed");
    expect(feed.status).toBe(200);
    expect(feed.body.every((post: any) => post.userId !== buyerId)).toBe(true);
  });

  it("still lets a seller post reach the feed of a buyer who follows them", async () => {
    authState.clerkUserId = sellerId;
    const created = await request("/api/posts", {
      method: "POST",
      body: JSON.stringify({
        mediaType: "photo",
        mediaUrls: ["https://cdn.test/seller-photo.jpg"],
        caption: "New drop",
      }),
    });
    expect(created.status).toBe(201);
    postIds.push(created.body.id);

    authState.clerkUserId = buyerId;
    const feed = await request("/api/posts/feed");
    expect(feed.status).toBe(200);
    expect(feed.body.some((post: any) => post.id === created.body.id)).toBe(true);
  });
});
