/**
 * Wave 1 / s12: shipping routes.
 *  - shipping-labels: malformed order / label ids are a 404, not a Postgres
 *    uuid error (500 / 502).
 *  - shipping-rates PATCH: an empty patch or `name: null` used to 500
 *    (empty SET / NOT NULL violation).
 *  - shipping-zones PUT weight-tiers: overlapping saves must not stack tiers.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, shippingRates, shippingZones, shippingZoneWeightTiers } from "@workspace/db";

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `wave1-s12-ship-${suffix}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => { req.clerkUserId = req.headers["x-test-user"]; next(); },
}));
vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../lib/shippo", () => ({
  createShipment: vi.fn(), purchaseTransaction: vi.fn(), findTransaction: vi.fn(), refundTransaction: vi.fn(),
}));

let server: Server;
let base = "";
const rateId = crypto.randomUUID();
const zoneId = crypto.randomUUID();

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user": sellerId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  await db.insert(shippingRates).values({ id: rateId, sellerId, name: "Flat", flatRateCents: 500 });
  await db.insert(shippingZones).values({
    id: zoneId, sellerId, name: "Domestic", zoneType: "domestic", countries: [], pricingModel: "weight_tiered",
  });
  const [{ default: labels }, { default: rates }, { default: zones }] = await Promise.all([
    import("../shipping-labels"), import("../shipping-rates"), import("../shipping-zones"),
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api/shipping-labels", labels);
  app.use("/api/shipping-rates", rates);
  app.use("/api/shipping-zones", zones);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(shippingZones).where(eq(shippingZones.sellerId, sellerId));
  await db.delete(shippingRates).where(eq(shippingRates.sellerId, sellerId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("shipping-labels malformed ids", () => {
  it("404s instead of erroring in Postgres", async () => {
    expect((await call("GET", "/api/shipping-labels/not-a-uuid/parcel-suggestion")).status).toBe(404);
    expect((await call("GET", "/api/shipping-labels/not-a-uuid/printable")).status).toBe(404);
    expect((await call("POST", "/api/shipping-labels/not-a-uuid/rates", { length: 10, width: 8, height: 4, weight: 1 })).status).toBe(404);
    expect((await call("POST", "/api/shipping-labels/not-a-uuid/purchase", { rateId: "r", idempotencyKey: "k" })).status).toBe(404);
    expect((await call("POST", `/api/shipping-labels/${crypto.randomUUID()}/bad-label/void`)).status).toBe(404);
  });
});

describe("shipping-rates PATCH", () => {
  it("accepts an empty patch and keeps the name when name is null", async () => {
    const empty = await call("PATCH", `/api/shipping-rates/${rateId}`, {});
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({ id: rateId, name: "Flat", flatRateCents: 500 });

    const nulled = await call("PATCH", `/api/shipping-rates/${rateId}`, { name: null, flatRateCents: 700 });
    expect(nulled.status).toBe(200);
    expect(nulled.body).toMatchObject({ name: "Flat", flatRateCents: 700 });
  });
});

describe("shipping-zones PUT weight-tiers", () => {
  it("leaves exactly one save's tiers after overlapping saves", async () => {
    const tiers = [
      { minWeightGrams: 0, maxWeightGrams: 500, rateCents: 400 },
      { minWeightGrams: 500, maxWeightGrams: null, rateCents: 900 },
    ];
    const results = await Promise.all(
      Array.from({ length: 8 }, () => call("PUT", `/api/shipping-zones/${zoneId}/weight-tiers`, { tiers })),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    const rows = await db.select().from(shippingZoneWeightTiers).where(eq(shippingZoneWeightTiers.zoneId, zoneId));
    expect(rows).toHaveLength(2);
  });
});
