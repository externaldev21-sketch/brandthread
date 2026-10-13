/**
 * Wholesale price list rules (pure, no DB). DB glue: ./wholesaleRuntime.ts.
 *
 * Model (Shopify B2B catalogs): one price list per seller with an overall
 * "% off retail" plus fixed prices per product or variant, each with a
 * minimum quantity, and an order minimum.
 *
 *  - Only buyers the seller approved get wholesale prices.
 *  - A line gets its wholesale unit price when its quantity reaches the
 *    line's minimum quantity (variant rule > product rule > 1).
 *  - Wholesale price of a line: the fixed price of its variant rule, else of
 *    its product rule, else retail minus the default % off (none when 0).
 *  - No stacking with automatic sales: a line uses the LOWER of its sale
 *    price and its wholesale price, never both. Lines that end up at
 *    wholesale are also left out of discount-code eligibility (the caller
 *    removes them from the discount lines), so codes never stack either.
 *  - The order minimum is checked on the wholesale subtotal (every line at
 *    the price it would be charged). Below it, the whole order is retail.
 */

export type WholesaleSettings = {
  enabled: boolean;
  /** Wholesale subtotal the order must reach. 0 = no minimum. */
  minOrderCents: number;
  /** % off retail for products without a fixed wholesale price (0..90). */
  defaultPercentOff: number;
};

export type WholesaleRule = {
  productId: string;
  /** null = every variant of the product. */
  variantId: string | null;
  /** Fixed unit price; null = default % off. */
  priceCents: number | null;
  minQuantity: number;
};

export type WholesaleTerms = {
  /** Wholesale unit price, or null when this item has none. */
  unitCents: number | null;
  minQuantity: number;
};

export type WholesaleLineInput = {
  productId: string;
  variantId: string;
  quantity: number;
  /** Catalog price before any sale (the base for the default % off). */
  retailUnitCents: number;
  /** What the line costs without wholesale (sale price when a sale is live). */
  currentUnitCents: number;
};

export type WholesaleReason = "disabled" | "not_approved" | "no_wholesale_lines" | "below_minimum";

export type WholesaleResult = {
  applied: boolean;
  reason: WholesaleReason | null;
  lines: Array<{ unitCents: number; wholesale: boolean }>;
  /** Subtotal at the charged prices. */
  subtotalCents: number;
  minOrderCents: number;
  /** How far the wholesale subtotal is below the minimum (0 when met). */
  shortByCents: number;
};

export const MAX_DEFAULT_PERCENT_OFF = 90;

function clampPercent(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.max(0, Math.min(MAX_DEFAULT_PERCENT_OFF, Math.round(p)));
}

/** The wholesale price and minimum quantity of one item. */
export function wholesaleTermsFor(
  settings: Pick<WholesaleSettings, "defaultPercentOff">,
  rules: readonly WholesaleRule[],
  item: { productId: string; variantId: string | null; retailUnitCents: number },
): WholesaleTerms {
  const variantRule = item.variantId
    ? rules.find((r) => r.variantId === item.variantId && r.productId === item.productId)
    : undefined;
  const productRule = rules.find((r) => r.variantId === null && r.productId === item.productId);
  const fixed = variantRule?.priceCents ?? productRule?.priceCents ?? null;
  const minQuantity = Math.max(1, variantRule?.minQuantity ?? productRule?.minQuantity ?? 1);
  if (fixed != null) return { unitCents: Math.max(0, Math.round(fixed)), minQuantity };
  const pct = clampPercent(settings.defaultPercentOff);
  if (pct <= 0) return { unitCents: null, minQuantity };
  return { unitCents: Math.round((item.retailUnitCents * (100 - pct)) / 100), minQuantity };
}

/** Prices one seller's cart lines for a buyer. See the module comment for the rules. */
export function resolveWholesalePrice(input: {
  settings: WholesaleSettings | null;
  approved: boolean;
  rules: readonly WholesaleRule[];
  lines: readonly WholesaleLineInput[];
}): WholesaleResult {
  const retail = (reason: WholesaleReason, minOrderCents = 0, shortByCents = 0): WholesaleResult => {
    const lines = input.lines.map((l) => ({ unitCents: l.currentUnitCents, wholesale: false }));
    return {
      applied: false, reason, lines,
      subtotalCents: lines.reduce((sum, l, i) => sum + l.unitCents * input.lines[i].quantity, 0),
      minOrderCents, shortByCents,
    };
  };
  const settings = input.settings;
  if (!settings?.enabled) return retail("disabled");
  if (!input.approved) return retail("not_approved");
  const minOrderCents = Math.max(0, Math.round(settings.minOrderCents || 0));

  const lines = input.lines.map((l) => {
    const terms = wholesaleTermsFor(settings, input.rules, l);
    const qualifies = terms.unitCents != null && l.quantity >= terms.minQuantity && terms.unitCents < l.currentUnitCents;
    return qualifies ? { unitCents: terms.unitCents as number, wholesale: true } : { unitCents: l.currentUnitCents, wholesale: false };
  });
  if (!lines.some((l) => l.wholesale)) return retail("no_wholesale_lines", minOrderCents);
  const subtotalCents = lines.reduce((sum, l, i) => sum + l.unitCents * input.lines[i].quantity, 0);
  if (subtotalCents < minOrderCents) return retail("below_minimum", minOrderCents, minOrderCents - subtotalCents);
  return { applied: true, reason: null, lines, subtotalCents, minOrderCents, shortByCents: 0 };
}
