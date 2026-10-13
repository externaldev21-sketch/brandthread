/**
 * GET /api/analytics/widget-summary?tz=<minutes east of UTC>
 *
 * The seller's Home / Lock Screen widget numbers (Shopify's iOS widget):
 * today's sales, today's order count and the to-ship backlog. Three small
 * queries, nothing else, so the app can refresh the widgets on launch and
 * on a new-order push without loading the whole dashboard.
 *
 * Uses the same definitions as /api/analytics/home?range=today: sales are
 * paid, non-cancelled orders since the seller's local midnight; "to ship" is
 * paid orders still pending/processing (the dashboard's "To fulfil").
 *
 * Behind the `nativeSurfaces` flag: while it's off the response is
 * `{ enabled: false }` and the app clears the widgets.
 */
import { Router, type Request } from "express";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, orders } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { DAY_MS, floorToLocalStep, parseTzOffsetMinutes } from "../lib/analyticsTime";
import { isNativeSurfacesEnabled } from "../lib/nativeSurfaces";
import { logger } from "../lib/logger";

export interface WidgetSummary {
  enabled: true;
  salesTodayCents: number;
  ordersToday: number;
  toShipCount: number;
  currency: string;
  /** ISO time the numbers were read; the widget shows nothing for a past day. */
  asOf: string;
}

export interface WidgetSummaryDeps {
  enabled(): Promise<boolean>;
  today(ownerId: string, since: Date): Promise<{ salesCents: number; orders: number }>;
  toShip(ownerId: string): Promise<number>;
  now(): Date;
}

export const dbWidgetSummaryDeps: WidgetSummaryDeps = {
  enabled: () => isNativeSurfacesEnabled(),
  async today(ownerId, since) {
    const [row] = await db.select({
      salesCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
      orders: sql<number>`count(*)::int`,
    }).from(orders).where(and(
      eq(orders.ownerId, ownerId),
      gte(orders.createdAt, since),
      sql`${orders.status} != 'cancelled'`,
      sql`${orders.paidAt} IS NOT NULL`,
    ));
    return { salesCents: row?.salesCents ?? 0, orders: row?.orders ?? 0 };
  },
  async toShip(ownerId) {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(orders).where(and(
      eq(orders.ownerId, ownerId),
      sql`${orders.status} IN ('pending', 'processing')`,
      sql`${orders.paidAt} IS NOT NULL`,
    ));
    return row?.count ?? 0;
  },
  now: () => new Date(),
};

export function createWidgetSummaryRouter(deps: WidgetSummaryDeps = dbWidgetSummaryDeps): Router {
  const router = Router();
  router.get("/", requireAuth, async (req: Request, res) => {
    const ownerId = (req as any).clerkUserId as string;
    res.setHeader("Cache-Control", "private, no-store");
    try {
      if (!(await deps.enabled())) {
        res.json({ enabled: false });
        return;
      }
      const now = deps.now();
      const midnight = floorToLocalStep(now, DAY_MS, parseTzOffsetMinutes(req.query.tz));
      const [today, toShip] = await Promise.all([deps.today(ownerId, midnight), deps.toShip(ownerId)]);
      const body: WidgetSummary = {
        enabled: true,
        salesTodayCents: today.salesCents,
        ordersToday: today.orders,
        toShipCount: toShip,
        currency: "USD",
        asOf: now.toISOString(),
      };
      res.json(body);
    } catch (err) {
      logger.error({ err }, "Widget summary failed");
      res.status(500).json({ error: "Could not load today's numbers" });
    }
  });
  return router;
}

export default createWidgetSummaryRouter();
