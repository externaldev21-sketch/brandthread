import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { inArray } from "drizzle-orm";
import { db, interactions, postComments, posts, users } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id");
    next();
  },
}));

const suffix = crypto.randomBytes(6).toString("hex");
const id = (n: string) => `ba-${n}-${suffix}`;
const seller = id("seller");
const buyer = id("buyer");
const other = id("other");
const userIds = [seller, buyer, other];

let server: Server;
let base = "";

async function get(userId: string) {
  const r = await fetch(`${base}/api/buyer/activity`, { headers: { "x-test-user-id": userId } });
  return { status: r.status, body: (await r.json()) as any };
}

async function seedPost(extra: Record<string, unknown> = {}) {
  const [row] = await db.insert(posts).values({
    userId: seller, mediaUrl: "https://img.test/a.jpg", mediaType: "photo", caption: "spring tee", ...extra,
  } as any).returning({ id: posts.id });
  return row.id;
}

let visiblePost = "";
let secondPost = "";
let removedPost = "";

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: seller, email: `${seller}@t.local`, name: "Seller", displayName: "Nova Studio", username: id("s").replace(/-/g, "_"), role: "seller", accountType: "seller" },
    { clerkId: buyer, email: `${buyer}@t.local`, name: "Buyer", displayName: "Buyer B", username: id("b").replace(/-/g, "_"), role: "buyer", accountType: "buyer" },
    { clerkId: other, email: `${other}@t.local`, name: "Other", displayName: "Other O", username: id("o").replace(/-/g, "_"), role: "buyer", accountType: "buyer" },
  ] as any);
  visiblePost = await seedPost();
  secondPost = await seedPost({ caption: "denim" });
  removedPost = await seedPost({ moderationStatus: "removed" });

  await db.insert(interactions).values([
    { userId: buyer, postId: visiblePost, type: "like", createdAt: new Date(Date.now() - 60_000) },
    { userId: buyer, postId: secondPost, type: "like" },
    { userId: buyer, postId: removedPost, type: "like" },
    { userId: buyer, postId: visiblePost, type: "view" },
    { userId: other, postId: visiblePost, type: "like" },
  ] as any);
  await db.insert(postComments).values([
    { postId: visiblePost, authorId: buyer, body: "love this" },
    { postId: secondPost, authorId: buyer, body: "pending review", moderationStatus: "held" },
    { postId: secondPost, authorId: buyer, body: "gone", moderationStatus: "removed" },
    { postId: removedPost, authorId: buyer, body: "on a removed post" },
    { postId: visiblePost, authorId: other, body: "not mine" },
  ] as any);

  const { default: router } = await import("../buyer-activity");
  const app = express();
  app.use(express.json());
  app.use("/api/buyer/activity", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const postIds = [visiblePost, secondPost, removedPost].filter(Boolean);
  if (postIds.length) {
    await db.delete(postComments).where(inArray(postComments.postId, postIds));
    await db.delete(interactions).where(inArray(interactions.postId, postIds));
    await db.delete(posts).where(inArray(posts.id, postIds));
  }
  await db.delete(users).where(inArray(users.clerkId, userIds));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/buyer/activity", () => {
  it("returns only my current likes on visible posts, newest first", async () => {
    const r = await get(buyer);
    expect(r.status).toBe(200);
    expect(r.body.likes.total).toBe(2);
    expect(r.body.likes.items.map((i: any) => i.postId)).toEqual([secondPost, visiblePost]);
    expect(r.body.likes.items[0]).toMatchObject({ authorId: seller, authorName: "Nova Studio", caption: "denim" });
  });

  it("returns my non-removed comments on visible posts (held ones included for the author)", async () => {
    const r = await get(buyer);
    expect(r.body.comments.total).toBe(2);
    const bodies = r.body.comments.items.map((i: any) => i.body).sort();
    expect(bodies).toEqual(["love this", "pending review"]);
    expect(r.body.comments.items[0]).toMatchObject({ authorName: "Nova Studio", isReply: false });
  });

  it("is scoped to the caller", async () => {
    const r = await get(other);
    expect(r.body.likes.total).toBe(1);
    expect(r.body.comments.items.map((i: any) => i.body)).toEqual(["not mine"]);
    const empty = await get(seller);
    expect(empty.body).toEqual({ likes: { total: 0, items: [] }, comments: { total: 0, items: [] } });
  });
});
