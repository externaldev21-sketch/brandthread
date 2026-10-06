import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, products, productVariants, users, follows, savedItems, storeVisits } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const sellerA = `disc-seller-a-${suffix}`;
const sellerB = `disc-seller-b-${suffix}`;
const fan1 = `disc-fan-1-${suffix}`;
const fan2 = `disc-fan-2-${suffix}`;

let server: Server;
let base = "";
let hoodieId = "";
let jeansId = "";
let quietId = "";

beforeAll(async () => {
  const { default: discoveryRouter } = await import("../discovery");
  const app = express();
  app.use(express.json());
  app.use("/api/public", discoveryRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await db.insert(users).values([
    { clerkId: sellerA, email: `${sellerA}@example.test`, name: "Disc A", displayName: "Disc Seller A", brandName: "Disc Brand A", accountType: "seller" },
    { clerkId: sellerB, email: `${sellerB}@example.test`, name: "Disc B", displayName: "Disc Seller B", brandName: "Disc Brand B", accountType: "seller" },
  ] as any);
  const inserted = await db.insert(products).values([
    { ownerId: sellerA, name: `Disc Heavy Hoodie ${suffix}`, category: "hoodies", status: "active", images: ["h.jpg"] },
    { ownerId: sellerA, name: `Disc Raw Jeans ${suffix}`, category: "apparel", status: "active", images: ["j.jpg"] },
    { ownerId: sellerB, name: `Disc Quiet Logo ${suffix}`, category: "apparel", status: "active", images: [] },
    { ownerId: sellerB, name: `Disc Draft Hoodie ${suffix}`, category: "hoodies", status: "draft", images: [] },
  ]).returning({ id: products.id, name: products.name });
  hoodieId = inserted[0].id;
  jeansId = inserted[1].id;
  quietId = inserted[2].id;
  await db.insert(productVariants).values([
    { productId: hoodieId, sku: `disc-h-${suffix}`, priceCents: 9000, stock: 5 },
    { productId: jeansId, sku: `disc-j-${suffix}`, priceCents: 12000, stock: 5 },
  ]);
  // Signals: hoodie saved twice + viewed, jeans viewed once, quiet product none.
  await db.insert(savedItems).values([
    { userId: fan1, itemType: "product", targetId: hoodieId, title: "Hoodie" },
    { userId: fan2, itemType: "product", targetId: hoodieId, title: "Hoodie" },
  ]);
  await db.insert(storeVisits).values([
    { sellerId: sellerA, productId: hoodieId, source: "feed", viewerUserId: fan1 },
    { sellerId: sellerA, productId: jeansId, source: "feed", viewerUserId: fan1 },
  ]);
  await db.insert(follows).values([{ followerId: fan1, followingId: sellerA }, { followerId: fan2, followingId: sellerA }]);
});

afterAll(async () => {
  const ids = [hoodieId, jeansId, quietId].filter(Boolean);
  await db.delete(savedItems).where(inArray(savedItems.userId, [fan1, fan2]));
  await db.delete(storeVisits).where(eq(storeVisits.sellerId, sellerA));
  await db.delete(follows).where(inArray(follows.followerId, [fan1, fan2]));
  if (ids.length) await db.delete(productVariants).where(inArray(productVariants.productId, ids));
  await db.delete(products).where(inArray(products.ownerId, [sellerA, sellerB]));
  await db.delete(users).where(inArray(users.clerkId, [sellerA, sellerB]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/public/categories", () => {
  it("lists taxonomy categories with counts and a cover image", async () => {
    const res = await fetch(`${base}/api/public/categories`);
    expect(res.status).toBe(200);
    const body = await res.json() as { categories: Array<{ slug: string; productCount: number; coverImageUrl: string | null }> };
    const hoodies = body.categories.find((c) => c.slug === "hoodies");
    const denim = body.categories.find((c) => c.slug === "denim");
    expect(hoodies?.productCount).toBeGreaterThanOrEqual(1);
    expect(denim?.productCount).toBeGreaterThanOrEqual(1);
  });
});

describe("GET /api/public/categories/:slug/products", () => {
  it("returns classified products (name fallback) without drafts", async () => {
    const res = await fetch(`${base}/api/public/categories/denim/products?limit=100`);
    expect(res.status).toBe(200);
    const body = await res.json() as { products: Array<{ id: string; variants: unknown[] }> };
    const jeans = body.products.find((p) => p.id === jeansId);
    expect(jeans?.variants).toHaveLength(1);
    const hoodies = await (await fetch(`${base}/api/public/categories/hoodies/products?limit=100`)).json() as { products: Array<{ id: string; name: string }> };
    expect(hoodies.products.some((p) => p.id === hoodieId)).toBe(true);
    expect(hoodies.products.some((p) => p.name.includes("Draft"))).toBe(false);
  });

  it("404s an unknown slug", async () => {
    const res = await fetch(`${base}/api/public/categories/not-a-category/products`);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/public/trending/products", () => {
  it("ranks products with real signals and omits products with none", async () => {
    const res = await fetch(`${base}/api/public/trending/products?limit=50`);
    expect(res.status).toBe(200);
    const body = await res.json() as { products: Array<{ id: string }> };
    const order = body.products.map((p) => p.id);
    expect(order).toContain(hoodieId);
    expect(order).toContain(jeansId);
    expect(order).not.toContain(quietId);
    expect(order.indexOf(hoodieId)).toBeLessThan(order.indexOf(jeansId));
  });
});

describe("GET /api/public/trending/brands", () => {
  it("ranks sellers by recent follows/visits and omits sellers with no signal", async () => {
    const res = await fetch(`${base}/api/public/trending/brands?limit=50`);
    expect(res.status).toBe(200);
    const body = await res.json() as { brands: Array<{ id: string; followerCount: number; name: string }> };
    const a = body.brands.find((b) => b.id === sellerA);
    expect(a?.name).toBe("Disc Brand A");
    expect(a?.followerCount).toBe(2);
    expect(body.brands.some((b) => b.id === sellerB)).toBe(false);
  });
});
