/**
 * Size sheet math (GOAT's size scroller: each size with its price under it,
 * struck through when discounted). Pure, so the product page and its tests
 * share it.
 */
import type { BuyerProduct, BuyerProductOption } from '@/services/cartTypes';

export interface SizeCell {
  valueId: string;
  label: string;
  /** Lowest in-stock price for this size given the other picks; null = sold out. */
  priceCents: number | null;
  /** Shown struck through when higher than priceCents. */
  compareAtCents: number | null;
}

/** The option the sheet scrolls: "Size" when the product has one, else its first option. */
export function primaryOption(product: Pick<BuyerProduct, 'options'>): BuyerProductOption | null {
  return product.options.find(o => o.name.toLowerCase() === 'size') ?? product.options[0] ?? null;
}

export function sizeCells(
  product: Pick<BuyerProduct, 'variants'>,
  option: BuyerProductOption,
  otherSelections: Record<string, string>,
): SizeCell[] {
  return option.values.map((value) => {
    const wanted = { ...otherSelections, [option.id]: value.id };
    const matches = product.variants.filter(v =>
      v.isAvailable && v.inventoryQuantity > 0 &&
      Object.entries(wanted).every(([optId, valId]) => v.optionValues.some(ov => ov.optionId === optId && ov.valueId === valId)),
    );
    if (matches.length === 0) return { valueId: value.id, label: value.label, priceCents: null, compareAtCents: null };
    const cheapest = matches.reduce((a, b) => (b.priceCents < a.priceCents ? b : a));
    const compare = cheapest.compareAtPriceCents && cheapest.compareAtPriceCents > cheapest.priceCents
      ? cheapest.compareAtPriceCents
      : null;
    return { valueId: value.id, label: value.label, priceCents: cheapest.priceCents, compareAtCents: compare };
  });
}
