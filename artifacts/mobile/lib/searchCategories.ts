/**
 * Category chips under the search bar. Derived from the app's own style-tag
 * vocabulary (STYLE_TAGS in components/StyleTagsPicker.tsx — the keys sellers
 * save into products.style_tags) plus the one product category buyers asked
 * for by name, Accessories. The server accepts exactly these keys as
 * `?style=` on GET /api/public/search/all (api-server lib/searchRanking.ts).
 *
 * Pure (no react-native imports) so ordering is unit-testable.
 */
export interface SearchChip {
  key: string;
  label: string;
}

/** Chips pinned to the front, in this order; every other style tag follows in vocabulary order. */
export const PINNED_CHIP_KEYS = ['streetwear', 'vintage', 'y2k', 'accessories'] as const;

export const CATEGORY_CHIPS: SearchChip[] = [{ key: 'accessories', label: 'Accessories' }];

export function buildSearchChips(styleTags: ReadonlyArray<{ key: string; label: string }>): SearchChip[] {
  const all = [...styleTags.map(({ key, label }) => ({ key, label })), ...CATEGORY_CHIPS];
  const byKey = new Map(all.map((c) => [c.key, c]));
  const pinned = PINNED_CHIP_KEYS.map((k) => byKey.get(k)).filter((c): c is SearchChip => !!c);
  return [...pinned, ...all.filter((c) => !(PINNED_CHIP_KEYS as readonly string[]).includes(c.key))];
}
