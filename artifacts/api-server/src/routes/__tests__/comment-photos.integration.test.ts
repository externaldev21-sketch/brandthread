/**
 * Photo replies in comments (F6 item 83): moderated upload, attach on
 * POST .../comments, `media` in list + replies, and the safety rules
 * (own uploads only, single use, held photos hold the comment).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import sharp from "sharp";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import { db, mediaModerationResults, postCommentMedia, postComments, posts, reports, users } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const who = req.header("x-test-user-id");
    if (!who) return res.status(401).json({ error: "Unauthorized" });
    req.clerkUserId = who;
    next();
  },
}));
vi.mock("../../middlewares/rateLimit", () => ({ rateLimit: () => (_q: any, _s: any, next: () => void) => next() }));
vi.mock("../../lib/safety", async (orig) => {
  const actual: any = await orig();
  return { ...actual, optionalViewerId: (req: any) => req.header("x-test-user-id") || null };
});
vi.mock("../notifications-feed", () => ({ publishNotification: async () => {} }));

import { setCommentMediaStore } from "../../lib/commentMedia";
import { setMediaModerationProvider } from "../../lib/mediaModeration";

const BUCKET = "test-bucket-comment-photos";
const suffix = crypto.randomBytes(6).toString("hex");
const id = (n: string) => `cp-${n}-${suffix}`;
const owner = id("owner");
const alice = id("alice");
const bob = id("bob");
const userIds = [owner, alice, bob];
const h = (u: string) => u.replace(/-/g, "_");

let server: Server;
let base = "";
let postId = "";
let storeCalls = 0;

async function call(path: string, userId: string | null, method = "GET", body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(userId ? { "x-test-user-id": userId } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as any };
}

async function pngBase64(width = 40, height = 30) {
  const buf = await sharp({ create: { width, height, channels: 3, background: { r: 200, g: 200, b: 200 } } }).png().toBuffer();
  return buf.toString("base64");
}
const upload = async (who: string | null, data?: string, mimeType = "image/png") =>
  call("/api/comment-media/upload", who, "POST", { data: data ?? (await pngBase64()), mimeType });
const comment = (who: string, payload: Record<string, unknown>) =>
  call(`/api/posts/${postId}/comments`, who, "POST", payload);
const list = (who: string | null) => call(`/api/posts/${postId}/comments`, who);

beforeAll(async () => {
  process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = BUCKET;
  const mk = (clerkId: string) => ({
    clerkId, email: `${clerkId}@t.local`, name: clerkId, username: h(clerkId), role: "buyer", accountType: "buyer",
  });
  await db.insert(users).values([mk(owner), mk(alice), mk(bob)] as any);
  const [p] = await db.insert(posts).values({
    userId: owner, mediaUrl: `https://cdn.test/${suffix}.jpg`, mediaType: "image", postStatus: "published",
  }).returning({ id: posts.id });
  postId = p.id;

  const { default: commentsRouter } = await import("../post-comments");
  const { default: mediaRouter } = await import("../comment-media");
  const app = express();
  app.use(express.json({ limit: "45mb" }));
  app.use("/api/posts", commentsRouter);
  app.use("/api/comment-media", mediaRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  storeCalls = 0;
  setCommentMediaStore(async ({ userId }) => {
    storeCalls += 1;
    return `https://storage.googleapis.com/${BUCKET}/comment-media/${userId}/${crypto.randomUUID()}.jpg`;
  });
  setMediaModerationProvider();
});

afterAll(async () => {
  setCommentMediaStore();
  setMediaModerationProvider();
  await db.delete(reports).where(inArray(reports.targetOwnerId, userIds));
  await db.delete(mediaModerationResults).where(inArray(mediaModerationResults.ownerId, userIds));
  await db.delete(postCommentMedia).where(inArray(postCommentMedia.ownerId, userIds));
  await db.delete(posts).where(eq(posts.id, postId));
  await db.delete(users).where(inArray(users.clerkId, userIds));
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

describe("POST /api/comment-media/upload", () => {
  it("requires sign-in and a real JPEG/PNG/WebP photo", async () => {
    expect((await upload(null)).status).toBe(401);
    expect((await upload(alice, await pngBase64(), "image/gif")).status).toBe(400);
    expect((await upload(alice, "not base64 !!")).status).toBe(400);
    const notImage = await upload(alice, Buffer.from("hello world, not a photo").toString("base64"));
    expect(notImage.status).toBe(400);
    expect(notImage.body.code).toBe("NOT_AN_IMAGE");
    expect(storeCalls).toBe(0);
  });

  it("stores a re-encoded photo, caps the long edge and returns its size", async () => {
    const res = await upload(alice, `data:image/png;base64,${await pngBase64(2400, 1200)}`);
    expect(res.status).toBe(201);
    expect(res.body.media).toMatchObject({ width: 1600, height: 800 });
    expect(res.body.media.url).toMatch(new RegExp(`^https://storage.googleapis.com/${BUCKET}/comment-media/${alice}/`));
    const [row] = await db.select().from(postCommentMedia).where(eq(postCommentMedia.id, res.body.media.id));
    expect(row.ownerId).toBe(alice);
    expect(row.commentId).toBeNull();
    // Screening is off without the AI env, which never blocks.
    expect(row.moderationVerdict).toBe("skipped");
  });

  it("refuses a photo the screening rejects and never stores it", async () => {
    setMediaModerationProvider(async () => ({ flags: {}, scores: { "sexual/minors": 0.9 } }));
    const res = await upload(bob);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("IMAGE_REJECTED");
    expect(storeCalls).toBe(0);
    expect(await db.select().from(postCommentMedia).where(eq(postCommentMedia.ownerId, bob))).toHaveLength(0);
    await vi.waitFor(async () => {
      const rows = await db.select().from(mediaModerationResults)
        .where(and(eq(mediaModerationResults.ownerId, bob), eq(mediaModerationResults.surface, "comment")));
      expect(rows).toHaveLength(1);
    });
  });

  it("answers 503 when storage is not configured", async () => {
    setCommentMediaStore();
    const saved = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    delete process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    try {
      const res = await upload(alice);
      expect(res.status).toBe(503);
    } finally {
      process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = saved;
    }
  });
});

describe("photo comments", () => {
  let photoCommentId = "";
  let mediaUrl = "";

  it("posts a photo-only comment and returns media", async () => {
    const up = await upload(alice);
    mediaUrl = up.body.media.url;
    const res = await comment(alice, { body: "  ", media: { id: up.body.media.id } });
    expect(res.status).toBe(201);
    photoCommentId = res.body.comment.id;
    expect(res.body.comment.body).toBe("");
    expect(res.body.comment.media).toEqual(up.body.media);
    expect(res.body.comment.pendingReview).toBe(false);
  });

  it("lists media for everyone, including signed-out readers", async () => {
    const view = await list(null);
    const row = view.body.comments.find((c: any) => c.id === photoCommentId);
    expect(row.media.url).toBe(mediaUrl);
    expect(row.media.width).toBe(40);
    expect(row.media.height).toBe(30);
    // Text-only comments carry media: null.
    const textOnly = await comment(bob, { body: "nice" });
    expect(textOnly.body.comment.media).toBeNull();
    const again = await list(bob);
    expect(again.body.comments.find((c: any) => c.id === textOnly.body.comment.id).media).toBeNull();
  });

  it("photo replies show inline and on the replies page; ref by url works", async () => {
    const up = await upload(bob);
    const res = await comment(bob, { body: "this one", parentId: photoCommentId, media: { url: up.body.media.url } });
    expect(res.status).toBe(201);
    expect(res.body.comment.media.id).toBe(up.body.media.id);
    const view = await list(null);
    const root = view.body.comments.find((c: any) => c.id === photoCommentId);
    expect(root.replies[0].media.url).toBe(up.body.media.url);
    const replies = await call(`/api/posts/${postId}/comments/${photoCommentId}/replies`, null);
    expect(replies.body.replies[0].media.url).toBe(up.body.media.url);
  });

  it("needs text or a photo", async () => {
    const res = await comment(alice, { body: "" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("refuses arbitrary URLs, other people's uploads and reused uploads", async () => {
    const external = await comment(alice, { body: "x", media: { url: "https://evil.example/cat.jpg" } });
    expect(external.status).toBe(400);
    const otherBucket = await comment(alice, { body: "x", media: { url: `https://storage.googleapis.com/${BUCKET}/community/x.jpg` } });
    expect(otherBucket.status).toBe(400);
    expect((await comment(alice, { body: "x", media: "https://evil.example/cat.jpg" })).status).toBe(400);

    const bobs = await upload(bob);
    const stolen = await comment(alice, { body: "x", media: { id: bobs.body.media.id } });
    expect(stolen.status).toBe(400);
    expect(stolen.body.code).toBe("MEDIA_NOT_FOUND");

    // Already attached to the first photo comment.
    const [used] = await db.select().from(postCommentMedia).where(eq(postCommentMedia.commentId, photoCommentId));
    const reused = await comment(alice, { body: "x", media: { id: used.id } });
    expect(reused.status).toBe(400);
    expect(reused.body.code).toBe("MEDIA_NOT_FOUND");
    // Nothing was written for the refused attempts.
    const rows = await db.select().from(postComments).where(and(eq(postComments.postId, postId), eq(postComments.body, "x")));
    expect(rows).toHaveLength(0);
  });

  it("a photo the screening holds keeps the comment in review", async () => {
    setMediaModerationProvider(async () => ({ flags: {}, scores: { sexual: 0.7 } }));
    const up = await upload(bob);
    expect(up.status).toBe(201);
    setMediaModerationProvider();
    const res = await comment(bob, { body: "look", media: { id: up.body.media.id } });
    expect(res.status).toBe(201);
    expect(res.body.comment.pendingReview).toBe(true);
    expect(res.body.moderation.status).toBe("held");
    const heldId = res.body.comment.id;

    expect((await list(alice)).body.comments.some((c: any) => c.id === heldId)).toBe(false);
    const mine = (await list(bob)).body.comments.find((c: any) => c.id === heldId);
    expect(mine.pendingReview).toBe(true);
    expect(mine.media.id).toBe(up.body.media.id);

    const queued = await db.select().from(reports)
      .where(and(eq(reports.targetType, "comment"), eq(reports.targetId, heldId)));
    expect(queued).toHaveLength(1);
    expect(queued[0].reason).toBe("nudity");
  });

  it("deleting the comment removes its photo row", async () => {
    const del = await call(`/api/posts/${postId}/comments/${photoCommentId}`, alice, "DELETE");
    expect(del.status).toBe(200);
    const rows = await db.select().from(postCommentMedia).where(eq(postCommentMedia.url, mediaUrl));
    expect(rows).toHaveLength(0);
  });
});
