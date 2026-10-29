/**
 * Wave 1 audit (slice s08): paging a root comment's replies must not repeat
 * the reply the cursor names. created_at keeps microseconds while the cursor
 * is a millisecond ISO string, so a plain `created_at > cursor` re-returned
 * the last reply of the previous page at the top of the next one.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray, sql } from "drizzle-orm";
import { db, postComments, posts, users } from "@workspace/db";

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
vi.mock("../notifications-feed", () => ({ publishNotification: vi.fn(async () => {}) }));

const suffix = crypto.randomBytes(6).toString("hex");
const owner = `w1s08-rc-owner-${suffix}`;
const replier = `w1s08-rc-replier-${suffix}`;
const userIds = [owner, replier];
const REPLY_COUNT = 53;

let server: Server;
let base = "";
let postId = "";
let rootId = "";
const replyIds: string[] = [];

async function call(path: string, userId: string | null) {
  const response = await fetch(`${base}${path}`, {
    headers: { "content-type": "application/json", ...(userId ? { "x-test-user-id": userId } : {}) },
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as any };
}

beforeAll(async () => {
  const mk = (clerkId: string) => ({
    clerkId, email: `${clerkId}@t.local`, name: clerkId, username: clerkId.replace(/-/g, "_"), role: "buyer", accountType: "buyer",
  });
  await db.insert(users).values([mk(owner), mk(replier)] as any);
  const [p] = await db.insert(posts).values({
    userId: owner, mediaUrl: `https://cdn.test/${suffix}.jpg`, mediaType: "image", postStatus: "published",
  } as any).returning({ id: posts.id });
  postId = p.id;
  const [root] = await db.insert(postComments).values({
    postId, authorId: owner, body: "root",
    createdAt: sql`now() - interval '1 day'`,
  } as any).returning({ id: postComments.id });
  rootId = root.id;
  for (let i = 0; i < REPLY_COUNT; i += 1) {
    // Each reply 1ms apart with a sub-millisecond component, like real rows.
    const [r] = await db.insert(postComments).values({
      postId, authorId: replier, parentId: rootId, body: `reply ${i}`,
      createdAt: sql`date_trunc('milliseconds', now() - interval '1 hour') + ${`${i} milliseconds 437 microseconds`}::interval`,
    } as any).returning({ id: postComments.id });
    replyIds.push(r.id);
  }
  const { default: router } = await import("../post-comments");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { error: () => {}, warn: () => {} }; next(); });
  app.use("/api/posts", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await db.delete(postComments).where(eq(postComments.postId, postId));
  await db.delete(posts).where(eq(posts.id, postId));
  await db.delete(users).where(inArray(users.clerkId, userIds));
});

describe("GET /api/posts/:postId/comments/:commentId/replies", () => {
  it("continues after the inline replies without repeating any", async () => {
    const thread = await call(`/api/posts/${postId}/comments`, owner);
    expect(thread.status).toBe(200);
    const root = thread.body.comments.find((c: any) => c.id === rootId);
    expect(root.replies).toHaveLength(50);
    expect(root.hasMoreReplies).toBe(true);
    expect(root.repliesNextCursor).toBeTruthy();

    const next = await call(
      `/api/posts/${postId}/comments/${rootId}/replies?after=${encodeURIComponent(root.repliesNextCursor)}`, owner,
    );
    expect(next.status).toBe(200);
    const seen = [...root.replies.map((r: any) => r.id), ...next.body.replies.map((r: any) => r.id)];
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual(replyIds);
    expect(next.body.repliesNextCursor).toBeNull();
  });
});
