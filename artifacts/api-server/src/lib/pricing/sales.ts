/**
 * Automatic sales: pure pricing rules (no DB, no clock reads).
 *
 * A sale reduces a variant's price by a percentage or a fixed amount for a
 * date range, for the whole store, selected products, or a collection.
 *
 * Rules
 *  - Window: active && startsAt <= now && (endsAt == null || now < endsAt).
 *  - Scope: "store" = every product of the seller; "products" = productIds;
 *    "collection" = product category or any tag equals `collection`
 *    (case-insensitive, trimmed).
 *  - Sales never stack with each other: the single sale that yields the lowest
 *    price wins (ties go to the earliest-created / first listed).
 *  - Rounding: percent off is rounded to the nearest cent (half up) on the
 *    per-unit amount, so every unit is charged the same displayed price.
 *  - Floor: a sale never takes a price below 1 cent (and never below 0), so a
 *    fixed amount bigger than the price cannot produce a zero/negative charge.
 *  - Compare-at: while a sale applies the strike-through price is the larger
 *    of the seller's own compare-at and the pre-sale price. Without a sale the
 *    seller's compare-at passes through unchanged (only if above the price).
 *
 * Discount codes: a code always applies ON TOP of the sale price. Checkout
 * hands the already-reduced unit prices to the discount engine, so a 10% code
 * on a 20%-off item is 10% of the sale price, and a code's minimum-order /
 * fixed amount is evaluated against sale prices.
 */

export type SaleDiscountType = "percent" | "fixed";
export type SaleScope = "store" | "products" | "collection";

export interface SaleRule {
  id: string;
  sellerId: string;
  name: string;
  discountType: SaleDiscountType;
  /** percent: 1..100 · fixed: cents off each unit */
  value: number;
  scope: SaleScope;
  productIds?: readonly string[];
  collection?: string | null;
  startsAt: Date;
  endsAt?: Date | null;
  active: boolean;
}

export interface SaleTarget {
  productId: string;
  sellerId: string;
  category?: string | null;
  tags?: readonly string[] | null;
}

export interface EffectivePrice {
  /** What the buyer pays per unit. */
  priceCents: number;
  /** Struck-through price, or null when there is nothing to strike. */
  compareAtPriceCents: number | null;
  /** The variant's own price before any sale. */
  basePriceCents: number;
  saleId: string | null;
  saleName: string | null;
  /** Amount the sale took off a unit (0 when no sale). */
  saleDiscountCents: number;
  /** Whole-percent off versus the struck price, for badges (0 when none). */
  percentOff: number;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export function isSaleLive(sale: SaleRule, now: Date): boolean {
  if (!sale.active) return false;
  if (sale.startsAt.getTime() > now.getTime()) return false;
  if (sale.endsAt && sale.endsAt.getTime() <= now.getTime()) return false;
  return true;
}

export function saleAppliesTo(sale: SaleRule, target: SaleTarget): boolean {
  if (sale.sellerId !== target.sellerId) return false;
  switch (sale.scope) {
    case "store":
      return true;
    case "products":
      return !!sale.productIds?.includes(target.productId);
    case "collection": {
      const c = norm(sale.collection);
      if (!c) return false;
      return norm(target.category) === c || (target.tags ?? []).some((t) => norm(t) === c);
    }
    default:
      return false;
  }
}

/** Per-unit cents a sale removes from `priceCents`, never leaving less than 1 cent. */
export function saleDiscountFor(sale: Pick<SaleRule, "discountType" | "value">, priceCents: number): number {
  if (!Number.isFinite(priceCents) || priceCents <= 1) return 0;
  const v = Number.isFinite(sale.value) ? Math.max(0, sale.value) : 0;
  const raw = sale.discountType === "percent"
    ? Math.round((priceCents * Math.min(100, v)) / 100)
    : Math.round(v);
  return Math.max(0, Math.min(raw, priceCents - 1));
}

/** Resolve the price a buyer pays (and the strike-through price) for one variant at `now`. */
export function resolveEffectivePrice(input: {
  priceCents: number;
  compareAtPriceCents?: number | null;
  target: SaleTarget;
  sales: readonly SaleRule[];
  now: Date;
}): EffectivePrice {
  const base = input.priceCents;
  const ownCompare = input.compareAtPriceCents != null && input.compareAtPriceCents > base
    ? input.compareAtPriceCents
    : null;

  let best: { sale: SaleRule; discount: number } | null = null;
  for (const sale of input.sales) {
    if (!isSaleLive(sale, input.now) || !saleAppliesTo(sale, input.target)) continue;
    const discount = saleDiscountFor(sale, base);
    if (discount > 0 && (!best || discount > best.discount)) best = { sale, discount };
  }

  if (!best) {
    return {
      priceCents: base, compareAtPriceCents: ownCompare, basePriceCents: base,
      saleId: null, saleName: null, saleDiscountCents: 0,
      percentOff: ownCompare ? Math.round(((ownCompare - base) / ownCompare) * 100) : 0,
    };
  }
  const price = base - best.discount;
  const strike = Math.max(ownCompare ?? 0, base);
  return {
    priceCents: price,
    compareAtPriceCents: strike,
    basePriceCents: base,
    saleId: best.sale.id,
    saleName: best.sale.name,
    saleDiscountCents: best.discount,
    percentOff: Math.round(((strike - price) / strike) * 100),
  };
}
