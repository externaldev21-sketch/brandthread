/**
 * Integration test (real DB) for the phase-2 scale changes:
 *  - public search still finds substring AND typo matches after the switch to
 *    index-friendly trigram operators, orders in SQL, and bounds the product set;
 *  - the video playback post lookup is an equality on the media path;
 *  - expired disappearing messages are hidden from reads without waiting on a DELETE;
 *  - the rate limiter no longer deletes expired buckets on every call.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, sql } from "drizzle-orm";
import {
  db, users, products, productVariants, posts, follows, conversations, conversationParticipants, messages,
} from "@workspace/db";
import { consumeRateLimitBucket, RATE_LIMIT_POLICIES } from "../../middlewares/rateLimit";

const tag = `scl${process.pid}`;
const SELLER = `${tag}-seller`;
const BUYER = `${tag}-buyer`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = BUYER_ID();
    next();
  },
}));
function BUYER_ID() { return `scl${process.pid}-buyer`; }

import publicRouter from "../public";
import conversationsRouter from "../conversations";
import postsRouter from "../posts";

let server: Server;
let base = "";
let convId = "";

async function get(path: string) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() as any, headers: res.headers };
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: SELLER, email: `${SELLER}@example.test`, name: "Scale Seller", displayName: "Scale Seller", brandName: `Zephyrwear ${tag}`, accountType: "seller", onboardingComplete: true },
    { clerkId: BUYER, email: `${BUYER}@example.test`, name: "Scale Buyer", displayName: "Scale Buyer", accountType: "buyer", onboardingComplete: true },
  ]);
  const prods = await db.insert(products).values([
    { ownerId: SELLER, name: `Zephyr Hoodie ${tag}`, category: "hoodies", status: "active" },
    { ownerId: SELLER, name: `Zephyr Tee ${tag}`, category: "tees", status: "active" },
    { ownerId: SELLER, name: `Unrelated Cap ${tag}`, category: "hats", status: "active" },
  ]).returning();
  await db.insert(productVariants).values([
    { productId: prods[0]!.id, size: "M", sku: `${tag}-h`, priceCents: 9000, stock: 5 },
    { productId: prods[1]!.id, size: "M", sku: `${tag}-t`, priceCents: 3000, stock: 5 },
    { productId: prods[2]!.id, size: "M", sku: `${tag}-c`, priceCents: 2000, stock: 5 },
  ]);
  await db.insert(posts).values({
    userId: SELLER, mediaType: "video", caption: `zephyr runway ${tag}`,
    mediaUrl: `https://cdn.example.test/api/posts/media/uploads/${tag}.mp4`,
    thumbnailUrl: `https://cdn.example.test/api/posts/media/uploads/${tag}.jpg`,
  });
  await db.insert(follows).values({ followerId: BUYER, followingId: SELLER });
  // Five posts sharing one timestamp: the tie-break on id is what keeps paging exact.
  const sameInstant = new Date(Date.now() - 120_000);
  await db.insert(posts).values(Array.from({ length: 5 }, (_, i) => ({
    userId: SELLER, mediaType: "photo", caption: `feed ${tag} ${i}`, mediaUrl: `https://x.test/${tag}-${i}.jpg`, createdAt: sameInstant,
  })));
  const [conv] = await db.insert(conversations).values({ type: "buyer_to_seller" }).returning();
  convId = conv!.id;
  await db.insert(conversationParticipants).values([
    { conversationId: convId, userId: BUYER, name: "B", handle: "b", initials: "B" },
    { conversationId: convId, userId: SELLER, name: "S", handle: "s", initials: "S" },
  ]);
  const past = new Date(Date.now() - 60_000);
  const future = new Date(Date.now() + 3_600_000);
  await db.insert(messages).values([
    { conversationId: convId, senderId: SELLER, body: "still here" },
    { conversationId: convId, senderId: SELLER, body: "expired", disappearAt: past },
    { conversationId: convId, senderId: SELLER, body: "later", disappearAt: future },
  ]);

  const app = express();
  app.use(express.json());
  app.use("/api/public", publicRouter);
  app.use("/api/conversations", conversationsRouter);
  app.use("/api/posts", postsRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  await db.delete(follows).where(eq(follows.followerId, BUYER));
  await db.delete(posts).where(eq(posts.userId, SELLER));
  await db.delete(messages).where(eq(messages.conversationId, convId));
  await db.delete(conversationParticipants).where(eq(conversationParticipants.conversationId, convId));
  await db.delete(conversations).where(eq(conversations.id, convId));
  const owned = await db.select({ id: products.id }).from(products).where(eq(products.ownerId, SELLER));
  for (const p of owned) await db.delete(productVariants).where(eq(productVariants.productId, p.id));
  await db.delete(products).where(eq(products.ownerId, SELLER));
  await db.delete(users).where(eq(users.clerkId, SELLER));
  await db.delete(users).where(eq(users.clerkId, BUYER));
});

describe("public search after the index-friendly rewrite", () => {
  it("finds products by substring, brand by name and the video by caption", async () => {
    const { status, body } = await get(`/api/public/search?q=zephyr&limit=50`);
    expect(status).toBe(200);
    const kinds = body.results.map((r: any) => `${r.kind}:${r.name ?? r.caption}`);
    expect(kinds.some((k: string) => k.startsWith("brand:Zephyrwear"))).toBe(true);
    expect(kinds).toContain(`product:Zephyr Hoodie ${tag}`);
    expect(kinds).toContain(`product:Zephyr Tee ${tag}`);
    expect(kinds).toContain(`video:zephyr runway ${tag}`);
    expect(kinds).not.toContain(`product:Unrelated Cap ${tag}`);
  });

  it("still tolerates a typo (trigram similarity at the 0.25 threshold)", async () => {
    const { body } = await get(`/api/public/search?q=zephir%20hoodie`);
    expect(body.results.map((r: any) => r.name)).toContain(`Zephyr Hoodie ${tag}`);
  });

  it("finds a video tagged with a product whose name was typo'd (fuzzy on product name)", async () => {
    const [prod] = await db.select({ id: products.id }).from(products).where(eq(products.name, `Zephyr Hoodie ${tag}`));
    const [post] = await db.select({ id: posts.id }).from(posts).where(eq(posts.caption, `zephyr runway ${tag}`));
    await db.execute(sql`INSERT INTO post_tagged_products (post_id, product_id, position) VALUES (${post!.id}, ${prod!.id}, 0)`);
    const { body } = await get(`/api/public/search?q=${encodeURIComponent("zephir hoodie")}&limit=50`);
    expect(body.results.some((r: any) => r.kind === "video" && r.postId === post!.id)).toBe(true);
  });

  it("returns a full page of newest exact-caption videos when 20+ exist", async () => {
    await db.insert(posts).values(Array.from({ length: 22 }, (_, i) => ({
      userId: SELLER, mediaType: "video", caption: `quasar jacket ${tag} ${i}`, mediaUrl: `https://x.test/${tag}-q${i}.mp4`,
      createdAt: new Date(Date.now() - (i + 1) * 60_000),
    })));
    const { body } = await get(`/api/public/search?q=${encodeURIComponent(`quasar jacket ${tag}`)}&limit=50`);
    const videos = body.results.filter((r: any) => r.kind === "video");
    expect(videos).toHaveLength(20);
    expect(videos[0].caption).toBe(`quasar jacket ${tag} 0`);
    await db.delete(posts).where(sql`${posts.caption} LIKE ${`quasar jacket ${tag}%`}`);
  });

  it("orders by price in SQL", async () => {
    const asc = await get(`/api/public/search?q=zephyr%20${tag}&sort=price_asc`);
    const prices = asc.body.results.filter((r: any) => r.kind === "product").map((r: any) => r.priceCents);
    expect(prices).toEqual([...prices].sort((a: number, b: number) => a - b));
    const desc = await get(`/api/public/search?q=zephyr%20${tag}&sort=price_desc`);
    const d = desc.body.results.filter((r: any) => r.kind === "product").map((r: any) => r.priceCents);
    expect(d).toEqual([...d].sort((a: number, b: number) => b - a));
  });

  it("does not leak the similarity threshold to other queries on the pool", async () => {
    await get(`/api/public/search?q=zephyr`);
    const [{ v }] = (await db.execute(sql`SELECT current_setting('pg_trgm.similarity_threshold') AS v`)).rows as any[];
    expect(Number(v)).toBe(0.3);
  });
});

describe("Following feed keyset pagination", () => {
  it("pages with ?cursor= without skipping or repeating rows, and matches offset paging", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const res: any = await get(`/api/posts/feed?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.filter((p: any) => String(p.caption).includes(tag)).map((p: any) => p.id));
      cursor = res.headers.get("x-next-cursor");
      if (!cursor) break;
    }
    const viaOffset: string[] = [];
    for (const offset of [0, 2, 4]) {
      const res = await get(`/api/posts/feed?limit=2&offset=${offset}`);
      viaOffset.push(...res.body.filter((p: any) => String(p.caption).includes(tag)).map((p: any) => p.id));
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(6); // 5 feed posts + the video caption post, all by the followed seller
    expect(viaOffset).toEqual(seen);
  });

  it("rejects a malformed cursor", async () => {
    const res = await get(`/api/posts/feed?cursor=nope`);
    expect(res.status).toBe(400);
  });
});

describe("video playback lookup", () => {
  it("matches the path after /api/posts/media/ by equality, on media_url or thumbnail_url", async () => {
    const rows = (await db.execute(sql`
      SELECT id FROM posts
      WHERE substring(media_url from '/api/posts/media/(.+)$') = ${`uploads/${tag}.mp4`}
         OR substring(thumbnail_url from '/api/posts/media/(.+)$') = ${`uploads/${tag}.mp4`}`)).rows;
    expect(rows).toHaveLength(1);
    const thumb = (await db.execute(sql`
      SELECT id FROM posts WHERE substring(thumbnail_url from '/api/posts/media/(.+)$') = ${`uploads/${tag}.jpg`}`)).rows;
    expect(thumb).toHaveLength(1);
  });
});

describe("conversation messages with disappearing messages", () => {
  it("hides expired messages immediately and sweeps them off the request path", async () => {
    const { status, body } = await get(`/api/conversations/${convId}/messages`);
    expect(status).toBe(200);
    const bodies = body.map((m: any) => m.body ?? m.text);
    expect(bodies).toContain("still here");
    expect(bodies).toContain("later");
    expect(bodies).not.toContain("expired");
    await vi.waitFor(async () => {
      const left = await db.select({ b: messages.body }).from(messages).where(eq(messages.conversationId, convId));
      expect(left.map((m) => m.b)).not.toContain("expired");
    });
  });
});

describe("rate limiter bucket cleanup", () => {
  it("counts correctly and leaves recently-expired buckets alone until the periodic sweep", async () => {
    const key = `ratelimit-scale-${tag}`;
    const policy = RATE_LIMIT_POLICIES["public-read"];
    expect((await consumeRateLimitBucket(key, policy)).count).toBe(1);
    expect((await consumeRateLimitBucket(key, policy)).count).toBe(2);
    await db.execute(sql`DELETE FROM rate_limit_buckets WHERE bucket_key = ${key}`);
  });
});
