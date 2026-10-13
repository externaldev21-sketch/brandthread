/**
 * What the seller chose on Taxes and duties (seller_tax_config), in the shape
 * every checkout needs. Checkout tax is calculated by Stripe Tax on the
 * seller's own connected account (their registrations, their liability), and
 * only when the seller turned it on:
 *
 *   stripeTaxEnabled  off (the default, and no row) → no tax at checkout.
 *   chargeShippingTax off → shipping is left out of the taxable amount;
 *                     on  → shipping is taxed by Stripe's shipping rules.
 *
 * Used by the one-page cart (lib/money/cartCheckout.ts calculateGroupTax) and
 * both hosted Checkout paths (routes/buyer.ts, routes/guest-checkout.ts).
 */
import { eq } from "drizzle-orm";
import { db, sellerTaxConfig } from "@workspace/db";

export type SellerTaxPolicy = {
  /** Stripe Tax runs at checkout for this seller. */
  collectTax: boolean;
  /** Shipping is part of the taxable amount (only meaningful with collectTax). */
  taxShipping: boolean;
};

/** Stripe's tax code for shipping charges (taxed per jurisdiction rules). */
export const SHIPPING_TAX_CODE = "txcd_92010001";
/** Stripe's "Nontaxable" tax code: Stripe calculates zero tax on the line. */
export const NONTAXABLE_TAX_CODE = "txcd_00000000";

export const NO_TAX_POLICY: SellerTaxPolicy = { collectTax: false, taxShipping: false };

export async function loadSellerTaxPolicy(sellerId: string): Promise<SellerTaxPolicy> {
  const [row] = await db.select({
    stripeTaxEnabled: sellerTaxConfig.stripeTaxEnabled,
    chargeShippingTax: sellerTaxConfig.chargeShippingTax,
  }).from(sellerTaxConfig).where(eq(sellerTaxConfig.sellerId, sellerId)).limit(1);
  if (!row?.stripeTaxEnabled) return NO_TAX_POLICY;
  return { collectTax: true, taxShipping: row.chargeShippingTax === true };
}

/** `automatic_tax` for a hosted Checkout Session. */
export function hostedAutomaticTax(policy: SellerTaxPolicy, sellerStripeAccountId: string) {
  return policy.collectTax
    ? { enabled: true as const, liability: { type: "account" as const, account: sellerStripeAccountId } }
    : { enabled: false as const };
}

/**
 * Tax code for the shipping line of a hosted Checkout Session (shipping is a
 * regular line item there). Without one, Stripe would tax shipping like the
 * goods; with tax off nothing is calculated so none is needed.
 */
export function shippingLineTaxCode(policy: SellerTaxPolicy): string | undefined {
  if (!policy.collectTax) return undefined;
  return policy.taxShipping ? SHIPPING_TAX_CODE : NONTAXABLE_TAX_CODE;
}
