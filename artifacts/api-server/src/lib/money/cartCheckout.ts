/**
 * One-page checkout: pricing one seller group of the cart, server-side.
 *
 * Everything here mirrors POST /api/buyer/checkout/session (routes/buyer.ts):
 *  - prices come from the database;
 *  - it checks the seller's Connect account and vacation;
 *  - shipping comes from the seller's zones, else the legacy flat rate;
 *  - the discount code is validated fresh.
 * The difference is that the result feeds a line of ONE cart-wide
 * PaymentIntent instead of a Stripe Checkout Session. Tax comes from Stripe
 * Tax, calculated on the seller's own connected account, so the seller stays
 * the liable party, as with the hosted flow's liability setting.
 *
 * Also supported here (BT-257/258/270):
 *  - preorder drops: the group keeps its "held" charge plan, so the order is
 *    held on Brandthread's balance until it ships, as on hosted Checkout;
 *  - loyalty points (one store, like hosted) and Thread Cash (split across
 *    every store, see allocateThreadCash);
 *  - guest checkout (no account: the discount customer key is
 *    "guest:<email>", the same key the order webhook records).
 * The route still answers 409 USE_HOSTED_CHECKOUT when Stripe Tax can't
 * price a group, and the app falls back to hosted Checkout.
 *
 * PCI: card data never reaches this server. The app collects it only in
 * Stripe's own fields (CardField / Payment Element), and
 * `findCardDataInRequest` rejects any request body that carries a card
 * number or CVC, so a buggy client can't leak one into our logs or database.
 */
import { and, eq, isNull } from "drizzle-orm";
import { notifySellerCheckoutBlocked } from "../sellerLifecycle/checkoutBlocked";
import type Stripe from "stripe";
import {
  db, productVariants, products, shippingRates, shippingZones, shippingZoneWeightTiers, users,
} from "@workspace/db";
import { flatRateShipping } from "../defaultShipping";
import { resolveShippingForDestination, type ShippingZoneRow, type ShippingZoneWeightTierRow } from "../shippingZones";
import { sellerScopeRefusesDestination } from "../sellerAccountScope";
import { loadSellerTaxSwitches } from "../sellerTaxSwitches";
import { getSellerVacationStatus } from "../sellerAvailability";
import { productsBeyondSellerPlan, SELLER_PLAN_LIMIT_CODE, SELLER_PLAN_LIMIT_MESSAGE } from "../planGate";
import { validateDiscountCode, DiscountValidationError } from "../discounts";
import { effectiveUnitPrice } from "../pricing/salesRuntime";
import { CheckoutPlanError, resolveChargePlan, type ChargePlan } from "./checkoutPlan";
import { destinationApplicationFeeCents } from "./fees";
import { resolveSellerPlatformFeeBps } from "../planPerks";
import { BundlePricingError, linesAfterBundles, type AppliedBundle } from "./bundlePricing";
import { priceGroupBundles } from "./bundleLoader";

import { CartCheckoutError, taxableAmounts } from "./cartMath";

export {
  CartCheckoutError, MIN_CARD_CHARGE_CENTS, allocateThreadCash, groupPreTaxRemainingCents, planCartRewards,
  spreadDiscount, taxableAmounts, threadCashGroupCeilingCents, type CartRewardPlan,
} from "./cartMath";
import { emptyMysteryBoxVariants } from "../mysteryBox";
import { resolveWithLiveRates } from "../intl/liveShippingRates";
import { DutiesUnavailableError, dutiesForGroup } from "../intl/duties";
import { resolveAuctionLinePrice } from "../liveAuctions";

export const CART_CHECKOUT_KIND = "cart_checkout";
/** Sellers in one cart payment (bounded by what the order pipeline handles per webhook). */
export const MAX_CART_GROUPS = 10;

// ─── Card data guard (PCI SAQ-A) ─────────────────────────────────────────────

const CARD_KEY_PATTERN = /^(card[_-]?number|cardnumber|pan|cvc|cvv|cvv2|cvc2|security[_-]?code|exp[_-]?(month|year|date)|expiry([_-]?(month|year|date))?)$/i;

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** A Luhn-valid 13–19 digit run (spaces/dashes allowed between digits), i.e. something shaped like a card number. */
export function containsCardNumber(value: string): boolean {
  const candidates = value.match(/\d[\d -]{11,22}\d/g) ?? [];
  return candidates.some((candidate) => {
    const digits = candidate.replace(/[ -]/g, "");
    return digits.length >= 13 && digits.length <= 19 && luhnValid(digits);
  });
}

/**
 * Path of the first card-looking field in a request body, or null. Never
 * returns the value itself, so callers can log the path safely.
 */
export function findCardDataInRequest(body: unknown, path = "body", depth = 0): string | null {
  if (depth > 8 || body == null) return null;
  if (typeof body === "string") {
    // Ids (UUIDs) can hold long digit runs; they are never card numbers.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body)) return null;
    return containsCardNumber(body) ? path : null;
  }
  if (typeof body === "number") return containsCardNumber(String(body)) ? path : null;
  if (Array.isArray(body)) {
    for (let i = 0; i < body.length; i++) {
      const hit = findCardDataInRequest(body[i], `${path}[${i}]`, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof body === "object") {
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (CARD_KEY_PATTERN.test(key) && value != null && value !== "") return `${path}.${key}`;
      const hit = findCardDataInRequest(value, `${path}.${key}`, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

// ─── Pricing one seller group ────────────────────────────────────────────────

export type CartShipping = {
  name: string;
  street: string;
  line2: string | null;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string;
};

export type PricedGroup = {
  sellerId: string;
  sellerStripeAccountId: string;
  items: Array<{
    variantId: string; productId: string; productName: string; variantLabel: string; quantity: number; priceCents: number;
    /** The bundle this line counted toward (null when none). */
    bundleId: string | null;
    /** This line's share of the bundle savings. */
    bundleDiscountCents: number;
  }>;
  /** Full price of the lines (before bundle savings and promo). */
  subtotalCents: number;
  /** Bundle savings (lib/money/bundlePricing.ts), taken off before the promo code. */
  bundleDiscountCents: number;
  bundleLines: AppliedBundle[];
  shippingCents: number;
  shippingLineName: string;
  /** Business days before the seller ships (their zone's processing time), when known. */
  processingDays: number | null;
  discountCodeId: string | null;
  discountCode: string | null;
  /** Promo on merchandise + any free-shipping part, as the hosted flow computes it. */
  discountCents: number;
  /** Merchandise-only part of the promo (for spreading across tax lines; bundle savings are separate). */
  merchandiseDiscountCents: number;
  shippingDiscountCents: number;
  platformFeeCents: number;
  /** Commission rate (bps) fixed for this checkout from the seller's plan. */
  platformFeeBps: number;
  processingFeeEstimateCents: number;
  /** "held" for a preorder drop (paid out per order when it ships), else "destination". */
  chargePlan: ChargePlan;
  /**
   * Intl #109: duties & import taxes for a DDP zone (0 unless
   * DUTIES_AT_CHECKOUT_ENABLED). Charged on top of the total and passed
   * through to the seller, like shipping.
   */
  dutiesCents: number;
  dutiesQuoteId: string | null;
};

export async function priceCartGroup(input: {
  /** Null for a guest. Used for drop early access. */
  buyerId: string | null;
  /** Who the discount code's per-customer limits count against (the buyer id, or "guest:<email>"). */
  customerKey?: string;
  items: Array<{ variantId: string; productId: string; quantity: number; bundleId?: string | null; auctionId?: string }>;
  discountCode?: string | null;
  /** Live stream the buyer is shopping from (live-only discount codes). */
  liveStreamId?: string | null;
  shipping: CartShipping;
  /** Pricing a draw entry: the draw is the one way to buy while it's open. */
  viaDraw?: boolean;
}): Promise<PricedGroup> {
  const seen = new Set<string>();
  const items: PricedGroup["items"] = [];
  const discountLines: Array<{ productId: string; priceCents: number; quantity: number }> = [];
  let sellerId: string | null = null;
  let weightGrams = 0;
  for (const item of input.items) {
    if (seen.has(item.variantId)) {
      throw new CartCheckoutError(400, "DUPLICATE_VARIANT", "Merge quantities of the same item before checkout.");
    }
    seen.add(item.variantId);
    const [row] = await db.select({
      variantId: productVariants.id,
      priceCents: productVariants.priceCents,
      compareAtPriceCents: productVariants.compareAtPriceCents,
      stock: productVariants.stock,
      size: productVariants.size,
      color: productVariants.color,
      productName: products.name,
      sellerId: products.ownerId,
      status: products.status,
      weightGrams: productVariants.weightGrams,
    }).from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(and(eq(productVariants.id, item.variantId), eq(products.id, item.productId), isNull(products.deletedAt)))
      .limit(1);
    if (!row) throw new CartCheckoutError(404, "ITEM_NOT_FOUND", "An item in your bag is no longer available.");
    if (row.status !== "active") throw new CartCheckoutError(400, "ITEM_UNAVAILABLE", `${row.productName} is no longer available.`);
    if (row.stock < item.quantity) {
      throw new CartCheckoutError(409, "SOLD_OUT", `${row.productName} just sold out`, { variantId: row.variantId, productName: row.productName });
    }
    if ((await emptyMysteryBoxVariants(db, [row.variantId])).length > 0) {
      throw new CartCheckoutError(409, "MYSTERY_BOX_EMPTY", `${row.productName} is sold out.`, { variantId: row.variantId });
    }
    if (sellerId && row.sellerId !== sellerId) {
      throw new CartCheckoutError(400, "MIXED_SELLER_GROUP", "Each group must hold one seller's items.");
    }
    sellerId = row.sellerId;
    const variantLabel = [row.size, row.color].filter(Boolean).join(" / ");
    // Automatic sale (lib/pricing/sales.ts): the sale price is the authoritative
    // charge, and discount codes apply on top of it.
    // A live-auction win is charged the winning price; a piece held by an
    // auction can't be bought any other way (throws AuctionError).
    const auctionPrice = await resolveAuctionLinePrice({
      buyerId: input.buyerId, productId: item.productId, variantId: item.variantId, quantity: item.quantity, auctionId: item.auctionId ?? null,
    });
    const unitCents = auctionPrice ? auctionPrice.priceCents : (await effectiveUnitPrice({
      productId: item.productId, sellerId: row.sellerId, priceCents: row.priceCents, compareAtPriceCents: row.compareAtPriceCents,
    })).priceCents;
    items.push({
      variantId: row.variantId, productId: item.productId, productName: row.productName, variantLabel,
      quantity: item.quantity, priceCents: unitCents, bundleId: null, bundleDiscountCents: 0,
    });
    discountLines.push({ productId: item.productId, priceCents: unitCents, quantity: item.quantity });
    weightGrams += (row.weightGrams ?? 0) * item.quantity;
  }
  if (!sellerId) throw new CartCheckoutError(400, "EMPTY_GROUP", "A seller group has no items.");

  const vacation = await getSellerVacationStatus(sellerId);
  if (vacation.active) throw new CartCheckoutError(409, "SELLER_ON_VACATION", vacation.message);
  if ((await productsBeyondSellerPlan(sellerId, items.map((i) => i.productId))).length > 0) {
    throw new CartCheckoutError(409, SELLER_PLAN_LIMIT_CODE, SELLER_PLAN_LIMIT_MESSAGE);
  }

  const [seller] = await db.select({
    stripeAccountId: users.stripeAccountId,
    stripeAccountStatus: users.stripeAccountStatus,
    shipFrom: users.sellerShipFromCountry,
    shipFromPostal: users.sellerShipFromPostalCode,
  }).from(users).where(eq(users.clerkId, sellerId)).limit(1);
  if (!seller?.stripeAccountId || seller.stripeAccountStatus !== "active") {
    void notifySellerCheckoutBlocked(sellerId); // once a day: "A buyer couldn't pay you"
    throw new CartCheckoutError(400, "SELLER_PAYMENTS_UNAVAILABLE", "This seller can't accept payments right now.");
  }

  // A preorder drop keeps its held charge plan (decided from the products,
  // never the client); the route stores it on this group's checkout row.
  let chargePlan: ChargePlan;
  try {
    chargePlan = await resolveChargePlan({ productIds: items.map((i) => i.productId), sellerId, buyerId: input.buyerId, clientDropId: null, viaDraw: input.viaDraw });
  } catch (error) {
    if (error instanceof CheckoutPlanError) throw new CartCheckoutError(error.status, error.code, error.message);
    throw error;
  }

  const subtotalCents = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);

  // Bundles first (the buyer pays the bundle price), then the promo code on
  // what is left. Tax is charged on each line's discounted amount.
  let bundles;
  try {
    bundles = await priceGroupBundles({
      sellerId,
      lines: input.items.map((item, index) => ({
        variantId: items[index].variantId, productId: item.productId, quantity: item.quantity,
        priceCents: items[index].priceCents, bundleId: item.bundleId ?? null,
      })),
    });
  } catch (error) {
    if (error instanceof BundlePricingError) throw new CartCheckoutError(400, error.code, error.message, error.details);
    throw error;
  }
  items.forEach((item, index) => {
    item.bundleId = bundles.lineBundleId[index];
    item.bundleDiscountCents = bundles.lineDiscountCents[index];
  });
  const bundleDiscountCents = bundles.bundleDiscountCents;
  const afterBundlesCents = subtotalCents - bundleDiscountCents;

  let shippingCents = 0;
  let shippingLineName = "Shipping";
  let processingDays: number | null = null;
  let dutiesHandling: string | null = null;
  // Account reach "United States only" (lib/sellerAccountScope.ts).
  if (await sellerScopeRefusesDestination(sellerId, input.shipping.country)) {
    throw new CartCheckoutError(400, "NO_SHIPPING_TO_DESTINATION", "This seller doesn't ship to that address.");
  }
  const zones = await db.select().from(shippingZones)
    .where(and(eq(shippingZones.sellerId, sellerId), eq(shippingZones.active, true)));
  if (zones.length > 0) {
    const tiers: ShippingZoneWeightTierRow[] = [];
    for (const zone of zones) {
      if (zone.pricingModel !== "weight_tiered") continue;
      tiers.push(...await db.select().from(shippingZoneWeightTiers).where(eq(shippingZoneWeightTiers.zoneId, zone.id)));
    }
    // Intl #108: a 'calculated' zone takes a live carrier quote when
    // SHIPPO_LIVE_RATES_ENABLED; otherwise (and on any failure) its flat rate.
    const resolved = await resolveWithLiveRates(resolveShippingForDestination({
      zones: zones as unknown as ShippingZoneRow[],
      weightTiers: tiers,
      destinationCountry: input.shipping.country,
      sellerHomeCountry: seller.shipFrom ?? "US",
      subtotalCents: afterBundlesCents,
      weightGrams,
    }), {
      sellerId, zones: zones as unknown as ShippingZoneRow[], shipFromCountry: seller.shipFrom ?? "US",
      destination: { country: input.shipping.country, postalCode: input.shipping.zip, city: input.shipping.city, state: input.shipping.state, street: input.shipping.street },
      weightGrams, subtotalCents,
    });
    if (resolved.unavailable) {
      throw new CartCheckoutError(400, "NO_SHIPPING_TO_DESTINATION", "This seller doesn't ship to that address.");
    }
    shippingCents = resolved.shippingCents;
    shippingLineName = resolved.zoneName ? `Shipping (${resolved.zoneName})` : "Shipping";
    dutiesHandling = resolved.dutiesHandling;
    const zone = zones.find((z) => z.name === resolved.zoneName) ?? zones.find((z) => z.zoneType === "domestic") ?? zones[0];
    processingDays = zone?.processingDays ?? null;
  } else {
    const [rate] = await db.select().from(shippingRates)
      .where(and(eq(shippingRates.sellerId, sellerId), eq(shippingRates.active, true))).limit(1);
    ({ cents: shippingCents, name: shippingLineName } = flatRateShipping(rate, afterBundlesCents)); // Preserve bundle-aware thresholds and the standard default rate.
  }

  let discount: Awaited<ReturnType<typeof validateDiscountCode>> | null = null;
  if (input.discountCode?.trim()) {
    try {
      discount = await validateDiscountCode({
        sellerId, code: input.discountCode, customerKey: input.customerKey ?? input.buyerId ?? "", cartSubtotalCents: afterBundlesCents,
        lines: linesAfterBundles(discountLines, bundles.lineDiscountCents),
        liveStreamId: input.liveStreamId ?? null,
      });
    } catch (error) {
      if (error instanceof DiscountValidationError) {
        throw new CartCheckoutError(400, error.code, error.message, error.details ?? {});
      }
      throw error;
    }
  }
  const shippingDiscountCents = discount?.freeShipping ? shippingCents : 0;
  const discountCents = discount
    ? Math.min(discount.appliedAmountCents + shippingDiscountCents, afterBundlesCents + shippingCents)
    : 0;
  const merchandiseDiscountCents = Math.max(0, Math.min(afterBundlesCents, discountCents - shippingDiscountCents));

  // Intl #109: DDP duties (zero unless DUTIES_AT_CHECKOUT_ENABLED and the zone is DDP).
  let duties = { dutiesCents: 0, quoteId: null as string | null };
  try {
    duties = await dutiesForGroup({
      dutiesHandling,
      shipFromCountry: seller.shipFrom ?? "US",
      request: {
        origin: { country: seller.shipFrom ?? "US", postalCode: seller.shipFromPostal ?? null },
        destination: { country: input.shipping.country, postalCode: input.shipping.zip, city: input.shipping.city, state: input.shipping.state, street: input.shipping.street },
        items: items.map((item) => ({ productId: item.productId, name: item.productName, unitPriceCents: item.priceCents, quantity: item.quantity })),
        shippingCents,
      },
    });
  } catch (error) {
    if (error instanceof DutiesUnavailableError) {
      throw new CartCheckoutError(409, "DUTIES_UNAVAILABLE", "Import duties couldn't be calculated for this address. Try again in a moment.");
    }
    throw error;
  }

  const platformFeeBps = await resolveSellerPlatformFeeBps(sellerId);
  const fee = destinationApplicationFeeCents({
    merchandiseCents: Math.max(0, afterBundlesCents - discountCents),
    shippingCents,
    preTaxTotalCents: Math.max(0, afterBundlesCents + shippingCents - discountCents),
    platformFeeBps,
  });

  return {
    sellerId,
    sellerStripeAccountId: seller.stripeAccountId,
    items,
    subtotalCents,
    bundleDiscountCents,
    bundleLines: bundles.applied,
    shippingCents,
    shippingLineName,
    processingDays,
    discountCodeId: discount?.discount.id ?? null,
    discountCode: discount?.discount.code ?? null,
    discountCents,
    merchandiseDiscountCents,
    shippingDiscountCents,
    platformFeeCents: fee.platformFeeCents,
    platformFeeBps,
    processingFeeEstimateCents: fee.processingFeeEstimateCents,
    chargePlan,
    dutiesCents: duties.dutiesCents,
    dutiesQuoteId: duties.quoteId,
  };
}

/**
 * What one seller group charges: subtotal + shipping − discount + sales tax
 * + DDP duties (intl #109; 0 for every other checkout, so the total is
 * exactly what it was before duties existed).
 */
export function groupChargeTotalCents(group: {
  subtotalCents: number; shippingCents: number; discountCents: number; taxCents: number; dutiesCents?: number;
}): number {
  return group.subtotalCents + group.shippingCents - group.discountCents + group.taxCents + (group.dutiesCents ?? 0);
}

/** Spreads a discount across line amounts in proportion, exact to the cent (the last line takes the remainder). */
/**
 * Stripe Tax for one seller group, on the seller's connected account (their
 * registrations, their liability). Throws CartCheckoutError TAX_UNAVAILABLE
 * when Stripe Tax can't calculate for this seller; the app then uses hosted
 * Checkout instead of charging without tax.
 */
export async function calculateGroupTax(
  stripeClient: Pick<Stripe, "tax">,
  group: PricedGroup,
  shipping: CartShipping,
  /** Loyalty + Thread Cash on this group: they lower the taxable amount, as on hosted Checkout. */
  rewardDiscountCents = 0,
): Promise<{ taxCents: number; calculationId: string | null }> {
  // Taxes & duties: no tax when the seller turned automatic tax off, and no
  // tax on shipping when they turned that off (lib/sellerTaxSwitches.ts).
  const switches = await loadSellerTaxSwitches(group.sellerId);
  if (!switches.automaticTax) return { taxCents: 0, calculationId: null };
  const taxable = taxableAmounts(group, rewardDiscountCents);
  const lineAmounts = taxable.lineAmounts;
  const taxableShipping = switches.shippingTax ? taxable.shippingCents : 0;
  if (lineAmounts.every((amount) => amount <= 0) && taxableShipping <= 0) return { taxCents: 0, calculationId: null };
  try {
    const calculation = await stripeClient.tax.calculations.create({
      currency: "usd",
      customer_details: {
        // A quote may have only city/state/ZIP (wallet sheets share no
        // street until the buyer pays); Stripe Tax needs just ZIP + country
        // in the US, so empty parts are left out rather than sent blank.
        address: {
          ...(shipping.street ? { line1: shipping.street } : {}),
          ...(shipping.line2 ? { line2: shipping.line2 } : {}),
          ...(shipping.city ? { city: shipping.city } : {}),
          ...(shipping.state ? { state: shipping.state } : {}),
          postal_code: shipping.zip,
          country: shipping.country,
        },
        address_source: "shipping",
      },
      line_items: group.items.map((item, index) => ({
        amount: Math.max(0, lineAmounts[index]),
        quantity: item.quantity,
        reference: item.variantId,
        tax_behavior: "exclusive",
      })),
      ...(taxableShipping > 0 ? { shipping_cost: { amount: taxableShipping, tax_behavior: "exclusive" as const } } : {}),
    }, { stripeAccount: group.sellerStripeAccountId });
    return { taxCents: Math.max(0, calculation.tax_amount_exclusive ?? 0), calculationId: calculation.id ?? null };
  } catch {
    throw new CartCheckoutError(409, "USE_HOSTED_CHECKOUT", "Tax couldn't be calculated for this seller here.", { reason: "tax_unavailable" });
  }
}
