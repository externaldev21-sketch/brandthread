/**
 * Option selection rules for the buyer product page (BT-252), matching
 * ShopProductSheet: a product with no options (one-size, accessories, every
 * CSV/bulk import) is always fully selected, and a product with exactly one
 * variant starts with that variant chosen.
 *
 * Pure module: no react-native imports, safe to unit test.
 */
type Selectable = {
  options: ReadonlyArray<{ id: string }>;
  variants: ReadonlyArray<{ optionValues: ReadonlyArray<{ optionId: string; valueId: string }> }>;
};

export function allOptionsSelected(product: Pick<Selectable, 'options'>, selections: Record<string, string>): boolean {
  return product.options.length === 0 || Object.keys(selections).length === product.options.length;
}

/** The selection for a product's only variant, or null when the buyer has a real choice to make. */
export function onlyVariantSelection(product: Selectable): Record<string, string> | null {
  if (product.variants.length !== 1) return null;
  return Object.fromEntries(product.variants[0].optionValues.map((value) => [value.optionId, value.valueId]));
}
