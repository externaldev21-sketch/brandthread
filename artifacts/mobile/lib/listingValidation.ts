/**
 * Brandthread — Seller Listing Step Validation
 *
 * Pure validation helpers for the fast seller listing flow (add-product
 * stepper). Kept framework-agnostic so the rules can be unit tested without
 * mounting the screen.
 */

import { parseDecimalToCents } from '@/lib/money';
import type { ProductMedia } from '@/services/productTypes';

export type ListingStepId = 'photos' | 'details' | 'variants' | 'pricing' | 'shipping' | 'review';

export interface ListingValidationInput {
  media: Pick<ProductMedia, 'id'>[];
  name: string;
  description?: string;
  category?: string;
  priceStr: string;
  compareAtStr?: string;
  costStr?: string;
  variants: { title: string; sku?: string; price?: string }[];
  isPreOrder?: boolean;
  preOrderCloseDate?: string;
  preOrderOpenDate?: string;
}

export interface FieldError {
  field: string;
  message: string;
}

function isValidMoney(value: string | undefined): boolean {
  if (!value || !value.trim()) return true; // optional fields are valid when empty
  return parseDecimalToCents(value) !== null;
}

/** Validates the Photos step: at least one image is required. */
export function validatePhotosStep(input: Pick<ListingValidationInput, 'media'>): FieldError[] {
  const errors: FieldError[] = [];
  if (!input.media || input.media.length === 0) {
    errors.push({ field: 'media', message: 'Add at least one photo before continuing.' });
  }
  return errors;
}

/** Validates the Details step: name + category are required. */
export function validateDetailsStep(input: Pick<ListingValidationInput, 'name' | 'category'>): FieldError[] {
  const errors: FieldError[] = [];
  if (!input.name || !input.name.trim()) {
    errors.push({ field: 'name', message: 'Give your product a name.' });
  }
  return errors;
}

/** Validates the Variants step: SKUs must be unique across variants (blank SKUs are allowed). */
export function validateVariantsStep(input: Pick<ListingValidationInput, 'variants'>): FieldError[] {
  const errors: FieldError[] = [];
  const skus = (input.variants ?? []).map(v => v.sku?.trim()).filter((s): s is string => !!s);
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const sku of skus) {
    if (seen.has(sku)) dupes.add(sku);
    seen.add(sku);
  }
  if (dupes.size > 0) {
    errors.push({ field: 'variants', message: `Duplicate SKU: ${Array.from(dupes).join(', ')}` });
  }
  for (const v of input.variants ?? []) {
    if (v.price && !isValidMoney(v.price)) {
      errors.push({ field: 'variants', message: `Invalid price for ${v.title || 'variant'}.` });
    }
  }
  return errors;
}

/** Validates the Pricing & Stock step. */
export function validatePricingStep(
  input: Pick<ListingValidationInput, 'priceStr' | 'compareAtStr' | 'costStr' | 'isPreOrder' | 'preOrderOpenDate' | 'preOrderCloseDate'>,
): FieldError[] {
  const errors: FieldError[] = [];
  const priceCents = parseDecimalToCents(input.priceStr);
  if (priceCents === null || priceCents <= 0) {
    errors.push({ field: 'price', message: 'Enter a valid retail price.' });
  }
  if (!isValidMoney(input.compareAtStr)) {
    errors.push({ field: 'compareAt', message: 'Compare-at price must be a valid amount.' });
  } else if (input.compareAtStr?.trim() && priceCents !== null) {
    const compareCents = parseDecimalToCents(input.compareAtStr);
    if (compareCents !== null && compareCents <= priceCents) {
      errors.push({ field: 'compareAt', message: 'Compare-at price should be higher than the retail price.' });
    }
  }
  if (!isValidMoney(input.costStr)) {
    errors.push({ field: 'cost', message: 'Cost must be a valid amount.' });
  }
  if (input.isPreOrder && input.preOrderOpenDate && input.preOrderCloseDate) {
    if (input.preOrderCloseDate <= input.preOrderOpenDate) {
      errors.push({ field: 'preorder', message: 'Pre-order close date must be after the open date.' });
    }
  }
  return errors;
}

/** Full cross-step validation before publish — aggregates every step's rules. */
export function validateListingForPublish(input: ListingValidationInput): FieldError[] {
  return [
    ...validatePhotosStep(input),
    ...validateDetailsStep(input),
    ...validateVariantsStep(input),
    ...validatePricingStep(input),
  ];
}

export function errorsForField(errors: FieldError[], field: string): string | undefined {
  return errors.find(e => e.field === field)?.message;
}
