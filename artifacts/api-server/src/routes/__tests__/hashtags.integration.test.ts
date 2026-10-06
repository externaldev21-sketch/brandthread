import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray, sql } from "drizzle-orm";
import { blocks, db, hashtagFollows, interactions, postHashtags, posts, users } from "@workspace/db";

const auth = vi.hoisted(() => ({ userId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const uid = req.header("x-test-user-id") || auth.userId;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    req.clerkUserId = uid;
    next();
  },
}));
// Public reads identify the viewer through optionalViewerId → x-test-user-id.
vi.mock("../../lib/safety", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/safety")>();
  return { ...real, optionalViewerId: (req: any) => req.header("x-test-user-id") || null };
});

const suffix = crypto.randomBytes(5).toString("hex");
const uid = (n: string) => `ht-${n}-${suffix}`;
const seller = uid("seller");
const buyer = uid("buyer");
const buyer2 = uid("buyer2");
const blockedAuthor = uid("blockedauthor");
const suspended = uid("suspended");
const viewer = uid("viewer");
const userIds = [seller, buyer, buyer2, blockedAuthor, suspended, viewer];
const tag = (name: string) => `${name}${suffix}`;

let server: Server;
let base = "";
const createdPostIds: string[] = [];

async function call(method: string, urlPath: string, userId?: string, body?: unknown) {
  const response = await fetch(`${base}${urlPath}`, {
    method,
    headers: { "content-type": "application/json", ...(userId ? { "x-test-user-id": userId } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as any };
}

async function seedPost(
  userId: string,
  tags: string[],
  extra: Partial<typeof posts.$inferInsert> = {},
) {
  const createdAt = extra.createdAt ?? new Date();
  const [row] = await db.insert(posts).values({
    userId,
    mediaUrl: "https://img.test/a.jpg",
    mediaUrls: ["https://img.test/a.jpg"],
    mediaType: "photo",
    caption: "seeded",
    hashtags: tags,
    postStatus: "published",
    publishedAt: createdAt,
    createdAt,
    ...extra,
  }).returning();
  createdPostIds.push(row.id);
  if (tags.length > 0) {
    await db.insert(postHashtags).values(tags.map((t) => ({ postId: row.id, tag: t, createdAt })));
  }
  return row;
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: seller, email: `${seller}@t.local`, name: "Seller", username: seller.replace(/-/g, "_"), role: "seller", accountType: "seller" },
    { clerkId: buyer, email: `${buyer}@t.local`, name: "Buyer", username: buyer.replace(/-/g, "_"), role: "buyer", accountType: "buyer" },
    { clerkId: buyer2, email: `${buyer2}@t.local`, name: "Buyer Two", username: buyer2.replace(/-/g, "_"), role: "buyer", accountType: "buyer" },
    { clerkId: blockedAuthor, email: `${blockedAuthor}@t.local`, name: "Blocked", username: blockedAuthor.replace(/-/g, "_"), role: "buyer", accountType: "buyer" },
    { clerkId: suspended, email: `${suspended}@t.local`, name: "Suspended", username: suspended.replace(/-/g, "_"), role: "buyer", accountType: "buyer", suspendedAt: new Date() },
    { clerkId: viewer, email: `${viewer}@t.local`, name: "Viewer", username: viewer.replace(/-/g, "_"), role: "buyer", accountType: "buyer" },
  ]);
  await db.insert(blocks).values({ blockerId: viewer, blockedId: blockedAuthor });

  const [{ default: hashtagsRouter }, { default: postsRouter }] = await Promise.all([
    import("../hashtags"), import("../posts"),
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api/hashtags", hashtagsRouter);
  app.use("/api/posts", postsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (createdPostIds.length > 0) {
    await db.delete(interactions).where(inArray(interactions.postId, createdPostIds));
    await db.delete(posts).where(inArray(posts.id, createdPostIds));
  }
  await db.delete(hashtagFollows).where(inArray(hashtagFollows.userId, userIds));
  await db.delete(blocks).where(inArray(blocks.blockerId, userIds));
  await db.delete(users).where(inArray(users.clerkId, userIds));
});

beforeEach(async () => {
  const { clearTrendingCache } = await import("../hashtags");
  clearTrendingCache();
});

describe("post write path keeps the tag index in sync", () => {
  it("normalises stored hashtags, merges caption tags and indexes them", async () => {
    const t1 = tag("launch");
    const t2 = tag("sale");
    const created = await call("POST", "/api/posts", seller, {
      mediaUrl: "https://img.test/new.jpg",
      caption: `Big #${t2.toUpperCase()} today`,
      hashtags: [`#${t1.toUpperCase()}`, t1],
    });
    expect(created.status).toBe(201);
    createdPostIds.push(created.body.id);
    expect(created.body.hashtags).toEqual([t1, t2]);
    const rows = await db.select().from(postHashtags).where(eq(postHashtags.postId, created.body.id));
    expect(rows.map((r) => r.tag).sort()).toEqual([t1, t2].sort());

    const t3 = tag("restock");
    const patched = await call("PATCH", `/api/posts/${created.body.id}`, seller, { hashtags: [t3] });
    expect(patched.status).toBe(200);
    // the caption still carries #sale, so it stays indexed alongside the new tag
    expect(patched.body.hashtags).toEqual([t3, t2]);
    const after = await db.select().from(postHashtags).where(eq(postHashtags.postId, created.body.id));
    expect(after.map((r) => r.tag).sort()).toEqual([t3, t2].sort());

    const cleared = await call("PATCH", `/api/posts/${created.body.id}`, seller, { caption: "no tags", hashtags: [] });
    expect(cleared.body.hashtags).toEqual([]);
    expect(await db.select().from(postHashtags).where(eq(postHashtags.postId, created.body.id))).toEqual([]);
  });

  it("does not list a post once it is archived or deleted", async () => {
    const t = tag("lifecycle");
    const created = await call("POST", "/api/posts", seller, { mediaUrl: "https://img.test/x.jpg", caption: "hi", hashtags: [t] });
    createdPostIds.push(created.body.id);
    expect((await call("GET", `/api/hashtags/${t}`)).body.postCount).toBe(1);
    await call("PATCH", `/api/posts/${created.body.id}`, seller, { postStatus: "archived" });
    expect((await call("GET", `/api/hashtags/${t}`)).body.postCount).toBe(0);
    await call("PATCH", `/api/posts/${created.body.id}`, seller, { postStatus: "published" });
    expect((await call("GET", `/api/hashtags/${t}`)).body.postCount).toBe(1);
    await call("DELETE", `/api/posts/${created.body.id}`, seller);
    expect((await call("GET", `/api/hashtags/${t}`)).body.postCount).toBe(0);
  });

  it("cascades index rows when a post row is removed", async () => {
    const t = tag("cascade");
    const p = await seedPost(buyer, [t]);
    await db.delete(posts).where(eq(posts.id, p.id));
    expect(await db.select().from(postHashtags).where(eq(postHashtags.postId, p.id))).toEqual([]);
  });
});

describe("migration backfill", () => {
  it("indexes legacy posts.hashtags json idempotently", async () => {
    const t = tag("legacy");
    const [legacy] = await db.insert(posts).values({
      userId: buyer, mediaUrl: "https://img.test/l.jpg", hashtags: [`#${t.toUpperCase()}`, "Bad Tag!", t] as any,
    }).returning();
    createdPostIds.push(legacy.id);
    const file = fs.readFileSync(
      path.resolve(__dirname, "../../../../../lib/db/migrations/121_hashtags.sql"), "utf8");
    const backfill = file.slice(file.indexOf("INSERT INTO post_hashtags"));
    await db.execute(sql.raw(backfill));
    await db.execute(sql.raw(backfill));
    const rows = await db.select().from(postHashtags).where(eq(postHashtags.postId, legacy.id));
    expect(rows.map((r) => r.tag).sort()).toEqual([t, "badtag"].sort());
  });
});

describe("GET /api/hashtags/:tag and /:tag/posts", () => {
  const t = tag("page");
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const base = Date.now() - 60 * 60_000;
    ids.old = (await seedPost(seller, [t], { createdAt: new Date(base) })).id;
    ids.mid = (await seedPost(buyer, [t], { createdAt: new Date(base + 10 * 60_000) })).id;
    ids.new = (await seedPost(buyer2, [t], { createdAt: new Date(base + 20 * 60_000) })).id;
    ids.draft = (await seedPost(seller, [t], { postStatus: "draft" })).id;
    ids.held = (await seedPost(seller, [t], { moderationStatus: "held" })).id;
    ids.priv = (await seedPost(seller, [t], { visibility: { isPublic: false, allowComments: true, allowReposts: true, showLikeCount: true } })).id;
    ids.susp = (await seedPost(suspended, [t])).id;
    ids.blocked = (await seedPost(blockedAuthor, [t])).id;
    await db.insert(interactions).values([
      { userId: buyer, postId: ids.old, type: "like" },
      { userId: buyer2, postId: ids.old, type: "like" },
      { userId: viewer, postId: ids.old, type: "repost" },
      { userId: buyer, postId: ids.mid, type: "like" },
    ]);
  });

  it("returns only publicly visible posts, with counts and recent order", async () => {
    const page = await call("GET", `/api/hashtags/${t.toUpperCase()}?sort=recent`);
    expect(page.status).toBe(200);
    expect(page.body.tag).toBe(t);
    // old, mid, new, blocked-author's post (viewer signed out) — not draft/held/private/suspended
    expect(page.body.postCount).toBe(4);
    expect(page.body.isFollowing).toBe(false);
    const order = page.body.posts.items.map((p: any) => p.id);
    expect(order.indexOf(ids.new)).toBeLessThan(order.indexOf(ids.mid));
    expect(order.indexOf(ids.mid)).toBeLessThan(order.indexOf(ids.old));
    for (const hidden of [ids.draft, ids.held, ids.priv, ids.susp]) expect(order).not.toContain(hidden);
  });

  it("ranks top by engagement", async () => {
    const page = await call("GET", `/api/hashtags/${t}/posts?sort=top`);
    expect(page.body.items[0].id).toBe(ids.old);
    expect(page.body.items[0].likesCount).toBe(2);
    expect(page.body.items[1].id).toBe(ids.mid);
  });

  it("hides blocked authors from the blocker and counts accordingly", async () => {
    const page = await call("GET", `/api/hashtags/${t}`, viewer);
    expect(page.body.postCount).toBe(3);
    const all = await call("GET", `/api/hashtags/${t}/posts?sort=recent`, viewer);
    expect(all.body.items.map((p: any) => p.id)).not.toContain(ids.blocked);
  });

  it("paginates recent with a cursor and top with an offset cursor", async () => {
    const first = await call("GET", `/api/hashtags/${t}/posts?sort=recent&limit=2`);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await call("GET", `/api/hashtags/${t}/posts?sort=recent&limit=2&cursor=${first.body.nextCursor}`);
    const seen = new Set([...first.body.items, ...second.body.items].map((p: any) => p.id));
    expect(seen.size).toBe(first.body.items.length + second.body.items.length);
    expect(second.body.nextCursor).toBeNull();

    const topFirst = await call("GET", `/api/hashtags/${t}/posts?sort=top&limit=3`);
    const topSecond = await call("GET", `/api/hashtags/${t}/posts?sort=top&limit=3&cursor=${topFirst.body.nextCursor}`);
    expect(topSecond.body.items).toHaveLength(1);
    expect(topFirst.body.items.map((p: any) => p.id)).not.toContain(topSecond.body.items[0].id);
  });

  it("404s for unusable or moderated tags and returns an empty page for unused ones", async () => {
    expect((await call("GET", "/api/hashtags/!!!")).status).toBe(404);
    expect((await call("GET", "/api/hashtags/kill_yourself")).status).toBe(404);
    const empty = await call("GET", `/api/hashtags/${tag("nobodyuses")}`);
    expect(empty.status).toBe(200);
    expect(empty.body.postCount).toBe(0);
    expect(empty.body.posts.items).toEqual([]);
  });
});

describe("follow / unfollow", () => {
  it("requires auth, is idempotent and is reflected on the page and /following", async () => {
    const t = tag("followme");
    await seedPost(seller, [t]);
    expect((await call("POST", `/api/hashtags/${t}/follow`)).status).toBe(401);
    expect((await call("POST", `/api/hashtags/${t}/follow`, viewer)).body).toEqual({ tag: t, isFollowing: true });
    expect((await call("POST", `/api/hashtags/${t}/follow`, viewer)).status).toBe(200);
    const page = await call("GET", `/api/hashtags/${t}`, viewer);
    expect(page.body.isFollowing).toBe(true);
    expect(page.body.followerCount).toBe(1);
    const following = await call("GET", "/api/hashtags/following", viewer);
    expect(following.body.tags.map((x: any) => x.tag)).toContain(t);
    expect((await call("DELETE", `/api/hashtags/${t}/follow`, viewer)).body.isFollowing).toBe(false);
    expect((await call("GET", `/api/hashtags/${t}`, viewer)).body.isFollowing).toBe(false);
  });

  it("refuses to follow a moderated tag", async () => {
    expect((await call("POST", "/api/hashtags/kill_yourself/follow", viewer)).status).toBe(404);
  });
});

describe("GET /api/hashtags/search", () => {
  it("prefix-searches tags that have public posts, most used first", async () => {
    const a = tag("sneak");
    const b = `${a}ers`;
    await seedPost(seller, [a]);
    await seedPost(buyer, [b]);
    await seedPost(buyer2, [b]);
    await seedPost(seller, [`${a}draft`], { postStatus: "draft" });
    const res = await call("GET", `/api/hashtags/search?q=%23${a.toUpperCase()}`);
    expect(res.body.tags).toEqual([{ tag: b, postCount: 2 }, { tag: a, postCount: 1 }]);
    expect((await call("GET", "/api/hashtags/search?q=")).body.tags).toEqual([]);
  });
});

describe("GET /api/hashtags/trending", () => {
  it("ranks by recent volume and engagement with thresholds, and excludes moderated tags", async () => {
    const hot = tag("hot");
    const warm = tag("warm");
    const solo = tag("solo");
    const stale = tag("stale");
    const bad = "kill_yourself";
    const hotPosts = [
      await seedPost(seller, [hot]), await seedPost(buyer, [hot]), await seedPost(buyer2, [hot]),
      await seedPost(seller, [hot]),
    ];
    await seedPost(seller, [warm]); await seedPost(buyer, [warm]); await seedPost(buyer2, [warm]);
    // same author three times does not trend (min distinct authors)
    await seedPost(seller, [solo]); await seedPost(seller, [solo]); await seedPost(seller, [solo]);
    // old posts outside the 72h window do not trend
    const old = new Date(Date.now() - 10 * 24 * 3_600_000);
    await seedPost(seller, [stale], { createdAt: old, publishedAt: old });
    await seedPost(buyer, [stale], { createdAt: old, publishedAt: old });
    await seedPost(buyer2, [stale], { createdAt: old, publishedAt: old });
    // moderated tag with plenty of volume never surfaces
    await seedPost(seller, [bad]); await seedPost(buyer, [bad]); await seedPost(buyer2, [bad]);
    await db.insert(interactions).values(hotPosts.map((p) => ({ userId: viewer, postId: p.id, type: "like" })));

    const res = await call("GET", "/api/hashtags/trending?limit=20");
    expect(res.status).toBe(200);
    const names = res.body.tags.map((x: any) => x.tag);
    expect(names).toContain(hot);
    expect(names).toContain(warm);
    expect(names.indexOf(hot)).toBeLessThan(names.indexOf(warm));
    expect(names).not.toContain(solo);
    expect(names).not.toContain(stale);
    expect(names).not.toContain(bad);
    expect(res.body.tags.length).toBeLessThanOrEqual(20);
    const hotRow = res.body.tags.find((x: any) => x.tag === hot);
    expect(hotRow).toMatchObject({ recentPostCount: 4, postCount: 4 });

    // capped by limit, cached between calls
    expect((await call("GET", "/api/hashtags/trending?limit=1")).body.tags).toHaveLength(1);
  });
});
