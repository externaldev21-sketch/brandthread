import { Router } from "express";
import { db, orders, customers, productVariants, drops, products } from "@workspace/db";
import { sql, gte, and, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

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
    customerCount,
    customerToday,
    lowStock,
    preOrderHeld,
    preMadeAvailable,
  ] = await Promise.all([
    db.select({ total: sql<number>`coalesce(sum(total_cents),0)::int` }).from(orders)
      .where(and(eq(orders.ownerId, ownerId), gte(orders.createdAt, todayStart), sql`status != 'cancelled'`)),
    db.select({ total: sql<number>`coalesce(sum(total_cents),0)::int` }).from(orders)
      .where(and(eq(orders.ownerId, ownerId), gte(orders.createdAt, weekStart), sql`status != 'cancelled'`)),
    db.select({ total: sql<number>`coalesce(sum(total_cents),0)::int` }).from(orders)
      .where(and(eq(orders.ownerId, ownerId), gte(orders.createdAt, monthStart), sql`status != 'cancelled'`)),
    db.select({ count: sql<number>`count(*)::int` }).from(orders)
      .where(and(eq(orders.ownerId, ownerId), gte(orders.createdAt, todayStart))),
    db.select({ count: sql<number>`count(*)::int` }).from(orders)
      .where(eq(orders.ownerId, ownerId)),
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
  ]);

  res.json({
    revenue: {
      todayCents:  revenueToday[0]?.total  ?? 0,
      weekCents:   revenueWeek[0]?.total   ?? 0,
      monthCents:  revenueMonth[0]?.total  ?? 0,
    },
    orders: {
      today: ordersToday[0]?.count ?? 0,
      total: ordersTotal[0]?.count ?? 0,
    },
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

export default router;
