/**
 * Seller dashboard Live map / order globe (behaviour reference: Shopify Live
 * View and the Shopify admin globe).
 *
 * GET /api/seller/live-map/today?tz=<minutes east of UTC>
 *   → { total, cities: [{ key, city, region, country, lat, lng, count, lastAt }],
 *       recent: [{ id, orderNumber, item, itemCount, amountCents, key, city, region, country, lat, lng, at }] }
 *
 * Today's paid, non-cancelled orders since the seller's local midnight,
 * aggregated to city level through the bundled gazetteer
 * (lib/liveMap/gazetteer.ts). Only city/region/country are read from the
 * shipping address; street, zip and recipient name never leave this file's
 * SQL. `total` counts every paid order today, including ones without a
 * placeable address (digital goods), so the header number matches reality
 * even when a dot can't be drawn.
 *
 * `recent` is the seller's own most recent paid, non-cancelled orders from
 * the last RECENT_WINDOW_DAYS (newest first, at most RECENT_LIMIT, placeable
 * ones only): one glowing dot per order on the dashboard globe, and what its
 * tap popover shows (order number, main item, amount, place, time). The
 * point is the same city-level gazetteer point the city list uses.
 */
import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { DAY_MS, floorToLocalStep, parseTzOffsetMinutes } from "../lib/analyticsTime";
import { resolveCity } from "../lib/liveMap/gazetteer";

export interface LiveMapCity {
  key: string;
  city: string;
  region: string;
  country: string;
  lat: number;
  lng: number;
  count: number;
  lastAt: string;
}

export interface LiveMapRecentOrder {
  id: string;
  orderNumber: string;
  /** The order's largest line (price × qty), by product name; "" when it has no lines. */
  item: string;
  itemCount: number;
  amountCents: number;
  key: string;
  city: string;
  region: string;
  country: string;
  lat: number;
  lng: number;
  /** paid_at, ISO. */
  at: string;
}

export interface LiveMapToday {
  total: number;
  cities: LiveMapCity[];
  recent: LiveMapRecentOrder[];
}

export const RECENT_WINDOW_DAYS = 7;
export const RECENT_LIMIT = 60;

export async function loadLiveMapRecent(sellerId: string, now = new Date()): Promise<LiveMapRecentOrder[]> {
  const since = new Date(now.getTime() - RECENT_WINDOW_DAYS * DAY_MS);
  // Over-fetch a little: an order without a placeable address gets no dot.
  const result = await db.execute(sql`
    SELECT o.id,
           o.order_number,
           o.total_cents,
           o.shipping_address->>'city'    AS city,
           o.shipping_address->>'state'   AS region,
           o.shipping_address->>'country' AS country,
           to_char(o.paid_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS paid_at,
           (SELECT count(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
           (SELECT oi.product_name FROM order_items oi WHERE oi.order_id = o.id
             ORDER BY oi.price_cents * oi.quantity DESC, oi.product_name, oi.id LIMIT 1) AS first_item
      FROM orders o
     WHERE o.owner_id = ${sellerId}
       AND o.paid_at IS NOT NULL
       AND o.paid_at >= (${since.toISOString()}::timestamptz AT TIME ZONE 'UTC')
       AND o.paid_at <= (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')
       AND o.status <> 'cancelled'
     ORDER BY o.paid_at DESC, o.id DESC
     LIMIT ${RECENT_LIMIT * 2}
  `);
  const rows = (result as any).rows as Array<{
    id: string; order_number: string; total_cents: number; city: string | null; region: string | null;
    country: string | null; paid_at: string; item_count: number; first_item: string | null;
  }>;
  const out: LiveMapRecentOrder[] = [];
  for (const row of rows) {
    if (out.length >= RECENT_LIMIT) break;
    const place = resolveCity({ city: row.city, region: row.region, country: row.country });
    if (!place) continue;
    out.push({
      id: String(row.id),
      orderNumber: row.order_number,
      item: row.first_item ?? "",
      itemCount: Number(row.item_count ?? 0),
      amountCents: Number(row.total_cents ?? 0),
      key: place.key,
      city: place.city,
      region: place.region,
      country: place.country,
      lat: place.lat,
      lng: place.lng,
      at: row.paid_at,
    });
  }
  return out;
}

export async function loadLiveMapToday(sellerId: string, tzOffsetMinutes: number, now = new Date()): Promise<LiveMapToday> {
  const [today, recent] = await Promise.all([
    loadLiveMapCities(sellerId, tzOffsetMinutes, now),
    loadLiveMapRecent(sellerId, now),
  ]);
  return { ...today, recent };
}

async function loadLiveMapCities(sellerId: string, tzOffsetMinutes: number, now: Date): Promise<Omit<LiveMapToday, "recent">> {
  const start = floorToLocalStep(now, DAY_MS, tzOffsetMinutes);
  const result = await db.execute(sql`
    SELECT shipping_address->>'city'    AS city,
           shipping_address->>'state'   AS region,
           shipping_address->>'country' AS country,
           to_char(paid_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS paid_at
      FROM orders
     WHERE owner_id = ${sellerId}
       AND paid_at IS NOT NULL
       -- paid_at is a UTC wall-clock timestamp (no tz); compare in UTC.
       AND paid_at >= (${start.toISOString()}::timestamptz AT TIME ZONE 'UTC')
       AND paid_at <= (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')
       AND status <> 'cancelled'
  `);
  const rows = (result as any).rows as Array<{ city: string | null; region: string | null; country: string | null; paid_at: string }>;

  const byKey = new Map<string, LiveMapCity>();
  for (const row of rows) {
    const place = resolveCity({ city: row.city, region: row.region, country: row.country });
    if (!place) continue;
    const at = row.paid_at;
    const existing = byKey.get(place.key);
    if (existing) {
      existing.count += 1;
      if (at > existing.lastAt) existing.lastAt = at;
    } else {
      byKey.set(place.key, {
        key: place.key,
        city: place.city,
        region: place.region,
        country: place.country,
        lat: place.lat,
        lng: place.lng,
        count: 1,
        lastAt: at,
      });
    }
  }
  const cities = [...byKey.values()].sort((a, b) => b.count - a.count || (a.lastAt < b.lastAt ? 1 : -1));
  return { total: rows.length, cities };
}

const router = Router();
router.use(requireAuth);

router.get("/today", async (req, res): Promise<void> => {
  // requireAuth sets the actor; teamContext (mounted ahead in routes/index.ts)
  // records the store the actor is working in.
  const sellerId = ((req as any).teamContext?.storeOwnerId ?? (req as any).clerkUserId) as string;
  const tz = parseTzOffsetMinutes(req.query.tz);
  res.json(await loadLiveMapToday(sellerId, tz));
});

export default router;
