/**
 * Wave-1 audit (slice s10) — routes/public.ts:
 *  - product routes with a non-uuid id answer 404 / [] instead of a 500;
 *  - the related and high-demand shelves never expose variant SKUs or
 *    restock thresholds (same public variant shape as the product page);
 *  - the related shelf still ranks same-seller / same-category first;
 *  - a repeated ?username= / ?email= query is a validation answer, not a 500.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, products, productVariants, users } from "@workspace/db";
import { inArray } from "drizzle-orm";

vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: null }) }));

const suffix = crypto.randomBytes(6).toString("hex");
const seller = `w1s10-pub-${suffix}`;
const other = `w1s10-pub2-${suffix}`;
const productIds: string[] = [];
let current = "";
let sameSeller = "";
let otherSeller = "";
let hot = "";
let server: Server;
let base = "";

async function addProduct(ownerId: string, name: string, category: string, demandCount = 0) {
  const [p] = await db.insert(products).values({
    ownerId, name: `${name} ${suffix}`, category, status: "active", demandCount, tags: [], styleTags: [],
  }).returning();
  productIds.push(p.id);
  await db.insert(productVariants).values({
    productId: p.id, sku: `W1S10-${name}-${suffix}`, priceCents: 3_000, stock: 4, lowStockThreshold: 7,
  });
  return p.id;
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: seller, email: `${seller}@test.local`, name: "Pub Seller", displayName: "Pub Seller", role: "seller", accountType: "seller" },
    { clerkId: other, email: `${other}@test.local`, name: "Pub Other", displayName: "Pub Other", role: "seller", accountType: "seller" },
  ]);
  current = await addProduct(seller, "Current", `w1s10cat-${suffix}`);
  sameSeller = await addProduct(seller, "Sibling", "w1s10-elsewhere");
  otherSeller = await addProduct(other, "Stranger", `w1s10cat-${suffix}`);
  hot = await addProduct(other, "Hot", "w1s10-hot", 75);

  const { default: publicRouter } = await import("../public");
  const app = express();
  app.use((req, _res, next) => { (req as any).log = { error: () => undefined, warn: () => undefined, info: () => undefined }; next(); });
  app.use(express.json());
  app.use("/api/public", publicRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(productVariants).where(inArray(productVariants.productId, productIds));
  await db.delete(products).where(inArray(products.id, productIds));
  await db.delete(users).where(inArray(users.clerkId, [seller, other]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const get = (path: string) => fetch(`${base}/api/public${path}`);

describe("malformed product ids", () => {
  it.each(["/products/demo", "/products/demo/related", "/products/demo/price-history"])("GET %s is a 404", async (path) => {
    const res = await get(path);
    expect(res.status).toBe(404);
  });

  it("GET /products/demo/videos is an empty list", async () => {
    const res = await get("/products/demo/videos");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe("public variant shape on product shelves", () => {
  it("related products omit SKU and restock threshold, and rank the same seller first", async () => {
    const res = await get(`/products/${current}/related?limit=24`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as any[];
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(sameSeller);
    expect(ids).toContain(otherSeller);
    expect(ids.indexOf(sameSeller)).toBeLessThan(ids.indexOf(otherSeller));
    for (const row of rows.filter((r) => productIds.includes(r.id))) {
      expect(row.variants.length).toBeGreaterThan(0);
      for (const v of row.variants) {
        expect(v).not.toHaveProperty("sku");
        expect(v).not.toHaveProperty("lowStockThreshold");
        expect(v.priceCents).toBe(3_000);
        expect(v.stock).toBe(4);
      }
    }
  });

  it("high-demand products omit SKU and restock threshold", async () => {
    const res = await get("/products/high-demand?limit=24");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as any[];
    const row = rows.find((r) => r.id === hot);
    expect(row).toBeDefined();
    expect(row.variants[0]).not.toHaveProperty("sku");
    expect(row.variants[0]).not.toHaveProperty("lowStockThreshold");
    expect(row.remainingUnits).toBe(4);
    // Products without reservation demand never qualify.
    expect(rows.some((r) => r.id === current)).toBe(false);
  });
});

describe("availability checks with a repeated query key", () => {
  it("username-check answers instead of crashing", async () => {
    const res = await get("/username-check?username=abc&username=def");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { available: boolean }).available).toBe(false);
  });

  it("email-check answers instead of crashing", async () => {
    const res = await get("/email-check?email=a@b.co&email=c@d.co");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { available: boolean }).available).toBe(false);
  });
});
