import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, shippingRates, shippingZones } from "@workspace/db";
import { inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const zoneSeller = `freeship-zone-seller-${suffix}`;
const legacySeller = `freeship-legacy-seller-${suffix}`;
const bareSeller = `freeship-bare-seller-${suffix}`;
const sellerIds = [zoneSeller, legacySeller, bareSeller];

// The endpoint is public: auth must never be consulted. Any call into
// requireAuth from this route would fail the request.
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (_req: any, res: any) => { res.status(401).json({ error: "auth reached" }); },
}));

let server: Server;
let base = "";

beforeAll(async () => {
  const { default: router } = await import("../shipping-rates");
  const app = express();
  app.use("/api/shipping-rates", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await db.insert(shippingZones).values([
    { id: `dom-${suffix}`, sellerId: zoneSeller, name: "Domestic", zoneType: "domestic", flatRateCents: 800, freeAboveCents: 7500, sortOrder: 1 },
    { id: `row-${suffix}`, sellerId: zoneSeller, name: "World", zoneType: "rest_of_world", flatRateCents: 2500, freeAboveCents: 30000, sortOrder: 0 },
  ]);
  await db.insert(shippingRates).values([
    // Ignored: zones win over the legacy rate, like checkout pricing.
    { id: `rate-z-${suffix}`, sellerId: zoneSeller, name: "Standard", flatRateCents: 500, freeAboveCents: 1000 },
    { id: `rate-l-${suffix}`, sellerId: legacySeller, name: "Standard", flatRateCents: 600, freeAboveCents: 5000 },
  ]);
});

afterAll(async () => {
  // Only rows this test created.
  await db.delete(shippingZones).where(inArray(shippingZones.sellerId, sellerIds));
  await db.delete(shippingRates).where(inArray(shippingRates.sellerId, sellerIds));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/shipping-rates/free-shipping", () => {
  it("returns each seller's domestic threshold without auth", async () => {
    const response = await fetch(`${base}/api/shipping-rates/free-shipping?sellerIds=${sellerIds.join(",")}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("public");
    const body = await response.json();
    expect(body).toEqual({ thresholds: { [zoneSeller]: 7500, [legacySeller]: 5000, [bareSeller]: null } });
  });

  it("dedupes ids and caps the list at 20", async () => {
    const ids = [zoneSeller, zoneSeller, ...Array.from({ length: 30 }, (_, i) => `freeship-none-${suffix}-${i}`)];
    const body = (await (await fetch(`${base}/api/shipping-rates/free-shipping?sellerIds=${ids.join(",")}`)).json()) as { thresholds: Record<string, number | null> };
    expect(Object.keys(body.thresholds)).toHaveLength(20);
    expect(body.thresholds[zoneSeller]).toBe(7500);
  });

  it("rejects a request with no seller ids", async () => {
    const response = await fetch(`${base}/api/shipping-rates/free-shipping?sellerIds=,`);
    expect(response.status).toBe(400);
  });

  it("leaves the existing calculate response shape alone", async () => {
    const body = (await (await fetch(`${base}/api/shipping-rates/calculate?sellerId=${legacySeller}&subtotalCents=1000`)).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["isFree", "processingDays", "rateName", "shippingCents"]);
  });
});
