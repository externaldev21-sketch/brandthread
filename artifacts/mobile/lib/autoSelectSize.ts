/**
 * Which size chip (if any) to preselect from the buyer's saved sizes when a
 * product page or size sheet opens — "your size" preselected, the same chip
 * SizeRecommendationBadge already names. Pure, so the rules are tested:
 *
 *  - only when the Size option is still unset (never over a cart-edit
 *    preselect or a size the buyer tapped);
 *  - the badge's recommendation wins; with no size chart (no badge model),
 *    the saved size for the product's category is matched to the chip labels;
 *  - only when that size is in stock with the other current selections —
 *    a sold-out saved size stays unselected (it shows Notify me instead).
 *
 * "Once per product load" is the caller's job (a ref keyed by product id).
 */
import { matchSizeLabel, productSizeLabels, type SizeBadgeModel } from '@/lib/sizeBadge';
import { sizeCategoryFor, type BuyerSizePreferences } from '@/lib/sizeRecommendation';

export interface AutoSizeProduct {
  name?: string;
  category?: string | null;
  options: Array<{ id: string; name: string; values: Array<{ id: string; label: string }> }>;
  variants: Array<{ isAvailable: boolean; optionValues: Array<{ optionId: string; valueId: string }> }>;
}

export function pickAutoSelectSize(input: {
  product: AutoSizeProduct | null | undefined;
  selections: Record<string, string>;
  badgeModel: SizeBadgeModel | null | undefined;
  preferences: BuyerSizePreferences | null | undefined;
}): { optionId: string; valueId: string } | null {
  const { product, selections, badgeModel, preferences } = input;
  if (!product) return null;
  const sizeOption = product.options.find(o => o.name.toLowerCase() === 'size');
  if (!sizeOption || selections[sizeOption.id]) return null;

  let label: string | null = null;
  if (badgeModel?.kind === 'recommend') {
    label = badgeModel.size;
  } else if (!badgeModel) {
    // No size chart: match the saved size for this category directly.
    const category = sizeCategoryFor(product.category) ?? sizeCategoryFor(product.name);
    const saved = category ? preferences?.sizes?.[category] : undefined;
    if (typeof saved === 'string' && saved.trim()) label = matchSizeLabel(saved, productSizeLabels(product));
  }
  if (!label) return null;

  const value = sizeOption.values.find(v => v.label === label);
  if (!value) return null;

  const candidate = { ...selections, [sizeOption.id]: value.id };
  const inStock = product.variants.some(v =>
    v.isAvailable &&
    Object.keys(candidate).every(oid => v.optionValues.some(ov => ov.optionId === oid && ov.valueId === candidate[oid])),
  );
  return inStock ? { optionId: sizeOption.id, valueId: value.id } : null;
}
