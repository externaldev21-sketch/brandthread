/**
 * Wave-1 audit (slice s09) regressions for routes/posts.ts:
 *  - GET /feed with a negative limit must be clamped (drizzle silently drops a
 *    negative LIMIT, so the query used to run unbounded).
 *  - PATCH cannot edit or resurrect a deleted post.
 *  - PATCH draft -> published is posting, so a suspended account is refused.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, follows, posts, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `w1s09-seller-${suffix}`;
const suspendedId = `w1s09-susp-${suffix}`;
const buyerId = `w1s09-buyer-${suffix}`;
const authState = vi.hoisted(() => ({ clerkUserId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = authState.clerkUserId;
    next();
  },
}));

vi.mock("../post-video", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../post-video")>();
  return { ...actual, setComposedMediaVisibility: vi.fn(async () => undefined) };
});

let server: Server;
let base = "";

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  return { status: response.status, body: (await response.json()) as any };
}

async function insertPost(userId: string, overrides: Partial<typeof posts.$inferInsert> = {}) {
  const [row] = await db.insert(posts).values({
    userId,
    mediaUrl: "https://cdn.test/a.jpg",
    mediaUrls: ["https://cdn.test/a.jpg"],
    mediaType: "photo",
    caption: "w1s09",
    postStatus: "draft",
    ...overrides,
  }).returning();
  return row;
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: sellerId, email: `${sellerId}@test.local`, name: "S09 Seller", displayName: "S09 Seller", role: "seller", accountType: "seller" },
    {
      clerkId: suspendedId, email: `${suspendedId}@test.local`, name: "S09 Susp", displayName: "S09 Susp",
      role: "seller", accountType: "seller", suspendedAt: new Date(),
    },
    { clerkId: buyerId, email: `${buyerId}@test.local`, name: "S09 Buyer", displayName: "S09 Buyer", role: "buyer", accountType: "buyer" },
  ]);
  await db.insert(follows).values({ followerId: buyerId, followingId: sellerId });
  const { default: postsRouter } = await import("../posts");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { error: () => undefined, warn: () => undefined, info: () => undefined, debug: () => undefined };
    next();
  });
  app.use("/api/posts", postsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(follows).where(eq(follows.followerId, buyerId));
  await db.delete(posts).where(inArray(posts.userId, [sellerId, suspendedId]));
  await db.delete(users).where(inArray(users.clerkId, [sellerId, suspendedId, buyerId]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/posts/feed limit clamp", () => {
  it("clamps a negative limit to one row instead of running unbounded", async () => {
    for (let i = 0; i < 3; i++) {
      await insertPost(sellerId, {
        postStatus: "published", surface: "thread", publishedAt: new Date(), caption: `feed ${i}`,
        createdAt: new Date(Date.now() - i * 1000),
      });
    }
    authState.clerkUserId = buyerId;
    const all = await request("/api/posts/feed");
    expect(all.status).toBe(200);
    expect(all.body.length).toBeGreaterThanOrEqual(3);
    const res = await request("/api/posts/feed?limit=-5");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe("PATCH /api/posts/:id lifecycle guards", () => {
  it("does not resurrect or edit a deleted post", async () => {
    authState.clerkUserId = sellerId;
    const deleted = await insertPost(sellerId, { postStatus: "deleted" });
    const res = await request(`/api/posts/${deleted.id}`, {
      method: "PATCH", body: JSON.stringify({ postStatus: "published", caption: "back" }),
    });
    expect(res.status).toBe(404);
    const [row] = await db.select().from(posts).where(eq(posts.id, deleted.id));
    expect(row.postStatus).toBe("deleted");
    expect(row.caption).toBe("w1s09");
  });

  it("refuses to publish a draft for a suspended account", async () => {
    authState.clerkUserId = suspendedId;
    const draft = await insertPost(suspendedId);
    const res = await request(`/api/posts/${draft.id}`, {
      method: "PATCH", body: JSON.stringify({ isDraft: false }),
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_SUSPENDED");
    const [row] = await db.select().from(posts).where(eq(posts.id, draft.id));
    expect(row.postStatus).toBe("draft");
  });

  it("still lets a suspended account keep editing a draft", async () => {
    authState.clerkUserId = suspendedId;
    const draft = await insertPost(suspendedId);
    const res = await request(`/api/posts/${draft.id}`, {
      method: "PATCH", body: JSON.stringify({ caption: "still a draft" }),
    });
    expect(res.status).toBe(200);
    expect(res.body.postStatus).toBe("draft");
  });

  it("publishes a draft for an account in good standing", async () => {
    authState.clerkUserId = sellerId;
    const draft = await insertPost(sellerId);
    const res = await request(`/api/posts/${draft.id}`, {
      method: "PATCH", body: JSON.stringify({ isDraft: false }),
    });
    expect(res.status).toBe(200);
    expect(res.body.postStatus).toBe("published");
  });
});
