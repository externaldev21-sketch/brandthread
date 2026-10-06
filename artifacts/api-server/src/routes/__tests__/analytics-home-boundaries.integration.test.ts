/**
 * GET /api/analytics/home — accuracy + boundary-correctness rebuild.
 *
 * The chart and every metric card on the seller Dashboard read this ONE
 * endpoint, so these tests assert the properties that keep them honest:
 *  - The headline `totalCents`/`netCents`/`orderCount` are EXACTLY the sum
 *    of the returned `buckets[]` — never a divergent number from a
 *    differently-filtered query.
 *  - Orders land in the correct bucket across every tricky boundary: local
 *    midnight, the Sunday-first week start, a month end, and a year end —
 *    using an explicit seller timezone offset so a server-midnight-vs-
 *    seller-midnight mismatch can't silently pass.
 *  - Refunds reduce `netCents` (and the bucket's own netCents) without
 *    touching gross `totalCents`.
 *  - Thread Cash received via Live gifting is summed into
 *    `threadCashReceivedCents` for the range, and only for `source:
 *    'live_gift'` rows belonging to this seller.
 *  - No bucket is ever returned for a future hour/day/month relative to
 *    "now" (the `capEndAtNow` contract) — checked indirectly via the total
 *    bucket count for the "today" range never exceeding the current local
 *    hour + 1.
 *  - `previous.totalCents` reflects a real distinct prior period, not a
 *    copy of the current one.
 *
 * Skipped automatically in any environment without a reachable Postgres
 * (see artifacts/api-server's vitest setup) — this sandbox has none, so it
 * is exercised in real CI instead.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orders, threadCashEntries, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `home-boundaries-seller-${suffix}`;

const authState = { clerkUserId: sellerId };
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = authState.clerkUserId;
    next();
  },
  requirePlan: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

let server: Server;
let base = "";
let orderCounter = 0;

async function makeOrder(opts: {
  totalCents: number;
  refundedCents?: number;
  createdAt: Date;
  status?: string;
}) {
  orderCounter += 1;
  const [order] = await db.insert(orders).values({
    ownerId: sellerId,
    orderNumber: `HB-${suffix}-${orderCounter}`,
    status: opts.status ?? "processing",
    totalCents: opts.totalCents,
    subtotalCents: opts.totalCents,
    refundedCents: opts.refundedCents ?? 0,
    paidAt: opts.createdAt,
    createdAt: opts.createdAt,
  }).returning({ id: orders.id });
  return order.id;
}

function sumBuckets(body: any, key: "totalCents" | "netCents" | "orderCount") {
  return (body.buckets as any[]).reduce((sum, b) => sum + Number(b[key] ?? 0), 0);
}

beforeAll(async () => {
  await db.insert(users).values({
    clerkId: sellerId,
    email: `${sellerId}@test.local`,
    name: "Home Boundaries Seller",
    displayName: "Home Boundaries Seller",
    role: "seller",
    accountType: "seller",
  });

  const { default: analyticsRouter } = await import("../analytics");
  const app = express();
  app.use(express.json());
  app.use("/api/analytics", analyticsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(orders).where(eq(orders.ownerId, sellerId));
  await db.delete(threadCashEntries).where(eq(threadCashEntries.buyerId, sellerId));
  await db.delete(users).where(inArray(users.clerkId, [sellerId]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/analytics/home — headline == sum(buckets), every range", () => {
  it.each(["today", "week", "month", "year", "all"])(
    "range=%s: totalCents/netCents/orderCount exactly equal the sum of buckets[]",
    async (range) => {
      // A handful of orders scattered around "now" — exact placement isn't
      // the point of this test (the boundary tests below cover that); the
      // point is that however they land, the headline and the buckets never
      // disagree, because both come from the exact same predicates.
      const now = new Date();
      await makeOrder({ totalCents: 5000, createdAt: now });
      await makeOrder({ totalCents: 3000, refundedCents: 1000, createdAt: new Date(now.getTime() - 60_000) });

      const response = await fetch(`${base}/api/analytics/home?range=${range}&tz=0`);
      const body = await response.json() as any;
      expect(response.status).toBe(200);
      expect(body.totalCents).toBe(sumBuckets(body, "totalCents"));
      expect(body.netCents).toBe(sumBuckets(body, "netCents"));
      expect(body.orderCount).toBe(sumBuckets(body, "orderCount"));
      // Net is never greater than gross.
      expect(body.netCents).toBeLessThanOrEqual(body.totalCents);

      await db.delete(orders).where(eq(orders.ownerId, sellerId));
    },
  );
});

describe("GET /api/analytics/home — boundary placement (seller-local, tz=0 for a deterministic UTC seller)", () => {
  it("places an order just before local midnight in that day's last bucket, not the next day's", async () => {
    // Yesterday 23:58 (tz=0): in YESTERDAY's last hourly bucket, never in
    // today. (A "today 23:58" order would be in the future, which the
    // no-future-buckets rule rightly leaves out.)
    const now = new Date();
    const todayMidnightUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const lateYesterday = new Date(todayMidnightUtc.getTime() - 2 * 60 * 1000);
    await makeOrder({ totalCents: 1234, createdAt: lateYesterday });

    const yesterday = await (await fetch(`${base}/api/analytics/home?range=yesterday&tz=0`)).json() as any;
    expect(yesterday.totalCents).toBe(1234);
    expect(yesterday.totalCents).toBe(sumBuckets(yesterday, "totalCents"));
    const lastBucket = (yesterday.buckets as any[]).at(-1);
    expect(Number(lastBucket.totalCents)).toBe(1234);

    const today = await (await fetch(`${base}/api/analytics/home?range=today&tz=0`)).json() as any;
    expect(today.totalCents).toBe(0);
    await db.delete(orders).where(eq(orders.ownerId, sellerId));
  });

  it("places an order on the most recent Sunday in the WEEK range (Sunday-first, not ISO Monday-first)", async () => {
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0 = Sunday
    const mostRecentSundayUtc = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayOfWeek, 12, 0, 0,
    ));
    await makeOrder({ totalCents: 2200, createdAt: mostRecentSundayUtc });

    const response = await fetch(`${base}/api/analytics/home?range=week&tz=0`);
    const body = await response.json() as any;
    expect(response.status).toBe(200);
    expect(body.totalCents).toBeGreaterThanOrEqual(2200);
    expect(body.totalCents).toBe(sumBuckets(body, "totalCents"));

    // The day BEFORE the most recent Sunday belongs to LAST week, and must
    // never be counted in this week's total.
    // Sunday 12:00 − 13h = Saturday 23:00 (−1h stayed on Sunday).
    const lastSaturdayUtc = new Date(mostRecentSundayUtc.getTime() - 13 * 60 * 60 * 1000);
    const priorOrderId = await makeOrder({ totalCents: 9999, createdAt: lastSaturdayUtc });
    const response2 = await fetch(`${base}/api/analytics/home?range=week&tz=0`);
    const body2 = await response2.json() as any;
    expect(body2.totalCents).toBe(body.totalCents); // unchanged — Saturday's order excluded
    await db.delete(orders).where(eq(orders.id, priorOrderId));

    await db.delete(orders).where(eq(orders.ownerId, sellerId));
  });

  it("places an order on the 1st of the current calendar MONTH in this month's range, not the trailing 30 days", async () => {
    const now = new Date();
    const firstOfMonthUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 12, 0, 0));
    await makeOrder({ totalCents: 3300, createdAt: firstOfMonthUtc });

    const response = await fetch(`${base}/api/analytics/home?range=month&tz=0`);
    const body = await response.json() as any;
    expect(body.totalCents).toBeGreaterThanOrEqual(3300);
    expect(body.totalCents).toBe(sumBuckets(body, "totalCents"));

    // The LAST day of the previous month must never be counted, even though
    // it could fall within a rolling 30-day window.
    // The 1st 12:00 − 13h = previous month's last day, 23:00.
    const lastDayOfPrevMonthUtc = new Date(firstOfMonthUtc.getTime() - 13 * 60 * 60 * 1000);
    const priorOrderId = await makeOrder({ totalCents: 8800, createdAt: lastDayOfPrevMonthUtc });
    const response2 = await fetch(`${base}/api/analytics/home?range=month&tz=0`);
    const body2 = await response2.json() as any;
    expect(body2.totalCents).toBe(body.totalCents);
    await db.delete(orders).where(eq(orders.id, priorOrderId));

    await db.delete(orders).where(eq(orders.ownerId, sellerId));
  });

  it("places an order on Jan 1 of the current calendar YEAR in this year's range, not the trailing 12 months", async () => {
    const now = new Date();
    const jan1Utc = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 12, 0, 0));
    await makeOrder({ totalCents: 4400, createdAt: jan1Utc });

    const response = await fetch(`${base}/api/analytics/home?range=year&tz=0`);
    const body = await response.json() as any;
    expect(body.totalCents).toBeGreaterThanOrEqual(4400);
    expect(body.totalCents).toBe(sumBuckets(body, "totalCents"));

    // Dec 31 of LAST year must never be counted, even though a trailing
    // 12-month window would include it most of the year.
    // Jan 1 12:00 − 13h = Dec 31 23:00 of last year.
    const dec31LastYearUtc = new Date(jan1Utc.getTime() - 13 * 60 * 60 * 1000);
    const priorOrderId = await makeOrder({ totalCents: 7700, createdAt: dec31LastYearUtc });
    const response2 = await fetch(`${base}/api/analytics/home?range=year&tz=0`);
    const body2 = await response2.json() as any;
    expect(body2.totalCents).toBe(body.totalCents);
    await db.delete(orders).where(eq(orders.id, priorOrderId));

    await db.delete(orders).where(eq(orders.ownerId, sellerId));
  });

  it("for a UTC-8 seller, an order at 07:59 UTC is local 23:59 YESTERDAY, though the server's date is already today", async () => {
    // tz=-480: local = UTC − 8h, so UTC 07:59 on day D is local 23:59 on
    // D−1. Run only once that moment is in the past (UTC ≥ 08:00).
    const now = new Date();
    const serverTodayUtcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (now.getUTCHours() >= 8) {
      const sellerLocalLateNightUtc = new Date(serverTodayUtcMidnight.getTime() + 7 * 60 * 60 * 1000 + 59 * 60 * 1000);
      await makeOrder({ totalCents: 5500, createdAt: sellerLocalLateNightUtc });

      const yesterday = await (await fetch(`${base}/api/analytics/home?range=yesterday&tz=-480`)).json() as any;
      expect(yesterday.totalCents).toBe(5500);
      expect(yesterday.totalCents).toBe(sumBuckets(yesterday, "totalCents"));
      const today = await (await fetch(`${base}/api/analytics/home?range=today&tz=-480`)).json() as any;
      expect(today.totalCents).toBe(0);

      await db.delete(orders).where(eq(orders.ownerId, sellerId));
    }
  });
});

describe("GET /api/analytics/home — net sales subtract refunds, gross does not", () => {
  it("netCents reflects refundedCents; totalCents (gross) is unaffected", async () => {
    const now = new Date();
    await makeOrder({ totalCents: 10_000, refundedCents: 4_000, createdAt: now });

    const response = await fetch(`${base}/api/analytics/home?range=today&tz=0`);
    const body = await response.json() as any;
    expect(body.totalCents).toBe(10_000);
    expect(body.netCents).toBe(6_000);

    await db.delete(orders).where(eq(orders.ownerId, sellerId));
  });
});

describe("GET /api/analytics/home — Thread Cash received (Live gifting)", () => {
  it("sums 'live_gift' entries for this seller within the range, excluding other sources and other users", async () => {
    const now = new Date();
    await db.insert(threadCashEntries).values([
      { buyerId: sellerId, amountCents: 500, source: "live_gift", createdAt: now },
      { buyerId: sellerId, amountCents: 250, source: "live_gift", createdAt: now },
      // Not a Live-gift credit — must be excluded from threadCashReceivedCents.
      { buyerId: sellerId, amountCents: 999, source: "admin_adjustment", createdAt: now },
      // Belongs to a different user entirely — must never leak in.
      { buyerId: `other-user-${suffix}`, amountCents: 111, source: "live_gift", createdAt: now },
    ]);

    const response = await fetch(`${base}/api/analytics/home?range=today&tz=0`);
    const body = await response.json() as any;
    expect(body.threadCashReceivedCents).toBe(750);

    await db.delete(threadCashEntries).where(eq(threadCashEntries.buyerId, sellerId));
  });
});

describe("GET /api/analytics/home — future buckets are never drawn", () => {
  it("the 'today' range never returns more hourly buckets than have actually elapsed", async () => {
    const response = await fetch(`${base}/api/analytics/home?range=today&tz=0`);
    const body = await response.json() as any;
    const now = new Date();
    const elapsedHoursToday = now.getUTCHours() + 1; // current hour is partial but included
    expect((body.buckets as any[]).length).toBeLessThanOrEqual(elapsedHoursToday);
    expect((body.buckets as any[]).length).toBeGreaterThan(0);
  });
});

describe("GET /api/analytics/home — previous period is a real, distinct comparison", () => {
  it("previous.totalCents reflects a prior period's own orders, not a copy of the current range", async () => {
    const now = new Date();
    await makeOrder({ totalCents: 1500, createdAt: now });
    // An order from well within "yesterday" (the previous period for range=today).
    const yesterday = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    await makeOrder({ totalCents: 900, createdAt: yesterday });

    const response = await fetch(`${base}/api/analytics/home?range=today&tz=0`);
    const body = await response.json() as any;
    expect(body.totalCents).toBeGreaterThanOrEqual(1500);
    // The previous period must not simply echo the current totals back.
    expect(body.previous.totalCents).not.toBe(body.totalCents);

    await db.delete(orders).where(eq(orders.ownerId, sellerId));
  });
});
