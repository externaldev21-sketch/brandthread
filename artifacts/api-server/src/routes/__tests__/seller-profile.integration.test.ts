import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, interactions, posts, users } from "@workspace/db";
import { inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const sellerA = `seller-profile-a-${suffix}`;
const sellerB = `seller-profile-b-${suffix}`;
const sellerWithoutLikes = `seller-profile-no-likes-${suffix}`;
const postIds: string[] = [];
const authState = vi.hoisted(() => ({
  clerkUserId: "",
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = authState.clerkUserId;
    next();
  },
}));

let server: Server;
let base = "";

beforeAll(async () => {
  await db.insert(users).values([
    {
      clerkId: sellerA,
      email: `${sellerA}@test.local`,
      name: "Seller Profile A",
      displayName: "Seller A",
      role: "seller",
      accountType: "seller",
    },
    {
      clerkId: sellerB,
      email: `${sellerB}@test.local`,
      name: "Seller Profile B",
      displayName: "Seller B",
      role: "seller",
      accountType: "seller",
    },
    {
      clerkId: sellerWithoutLikes,
      email: `${sellerWithoutLikes}@test.local`,
      name: "Seller Profile Without Likes",
      displayName: "Seller Without Likes",
      role: "seller",
      accountType: "seller",
    },
  ]);

  const [sellerAPost, sellerASecondPost, sellerBPost] = await db
    .insert(posts)
    .values([
      { userId: sellerA, mediaUrl: "https://example.com/seller-a-1.jpg" },
      { userId: sellerA, mediaUrl: "https://example.com/seller-a-2.jpg" },
      { userId: sellerB, mediaUrl: "https://example.com/seller-b-1.jpg" },
    ])
    .returning({ id: posts.id });
  postIds.push(sellerAPost.id, sellerASecondPost.id, sellerBPost.id);

  await db.insert(interactions).values([
    { userId: "buyer-1", postId: sellerAPost.id, type: "like" },
    { userId: "buyer-2", postId: sellerASecondPost.id, type: "like" },
    { userId: "buyer-3", postId: sellerAPost.id, type: "comment", value: "Nice look!" },
    { userId: "buyer-4", postId: sellerBPost.id, type: "like" },
  ]);

  authState.clerkUserId = sellerA;
  const { default: sellerProfileRouter } = await import("../seller-profile");
  const app = express();
  app.use(express.json());
  app.use("/api/seller", sellerProfileRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(interactions).where(inArray(interactions.postId, postIds));
  await db.delete(posts).where(inArray(posts.id, postIds));
  await db.delete(users).where(
    inArray(users.clerkId, [sellerA, sellerB, sellerWithoutLikes]),
  );
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function getProfile() {
  const response = await fetch(`${base}/api/seller/profile`);
  return {
    status: response.status,
    body: await response.json() as { totalLikes: number },
  };
}

describe("seller profile likes metric", () => {
  it("counts only likes on the authenticated seller's posts", async () => {
    authState.clerkUserId = sellerA;

    const result = await getProfile();

    expect(result.status).toBe(200);
    expect(result.body.totalLikes).toBe(2);
  });

  it("returns zero when the authenticated seller has no likes", async () => {
    authState.clerkUserId = sellerWithoutLikes;

    const result = await getProfile();

    expect(result.status).toBe(200);
    expect(result.body.totalLikes).toBe(0);
  });
});