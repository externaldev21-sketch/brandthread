import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, blocks, follows, interactions, posts, users } from "@workspace/db";
import { and, eq, inArray, or } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const viewer = `repost-context-viewer-${suffix}`;
const mutual = `repost-context-mutual-${suffix}`;
const oneWay = `repost-context-one-way-${suffix}`;
const seller = `repost-context-seller-${suffix}`;
const cappedFriends = Array.from({ length: 6 }, (_, index) => `repost-context-cap-${index}-${suffix}`);
const postIds: string[] = [];
const authState = vi.hoisted(() => ({ clerkUserId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!authState.clerkUserId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    req.clerkUserId = authState.clerkUserId;
    next();
  },
}));

let server: Server;
let base = "";

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${base}${path}`, init);
  return {
    status: response.status,
    body: response.status === 204 ? null : await response.json() as any,
  };
}

beforeAll(async () => {
  await db.insert(users).values([
    {
      clerkId: viewer,
      email: `${viewer}@test.local`,
      name: "Repost Viewer",
      displayName: "Repost Viewer",
      role: "buyer",
      accountType: "buyer",
    },
    {
      clerkId: mutual,
      email: `${mutual}@test.local`,
      name: "Mutual Friend",
      displayName: "Mutual Friend",
      profileImageUrl: "https://cdn.test/mutual-profile.jpg",
      avatarUrl: "https://cdn.test/mutual-avatar.jpg",
      role: "buyer",
      accountType: "buyer",
    },
    {
      clerkId: oneWay,
      email: `${oneWay}@test.local`,
      name: "One Way Follow",
      displayName: "One Way Follow",
      avatarUrl: "https://cdn.test/one-way.jpg",
      role: "buyer",
      accountType: "buyer",
    },
    {
      clerkId: seller,
      email: `${seller}@test.local`,
      name: "Seller Reposter",
      displayName: "Seller Reposter",
      avatarUrl: "https://cdn.test/seller.jpg",
      role: "seller",
      accountType: "seller",
    },
    ...cappedFriends.map((clerkId, index) => ({
      clerkId,
      email: `${clerkId}@test.local`,
      name: `Capped Friend ${index}`,
      displayName: `Capped Friend ${index}`,
      avatarUrl: `https://cdn.test/capped-${index}.jpg`,
      role: "buyer",
      accountType: "buyer",
    })),
  ]);

  await db.insert(follows).values([
    { followerId: viewer, followingId: mutual },
    { followerId: mutual, followingId: viewer },
    { followerId: viewer, followingId: oneWay },
    { followerId: viewer, followingId: seller },
    { followerId: seller, followingId: viewer },
    ...cappedFriends.flatMap((friend) => [
      { followerId: viewer, followingId: friend },
      { followerId: friend, followingId: viewer },
    ]),
  ]);

  const [post] = await db.insert(posts).values({
    userId: seller,
    mediaUrl: "https://cdn.test/repost-context.mp4",
    mediaUrls: ["https://cdn.test/repost-context.mp4"],
    mediaType: "video",
    caption: "Repost context test",
  }).returning({ id: posts.id });
  postIds.push(post.id);

  await db.insert(interactions).values([
    { userId: mutual, postId: post.id, type: "repost" },
    { userId: oneWay, postId: post.id, type: "repost" },
    { userId: seller, postId: post.id, type: "repost" },
    { userId: viewer, postId: post.id, type: "repost" },
    ...cappedFriends.map((userId) => ({ userId, postId: post.id, type: "repost" })),
  ]);

  const app = express();
  const { default: postsRouter } = await import("../posts");
  app.use(express.json());
  app.use("/api/posts", postsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(interactions).where(inArray(interactions.postId, postIds));
  await db.delete(posts).where(inArray(posts.id, postIds));
  await db.delete(blocks).where(or(
    eq(blocks.blockerId, viewer),
    eq(blocks.blockedId, viewer),
  ));
  await db.delete(follows).where(or(
    eq(follows.followerId, viewer),
    eq(follows.followingId, viewer),
    eq(follows.followerId, mutual),
    eq(follows.followingId, mutual),
    eq(follows.followerId, oneWay),
    eq(follows.followingId, oneWay),
    eq(follows.followerId, seller),
    eq(follows.followingId, seller),
  ));
  await db.delete(users).where(inArray(users.clerkId, [viewer, mutual, oneWay, seller, ...cappedFriends]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("friend-only repost avatar context", () => {
  it("requires authentication and validates bounded UUID input", async () => {
    authState.clerkUserId = "";
    expect((await request(`/api/posts/repost-context?postIds=${postIds[0]}`)).status).toBe(401);

    authState.clerkUserId = viewer;
    expect((await request("/api/posts/repost-context")).status).toBe(400);
    expect((await request("/api/posts/repost-context?postIds=not-a-uuid")).status).toBe(400);
    expect((await request(`/api/posts/repost-context?postIds=${postIds[0]},${postIds[0]}`)).status).toBe(200);
  });

  it("rejects seller viewers even when reciprocal follow rows exist", async () => {
    authState.clerkUserId = seller;
    const response = await request(`/api/posts/repost-context?postIds=${postIds[0]}`);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "Buyer account required" });
  });

  it("returns only mutual buyer reposters and prefers profileImageUrl", async () => {
    authState.clerkUserId = viewer;
    const response = await request(`/api/posts/repost-context?postIds=${postIds[0]}`);
    expect(response.status).toBe(200);
    expect(response.body[postIds[0]].repostedByMe).toBe(true);
    const actors = response.body[postIds[0]].reposters as any[];
    expect(actors).toHaveLength(5);
    expect(actors.find((actor) => actor.userId === mutual)).toMatchObject({
      userId: mutual,
      displayName: "Mutual Friend",
      avatarUrl: "https://cdn.test/mutual-profile.jpg",
    });
    expect(actors.map((actor) => actor.userId)).not.toEqual(expect.arrayContaining([oneWay, seller, viewer]));
    expect(actors[0]).not.toHaveProperty("email");

    await db.delete(interactions).where(and(
      eq(interactions.userId, viewer),
      eq(interactions.postId, postIds[0]),
      eq(interactions.type, "repost"),
    ));
    const removed = await request(`/api/posts/repost-context?postIds=${postIds[0]}`);
    expect(removed.body[postIds[0]].repostedByMe).toBe(false);
    await db.insert(interactions).values({ userId: viewer, postId: postIds[0], type: "repost" });
  });

  it("defensively excludes a mutually-followed actor after either side blocks", async () => {
    authState.clerkUserId = viewer;
    await db.insert(blocks).values({ blockerId: mutual, blockedId: viewer });
    const response = await request(`/api/posts/repost-context?postIds=${postIds[0]}`);
    expect(response.status).toBe(200);
    expect(response.body[postIds[0]].repostedByMe).toBe(true);
    expect((response.body[postIds[0]].reposters ?? []).map((actor: any) => actor.userId)).not.toContain(mutual);
  });

  it("does not reveal repost identities for a non-public post UUID", async () => {
    authState.clerkUserId = viewer;
    const [privatePost] = await db.insert(posts).values({
      userId: seller,
      mediaUrl: "https://cdn.test/private-repost-context.mp4",
      mediaUrls: ["https://cdn.test/private-repost-context.mp4"],
      mediaType: "video",
      caption: "Private repost context test",
      visibility: { isPublic: false, allowComments: true, allowReposts: true, showLikeCount: true },
    }).returning({ id: posts.id });
    postIds.push(privatePost.id);
    await db.insert(interactions).values([
      { userId: mutual, postId: privatePost.id, type: "repost" },
      { userId: viewer, postId: privatePost.id, type: "repost" },
    ]);

    const response = await request(`/api/posts/repost-context?postIds=${privatePost.id}`);
    expect(response.status).toBe(200);
    expect(response.body[privatePost.id]).toEqual({
      repostedByMe: false,
      reposters: [],
    });
  });

  it("caps the requested post IDs and recent reposters", async () => {
    authState.clerkUserId = viewer;
    const tooMany = Array.from({ length: 51 }, () => postIds[0]).join(",");
    // Duplicates are normalized before the cap, so use syntactically valid IDs.
    const uniqueIds = Array.from({ length: 51 }, () => crypto.randomUUID()).join(",");
    expect((await request(`/api/posts/repost-context?postIds=${tooMany}`)).status).toBe(200);
    expect((await request(`/api/posts/repost-context?postIds=${uniqueIds}`)).status).toBe(400);
    const response = await request(`/api/posts/repost-context?postIds=${postIds[0]}`);
    expect(response.body[postIds[0]].repostedByMe).toBe(true);
    expect(response.body[postIds[0]].reposters).toHaveLength(5);
  });

  it("keeps rapid duplicate add and remove requests idempotent", async () => {
    authState.clerkUserId = viewer;
    await db.delete(interactions).where(and(
      eq(interactions.userId, viewer),
      eq(interactions.postId, postIds[0]),
      eq(interactions.type, "repost"),
    ));
    const postRepost = () => request(`/api/posts/${postIds[0]}/interact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "repost" }),
    });
    const removeRepost = () => request(`/api/posts/${postIds[0]}/interact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "repost", value: "remove" }),
    });

    const added = await Promise.all([postRepost(), postRepost()]);
    expect(added.every((response) => response.status === 200)).toBe(true);
    expect(added.every((response) => response.body.action === "added")).toBe(true);
    expect(await db.select({ id: interactions.id }).from(interactions).where(and(
      eq(interactions.userId, viewer),
      eq(interactions.postId, postIds[0]),
      eq(interactions.type, "repost"),
    ))).toHaveLength(1);

    const removed = await Promise.all([removeRepost(), removeRepost()]);
    expect(removed.every((response) => response.status === 200)).toBe(true);
    expect(removed.every((response) => response.body.action === "removed")).toBe(true);
    expect(await db.select({ id: interactions.id }).from(interactions).where(and(
      eq(interactions.userId, viewer),
      eq(interactions.postId, postIds[0]),
      eq(interactions.type, "repost"),
    ))).toHaveLength(0);

    await db.insert(interactions).values({ userId: viewer, postId: postIds[0], type: "repost" });
  });
});