import { Router } from "express";
import { db, orders, customers, productVariants, drops, products, orderItems, users, storefrontVisits, notificationDeliveries, notificationEvents } from "@workspace/db";
import { sql, gte, lt, and, eq } from "drizzle-orm";
import { requireAuth, requirePlan } from "../middlewares/requireAuth";
import { buildCustomerAnalyticsResponse } from "./analyticsCustomers";
import { DAY_MS, TEN_MIN_MS, floorToLocalStep, parseTzOffsetMinutes, previousPeriod } from "../lib/analyticsTime";

const router = Router();
router.use(requireAuth);

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

// GET /api/analytics/dashboard
router.get("/dashboard", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const todayStart = daysAgo(0);
  const weekStart  = daysAgo(6);
  const monthStart = daysAgo(29);

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
    db.select({ total: sql<number>`coalesce(sum(total_cents),0)::int` }).from(orders)
      .where(and(eq(orders.ownerId, ownerId), gte(orders.createdAt, todayStart), sql`status != 'cancelled'`)),
    db.select({ total: sql<number>`coalesce(sum(total_cents),0)::int` }).from(orders)
      .where(and(eq(orders.ownerId, ownerId), gte(orders.createdAt, weekStart), sql`status != 'cancelled'`)),
    // All-time revenue (non-cancelled) — primary number shown on dashboard
    db.select({ total: sql<number>`coalesce(sum(total_cents),0)::int` }).from(orders)
      .where(and(eq(orders.ownerId, ownerId), sql`status != 'cancelled'`)),
    db.select({ count: sql<number>`count(*)::int` }).from(orders)
      .where(and(eq(orders.ownerId, ownerId), gte(orders.createdAt, todayStart))),
    // All-time order count (all statuses)
    db.select({ count: sql<number>`count(*)::int` }).from(orders)
      .where(eq(orders.ownerId, ownerId)),
    // Completed orders: delivered or shipped — numerator for conversion rate
    db.select({ count: sql<number>`count(*)::int` }).from(orders)
      .where(and(eq(orders.ownerId, ownerId), sql`status IN ('delivered','shipped')`)),
    db.select({ count: sql<number>`count(*)::int` }).from(customers)
      .where(eq(customers.ownerId, ownerId)),
    db.select({ count: sql<number>`count(*)::int` }).from(customers)
      .where(and(eq(customers.ownerId, ownerId), gte(customers.createdAt, todayStart))),
    // Low stock: join through products to get ownerId filter
    db.select({
      id: productVariants.id,
      productId: productVariants.productId,
      sku: productVariants.sku,
      size: productVariants.size,
      color: productVariants.color,
      stock: productVariants.stock,
      threshold: productVariants.lowStockThreshold,
    }).from(productVariants)
      .innerJoin(products, and(eq(productVariants.productId, products.id), eq(products.ownerId, ownerId)))
      .where(sql`${productVariants.stock} <= ${productVariants.lowStockThreshold}`)
      .limit(10),
    db.select({ total: sql<number>`coalesce(sum(total_collected_cents),0)::int` }).from(drops)
      .where(and(eq(drops.ownerId, ownerId), eq(drops.type, "pre-order"), sql`payout_status = 'held'`)),
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

// GET /api/analytics/home?range=live|today|yesterday|week
router.get("/home", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const range = ["live", "today", "yesterday", "week"].includes(String(req.query.range))
    ? String(req.query.range)
    : "today";
  const tzOffsetMinutes = parseTzOffsetMinutes(req.query.tz);
  const now = new Date();

  // Local-midnight-anchored boundaries, so "today"/"yesterday"/"this week" match the
  // seller's own calendar day rather than the server's timezone.
  const today = floorToLocalStep(now, DAY_MS, tzOffsetMinutes);
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const yesterday = new Date(today.getTime() - DAY_MS);
  const weekStart = new Date(today.getTime() - 6 * DAY_MS);
  // Rounded to a clean 10-minute mark so bucket boundaries (and their labels) never
  // land on an arbitrary minute like ":53" — the last live bucket covers up to the
  // most recent completed 10-minute window.
  const liveEnd = floorToLocalStep(now, TEN_MIN_MS, tzOffsetMinutes);
  const liveStart = new Date(liveEnd.getTime() - 60 * 60 * 1000);

  const start = range === "live" ? liveStart : range === "yesterday" ? yesterday : range === "week" ? weekStart : today;
  const end = range === "live" ? liveEnd : range === "yesterday" ? today : range === "week" ? tomorrow : tomorrow;
  const step = range === "live" ? "10 minutes" : range === "week" ? "1 day" : "4 hours";

  // The immediately preceding period of the same length — e.g. yesterday for
  // "today", the prior week for "this week" — so the metric cards can show a
  // real period-over-period change instead of a fabricated one.
  const { start: previousStart, end: previousEnd } = previousPeriod(start, end);

  const [salesRow, visitorRow, fulfillRow, captureRow, previousSalesRow, previousVisitorRow] = await Promise.all([
    db.select({
      totalCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
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
  ]);

  const [bucketRows, visitorBucketRows] = await Promise.all([
    db.execute(sql`
      SELECT series.bucket,
             coalesce(sum(o.total_cents), 0)::int AS total_cents,
             count(o.id)::int AS order_count
      FROM generate_series(
        ${start}::timestamp,
        ${end}::timestamp - ${sql.raw(`interval '${step}'`)},
        ${sql.raw(`interval '${step}'`)}
      ) AS series(bucket)
      LEFT JOIN orders o
        ON o.owner_id = ${ownerId}
        AND o.created_at >= series.bucket
        AND o.created_at < series.bucket + ${sql.raw(`interval '${step}'`)}
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
        ${end}::timestamp - ${sql.raw(`interval '${step}'`)},
        ${sql.raw(`interval '${step}'`)}
      ) AS series(bucket)
      LEFT JOIN storefront_visits v
        ON v.seller_id = ${ownerId}
        AND v.created_at >= series.bucket
        AND v.created_at < series.bucket + ${sql.raw(`interval '${step}'`)}
      GROUP BY series.bucket
      ORDER BY series.bucket
    `),
  ]);

  const visitorCountByBucket = new Map<string, number>();
  for (const row of (visitorBucketRows as any).rows ?? []) {
    visitorCountByBucket.set(String(row.bucket), Number(row.visitor_count ?? 0));
  }

  res.json({
    range,
    totalCents: salesRow[0]?.totalCents ?? 0,
    orderCount: salesRow[0]?.orderCount ?? 0,
    visitorCount: visitorRow[0]?.count ?? 0,
    toFulfill: fulfillRow[0]?.count ?? 0,
    toCapture: captureRow[0]?.count ?? 0,
    // Real period-over-period comparison (e.g. today vs yesterday). Balances
    // have no equivalent — they're a point-in-time snapshot, not a period sum
    // — so there is deliberately no "previous" figure for them anywhere in
    // this response.
    previous: {
      totalCents: previousSalesRow[0]?.totalCents ?? 0,
      orderCount: previousSalesRow[0]?.orderCount ?? 0,
      visitorCount: previousVisitorRow[0]?.count ?? 0,
    },
    buckets: ((bucketRows as any).rows ?? []).map((row: any) => ({
      bucket: row.bucket,
      totalCents: Number(row.total_cents ?? 0),
      orderCount: Number(row.order_count ?? 0),
      visitorCount: visitorCountByBucket.get(String(row.bucket)) ?? 0,
    })),
  });
});

// GET /api/analytics/revenue?period=today|last7|last30|last90|thisMonth|lastMonth
router.get("/revenue", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const period  = (req.query.period as string) ?? "last30";

  const periodMap: Record<string, Date> = {
    today:     daysAgo(0),
    last7:     daysAgo(6),
    last30:    daysAgo(29),
    last90:    daysAgo(89),
    thisMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    lastMonth: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1),
  };
  const since = periodMap[period] ?? daysAgo(29);

  const [result] = await db
    .select({
      totalCents:  sql<number>`coalesce(sum(total_cents),0)::int`,
      orderCount:  sql<number>`count(*)::int`,
    })
    .from(orders)
    .where(and(eq(orders.ownerId, ownerId), gte(orders.createdAt, since), sql`status != 'cancelled'`));

  const daily = await db.execute(sql`
    SELECT date_trunc('day', created_at) AS day,
           coalesce(sum(total_cents), 0)::int AS total_cents
    FROM orders
    WHERE owner_id = ${ownerId}
      AND created_at >= ${since}
      AND status != 'cancelled'
    GROUP BY day
    ORDER BY day ASC
    LIMIT 10
  `);

  res.json({
    period,
    totalCents:  result?.totalCents ?? 0,
    orderCount:  result?.orderCount ?? 0,
    daily: (daily as any).rows ?? [],
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
    LEFT JOIN order_items oi      ON oi.variant_id = pv.id
    LEFT JOIN orders o            ON oi.order_id = o.id AND o.status != 'cancelled'
    WHERE p.owner_id = ${ownerId}
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
        COALESCE(SUM(o.total_cents), 0)::int           AS total_cents,
        MAX(o.created_at)                              AS last_order_at,
        MIN(o.created_at)                              AS first_order_at
      FROM orders o
      LEFT JOIN users      u ON u.clerk_id  = o.buyer_id
      LEFT JOIN customers  c ON c.id        = o.customer_id
      WHERE o.owner_id = ${ownerId}
        AND o.status != 'cancelled'
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
        WHERE owner_id = ${ownerId} AND status != 'cancelled'
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
