import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, products, productVariants, users } from "@workspace/db";
import { inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const sellerA = `catalog-seller-a-${suffix}`;
const sellerB = `catalog-seller-b-${suffix}`;
const productIds: string[] = [];
let currentProductId = "";
let server: Server;
let base = "";

async function addProduct(ownerId: string, name: string, category: string, priceCents: number) {
  const [product] = await db.insert(products).values({
    ownerId,
    name,
    category,
    status: "active",
    tags: ["catalog-test"],
    styleTags: ["minimal"],
  }).returning();
  productIds.push(product.id);
  await db.insert(productVariants).values({
    productId: product.id,
    sku: `${suffix}-${productIds.length}`,
    priceCents,
    stock: 10,
  });
  return product;
}

beforeAll(async () => {
  await db.insert(users).values([
    {
      clerkId: sellerA,
      email: `${sellerA}@test.local`,
      name: "Catalog Seller A",
      displayName: "Seller A",
      role: "seller",
      accountType: "seller",
    },
    {
      clerkId: sellerB,
      email: `${sellerB}@test.local`,
      name: "Catalog Seller B",
      displayName: "Seller B",
      role: "seller",
      accountType: "seller",
    },
  ]);
  const current = await addProduct(sellerA, "Catalog Jacket", "apparel", 2_500);
  currentProductId = current.id;
  await addProduct(sellerB, "Catalog Tee", "apparel", 1_000);
  await addProduct(sellerA, "Catalog Bag", "accessories", 3_000);

  const { default: publicRouter } = await import("../public");
  const app = express();
  app.use(express.json());
  app.use("/api/public", publicRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(products).where(inArray(products.id, productIds));
  await db.delete(users).where(inArray(users.clerkId, [sellerA, sellerB]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("public catalog search and related products", () => {
  it("filters before limiting and sorts product prices deterministically", async () => {
    const filtered = await fetch(
      `${base}/api/public/search?q=Catalog&sort=price_desc&minPriceCents=1500&category=apparel`,
    ).then((response) => response.json() as Promise<any>);
    const filteredProducts = filtered.results.filter((result: any) => result.kind === "product");
    expect(filteredProducts.map((product: any) => product.name)).toEqual(["Catalog Jacket"]);
    expect(filteredProducts[0].priceCents).toBe(2_500);

    const sorted = await fetch(
      `${base}/api/public/search?q=Catalog&sort=price_asc`,
    ).then((response) => response.json() as Promise<any>);
    expect(sorted.results.filter((result: any) => result.kind === "product")
      .map((product: any) => product.priceCents)).toEqual([1_000, 2_500, 3_000]);
  });

  it("excludes the current product and prioritizes the same seller", async () => {
    const response = await fetch(
      `${base}/api/public/products/${currentProductId}/related?limit=5`,
    );
    expect(response.status).toBe(200);
    const related = await response.json() as any[];
    expect(related.some((product) => product.id === currentProductId)).toBe(false);
    expect(related[0].name).toBe("Catalog Bag");
    expect(related.every((product) => Array.isArray(product.variants))).toBe(true);
  });

  it("rejects invalid price ranges", async () => {
    const response = await fetch(
      `${base}/api/public/search?q=Catalog&minPriceCents=3000&maxPriceCents=1000`,
    );
    expect(response.status).toBe(400);
  });
});