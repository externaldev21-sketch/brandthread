import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, interactions, orders, posts, savedItems } from "@workspace/db";
import { inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const sellerA = `post-analytics-a-${suffix}`;
const sellerB = `post-analytics-b-${suffix}`;
const actorA = `post-analytics-viewer-a-${suffix}`;
const actorB = `post-analytics-viewer-b-${suffix}`;
const postIds: string[] = [];
const orderIds: string[] = [];
const savedItemIds: string[] = [];
const authState = vi.hoisted(() => ({ clerkUserId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = authState.clerkUserId;
    next();
  },
}));

let server: Server;
let base = "";

beforeAll(async () => {
  const [sellerAPost, sellerBPost] = await db
    .insert(posts)
    .values([
      {
        userId: sellerA,
        mediaUrl: "https://example.com/post-a.mp4",
        mediaType: "video",
        caption: "Seller A post",
      },
      {
        userId: sellerB,
        mediaUrl: "https://example.com/post-b.jpg",
        mediaType: "photo",
        caption: "Seller B post",
      },
    ])
    .returning({ id: posts.id });
  postIds.push(sellerAPost.id, sellerBPost.id);

  await db.insert(interactions).values([
    { userId: actorA, postId: sellerAPost.id, type: "like" },
    { userId: actorB, postId: sellerAPost.id, type: "repost" },
    { userId: actorA, postId: sellerAPost.id, type: "view" },
    { userId: actorA, postId: sellerAPost.id, type: "view" },
    { userId: actorB, postId: sellerAPost.id, type: "view" },
    { userId: actorA, postId: sellerAPost.id, type: "shop_click" },
    { userId: actorB, postId: sellerAPost.id, type: "shop_click" },
    { userId: actorA, postId: sellerAPost.id, type: "watch_time", value: "4" },
    { userId: actorB, postId: sellerAPost.id, type: "watch_time", value: "8" },
    { userId: actorB, postId: sellerAPost.id, type: "watch_time", value: "not-a-number" },
  ]);

  const [saved] = await db
    .insert(savedItems)
    .values({
      userId: actorA,
      itemType: "post",
      targetId: sellerAPost.id,
      title: "Saved post",
    })
    .returning({ id: savedItems.id });
  savedItemIds.push(saved.id);

  const insertedOrders = await db
    .insert(orders)
    .values([
      {
        ownerId: sellerA,
        buyerId: actorA,
        orderNumber: `PAID-${suffix}`,
        status: "processing",
        totalCents: 5_000,
        subtotalCents: 5_000,
        sourcePostId: sellerAPost.id,
      },
      {
        ownerId: sellerA,
        buyerId: actorB,
        orderNumber: `CANCELLED-${suffix}`,
        status: "cancelled",
        totalCents: 9_000,
        subtotalCents: 9_000,
        sourcePostId: sellerAPost.id,
      },
    ])
    .returning({ id: orders.id });
  orderIds.push(...insertedOrders.map((order) => order.id));

  authState.clerkUserId = sellerA;
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
  await db.delete(savedItems).where(inArray(savedItems.id, savedItemIds));
  await db.delete(orders).where(inArray(orders.id, orderIds));
  await db.delete(interactions).where(inArray(interactions.postId, postIds));
  await db.delete(posts).where(inArray(posts.id, postIds));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("post analytics", () => {
  it("returns only verified metrics backed by tracked seller-owned data", async () => {
    authState.clerkUserId = sellerA;

    const response = await fetch(`${base}/api/posts/${postIds[0]}/analytics`);
    const body = await response.json() as any;

    expect(response.status).toBe(200);
    expect(body.post.id).toBe(postIds[0]);
    expect(body.metrics.likes).toBe(1);
    expect(body.metrics.reposts).toBe(1);
    expect(body.metrics.views).toEqual({
      tracked: true,
      count: 3,
      uniqueViewers: 2,
    });
    expect(body.metrics.saves).toEqual({ tracked: true, count: 1 });
    expect(body.metrics.productClicks).toEqual({
      tracked: true,
      count: 2,
      uniqueClickers: 2,
    });
    expect(body.metrics.conversions).toEqual({
      tracked: true,
      orders: 1,
      revenueCents: 5_000,
      rate: 0.5,
    });
    expect(body.metrics.retention).toEqual({
      tracked: true,
      sampleCount: 2,
      averageWatchTimeSeconds: 6,
    });
  });

  it("does not reveal another seller's post analytics", async () => {
    authState.clerkUserId = sellerB;

    const response = await fetch(`${base}/api/posts/${postIds[0]}/analytics`);

    expect(response.status).toBe(404);
  });

  it("marks event-derived metrics unavailable until they are tracked", async () => {
    authState.clerkUserId = sellerB;

    const response = await fetch(`${base}/api/posts/${postIds[1]}/analytics`);
    const body = await response.json() as any;

    expect(response.status).toBe(200);
    expect(body.metrics.views).toEqual({
      tracked: false,
      count: null,
      uniqueViewers: null,
    });
    expect(body.metrics.retention).toEqual({
      tracked: false,
      sampleCount: 0,
      averageWatchTimeSeconds: null,
    });
  });
});