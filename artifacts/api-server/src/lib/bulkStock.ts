/**
 * Pure planning for the seller's bulk stock edit (POST /api/product-bulk/stock).
 *
 * A change applies to every variant of every selected product:
 *   - set:    stock becomes `value`
 *   - add:    stock goes up by `value`
 *   - remove: stock goes down by `value`, never below 0
 * No I/O here so the rules stay unit-testable; the route does the writes.
 */

export const MAX_STOCK = 1_000_000;

export type StockChange =
  | { mode: "set"; value: number }
  | { mode: "add"; value: number }
  | { mode: "remove"; value: number };

export type StockVariantRow = {
  variantId: string;
  sku: string;
  stock: number;
  lowStockThreshold: number;
};

export type StockVariantPlan = {
  variantId: string;
  sku: string;
  before: number;
  after: number;
  lowStockThreshold: number;
};

export type ProductStockPlan = {
  variants: StockVariantPlan[];
  changed: boolean;
  beforeTotal: number;
  afterTotal: number;
  /** Variants that end at or under their low-stock threshold (but above 0). */
  lowAfter: number;
  /** Variants that end at 0. */
  outAfter: number;
};

export function isValidStockChange(raw: unknown): raw is StockChange {
  if (!raw || typeof raw !== "object") return false;
  const { mode, value } = raw as { mode?: unknown; value?: unknown };
  if (mode !== "set" && mode !== "add" && mode !== "remove") return false;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > MAX_STOCK) return false;
  // Adding or removing nothing is a no-op the client should not send.
  if (mode !== "set" && value === 0) return false;
  return true;
}

export function computeNewStock(current: number, change: StockChange): number {
  const base = Math.max(0, Math.trunc(current));
  let next: number;
  if (change.mode === "set") next = change.value;
  else if (change.mode === "add") next = base + change.value;
  else next = base - change.value;
  return Math.min(MAX_STOCK, Math.max(0, next));
}

export function stockLevel(stock: number, threshold: number): "out_of_stock" | "low_stock" | "in_stock" {
  if (stock <= 0) return "out_of_stock";
  if (stock <= threshold) return "low_stock";
  return "in_stock";
}

export function planProductStock(rows: StockVariantRow[], change: StockChange): ProductStockPlan | null {
  if (rows.length === 0) return null;
  const variants = rows.map((r) => ({
    variantId: r.variantId,
    sku: r.sku,
    before: r.stock,
    after: computeNewStock(r.stock, change),
    lowStockThreshold: r.lowStockThreshold,
  }));
  return {
    variants,
    changed: variants.some((v) => v.before !== v.after),
    beforeTotal: variants.reduce((n, v) => n + v.before, 0),
    afterTotal: variants.reduce((n, v) => n + v.after, 0),
    lowAfter: variants.filter((v) => stockLevel(v.after, v.lowStockThreshold) === "low_stock").length,
    outAfter: variants.filter((v) => v.after === 0).length,
  };
}
