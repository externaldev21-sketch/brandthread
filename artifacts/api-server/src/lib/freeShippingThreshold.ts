/**
 * A seller's free-shipping threshold, for the bag's "Spend $X more for free
 * shipping" strip.
 *
 * Pure: callers fetch the rows. Mirrors priceCartGroup (lib/money/cartCheckout.ts)
 * for the buyer's most likely destination, the seller's own country:
 *   - the seller has active zones → the zone resolveShippingForDestination
 *     picks for a domestic address, and that zone's freeAboveCents;
 *   - no active zones → the legacy active shipping rate's freeAboveCents.
 * null when there is no threshold, or when shipping is already free without
 * one (a $0 flat rate), so the bag never shows a target that changes nothing.
 */
import { resolveShippingForDestination, type ShippingZoneRow } from "./shippingZones";

export type LegacyShippingRateRow = {
  flatRateCents: number;
  freeAboveCents: number | null;
  active: boolean;
};

export function resolveFreeShippingThreshold(input: {
  zones: ShippingZoneRow[];
  legacyRate: LegacyShippingRateRow | null;
  sellerHomeCountry: string;
}): number | null {
  const home = input.sellerHomeCountry || "US";
  const activeZones = input.zones.filter((z) => z.active);
  if (activeZones.length > 0) {
    const resolved = resolveShippingForDestination({
      zones: activeZones,
      weightTiers: [],
      destinationCountry: home,
      sellerHomeCountry: home,
      subtotalCents: 0,
      weightGrams: 0,
    });
    if (resolved.unavailable) return null;
    const zone = activeZones.find((z) => z.id === resolved.zoneId);
    if (!zone) return null;
    if (zone.pricingModel !== "weight_tiered" && zone.flatRateCents <= 0) return null;
    return positiveOrNull(zone.freeAboveCents);
  }
  const rate = input.legacyRate;
  if (!rate || !rate.active || rate.flatRateCents <= 0) return null;
  return positiveOrNull(rate.freeAboveCents);
}

function positiveOrNull(cents: number | null): number | null {
  return typeof cents === "number" && Number.isInteger(cents) && cents > 0 ? cents : null;
}
