import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  blocks, db, follows, interactions, notificationsFeed, orderItems, orders, postFitChecks, postStitches,
  productVariants, products, posts, repostRequests, users,
} from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id");
    if (!req.clerkUserId) return res.status(401).json({ error: "Unauthorized" });
    next();
  },
}));

const suffix = crypto.randomBytes(6).toString("hex");
const id = (n: string) => `fits-${n}-${suffix}`;
const brand = id("brand");
const brand2 = id("brand2");
const buyer = id("buyer");
const friend = id("friend");
const stranger = id("stranger");
const blocked = id("blocked");
const privateBuyer = id("private");
const userIds = [brand, brand2, buyer, friend, stranger, blocked, privateBuyer];

let server: Server;
let base = "";
let productId = "";
let otherProductId = "";
let refundedProductId = "";

async function call(path: string, userId: string | null, options: RequestInit = {}) {
  const r = await fetch(`${base}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(userId ? { "x-test-user-id": userId } : {}), ...(options.headers ?? {}) },
  });
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
}
const post = (path: string, userId: string, body: unknown) => call(path, userId, { method: "POST", body: JSON.stringify(body) });
const put = (path: string, userId: string, body: unknown) => call(path, userId, { method: "PUT", body: JSON.stringify(body) });

async function seedPost(userId: string, extra: Record<string, unknown> = {}) {
  const [row] = await db.insert(posts).values({
    userId, mediaUrl: "https://img.test/p.jpg", mediaType: "photo", caption: "fit", postStatus: "published", ...extra,
  } as any).returning({ id: posts.id });
  return row.id;
}

async function seedOrder(buyerId: string, pid: string, opts: { status?: string; paid?: boolean; refunded?: boolean } = {}) {
  const [variant] = await db.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.productId, pid)).limit(1);
  const [order] = await db.insert(orders).values({
    ownerId: brand, buyerId, orderNumber: `F-${crypto.randomBytes(4).toString("hex")}`, status: opts.status ?? "delivered",
    totalCents: 1000, subtotalCents: 1000, paidAt: opts.paid === false ? null : new Date(),
  } as any).returning({ id: orders.id });
  await db.insert(orderItems).values({
    orderId: order.id, variantId: variant.id, productName: "Tee", quantity: 1, priceCents: 1000,
    refundedAt: opts.refunded ? new Date() : null,
  } as any);
}

async function seedProduct(name: string) {
  const [p] = await db.insert(products).values({ ownerId: brand, name } as any).returning({ id: products.id });
  await db.insert(productVariants).values({ productId: p.id, sku: `sku-${crypto.randomBytes(5).toString("hex")}`, priceCents: 1000 } as any);
  return p.id;
}

beforeAll(async () => {
  const u = (clerkId: string, accountType: string, extra: Record<string, unknown> = {}) => ({
    clerkId, email: `${clerkId}@t.local`, name: clerkId, displayName: clerkId.split("-")[1],
    username: clerkId.replace(/-/g, "_"), role: accountType, accountType, ...extra,
  });
  await db.insert(users).values([
    u(brand, "seller", { brandName: "Nova Studio" }), u(brand2, "seller", { brandName: "Other Brand" }),
    u(buyer, "buyer"), u(friend, "buyer"), u(stranger, "buyer"), u(blocked, "buyer"),
    u(privateBuyer, "buyer", { isPrivate: true }),
  ] as any);
  await db.insert(follows).values([
    { followerId: buyer, followingId: friend }, { followerId: friend, followingId: buyer },
  ]);
  await db.insert(blocks).values({ blockerId: buyer, blockedId: blocked });
  productId = await seedProduct("Tee");
  otherProductId = await seedProduct("Jacket");
  refundedProductId = await seedProduct("Skirt");
  await seedOrder(buyer, productId);
  await seedOrder(privateBuyer, productId);
  await seedOrder(buyer, refundedProductId, { refunded: true });
  await seedOrder(buyer, otherProductId, { status: "cancelled" });

  const { default: fitsRouter, productFitChecksRouter } = await import("../fits");
  const { default: postsRouter } = await import("../posts");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.clerkUserId = req.header("x-test-user-id") || undefined; next(); });
  app.use("/api/products", productFitChecksRouter);
  app.use("/api/posts", postsRouter);
  app.use("/api/fits", fitsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, userIds));
  await db.delete(interactions).where(inArray(interactions.userId, userIds));
  await db.delete(repostRequests).where(inArray(repostRequests.ownerUserId, userIds));
  await db.delete(posts).where(inArray(posts.userId, userIds));
  const ords = await db.select({ id: orders.id }).from(orders).where(inArray(orders.buyerId, userIds));
  if (ords.length) await db.delete(orders).where(inArray(orders.id, ords.map((o) => o.id)));
  await db.delete(products).where(inArray(products.id, [productId, otherProductId, refundedProductId].filter(Boolean)));
  await db.delete(follows).where(inArray(follows.followerId, userIds));
  await db.delete(blocks).where(or(inArray(blocks.blockerId, userIds), inArray(blocks.blockedId, userIds)));
  await db.delete(users).where(inArray(users.clerkId, userIds));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("buyer fit checks", () => {
  it("lists only products the buyer actually bought", async () => {
    const r = await call("/api/fits/purchased-products", buyer);
    expect(r.status).toBe(200);
    expect(r.body.products.map((p: any) => p.id)).toEqual([productId]);
    expect(r.body.products[0]).toMatchObject({ name: "Tee", brandName: "Nova Studio" });
  });

  it("links a fit check to a purchased product and shows it publicly on the product", async () => {
    const pid = await seedPost(buyer, { surface: "profile" });
    const linked = await put(`/api/fits/fit-checks/${pid}`, buyer, { productId });
    expect(linked.status).toBe(200);
    const strip = await call(`/api/products/${productId}/fit-checks`, null);
    expect(strip.status).toBe(200);
    expect(strip.body.fitChecks.map((f: any) => f.postId)).toContain(pid);
    // The buyer chose to show it on the product page, so a stranger can open it.
    expect((await call(`/api/posts/${pid}`, stranger)).status).toBe(200);
    const fc = await call(`/api/fits/fit-checks/${pid}`, stranger);
    expect(fc.body.fitCheck.product.id).toBe(productId);
  });

  it("refuses products not bought, refunded or cancelled (purchase verified server-side)", async () => {
    const pid = await seedPost(buyer, { surface: "profile" });
    for (const p of [otherProductId, refundedProductId]) {
      const r = await put(`/api/fits/fit-checks/${pid}`, buyer, { productId: p });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe("NOT_PURCHASED");
    }
    const strangerPost = await seedPost(stranger, { surface: "profile" });
    expect((await put(`/api/fits/fit-checks/${strangerPost}`, stranger, { productId })).body.code).toBe("NOT_PURCHASED");
  });

  it("only the post's owner (a buyer) can link or unlink it", async () => {
    const pid = await seedPost(buyer, { surface: "profile" });
    expect((await put(`/api/fits/fit-checks/${pid}`, friend, { productId })).status).toBe(404);
    const brandPost = await seedPost(brand, { surface: "thread" });
    expect((await put(`/api/fits/fit-checks/${brandPost}`, brand, { productId })).body.code).toBe("BUYERS_ONLY");
    await put(`/api/fits/fit-checks/${pid}`, buyer, { productId });
    expect((await call(`/api/fits/fit-checks/${pid}`, friend, { method: "DELETE" })).status).toBe(404);
    expect((await call(`/api/fits/fit-checks/${pid}`, buyer, { method: "DELETE" })).status).toBe(200);
    const [row] = await db.select().from(postFitChecks).where(eq(postFitChecks.postId, pid));
    expect(row).toBeUndefined();
  });

  it("hides blocked authors, private accounts from non-followers, and unpublished posts", async () => {
    const pid = await seedPost(buyer, { surface: "profile" });
    await put(`/api/fits/fit-checks/${pid}`, buyer, { productId });
    const priv = await seedPost(privateBuyer, { surface: "profile" });
    expect((await put(`/api/fits/fit-checks/${priv}`, privateBuyer, { productId })).status).toBe(200);
    const draft = await seedPost(buyer, { surface: "profile" });
    await put(`/api/fits/fit-checks/${draft}`, buyer, { productId });
    await db.update(posts).set({ postStatus: "draft" }).where(eq(posts.id, draft));

    const anon = (await call(`/api/products/${productId}/fit-checks`, null)).body.fitChecks.map((f: any) => f.postId);
    expect(anon).toContain(pid);
    expect(anon).not.toContain(priv);
    expect(anon).not.toContain(draft);
    const asBlocked = (await call(`/api/products/${productId}/fit-checks`, blocked)).body.fitChecks.map((f: any) => f.postId);
    expect(asBlocked).not.toContain(pid);

    await db.insert(follows).values({ followerId: stranger, followingId: privateBuyer });
    const asFollower = (await call(`/api/products/${productId}/fit-checks`, stranger)).body.fitChecks.map((f: any) => f.postId);
    expect(asFollower).toContain(priv);
  });

  it("does not open non-fit-check buyer posts to strangers", async () => {
    const pid = await seedPost(buyer, { surface: "profile" });
    expect((await call(`/api/posts/${pid}`, stranger)).status).toBe(404);
    expect((await call(`/api/fits/fit-checks/${pid}`, stranger)).status).toBe(404);
  });
});

describe("stitch", () => {
  it("links a fresh own post to a visible original, records a repost and notifies", async () => {
    const original = await seedPost(brand, { surface: "thread", mediaType: "video" });
    const source = await call(`/api/fits/stitch-source/${original}`, buyer);
    expect(source.status).toBe(200);
    expect(source.body.source.author.brandName).toBe("Nova Studio");
    const mine = await seedPost(buyer, { surface: "profile", mediaType: "video" });
    const r = await post("/api/fits/stitches", buyer, { postId: mine, sourcePostId: original, clipStartMs: 1000, clipEndMs: 6000 });
    expect(r.status).toBe(201);
    const read = await call(`/api/fits/stitches/${mine}`, buyer);
    expect(read.body.stitch).toMatchObject({ clipStartMs: 1000, clipEndMs: 6000, source: { id: original }, sourceAuthor: { brandName: "Nova Studio" } });
    const reposts = await db.select().from(interactions).where(and(eq(interactions.postId, original), eq(interactions.userId, buyer), eq(interactions.type, "repost")));
    expect(reposts).toHaveLength(1);
    await vi.waitFor(async () => {
      const notes = await db.select().from(notificationsFeed).where(and(eq(notificationsFeed.userId, brand), eq(notificationsFeed.type, "stitch")));
      expect(notes.length).toBeGreaterThan(0);
    });
    // Linking twice is refused.
    expect((await post("/api/fits/stitches", buyer, { postId: mine, sourcePostId: original })).body.code).toBe("ALREADY_STITCHED");
  });

  it("validates the clip, ownership and the link window", async () => {
    const original = await seedPost(brand, { surface: "thread" });
    const mine = await seedPost(buyer, { surface: "profile" });
    expect((await post("/api/fits/stitches", buyer, { postId: mine, sourcePostId: original, clipStartMs: 0, clipEndMs: 9000 })).body.code).toBe("INVALID_CLIP");
    expect((await post("/api/fits/stitches", friend, { postId: mine, sourcePostId: original })).status).toBe(404);
    const old = await seedPost(buyer, { surface: "profile", createdAt: new Date(Date.now() - 60 * 60_000) });
    expect((await post("/api/fits/stitches", buyer, { postId: old, sourcePostId: original })).body.code).toBe("STITCH_WINDOW_CLOSED");
    expect((await post("/api/fits/stitches", buyer, { postId: mine, sourcePostId: mine })).status).toBe(400);
  });

  it("respects allowReposts, blocks and friends-only buyer posts", async () => {
    const noReposts = await seedPost(brand, { surface: "thread", visibility: { isPublic: true, allowComments: true, allowReposts: false, showLikeCount: true } });
    expect((await call(`/api/fits/stitch-source/${noReposts}`, buyer)).body.code).toBe("REPOSTS_DISABLED");
    const buyerPost = await seedPost(buyer, { surface: "profile" });
    expect((await call(`/api/fits/stitch-source/${buyerPost}`, blocked)).status).toBe(404);
    expect((await call(`/api/fits/stitch-source/${buyerPost}`, stranger)).status).toBe(404);
    expect((await call(`/api/fits/stitch-source/${buyerPost}`, friend)).status).toBe(200);
    expect((await call(`/api/fits/stitch-source/${buyerPost}`, buyer)).body.code).toBe("STITCH_OWN_POST");
  });

  it("a brand cannot stitch a buyer's post without permission", async () => {
    const pid = await seedPost(buyer, { surface: "profile" });
    await put(`/api/fits/fit-checks/${pid}`, buyer, { productId });
    expect((await call(`/api/fits/stitch-source/${pid}`, brand)).body.code).toBe("REPOST_PERMISSION_REQUIRED");
  });
});

describe("brand repost requests", () => {
  async function fitCheck() {
    const pid = await seedPost(buyer, { surface: "profile" });
    await put(`/api/fits/fit-checks/${pid}`, buyer, { productId });
    return pid;
  }

  it("blocks brand reposts and quotes of buyer posts until the buyer approves", async () => {
    const pid = await fitCheck();
    const plain = await post(`/api/posts/${pid}/interact`, brand, { type: "repost" });
    expect(plain.status).toBe(403);
    expect(plain.body.code).toBe("REPOST_PERMISSION_REQUIRED");
    const quote = await post("/api/posts", brand, { quotedPostId: pid, caption: "love this" });
    expect(quote.body.code).toBe("REPOST_PERMISSION_REQUIRED");
    // Buyers reposting buyers is unchanged.
    expect((await post(`/api/posts/${pid}/interact`, friend, { type: "repost" })).status).toBe(200);
  });

  it("request → notification → approve creates the brand's repost", async () => {
    const pid = await fitCheck();
    const req1 = await post("/api/fits/repost-requests", brand, { postId: pid });
    expect(req1.status).toBe(201);
    expect(req1.body.request.status).toBe("pending");
    // A second tap returns the same pending request.
    const again = await post("/api/fits/repost-requests", brand, { postId: pid });
    expect(again.body.request.id).toBe(req1.body.request.id);
    const notes = await db.select().from(notificationsFeed).where(and(eq(notificationsFeed.userId, buyer), eq(notificationsFeed.type, "repost_request")));
    expect(notes.some((n) => n.targetId === req1.body.request.id && n.targetType === "repost_request")).toBe(true);

    const detail = await call(`/api/fits/repost-requests/${req1.body.request.id}`, buyer);
    expect(detail.body.request).toMatchObject({ status: "pending", brand: { name: "Nova Studio" }, post: { id: pid } });
    expect((await call(`/api/fits/repost-requests/${req1.body.request.id}`, stranger)).status).toBe(404);

    // Only the owner answers.
    expect((await post(`/api/fits/repost-requests/${req1.body.request.id}/respond`, brand, { decision: "approve" })).status).toBe(403);
    const ok = await post(`/api/fits/repost-requests/${req1.body.request.id}/respond`, buyer, { decision: "approve" });
    expect(ok.status).toBe(200);
    expect(ok.body.request.status).toBe("approved");
    const reposts = await db.select().from(interactions).where(and(eq(interactions.postId, pid), eq(interactions.userId, brand), eq(interactions.type, "repost")));
    expect(reposts).toHaveLength(1);
    // Answered requests don't move again.
    expect((await post(`/api/fits/repost-requests/${req1.body.request.id}/respond`, buyer, { decision: "decline" })).body.code).toBe("NOT_PENDING");
    // After approval the brand can un-repost and repost through the normal path.
    expect((await post(`/api/posts/${pid}/interact`, brand, { type: "repost", value: "remove" })).status).toBe(200);
    expect((await post(`/api/posts/${pid}/interact`, brand, { type: "repost" })).status).toBe(200);
    expect((await call(`/api/fits/repost-requests/status?postId=${pid}`, brand)).body.request.status).toBe("approved");
    expect((await post("/api/fits/repost-requests", brand, { postId: pid })).body.code).toBe("ALREADY_APPROVED");
    // Approval is per brand.
    expect((await post(`/api/posts/${pid}/interact`, brand2, { type: "repost" })).body.code).toBe("REPOST_PERMISSION_REQUIRED");
  });

  it("approval works even when the buyer turned reposts off", async () => {
    const pid = await fitCheck();
    await db.update(posts).set({ visibility: { isPublic: true, allowComments: true, allowReposts: false, showLikeCount: true } }).where(eq(posts.id, pid));
    const r = await post("/api/fits/repost-requests", brand2, { postId: pid });
    await post(`/api/fits/repost-requests/${r.body.request.id}/respond`, buyer, { decision: "approve" });
    const reposts = await db.select().from(interactions).where(and(eq(interactions.postId, pid), eq(interactions.userId, brand2), eq(interactions.type, "repost")));
    expect(reposts).toHaveLength(1);
  });

  it("decline and cancel; declined requests can't be re-sent", async () => {
    const pid = await fitCheck();
    const r = await post("/api/fits/repost-requests", brand, { postId: pid });
    expect((await post(`/api/fits/repost-requests/${r.body.request.id}/cancel`, buyer, {})).status).toBe(403);
    expect((await post(`/api/fits/repost-requests/${r.body.request.id}/cancel`, brand, {})).body.request.status).toBe("cancelled");
    const r2 = await post("/api/fits/repost-requests", brand, { postId: pid });
    expect(r2.status).toBe(201);
    expect((await post(`/api/fits/repost-requests/${r2.body.request.id}/respond`, buyer, { decision: "decline" })).body.request.status).toBe("declined");
    expect((await post("/api/fits/repost-requests", brand, { postId: pid })).body.code).toBe("REQUEST_DECLINED");
    const reposts = await db.select().from(interactions).where(and(eq(interactions.postId, pid), eq(interactions.userId, brand)));
    expect(reposts).toHaveLength(0);
  });

  it("repost eligibility: true only for brands viewing a visible buyer post", async () => {
    const pid = await fitCheck();
    const elig = (u: string, p: string) => call(`/api/fits/posts/${p}/repost-eligibility`, u);
    expect((await elig(brand, pid)).body).toEqual({ eligible: true, request: null });
    // Non-brands, brand posts, own posts, friends-only buyer posts and blocked brands are not eligible.
    expect((await elig(friend, pid)).body.eligible).toBe(false);
    const brandPost = await seedPost(brand2, { surface: "thread" });
    expect((await elig(brand, brandPost)).body.eligible).toBe(false);
    expect((await elig(brand2, brandPost)).body.eligible).toBe(false);
    const friendsOnly = await seedPost(buyer, { surface: "profile" });
    expect((await elig(brand, friendsOnly)).body.eligible).toBe(false);
    await db.insert(blocks).values({ blockerId: buyer, blockedId: brand2 });
    expect((await elig(brand2, pid)).body.eligible).toBe(false);
    await db.delete(blocks).where(and(eq(blocks.blockerId, buyer), eq(blocks.blockedId, brand2)));
    // Carries the latest request state once one exists.
    const r = await post("/api/fits/repost-requests", brand, { postId: pid });
    expect((await elig(brand, pid)).body.request).toMatchObject({ id: r.body.request.id, status: "pending" });
    expect((await call(`/api/fits/posts/${pid}/repost-eligibility`, null)).status).toBe(401);
  });

  it("only brands can request, only for visible buyer posts, never across blocks", async () => {
    const pid = await fitCheck();
    expect((await post("/api/fits/repost-requests", friend, { postId: pid })).body.code).toBe("SELLERS_ONLY");
    const brandPost = await seedPost(brand2, { surface: "thread" });
    expect((await post("/api/fits/repost-requests", brand, { postId: brandPost })).body.code).toBe("NOT_A_BUYER_POST");
    const friendsOnly = await seedPost(buyer, { surface: "profile" });
    expect((await post("/api/fits/repost-requests", brand, { postId: friendsOnly })).status).toBe(404);
    await db.insert(blocks).values({ blockerId: buyer, blockedId: brand2 });
    expect((await post("/api/fits/repost-requests", brand2, { postId: pid })).status).toBe(404);
    await db.delete(blocks).where(and(eq(blocks.blockerId, buyer), eq(blocks.blockedId, brand2)));
  });
});

describe("cleanup sanity", () => {
  it("stitch rows cascade with their post", async () => {
    const original = await seedPost(brand, { surface: "thread" });
    const mine = await seedPost(friend, { surface: "profile" });
    await post("/api/fits/stitches", friend, { postId: mine, sourcePostId: original });
    await db.delete(posts).where(eq(posts.id, original));
    const [row] = await db.select().from(postStitches).where(eq(postStitches.postId, mine));
    expect(row.sourcePostId).toBeNull();
    expect((await call(`/api/fits/stitches/${mine}`, friend)).body.stitch.source).toEqual({ unavailable: true });
  });
});
