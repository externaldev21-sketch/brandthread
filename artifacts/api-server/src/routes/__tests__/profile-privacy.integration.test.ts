/**
 * Owner-vs-visitor privacy for every profile read a non-owner can reach.
 * A visitor (buyer, another seller, or signed-out) must never receive plan /
 * subscription, earnings, policy standing, contact details, order ids, or any
 * buyer-private data; the owner's own authenticated read still gets its plan.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { inArray, or } from "drizzle-orm";
import { db, follows, postUserTags, posts, stories, storyMentions, productVariants, products, reviews, users } from "@workspace/db";
import { PRIVATE_PROFILE_KEYS } from "../../lib/publicProfile";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id");
    if (!req.clerkUserId) { res.status(401).json({ error: "unauthorized" }); return; }
    next();
  },
}));
vi.mock("@clerk/express", () => ({
  getAuth: (req: any) => ({ userId: req.header("x-test-user-id") ?? null }),
  clerkMiddleware: () => (_req: any, _res: any, next: () => void) => next(),
}));
vi.mock("../notifications-feed", () => ({ publishNotification: async () => undefined }));

const suffix = crypto.randomBytes(6).toString("hex");
const seller = `pp-seller-${suffix}`;
const buyer = `pp-buyer-${suffix}`;
const visitor = `pp-visitor-${suffix}`;
const ids = [seller, buyer, visitor];
const SECRET_EMAIL = `secret-${suffix}@private.test`;
let sellerUuid = "";
let buyerUuid = "";
let productId = "";
let server: Server;
let base = "";

const get = (path: string, as?: string) =>
  fetch(`${base}${path}`, { headers: as ? { "x-test-user-id": as } : {} });

function keysDeep(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) { out.add(k); keysDeep(v, out); }
  }
  return out;
}

function expectPublicOnly(payload: unknown) {
  const leaked = PRIVATE_PROFILE_KEYS.filter((k) => keysDeep(payload).has(k));
  expect(leaked).toEqual([]);
  expect(JSON.stringify(payload)).not.toContain("@private.test");
}

beforeAll(async () => {
  const rows = await db.insert(users).values([
    {
      clerkId: seller, email: SECRET_EMAIL, name: "PP Seller", displayName: "PP Seller", username: `ppseller${suffix}`,
      role: "seller", accountType: "seller", brandName: "PP Brand", contactEmail: SECRET_EMAIL,
      subscriptionPlanId: "pro", subscriptionStatus: "active",
      returnPolicy: "secret policy", activeStanding: true,
    },
    { clerkId: buyer, email: `buyer-${SECRET_EMAIL}`, name: "PP Buyer", displayName: "PP Buyer", username: `ppbuyer${suffix}`, role: "buyer", accountType: "buyer" },
    { clerkId: visitor, email: `v-${suffix}@x.test`, name: "Visitor", displayName: "Visitor", role: "buyer", accountType: "buyer" },
  ]).returning({ id: users.id, clerkId: users.clerkId });
  sellerUuid = rows.find((r) => r.clerkId === seller)!.id;
  buyerUuid = rows.find((r) => r.clerkId === buyer)!.id;

  const [product] = await db.insert(products).values({ ownerId: seller, name: "PP Tee", status: "active" }).returning({ id: products.id });
  productId = product.id;
  await db.insert(productVariants).values({ productId, sku: `PP-${suffix}`, priceCents: 2500, stock: 4, lowStockThreshold: 2 });
  const [taggingPost] = await db.insert(posts).values([
    { userId: seller, mediaUrl: "https://example.test/p.jpg", caption: "hello" },
  ]).returning({ id: posts.id });
  const [byBuyer] = await db.insert(posts).values({ userId: buyer, mediaUrl: "https://example.test/t.jpg", caption: "tagging the brand" }).returning({ id: posts.id });
  await db.insert(postUserTags).values({ postId: byBuyer.id, taggedUserId: seller });
  void taggingPost;
  const soon = new Date(Date.now() + 3_600_000);
  const storyRows = await db.insert(stories).values([
    { authorId: buyer, authorName: "PP Buyer", media: [{ imageUri: "https://example.test/s1.jpg" }], expiresAt: soon },
    { authorId: buyer, authorName: "PP Buyer", media: [{ imageUri: "https://example.test/s2.jpg" }], expiresAt: soon, privacyVisibility: "friends" },
    { authorId: buyer, authorName: "PP Buyer", media: [{ imageUri: "https://example.test/s3.jpg" }], expiresAt: new Date(Date.now() - 1000) },
  ]).returning({ id: stories.id });
  await db.insert(storyMentions).values(storyRows.map((r) => ({ storyId: r.id, mentionedUserId: seller, taggerId: buyer })));
  await db.insert(posts).values({
    userId: seller, mediaUrl: "https://example.test/private.jpg", caption: "private",
    visibility: { isPublic: false, allowComments: true, allowReposts: true, showLikeCount: true },
  });
  await db.insert(reviews).values({ buyerId: buyer, sellerId: seller, productId, rating: 5, body: "great" });
  await db.insert(follows).values({ followerId: visitor, followingId: buyer });
  await db.insert(follows).values({ followerId: buyer, followingId: visitor });

  const { default: publicRouter } = await import("../public");
  const { default: socialRouter } = await import("../social");
  const { default: reviewsRouter } = await import("../reviews");
  const { default: profileMediaRouter } = await import("../profile-media");
  const app = express();
  app.use(express.json());
  app.use("/api/public", publicRouter);
  app.use("/api/public", profileMediaRouter);
  app.use("/api/social", socialRouter);
  app.use("/api/reviews", reviewsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(reviews).where(inArray(reviews.sellerId, ids));
  await db.delete(products).where(inArray(products.ownerId, ids));
  await db.delete(posts).where(inArray(posts.userId, ids)); // cascades post_user_tags
  await db.delete(stories).where(inArray(stories.authorId, ids)); // cascades story_mentions
  await db.delete(follows).where(or(inArray(follows.followerId, ids), inArray(follows.followingId, ids)));
  await db.delete(users).where(inArray(users.clerkId, ids));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("seller profile — what a visitor can read", () => {
  for (const [label, as] of [["signed out", undefined], ["a buyer", visitor], ["the seller's own id via public route", seller]] as const) {
    it(`GET /api/public/sellers/:id as ${label} has no plan, standing, policy, contact or sku/threshold`, async () => {
      const res = await get(`/api/public/sellers/${seller}`, as);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.profile).toMatchObject({ clerkId: seller, brandName: "PP Brand" });
      expect(body.products).toHaveLength(1);
      expect(body.products[0].variants[0]).toMatchObject({ priceCents: 2500, stock: 4 });
      expect(body.posts).toHaveLength(1);
      expectPublicOnly(body);
    });
  }

  it("also resolves the users.id alias without leaking", async () => {
    const body = await get(`/api/public/sellers/${sellerUuid}`, visitor).then((r) => r.json());
    expectPublicOnly(body);
  });

  it("GET /api/social/profile/:seller as a visitor is the public card only", async () => {
    const body = await get(`/api/social/profile/${seller}`, visitor).then((r) => r.json()) as any;
    expect(body).toMatchObject({ userId: seller, followersCount: 0, isFollowing: false });
    expectPublicOnly(body);
  });

  it("seller reviews never expose order ids", async () => {
    const body = await get(`/api/reviews/seller/${seller}`).then((r) => r.json()) as any;
    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0]).not.toHaveProperty("orderId");
    expectPublicOnly(body);
    const product = await get(`/api/reviews/product/${productId}`).then((r) => r.json()) as any;
    expect(product.reviews[0]).not.toHaveProperty("order_id");
    expect(product.reviews[0]).not.toHaveProperty("orderId");
  });

  it("the owner-only seller profile is not reachable by a visitor or signed out", async () => {
    const { default: sellerProfileRouter } = await import("../seller-profile");
    const app = express();
    app.use("/api/seller", sellerProfileRouter);
    const s = await new Promise<Server>((resolve) => { const srv = app.listen(0, "127.0.0.1", () => resolve(srv)); });
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/seller/profile`;
    try {
      expect((await fetch(url)).status).toBe(401);
      // A visitor asking for "the seller profile" only ever gets their OWN record.
      const asVisitor = await fetch(url, { headers: { "x-test-user-id": visitor } }).then((r) => r.json()) as any;
      expect(asVisitor.clerkId).not.toBe(seller);
      expect(JSON.stringify(asVisitor)).not.toContain("secret policy");
      // The owner does get their plan.
      const asOwner = await fetch(url, { headers: { "x-test-user-id": seller } }).then((r) => r.json()) as any;
      expect(asOwner).toMatchObject({ clerkId: seller, subscriptionPlanId: "pro" });
    } finally {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });
});

describe("public product reads", () => {
  it("list and detail variants carry no sku or restock threshold", async () => {
    const list = await get(`/api/public/products?ownerId=${seller}`).then((r) => r.json()) as any[];
    expect(list).toHaveLength(1);
    expect(list[0].variants[0]).toMatchObject({ priceCents: 2500, stock: 4 });
    expectPublicOnly(list);
    const detail = await get(`/api/public/products/${productId}`).then((r) => r.json()) as any;
    expect(detail.variants[0]).toMatchObject({ priceCents: 2500 });
    expectPublicOnly(detail);
  });
});

describe("View as visitor", () => {
  const captions = async (path: string, as: string) =>
    ((await get(path, as).then((r) => r.json())) as any).videos.map((v: any) => v.caption).sort();

  it("the owner sees private posts; ?as=visitor and real visitors do not", async () => {
    expect(await captions(`/api/public/users/${seller}/videos`, seller)).toEqual(["hello", "private"]);
    expect(await captions(`/api/public/users/${seller}/videos?as=visitor`, seller)).toEqual(["hello"]);
    expect(await captions(`/api/public/users/${seller}/videos`, visitor)).toEqual(["hello"]);
  });

  it("?as=visitor can never grant owner access to someone else", async () => {
    expect(await captions(`/api/public/users/${seller}/videos?as=owner`, visitor)).toEqual(["hello"]);
  });
});

describe("Tagged tab", () => {
  it("lists public posts that tagged the profile, as a minimal card", async () => {
    const rows = await get(`/api/social/profile/${seller}/tagged`, visitor).then((r) => r.json()) as any[];
    expect(rows.map((r) => r.source).sort()).toEqual(["post", "story"]);
    expect(rows.find((r) => r.source === "post")).toMatchObject({ authorId: buyer, caption: "tagging the brand" });
    expectPublicOnly(rows);
  });

  it("includes live public story mentions only — not friends-only, expired, or from authors the viewer does not follow", async () => {
    const rows = await get(`/api/social/profile/${seller}/tagged`, visitor).then((r) => r.json()) as any[];
    const storiesOnly = rows.filter((r) => r.source === "story");
    expect(storiesOnly).toHaveLength(1);
    expect(storiesOnly[0]).toMatchObject({ authorId: buyer, thumbnailUrl: "https://example.test/s1.jpg", mediaType: "story" });
    // seller follows nobody, so a story by `buyer` is not one the seller could open as a stranger
    const asStranger = await get(`/api/social/profile/${seller}/tagged`, seller).then((r) => r.json()) as any[];
    expect(asStranger.filter((r) => r.source === "story")).toHaveLength(1); // the tagged account itself may see it
  });

  it("resolves the users.id alias and is empty for an untagged account", async () => {
    expect(await get(`/api/social/profile/${sellerUuid}/tagged`, visitor).then((r) => r.json())).toHaveLength(2);
    expect(await get(`/api/social/profile/${buyer}/tagged`, visitor).then((r) => r.json())).toEqual([]);
  });
});

describe("buyer profile — what a visitor can read", () => {
  it("GET /api/social/profile/:buyer returns identity + counts only", async () => {
    const res = await get(`/api/social/profile/${buyer}`, visitor);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toMatchObject({ userId: buyer, name: "PP Buyer", followersCount: 1, followingCount: 1 });
    expectPublicOnly(body);
    const allowed = new Set([
      "userId", "name", "username", "displayName", "bio", "avatarUrl", "accountType", "initials", "color", "handle",
      "coverVideoUrl", "coverPosterUrl", "followersCount", "followingCount", "likesCount", "postsCount", "isFollowing",
      "isFollowedBy", "isMutual", "iBlockedThem",
    ]);
    expect(Object.keys(body).filter((k) => !allowed.has(k))).toEqual([]);
  });

  it("the users.id alias returns the same allow-listed card", async () => {
    const body = await get(`/api/social/profile/${buyerUuid}`, visitor).then((r) => r.json()) as any;
    expect(body.userId).toBe(buyer);
    expectPublicOnly(body);
  });

  it("GET /api/public/profiles/:username exposes no email or private fields", async () => {
    const body = await get(`/api/public/profiles/ppbuyer${suffix}`).then((r) => r.json()) as any;
    expect(body).toMatchObject({ username: `ppbuyer${suffix}`, accountType: "buyer" });
    expectPublicOnly(body);
  });

  it("private buyer routes refuse a signed-out caller and are scoped to the caller", async () => {
    const { default: buyerRouter } = await import("../buyer");
    const app = express();
    app.use(express.json());
    app.use("/api/buyer", buyerRouter);
    const s = await new Promise<Server>((resolve) => { const srv = app.listen(0, "127.0.0.1", () => resolve(srv)); });
    const root = `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/buyer`;
    try {
      for (const path of ["/orders", "/addresses"]) {
        expect((await fetch(`${root}${path}`)).status).toBe(401);
        // Visitor is identified as themselves — there is no way to name another buyer.
        const res = await fetch(`${root}${path}?userId=${buyer}&buyerId=${buyer}`, { headers: { "x-test-user-id": visitor } });
        const text = await res.text();
        expect(text).not.toContain("@private.test");
        expect(text).not.toContain(buyer);
      }
    } finally {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });
});
