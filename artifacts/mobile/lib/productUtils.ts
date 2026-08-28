/**
 * Brandthread Product Pricing & Calculation Utilities
 *
 * All financial logic lives here — never hardcode calculations in UI components.
 */

import { ProductPricing } from '@/services/productTypes';
import { formatCents } from '@/lib/money';

export interface PricingResult {
  retailPriceCents: number;
  compareAtPriceCents: number | undefined;
  costCents: number | undefined;
  shippingCostCents: number;
  feesCents: number;
  grossProfitCents: number | undefined;
  netProfitCents: number | undefined;
  marginPercent: number | undefined;  // 0–100
  breakEvenPriceCents: number | undefined;
  isOnSale: boolean;
  discountPercent: number | undefined;
}

export function calcPricing(pricing: ProductPricing): PricingResult {
  // Normalize: treat compareAtPrice of 0 as not set
  const p: ProductPricing = (pricing.compareAtPriceCents === 0)
    ? { ...pricing, compareAtPriceCents: undefined }
    : pricing;

  const retail  = p.priceCents;
  const compare = p.compareAtPriceCents;
  const cost    = p.costCents;
  const ship    = p.estimatedShippingCostCents ?? 0;
  const fees    = p.estimatedFeesCents ?? 0;

  // grossProfit: retail - cost (defined only when cost is defined)
  const grossProfit = cost !== undefined ? retail - cost : undefined;

  // netProfit: retail - cost - shipping - fees (defined only when cost is defined)
  const netProfit = cost !== undefined ? retail - cost - ship - fees : undefined;

  // margin: guard against division by zero when retail === 0
  const margin = (netProfit !== undefined && retail > 0)
    ? (netProfit / retail) * 100
    : undefined;

  const breakEven = cost !== undefined ? cost + ship + fees : undefined;

  const isOnSale    = compare !== undefined && compare > retail;
  const discountPct = isOnSale && compare
    ? Math.round(((compare - retail) / compare) * 100)
    : undefined;

  return {
    retailPriceCents: retail,
    compareAtPriceCents: compare,
    costCents: cost,
    shippingCostCents: ship,
    feesCents: fees,
    grossProfitCents: grossProfit,
    netProfitCents: netProfit,
    marginPercent:  margin !== undefined ? Math.round(margin * 10) / 10 : undefined,
    breakEvenPriceCents: breakEven,
    isOnSale,
    discountPercent: discountPct,
  };
}

export function formatCurrency(cents: number, currency = 'USD'): string {
  return formatCents(cents, currency);
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/** Generate all variant combinations from options */
export function generateVariantCombinations(
  options: { id: string; name: string; values: { id: string; value: string }[] }[]
): { optionId: string; valueId: string; value: string }[][] {
  if (options.length === 0) return [];
  const result: { optionId: string; valueId: string; value: string }[][] = [[]];
  for (const opt of options) {
    const extended: { optionId: string; valueId: string; value: string }[][] = [];
    for (const combo of result) {
      for (const val of opt.values) {
        extended.push([...combo, { optionId: opt.id, valueId: val.id, value: val.value }]);
      }
    }
    result.splice(0, result.length, ...extended);
  }
  return result;
}

/** Build variant title from option values */
export function buildVariantTitle(values: string[]): string {
  return values.join(' / ');
}

/** Calculate total inventory across all variants */
export function calcTotalInventory(variants: { inventoryQuantity: number }[]): number {
  return variants.reduce((sum, v) => sum + v.inventoryQuantity, 0);
}

/** Check if a product is low stock */
export function isLowStock(totalInventory: number, threshold: number): boolean {
  return totalInventory > 0 && totalInventory <= threshold;
}

/** Check if a product is out of stock */
export function isOutOfStock(totalInventory: number, policy: 'deny' | 'continue'): boolean {
  return policy === 'deny' && totalInventory <= 0;
}

/** Validate required fields for publishing */
export function validateForPublish(product: {
  name: string;
  description: string;
  pricing: { priceCents: number };
  media: unknown[];
  variants: unknown[];
}): string[] {
  const warnings: string[] = [];
  if (!product.name?.trim()) warnings.push('Product name is required');
  if (!product.description?.trim()) warnings.push('Product description is required');
  if (!product.pricing?.priceCents || product.pricing.priceCents <= 0) warnings.push('A valid price is required');
  if (!product.media?.length) warnings.push('At least one product image is required');
  return warnings;
}
