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
 * Deliberately NOT supported here, so they keep using hosted Checkout:
 *  - preorder drops (held escrow);
 *  - loyalty points;
 *  - Thread Cash;
 *  - guest checkout.
 * The route answers 409 USE_HOSTED_CHECKOUT and the app falls back.
 *
 * PCI: card data never reaches this server. The app collects it only in
 * Stripe's own fields (CardField / Payment Element), and
 * `findCardDataInRequest` rejects any request body that carries a card
 * number or CVC, so a buggy client can't leak one into our logs or database.
 */
import { and, eq, isNull } from "drizzle-orm";
import type Stripe from "stripe";
import {
  db, productVariants, products, shippingRates, shippingZones, shippingZoneWeightTiers, users,
} from "@workspace/db";
import { resolveShippingForDestination, type ShippingZoneRow, type ShippingZoneWeightTierRow } from "../shippingZones";
import { getSellerVacationStatus } from "../sellerAvailability";
import { validateDiscountCode, DiscountValidationError } from "../discounts";
import { effectiveUnitPrice } from "../pricing/salesRuntime";
import { CheckoutPlanError, resolveChargePlan } from "./checkoutPlan";
import { destinationApplicationFeeCents } from "./fees";

export const CART_CHECKOUT_KIND = "cart_checkout";
/** Stripe's minimum USD card charge. */
export const MIN_CARD_CHARGE_CENTS = 50;
/** Sellers in one cart payment (bounded by what the order pipeline handles per webhook). */
export const MAX_CART_GROUPS = 10;

export class CartCheckoutError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = "CartCheckoutError";
  }
}

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
  items: Array<{ variantId: string; productId: string; productName: string; variantLabel: string; quantity: number; priceCents: number }>;
  subtotalCents: number;
  shippingCents: number;
  shippingLineName: string;
  /** Business days before the seller ships (their zone's processing time), when known. */
  processingDays: number | null;
  discountCodeId: string | null;
  discountCode: string | null;
  /** Promo on merchandise + any free-shipping part, as the hosted flow computes it. */
  discountCents: number;
  /** Merchandise-only part of the promo (for spreading across tax lines). */
  merchandiseDiscountCents: number;
  shippingDiscountCents: number;
  platformFeeCents: number;
  processingFeeEstimateCents: number;
};

export async function priceCartGroup(input: {
  buyerId: string;
  items: Array<{ variantId: string; productId: string; quantity: number }>;
  discountCode?: string | null;
  shipping: CartShipping;
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
      throw new CartCheckoutError(409, "OUT_OF_STOCK", `${row.productName} doesn't have enough stock left.`, { variantId: row.variantId });
    }
    if (sellerId && row.sellerId !== sellerId) {
      throw new CartCheckoutError(400, "MIXED_SELLER_GROUP", "Each group must hold one seller's items.");
    }
    sellerId = row.sellerId;
    const variantLabel = [row.size, row.color].filter(Boolean).join(" / ");
    // Automatic sale (lib/pricing/sales.ts): the sale price is the authoritative
    // charge, and discount codes apply on top of it.
    const unitCents = (await effectiveUnitPrice({
      productId: item.productId, sellerId: row.sellerId, priceCents: row.priceCents, compareAtPriceCents: row.compareAtPriceCents,
    })).priceCents;
    items.push({
      variantId: row.variantId, productId: item.productId, productName: row.productName, variantLabel,
      quantity: item.quantity, priceCents: unitCents,
    });
    discountLines.push({ productId: item.productId, priceCents: unitCents, quantity: item.quantity });
    weightGrams += (row.weightGrams ?? 0) * item.quantity;
  }
  if (!sellerId) throw new CartCheckoutError(400, "EMPTY_GROUP", "A seller group has no items.");

  const vacation = await getSellerVacationStatus(sellerId);
  if (vacation.active) throw new CartCheckoutError(409, "SELLER_ON_VACATION", vacation.message);

  const [seller] = await db.select({
    stripeAccountId: users.stripeAccountId,
    stripeAccountStatus: users.stripeAccountStatus,
    shipFrom: users.sellerShipFromCountry,
  }).from(users).where(eq(users.clerkId, sellerId)).limit(1);
  if (!seller?.stripeAccountId || seller.stripeAccountStatus !== "active") {
    throw new CartCheckoutError(400, "SELLER_PAYMENTS_UNAVAILABLE", "This seller can't accept payments right now.");
  }

  // Preorder drops stay on hosted Checkout (held escrow is its own model).
  try {
    const plan = await resolveChargePlan({ productIds: items.map((i) => i.productId), sellerId, buyerId: input.buyerId, clientDropId: null });
    if (plan.chargeModel !== "destination") {
      throw new CartCheckoutError(409, "USE_HOSTED_CHECKOUT", "Preorders use the secure Stripe checkout page.", { reason: "preorder" });
    }
  } catch (error) {
    if (error instanceof CheckoutPlanError) throw new CartCheckoutError(error.status, error.code, error.message);
    throw error;
  }

  const subtotalCents = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);

  let shippingCents = 0;
  let shippingLineName = "Shipping";
  let processingDays: number | null = null;
  const zones = await db.select().from(shippingZones)
    .where(and(eq(shippingZones.sellerId, sellerId), eq(shippingZones.active, true)));
  if (zones.length > 0) {
    const tiers: ShippingZoneWeightTierRow[] = [];
    for (const zone of zones) {
      if (zone.pricingModel !== "weight_tiered") continue;
      tiers.push(...await db.select().from(shippingZoneWeightTiers).where(eq(shippingZoneWeightTiers.zoneId, zone.id)));
    }
    const resolved = resolveShippingForDestination({
      zones: zones as unknown as ShippingZoneRow[],
      weightTiers: tiers,
      destinationCountry: input.shipping.country,
      sellerHomeCountry: seller.shipFrom ?? "US",
      subtotalCents,
      weightGrams,
    });
    if (resolved.unavailable) {
      throw new CartCheckoutError(400, "NO_SHIPPING_TO_DESTINATION", "This seller doesn't ship to that address.");
    }
    shippingCents = resolved.shippingCents;
    shippingLineName = resolved.zoneName ? `Shipping (${resolved.zoneName})` : "Shipping";
    const zone = zones.find((z) => z.name === resolved.zoneName) ?? zones.find((z) => z.zoneType === "domestic") ?? zones[0];
    processingDays = zone?.processingDays ?? null;
  } else {
    const [rate] = await db.select().from(shippingRates)
      .where(and(eq(shippingRates.sellerId, sellerId), eq(shippingRates.active, true))).limit(1);
    shippingCents = !rate || (rate.freeAboveCents != null && subtotalCents >= rate.freeAboveCents) ? 0 : rate.flatRateCents;
    shippingLineName = rate?.name ?? "Shipping";
  }

  let discount: Awaited<ReturnType<typeof validateDiscountCode>> | null = null;
  if (input.discountCode?.trim()) {
    try {
      discount = await validateDiscountCode({
        sellerId, code: input.discountCode, customerKey: input.buyerId, cartSubtotalCents: subtotalCents, lines: discountLines,
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
    ? Math.min(discount.appliedAmountCents + shippingDiscountCents, subtotalCents + shippingCents)
    : 0;
  const merchandiseDiscountCents = Math.max(0, Math.min(subtotalCents, discountCents - shippingDiscountCents));

  const fee = destinationApplicationFeeCents({
    merchandiseCents: Math.max(0, subtotalCents - discountCents),
    preTaxTotalCents: Math.max(0, subtotalCents + shippingCents - discountCents),
  });

  return {
    sellerId,
    sellerStripeAccountId: seller.stripeAccountId,
    items,
    subtotalCents,
    shippingCents,
    shippingLineName,
    processingDays,
    discountCodeId: discount?.discount.id ?? null,
    discountCode: discount?.discount.code ?? null,
    discountCents,
    merchandiseDiscountCents,
    shippingDiscountCents,
    platformFeeCents: fee.platformFeeCents,
    processingFeeEstimateCents: fee.processingFeeEstimateCents,
  };
}

/** Spreads a discount across line amounts in proportion, exact to the cent (the last line takes the remainder). */
export function spreadDiscount(lineAmounts: number[], discountCents: number): number[] {
  const total = lineAmounts.reduce((sum, amount) => sum + amount, 0);
  if (discountCents <= 0 || total <= 0) return [...lineAmounts];
  const capped = Math.min(discountCents, total);
  let left = capped;
  return lineAmounts.map((amount, index) => {
    if (index === lineAmounts.length - 1) return amount - left;
    const share = Math.floor((capped * amount) / total);
    left -= share;
    return amount - share;
  });
}

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
): Promise<{ taxCents: number; calculationId: string | null }> {
  const lineAmounts = spreadDiscount(group.items.map((i) => i.priceCents * i.quantity), group.merchandiseDiscountCents);
  const taxableShipping = Math.max(0, group.shippingCents - group.shippingDiscountCents);
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
