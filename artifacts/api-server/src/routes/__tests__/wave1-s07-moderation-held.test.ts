/**
 * Wave 1 / s07: the held-content queue's cursor must not re-serve the last
 * item of a page. created_at keeps microseconds; the cursor is a JS Date
 * (milliseconds), so two items in the same millisecond used to make page 2
 * start with page 1's last item again.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { db, postComments, posts } from "@workspace/db";

vi.mock("../../lib/safety", () => ({ profilesById: async () => new Map() }));

const suffix = crypto.randomBytes(6).toString("hex");
const author = `w1-s07-held-${suffix}`;
const postIds: string[] = [];
const commentIds: string[] = [];
let server: Server;
let base = "";

beforeAll(async () => {
  // Far in the past so they sort ahead of anything else held in the DB.
  const heldPosts = await db.insert(posts).values([
    { userId: author, mediaUrl: "https://example.test/a.jpg", moderationStatus: "held", createdAt: sql`'2001-02-03 04:05:06.123400'::timestamp` as any },
    { userId: author, mediaUrl: "https://example.test/b.jpg", moderationStatus: "held", createdAt: sql`'2001-02-03 04:05:06.123700'::timestamp` as any },
  ]).returning({ id: posts.id });
  postIds.push(...heldPosts.map((p) => p.id));
  const heldComments = await db.insert(postComments).values([
    { postId: postIds[0], authorId: author, body: "first", moderationStatus: "held", createdAt: sql`'2001-02-03 04:05:06.123400+00'::timestamptz` as any },
    { postId: postIds[0], authorId: author, body: "second", moderationStatus: "held", createdAt: sql`'2001-02-03 04:05:06.123700+00'::timestamptz` as any },
  ]).returning({ id: postComments.id });
  commentIds.push(...heldComments.map((c) => c.id));

  const { default: heldRouter } = await import("../moderationHeld");
  const app = express();
  app.use((req: any, _res, next) => { req.clerkUserId = "mod"; req.log = { error: () => undefined }; next(); });
  app.use("/held", heldRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (commentIds.length) await db.delete(postComments).where(inArray(postComments.id, commentIds));
  if (postIds.length) await db.delete(posts).where(inArray(posts.id, postIds));
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

async function page(type: string, cursor?: string) {
  const qs = new URLSearchParams({ type, limit: "1", ...(cursor ? { cursor } : {}) });
  const response = await fetch(`${base}/held?${qs}`);
  expect(response.status).toBe(200);
  return response.json() as Promise<{ items: Array<{ id: string }>; nextCursor: string | null }>;
}

describe("held queue cursor", () => {
  for (const [type, ids] of [["post", postIds], ["comment", commentIds]] as const) {
    it(`pages ${type}s in the same millisecond without repeating`, async () => {
      // Within one millisecond the queue orders by id, so either may come first.
      const first = await page(type);
      expect(first.items).toHaveLength(1);
      expect(ids).toContain(first.items[0].id);
      expect(first.nextCursor).toBeTruthy();
      const second = await page(type, first.nextCursor!);
      expect(second.items).toHaveLength(1);
      expect([first.items[0].id, second.items[0].id].sort()).toEqual([...ids].sort());
    });
  }
});
