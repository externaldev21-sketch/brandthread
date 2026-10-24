/**
 * GET /api/seller/analytics/* plus the Sales "By Product" breakdown on
 * /api/analytics/revenue and product images on /api/analytics/products.
 *
 *  - A seller with no rows gets well-formed zero payloads (200), never an
 *    error — the mobile screens render those as honest empty states.
 *  - A seller with seeded orders, campaigns, manufacturer orders and visits
 *    gets the exact aggregates, in integer cents.
 *  - Another seller's rows never leak into the response.
 *
 * Skipped automatically without a reachable Postgres (see vitest setup).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import {
  db, users, products, productVariants, orders, orderItems, orderReleases, storeVisits, storefrontVisits,
  sellerProductEvents, checkoutSessions, checkoutAttributions, emailCampaigns, emailCampaignSends,
  sellerPushBroadcasts, manufacturers, sampleOrders,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const sfx = crypto.randomBytes(5).toString("hex");
const A = `sa-a-${sfx}`;       // seeded seller
const EMPTY = `sa-e-${sfx}`;   // seller with no rows at all
const OTHER = `sa-o-${sfx}`;   // rows that must never leak into A

const authState = vi.hoisted(() => ({ clerkUserId: null as string | null }));
vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: authState.clerkUserId }) }));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!authState.clerkUserId) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = authState.clerkUserId;
    next();
  },
  requirePlan: () => (_q: unknown, _res: unknown, next: () => void) => next(),
}));

let server: Server;
let base = "";
let manufacturerId = "";
let productId = "";

const get = async (path: string, as: string | null = A) => {
  authState.clerkUserId = as;
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: (await res.json()) as any };
};
const now = () => new Date(Date.now() - 5_000);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function order(owner: string, values: Partial<typeof orders.$inferInsert> & { totalCents: number }, items: Array<{ variantId: string | null; qty: number; priceCents: number; name?: string }> = []) {
  const [o] = await db.insert(orders).values({
    ownerId: owner, orderNumber: `SA-${crypto.randomBytes(4).toString("hex")}`,
    subtotalCents: values.totalCents, status: "processing", paidAt: now(), createdAt: now(),
    ...values,
  }).returning();
  for (const item of items) {
    await db.insert(orderItems).values({
      orderId: o.id, variantId: item.variantId, productName: item.name ?? "Tee", quantity: item.qty, priceCents: item.priceCents,
    });
  }
  return o;
}

beforeAll(async () => {
  await db.insert(users).values([A, EMPTY, OTHER].map((id) => ({
    clerkId: id, email: `${id}@test.local`, name: id, role: "seller", accountType: "seller",
  })));
  const [p] = await db.insert(products).values({ ownerId: A, name: "Seeded Tee", images: ["https://img.test/seeded-tee.jpg"] }).returning();
  productId = p.id;
  const [v] = await db.insert(productVariants).values({ productId, sku: `SA-${sfx}`, priceCents: 5000, stock: 20 }).returning();

  // Orders: a discounted sale, an email-attributed partly refunded sale, and
  // a cancelled one that must be ignored everywhere.
  const o1 = await order(A, {
    totalCents: 10000, grossChargedCents: 10000, taxCents: 800, platformFeeCents: 500, processingFeeChargedCents: 300,
    discountCode: "FALL10", discountAmountCents: 1000, disputePausedAt: now(),
  }, [{ variantId: v.id, qty: 2, priceCents: 5000 }]);
  const o2 = await order(A, {
    totalCents: 6000, grossChargedCents: 6000, refundedCents: 1000, stripeCheckoutSessionId: `cs_${sfx}`,
  }, [{ variantId: v.id, qty: 1, priceCents: 5000 }, { variantId: null, qty: 1, priceCents: 1000, name: "Gift wrap" }]);
  await order(A, { totalCents: 9999, status: "cancelled" }, [{ variantId: v.id, qty: 5, priceCents: 2000 }]);
  await order(OTHER, { totalCents: 77777, discountCode: "OTHER" });

  await db.insert(checkoutAttributions).values({
    checkoutSessionId: crypto.randomUUID(), stripeSessionId: `cs_${sfx}`, sellerId: A, utmSource: "newsletter", utmMedium: "email",
  });
  await db.insert(orderReleases).values({
    orderId: o1.id, sellerId: A, state: "pending", trigger: "manual", amountCents: 2000, bulkShareCents: 400, labelCents: 600,
  });
  void o2;

  const [campaign] = await db.insert(emailCampaigns).values({
    sellerId: A, subject: "Drop 02 is live", status: "sent", sentAt: now(), recipientCount: 2,
  }).returning();
  await db.insert(emailCampaignSends).values([
    { campaignId: campaign.id, sellerId: A, subscriberId: crypto.randomUUID(), email: "a@x.test", status: "sent", deliveredAt: now(), openedAt: now() },
    { campaignId: campaign.id, sellerId: A, subscriberId: crypto.randomUUID(), email: "b@x.test", status: "sent", deliveredAt: now() },
  ]);
  await db.insert(sellerPushBroadcasts).values({ sellerId: A, title: "We're live", body: "Come watch", status: "sent", recipientCount: 30, sentCount: 28 });
  await db.insert(emailCampaigns).values({ sellerId: OTHER, subject: "Not yours", status: "sent", sentAt: now(), recipientCount: 99 });

  const [m] = await db.insert(manufacturers).values({
    clerkId: `sa-mfr-${sfx}`, businessName: `Seeded Knit ${sfx}`, country: "Portugal", specialty: "Knitwear",
  }).returning();
  manufacturerId = m.id;
  await db.insert(sampleOrders).values([
    { manufacturerId, sellerId: A, orderType: "sample", title: "Tee sample", quantity: 2, priceCents: 4000,
      status: "delivered", createdAt: daysAgo(12), deliveredAt: daysAgo(2) },
    { manufacturerId, sellerId: A, orderType: "bulk", title: "Tee bulk", quantity: 100, priceCents: 150000, status: "cut_and_sew", createdAt: daysAgo(5) },
    { manufacturerId, sellerId: A, orderType: "bulk", title: "Unpaid card", quantity: 500, priceCents: 999999, status: "pending_payment" },
    { manufacturerId, sellerId: OTHER, orderType: "bulk", title: "Other", quantity: 9, priceCents: 9000, status: "processing" },
  ]);

  await db.insert(storeVisits).values([
    { sellerId: A, source: "feed", device: "ios", createdAt: now() },
    { sellerId: A, source: "feed", productId, device: "ios", createdAt: now() },
    { sellerId: A, source: "feed", device: "web", createdAt: now() },
    { sellerId: A, source: "search", productId, device: "web", createdAt: now() },
    { sellerId: OTHER, source: "search", createdAt: now() },
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = daysAgo(1).toISOString().slice(0, 10);
  await db.insert(storefrontVisits).values([
    { sellerId: A, visitorId: `v1-${sfx}`, visitDate: today, createdAt: now() },
    { sellerId: A, visitorId: `v1-${sfx}`, visitDate: yesterday, createdAt: daysAgo(1) },
    { sellerId: A, visitorId: `v2-${sfx}`, visitDate: today, createdAt: now() },
  ]);
  await db.insert(sellerProductEvents).values({ sellerId: A, productId, eventType: "add_to_cart", viewerKey: `k-${sfx}`, createdAt: now() });
  await db.insert(checkoutSessions).values({ sellerId: A, items: [] });

  const { default: sellerAnalyticsRouter } = await import("../seller-analytics");
  const { default: analyticsRouter } = await import("../analytics");
  const app = express();
  app.use(express.json());
  app.use("/api/seller/analytics", sellerAnalyticsRouter);
  app.use("/api/analytics", analyticsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const sellers = [A, EMPTY, OTHER];
  await db.delete(orderReleases).where(inArray(orderReleases.sellerId, sellers));
  await db.delete(orders).where(inArray(orders.ownerId, sellers));
  await db.delete(checkoutAttributions).where(inArray(checkoutAttributions.sellerId, sellers));
  await db.delete(checkoutSessions).where(inArray(checkoutSessions.sellerId, sellers));
  await db.delete(emailCampaignSends).where(inArray(emailCampaignSends.sellerId, sellers));
  await db.delete(emailCampaigns).where(inArray(emailCampaigns.sellerId, sellers));
  await db.delete(sellerPushBroadcasts).where(inArray(sellerPushBroadcasts.sellerId, sellers));
  await db.delete(sampleOrders).where(inArray(sampleOrders.sellerId, sellers));
  if (manufacturerId) await db.delete(manufacturers).where(eq(manufacturers.id, manufacturerId));
  await db.delete(storeVisits).where(inArray(storeVisits.sellerId, sellers));
  await db.delete(storefrontVisits).where(inArray(storefrontVisits.sellerId, sellers));
  await db.delete(sellerProductEvents).where(inArray(sellerProductEvents.sellerId, sellers));
  if (productId) {
    await db.delete(productVariants).where(eq(productVariants.productId, productId));
    await db.delete(products).where(eq(products.id, productId));
  }
  await db.delete(users).where(inArray(users.clerkId, sellers));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("empty seller", () => {
  it.each(["marketing", "production", "profit", "payouts", "store"])("/%s returns 200 with zero aggregates", async (name) => {
    const { status, body } = await get(`/api/seller/analytics/${name}`, EMPTY);
    expect(status).toBe(200);
    expect(body).toBeTypeOf("object");
  });

  it("returns exact zeros and empty lists", async () => {
    const marketing = (await get("/api/seller/analytics/marketing", EMPTY)).body;
    expect(marketing.revenue.marketingCents).toBe(0);
    expect(marketing.campaigns).toEqual([]);
    const production = (await get("/api/seller/analytics/production", EMPTY)).body;
    expect(production).toMatchObject({ activeJobs: 0, totalJobs: 0, manufacturers: [] });
    const profit = (await get("/api/seller/analytics/profit", EMPTY)).body;
    expect(profit).toMatchObject({ grossCents: 0, estimatedProfitCents: 0, profitMarginPct: 0, daily: [] });
    const payouts = (await get("/api/seller/analytics/payouts", EMPTY)).body;
    expect(payouts).toMatchObject({ connected: false, availableCents: 0, heldCents: 0, totalPaidOutCents: 0, history: [] });
    const store = (await get("/api/seller/analytics/store", EMPTY)).body;
    expect(store).toMatchObject({ visitors: 0, sessions: 0, productPageViews: 0 });
    expect(store.trafficSources).toHaveLength(4);
    const revenue = (await get("/api/analytics/revenue?period=last30", EMPTY)).body;
    expect(revenue.breakdown).toEqual([]);
  });

  it("requires a signed-in caller", async () => {
    expect((await get("/api/seller/analytics/marketing", null)).status).toBe(401);
  });
});

describe("seeded seller", () => {
  it("marketing: channel revenue, campaigns and discount codes", async () => {
    const { body } = await get("/api/seller/analytics/marketing?period=last30");
    expect(body.revenue).toMatchObject({
      marketingCents: 10000 + 5000, emailCents: 5000, discountCents: 10000, smsCents: 0, influencerCents: 0,
    });
    expect(body.attributedOrders).toBe(2);
    expect(body.campaigns.map((c: any) => c.type).sort()).toEqual(["email", "push"]);
    const email = body.campaigns.find((c: any) => c.type === "email");
    expect(email).toMatchObject({ name: "Drop 02 is live", recipients: 2, delivered: 2, opens: 1, clicks: 0 });
    const push = body.campaigns.find((c: any) => c.type === "push");
    expect(push).toMatchObject({ recipients: 30, delivered: 28 });
    expect(body.discountCodes).toEqual([{ code: "FALL10", orders: 1, revenueCents: 10000, discountCents: 1000 }]);
  });

  it("production: paid manufacturer orders only, per manufacturer", async () => {
    const { body } = await get("/api/seller/analytics/production");
    expect(body).toMatchObject({
      activeJobs: 1, unitsInProduction: 100, productionValueCents: 150000, avgSampleTimeDays: 10,
      onTimeCompletionRate: 100, delayedJobs: 0, totalJobs: 2, avgUnitCostCents: Math.round(154000 / 102),
    });
    expect(body.manufacturers).toHaveLength(1);
    expect(body.manufacturers[0]).toMatchObject({
      manufacturerId, productsProduced: 2, totalUnits: 102, totalSpendCents: 154000, sampleApprovalRate: 100,
    });
  });

  it("profit: revenue minus refunds, fees, tax and manufacturer cost", async () => {
    const { body } = await get("/api/seller/analytics/profit?period=last30");
    expect(body).toMatchObject({
      orderCount: 2, grossCents: 16000, refundsCents: 1000, taxCents: 800, platformFeesCents: 500, paymentFeesCents: 300,
      discountsCents: 1000, manufacturerCostCents: 154000, productCostKnown: false,
    });
    expect(body.netRevenueCents).toBe(16000 - 1000 - 500 - 300);
    expect(body.estimatedProfitCents).toBe(14200 - 800 - 154000);
    expect(body.lineItems.find((l: any) => l.label === "Gross Sales").amount).toBe(16000);
    expect(body.daily).toHaveLength(1);
  });

  it("payouts: releases, allocations, dispute holds and refund impact", async () => {
    const { body } = await get("/api/seller/analytics/payouts?period=last30");
    expect(body).toMatchObject({
      connected: false, releasingCents: 2000, manufacturerAllocationCents: 400, shippingAllocationCents: 600,
      disputeHoldsCents: 10000, refundImpactCents: 1000, availableCents: 0,
    });
  });

  it("store: visits, funnel and traffic sources", async () => {
    const { body } = await get("/api/seller/analytics/store?period=last30");
    expect(body).toMatchObject({
      visitors: 3, uniqueVisitors: 2, returningVisitors: 1, sessions: 4, productPageViews: 2, mobileTrafficPct: 50,
      addToCartRate: 50, checkoutStartRate: 50, purchaseConversion: 100,
    });
    expect(body.funnel.map((s: any) => s.count)).toEqual([4, 2, 1, 1, 2]);
    expect(body.trafficSources[0]).toMatchObject({ source: "feed", visits: 3, productViews: 1, sharePct: 75 });
    expect(body.trafficSources.find((s: any) => s.source === "search")).toMatchObject({ visits: 1, sharePct: 25 });
  });

  it("sales: per-product breakdown and order count exclude cancelled orders", async () => {
    const { body } = await get("/api/analytics/revenue?period=last30");
    expect(body.orderCount).toBe(2);
    expect(body.breakdown).toEqual([
      { productId, label: "Seeded Tee", units: 3, revenueCents: 15000, orders: 2, sharePct: 93.8 },
      { productId: null, label: "Gift wrap", units: 1, revenueCents: 1000, orders: 1, sharePct: 6.3 },
    ]);
    expect(body.daily[0]).toMatchObject({ order_count: 2 });
  });

  it("sales: the Dashboard's calendar Week / Year and All periods cover the same recent orders", async () => {
    for (const period of ["thisYear", "all"]) {
      const { body } = await get(`/api/analytics/revenue?period=${period}`);
      expect(body.period).toBe(period);
      expect(body.orderCount).toBe(2);
      expect(body.breakdown.map((row: any) => row.label)).toEqual(["Seeded Tee", "Gift wrap"]);
    }
    const week = (await get("/api/analytics/revenue?period=thisWeek")).body;
    expect(week.orderCount).toBeLessThanOrEqual(2);
  });

  it("products: rows carry the first product image", async () => {
    const { body } = await get("/api/analytics/products");
    expect(body.find((row: any) => row.productId === productId)).toMatchObject({ imageUrl: "https://img.test/seeded-tee.jpg" });
  });
});
