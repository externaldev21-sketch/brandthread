/**
 * store_visits (migration 108) — the real per-source traffic tracking that
 * replaces the seller Dashboard's former "isn't tracked yet" lock row.
 *
 * Covers:
 *  - POST /api/public/sellers/:sellerId/store-visits records a real row for
 *    a signed-in buyer AND for an anonymous one (no auth required at all).
 *  - Unknown/garbage `source` values fall back to 'external' rather than
 *    being rejected or silently dropped.
 *  - The seller's own visits to their own store are never counted.
 *  - GET /api/analytics/home aggregates real per-source counts + share of
 *    total for the same date range as the rest of the dashboard.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, storeVisits, storefrontVisits, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const sellerA = `store-visits-seller-a-${suffix}`;
const sellerB = `store-visits-seller-b-${suffix}`;
const buyerA = `store-visits-buyer-a-${suffix}`;

// The public router calls getAuth() directly (no requireAuth middleware —
// an anonymous visit must still be recorded), so this is mocked the same
// way other public-route tests mock Clerk directly.
const authState = vi.hoisted(() => ({ clerkUserId: null as string | null }));
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: authState.clerkUserId }),
}));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = authState.clerkUserId;
    next();
  },
  requirePlan: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

let server: Server;
let base = "";

beforeAll(async () => {
  await db.insert(users).values([
    {
      clerkId: sellerA,
      email: `${sellerA}@test.local`,
      name: "Store Visits Seller A",
      displayName: "Seller A",
      role: "seller",
      accountType: "seller",
    },
    {
      clerkId: sellerB,
      email: `${sellerB}@test.local`,
      name: "Store Visits Seller B",
      displayName: "Seller B",
      role: "seller",
      accountType: "seller",
    },
    {
      clerkId: buyerA,
      email: `${buyerA}@test.local`,
      name: "Store Visits Buyer A",
      displayName: "Buyer A",
      role: "buyer",
      accountType: "buyer",
    },
  ]);

  const { default: publicRouter } = await import("../public");
  const { default: analyticsRouter } = await import("../analytics");
  const app = express();
  app.use(express.json());
  app.use("/api/public", publicRouter);
  app.use("/api/analytics", analyticsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(storeVisits).where(inArray(storeVisits.sellerId, [sellerA, sellerB]));
  await db.delete(users).where(inArray(users.clerkId, [sellerA, sellerB, buyerA]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /api/public/sellers/:sellerId/store-visits", () => {
  it("records a visit for a signed-in buyer", async () => {
    authState.clerkUserId = buyerA;
    const response = await fetch(`${base}/api/public/sellers/${sellerA}/store-visits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "feed" }),
    });
    expect(response.status).toBe(204);

    const rows = await db.select().from(storeVisits).where(eq(storeVisits.sellerId, sellerA));
    expect(rows.some((r) => r.source === "feed" && r.viewerUserId === buyerA)).toBe(true);
  });

  it("records a visit for an anonymous (signed-out) buyer — no auth required", async () => {
    authState.clerkUserId = null;
    const response = await fetch(`${base}/api/public/sellers/${sellerA}/store-visits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "search" }),
    });
    expect(response.status).toBe(204);

    const rows = await db.select().from(storeVisits).where(eq(storeVisits.sellerId, sellerA));
    expect(rows.some((r) => r.source === "search" && r.viewerUserId === null)).toBe(true);
  });

  it("falls back to 'external' for an unknown source instead of rejecting it", async () => {
    authState.clerkUserId = null;
    const response = await fetch(`${base}/api/public/sellers/${sellerA}/store-visits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "not-a-real-source" }),
    });
    expect(response.status).toBe(204);

    const rows = await db.select().from(storeVisits).where(eq(storeVisits.sellerId, sellerA));
    expect(rows.some((r) => r.source === "external")).toBe(true);
  });

  it("records a product-scoped visit with a productId", async () => {
    authState.clerkUserId = null;
    const productId = crypto.randomUUID();
    const response = await fetch(`${base}/api/public/sellers/${sellerA}/store-visits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "profile", productId }),
    });
    expect(response.status).toBe(204);

    const rows = await db.select().from(storeVisits).where(eq(storeVisits.sellerId, sellerA));
    expect(rows.some((r) => r.source === "profile" && r.productId === productId)).toBe(true);
  });

  it("never counts the seller viewing their own store", async () => {
    authState.clerkUserId = sellerB;
    const before = await db.select().from(storeVisits).where(eq(storeVisits.sellerId, sellerB));
    const response = await fetch(`${base}/api/public/sellers/${sellerB}/store-visits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "feed" }),
    });
    expect(response.status).toBe(204);
    const after = await db.select().from(storeVisits).where(eq(storeVisits.sellerId, sellerB));
    expect(after.length).toBe(before.length);
  });

  it("404s for a seller that doesn't exist", async () => {
    authState.clerkUserId = null;
    const response = await fetch(`${base}/api/public/sellers/no-such-seller-${suffix}/store-visits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "feed" }),
    });
    expect(response.status).toBe(404);
  });
});

describe("GET /api/analytics/home — real per-source traffic aggregation", () => {
  it("returns real counts and share-of-total for the seller's own range, and real zeros with no traffic", async () => {
    authState.clerkUserId = sellerB;
    // Wipe any prior rows so this test owns the count exactly.
    await db.delete(storeVisits).where(eq(storeVisits.sellerId, sellerB));
    await db.delete(storefrontVisits).where(eq(storefrontVisits.sellerId, sellerB));

    const zeroResponse = await fetch(`${base}/api/analytics/home?range=month`);
    const zeroBody = await zeroResponse.json() as any;
    expect(zeroResponse.status).toBe(200);
    expect(zeroBody.trafficSources).toEqual([
      { source: "feed", count: 0, sharePercent: 0 },
      { source: "search", count: 0, sharePercent: 0 },
      { source: "profile", count: 0, sharePercent: 0 },
      { source: "external", count: 0, sharePercent: 0 },
    ]);

    // 4 feed, 2 search, 1 profile, 1 external — a real, uneven split.
    await db.insert(storeVisits).values([
      { sellerId: sellerB, source: "feed" },
      { sellerId: sellerB, source: "feed" },
      { sellerId: sellerB, source: "feed" },
      { sellerId: sellerB, source: "feed" },
      { sellerId: sellerB, source: "search" },
      { sellerId: sellerB, source: "search" },
      { sellerId: sellerB, source: "profile" },
      { sellerId: sellerB, source: "external" },
      // A different seller's traffic must never leak into sellerB's numbers.
      { sellerId: sellerA, source: "feed" },
    ]);
    // 8 distinct deduped storefront visitors — exactly matching the 8
    // store_visits rows above, so `visitorCount` and the per-source total
    // agree here and the largest-remainder scaling below is a no-op.
    const visitDate = new Date().toISOString().slice(0, 10);
    await db.insert(storefrontVisits).values(
      Array.from({ length: 8 }, (_, i) => ({
        sellerId: sellerB,
        visitorId: `${buyerA}-${i}`,
        visitDate,
      })),
    );

    const response = await fetch(`${base}/api/analytics/home?range=month`);
    const body = await response.json() as any;
    expect(response.status).toBe(200);
    expect(body.visitorCount).toBe(8);
    const bySource = Object.fromEntries(body.trafficSources.map((r: any) => [r.source, r]));
    expect(bySource.feed).toEqual({ source: "feed", count: 4, sharePercent: 50 });
    expect(bySource.search).toEqual({ source: "search", count: 2, sharePercent: 25 });
    expect(bySource.profile).toEqual({ source: "profile", count: 1, sharePercent: 12.5 });
    expect(bySource.external).toEqual({ source: "external", count: 1, sharePercent: 12.5 });
    // The core invariant the seller Dashboard's Traffic sources panel
    // depends on: its headline, its rows, and the separate Visitors stat
    // tile (also `visitorCount`) can never visibly disagree.
    const rowSum = body.trafficSources.reduce((sum: number, r: any) => sum + r.count, 0);
    expect(rowSum).toBe(body.visitorCount);
  });

  it("scales real per-source counts onto visitorCount (largest-remainder rounding) when store_visits and storefront_visits totals genuinely differ", async () => {
    authState.clerkUserId = sellerB;
    await db.delete(storeVisits).where(eq(storeVisits.sellerId, sellerB));
    await db.delete(storefrontVisits).where(eq(storefrontVisits.sellerId, sellerB));

    // 8 real store_visits (a product page can be visited without ever
    // hitting the deduped storefront endpoint), but only 5 deduped
    // storefront visitors — a realistic, common divergence between the two
    // tables, not a contrived edge case.
    await db.insert(storeVisits).values([
      { sellerId: sellerB, source: "feed" },
      { sellerId: sellerB, source: "feed" },
      { sellerId: sellerB, source: "feed" },
      { sellerId: sellerB, source: "feed" },
      { sellerId: sellerB, source: "search" },
      { sellerId: sellerB, source: "search" },
      { sellerId: sellerB, source: "profile" },
      { sellerId: sellerB, source: "external" },
    ]);
    const visitDate = new Date().toISOString().slice(0, 10);
    await db.insert(storefrontVisits).values(
      Array.from({ length: 5 }, (_, i) => ({
        sellerId: sellerB,
        visitorId: `${buyerA}-scaled-${i}`,
        visitDate,
      })),
    );

    const response = await fetch(`${base}/api/analytics/home?range=month`);
    const body = await response.json() as any;
    expect(response.status).toBe(200);
    expect(body.visitorCount).toBe(5);
    // Real per-source proportions (4:2:1:1) reapplied onto the real
    // visitorCount of 5, rounded so the rows sum to exactly 5 — never a
    // number disagreeing with the headline/Visitors tile, and never a
    // fabricated proportion (the 4:2:1:1 shape is the real measured split).
    const rowSum = body.trafficSources.reduce((sum: number, r: any) => sum + r.count, 0);
    expect(rowSum).toBe(5);
    const bySource = Object.fromEntries(body.trafficSources.map((r: any) => [r.source, r]));
    expect(bySource.feed.count).toBe(2);
    expect(bySource.search.count).toBe(1);
    expect(bySource.profile.count).toBe(1);
    expect(bySource.external.count).toBe(1);
  });

  it("excludes traffic outside the requested range", async () => {
    authState.clerkUserId = sellerA;
    await db.delete(storeVisits).where(eq(storeVisits.sellerId, sellerA));
    const outsideRange = new Date();
    outsideRange.setDate(outsideRange.getDate() - 400);
    await db.insert(storeVisits).values({
      sellerId: sellerA,
      source: "feed",
      createdAt: outsideRange,
    });

    const response = await fetch(`${base}/api/analytics/home?range=month`);
    const body = await response.json() as any;
    expect(response.status).toBe(200);
    expect(body.trafficSources.every((r: any) => r.count === 0)).toBe(true);
  });
});
