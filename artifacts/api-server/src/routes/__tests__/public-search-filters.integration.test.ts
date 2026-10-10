import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, products, productVariants, users } from "@workspace/db";
import { inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const sellerA = `sf-seller-a-${suffix}`;
const sellerB = `sf-seller-b-${suffix}`;
const word = `Zorblax${suffix}`;
const productIds: string[] = [];
let server: Server;
let base = "";

async function addProduct(
  ownerId: string, name: string, category: string,
  variants: Array<{ size: string; color: string; priceCents: number; stock: number }>,
) {
  const [p] = await db.insert(products).values({ ownerId, name, category, status: "active" }).returning();
  productIds.push(p.id);
  for (const [i, v] of variants.entries()) {
    await db.insert(productVariants).values({ productId: p.id, sku: `${suffix}-${productIds.length}-${i}`, ...v });
  }
  return p;
}

const names = async (qs: string) => {
  const body = await fetch(`${base}/api/public/search?q=${word}&${qs}`).then((r) => r.json() as Promise<any>);
  return body.results.filter((r: any) => r.kind === "product").map((r: any) => r.name).sort();
};

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: sellerA, email: `${sellerA}@test.local`, name: "SF A", displayName: "SF A", brandName: `Brand A ${suffix}`, role: "seller", accountType: "seller" },
    { clerkId: sellerB, email: `${sellerB}@test.local`, name: "SF B", displayName: "SF B", brandName: `Brand B ${suffix}`, role: "seller", accountType: "seller" },
  ]);
  await addProduct(sellerA, `${word} Jacket`, "apparel", [
    { size: "M", color: "Black", priceCents: 5000, stock: 4 },
    { size: "L", color: "Black", priceCents: 5000, stock: 0 },
  ]);
  await addProduct(sellerA, `${word} Sneaker`, "shoes", [{ size: "42", color: "White", priceCents: 12000, stock: 2 }]);
  await addProduct(sellerB, `${word} Tee`, "apparel", [{ size: "M", color: "White", priceCents: 2000, stock: 0 }]);

  const { default: publicRouter } = await import("../public");
  const app = express();
  app.use("/api/public", publicRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(products).where(inArray(products.id, productIds));
  await db.delete(users).where(inArray(users.clerkId, [sellerA, sellerB]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("public search filters", () => {
  it("returns every match without filters", async () => {
    expect(await names("")).toHaveLength(3);
  });
  it("filters by colour and multi-value size (OR within a facet)", async () => {
    expect(await names("color=White")).toEqual([`${word} Sneaker`, `${word} Tee`]);
    expect(await names("size=L&size=42")).toEqual([`${word} Jacket`, `${word} Sneaker`]);
  });
  it("combines size and colour on the same variant", async () => {
    expect(await names("size=M&color=White")).toEqual([`${word} Tee`]);
    expect(await names("size=42&color=Black")).toEqual([]);
  });
  it("in-stock hides products with no stocked variant, and respects the variant match", async () => {
    expect(await names("inStock=1")).toEqual([`${word} Jacket`, `${word} Sneaker`]);
    expect(await names("inStock=1&size=L")).toEqual([]);
  });
  it("filters by multiple categories and by brand", async () => {
    expect(await names("category=shoes&category=apparel")).toHaveLength(3);
    expect(await names(`brand=${sellerB}`)).toEqual([`${word} Tee`]);
  });
  it("rejects a malformed in-stock flag", async () => {
    const r = await fetch(`${base}/api/public/search?q=${word}&inStock=maybe`);
    expect(r.status).toBe(400);
  });
  it("returns facets only when asked, ignoring active filters", async () => {
    const plain = await fetch(`${base}/api/public/search?q=${word}`).then((r) => r.json() as Promise<any>);
    expect(plain.facets).toBeUndefined();
    const body = await fetch(`${base}/api/public/search?q=${word}&facets=1&color=Black`).then((r) => r.json() as Promise<any>);
    expect(body.facets.colors.map((c: any) => c.value).sort()).toEqual(["Black", "White"]);
    expect(body.facets.sizes.map((s: any) => s.value)).toEqual(["M", "L", "42"]);
    expect(body.facets.price).toEqual({ minCents: 2000, maxCents: 12000 });
    expect(body.facets.brands).toHaveLength(2);
  });
});
