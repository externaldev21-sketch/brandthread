/**
 * Pure bulk-pricing maths. Everything is integer cents; no floats leak out.
 *
 * change.value units:
 *   set     -> exact price in cents
 *   amount  -> cents added / removed (direction decides)
 *   percent -> basis points (1000 = 10%), direction decides
 */

export const MIN_PRICE_CENTS = 1;
export const MAX_PRICE_CENTS = 100_000_000; // $1,000,000 — well inside int4

export type PriceChange =
  | { mode: "set"; value: number }
  | { mode: "amount"; direction: "increase" | "decrease"; value: number }
  | { mode: "percent"; direction: "increase" | "decrease"; value: number };

export type PriceRounding = "none" | "end_99" | "end_00";
export type CompareAtMode = "none" | "previous" | "clear";

export function isValidPriceChange(change: PriceChange): boolean {
  if (!Number.isInteger(change.value) || change.value < 0) return false;
  if (change.mode === "set") return change.value >= MIN_PRICE_CENTS && change.value <= MAX_PRICE_CENTS;
  if (change.mode === "percent") return change.value <= 100_000; // up to +1000%
  return change.value <= MAX_PRICE_CENTS;
}

function clampPrice(cents: number): number {
  return Math.min(MAX_PRICE_CENTS, Math.max(MIN_PRICE_CENTS, cents));
}

/** Snap to the nearest whole dollar ending in .99 (or .00), never below 1 cent. */
export function roundPrice(cents: number, rounding: PriceRounding): number {
  if (rounding === "none") return clampPrice(cents);
  const dollars = Math.max(1, Math.round(cents / 100));
  return clampPrice(rounding === "end_99" ? dollars * 100 - 1 : dollars * 100);
}

/** New price for one variant. Result is an integer in [1, MAX_PRICE_CENTS]. */
export function computeNewPrice(
  currentCents: number,
  change: PriceChange,
  rounding: PriceRounding = "none",
): number {
  let next: number;
  if (change.mode === "set") {
    next = change.value;
  } else if (change.mode === "amount") {
    next = change.direction === "increase" ? currentCents + change.value : currentCents - change.value;
  } else {
    const factorBps = change.direction === "increase" ? 10_000 + change.value : 10_000 - change.value;
    next = Math.round((currentCents * Math.max(0, factorBps)) / 10_000);
  }
  next = clampPrice(next);
  const rounded = roundPrice(next, rounding);
  if (change.mode === "set") return rounded;
  // Rounding must never move a price against the direction the seller asked for.
  if (change.direction === "decrease" && rounded > currentCents) return clampPrice(Math.min(next, currentCents));
  if (change.direction === "increase" && rounded < currentCents) return clampPrice(Math.max(next, currentCents));
  return rounded;
}

/** Compare-at ("was") price for a variant after a change; null clears it. */
export function resolveCompareAt(
  previousCents: number,
  nextCents: number,
  mode: CompareAtMode,
  existing: number | null,
): number | null {
  if (mode === "none") return existing;
  if (mode === "clear") return null;
  return nextCents < previousCents ? previousCents : null;
}

export interface VariantPriceRow { variantId: string; sku: string; priceCents: number; compareAtCents: number | null }

export interface VariantPricePlan {
  variantId: string;
  sku: string;
  before: number;
  after: number;
  compareAtBefore: number | null;
  compareAtAfter: number | null;
}

export interface ProductPricePlan {
  variants: VariantPricePlan[];
  beforeMin: number;
  beforeMax: number;
  afterMin: number;
  afterMax: number;
  changed: boolean;
}

export function planProductPrices(
  rows: VariantPriceRow[],
  change: PriceChange,
  rounding: PriceRounding,
  compareAt: CompareAtMode,
): ProductPricePlan | null {
  if (rows.length === 0) return null;
  const variants = rows.map((row) => {
    const after = computeNewPrice(row.priceCents, change, rounding);
    return {
      variantId: row.variantId,
      sku: row.sku,
      before: row.priceCents,
      after,
      compareAtBefore: row.compareAtCents,
      compareAtAfter: resolveCompareAt(row.priceCents, after, compareAt, row.compareAtCents),
    };
  });
  const befores = variants.map((v) => v.before);
  const afters = variants.map((v) => v.after);
  return {
    variants,
    beforeMin: Math.min(...befores),
    beforeMax: Math.max(...befores),
    afterMin: Math.min(...afters),
    afterMax: Math.max(...afters),
    changed: variants.some((v) => v.before !== v.after || v.compareAtBefore !== v.compareAtAfter),
  };
}

/** Copy SKU that does not collide with `taken` (case-insensitive); adds the result to `taken`. */
export function uniqueCopySku(sku: string, taken: Set<string>): string {
  const lower = new Set([...taken].map((s) => s.toLowerCase()));
  let candidate = `${sku}-COPY`;
  let n = 2;
  while (lower.has(candidate.toLowerCase())) candidate = `${sku}-COPY-${n++}`;
  taken.add(candidate);
  return candidate;
}
