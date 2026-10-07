import { describe, expect, it } from 'vitest';
import type { PublicBundle } from '@/lib/api';
import {
  bundleSavings, bundleSelectionTotals, missingBundleSelections, resolveBundleVariant, snapshotOf, type BundleLineLike,
} from './bundleCart';

const bundle: PublicBundle = {
  id: 'b1', sellerId: 's1', sellerName: 'Northline', name: 'Tee + pant', description: null, images: [],
  bundlePriceCents: 8_000, itemsTotalCents: 10_000, compareAtCents: 10_000, savingsCents: 2_000, needsSelection: true,
  items: [
    {
      id: 'i-tee', productId: 'tee', variantId: null, quantity: 1, productName: 'Tee', image: null, images: [], priceCents: 4_000,
      size: null, color: null,
      variants: [
        { id: 'tee-m', size: 'M', color: null, priceCents: 4_000, stock: 5 },
        { id: 'tee-l', size: 'L', color: null, priceCents: 4_500, stock: 5 },
      ],
    },
    {
      id: 'i-pant', productId: 'pant', variantId: 'pant-m', quantity: 1, productName: 'Pant', image: null, images: [], priceCents: 6_000,
      size: 'M', color: null, variants: [{ id: 'pant-m', size: 'M', color: null, priceCents: 6_000, stock: 5 }],
    },
  ],
};

const snap = snapshotOf(bundle);
const line = (variantId: string, productId: string, priceCents: number, quantity = 1, tagged = true): BundleLineLike =>
  ({ variantId, productId, priceCents, quantity, ...(tagged ? { bundleId: 'b1', bundle: snap } : {}) });

describe('bundleSavings (cart estimate, mirrors the server)', () => {
  it('saves the difference when every item is in the bag', () => {
    expect(bundleSavings([line('tee-m', 'tee', 4_000), line('pant-m', 'pant', 6_000)])).toEqual({
      totalCents: 2_000, bundles: [{ bundleId: 'b1', name: 'Tee + pant', sets: 1, discountCents: 2_000 }],
    });
  });

  it('drops the saving when an item is removed or a quantity is short', () => {
    expect(bundleSavings([line('tee-m', 'tee', 4_000)]).totalCents).toBe(0);
  });

  it('counts two sets when quantities allow', () => {
    expect(bundleSavings([line('tee-m', 'tee', 4_000, 2), line('pant-m', 'pant', 6_000, 3)]).bundles[0].sets).toBe(2);
  });

  it('ignores lines nobody added as a bundle', () => {
    expect(bundleSavings([line('tee-m', 'tee', 4_000, 1, false), line('pant-m', 'pant', 6_000, 1, false)]).totalCents).toBe(0);
  });

  it('never goes negative', () => {
    const pricey = { ...snap, bundlePriceCents: 99_999 };
    const lines = [{ ...line('tee-m', 'tee', 4_000), bundle: pricey }, { ...line('pant-m', 'pant', 6_000), bundle: pricey }];
    expect(bundleSavings(lines).totalCents).toBe(0);
  });
});

describe('bundle selections', () => {
  it('needs a size for open items and uses the chosen variant price', () => {
    expect(missingBundleSelections(bundle, {}).map(i => i.id)).toEqual(['i-tee']);
    expect(resolveBundleVariant(bundle.items[1], {})?.id).toBe('pant-m');
    expect(bundleSelectionTotals(bundle, { 'i-tee': 'tee-l' })).toEqual({ itemsCents: 10_500, savingsCents: 2_500, priceCents: 8_000 });
  });
});
