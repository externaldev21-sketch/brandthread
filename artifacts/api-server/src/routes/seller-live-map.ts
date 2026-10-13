/**
 * Seller dashboard Live map (behaviour reference: Shopify Live View).
 *
 * GET /api/seller/live-map/today?tz=<minutes east of UTC>
 *   → { total, cities: [{ key, city, region, country, lat, lng, count, lastAt }] }
 *
 * Today's paid, non-cancelled orders since the seller's local midnight,
 * aggregated to city level through the bundled gazetteer
 * (lib/liveMap/gazetteer.ts). Only city/region/country are read from the
 * shipping address; street, zip and recipient name never leave this file's
 * SQL. `total` counts every paid order today, including ones without a
 * placeable address (digital goods), so the header number matches reality
 * even when a dot can't be drawn.
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

export interface LiveMapToday {
  total: number;
  cities: LiveMapCity[];
}

export async function loadLiveMapToday(sellerId: string, tzOffsetMinutes: number, now = new Date()): Promise<LiveMapToday> {
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
