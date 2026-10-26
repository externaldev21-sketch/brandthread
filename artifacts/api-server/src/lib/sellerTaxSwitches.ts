/**
 * Taxes & duties → "Automatic tax" and "Charge tax on shipping cost".
 *
 * Both are ON unless the seller explicitly turned them off (the money-safe
 * default): a seller who never opened the screen keeps collecting tax exactly
 * as before. The opt-outs live in seller_tax_config.automatic_tax_opted_out /
 * shipping_tax_opted_out (migration 644), written only by PATCH
 * /api/taxes/config, and every checkout path reads them here:
 *   - automatic tax off  → hosted / guest Stripe Checkout runs with
 *     automatic_tax disabled, and the in-app Stripe Tax calculation is skipped.
 *   - shipping tax off   → the shipping line is sent as non-taxable.
 */
import { eq } from "drizzle-orm";
import { db, sellerTaxConfig } from "@workspace/db";

export interface SellerTaxSwitches {
  automaticTax: boolean;
  shippingTax: boolean;
}

/** Stripe's "Nontaxable" product tax code. */
export const NONTAXABLE_TAX_CODE = "txcd_00000000";

export function effectiveTaxSwitches(
  config: { automaticTaxOptedOut?: boolean | null; shippingTaxOptedOut?: boolean | null } | null | undefined,
): SellerTaxSwitches {
  return { automaticTax: config?.automaticTaxOptedOut !== true, shippingTax: config?.shippingTaxOptedOut !== true };
}

export async function loadSellerTaxSwitches(sellerId: string): Promise<SellerTaxSwitches> {
  const [config] = await db
    .select({ automaticTaxOptedOut: sellerTaxConfig.automaticTaxOptedOut, shippingTaxOptedOut: sellerTaxConfig.shippingTaxOptedOut })
    .from(sellerTaxConfig)
    .where(eq(sellerTaxConfig.sellerId, sellerId))
    .limit(1);
  return effectiveTaxSwitches(config);
}

/** Stripe Checkout `automatic_tax` for this seller. */
export function checkoutAutomaticTax(switches: SellerTaxSwitches, sellerStripeAccountId: string) {
  return switches.automaticTax
    ? { enabled: true as const, liability: { type: "account" as const, account: sellerStripeAccountId } }
    : { enabled: false as const };
}

/** product_data for the shipping line: non-taxable when the seller turned tax on shipping off. */
export function shippingProductData(name: string, switches: SellerTaxSwitches): { name: string; tax_code?: string } {
  return switches.shippingTax ? { name } : { name, tax_code: NONTAXABLE_TAX_CODE };
}
