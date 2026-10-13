import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { closetOutfits, db, orderItems, orders, posts, productVariants, products, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const buyerId = `closet-buyer-${suffix}`;
const otherBuyerId = `closet-other-${suffix}`;
const sellerId = `closet-seller-${suffix}`;
const authState = vi.hoisted(() => ({ clerkUserId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = authState.clerkUserId;
    next();
  },
}));

let server: Server;
let base = "";
const ids = {
  productDelivered: "", productRefunded: "", productInTransit: "",
  itemDelivered: "", itemRefunded: "", itemInTransit: "", itemCancelled: "",
  orders: [] as string[], posts: [] as string[],
};

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  return { status: response.status, body: await response.json() as any };
}

async function product(name: string, size: string) {
  const [p] = await db.insert(products).values({
    ownerId: sellerId, name, status: "active", images: [`https://cdn.test/${name}.jpg`],
  }).returning({ id: products.id });
  const [v] = await db.insert(productVariants).values({
    productId: p.id, size, sku: `closet-${suffix}-${name}`, priceCents: 4_000,
  }).returning({ id: productVariants.id });
  return { productId: p.id, variantId: v.id };
}

async function order(status: string, deliveredAt: Date | null) {
  const [o] = await db.insert(orders).values({
    ownerId: sellerId, buyerId, orderNumber: `BT-CLOSET-${suffix}-${ids.orders.length}`,
    status, totalCents: 4_000, subtotalCents: 4_000, deliveredAt,
  }).returning({ id: orders.id });
  ids.orders.push(o.id);
  return o.id;
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: buyerId, email: `${buyerId}@test.local`, name: "Closet Buyer", role: "buyer", accountType: "buyer" },
    { clerkId: otherBuyerId, email: `${otherBuyerId}@test.local`, name: "Other Buyer", role: "buyer", accountType: "buyer" },
    { clerkId: sellerId, email: `${sellerId}@test.local`, name: "Seller", displayName: "Seller", brandName: "Quiet Label", role: "seller", accountType: "seller" },
  ]);
  const delivered = await product("tee", "M");
  const refunded = await product("cap", "OS");
  const inTransit = await product("jacket", "L");
  ids.productDelivered = delivered.productId;
  ids.productRefunded = refunded.productId;
  ids.productInTransit = inTransit.productId;

  const deliveredOrder = await order("delivered", new Date("2026-09-02T10:00:00Z"));
  const [a, b] = await db.insert(orderItems).values([
    { orderId: deliveredOrder, variantId: delivered.variantId, productName: "Tee", variantLabel: "M / Black", quantity: 1, priceCents: 4_000 },
    { orderId: deliveredOrder, variantId: refunded.variantId, productName: "Cap", quantity: 1, priceCents: 2_000, refundedAt: new Date() },
  ]).returning({ id: orderItems.id });
  ids.itemDelivered = a.id;
  ids.itemRefunded = b.id;

  const shippedOrder = await order("shipped", null);
  const [c] = await db.insert(orderItems).values(
    { orderId: shippedOrder, variantId: inTransit.variantId, productName: "Jacket", quantity: 1, priceCents: 9_000 },
  ).returning({ id: orderItems.id });
  ids.itemInTransit = c.id;

  const cancelledOrder = await order("cancelled", new Date("2026-09-03T10:00:00Z"));
  const [d] = await db.insert(orderItems).values(
    { orderId: cancelledOrder, variantId: inTransit.variantId, productName: "Jacket", quantity: 1, priceCents: 9_000 },
  ).returning({ id: orderItems.id });
  ids.itemCancelled = d.id;

  const { default: closetRouter } = await import("../closet");
  const { default: postsRouter } = await import("../posts");
  const app = express();
  app.use(express.json());
  app.use("/api/buyer/closet", closetRouter);
  app.use("/api/posts", postsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (ids.posts.length) await db.delete(posts).where(inArray(posts.id, ids.posts));
  await db.delete(closetOutfits).where(inArray(closetOutfits.buyerId, [buyerId, otherBuyerId]));
  await db.delete(orders).where(inArray(orders.id, ids.orders));
  await db.delete(products).where(eq(products.ownerId, sellerId));
  await db.delete(users).where(inArray(users.clerkId, [buyerId, otherBuyerId, sellerId]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("closet pieces", () => {
  it("lists only delivered, non-refunded items from live orders, with brand, size and photo", async () => {
    authState.clerkUserId = buyerId;
    const res = await request("/api/buyer/closet/pieces");
    expect(res.status).toBe(200);
    expect(res.body.pieces).toEqual([
      expect.objectContaining({
        id: ids.itemDelivered,
        productId: ids.productDelivered,
        name: "Tee",
        brand: "Quiet Label",
        size: "M",
        imageUrl: "https://cdn.test/tee.jpg",
        deliveredAt: "2026-09-02T10:00:00.000Z",
      }),
    ]);
  });

  it("is empty for someone else", async () => {
    authState.clerkUserId = otherBuyerId;
    const res = await request("/api/buyer/closet/pieces");
    expect(res.body.pieces).toEqual([]);
  });
});

describe("closet outfits", () => {
  it("saves an outfit from closet pieces and lists it", async () => {
    authState.clerkUserId = buyerId;
    const created = await request("/api/buyer/closet/outfits", { method: "POST", body: JSON.stringify({ pieceIds: [ids.itemDelivered] }) });
    expect(created.status).toBe(201);
    expect(created.body.outfit.pieces.map((p: any) => p.id)).toEqual([ids.itemDelivered]);
    const list = await request("/api/buyer/closet/outfits");
    expect(list.body.outfits.map((o: any) => o.id)).toEqual([created.body.outfit.id]);
  });

  it("refuses pieces that are not in the closet (in transit, refunded, cancelled, someone else's)", async () => {
    authState.clerkUserId = buyerId;
    for (const pieceId of [ids.itemInTransit, ids.itemRefunded, ids.itemCancelled]) {
      const res = await request("/api/buyer/closet/outfits", { method: "POST", body: JSON.stringify({ pieceIds: [ids.itemDelivered, pieceId] }) });
      expect(res.status).toBe(400);
    }
    authState.clerkUserId = otherBuyerId;
    const stolen = await request("/api/buyer/closet/outfits", { method: "POST", body: JSON.stringify({ pieceIds: [ids.itemDelivered] }) });
    expect(stolen.status).toBe(400);
  });

  it("only the owner can delete an outfit", async () => {
    authState.clerkUserId = buyerId;
    const created = await request("/api/buyer/closet/outfits", { method: "POST", body: JSON.stringify({ pieceIds: [ids.itemDelivered] }) });
    authState.clerkUserId = otherBuyerId;
    expect((await request(`/api/buyer/closet/outfits/${created.body.outfit.id}`, { method: "DELETE" })).status).toBe(404);
    authState.clerkUserId = buyerId;
    expect((await request(`/api/buyer/closet/outfits/${created.body.outfit.id}`, { method: "DELETE" })).status).toBe(200);
  });
});

describe("posting a fit with closet pieces tagged", () => {
  it("lets a buyer tag a piece from their closet", async () => {
    authState.clerkUserId = buyerId;
    const res = await request("/api/posts", {
      method: "POST",
      body: JSON.stringify({ mediaType: "photo", mediaUrls: ["https://cdn.test/fit.jpg"], taggedProductIds: [ids.productDelivered] }),
    });
    expect(res.status).toBe(201);
    ids.posts.push(res.body.id);
  });

  it("still refuses products the buyer has not received", async () => {
    authState.clerkUserId = buyerId;
    for (const productId of [ids.productInTransit, ids.productRefunded]) {
      const res = await request("/api/posts", {
        method: "POST",
        body: JSON.stringify({ mediaType: "photo", mediaUrls: ["https://cdn.test/fit.jpg"], taggedProductIds: [productId] }),
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("BUYER_NO_PRODUCT_TAGS");
    }
  });
});
