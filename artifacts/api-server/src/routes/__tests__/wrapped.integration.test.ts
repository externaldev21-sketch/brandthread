import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orderItems, orders, postTaggedProducts, posts, productVariants, products, users } from "@workspace/db";
import { eq, inArray, like } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const me = `wrapped-me-${suffix}`;
const brandA = `wrapped-a-${suffix}`;
const brandB = `wrapped-b-${suffix}`;
const others = Array.from({ length: 24 }, (_, i) => `wrapped-other-${i}-${suffix}`);
const auth = vi.hoisted(() => ({ user: "" }));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => { req.clerkUserId = auth.user; next(); },
}));

let server: Server;
let base = "";
const SEPT = new Date("2026-09-12T12:00:00Z");
const variants: Record<string, { productId: string; variantId: string }> = {};

async function product(owner: string, key: string) {
  const [p] = await db.insert(products).values({ ownerId: owner, name: `Piece ${key}`, status: "active", images: [`https://cdn.test/${key}.jpg`] }).returning({ id: products.id });
  const [v] = await db.insert(productVariants).values({ productId: p.id, size: "M", sku: `wrapped-${suffix}-${key}`, priceCents: 4_000 }).returning({ id: productVariants.id });
  variants[key] = { productId: p.id, variantId: v.id };
}

async function order(buyerId: string, owner: string, key: string, quantity: number, totalCents: number, paidAt = SEPT, status = "delivered") {
  const [o] = await db.insert(orders).values({
    ownerId: owner, buyerId, orderNumber: `BT-WR-${suffix}-${crypto.randomBytes(3).toString("hex")}`, status,
    totalCents, subtotalCents: totalCents, paidAt,
  }).returning({ id: orders.id });
  await db.insert(orderItems).values({ orderId: o.id, variantId: variants[key].variantId, productName: `Piece ${key}`, quantity, priceCents: Math.round(totalCents / quantity) });
}

async function call(path: string) {
  const response = await fetch(`${base}${path}`);
  return { status: response.status, body: await response.json() as any };
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: me, email: `${me}@test.local`, name: "Me", role: "buyer", accountType: "buyer" },
    { clerkId: brandA, email: `${brandA}@test.local`, name: "A", brandName: "Northline", role: "seller", accountType: "seller" },
    { clerkId: brandB, email: `${brandB}@test.local`, name: "B", brandName: "Field Office", role: "seller", accountType: "seller" },
  ]);
  await product(brandA, "a1");
  await product(brandA, "a2");
  await product(brandB, "b1");
  // September: 3 Northline pieces, 1 Field Office piece; a cancelled order and an August order never count.
  await order(me, brandA, "a1", 2, 20_000);
  await order(me, brandA, "a2", 1, 9_000);
  await order(me, brandB, "b1", 1, 4_000);
  await order(me, brandB, "b1", 5, 20_000, SEPT, "cancelled");
  await order(me, brandA, "a1", 4, 16_000, new Date("2026-08-20T12:00:00Z"));
  // 24 other Northline buyers who each spent less than me → I'm #1 of 25 → top 4%.
  for (const other of others) await order(other, brandA, "a1", 1, 1_000);
  // Two September fits tagging a2, one tagging a1.
  const mkPost = async (productId: string) => {
    const [p] = await db.insert(posts).values({ userId: me, ownerId: me, mediaType: "photo", mediaUrl: "https://cdn.test/fit.jpg", surface: "profile", createdAt: SEPT } as any).returning({ id: posts.id });
    await db.insert(postTaggedProducts).values({ postId: p.id, productId, position: 0 });
  };
  await mkPost(variants.a2.productId);
  await mkPost(variants.a2.productId);
  await mkPost(variants.a1.productId);

  const { default: wrappedRouter } = await import("../wrapped");
  const app = express();
  app.use("/api/buyer/wrapped", wrappedRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(posts).where(eq(posts.userId, me));
  await db.delete(orders).where(like(orders.orderNumber, `BT-WR-${suffix}-%`));
  await db.delete(products).where(inArray(products.ownerId, [brandA, brandB]));
  await db.delete(users).where(inArray(users.clerkId, [me, brandA, brandB]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/buyer/wrapped", () => {
  it("recaps September from real orders and posts", async () => {
    auth.user = me;
    const res = await call("/api/buyer/wrapped?month=2026-09");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      month: "2026-09", available: true, totalPieces: 4, brandCount: 2,
      mostPosted: expect.objectContaining({ productId: variants.a2.productId, posts: 2, brand: "Northline" }),
      supporter: { brand: "Northline", topPercent: 4 },
      coverImageUrl: "https://cdn.test/a1.jpg",
    }));
    expect(res.body.topBrands.map((b: any) => [b.name, b.pieces])).toEqual([["Northline", 3], ["Field Office", 1]]);
  });

  it("has no supporter line when the buyer isn't near the top", async () => {
    auth.user = others[0];
    const res = await call("/api/buyer/wrapped?month=2026-09");
    expect(res.body.available).toBe(true);
    expect(res.body.supporter).toBeNull();
    expect(res.body.mostPosted).toBeNull();
  });

  it("is unavailable for a month with no pieces, and refuses future months", async () => {
    auth.user = me;
    expect((await call("/api/buyer/wrapped?month=2026-07")).body.available).toBe(false);
    expect((await call("/api/buyer/wrapped?month=2099-01")).status).toBe(400);
    expect((await call("/api/buyer/wrapped?month=nope")).status).toBe(400);
  });
});
