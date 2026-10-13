/**
 * Store trust signals (features 64 + 65): how many business days a store
 * takes to ship, and its detail ratings (shipping speed, item as described).
 *
 * Shipping days come from the seller's own shipping zones — the zone that
 * serves their home country — so a store with no zones shows nothing rather
 * than a made-up estimate.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, reviews, shippingZones, users } from "@workspace/db";
import { resolveShippingForDestination, type ShippingZoneRow } from "./shippingZones";

export type RatingAggregate = { avg: number; count: number };
export type DetailRatings = { shipSpeed: RatingAggregate; accuracy: RatingAggregate };

export function emptyDetailRatings(): DetailRatings {
  return { shipSpeed: { avg: 0, count: 0 }, accuracy: { avg: 0, count: 0 } };
}

/** Business days to ship to the seller's own country, or null with no zone for it. */
export function homeProcessingDays(zones: ShippingZoneRow[], homeCountry: string): number | null {
  const resolved = resolveShippingForDestination({
    zones, weightTiers: [], destinationCountry: homeCountry, sellerHomeCountry: homeCountry,
    subtotalCents: 0, weightGrams: 0,
  });
  return resolved.unavailable ? null : resolved.processingDays;
}

export async function storeProcessingDays(sellerId: string): Promise<number | null> {
  const [seller] = await db.select({ home: users.sellerShipFromCountry })
    .from(users).where(eq(users.clerkId, sellerId)).limit(1);
  if (!seller) return null;
  const zones = await db.select().from(shippingZones)
    .where(and(eq(shippingZones.sellerId, sellerId), eq(shippingZones.active, true)));
  return homeProcessingDays(zones as unknown as ShippingZoneRow[], seller.home || "US");
}

export async function sellerDetailRatings(sellerId: string): Promise<DetailRatings> {
  const [row] = await db.select({
    shipAvg: sql<string | null>`round(avg(${reviews.shipSpeedRating})::numeric, 1)`,
    shipCount: sql<number>`count(${reviews.shipSpeedRating})::int`,
    accAvg: sql<string | null>`round(avg(${reviews.accuracyRating})::numeric, 1)`,
    accCount: sql<number>`count(${reviews.accuracyRating})::int`,
  }).from(reviews).where(eq(reviews.sellerId, sellerId));
  return {
    shipSpeed: { avg: Number(row?.shipAvg ?? 0), count: Number(row?.shipCount ?? 0) },
    accuracy: { avg: Number(row?.accAvg ?? 0), count: Number(row?.accCount ?? 0) },
  };
}
