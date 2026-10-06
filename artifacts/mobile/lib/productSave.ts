/**
 * Pure helpers behind the Add/Edit Product Save (app/add-product.tsx).
 *
 * Root cause of "Save on a filled Add product form misbehaves": the create
 * payload's `variants` was built only from the optional Variants grid, so a
 * product saved with just a price and an "In stock" count (no size/color
 * options — the common case) went to POST /api/products with `variants: []`.
 * The server stores price and stock on variants only, so the listing was
 * created with no price, no stock and nothing a buyer could add to a bag.
 * Variants from the grid also never carried their size/color values, so the
 * buyer page had no options to pick. These helpers build the variant list
 * the server actually needs.
 */

export interface SaveOptionValue { id: string; value: string }
export interface SaveOption { id: string; type: string; name: string; values: SaveOptionValue[] }
export interface SaveVariant {
  id: string;
  sku?: string;
  priceCents?: number;
  inventoryQuantity: number;
  optionValues: { optionId: string; valueId: string }[];
}

export interface ServerVariantInput {
  size?: string;
  color?: string;
  sku: string;
  priceCents: number;
  stock: number;
  lowStockThreshold: number;
}

function skuBase(name: string): string {
  const base = name.trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toUpperCase();
  return base || 'SKU';
}

/**
 * The server variant list for a product: one row per grid variant (with its
 * size/color read from the option it belongs to), or — when the seller set
 * no options — a single default variant carrying the product's own price
 * and "In stock" count.
 */
export function buildServerVariants(input: {
  name: string;
  options: SaveOption[];
  variants: SaveVariant[];
  priceCents: number;
  stock: number;
  lowStockThreshold: number;
}): ServerVariantInput[] {
  const { name, options, variants, priceCents, lowStockThreshold } = input;
  const stock = Math.max(0, Math.floor(input.stock) || 0);
  if (variants.length === 0) {
    if (!(priceCents > 0)) return [];
    return [{ sku: `${skuBase(name)}-DEFAULT`, priceCents, stock, lowStockThreshold }];
  }
  const valueOf = (variant: SaveVariant, type: string): string | undefined => {
    for (const ov of variant.optionValues) {
      const option = options.find(o => o.id === ov.optionId);
      if (option?.type !== type) continue;
      const value = option.values.find(v => v.id === ov.valueId)?.value;
      if (value) return value;
    }
    return undefined;
  };
  return variants
    .map((v, i) => ({
      size: valueOf(v, 'size'),
      color: valueOf(v, 'color'),
      sku: v.sku?.trim() || `${skuBase(name)}-${i + 1}`,
      priceCents: v.priceCents ?? priceCents,
      stock: Math.max(0, Math.floor(v.inventoryQuantity) || 0),
      lowStockThreshold,
    }))
    .filter(v => v.priceCents > 0);
}

/**
 * Money text-field sanitizer (QA-0219): digits and a single decimal point
 * only, at most two decimals. A comma decimal separator is accepted and
 * normalized to "."; letters, signs and extra separators are dropped.
 */
export function sanitizeMoneyInput(text: string): string {
  let out = '';
  let seenPoint = false;
  let decimals = 0;
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') {
      if (seenPoint) {
        if (decimals >= 2) continue;
        decimals += 1;
      }
      out += ch;
    } else if ((ch === '.' || ch === ',') && !seenPoint) {
      seenPoint = true;
      out += out === '' ? '0.' : '.';
    }
  }
  return out;
}
