import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { blocks, db, interactions, posts, trendingCache, users } from "@workspace/db";

// Public reads identify the viewer through optionalViewerId → x-test-user-id.
vi.mock("../../lib/safety", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/safety")>();
  return { ...real, optionalViewerId: (req: any) => req.header("x-test-user-id") || null };
});
// The poster self-heal is covered by videoPoster.test.ts; keep it off the network here.
vi.mock("../../lib/videoPoster", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/videoPoster")>();
  return { ...real, ensureVideoPoster: vi.fn(async () => null) };
});

const suffix = crypto.randomBytes(5).toString("hex");
const uid = (n: string) => `dsc-${n}-${suffix}`;
const seller = uid("seller");
const buyer = uid("buyer");
const brandthread = uid("brandthread");
const blockedAuthor = uid("blocked");
const viewer = uid("viewer");
const userIds = [seller, buyer, brandthread, blockedAuthor, viewer];
const today = new Date().toISOString().slice(0, 10);

let server: Server;
let base = "";
const createdPostIds: string[] = [];
let savedTrending: typeof trendingCache.$inferSelect | undefined;

async function get(urlPath: string, userId?: string) {
  const response = await fetch(`${base}${urlPath}`, { headers: userId ? { "x-test-user-id": userId } : {} });
  return { status: response.status, body: (await response.json().catch(() => null)) as any };
}

async function seedPost(userId: string, minutesAgo: number, extra: Partial<typeof posts.$inferInsert> = {}) {
  const createdAt = new Date(Date.now() - minutesAgo * 60_000);
  const [row] = await db.insert(posts).values({
    userId,
    mediaUrl: `https://img.test/${userId}-${minutesAgo}.jpg`,
    mediaUrls: [`https://img.test/${userId}-${minutesAgo}.jpg`],
    mediaType: "photo",
    caption: `post ${minutesAgo}`,
    postStatus: "published",
    publishedAt: createdAt,
    createdAt,
    ...extra,
  }).returning();
  createdPostIds.push(row.id);
  return row;
}

/** Walks every page the way the client does, keeping only this file's posts. */
async function walk(query: string, viewerId?: string) {
  const seen: any[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const res = await get(`/api/public/discover?${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, viewerId);
    expect(res.status).toBe(200);
    seen.push(...res.body.items);
    cursor = res.body.nextCursor;
    pages++;
  } while (cursor && pages < 200);
  return { items: seen.filter((item) => userIds.includes(item.author.userId)), pages };
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: seller, email: `${seller}@t.local`, name: "Northline", username: seller.replace(/-/g, "_"), role: "seller", accountType: "seller" },
    { clerkId: buyer, email: `${buyer}@t.local`, name: "Maya", username: buyer.replace(/-/g, "_"), role: "buyer", accountType: "buyer" },
    { clerkId: brandthread, email: `${brandthread}@t.local`, name: "Brandthread", username: brandthread.replace(/-/g, "_"), role: "seller", accountType: "seller" },
    { clerkId: blockedAuthor, email: `${blockedAuthor}@t.local`, name: "Blocked", username: blockedAuthor.replace(/-/g, "_"), role: "buyer", accountType: "buyer" },
    { clerkId: viewer, email: `${viewer}@t.local`, name: "Viewer", username: viewer.replace(/-/g, "_"), role: "buyer", accountType: "buyer" },
  ]);
  await db.insert(blocks).values({ blockerId: viewer, blockedId: blockedAuthor });
  [savedTrending] = await db.select().from(trendingCache).where(eq(trendingCache.cacheDate, today));
  await db.delete(trendingCache).where(eq(trendingCache.cacheDate, today));

  const { default: router } = await import("../discover-public");
  const app = express();
  app.use("/api/public/discover", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await db.delete(trendingCache).where(eq(trendingCache.cacheDate, today));
  if (savedTrending) await db.insert(trendingCache).values(savedTrending);
  if (createdPostIds.length > 0) {
    await db.delete(interactions).where(inArray(interactions.postId, createdPostIds));
    await db.delete(posts).where(inArray(posts.id, createdPostIds));
  }
  await db.delete(blocks).where(inArray(blocks.blockerId, userIds));
  await db.delete(users).where(inArray(users.clerkId, userIds));
});

describe("GET /api/public/discover", () => {
  it("pages through every public post with a cursor: appends, no duplicates, no wrap, clean end", async () => {
    for (let i = 0; i < 23; i++) await seedPost(i % 2 === 0 ? seller : brandthread, 10 + i);
    const first = await get("/api/public/discover?limit=10");
    expect(first.status).toBe(200);
    expect(first.body.items.length).toBe(10);
    expect(typeof first.body.nextCursor).toBe("string");

    const { items } = await walk("limit=10");
    const ids = items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(23);
    // Newest first, strictly — each page continues where the last stopped.
    const times = items.map((item) => new Date(item.createdAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("clamps an oversized limit instead of rejecting it (the old trending 400 that emptied the grid)", async () => {
    const res = await get("/api/public/discover?limit=120");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(50);
  });

  it("rejects a cursor it did not issue rather than silently restarting at page one", async () => {
    const res = await get("/api/public/discover?cursor=not-a-cursor");
    expect(res.status).toBe(400);
  });

  it("gives every item an image: video poster, first carousel slide, or the photo; skips stills-less videos", async () => {
    const poster = await seedPost(seller, 1, { mediaType: "video", mediaUrl: "https://img.test/v.mp4", mediaUrls: [], thumbnailUrl: "https://img.test/poster.jpg" });
    const carousel = await seedPost(seller, 2, {
      mediaType: "slideshow", mediaUrl: "https://img.test/s1.mp4", mediaUrls: [],
      slides: [{ kind: "video", path: "/objects/a", url: "https://img.test/s1.mp4", thumbnailPath: "/objects/b", thumbnailUrl: "https://img.test/s1.jpg" }],
    });
    const bare = await seedPost(seller, 3, { mediaType: "video", mediaUrl: "https://img.test/bare.mp4", mediaUrls: [] });
    const { items } = await walk("limit=50");
    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.get(poster.id)?.imageUrl).toBe("https://img.test/poster.jpg");
    expect(byId.get(carousel.id)?.imageUrl).toBe("https://img.test/s1.jpg");
    expect(byId.has(bare.id)).toBe(false);
    for (const item of items) expect(item.imageUrl).toMatch(/^https:\/\//);
  });

  it("leads page one with ranked posts, then falls back to recent public posts when the ranking is thin", async () => {
    const ranked = await seedPost(buyer, 600, { caption: "old but trending" });
    await db.insert(trendingCache).values({ cacheDate: today, results: [{ id: ranked.id }], itemCount: 1 });
    const first = await get("/api/public/discover?limit=10");
    expect(first.body.items[0].id).toBe(ranked.id);
    expect(first.body.items[0].ranked).toBe(true);
    expect(first.body.items.length).toBe(10);
    // …and is never repeated further down.
    const { items } = await walk("limit=10");
    expect(items.filter((item) => item.id === ranked.id)).toHaveLength(1);
    await db.delete(trendingCache).where(eq(trendingCache.cacheDate, today));
  });

  it("filters blocked authors, hidden posts, and limits Fits to buyer posts", async () => {
    const blockedPost = await seedPost(blockedAuthor, 4);
    const draft = await seedPost(seller, 5, { postStatus: "draft" });
    const hidden = await seedPost(seller, 6, { visibility: { isPublic: false, allowComments: true, allowReposts: true, showLikeCount: true } });
    const { items } = await walk("limit=50", viewer);
    const ids = new Set(items.map((item) => item.id));
    expect(ids.has(blockedPost.id)).toBe(false);
    expect(ids.has(draft.id)).toBe(false);
    expect(ids.has(hidden.id)).toBe(false);

    const fits = await walk("limit=50&kind=fits");
    expect(fits.items.length).toBeGreaterThan(0);
    for (const item of fits.items) expect(item.author.accountType).toBe("buyer");
  });

  it("reports likes and views, and hides likes when the author turned them off", async () => {
    const liked = await seedPost(seller, 7);
    const quiet = await seedPost(seller, 8, { visibility: { isPublic: true, allowComments: true, allowReposts: true, showLikeCount: false } });
    await db.insert(interactions).values([
      { userId: buyer, postId: liked.id, type: "like" },
      { userId: viewer, postId: liked.id, type: "like" },
      { userId: buyer, postId: liked.id, type: "view" },
      { userId: buyer, postId: quiet.id, type: "like" },
    ]);
    const { items } = await walk("limit=50");
    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.get(liked.id)).toMatchObject({ likesCount: 2, viewsCount: 1 });
    expect(byId.get(quiet.id)?.likesCount).toBeNull();
  });
});
