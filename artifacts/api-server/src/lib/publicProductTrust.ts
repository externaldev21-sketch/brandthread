/**
 * Seller-backed trust data for the public product page (GET /api/public/products/:id):
 * the seller's own return / cancellation policy text and a domestic shipping
 * summary. Everything here comes from what the seller configured; nothing is
 * invented. When the seller set nothing, the fields are null and the app
 * hides the line (or says the policy isn't listed) instead of showing
 * placeholder promises.
 *
 * Key names are deliberately `seller*` so they are distinct from the users
 * columns that the public-profile allow-list keeps off profile payloads.
 */
import { and, eq } from "drizzle-orm";
import { db, users, shippingRates, shippingZones } from "@workspace/db";
import { resolveShippingForDestination, type ShippingZoneRow } from "./shippingZones";

export type PublicSellerShipping = {
  /** Domestic shipping charge in cents before any free-shipping threshold; null when it depends on weight. */
  rateCents: number | null;
  /** Subtotal (cents) at which shipping becomes free; null = never. */
  freeAboveCents: number | null;
  /** Business days before the seller ships, from their domestic zone; null when not set. */
  processingDays: number | null;
};

export type PublicProductTrust = {
  sellerReturnPolicy: string | null;
  sellerCancellationPolicy: string | null;
  sellerShipping: PublicSellerShipping | null;
};

type LegacyRate = { flatRateCents: number; freeAboveCents: number | null; active: boolean };

function cleanPolicy(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, 4000) : null;
}

export function toPublicSellerPolicies(seller: { returnPolicy?: string | null; cancellationPolicy?: string | null } | null | undefined) {
  return {
    sellerReturnPolicy: cleanPolicy(seller?.returnPolicy),
    sellerCancellationPolicy: cleanPolicy(seller?.cancellationPolicy),
  };
}

function nonNegativeInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/**
 * Mirrors how checkout prices shipping (routes/buyer.ts): the seller's
 * shipping zones win, the legacy single flat rate is the fallback. The
 * product page shows the domestic case (destination = seller's home
 * country). Returns null when the seller has neither, so no line shows.
 */
export function summarizeSellerShipping(input: {
  zones: ShippingZoneRow[];
  legacyRate: LegacyRate | null | undefined;
  sellerHomeCountry: string;
}): PublicSellerShipping | null {
  const activeZones = input.zones.filter((z) => z.active);
  if (activeZones.length > 0) {
    const resolved = resolveShippingForDestination({
      zones: activeZones,
      weightTiers: [],
      destinationCountry: input.sellerHomeCountry,
      sellerHomeCountry: input.sellerHomeCountry,
      subtotalCents: 0,
      weightGrams: 0,
    });
    if (resolved.unavailable || !resolved.zoneId) return null;
    const zone = activeZones.find((z) => z.id === resolved.zoneId)!;
    return {
      rateCents: zone.pricingModel === "flat" ? nonNegativeInt(zone.flatRateCents) : null,
      freeAboveCents: nonNegativeInt(zone.freeAboveCents),
      processingDays: nonNegativeInt(zone.processingDays),
    };
  }
  const rate = input.legacyRate;
  if (rate && rate.active) {
    return {
      rateCents: nonNegativeInt(rate.flatRateCents),
      freeAboveCents: nonNegativeInt(rate.freeAboveCents),
      processingDays: null,
    };
  }
  return null;
}

/** Loads the seller's policies + shipping summary for the public product response. */
export async function loadPublicProductTrust(sellerId: string): Promise<PublicProductTrust> {
  const [[seller], zones, [legacyRate]] = await Promise.all([
    db.select({
      returnPolicy: users.returnPolicy,
      cancellationPolicy: users.cancellationPolicy,
      sellerShipFromCountry: users.sellerShipFromCountry,
    }).from(users).where(eq(users.clerkId, sellerId)).limit(1),
    db.select().from(shippingZones).where(and(eq(shippingZones.sellerId, sellerId), eq(shippingZones.active, true))),
    db.select({ flatRateCents: shippingRates.flatRateCents, freeAboveCents: shippingRates.freeAboveCents, active: shippingRates.active })
      .from(shippingRates).where(and(eq(shippingRates.sellerId, sellerId), eq(shippingRates.active, true))).limit(1),
  ]);
  return {
    ...toPublicSellerPolicies(seller),
    sellerShipping: summarizeSellerShipping({
      zones: zones as unknown as ShippingZoneRow[],
      legacyRate: legacyRate ?? null,
      sellerHomeCountry: seller?.sellerShipFromCountry ?? "US",
    }),
  };
}
