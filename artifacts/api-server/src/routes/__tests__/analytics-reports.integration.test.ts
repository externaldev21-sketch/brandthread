/**
 * GET /api/analytics/reports/{store,profit,marketing,production}
 * Every number comes from real rows; anything not recorded is null.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import {
  db, orders, storefrontVisits, storeVisits, sampleOrders, manufacturers, shippingLabels,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { buildStoreReport, buildProfitReport, resolveReportRange } from "../analytics-reports";

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `reports-seller-${suffix}`;
const otherSeller = `reports-other-${suffix}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = sellerId;
    next();
  },
  requirePlan: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

let server: Server;
let base = "";
let manufacturerId = "";
let orderSeq = 0;

async function order(values: Partial<typeof orders.$inferInsert> & { totalCents: number }) {
  orderSeq += 1;
  const [row] = await db.insert(orders).values({
    ownerId: sellerId,
    orderNumber: `RP-${suffix}-${orderSeq}`,
    subtotalCents: values.totalCents,
    status: "processing",
    paidAt: new Date(),
    ...values,
  }).returning({ id: orders.id });
  return row.id;
}

beforeAll(async () => {
  const { default: reportsRouter } = await import("../analytics-reports");
  const app = express();
  app.use((req: any, _res, next) => { req.log = { error: () => undefined }; next(); });
  app.use("/api/analytics/reports", reportsRouter);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await db.insert(storefrontVisits).values([
    { sellerId, visitorId: `v1-${suffix}`, visitDate: today },
    { sellerId, visitorId: `v1-${suffix}`, visitDate: yesterday, createdAt: new Date(Date.now() - 86_400_000) },
    { sellerId, visitorId: `v2-${suffix}`, visitDate: today },
    { sellerId: otherSeller, visitorId: `v3-${suffix}`, visitDate: today },
  ]);
  await db.insert(storeVisits).values([
    { sellerId, source: "feed", device: "ios" },
    { sellerId, source: "search", device: "web", productId: crypto.randomUUID() },
    { sellerId, source: "profile", productId: crypto.randomUUID() },
  ]);

  const o1 = await order({
    totalCents: 10_000, refundedCents: 1_000, platformFeeCents: 500, processingFeeChargedCents: 320, discountCode: "SAVE10",
  });
  await order({ totalCents: 5_000 });
  await order({ totalCents: 99_999, status: "cancelled" }); // excluded everywhere
  await db.insert(shippingLabels).values({
    orderId: o1, ownerId: sellerId, idempotencyKey: `lbl-${suffix}`, providerRateId: "rate", priceCents: 700, status: "active",
  });

  const [mfr] = await db.insert(manufacturers).values({
    businessName: `Mill ${suffix}`, country: "US", specialty: "cut and sew",
  } as any).returning({ id: manufacturers.id });
  manufacturerId = mfr.id;
  await db.insert(sampleOrders).values([
    { manufacturerId, sellerId, title: "Bulk tees", orderType: "bulk", quantity: 100, priceCents: 120_000, status: "cut_and_sew" },
    {
      manufacturerId, sellerId, title: "Sample", orderType: "sample", quantity: 1, priceCents: 3_000, status: "delivered",
      createdAt: new Date(Date.now() - 4 * 86_400_000), deliveredAt: new Date(),
    },
    { manufacturerId, sellerId, title: "Unpaid", quantity: 50, priceCents: 50_000, status: "pending_payment" },
  ]);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await db.delete(shippingLabels).where(eq(shippingLabels.ownerId, sellerId));
  await db.delete(orders).where(eq(orders.ownerId, sellerId));
  await db.delete(storefrontVisits).where(eq(storefrontVisits.sellerId, sellerId));
  await db.delete(storefrontVisits).where(eq(storefrontVisits.sellerId, otherSeller));
  await db.delete(storeVisits).where(eq(storeVisits.sellerId, sellerId));
  await db.delete(sampleOrders).where(eq(sampleOrders.sellerId, sellerId));
  if (manufacturerId) await db.delete(manufacturers).where(eq(manufacturers.id, manufacturerId));
});

const get = async (path: string) => {
  const res = await fetch(`${base}/api/analytics/reports/${path}`);
  return { status: res.status, body: await res.json() as any };
};

describe("store report", () => {
  it("counts only this seller's real visits, product views and paid orders", async () => {
    const { status, body } = await get("store?range=7d");
    expect(status).toBe(200);
    expect(body.visitors).toBe(3);
    expect(body.uniqueVisitors).toBe(2);
    expect(body.returningVisitors).toBe(1);
    expect(body.sessions).toBe(3);
    expect(body.productPageViews).toBe(2);
    expect(body.mobileTrafficPct).toBe(50); // 1 of 2 visits with a known device
    expect(body.purchaseConversion).toBeCloseTo(66.7, 1);
    expect(body.avgSessionDurationSeconds).toBeNull();
    expect(body.funnel.map((f: any) => f.count)).toEqual([3, 2, 0, 0, 2]);
  });
});

describe("profit report", () => {
  it("subtracts refunds, fees and recorded costs from paid, non-cancelled sales", async () => {
    const { status, body } = await get("profit?range=30d");
    expect(status).toBe(200);
    expect(body.grossRevenueCents).toBe(15_000);
    expect(body.refundsCents).toBe(1_000);
    expect(body.netRevenueCents).toBe(15_000 - 1_000 - 500 - 320);
    expect(body.shippingCostCents).toBe(700);
    expect(body.manufacturerCostCents).toBe(123_000); // unpaid sample order excluded
    expect(body.estimatedProfitCents).toBe(15_000 - 1_000 - 500 - 320 - 700 - 123_000);
    expect(body.productCostCents).toBeNull();
    expect(body.lineItems.at(-1).label).toBe("Est. Profit");
  });
});

describe("marketing report", () => {
  it("attributes revenue only to orders that used a discount code", async () => {
    const { status, body } = await get("marketing?range=30d");
    expect(status).toBe(200);
    expect(body.marketingRevenueCents).toBe(10_000);
    expect(body.channels.find((c: any) => c.key === "discounts").revenueCents).toBe(10_000);
    expect(body.campaigns).toEqual([]);
    expect(body.influencers).toEqual([]);
  });
});

describe("production report", () => {
  it("reports paid manufacturer orders and leaves unrecorded metrics null", async () => {
    const { status, body } = await get("production?range=30d");
    expect(status).toBe(200);
    expect(body.activeJobs).toBe(1);
    expect(body.unitsInProduction).toBe(100);
    expect(body.spendCents).toBe(123_000);
    expect(body.avgSampleTimeDays).toBeCloseTo(4, 0);
    expect(body.avgLeadTimeDays).toBeNull();
    expect(body.onTimeCompletionRate).toBeNull();
    expect(body.manufacturers).toHaveLength(1);
    expect(body.manufacturers[0].name).toBe(`Mill ${suffix}`);
    expect(body.manufacturers[0].totalUnits).toBe(101);
  });
});

describe("pure helpers", () => {
  it("resolves unknown ranges to 30 days and last_month to the previous calendar month", () => {
    const now = new Date(2026, 9, 17, 12);
    expect(resolveReportRange("nope", now).range).toBe("30d");
    const lm = resolveReportRange("last_month", now);
    expect(lm.start.getMonth()).toBe(8);
    expect(lm.end.getMonth()).toBe(9);
    expect(lm.end.getDate()).toBe(1);
  });
  it("never reports a rate without a denominator", () => {
    const r = buildStoreReport({
      visitors: 0, uniqueVisitors: 0, returningVisitors: 0, storeVisits: 0, productViews: 0,
      visitsWithDevice: 0, mobileVisits: 0, addToCartVisitors: 0, checkoutsStarted: 0, purchases: 0, daily: [],
    });
    expect(r.purchaseConversion).toBeNull();
    expect(r.mobileTrafficPct).toBeNull();
  });
  it("has no margin without sales", () => {
    const p = buildProfitReport({
      grossCents: 0, refundedCents: 0, platformFeeCents: 0, processingFeeCents: 0,
      shippingLabelCents: 0, productionCents: 500, marketingCents: 0, creatorCommissionCents: 0, daily: [],
    });
    expect(p.profitMarginPct).toBeNull();
    expect(p.estimatedProfitCents).toBe(-500);
  });
});
