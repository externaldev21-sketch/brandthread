/**
 * Sell an item → live listing, end to end against Postgres: the exact body the
 * mobile form posts (lib/listing/listingPersistence.createPayload) creates an
 * active product with one variant per size and its listing details, and that
 * product then shows on the seller's public store and in buyer search.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, products, productVariants, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));
vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../lib/planAccess", async (orig) => ({
  ...(await orig<typeof import("../../lib/planAccess")>()),
  getVerifiedPlanAccess: async () => ({ planId: "growth", limits: { products: null, teamSeats: 0 } }),
}));
vi.mock("../../lib/activityEvents", () => ({ notifyNewProduct: async () => undefined }));
vi.mock("../../lib/activityLog", () => ({
  logActivity: async () => undefined,
  reqActor: (req: any) => ({ ownerClerkId: req.clerkUserId, actorClerkId: req.clerkUserId, actorRole: "owner" }),
}));

const suffix = crypto.randomBytes(6).toString("hex");
const seller = `listing-seller-${suffix}`;
// A word unique to this run so search hits only this listing.
const word = `zq${suffix}`;
const created: string[] = [];
let server: Server;
let base = "";

async function call(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "x-test-user": seller, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

const listingBody = () => ({
  name: `Heavyweight ${word} tee`,
  description: "Worn twice",
  category: "T-shirts",
  status: "active",
  images: ["/objects/uploads/a", "/objects/uploads/b"],
  tags: ["Studio Nine", "Men", "Tops"],
  variants: [
    { size: "M", color: "Black", sku: `TEE-${suffix}-M`, priceCents: 4800, stock: 1 },
    { size: "L", color: "Black", sku: `TEE-${suffix}-L`, priceCents: 4800, stock: 2 },
  ],
  listingDetails: {
    department: "Men", category: "Tops", subcategory: "T-shirts", brand: "Studio Nine",
    condition: "very_good", colors: ["Black"], material: "Cotton", parcelSize: "small", shippingPayer: "buyer",
  },
});

beforeAll(async () => {
  await db.insert(users).values({
    clerkId: seller, email: `${seller}@test.local`, name: "Studio Nine", displayName: "Studio Nine",
    brandName: "Studio Nine", role: "seller", accountType: "seller",
  });
  const { default: productsRouter } = await import("../products");
  const { default: publicRouter } = await import("../public");
  const app = express();
  app.use((req, _res, next) => { (req as any).log = { error: () => undefined, warn: () => undefined, info: () => undefined }; next(); });
  app.use(express.json());
  app.use("/api/products", productsRouter);
  app.use("/api/public", publicRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (created.length) {
    await db.delete(productVariants).where(inArray(productVariants.productId, created));
    await db.delete(products).where(inArray(products.id, created));
  }
  await db.delete(users).where(eq(users.clerkId, seller));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Sell an item → live listing", () => {
  let id = "";

  it("creates an active product with listing details and one variant per size", async () => {
    const res = await call("/api/products", "POST", listingBody());
    expect(res.status).toBe(201);
    id = res.body.id;
    created.push(id);
    expect(res.body.listingDetails).toMatchObject({ brand: "Studio Nine", condition: "very_good", parcelSize: "small" });
    const variants = await db.select().from(productVariants).where(eq(productVariants.productId, id));
    expect(variants.map((v) => [v.size, v.stock]).sort()).toEqual([["L", 2], ["M", 1]]);
  });

  it("shows on the seller's public store with its details", async () => {
    const res = await call(`/api/public/products?ownerId=${encodeURIComponent(seller)}`);
    expect(res.status).toBe(200);
    const row = (res.body as any[]).find((p) => p.id === id);
    expect(row).toBeTruthy();
  });

  it("is found by buyers in search", async () => {
    const res = await call(`/api/public/search?q=${word}`);
    expect(res.status).toBe(200);
    const results = res.body.results ?? res.body;
    const found = JSON.stringify(results).includes(id);
    expect(found).toBe(true);
  });

  it("rejects a malformed condition instead of storing it", async () => {
    const res = await call("/api/products", "POST", { ...listingBody(), listingDetails: { condition: "mint" } });
    expect(res.status).toBe(400);
  });

  it("edits details and clears them with null", async () => {
    const edit = await call(`/api/products/${id}`, "PUT", { listingDetails: { ...listingBody().listingDetails, condition: "good" } });
    expect(edit.status).toBe(200);
    const got = await call(`/api/products/${id}`);
    expect(got.body.listingDetails.condition).toBe("good");
    await call(`/api/products/${id}`, "PUT", { listingDetails: null });
    const [row] = await db.select({ d: products.listingDetails }).from(products).where(eq(products.id, id));
    expect(row.d).toBeNull();
  });
});
