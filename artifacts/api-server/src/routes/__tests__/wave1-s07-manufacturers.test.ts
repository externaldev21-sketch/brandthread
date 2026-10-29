/**
 * Wave 1 / s07 audit regressions for routes/manufacturers.ts:
 *  - PATCH /me/products/:id replaces price tiers inside the product transaction
 *  - out-of-range tier values are a 400, not a DB error
 *  - non-UUID ids answer 404 instead of a Postgres cast 500
 *  - the dashboard's completed value excludes unpaid (cancelled) / refunded
 *    orders and uses the shared terminal-status set
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { db, manufacturers, manufacturerProducts, manufacturerProductPriceTiers, sampleOrders } from "@workspace/db";

const auth = vi.hoisted(() => ({ userId: "" }));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: auth.userId || null }),
  clerkClient: { users: { getUser: async () => null } },
}));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = auth.userId;
    next();
  },
  requirePlan: () => (_req: any, _res: any, next: () => void) => next(),
}));
vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: any, _res: any, next: () => void) => next(),
}));
vi.mock("../../middlewares/featureGate", () => ({
  featureGate: () => (_req: any, _res: any, next: () => void) => next(),
}));
vi.mock("../../routes/notifications-feed", () => ({ publishNotification: async () => undefined }));
vi.mock("../../lib/brandthreadEmail", () => ({ sendManufacturerSignupEmail: async () => undefined }));
vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityDownloadURL(path: string) { return `https://objects.test${path}`; }
  },
}));

const suffix = crypto.randomBytes(6).toString("hex");
const clerkId = `w1-s07-mfr-${suffix}`;
let manufacturerId = "";
let server: Server;
let base = "";

const request = (path: string, method = "GET", body?: unknown) => fetch(`${base}${path}`, {
  method,
  headers: body === undefined ? undefined : { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

beforeAll(async () => {
  // Forces the tier insert to fail for one sentinel price, standing in for any
  // DB error part-way through the tier replacement.
  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION wave1_s07_fail_tier() RETURNS trigger AS $$
    BEGIN
      IF NEW.unit_price_cents = 424242 THEN RAISE EXCEPTION 'forced tier failure'; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS wave1_s07_fail_tier ON manufacturer_product_price_tiers;
    CREATE TRIGGER wave1_s07_fail_tier BEFORE INSERT ON manufacturer_product_price_tiers
      FOR EACH ROW EXECUTE FUNCTION wave1_s07_fail_tier();
  `));
  const [row] = await db.insert(manufacturers).values({
    clerkId, businessName: `w1-s07-factory-${suffix}`, country: "US", specialty: "Cut and sew",
    status: "active", isPublicDirectory: true, verificationStatus: "verified",
  }).returning();
  manufacturerId = row.id;

  const { default: manufacturersRouter } = await import("../manufacturers");
  const app = express();
  app.use((req, _res, next) => { (req as any).log = { error: () => undefined, warn: () => undefined }; next(); });
  app.use(express.json());
  app.use("/api/manufacturers", manufacturersRouter);
  app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: "internal" });
  });
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.execute(sql.raw(`
    DROP TRIGGER IF EXISTS wave1_s07_fail_tier ON manufacturer_product_price_tiers;
    DROP FUNCTION IF EXISTS wave1_s07_fail_tier();
  `));
  if (manufacturerId) {
    const products = await db.select({ id: manufacturerProducts.id }).from(manufacturerProducts)
      .where(eq(manufacturerProducts.manufacturerId, manufacturerId));
    if (products.length) {
      await db.delete(manufacturerProductPriceTiers)
        .where(inArray(manufacturerProductPriceTiers.productId, products.map((p) => p.id)));
    }
    await db.delete(sampleOrders).where(eq(sampleOrders.manufacturerId, manufacturerId));
    await db.delete(manufacturerProducts).where(eq(manufacturerProducts.manufacturerId, manufacturerId));
    await db.delete(manufacturers).where(eq(manufacturers.id, manufacturerId));
  }
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

describe("manufacturer product tiers", () => {
  it("keeps the existing tiers when the replacement insert fails", async () => {
    auth.userId = clerkId;
    const created = await request("/api/manufacturers/me/products", "POST", {
      name: "Heavy tee", priceTiers: [{ minQuantity: 1, unitPriceCents: 900 }],
    });
    expect(created.status).toBe(201);
    const product = await created.json() as { id: string; name: string };

    const failed = await request(`/api/manufacturers/me/products/${product.id}`, "PATCH", {
      name: "Renamed tee", priceTiers: [{ minQuantity: 1, unitPriceCents: 424242 }],
    });
    expect(failed.status).toBe(500);

    const tiers = await db.select().from(manufacturerProductPriceTiers)
      .where(eq(manufacturerProductPriceTiers.productId, product.id));
    expect(tiers.map((t) => t.unitPriceCents)).toEqual([900]);
    const [row] = await db.select().from(manufacturerProducts).where(eq(manufacturerProducts.id, product.id));
    expect(row.name).toBe("Heavy tee");
  });

  it("rejects tier values that do not fit the integer columns", async () => {
    auth.userId = clerkId;
    const response = await request("/api/manufacturers/me/products", "POST", {
      name: "Huge", priceTiers: [{ minQuantity: 1, unitPriceCents: 3_000_000_000 }],
    });
    expect(response.status).toBe(400);
  });

  it("answers 404 for non-UUID ids instead of a database error", async () => {
    auth.userId = clerkId;
    expect((await request("/api/manufacturers/me/products/not-a-uuid", "PATCH", { name: "x" })).status).toBe(404);
    expect((await request("/api/manufacturers/me/products/not-a-uuid", "DELETE")).status).toBe(404);
    expect((await request("/api/manufacturers/me/sample-orders/not-a-uuid")).status).toBe(404);
    expect((await request("/api/manufacturers/me/sample-orders/not-a-uuid/status", "PATCH", {
      status: "processing", expectedRevision: 1,
    })).status).toBe(404);
    expect((await request("/api/manufacturers/me/threads/not-a-uuid/messages")).status).toBe(404);
    expect((await request("/api/manufacturers/threads/not-a-uuid/messages")).status).toBe(404);
  });
});

describe("manufacturer dashboard", () => {
  it("counts only paid, kept orders toward completed value", async () => {
    auth.userId = clerkId;
    const sellerId = `w1-s07-seller-${suffix}`;
    await db.insert(sampleOrders).values([
      { manufacturerId, sellerId, title: "Delivered", priceCents: 1_000, status: "delivered" },
      { manufacturerId, sellerId, title: "Completed", priceCents: 300, status: "completed" },
      { manufacturerId, sellerId, title: "Cancelled unpaid", priceCents: 5_000, status: "cancelled" },
      { manufacturerId, sellerId, title: "Refunded", priceCents: 7_000, status: "refunded" },
      { manufacturerId, sellerId, title: "In work", priceCents: 400, status: "processing" },
    ]);
    const response = await request("/api/manufacturers/me/dashboard");
    expect(response.status).toBe(200);
    const body = await response.json() as { totalRevenueCents: number; activeOrders: number; completedOrders: number };
    expect(body.totalRevenueCents).toBe(1_300);
    expect(body.activeOrders).toBe(1);
    expect(body.completedOrders).toBe(4);
  });
});
