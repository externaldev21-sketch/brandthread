/**
 * Item 108: live carrier rates for international shipping zones.
 *
 * A seller can price an international zone as 'calculated': checkout asks
 * Shippo (the connector already used to buy labels, lib/shippo.ts) for real
 * carrier rates to the buyer's address and charges the cheapest one. The
 * zone's flat rate stays the fallback, used whenever a live quote can't be
 * had: the flag is off, the Shippo connector isn't attached, the seller has
 * no ship-from postal code, the cart has no stored weight, or Shippo fails.
 *
 * Off unless SHIPPO_LIVE_RATES_ENABLED=true AND the Replit connector proxy is
 * configured. With it off, resolution is exactly resolveShippingForDestination
 * (a 'calculated' zone is priced from its flat rate there).
 *
 * Quotes are cached in memory for 30 minutes per
 * (seller, destination country, postal code, 250 g weight bucket).
 */
import type { ResolvedShipping, ShippingZoneRow } from "../shippingZones";
import { logger } from "../logger";

export const CALCULATED_PRICING_MODEL = "calculated";
export const LIVE_RATE_CACHE_MS = 30 * 60 * 1000;
export const WEIGHT_BUCKET_GRAMS = 250;
/** Box used when the seller has no package preset (inches). */
export const DEFAULT_PARCEL_IN = { length: 12, width: 9, height: 4 };
const GRAMS_PER_LB = 453.59237;

export function shippoConnectorAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.REPLIT_CONNECTORS_HOSTNAME && (env.REPL_IDENTITY || env.WEB_REPL_RENEWAL));
}

export function liveRatesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SHIPPO_LIVE_RATES_ENABLED === "true" && shippoConnectorAvailable(env);
}

export type LiveRateQuote = { amountCents: number; carrier: string; service: string; estimatedDays: number | null };

export type LiveRateRequest = {
  from: { country: string; postalCode: string };
  to: { country: string; postalCode: string; city?: string; state?: string; street?: string };
  weightGrams: number;
  parcelIn: { length: number; width: number; height: number };
};

/** Asks the carrier for rates; returns the cheapest USD one or null. */
export type LiveRateQuoter = (request: LiveRateRequest) => Promise<LiveRateQuote | null>;

function decimalToCents(amount: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2})\d*)?$/.exec(amount.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** Cheapest USD rate from a Shippo shipment response. */
export function cheapestUsdRate(rates: Array<{ amount: string; currency: string; provider: string; servicelevel?: { name?: string; token?: string }; estimated_days?: number }>): LiveRateQuote | null {
  let best: LiveRateQuote | null = null;
  for (const rate of rates ?? []) {
    if ((rate.currency ?? "").toUpperCase() !== "USD") continue;
    const cents = decimalToCents(String(rate.amount ?? ""));
    if (cents == null || cents <= 0) continue;
    if (!best || cents < best.amountCents) {
      best = {
        amountCents: cents,
        carrier: rate.provider,
        service: rate.servicelevel?.name ?? rate.servicelevel?.token ?? "Shipping",
        estimatedDays: typeof rate.estimated_days === "number" ? rate.estimated_days : null,
      };
    }
  }
  return best;
}

/** The production quoter: Shippo via the Replit connector. */
export const shippoQuoter: LiveRateQuoter = async (request) => {
  const { createShipment } = await import("../shippo");
  const shipment = await createShipment({
    address_from: { country: request.from.country, zip: request.from.postalCode },
    address_to: {
      country: request.to.country,
      zip: request.to.postalCode,
      ...(request.to.city ? { city: request.to.city } : {}),
      ...(request.to.state ? { state: request.to.state } : {}),
      ...(request.to.street ? { street1: request.to.street } : {}),
    },
    parcels: [{
      length: request.parcelIn.length, width: request.parcelIn.width, height: request.parcelIn.height,
      distance_unit: "in",
      weight: Math.max(0.01, Math.round((request.weightGrams / GRAMS_PER_LB) * 100) / 100),
      mass_unit: "lb",
    }],
  });
  return cheapestUsdRate(shipment.rates ?? []);
};

type CacheEntry = { quote: LiveRateQuote | null; expiresAt: number };
const cache = new Map<string, CacheEntry>();

export function resetLiveRateCacheForTests(): void {
  cache.clear();
}

export function weightBucket(weightGrams: number): number {
  return Math.max(1, Math.ceil(weightGrams / WEIGHT_BUCKET_GRAMS)) * WEIGHT_BUCKET_GRAMS;
}

export function liveRateCacheKey(sellerId: string, country: string, postalCode: string, weightGrams: number): string {
  return [sellerId, country.toUpperCase(), postalCode.replace(/\s+/g, "").toUpperCase(), weightBucket(weightGrams)].join("|");
}

export type LiveRateContext = {
  sellerId: string;
  zones: ShippingZoneRow[];
  shipFrom: { country: string; postalCode: string | null };
  destination: { country: string; postalCode: string | null; city?: string; state?: string; street?: string };
  weightGrams: number;
  subtotalCents: number;
  parcelIn?: { length: number; width: number; height: number } | null;
  env?: NodeJS.ProcessEnv;
  quoter?: LiveRateQuoter;
  now?: () => number;
};

export type LiveRateResolution = ResolvedShipping & {
  /** 'live' when the amount is a carrier quote; 'fallback' when a calculated zone used its flat rate. */
  rateSource?: "live" | "fallback";
};

/**
 * Applies a live carrier quote to an already-resolved zone. Returns the input
 * object untouched unless the zone is 'calculated', the flag is on and a
 * quote was obtained. Never throws: any failure keeps the flat-rate result.
 */
export async function withLiveCarrierRate(resolved: ResolvedShipping, ctx: LiveRateContext): Promise<LiveRateResolution> {
  if (resolved.unavailable || !resolved.zoneId) return resolved;
  const zone = ctx.zones.find((z) => z.id === resolved.zoneId);
  if (!zone || zone.pricingModel !== CALCULATED_PRICING_MODEL) return resolved;
  const env = ctx.env ?? process.env;
  if (!liveRatesEnabled(env)) return resolved;
  // Free-shipping threshold still wins over a live quote.
  if (zone.freeAboveCents != null && ctx.subtotalCents >= zone.freeAboveCents) return resolved;
  const postal = ctx.destination.postalCode?.trim();
  const fromPostal = ctx.shipFrom.postalCode?.trim();
  if (!postal || !fromPostal || ctx.weightGrams <= 0) return { ...resolved, rateSource: "fallback" };

  const key = liveRateCacheKey(ctx.sellerId, ctx.destination.country, postal, ctx.weightGrams);
  const now = (ctx.now ?? Date.now)();
  let entry = cache.get(key);
  if (!entry || entry.expiresAt <= now) {
    let quote: LiveRateQuote | null = null;
    try {
      quote = await (ctx.quoter ?? shippoQuoter)({
        from: { country: ctx.shipFrom.country.toUpperCase(), postalCode: fromPostal },
        to: {
          country: ctx.destination.country.toUpperCase(), postalCode: postal,
          city: ctx.destination.city, state: ctx.destination.state, street: ctx.destination.street,
        },
        // Quote the top of the bucket so every cart sharing this cache entry is covered.
        weightGrams: weightBucket(ctx.weightGrams),
        parcelIn: ctx.parcelIn ?? DEFAULT_PARCEL_IN,
      });
    } catch (err) {
      logger.warn({ err, sellerId: ctx.sellerId, country: ctx.destination.country }, "Live carrier rate failed; using the zone's flat rate");
      // Failures are not cached, so the next checkout tries again.
      return { ...resolved, rateSource: "fallback" };
    }
    entry = { quote, expiresAt: now + LIVE_RATE_CACHE_MS };
    cache.set(key, entry);
  }
  if (!entry.quote) return { ...resolved, rateSource: "fallback" };
  return {
    ...resolved,
    shippingCents: entry.quote.amountCents,
    isFree: false,
    carrierLabel: resolved.carrierLabel ?? `${entry.quote.carrier} ${entry.quote.service}`.trim(),
    rateSource: "live",
  };
}

/**
 * The seller's ship-from postal code and first package preset (as the
 * parcel box). Only read when the flag is on and a 'calculated' zone
 * matched, so the flag-off path makes no extra queries.
 */
export async function loadSellerOrigin(sellerId: string): Promise<{
  postalCode: string | null;
  parcelIn: { length: number; width: number; height: number } | null;
}> {
  const { db, users, sellerPackagePresets } = await import("@workspace/db");
  const { asc, eq } = await import("drizzle-orm");
  const [seller] = await db.select({ postal: users.sellerShipFromPostalCode }).from(users)
    .where(eq(users.clerkId, sellerId)).limit(1);
  const [preset] = await db.select().from(sellerPackagePresets)
    .where(eq(sellerPackagePresets.ownerId, sellerId)).orderBy(asc(sellerPackagePresets.createdAt)).limit(1);
  const parcelIn = preset
    ? { length: Number(preset.lengthIn), width: Number(preset.widthIn), height: Number(preset.heightIn) }
    : null;
  return {
    postalCode: seller?.postal ?? null,
    parcelIn: parcelIn && parcelIn.length > 0 && parcelIn.width > 0 && parcelIn.height > 0 ? parcelIn : null,
  };
}

/**
 * One call for checkout routes: resolve the zone (pure), then apply a live
 * quote when it is a 'calculated' zone and the flag is on.
 */
export async function resolveWithLiveRates(
  resolved: ResolvedShipping,
  input: Omit<LiveRateContext, "shipFrom" | "parcelIn"> & { shipFromCountry: string },
): Promise<LiveRateResolution> {
  const zone = input.zones.find((z) => z.id === resolved.zoneId);
  if (!zone || zone.pricingModel !== CALCULATED_PRICING_MODEL || !liveRatesEnabled(input.env ?? process.env)) return resolved;
  let origin: Awaited<ReturnType<typeof loadSellerOrigin>> = { postalCode: null, parcelIn: null };
  try {
    origin = await loadSellerOrigin(input.sellerId);
  } catch (err) {
    logger.warn({ err, sellerId: input.sellerId }, "Could not load seller origin for a live rate");
  }
  return withLiveCarrierRate(resolved, {
    ...input,
    shipFrom: { country: input.shipFromCountry, postalCode: origin.postalCode },
    parcelIn: origin.parcelIn,
  });
}
