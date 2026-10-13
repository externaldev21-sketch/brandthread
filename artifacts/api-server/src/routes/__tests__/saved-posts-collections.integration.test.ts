/**
 * F6 item 89 — save posts to collections (Instagram "Save to collection").
 * Saved posts carry their thumbnail (tiles + auto cover), can be filed into /
 * moved between the caller's own boards, and never into someone else's.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import { db, posts, savedCollections, savedItems, users } from "@workspace/db";

const auth = vi.hoisted(() => ({ userId: "" }));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });
    req.clerkUserId = auth.userId;
    next();
  },
}));
vi.mock("../../lib/activityEvents", async (orig) => ({
  ...(await orig<typeof import("../../lib/activityEvents")>()),
  notifyPostSave: async () => {},
}));
vi.mock("../../lib/ranking/forYou", async (orig) => ({
  ...(await orig<typeof import("../../lib/ranking/forYou")>()),
  applyEventToProfile: async () => {},
}));

const suffix = crypto.randomBytes(6).toString("hex");
const buyer = `spc-buyer-${suffix}`;
const other = `spc-other-${suffix}`;
const author = `spc-author-${suffix}`;
let server: Server;
let base = "";
let photoPost = "";
let videoPost = "";
let privatePost = "";
let boardId = "";
let othersBoardId = "";

async function call(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
const as = (user: string) => { auth.userId = user; };

beforeAll(async () => {
  await db.insert(users).values([buyer, other, author].map((clerkId) => ({
    clerkId, email: `${clerkId}@t.local`, name: clerkId, username: clerkId.replace(/-/g, "_"), role: "buyer", accountType: "buyer",
  })) as any);
  const inserted = await db.insert(posts).values([
    { userId: author, mediaUrl: `https://cdn.test/${suffix}-photo.jpg`, mediaType: "photo", postStatus: "published" },
    { userId: author, mediaUrl: `https://cdn.test/${suffix}.mp4`, mediaType: "video", postStatus: "published" },
    {
      userId: author, mediaUrl: `https://cdn.test/${suffix}-private.jpg`, mediaType: "photo", postStatus: "published",
      visibility: { isPublic: false } as any,
    },
  ]).returning({ id: posts.id });
  [photoPost, videoPost, privatePost] = inserted.map((r) => r.id);
  const [mine] = await db.insert(savedCollections).values({ userId: buyer, name: "Fits" }).returning();
  const [theirs] = await db.insert(savedCollections).values({ userId: other, name: "Theirs" }).returning();
  boardId = mine.id;
  othersBoardId = theirs.id;

  const { default: savedRouter } = await import("../saved");
  const { default: collectionsRouter } = await import("../collections");
  const app = express();
  app.use(express.json());
  app.use("/api/buyer/saved", savedRouter);
  app.use("/api/buyer/collections", collectionsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(savedItems).where(inArray(savedItems.userId, [buyer, other]));
  await db.delete(savedCollections).where(inArray(savedCollections.userId, [buyer, other]));
  await db.delete(posts).where(eq(posts.userId, author));
  await db.delete(users).where(inArray(users.clerkId, [buyer, other, author]));
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

describe("saving posts into collections", () => {
  it("saves a post to All with its thumbnail", async () => {
    as(buyer);
    const res = await call("/api/buyer/saved", "POST", { type: "post", targetId: photoPost, title: "Look" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ type: "post", targetId: photoPost, image: `https://cdn.test/${suffix}-photo.jpg` });
    expect(res.body.collectionId).toBeUndefined();
  });

  it("moves the saved post into the buyer's own collection (Save to collection)", async () => {
    as(buyer);
    const moved = await call(`/api/buyer/saved/${photoPost}`, "PATCH", { collectionId: boardId });
    expect(moved.status).toBe(200);
    expect(moved.body.collectionId).toBe(boardId);

    const board = await call(`/api/buyer/collections/${boardId}/items`);
    expect(board.status).toBe(200);
    expect(board.body.items).toHaveLength(1);
    expect(board.body.items[0]).toMatchObject({ type: "post", targetId: photoPost, image: `https://cdn.test/${suffix}-photo.jpg` });
    expect(board.body.collection.itemCount).toBe(1);
    // A board holding only posts gets the post's photo as its auto cover.
    expect(board.body.collection.coverImageUrl).toBe(`https://cdn.test/${suffix}-photo.jpg`);

    const list = await call("/api/buyer/collections");
    expect(list.body.find((c: any) => c.id === boardId)).toMatchObject({ itemCount: 1, coverImageUrl: `https://cdn.test/${suffix}-photo.jpg` });
  });

  it("saves straight into a collection and can un-file back to All", async () => {
    as(buyer);
    const res = await call("/api/buyer/saved", "POST", { type: "post", targetId: videoPost, title: "Clip", collectionId: boardId });
    expect(res.status).toBe(201);
    expect(res.body.collectionId).toBe(boardId);
    // A video with no thumbnail has no still to show.
    expect(res.body.image).toBeUndefined();

    const back = await call(`/api/buyer/saved/${videoPost}`, "PATCH", { collectionId: null });
    expect(back.status).toBe(200);
    expect(back.body.collectionId).toBeUndefined();
  });

  it("never files into someone else's collection", async () => {
    as(buyer);
    const patch = await call(`/api/buyer/saved/${photoPost}`, "PATCH", { collectionId: othersBoardId });
    expect(patch.status).toBe(404);
    const garbage = await call(`/api/buyer/saved/${photoPost}`, "PATCH", { collectionId: "not-a-uuid" });
    expect(garbage.status).toBe(404);
    const [row] = await db.select().from(savedItems).where(eq(savedItems.targetId, photoPost));
    expect(row.collectionId).toBe(boardId);

    const post = await call("/api/buyer/saved", "POST", { type: "post", targetId: privatePost, title: "x", collectionId: othersBoardId });
    expect(post.status).toBe(404);
    as(other);
    const theirs = await call(`/api/buyer/collections/${othersBoardId}/items`);
    expect(theirs.body.items).toHaveLength(0);
  });

  it("does not show a thumbnail for a post that is no longer public", async () => {
    as(buyer);
    await db.insert(savedItems).values({ userId: buyer, itemType: "post", targetId: privatePost, title: "Gone", collectionId: boardId });
    const board = await call(`/api/buyer/collections/${boardId}/items`);
    const item = board.body.items.find((i: any) => i.targetId === privatePost);
    expect(item.image).toBeUndefined();
  });

  it("requires sign-in", async () => {
    auth.userId = "";
    expect((await call(`/api/buyer/saved/${photoPost}`, "PATCH", { collectionId: boardId })).status).toBe(401);
  });
});
