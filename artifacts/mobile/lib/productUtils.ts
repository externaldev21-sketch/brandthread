/**
 * Brandthread Product Pricing & Calculation Utilities
 *
 * All financial logic lives here — never hardcode calculations in UI components.
 */

import { ProductPricing } from '@/services/productTypes';

export interface PricingResult {
  retailPrice: number;
  compareAtPrice: number | undefined;
  cost: number | undefined;
  shippingCost: number;
  fees: number;
  grossProfit: number | undefined;
  netProfit: number | undefined;
  marginPercent: number | undefined;  // 0–100
  breakEvenPrice: number | undefined;
  isOnSale: boolean;
  discountPercent: number | undefined;
}

export function calcPricing(p: ProductPricing): PricingResult {
  const retail  = p.price;
  const compare = p.compareAtPrice;
  const cost    = p.cost;
  const ship    = p.estimatedShippingCost ?? 0;
  const fees    = p.estimatedFees ?? 0;

  const grossProfit = cost !== undefined ? retail - cost : undefined;
  const netProfit   = cost !== undefined ? retail - cost - ship - fees : undefined;
  const margin      = netProfit !== undefined ? (netProfit / retail) * 100 : undefined;
  const breakEven   = cost !== undefined ? cost + ship + fees : undefined;

  const isOnSale     = compare !== undefined && compare > retail;
  const discountPct  = isOnSale && compare ? Math.round(((compare - retail) / compare) * 100) : undefined;

  return {
    retailPrice:    retail,
    compareAtPrice: compare,
    cost,
    shippingCost:   ship,
    fees,
    grossProfit,
    netProfit,
    marginPercent:  margin !== undefined ? parseFloat(margin.toFixed(1)) : undefined,
    breakEvenPrice: breakEven,
    isOnSale,
    discountPercent: discountPct,
  };
}

export function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(amount);
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
  pricing: { price: number };
  media: unknown[];
  variants: unknown[];
}): string[] {
  const warnings: string[] = [];
  if (!product.name?.trim()) warnings.push('Product name is required');
  if (!product.description?.trim()) warnings.push('Product description is required');
  if (!product.pricing?.price || product.pricing.price <= 0) warnings.push('A valid price is required');
  if (!product.media?.length) warnings.push('At least one product image is required');
  return warnings;
}
