import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { inArray } from "drizzle-orm";
import { db, hashtagFollows, postHashtags, posts, users } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const uid = req.header("x-test-user-id");
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    req.clerkUserId = uid;
    next();
  },
}));
vi.mock("../../lib/safety", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/safety")>();
  return { ...real, optionalViewerId: (req: any) => req.header("x-test-user-id") || null };
});

const suffix = crypto.randomBytes(5).toString("hex");
const author = `w1s06ht-author-${suffix}`;
const viewer = `w1s06ht-viewer-${suffix}`;
const tag = (n: string) => `w1s06${n}${suffix}`;
const postIds: string[] = [];
let server: Server;
let base = "";

async function call(method: string, urlPath: string, userId?: string) {
  const r = await fetch(`${base}${urlPath}`, { method, headers: userId ? { "x-test-user-id": userId } : {} });
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: author, email: `${author}@t.local`, name: "A", username: author.replace(/-/g, "_"), role: "buyer", accountType: "buyer" },
    { clerkId: viewer, email: `${viewer}@t.local`, name: "V", username: viewer.replace(/-/g, "_"), role: "buyer", accountType: "buyer" },
  ]);
  const { default: router } = await import("../hashtags");
  const app = express();
  app.use(express.json());
  app.use("/api/hashtags", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (postIds.length) await db.delete(posts).where(inArray(posts.id, postIds));
  await db.delete(hashtagFollows).where(inArray(hashtagFollows.userId, [author, viewer]));
  await db.delete(users).where(inArray(users.clerkId, [author, viewer]));
});

describe("hashtag cursor hardening", () => {
  it("ignores a recent-sort cursor whose id is not a uuid instead of 500ing", async () => {
    const t = tag("cur");
    const [p] = await db.insert(posts).values({
      userId: author, mediaUrl: "https://img.test/a.jpg", mediaUrls: [], mediaType: "photo",
      hashtags: [t], postStatus: "published", publishedAt: new Date(),
    }).returning();
    postIds.push(p.id);
    await db.insert(postHashtags).values({ postId: p.id, tag: t, createdAt: p.createdAt });
    const cursor = Buffer.from(`${new Date().toISOString()}|not-a-uuid`, "utf8").toString("base64url");
    const res = await call("GET", `/api/hashtags/${t}/posts?sort=recent&cursor=${cursor}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((x: any) => x.id)).toContain(p.id);
  });
});

describe("GET /api/hashtags/following", () => {
  it("returns per-tag post counts without one count query per followed tag", async () => {
    const tags = [tag("fa"), tag("fb"), tag("fc"), tag("fd"), tag("fe")];
    for (const [i, t] of tags.entries()) {
      for (let k = 0; k <= i % 3; k++) {
        const [p] = await db.insert(posts).values({
          userId: author, mediaUrl: "https://img.test/a.jpg", mediaUrls: [], mediaType: "photo",
          hashtags: [t], postStatus: "published", publishedAt: new Date(),
        }).returning();
        postIds.push(p.id);
        await db.insert(postHashtags).values({ postId: p.id, tag: t, createdAt: p.createdAt });
      }
    }
    await db.insert(hashtagFollows).values(tags.map((t) => ({ userId: viewer, tag: t })));

    const spy = vi.spyOn(db, "select");
    const res = await call("GET", "/api/hashtags/following", viewer);
    const selects = spy.mock.calls.length;
    spy.mockRestore();

    expect(res.status).toBe(200);
    const byTag = new Map(res.body.tags.map((x: any) => [x.tag, x.postCount]));
    tags.forEach((t, i) => expect(byTag.get(t)).toBe((i % 3) + 1));
    // 1 query for the follow list + 1 grouped count query (was 1 + N).
    expect(selects).toBeLessThanOrEqual(2);
  });
});
