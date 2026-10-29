/**
 * Wave-1 audit (slice s10) — routes/products.ts:
 *  - a non-uuid product / variant id is a 404, not a Postgres uuid error (500);
 *  - PATCH variant: the strike-through price must exceed the selling price;
 *  - CSV import: an out-of-range price fails that row, not the whole import;
 *  - the image upload error names the real 20 MB limit.
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
const seller = `w1s10-prod-${suffix}`;
let server: Server;
let base = "";
let productId = "";
let variantId = "";

async function call(path: string, method = "GET", body?: unknown, contentType = "application/json") {
  const res = await fetch(`${base}/api/products${path}`, {
    method,
    headers: { "x-test-user": seller, ...(body === undefined ? {} : { "content-type": contentType }) },
    body: body === undefined ? undefined : (Buffer.isBuffer(body) ? body : JSON.stringify(body)),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

beforeAll(async () => {
  await db.insert(users).values({ clerkId: seller, email: `${seller}@test.local`, name: "S10 Seller", accountType: "seller" });
  const [p] = await db.insert(products).values({ ownerId: seller, name: `S10 Tee ${suffix}`, status: "draft" }).returning();
  productId = p.id;
  const [v] = await db.insert(productVariants).values({ productId, sku: `S10-${suffix}`, priceCents: 5_000, stock: 2 }).returning();
  variantId = v.id;
  const { default: router } = await import("../products");
  const app = express();
  app.use((req, _res, next) => { (req as any).log = { error: () => undefined, warn: () => undefined, info: () => undefined }; next(); });
  app.use(express.json());
  app.use("/api/products", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const owned = await db.select({ id: products.id }).from(products).where(eq(products.ownerId, seller));
  if (owned.length) await db.delete(productVariants).where(inArray(productVariants.productId, owned.map((r) => r.id)));
  await db.delete(products).where(eq(products.ownerId, seller));
  await db.delete(users).where(eq(users.clerkId, seller));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("malformed ids", () => {
  it.each([
    ["GET", "/not-a-uuid"],
    ["PUT", "/not-a-uuid"],
    ["DELETE", "/not-a-uuid"],
    ["POST", "/not-a-uuid/restore"],
    ["POST", "/not-a-uuid/variants"],
  ])("%s %s is a 404", async (method, path) => {
    const res = await call(path, method, method === "GET" || method === "DELETE" ? undefined : { name: "x" });
    expect(res.status).toBe(404);
  });

  it("a malformed variant id is a 404", async () => {
    const res = await call(`/${productId}/variants/nope`, "PATCH", { stock: 1 });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /:id/variants/:variantId compare-at price", () => {
  it("refuses a compare-at price at or below the current price", async () => {
    const res = await call(`/${productId}/variants/${variantId}`, "PATCH", { compareAtPriceCents: 4_000 });
    expect(res.status).toBe(400);
    const [row] = await db.select({ c: productVariants.compareAtPriceCents }).from(productVariants).where(eq(productVariants.id, variantId));
    expect(row.c).toBeNull();
  });

  it("checks against the new price when the price changes in the same request", async () => {
    const res = await call(`/${productId}/variants/${variantId}`, "PATCH", { priceCents: 9_000, compareAtPriceCents: 8_000 });
    expect(res.status).toBe(400);
  });

  it("accepts a compare-at price above the price, and null clears it", async () => {
    const ok = await call(`/${productId}/variants/${variantId}`, "PATCH", { compareAtPriceCents: 7_000 });
    expect(ok.status).toBe(200);
    expect(ok.body.compareAtPriceCents).toBe(7_000);
    const cleared = await call(`/${productId}/variants/${variantId}`, "PATCH", { compareAtPriceCents: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.compareAtPriceCents).toBeNull();
  });
});

describe("POST /import price bounds", () => {
  it("fails only the row whose price overflows, not the whole import", async () => {
    const res = await call("/import", "POST", {
      rows: [
        { name: `S10 Huge ${suffix}`, price: "99999999999" },
        { name: `S10 Fine ${suffix}`, price: "12.50", sku: `S10-IMP-${suffix}` },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.successCount).toBe(1);
    expect(res.body.failCount).toBe(1);
    expect(res.body.results.find((r: any) => !r.success).error).toBe("invalid price");
  });
});

describe("POST /images", () => {
  it("names the real 20 MB limit for an empty upload", async () => {
    const res = await call("/images", "POST", Buffer.alloc(0), "image/png");
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain("20 MB");
  });
});
