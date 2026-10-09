/**
 * A deleted product (or a purged seller's catalog) must disappear for buyers
 * everywhere it is referenced by id: post tags, saves, bags, live-stream tag
 * JSON. Also covers the public seller reputation numbers (rating rollup +
 * salesCount), the block-aware product review count, and what purgeAccount
 * keeps (anonymized orders, ledger) vs. settles (pending Thread Cash sends,
 * live presence). Real Postgres; auth mocked at the boundary only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import {
  blocks, cartItems, db, liveViewers, orders, postTaggedProducts, posts, products, productVariants,
  reviews, savedItems, threadCashEntries, threadCashTransfers, users,
} from "@workspace/db";
import { purgeAccount } from "../../lib/accountDeletion";

vi.mock("../../middlewares/requireAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../middlewares/requireAuth")>();
  return {
    ...actual,
    requireAuth: (req: any, _res: any, next: () => void) => {
      req.clerkUserId = req.header("x-test-user-id");
      next();
    },
  };
});

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: null, sessionId: null }),
  clerkClient: { users: { getUser: async () => ({ passwordEnabled: true }) } },
}));

const RUN = `pdc${crypto.randomBytes(5).toString("hex")}`;
const SELLER = `${RUN}_seller`;
const BUYER = `${RUN}_buyer`;     // purged in the account-deletion test
const SHOPPER = `${RUN}_shopper`; // another buyer whose bag/saves must drop the purged seller
const BLOCKED = `${RUN}_blocked`; // blocked by BUYER; wrote a review
const ALL_USERS = [SELLER, BUYER, SHOPPER, BLOCKED];

let server: Server;
let base = "";
let activeId = "";
let deletedId = "";
let draftId = "";
let deletedVariantId = "";
let postId = "";
let streamId = "";
const orderIds: string[] = [];
let buyerOrderId = "";

async function get(path: string, user?: string) {
  const response = await fetch(`${base}${path}`, { headers: user ? { "x-test-user-id": user } : {} });
  return { status: response.status, body: await response.json().catch(() => null) as any };
}

async function seedProduct(name: string, status: string) {
  const [p] = await db.insert(products).values({ ownerId: SELLER, name: `${RUN} ${name}`, status }).returning({ id: products.id });
  const [v] = await db.insert(productVariants).values({ productId: p.id, sku: `${RUN}-${name}`, priceCents: 2500, stock: 5 })
    .returning({ id: productVariants.id });
  return { productId: p.id, variantId: v.id };
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: SELLER, email: `${SELLER}@example.test`, name: "Cascade Seller", displayName: "Cascade Seller", accountType: "seller", role: "owner" },
    { clerkId: BUYER, email: `${BUYER}@example.test`, name: "Cascade Buyer", accountType: "buyer", role: "buyer" },
    { clerkId: SHOPPER, email: `${SHOPPER}@example.test`, name: "Cascade Shopper", accountType: "buyer", role: "buyer" },
    { clerkId: BLOCKED, email: `${BLOCKED}@example.test`, name: "Cascade Blocked", accountType: "buyer", role: "buyer" },
  ]);
  activeId = (await seedProduct("active", "active")).productId;
  const deleted = await seedProduct("deleted", "active");
  deletedId = deleted.productId;
  deletedVariantId = deleted.variantId;
  draftId = (await seedProduct("draft", "draft")).productId;

  const [post] = await db.insert(posts).values({ userId: SELLER, mediaUrl: "https://cdn.test/cascade.jpg" }).returning({ id: posts.id });
  postId = post.id;
  await db.insert(postTaggedProducts).values([
    { postId, productId: activeId, position: 0 },
    { postId, productId: deletedId, position: 1 },
    { postId, productId: draftId, position: 2 },
  ]);

  const streamRows = await db.execute(sql`
    INSERT INTO live_streams (seller_id, channel_name, title, status, product_tags, pinned_product_id)
    VALUES (${SELLER}, ${`${RUN}-channel`}, 'Cascade live', 'live',
            ${JSON.stringify([{ productId: activeId, productName: "A" }, { productId: deletedId, productName: "D" }])}::jsonb,
            ${deletedId}::uuid)
    RETURNING id`);
  streamId = (streamRows as any).rows[0].id;
  await db.insert(liveViewers).values({ streamId, userIdOrSessionId: SELLER });

  for (const [who, savedTarget] of [[BUYER, deletedId], [BUYER, activeId], [SHOPPER, activeId]] as const) {
    await db.insert(savedItems).values({ userId: who, itemType: "product", targetId: savedTarget, title: "saved" });
  }
  await db.insert(cartItems).values([
    { userId: BUYER, variantId: "line-active", itemData: { productId: activeId, productName: "A", quantity: 1 } },
    { userId: BUYER, variantId: "line-deleted", itemData: { productId: deletedId, productName: "D", quantity: 1 } },
    // Older line shapes carry only the variant id.
    { userId: BUYER, variantId: deletedVariantId, itemData: { productName: "D by variant", quantity: 1 } },
    { userId: SHOPPER, variantId: "line-shopper", itemData: { productId: activeId, productName: "A", quantity: 1 } },
  ]);

  // The seller deletes one product (as DELETE /api/products/:id does).
  await db.update(products).set({ deletedAt: new Date(), recoverableUntil: new Date(Date.now() + 300_000), removalKind: "seller_deleted" })
    .where(eq(products.id, deletedId));

  // Sales: two paid + live, one paid but cancelled, one unpaid.
  const orderSeeds = [
    { buyerId: BUYER, status: "delivered", paidAt: new Date() },
    { buyerId: SHOPPER, status: "processing", paidAt: new Date() },
    { buyerId: SHOPPER, status: "cancelled", paidAt: new Date() },
    { buyerId: SHOPPER, status: "pending", paidAt: null },
  ];
  for (const [i, seed] of orderSeeds.entries()) {
    const [o] = await db.insert(orders).values({
      ownerId: SELLER, orderNumber: `${RUN}-${i}`, totalCents: 2500, subtotalCents: 2500,
      shippingAddress: { street: "1 Test St", city: "Testville", state: "TS", zip: "00000", country: "US" },
      ...seed,
    }).returning({ id: orders.id });
    orderIds.push(o.id);
  }
  buyerOrderId = orderIds[0];

  await db.insert(reviews).values([
    { buyerId: BUYER, sellerId: SELLER, productId: activeId, orderId: buyerOrderId, rating: 5 },
    { buyerId: BLOCKED, sellerId: SELLER, productId: activeId, rating: 2 },
  ]);
  await db.insert(blocks).values({ blockerId: BUYER, blockedId: BLOCKED });

  const [{ default: postsRouter }, { default: publicRouter }, { default: savedRouter }, { default: cartRouter }, { default: liveRouter }, { default: reviewsRouter }] =
    await Promise.all([
      import("../posts"), import("../public"), import("../saved"), import("../cart-db"), import("../live"), import("../reviews"),
    ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    const user = req.header("x-test-user-id");
    if (user) (req as any).clerkUserId = user;
    next();
  });
  app.use("/api/posts", postsRouter);
  app.use("/api/public", publicRouter);
  app.use("/api/buyer/saved", savedRouter);
  app.use("/api/buyer/cart", cartRouter);
  app.use("/api/live", liveRouter);
  app.use("/api/reviews", reviewsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const productIds = [activeId, deletedId, draftId].filter(Boolean);
  await db.delete(reviews).where(or(inArray(reviews.buyerId, ALL_USERS), like(reviews.sellerId, `${RUN}%`), inArray(reviews.productId, productIds)));
  if (orderIds.length) await db.delete(reviews).where(inArray(reviews.orderId, orderIds));
  if (orderIds.length) await db.delete(orders).where(inArray(orders.id, orderIds));
  await db.delete(threadCashEntries).where(like(threadCashEntries.buyerId, `${RUN}%`));
  await db.delete(threadCashTransfers).where(or(like(threadCashTransfers.senderId, `${RUN}%`), like(threadCashTransfers.recipientId, `${RUN}%`)));
  await db.execute(sql`DELETE FROM live_streams WHERE channel_name = ${`${RUN}-channel`}`);
  await db.delete(posts).where(eq(posts.id, postId));
  await db.delete(savedItems).where(inArray(savedItems.userId, ALL_USERS));
  await db.delete(cartItems).where(inArray(cartItems.userId, ALL_USERS));
  await db.delete(blocks).where(or(inArray(blocks.blockerId, ALL_USERS), inArray(blocks.blockedId, ALL_USERS)));
  if (productIds.length) await db.delete(products).where(inArray(products.id, productIds));
  await db.delete(users).where(inArray(users.clerkId, ALL_USERS));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("deleted products disappear for buyers", () => {
  it("drops deleted products from post tags; drafts show only to their owner", async () => {
    const asBuyer = await get(`/api/posts/${postId}`, BUYER);
    expect(asBuyer.status).toBe(200);
    expect(asBuyer.body.taggedProducts.map((t: any) => t.productId)).toEqual([activeId]);

    const asSeller = await get(`/api/posts/${postId}`, SELLER);
    expect(asSeller.body.taggedProducts.map((t: any) => t.productId)).toEqual([activeId, draftId]);

    const storefront = await get(`/api/public/sellers/${SELLER}`);
    expect(storefront.status).toBe(200);
    const text = JSON.stringify(storefront.body.posts);
    expect(text).toContain(activeId);
    expect(text).not.toContain(deletedId);
    expect(text).not.toContain(draftId);
  });

  it("hides a deleted product from the buyer's saves", async () => {
    const saved = await get("/api/buyer/saved", BUYER);
    expect(saved.status).toBe(200);
    expect(saved.body.map((s: any) => s.targetId)).toEqual([activeId]);
  });

  it("keeps a deleted product in the bag but flags it unavailable (by productId or variant)", async () => {
    const cart = await get("/api/buyer/cart", BUYER);
    expect(cart.status).toBe(200);
    const byName = Object.fromEntries(cart.body.items.map((i: any) => [i.productName, i]));
    expect(byName["A"].unavailable).toBeUndefined();
    expect(byName["D"]).toMatchObject({ unavailable: true, isAvailable: false });
    expect(byName["D by variant"]).toMatchObject({ unavailable: true });
  });

  it("filters deleted products out of a live stream's tags and pin", async () => {
    const live = await get(`/api/live/${streamId}`, BUYER);
    expect(live.status).toBe(200);
    expect(live.body.stream.product_tags.map((t: any) => t.productId)).toEqual([activeId]);
    expect(live.body.stream.pinned_product_id).toBeNull();
  });
});

describe("reviews and seller reputation", () => {
  it("counts product reviews with the same block filter as the list", async () => {
    const anon = await get(`/api/reviews/product/${activeId}`);
    expect(anon.body.totalCount).toBe(2);
    const asBuyer = await get(`/api/reviews/product/${activeId}`, BUYER);
    expect(asBuyer.body.reviews).toHaveLength(1);
    expect(asBuyer.body.totalCount).toBe(1);
    expect(asBuyer.body.avgRating).toBe(5);
  });

  it("exposes the seller rating rollup and a real salesCount on the public profile", async () => {
    const storefront = await get(`/api/public/sellers/${SELLER}`);
    expect(storefront.body.profile).toMatchObject({ avgRating: 3.5, reviewCount: 2, salesCount: 2 });
    const sellerReviews = await get(`/api/reviews/seller/${SELLER}`);
    expect(sellerReviews.body).toMatchObject({ avgRating: 3.5, totalCount: 2 });
  });
});

describe("purgeAccount", () => {
  it("keeps the seller's order with the purged buyer's fields nulled", async () => {
    expect(await purgeAccount(BUYER)).toBe(true);
    const [order] = await db.select().from(orders).where(eq(orders.id, buyerOrderId));
    expect(order).toMatchObject({ ownerId: SELLER, buyerId: null, shippingAddress: null, status: "delivered", totalCents: 2500 });
  });

  it("removes a purged seller's products from other buyers' bags and saves, settles sends and presence", async () => {
    const [toSeller] = await db.insert(threadCashTransfers).values({ senderId: SHOPPER, recipientId: SELLER, amountCents: 500 })
      .returning({ id: threadCashTransfers.id });
    const [fromSeller] = await db.insert(threadCashTransfers).values({ senderId: SELLER, recipientId: SHOPPER, amountCents: 300 })
      .returning({ id: threadCashTransfers.id });

    expect(await purgeAccount(SELLER)).toBe(true);

    const [product] = await db.select().from(products).where(eq(products.id, activeId));
    expect(product.status).toBe("archived");
    expect(product.deletedAt).not.toBeNull();
    expect(product.recoverableUntil).toBeNull();

    const saved = await get("/api/buyer/saved", SHOPPER);
    expect(saved.body).toEqual([]);
    const cart = await get("/api/buyer/cart", SHOPPER);
    expect(cart.body.items).toEqual([expect.objectContaining({ productId: activeId, unavailable: true })]);

    const transfers = await db.select().from(threadCashTransfers).where(inArray(threadCashTransfers.id, [toSeller.id, fromSeller.id]));
    expect(transfers.map((t) => t.status)).toEqual(["cancelled", "cancelled"]);
    const refunds = await db.select().from(threadCashEntries)
      .where(and(eq(threadCashEntries.source, "send_cancelled"), inArray(threadCashEntries.referenceId, [toSeller.id, fromSeller.id])));
    expect(refunds.map((r) => [r.buyerId, r.amountCents]).sort()).toEqual([[SELLER, 300], [SHOPPER, 500]].sort());

    expect(await db.select().from(liveViewers).where(eq(liveViewers.userIdOrSessionId, SELLER))).toEqual([]);

    // Sales history stays (anonymized seller), never deleted.
    const kept = await db.select({ id: orders.id, ownerId: orders.ownerId }).from(orders).where(inArray(orders.id, orderIds));
    expect(kept).toHaveLength(orderIds.length);
    for (const o of kept) expect(o.ownerId).toMatch(/^deleted:/);
  });
});
