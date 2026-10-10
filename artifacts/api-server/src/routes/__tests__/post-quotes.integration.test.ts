import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray, or } from "drizzle-orm";
import { blocks, db, follows, interactions, notificationsFeed, posts, users } from "@workspace/db";

const auth = vi.hoisted(() => ({ userId: "" }));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id") || auth.userId;
    next();
  },
}));

const suffix = crypto.randomBytes(6).toString("hex");
const id = (n: string) => `pq-${n}-${suffix}`;
const seller = id("seller");
const buyer = id("buyer");
const other = id("other");
const blockedUser = id("blocked");
const viewer = id("viewer");
const userIds = [seller, buyer, other, blockedUser, viewer];

let server: Server;
let base = "";
const created: string[] = [];

async function call(path: string, userId: string | null, options: RequestInit = {}) {
  const r = await fetch(`${base}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(userId ? { "x-test-user-id": userId } : {}), ...(options.headers ?? {}) },
  });
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
}
const quote = (userId: string, quotedPostId: string, extra: Record<string, unknown> = {}) =>
  call("/api/posts", userId, { method: "POST", body: JSON.stringify({ quotedPostId, caption: "my take", ...extra }) });

async function seedPost(userId: string, extra: Record<string, unknown> = {}) {
  const [row] = await db.insert(posts).values({
    userId, mediaUrl: "https://img.test/orig.jpg", thumbnailUrl: "https://img.test/orig-thumb.jpg",
    mediaType: "photo", caption: "original caption", ...extra,
  } as any).returning({ id: posts.id });
  created.push(row.id);
  return row.id;
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: seller, email: `${seller}@t.local`, name: "Seller", displayName: "Nova Studio", username: id("s").replace(/-/g, "_"), role: "seller", accountType: "seller" },
    { clerkId: buyer, email: `${buyer}@t.local`, name: "Buyer", displayName: "Buyer B", username: id("b").replace(/-/g, "_"), role: "buyer", accountType: "buyer" },
    { clerkId: other, email: `${other}@t.local`, name: "Other", displayName: "Other O", username: id("o").replace(/-/g, "_"), role: "buyer", accountType: "buyer" },
    { clerkId: blockedUser, email: `${blockedUser}@t.local`, name: "Blocked", displayName: "Blocked X", username: id("x").replace(/-/g, "_"), role: "buyer", accountType: "buyer" },
    { clerkId: viewer, email: `${viewer}@t.local`, name: "Viewer", displayName: "Viewer V", username: id("v").replace(/-/g, "_"), role: "buyer", accountType: "buyer" },
  ]);
  await db.insert(blocks).values({ blockerId: seller, blockedId: blockedUser });
  await db.insert(blocks).values({ blockerId: viewer, blockedId: other });
  await db.insert(follows).values({ followerId: viewer, followingId: seller });
  const { default: router } = await import("../posts");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.clerkUserId = req.header("x-test-user-id") || undefined; next(); });
  app.use("/api/posts", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, userIds));
  if (created.length) await db.delete(interactions).where(inArray(interactions.postId, created));
  await db.delete(interactions).where(inArray(interactions.userId, userIds));
  // quotes first (FK is SET NULL, but keep deletes deterministic)
  await db.delete(posts).where(inArray(posts.userId, userIds));
  await db.delete(follows).where(inArray(follows.followerId, userIds));
  await db.delete(blocks).where(or(inArray(blocks.blockerId, userIds), inArray(blocks.blockedId, userIds)));
  await db.delete(users).where(inArray(users.clerkId, userIds));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /api/posts with quotedPostId", () => {
  it("creates a normal post that embeds the original, records a repost and notifies", async () => {
    const original = await seedPost(seller);
    const r = await quote(buyer, original);
    expect(r.status).toBe(201);
    created.push(r.body.id);
    expect(r.body.repostKind).toBe("quote");
    expect(r.body.quotedPostId).toBe(original);
    expect(r.body.caption).toBe("my take");
    expect(r.body.mediaUrl).toBe("https://img.test/orig-thumb.jpg");
    expect(r.body.quotedPost).toMatchObject({
      id: original, userId: seller, caption: "original caption", thumbnailUrl: "https://img.test/orig-thumb.jpg",
      author: { displayName: "Nova Studio" },
    });

    const reposts = await db.select().from(interactions)
      .where(and(eq(interactions.postId, original), eq(interactions.userId, buyer), eq(interactions.type, "repost")));
    expect(reposts).toHaveLength(1);

    await vi.waitFor(async () => {
      const notes = await db.select().from(notificationsFeed)
        .where(and(eq(notificationsFeed.userId, seller), eq(notificationsFeed.actorId, buyer)));
      expect(notes.length).toBeGreaterThan(0);
      expect(notes[0].title).toContain("quoted your post");
    });
  });

  it("requires a caption", async () => {
    const original = await seedPost(seller);
    const r = await call("/api/posts", buyer, { method: "POST", body: JSON.stringify({ quotedPostId: original, caption: "  " }) });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("QUOTE_CAPTION_REQUIRED");
  });

  it("rejects malformed ids and missing originals", async () => {
    expect((await quote(buyer, "nope")).status).toBe(400);
    expect((await quote(buyer, crypto.randomUUID())).status).toBe(404);
  });

  it("rejects originals that are not publicly visible", async () => {
    const hidden = await seedPost(seller, { visibility: { isPublic: false, allowComments: true, allowReposts: true, showLikeCount: true } });
    const held = await seedPost(seller, { moderationStatus: "held" });
    const draft = await seedPost(seller, { postStatus: "draft" });
    const removed = await seedPost(seller, { postStatus: "deleted" });
    for (const pid of [hidden, held, draft, removed]) {
      const r = await quote(buyer, pid);
      expect(r.status).toBe(404);
      expect(r.body.code).toBe("QUOTE_TARGET_UNAVAILABLE");
    }
  });

  it("respects allowReposts = false", async () => {
    const noRepost = await seedPost(seller, { visibility: { isPublic: true, allowComments: true, allowReposts: false, showLikeCount: true } });
    const r = await quote(buyer, noRepost);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("REPOSTS_DISABLED");
  });

  it("refuses when a block exists in either direction, without revealing why", async () => {
    const original = await seedPost(seller);
    const r = await quote(blockedUser, original);
    expect(r.status).toBe(404);
    expect(r.body.code).toBe("QUOTE_TARGET_UNAVAILABLE");
    const reverse = await seedPost(blockedUser);
    expect((await quote(seller, reverse)).status).toBe(404);
  });

  it("applies the normal caption moderation rules", async () => {
    const original = await seedPost(seller);
    const r = await quote(buyer, original, { caption: "join my telegram for free money wire transfer guaranteed 100% profit dm me now http://scam.test" });
    // Whatever the moderator decides for this text, a quote is never more permissive than a normal post.
    const normal = await call("/api/posts", buyer, {
      method: "POST",
      body: JSON.stringify({ mediaUrl: "https://img.test/x.jpg", mediaType: "photo", caption: "join my telegram for free money wire transfer guaranteed 100% profit dm me now http://scam.test" }),
    });
    expect(r.status).toBe(normal.status);
    if (r.body?.id) created.push(r.body.id);
    if (normal.body?.id) created.push(normal.body.id);
  });

  it("a quote of a quote embeds only the direct original", async () => {
    const original = await seedPost(seller);
    const q1 = await quote(buyer, original, { caption: "first" });
    created.push(q1.body.id);
    const q2 = await quote(other, q1.body.id, { caption: "second" });
    created.push(q2.body.id);
    expect(q2.status).toBe(201);
    expect(q2.body.quotedPostId).toBe(q1.body.id);
    expect(q2.body.quotedPost.id).toBe(q1.body.id);
    expect(q2.body.quotedPost.caption).toBe("first");
    expect(JSON.stringify(q2.body.quotedPost)).not.toContain("original caption");
  });

  it("cannot quote a quote whose original is gone", async () => {
    const original = await seedPost(seller);
    const q1 = await quote(buyer, original, { caption: "first" });
    created.push(q1.body.id);
    await db.update(posts).set({ postStatus: "deleted" }).where(eq(posts.id, original));
    const r = await quote(other, q1.body.id, { caption: "late" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("QUOTE_OF_UNAVAILABLE");
  });
});

describe("quote payloads on reads", () => {
  it("GET /:id, /mine and /feed include quotedPost and quotesCount", async () => {
    const original = await seedPost(seller);
    const q = await quote(buyer, original, { caption: "read me" });
    created.push(q.body.id);

    const detail = await call(`/api/posts/${q.body.id}`, null);
    expect(detail.status).toBe(200);
    expect(detail.body.quotedPost.id).toBe(original);

    const origDetail = await call(`/api/posts/${original}`, null);
    expect(origDetail.body.quotedPost).toBeNull();
    expect(origDetail.body.quotesCount).toBe(1);

    const mine = await call("/api/posts/mine", buyer);
    const mineRow = mine.body.find((p: any) => p.id === q.body.id);
    expect(mineRow.quotedPost.id).toBe(original);
    expect(mineRow.quotesCount).toBe(0);

    const feed = await call("/api/posts/feed", viewer);
    const feedOriginal = feed.body.find((p: any) => p.id === original);
    expect(feedOriginal.quotesCount).toBe(1);
    expect(feedOriginal.quotedPost).toBeNull();
  });

  it("returns { unavailable: true } only once the original is gone or hidden", async () => {
    const original = await seedPost(seller);
    const q = await quote(buyer, original, { caption: "orphan soon" });
    created.push(q.body.id);

    await db.update(posts).set({ postStatus: "deleted" }).where(eq(posts.id, original));
    const soft = await call(`/api/posts/${q.body.id}`, null);
    expect(soft.body.quotedPost).toEqual({ unavailable: true });

    // Hard delete: FK is ON DELETE SET NULL, the quote itself survives.
    await db.delete(interactions).where(eq(interactions.postId, original));
    await db.delete(posts).where(eq(posts.id, original));
    const [row] = await db.select().from(posts).where(eq(posts.id, q.body.id));
    expect(row.quotedPostId).toBeNull();
    expect(row.repostKind).toBe("quote");
    const hard = await call(`/api/posts/${q.body.id}`, null);
    expect(hard.body.quotedPost).toEqual({ unavailable: true });
  });

  it("hides the original from viewers in a block relation with its author", async () => {
    const original = await seedPost(other);
    const q = await quote(buyer, original, { caption: "blocked view" });
    created.push(q.body.id);
    const asViewer = await call(`/api/posts/${q.body.id}`, viewer); // viewer blocked `other`
    expect(asViewer.body.quotedPost).toEqual({ unavailable: true });
    const asBuyer = await call(`/api/posts/${q.body.id}`, buyer);
    expect(asBuyer.body.quotedPost.id).toBe(original);
  });

  it("attaches quote data with a fixed number of queries per page (no N+1)", async () => {
    const { attachQuoteData } = await import("../../lib/quotedPosts");
    const originals = await Promise.all([seedPost(seller), seedPost(seller), seedPost(seller)]);
    const quoteIds: string[] = [];
    for (const o of originals) {
      const q = await quote(buyer, o, { caption: "batch" });
      created.push(q.body.id);
      quoteIds.push(q.body.id);
    }
    await new Promise((r) => setTimeout(r, 400)); // let fire-and-forget notifications finish so they don't pollute the count
    const spy = vi.spyOn(db, "select");
    await attachQuoteData([{ id: quoteIds[0] }], viewer);
    const one = spy.mock.calls.length;
    spy.mockClear();
    const many = await attachQuoteData([...quoteIds, ...originals].map((pid) => ({ id: pid })), viewer);
    const six = spy.mock.calls.length;
    spy.mockRestore();
    expect(six).toBe(one);
    expect(six).toBeLessThanOrEqual(4);
    expect(many.filter((m) => m.quotedPost && "id" in m.quotedPost)).toHaveLength(3);
  });
});

describe("GET /api/posts/:id/quotes", () => {
  it("lists quotes newest first, paginated, hiding blocked authors from the viewer", async () => {
    const original = await seedPost(seller);
    const ids: string[] = [];
    for (const [who, text] of [[buyer, "one"], [other, "two"], [viewer, "three"]] as const) {
      const q = await quote(who, original, { caption: text });
      created.push(q.body.id);
      ids.push(q.body.id);
      await new Promise((r) => setTimeout(r, 15));
    }
    const all = await call(`/api/posts/${original}/quotes`, null);
    expect(all.status).toBe(200);
    expect(all.body.map((q: any) => q.caption)).toEqual(["three", "two", "one"]);
    expect(all.body[0].author.displayName).toBe("Viewer V");
    expect(all.body[0]).not.toHaveProperty("email");

    const page1 = await call(`/api/posts/${original}/quotes?limit=2&offset=0`, null);
    const page2 = await call(`/api/posts/${original}/quotes?limit=2&offset=2`, null);
    expect(page1.body).toHaveLength(2);
    expect(page2.body.map((q: any) => q.caption)).toEqual(["one"]);

    // `viewer` blocked `other`, so their quote is hidden from viewer only.
    const asViewer = await call(`/api/posts/${original}/quotes`, viewer);
    expect(asViewer.body.map((q: any) => q.caption)).toEqual(["three", "one"]);
  });

  it("404s for a non-public or unknown original and validates pagination", async () => {
    const hidden = await seedPost(seller, { moderationStatus: "removed" });
    expect((await call(`/api/posts/${hidden}/quotes`, null)).status).toBe(404);
    expect((await call(`/api/posts/${crypto.randomUUID()}/quotes`, null)).status).toBe(404);
    const original = await seedPost(seller);
    expect((await call(`/api/posts/${original}/quotes?limit=500`, null)).status).toBe(400);
  });

  it("does not list quotes that are themselves not public", async () => {
    const original = await seedPost(seller);
    const q = await quote(buyer, original, { caption: "soon hidden" });
    created.push(q.body.id);
    await db.update(posts).set({ moderationStatus: "removed" }).where(eq(posts.id, q.body.id));
    expect((await call(`/api/posts/${original}/quotes`, null)).body).toEqual([]);
    expect((await call(`/api/posts/${original}`, null)).body.quotesCount).toBe(0);
  });
});
