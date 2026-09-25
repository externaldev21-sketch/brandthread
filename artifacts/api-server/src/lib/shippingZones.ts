/**
 * Worldwide shipping zone resolution.
 *
 * Pure function: given a seller's configured zones (+ weight tiers) and a
 * destination country + cart weight/subtotal, decides which zone applies and
 * what the shipping cost is, in cents. No DB or network access here so it is
 * trivially unit-testable; callers (the shipping-zones route's preview
 * endpoint, and guest-checkout.ts) fetch the rows and pass them in.
 *
 * Zone match order:
 *   1. 'domestic'      — countries includes destination, or (if empty) destination === sellerHomeCountry
 *   2. 'country'       — countries includes destination
 *   3. 'rest_of_world' — always matches as the final catch-all
 * The first active zone (in sortOrder) matching in that order wins. A
 * 'rest_of_world' or 'country' zone with shipsInternationally = false is
 * skipped for a non-domestic destination, which can result in no zone
 * matching (the seller does not ship there).
 */

export type ShippingZoneRow = {
  id: string;
  name: string;
  zoneType: string; // 'domestic' | 'country' | 'rest_of_world'
  countries: string[];
  pricingModel: string; // 'flat' | 'weight_tiered'
  flatRateCents: number;
  freeAboveCents: number | null;
  processingDays: number;
  carrierLabel: string | null;
  shipsInternationally: boolean;
  dutiesHandling: string;
  active: boolean;
  sortOrder: number;
};

export type ShippingZoneWeightTierRow = {
  zoneId: string;
  minWeightGrams: number;
  maxWeightGrams: number | null;
  rateCents: number;
  sortOrder: number;
};

export type ResolvedShipping = {
  zoneId: string | null;
  shippingCents: number;
  isFree: boolean;
  zoneName: string | null;
  processingDays: number | null;
  carrierLabel: string | null;
  dutiesHandling: string | null;
  /** True when the seller has no zone that covers this destination at all. */
  unavailable: boolean;
};

function zoneMatches(zone: ShippingZoneRow, destinationCountry: string, sellerHomeCountry: string): boolean {
  const dest = destinationCountry.toUpperCase();
  const isDomesticDestination = dest === sellerHomeCountry.toUpperCase();
  if (zone.zoneType === 'domestic') {
    return zone.countries.length > 0
      ? zone.countries.map((c) => c.toUpperCase()).includes(dest)
      : isDomesticDestination;
  }
  if (!isDomesticDestination && !zone.shipsInternationally) return false;
  if (zone.zoneType === 'country') {
    return zone.countries.map((c) => c.toUpperCase()).includes(dest);
  }
  if (zone.zoneType === 'rest_of_world') return true;
  return false;
}

function rateForZone(zone: ShippingZoneRow, weightTiers: ShippingZoneWeightTierRow[], weightGrams: number): number {
  if (zone.pricingModel !== 'weight_tiered') return zone.flatRateCents;
  const tiers = weightTiers
    .filter((t) => t.zoneId === zone.id)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.minWeightGrams - b.minWeightGrams);
  const tier = tiers.find((t) => weightGrams >= t.minWeightGrams && (t.maxWeightGrams == null || weightGrams <= t.maxWeightGrams));
  // Weight above every configured tier falls back to the highest tier's rate
  // rather than silently charging nothing.
  return tier ? tier.rateCents : (tiers.length ? tiers[tiers.length - 1].rateCents : zone.flatRateCents);
}

export function resolveShippingForDestination(input: {
  zones: ShippingZoneRow[];
  weightTiers: ShippingZoneWeightTierRow[];
  destinationCountry: string;
  sellerHomeCountry: string;
  subtotalCents: number;
  weightGrams: number;
}): ResolvedShipping {
  const { destinationCountry, sellerHomeCountry, subtotalCents, weightGrams } = input;
  const candidates = input.zones
    .filter((z) => z.active)
    .filter((z) => zoneMatches(z, destinationCountry, sellerHomeCountry))
    .sort((a, b) => {
      // Prefer the more specific zone type when more than one matches
      // (e.g. a seller with both a 'domestic' and an overlapping 'country'
      // zone for their own country): domestic > country > rest_of_world.
      const rank = (t: string) => (t === 'domestic' ? 0 : t === 'country' ? 1 : 2);
      return rank(a.zoneType) - rank(b.zoneType) || a.sortOrder - b.sortOrder;
    });
  const zone = candidates[0];
  if (!zone) {
    return {
      zoneId: null, shippingCents: 0, isFree: false, zoneName: null,
      processingDays: null, carrierLabel: null, dutiesHandling: null, unavailable: true,
    };
  }
  const rate = rateForZone(zone, input.weightTiers, weightGrams);
  const isFree = zone.freeAboveCents != null && subtotalCents >= zone.freeAboveCents;
  return {
    zoneId: zone.id,
    shippingCents: isFree ? 0 : rate,
    isFree: isFree || rate === 0,
    zoneName: zone.name,
    processingDays: zone.processingDays,
    carrierLabel: zone.carrierLabel,
    dutiesHandling: zone.dutiesHandling,
    unavailable: false,
  };
}
