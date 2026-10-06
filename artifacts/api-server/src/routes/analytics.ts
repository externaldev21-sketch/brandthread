import { Router } from "express";
import { db, orders, customers, productVariants, drops, products, orderItems, users, storefrontVisits, storeVisits, notificationDeliveries, notificationEvents, threadCashEntries } from "@workspace/db";
import { sql, gte, lt, and, eq } from "drizzle-orm";
import { requireAuth, requirePlan } from "../middlewares/requireAuth";
import { buildCustomerAnalyticsResponse } from "./analyticsCustomers";
import {
  DAY_MS,
  TEN_MIN_MS,
  addLocalMonths,
  capEndAtNow,
  floorToLocalMonth,
  floorToLocalStep,
  floorToLocalWeek,
  floorToLocalYear,
  parseTzOffsetMinutes,
  previousPeriod,
} from "../lib/analyticsTime";

const router = Router();
router.use(requireAuth);

/** Start of the seller's local day, `n` days ago (tz = minutes offset, as /home). */
function localDaysAgo(n: number, tzOffsetMinutes: number, now = new Date()): Date {
  return new Date(floorToLocalStep(now, DAY_MS, tzOffsetMinutes).getTime() - n * DAY_MS);
}

/**
 * The one revenue definition every analytics screen uses (same as /home):
 * an order counts once it's paid and not cancelled, and its revenue is what
 * the seller kept — the charged total minus anything refunded.
 */
const COUNTED_ORDER = sql`${orders.paidAt} IS NOT NULL AND ${orders.status} != 'cancelled'`;
const NET_REVENUE = sql`coalesce(sum(${orders.totalCents} - coalesce(${orders.refundedCents}, 0)), 0)::int`;

// GET /api/analytics/dashboard
router.get("/dashboard", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const tz = parseTzOffsetMinutes(req.query.tz);
  const todayStart = localDaysAgo(0, tz);
  const weekStart  = localDaysAgo(6, tz);

  const [
    revenueToday,
    revenueWeek,
    revenueMonth,
    ordersToday,
    ordersTotal,
    completedOrders,
    customerCount,
    customerToday,
    lowStock,
    preOrderHeld,
    preMadeAvailable,
    sellerRow,
  ] = await Promise.all([
    db.select({ total: NET_REVENUE }).from(orders)
      .where(and(eq(orders.ownerId, ownerId), gte(orders.createdAt, todayStart), COUNTED_ORDER)),
    db.select({ total: NET_REVENUE }).from(orders)
      .where(and(eq(orders.ownerId, ownerId), gte(orders.createdAt, weekStart), COUNTED_ORDER)),
    // All-time revenue kept (paid, not cancelled, net of refunds)
    db.select({ total: NET_REVENUE }).from(orders)
      .where(and(eq(orders.ownerId, ownerId), COUNTED_ORDER)),
    db.select({ count: sql<number>`count(*)::int` }).from(orders)
      .where(and(eq(orders.ownerId, ownerId), gte(orders.createdAt, todayStart), COUNTED_ORDER)),
    // All-time paid orders
    db.select({ count: sql<number>`count(*)::int` }).from(orders)
      .where(and(eq(orders.ownerId, ownerId), COUNTED_ORDER)),
    // Completed orders: delivered or shipped — numerator for conversion rate
    db.select({ count: sql<number>`count(*)::int` }).from(orders)
      .where(and(eq(orders.ownerId, ownerId), sql`status IN ('delivered','shipped')`)),
    db.select({ count: sql<number>`count(*)::int` }).from(customers)
      .where(eq(customers.ownerId, ownerId)),
    db.select({ count: sql<number>`count(*)::int` }).from(customers)
      .where(and(eq(customers.ownerId, ownerId), gte(customers.createdAt, todayStart))),
    // Low stock on live listings only (not deleted or archived products)
    db.select({
      id: productVariants.id,
      productId: productVariants.productId,
      sku: productVariants.sku,
      size: productVariants.size,
      color: productVariants.color,
      stock: productVariants.stock,
      threshold: productVariants.lowStockThreshold,
    }).from(productVariants)
      .innerJoin(products, and(
        eq(productVariants.productId, products.id),
        eq(products.ownerId, ownerId),
        sql`${products.deletedAt} IS NULL`,
        sql`${products.status} != 'archived'`,
      ))
      .where(sql`${productVariants.stock} <= ${productVariants.lowStockThreshold}`)
      .limit(10),
    // Preorder money still held for the seller: paid preorder orders whose
    // funds haven't been released, net of refunds (drops.total_collected_cents
    // only ever grows, so it overstated this after any refund).
    db.select({ total: NET_REVENUE }).from(orders)
      .innerJoin(drops, eq(drops.id, orders.dropId))
      .where(and(eq(orders.ownerId, ownerId), eq(drops.type, "pre-order"), COUNTED_ORDER, sql`${orders.fundsState} = 'held'`)),
    db.select({ total: sql<number>`coalesce(sum(total_collected_cents),0)::int` }).from(drops)
      .where(and(eq(drops.ownerId, ownerId), eq(drops.type, "pre-made"), sql`payout_status = 'processing'`)),
    // Storefront visit counter — denominator for real conversion rate
    db.select({ visits: users.storefrontVisitCount }).from(users)
      .where(eq(users.clerkId, ownerId))
      .limit(1),
  ]);

  const storefrontVisits   = sellerRow[0]?.visits ?? 0;
  const completedOrdersCount = completedOrders[0]?.count ?? 0;

  res.json({
    revenue: {
      todayCents:  revenueToday[0]?.total  ?? 0,
      weekCents:   revenueWeek[0]?.total   ?? 0,
      // All-time total (non-cancelled) — primary revenue figure
      totalCents:  revenueMonth[0]?.total  ?? 0,
    },
    orders: {
      today: ordersToday[0]?.count ?? 0,
      total: ordersTotal[0]?.count ?? 0,
    },
    // Real conversion rate inputs — no fabricated numbers
    storefrontVisits,
    completedOrders: completedOrdersCount,
    customers: {
      total:    customerCount[0]?.count  ?? 0,
      newToday: customerToday[0]?.count ?? 0,
    },
    lowStockItems: lowStock,
    payouts: {
      preOrderHeldCents:      preOrderHeld[0]?.total    ?? 0,
      preMadeAvailableCents:  preMadeAvailable[0]?.total ?? 0,
    },
  });
});

const HOME_RANGES = ["live", "today", "yesterday", "week", "month", "year", "all"] as const;
type HomeRange = (typeof HOME_RANGES)[number];

// GET /api/analytics/home?range=live|today|yesterday|week|month|year|all
router.get("/home", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const range: HomeRange = (HOME_RANGES as readonly string[]).includes(String(req.query.range))
    ? (String(req.query.range) as HomeRange)
    : "today";
  const tzOffsetMinutes = parseTzOffsetMinutes(req.query.tz);
  const now = new Date();
  const HOUR_MS = 60 * 60 * 1000;
  const WEEK_MS = 7 * DAY_MS;

  // Local-midnight-anchored boundaries, so "today"/"yesterday"/"this week" match the
  // seller's own calendar day rather than the server's timezone.
  const today = floorToLocalStep(now, DAY_MS, tzOffsetMinutes);
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const yesterday = new Date(today.getTime() - DAY_MS);
  // Rounded to a clean 10-minute mark so bucket boundaries (and their labels) never
  // land on an arbitrary minute like ":53" — the last live bucket covers up to the
  // most recent completed 10-minute window.
  const liveEnd = floorToLocalStep(now, TEN_MIN_MS, tzOffsetMinutes);
  const liveStart = new Date(liveEnd.getTime() - 60 * 60 * 1000);

  // Today: hourly buckets across the seller's own local calendar day (12 AM
  // start), capped at the end of the CURRENT hour so no future hours are
  // ever drawn — the line simply stops at "now" instead of faking zeros
  // ahead of the present moment.
  const todayEnd = capEndAtNow(tomorrow, now, { stepMs: HOUR_MS, tzOffsetMinutes });

  // Week: Sunday-first calendar week (the app's week start — NOT the ISO
  // Monday-first convention), capped at the end of today so future days
  // within the current week are never drawn.
  const weekStart = floorToLocalWeek(now, tzOffsetMinutes);
  const weekEnd = capEndAtNow(new Date(weekStart.getTime() + WEEK_MS), now, { stepMs: DAY_MS, tzOffsetMinutes });

  // Month: the true calendar month (1st through the last day), bucketed by
  // date-of-month — NOT a rolling 30-day window — capped at the end of today
  // so future days in the month are never drawn.
  const monthStart = floorToLocalMonth(now, tzOffsetMinutes);
  const monthNaturalEnd = addLocalMonths(monthStart, 1, tzOffsetMinutes);
  const monthEnd = capEndAtNow(monthNaturalEnd, now, { stepMs: DAY_MS, tzOffsetMinutes });

  // Year: the calendar year (Jan 1 – Dec 31), bucketed monthly — NOT a
  // trailing 12-month window — capped at the end of the current month so
  // future months are never drawn.
  const yearStart = floorToLocalYear(now, tzOffsetMinutes);
  const yearNaturalEnd = addLocalMonths(yearStart, 12, tzOffsetMinutes);
  const currentMonthEnd = addLocalMonths(monthStart, 1, tzOffsetMinutes);
  const yearEnd = capEndAtNow(yearNaturalEnd, now, { currentBucketEnd: currentMonthEnd, tzOffsetMinutes });

  // All: real granularity that scales with account age — recent stores get
  // daily buckets, established ones weekly, long-running ones monthly —
  // anchored to the seller's first (non-cancelled) order, falling back to
  // their account creation date when they have no order history yet. Always
  // capped so no future bucket is ever drawn.
  let allStart = today;
  let allEnd: Date = todayEnd;
  let allStep: "1 day" | "1 week" | "1 month" = "1 day";
  if (range === "all") {
    const [firstOrderRows, userRows] = await Promise.all([
      db.select({ createdAt: sql<Date | null>`min(created_at)` }).from(orders)
        .where(and(eq(orders.ownerId, ownerId), sql`status != 'cancelled'`)),
      db.select({ createdAt: users.createdAt }).from(users)
        .where(eq(users.clerkId, ownerId)).limit(1),
    ]);
    const firstOrderAt = firstOrderRows[0]?.createdAt ? new Date(firstOrderRows[0].createdAt) : null;
    const accountCreatedAt = userRows[0]?.createdAt ? new Date(userRows[0].createdAt) : now;
    const anchor = firstOrderAt ?? accountCreatedAt;
    const accountAgeDays = Math.max(0, (now.getTime() - anchor.getTime()) / DAY_MS);

    if (accountAgeDays < 60) {
      allStep = "1 day";
      allStart = floorToLocalStep(anchor, DAY_MS, tzOffsetMinutes);
      allEnd = todayEnd;
    } else if (accountAgeDays < 365) {
      allStep = "1 week";
      allStart = floorToLocalWeek(anchor, tzOffsetMinutes);
      allEnd = weekEnd;
    } else {
      allStep = "1 month";
      allStart = floorToLocalMonth(anchor, tzOffsetMinutes);
      allEnd = currentMonthEnd;
    }
  }

  const start = range === "live" ? liveStart
    : range === "yesterday" ? yesterday
    : range === "week" ? weekStart
    : range === "month" ? monthStart
    : range === "year" ? yearStart
    : range === "all" ? allStart
    : today;
  const end = range === "live" ? liveEnd
    : range === "yesterday" ? today
    : range === "week" ? weekEnd
    : range === "month" ? monthEnd
    : range === "year" ? yearEnd
    : range === "all" ? allEnd
    : todayEnd;
  const step = range === "live" ? "10 minutes"
    : range === "week" ? "1 day"
    : range === "month" ? "1 day"
    : range === "year" ? "1 month"
    : range === "all" ? allStep
    : "1 hour";

  // The immediately preceding period of the same length — e.g. yesterday for
  // "today", the prior week for "this week" — so the metric cards can show a
  // real period-over-period change instead of a fabricated one. For "all",
  // there is by definition no meaningful prior period, so it is intentionally
  // skipped below rather than compared against an empty/fabricated window.
  const { start: previousStart, end: previousEnd } = previousPeriod(start, end);

  const [salesRow, visitorRow, fulfillRow, captureRow, previousSalesRow, previousVisitorRow, sourceRows, threadCashRow] = await Promise.all([
    db.select({
      // Gross = the order total as charged. Net subtracts anything actually
      // refunded/cancelled-back-out, so sellers see real money kept, not a
      // number that ignores refunds.
      totalCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
      netCents: sql<number>`coalesce(sum(${orders.totalCents} - coalesce(${orders.refundedCents}, 0)), 0)::int`,
      orderCount: sql<number>`count(*)::int`,
    }).from(orders).where(and(
      eq(orders.ownerId, ownerId),
      gte(orders.createdAt, start),
      lt(orders.createdAt, end),
      sql`${orders.status} != 'cancelled'`,
      sql`${orders.paidAt} IS NOT NULL`,
    )),
    db.select({ count: sql<number>`count(*)::int` }).from(storefrontVisits).where(and(
      eq(storefrontVisits.sellerId, ownerId),
      gte(storefrontVisits.createdAt, start),
      lt(storefrontVisits.createdAt, end),
    )),
    db.select({ count: sql<number>`count(*)::int` }).from(orders).where(and(
      eq(orders.ownerId, ownerId),
      sql`${orders.status} IN ('pending', 'processing')`,
      sql`${orders.paidAt} IS NOT NULL`,
    )),
    db.select({ count: sql<number>`count(*)::int` }).from(orders).where(and(
      eq(orders.ownerId, ownerId),
      sql`${orders.status} != 'cancelled'`,
      sql`${orders.stripePaymentIntentId} IS NOT NULL`,
      sql`${orders.paidAt} IS NULL`,
    )),
    db.select({
      totalCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
      netCents: sql<number>`coalesce(sum(${orders.totalCents} - coalesce(${orders.refundedCents}, 0)), 0)::int`,
      orderCount: sql<number>`count(*)::int`,
    }).from(orders).where(and(
      eq(orders.ownerId, ownerId),
      gte(orders.createdAt, previousStart),
      lt(orders.createdAt, previousEnd),
      sql`${orders.status} != 'cancelled'`,
      sql`${orders.paidAt} IS NOT NULL`,
    )),
    db.select({ count: sql<number>`count(*)::int` }).from(storefrontVisits).where(and(
      eq(storefrontVisits.sellerId, ownerId),
      gte(storefrontVisits.createdAt, previousStart),
      lt(storefrontVisits.createdAt, previousEnd),
    )),
    // Real per-source traffic breakdown (Discover feed / Search / Your
    // profile / External links) for the same range the rest of this
    // response already uses. Grouped in SQL rather than four separate
    // queries.
    db.select({
      source: storeVisits.source,
      count: sql<number>`count(*)::int`,
    }).from(storeVisits).where(and(
      eq(storeVisits.sellerId, ownerId),
      gte(storeVisits.createdAt, start),
      lt(storeVisits.createdAt, end),
    )).groupBy(storeVisits.source),
    // Thread Cash the seller actually received via Live gifting in this
    // range — cashable, unlike a buyer's reward credit (see threadCash.ts).
    // The column is still named buyer_id even for a seller-recipient row.
    db.select({
      totalCents: sql<number>`coalesce(sum(${threadCashEntries.amountCents}), 0)::int`,
    }).from(threadCashEntries).where(and(
      eq(threadCashEntries.buyerId, ownerId),
      eq(threadCashEntries.source, "live_gift"),
      gte(threadCashEntries.createdAt, start),
      lt(threadCashEntries.createdAt, end),
    )),
  ]);

  const TRAFFIC_SOURCES = ["feed", "search", "profile", "external"] as const;
  const sourceCountBySource = new Map<string, number>(
    sourceRows.map((row) => [row.source, row.count]),
  );
  const totalSourceVisits = TRAFFIC_SOURCES.reduce(
    (sum, key) => sum + (sourceCountBySource.get(key) ?? 0),
    0,
  );
  const visitorCount = visitorRow[0]?.count ?? 0;
  // `store_visits` (totalSourceVisits) and `storefront_visits` (visitorCount)
  // are deliberately separate real tables — the former records every visit
  // including repeat/unauthenticated ones, the latter dedupes one visitor
  // per seller per day for a meaningful conversion-rate denominator (see
  // their schema comments) — so their raw totals don't naturally agree, and
  // the Traffic sources panel's headline is visitorCount, not
  // totalSourceVisits. Rather than show two disagreeing real numbers, each
  // source's REAL measured share of totalSourceVisits is reapplied against
  // visitorCount (largest-remainder rounding so the rows sum to exactly
  // visitorCount) — never a fabricated split, since the share itself is
  // real; only the num of visitors it's scaled onto changes to match the
  // number already shown as the headline and the Visitors stat tile.
  const trafficSources = (() => {
    if (totalSourceVisits <= 0 || visitorCount <= 0) {
      return TRAFFIC_SOURCES.map((key) => ({ source: key, count: 0, sharePercent: 0 }));
    }
    const scaled = TRAFFIC_SOURCES.map((key) => {
      const sourceCount = sourceCountBySource.get(key) ?? 0;
      return (sourceCount / totalSourceVisits) * visitorCount;
    });
    const counts = scaled.map((v) => Math.floor(v));
    let remainder = visitorCount - counts.reduce((sum, c) => sum + c, 0);
    const order = scaled
      .map((v, i) => ({ i, frac: v - Math.floor(v) }))
      .sort((a, b) => b.frac - a.frac);
    for (const { i } of order) {
      if (remainder <= 0) break;
      counts[i] += 1;
      remainder -= 1;
    }
    return TRAFFIC_SOURCES.map((key, i) => ({
      source: key,
      count: counts[i],
      sharePercent: Math.round((counts[i] / visitorCount) * 1000) / 10,
    }));
  })();

  const [bucketRows, visitorBucketRows] = await Promise.all([
    // Uses the EXACT same predicates (owner, status, paid_at) as the
    // headline salesRow query above, so `sum(buckets[].totalCents)` is
    // mathematically guaranteed to equal the headline totalCents — never a
    // divergent number from a differently-filtered query.
    db.execute(sql`
      SELECT series.bucket,
             coalesce(sum(o.total_cents), 0)::int AS total_cents,
             coalesce(sum(o.total_cents - coalesce(o.refunded_cents, 0)), 0)::int AS net_cents,
             count(o.id)::int AS order_count
      FROM generate_series(
        ${start}::timestamp,
        -- Every bucket that STARTS before end. end can be capped mid-bucket
        -- ("all" ends at the current hour while stepping by day); end - step
        -- then dropped the current bucket and the chart summed to less than
        -- the headline.
        ${end}::timestamp - interval '1 microsecond',
        ${sql.raw(`interval '${step}'`)}
      ) AS series(bucket)
      LEFT JOIN orders o
        ON o.owner_id = ${ownerId}
        AND o.created_at >= series.bucket
        AND o.created_at < series.bucket + ${sql.raw(`interval '${step}'`)}
        AND o.created_at < ${end}
        AND o.status != 'cancelled'
        AND o.paid_at IS NOT NULL
      GROUP BY series.bucket
      ORDER BY series.bucket
    `),
    db.execute(sql`
      SELECT series.bucket,
             count(v.id)::int AS visitor_count
      FROM generate_series(
        ${start}::timestamp,
        ${end}::timestamp - interval '1 microsecond',
        ${sql.raw(`interval '${step}'`)}
      ) AS series(bucket)
      LEFT JOIN storefront_visits v
        ON v.seller_id = ${ownerId}
        AND v.created_at >= series.bucket
        AND v.created_at < series.bucket + ${sql.raw(`interval '${step}'`)}
        AND v.created_at < ${end}
      GROUP BY series.bucket
      ORDER BY series.bucket
    `),
  ]);

  const visitorCountByBucket = new Map<string, number>();
  for (const row of (visitorBucketRows as any).rows ?? []) {
    visitorCountByBucket.set(String(row.bucket), Number(row.visitor_count ?? 0));
  }

  const totalCents = salesRow[0]?.totalCents ?? 0;
  const netCents = salesRow[0]?.netCents ?? 0;
  const orderCount = salesRow[0]?.orderCount ?? 0;
  const previousTotalCents = previousSalesRow[0]?.totalCents ?? 0;
  const previousNetCents = previousSalesRow[0]?.netCents ?? 0;
  const previousOrderCount = previousSalesRow[0]?.orderCount ?? 0;
  const previousVisitorCount = previousVisitorRow[0]?.count ?? 0;

  res.json({
    range,
    // Single source of truth: every field below (and every bucket) is
    // derived from the SAME [start, end) window and the SAME order
    // predicates, so the metric cards and the chart can never disagree.
    totalCents,
    // Net of anything actually refunded/cancelled back out — real money the
    // seller keeps, not just what was charged.
    netCents,
    orderCount,
    visitorCount,
    // Real conversion + average-order-value, derived from the exact same
    // counts above rather than a separately-fetched number that could drift.
    conversionRate: visitorCount > 0 ? Math.round((orderCount / visitorCount) * 1000) / 10 : 0,
    averageOrderCents: orderCount > 0 ? Math.round(totalCents / orderCount) : 0,
    // Thread Cash the seller actually received via Live gifting in this
    // range (cashable — see threadCash.ts).
    threadCashReceivedCents: threadCashRow[0]?.totalCents ?? 0,
    toFulfill: fulfillRow[0]?.count ?? 0,
    toCapture: captureRow[0]?.count ?? 0,
    // Real period-over-period comparison (e.g. today vs yesterday). Balances
    // have no equivalent — they're a point-in-time snapshot, not a period sum
    // — so there is deliberately no "previous" figure for them anywhere in
    // this response.
    previous: {
      totalCents: previousTotalCents,
      netCents: previousNetCents,
      orderCount: previousOrderCount,
      visitorCount: previousVisitorCount,
    },
    // Real per-source breakdown for the Traffic sources panel — replaces the
    // former "isn't tracked yet" lock row. Fresh stores with no visits yet
    // get real zeros for every source, not a placeholder. This is the
    // `visitorsBySource`-equivalent field for the Traffic Sources redesign:
    // `trafficSources: [{ source: 'feed'|'search'|'profile'|'external',
    // count: number, sharePercent: number }]`.
    trafficSources,
    buckets: ((bucketRows as any).rows ?? []).map((row: any) => ({
      bucket: row.bucket,
      totalCents: Number(row.total_cents ?? 0),
      netCents: Number(row.net_cents ?? 0),
      orderCount: Number(row.order_count ?? 0),
      visitorCount: visitorCountByBucket.get(String(row.bucket)) ?? 0,
    })),
  });
});

// GET /api/analytics/revenue?period=today|last7|last30|last90|thisMonth|lastMonth
router.get("/revenue", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const period  = (req.query.period as string) ?? "last30";
  const tz = parseTzOffsetMinutes(req.query.tz);
  const now = new Date();
  const thisMonth = floorToLocalMonth(now, tz);

  // [since, until) in the seller's local calendar.
  const periodMap: Record<string, { since: Date; until?: Date }> = {
    today:     { since: localDaysAgo(0, tz, now) },
    last7:     { since: localDaysAgo(6, tz, now) },
    last30:    { since: localDaysAgo(29, tz, now) },
    last90:    { since: localDaysAgo(89, tz, now) },
    thisMonth: { since: thisMonth },
    lastMonth: { since: addLocalMonths(thisMonth, -1, tz), until: thisMonth },
  };
  const { since, until } = periodMap[period] ?? periodMap.last30;
  const window = until
    ? and(gte(orders.createdAt, since), lt(orders.createdAt, until))
    : gte(orders.createdAt, since);

  const [result] = await db
    .select({
      totalCents:  NET_REVENUE,
      orderCount:  sql<number>`count(*)::int`,
    })
    .from(orders)
    .where(and(eq(orders.ownerId, ownerId), window, COUNTED_ORDER));

  // One row per local day that had sales (no 10-row cap: a 90-day chart
  // needs up to 90). `day` is the seller's local date, YYYY-MM-DD.
  const local = sql`(${orders.createdAt} + make_interval(mins => ${tz}))`;
  const daily = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${local}), 'YYYY-MM-DD')`,
      total_cents: NET_REVENUE,
    })
    .from(orders)
    .where(and(eq(orders.ownerId, ownerId), window, COUNTED_ORDER))
    .groupBy(sql`1`)
    .orderBy(sql`1`)
    .limit(400);

  res.json({
    period,
    totalCents:  result?.totalCents ?? 0,
    orderCount:  result?.orderCount ?? 0,
    daily,
  });
});

// GET /api/analytics/products
// Top products by revenue, with stock status — real data from order_items + product_variants.
router.get("/products", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;

  const revenueRows = await db.execute(sql`
    SELECT
      p.id           AS product_id,
      p.name,
      COALESCE(SUM(oi.quantity * oi.price_cents), 0)::int  AS revenue_cents,
      COALESCE(SUM(oi.quantity), 0)::int                    AS units_sold,
      COUNT(DISTINCT o.id)::int                             AS order_count
    FROM products p
    LEFT JOIN product_variants pv ON pv.product_id = p.id
    -- Only line items of paid, non-cancelled orders, minus refunded items
    -- (the old join filtered cancelled orders but still summed their items).
    LEFT JOIN (
      order_items oi
      JOIN orders o ON o.id = oi.order_id AND o.paid_at IS NOT NULL AND o.status != 'cancelled'
    ) ON oi.variant_id = pv.id AND oi.refunded_at IS NULL
    WHERE p.owner_id = ${ownerId} AND p.deleted_at IS NULL
    GROUP BY p.id, p.name
    ORDER BY revenue_cents DESC
    LIMIT 20
  `);

  const stockRows = await db.execute(sql`
    SELECT p.id AS product_id, COALESCE(SUM(pv.stock), 0)::int AS total_stock,
           COALESCE(MIN(pv.stock), 0)::int AS min_stock
    FROM products p
    JOIN product_variants pv ON pv.product_id = p.id
    WHERE p.owner_id = ${ownerId}
    GROUP BY p.id
  `);

  const stockMap = new Map(
    ((stockRows as any).rows as any[]).map((r) => [r.product_id, r]),
  );

  const result = ((revenueRows as any).rows as any[]).map((r) => {
    const stock  = stockMap.get(r.product_id) as any;
    const total  = stock?.total_stock ?? 0;
    return {
      productId:       r.product_id,
      name:            r.name,
      revenueCents:    r.revenue_cents,
      unitsSold:       r.units_sold,
      orderCount:      r.order_count,
      inventoryStatus: total === 0 ? "out_of_stock" : total < 10 ? "low" : "in_stock",
    };
  });

  res.json(result);
});

// GET /api/analytics/post-clicks
// Returns the top 20 posts with shop_click interactions, grouped by post, for the authenticated seller
router.get("/post-clicks", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  try {
    const rows = await db.execute(sql`
      SELECT
        i.post_id,
        p.caption,
        p.media_url,
        COUNT(*)::int AS click_count,
        COUNT(DISTINCT i.user_id)::int AS unique_clickers,
        MAX(i.created_at) AS last_clicked_at
      FROM interactions i
      JOIN posts p ON p.id = i.post_id::uuid
      WHERE p.user_id = ${ownerId}
        AND i.type = 'shop_click'
      GROUP BY i.post_id, p.caption, p.media_url
      ORDER BY click_count DESC
      LIMIT 20
    `);
    res.json(rows.rows ?? rows);
  } catch (err) {
    req.log.error({ err }, "Failed to load post click analytics");
    res.status(500).json({ error: 'Failed to load post click analytics' });
  }
});

// GET /api/analytics/notifications
// Delivery and engagement totals are scoped to the active seller/store owner.
// No notification titles, bodies, tokens, or recipient identities leave this
// endpoint; it is an aggregate-only reporting surface.
router.get("/notifications", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  try {
    const [deliveryRows, eventRows] = await Promise.all([
      db.select({
        queued: sql<number>`count(*) FILTER (WHERE ${notificationDeliveries.status} = 'queued')::int`,
        sent: sql<number>`count(*) FILTER (WHERE ${notificationDeliveries.status} = 'sent')::int`,
        providerResults: sql<number>`count(*) FILTER (WHERE ${notificationDeliveries.providerResultAt} IS NOT NULL)::int`,
        providerErrors: sql<number>`count(*) FILTER (WHERE ${notificationDeliveries.status} = 'provider_error')::int`,
      }).from(notificationDeliveries).where(eq(notificationDeliveries.ownerId, ownerId)),
      db.select({
        eventType: notificationEvents.eventType,
        count: sql<number>`count(*)::int`,
      }).from(notificationEvents)
        .where(eq(notificationEvents.ownerId, ownerId))
        .groupBy(notificationEvents.eventType),
    ]);
    const eventCounts = Object.fromEntries(eventRows.map((row) => [row.eventType, row.count]));
    const delivery = deliveryRows[0] ?? { queued: 0, sent: 0, providerResults: 0, providerErrors: 0 };
    return res.json({
      queued: delivery.queued,
      sent: delivery.sent,
      providerResults: delivery.providerResults,
      providerErrors: delivery.providerErrors,
      open: eventCounts.open ?? 0,
      tap: eventCounts.tap ?? 0,
      receipt: eventCounts.receipt ?? 0,
      events: {
        receipt: eventCounts.receipt ?? 0,
        open: eventCounts.open ?? 0,
        tap: eventCounts.tap ?? 0,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load notification analytics");
    return res.status(500).json({ error: "Failed to load notification analytics" });
  }
});

// GET /api/analytics/customers?limit=10
// Top customers by total spend + repeat-buyer stats derived from real orders.
// Returns topCustomers list and aggregate stats (totalCustomers, repeatRate).
router.get("/customers", requirePlan("pro"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const limit   = Math.min(parseInt((req.query.limit as string) ?? "10", 10) || 10, 50);

  try {
    // Top customers — group orders by buyer; join users for display name and
    // customers table (via order.customer_id) for email.
    const topRows = await db.execute(sql`
      SELECT
        o.buyer_id,
        c.id                                           AS customer_id,
        COALESCE(u.display_name, c.name, 'Customer')  AS name,
        COALESCE(c.email, '')                           AS email,
        COUNT(o.id)::int                               AS order_count,
        COALESCE(SUM(o.total_cents - COALESCE(o.refunded_cents, 0)), 0)::int AS total_cents,
        MAX(o.created_at)                              AS last_order_at,
        MIN(o.created_at)                              AS first_order_at
      FROM orders o
      LEFT JOIN users      u ON u.clerk_id  = o.buyer_id
      LEFT JOIN customers  c ON c.id        = o.customer_id
      WHERE o.owner_id = ${ownerId}
        AND o.status != 'cancelled'
        AND o.paid_at IS NOT NULL
      GROUP BY o.buyer_id, c.id, u.display_name, c.name, c.email
      ORDER BY total_cents DESC
      LIMIT ${limit}
    `);

    // Aggregate repeat-buyer stats
    const statsRows = await db.execute(sql`
      SELECT
        COUNT(DISTINCT buyer_id)::int                                          AS total_customers,
        SUM(CASE WHEN order_count > 1 THEN 1 ELSE 0 END)::int                 AS repeat_customers,
        COALESCE(AVG(order_count), 0)::numeric(10,2)                           AS avg_orders_per_customer
      FROM (
        SELECT buyer_id, COUNT(*) AS order_count
        FROM orders
        WHERE owner_id = ${ownerId} AND status != 'cancelled' AND paid_at IS NOT NULL
        GROUP BY buyer_id
      ) sub
    `);

    res.json(buildCustomerAnalyticsResponse(topRows.rows, statsRows.rows));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch customer analytics");
    res.status(500).json({ error: "Failed to fetch customer analytics" });
  }
});

export default router;
