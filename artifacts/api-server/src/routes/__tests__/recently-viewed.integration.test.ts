import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, recentlyViewedProducts, products, productVariants, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const buyer = `rv-buyer-${suffix}`;
const seller = `rv-seller-${suffix}`;
const productIds: string[] = [];
let server: Server;
let base = "";
const authState = vi.hoisted(() => ({ clerkUserId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!authState.clerkUserId) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = authState.clerkUserId;
    next();
  },
}));

async function addProduct(name: string, priceCents: number) {
  const [product] = await db.insert(products).values({
    ownerId: seller, name, category: "apparel", status: "active",
    images: [`https://example.test/${name}.jpg`],
  }).returning();
  productIds.push(product.id);
  await db.insert(productVariants).values({
    productId: product.id, sku: `${suffix}-${productIds.length}`, priceCents, stock: 10,
  });
  return product;
}

function request(path: string, opts: { method?: string; user?: string; body?: unknown } = {}) {
  authState.clerkUserId = opts.user ?? buyer;
  return fetch(`${base}${path}`, {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: buyer, email: `${buyer}@test.local`, name: "RV Buyer", displayName: "RV Buyer", role: "buyer", accountType: "buyer" },
    { clerkId: seller, email: `${seller}@test.local`, name: "RV Seller", displayName: "RV Brand", brandName: "RV Brand", role: "seller", accountType: "seller" },
  ]);
  await addProduct("Alpha", 1_000);
  await addProduct("Beta", 2_000);

  const { default: router } = await import("../recently-viewed");
  const app = express();
  app.use(express.json());
  app.use(router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => { authState.clerkUserId = ""; });

afterAll(async () => {
  await db.delete(recentlyViewedProducts).where(eq(recentlyViewedProducts.userId, buyer));
  await db.delete(productVariants).where(inArray(productVariants.productId, productIds));
  await db.delete(products).where(inArray(products.id, productIds));
  await db.delete(users).where(inArray(users.clerkId, [buyer, seller]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("buyer recently-viewed products", () => {
  it("records a view and lists it newest first", async () => {
    const record = await request("/", { method: "POST", body: { productId: productIds[0] } });
    expect(record.status).toBe(204);

    const list = await request("/").then((r) => r.json() as Promise<any[]>);
    expect(list).toHaveLength(1);
    expect(list[0].productId).toBe(productIds[0]);
    expect(list[0].name).toBe("Alpha");
    expect(list[0].priceCents).toBe(1_000);
    expect(list[0].brand).toBe("RV Brand");
  });

  it("re-viewing the same product updates recency instead of duplicating", async () => {
    await request("/", { method: "POST", body: { productId: productIds[1] } });
    await request("/", { method: "POST", body: { productId: productIds[0] } }); // bump Alpha to newest again

    const list = await request("/").then((r) => r.json() as Promise<any[]>);
    expect(list).toHaveLength(2);
    expect(list[0].productId).toBe(productIds[0]); // most recently viewed first
  });

  it("404s for a non-existent product", async () => {
    const response = await request("/", { method: "POST", body: { productId: crypto.randomUUID() } });
    expect(response.status).toBe(404);
  });

  it("requires auth", async () => {
    const response = await fetch(`${base}/`);
    expect(response.status).toBe(401);
  });
});
