import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { inArray } from "drizzle-orm";
import { db, postLabels, postProductMentions, posts, products, productVariants, users } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const id = req.header("x-test-user-id");
    if (!id) return res.status(401).json({ error: "Unauthorized" });
    req.clerkUserId = id;
    next();
  },
}));
vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../notifications-feed", () => ({ publishNotification: async () => {} }));

const suffix = crypto.randomBytes(6).toString("hex");
const seller = `pml-seller-${suffix}`;
const otherSeller = `pml-other-${suffix}`;
const buyer = `pml-buyer-${suffix}`;
const userIds = [seller, otherSeller, buyer];

let server: Server;
let base = "";
let postId = "";
let buyerPostId = "";
let coatId = "";
let bootsId = "";
let draftProductId = "";
let othersProductId = "";

async function call(method: string, path: string, userId?: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(userId ? { "x-test-user-id": userId } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as any };
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: seller, email: `${seller}@t.local`, name: "Seller", role: "owner", accountType: "seller", brandName: "Atelier" },
    { clerkId: otherSeller, email: `${otherSeller}@t.local`, name: "Other", role: "owner", accountType: "seller" },
    { clerkId: buyer, email: `${buyer}@t.local`, name: "Buyer", role: "buyer", accountType: "buyer" },
  ]);
  const prods = await db.insert(products).values([
    { ownerId: seller, name: "Sculpted Wool Coat", status: "active", images: ["https://img.test/coat.jpg"] },
    { ownerId: seller, name: "Leather Ankle Boots", status: "active", images: [] },
    { ownerId: seller, name: "Unreleased Scarf", status: "draft", images: [] },
    { ownerId: otherSeller, name: "Someone Else's Bag", status: "active", images: [] },
  ]).returning({ id: products.id });
  [coatId, bootsId, draftProductId, othersProductId] = prods.map((p) => p.id);
  await db.insert(productVariants).values({ productId: coatId, sku: `coat-${suffix}`, priceCents: 48000 } as any);
  const [post] = await db.insert(posts).values({
    userId: seller, mediaUrl: "https://img.test/p.mp4", mediaType: "video",
    caption: "Fitting day for the Sculpted Wool Coat and Leather Ankle Boots", postStatus: "published",
  }).returning({ id: posts.id });
  postId = post.id;
  const [bp] = await db.insert(posts).values({
    userId: buyer, mediaUrl: "https://img.test/b.jpg", mediaType: "photo", caption: "my fit", postStatus: "published", surface: "profile",
  }).returning({ id: posts.id });
  buyerPostId = bp.id;

  const [{ default: extras }, { default: postsRouter }] = await Promise.all([import("../post-mentions-labels"), import("../posts")]);
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    if (!req.clerkUserId && req.header("x-test-user-id")) req.clerkUserId = req.header("x-test-user-id");
    next();
  });
  app.use("/api/posts", extras);
  app.use("/api/posts", postsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const ids = [postId, buyerPostId].filter(Boolean);
  if (ids.length) {
    await db.delete(postProductMentions).where(inArray(postProductMentions.postId, ids));
    await db.delete(postLabels).where(inArray(postLabels.postId, ids));
    await db.delete(posts).where(inArray(posts.id, ids));
  }
  await db.delete(productVariants).where(inArray(productVariants.productId, [coatId].filter(Boolean)));
  await db.delete(products).where(inArray(products.ownerId, userIds));
  await db.delete(users).where(inArray(users.clerkId, userIds));
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

describe("product mentions", () => {
  it("rejects non-authors, signed-out callers and unknown posts", async () => {
    const body = { mentions: [{ productId: coatId, label: "Sculpted Wool Coat" }] };
    expect((await call("PUT", `/api/posts/${postId}/product-mentions`, undefined, body)).status).toBe(401);
    const other = await call("PUT", `/api/posts/${postId}/product-mentions`, otherSeller, body);
    expect(other.status).toBe(403);
    expect(other.body.code).toBe("NOT_POST_OWNER");
    expect((await call("PUT", `/api/posts/${crypto.randomUUID()}/product-mentions`, seller, body)).status).toBe(404);
  });

  it("only accepts the author's own active products", async () => {
    const res = await call("PUT", `/api/posts/${postId}/product-mentions`, seller, {
      mentions: [
        { productId: coatId, label: "Sculpted Wool Coat" },
        { productId: othersProductId, label: "Fitting" },
        { productId: draftProductId, label: "day" },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PRODUCT_NOT_MENTIONABLE");
    expect(res.body.rejected.sort()).toEqual([othersProductId, draftProductId].sort());
    const rows = await db.select().from(postProductMentions).where(inArray(postProductMentions.postId, [postId]));
    expect(rows).toHaveLength(0);
  });

  it("requires every label to be in the caption", async () => {
    const res = await call("PUT", `/api/posts/${postId}/product-mentions`, seller, {
      mentions: [{ productId: coatId, label: "Cashmere Coat" }],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LABEL_NOT_IN_CAPTION");
  });

  it("stores mentions in caption order, replaces the set and returns them on post reads", async () => {
    const res = await call("PUT", `/api/posts/${postId}/product-mentions`, seller, {
      mentions: [
        { productId: bootsId, label: "Leather Ankle Boots" },
        { productId: coatId, label: "Sculpted Wool Coat" },
        { productId: coatId, label: "Sculpted Wool Coat" },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.productMentions.map((m: any) => [m.productId, m.position])).toEqual([[coatId, 0], [bootsId, 1]]);
    expect(res.body.productMentions[0]).toMatchObject({ name: "Sculpted Wool Coat", priceCents: 48000, images: ["https://img.test/coat.jpg"] });

    const read = await call("GET", `/api/posts/${postId}`);
    expect(read.status).toBe(200);
    expect(read.body.productMentions.map((m: any) => m.label)).toEqual(["Sculpted Wool Coat", "Leather Ankle Boots"]);
    expect(read.body.labels).toEqual([]);

    const cleared = await call("PUT", `/api/posts/${postId}/product-mentions`, seller, { mentions: [{ productId: coatId, label: "Sculpted Wool Coat" }] });
    expect(cleared.body.productMentions).toHaveLength(1);
  });

  it("hides a mention once its product is no longer active", async () => {
    await db.update(products).set({ status: "archived" }).where(inArray(products.id, [coatId]));
    const read = await call("GET", `/api/posts/${postId}`);
    expect(read.body.productMentions).toEqual([]);
    await db.update(products).set({ status: "active" }).where(inArray(products.id, [coatId]));
  });
});

describe("behind-the-scenes label", () => {
  it("is seller-only and author-only", async () => {
    const buyerRes = await call("PUT", `/api/posts/${buyerPostId}/labels`, buyer, { bts: true });
    expect(buyerRes.status).toBe(403);
    expect(buyerRes.body.code).toBe("SELLER_ONLY");
    expect((await call("PUT", `/api/posts/${postId}/labels`, otherSeller, { bts: true })).status).toBe(403);
    expect((await call("PUT", `/api/posts/${postId}/labels`, seller, { bts: "yes" })).status).toBe(400);
  });

  it("toggles on and off, is idempotent, and shows on reads + the label filter", async () => {
    expect((await call("PUT", `/api/posts/${postId}/labels`, seller, { bts: true })).body.labels).toEqual(["bts"]);
    expect((await call("PUT", `/api/posts/${postId}/labels`, seller, { bts: true })).body.labels).toEqual(["bts"]);
    expect((await call("GET", `/api/posts/${postId}`)).body.labels).toEqual(["bts"]);

    const list = await call("GET", `/api/posts?label=bts&sellerId=${encodeURIComponent(seller)}`);
    expect(list.status).toBe(200);
    expect(list.body.text).toBe("Behind the scenes");
    expect(list.body.items.map((i: any) => i.id)).toEqual([postId]);
    expect(list.body.items[0].labels).toEqual(["bts"]);

    expect((await call("GET", `/api/posts?label=nope&sellerId=${seller}`)).status).toBe(400);
    expect((await call("GET", `/api/posts?label=bts`)).status).toBe(400);

    expect((await call("PUT", `/api/posts/${postId}/labels`, seller, { bts: false })).body.labels).toEqual([]);
    const after = await call("GET", `/api/posts?label=bts&sellerId=${encodeURIComponent(seller)}`);
    expect(after.body.items).toEqual([]);
  });
});
