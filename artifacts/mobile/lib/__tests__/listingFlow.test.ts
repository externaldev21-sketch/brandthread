import { describe, expect, it } from 'vitest';
import { dropIndexFor, movePhotoToFront, moveItem, reorderPhotos, withCoverFirst } from '../photoOrder';
import { canJumpToStep, firstIncompleteStep, isListingStepValid, type ListingStepInput } from '../listingSteps';
import { buildDraftPreviewRow, type DraftPreviewInput } from '../draftBuyerPreview';

const photos = () => [
  { id: 'a', isCover: true, sortOrder: 0 },
  { id: 'b', isCover: false, sortOrder: 1 },
  { id: 'c', isCover: false, sortOrder: 2 },
];

describe('photo order', () => {
  it('moves an item and leaves the input untouched', () => {
    const src = ['a', 'b', 'c', 'd'];
    expect(moveItem(src, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(src, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(src, 1, 99)).toEqual(['a', 'c', 'd', 'b']);
    expect(moveItem(src, 5, 0)).toEqual(src);
    expect(src).toEqual(['a', 'b', 'c', 'd']);
  });

  it('cover follows index 0 after a drag', () => {
    const next = reorderPhotos(photos(), 2, 0);
    expect(next.map(p => p.id)).toEqual(['c', 'a', 'b']);
    expect(next.map(p => p.isCover)).toEqual([true, false, false]);
    expect(next.map(p => p.sortOrder)).toEqual([0, 1, 2]);

    const moved = reorderPhotos(photos(), 0, 2);
    expect(moved[0]!.id).toBe('b');
    expect(moved[0]!.isCover).toBe(true);
    expect(moved.find(p => p.id === 'a')!.isCover).toBe(false);
  });

  it('set as cover moves the photo to the front', () => {
    const next = movePhotoToFront(photos(), 'b');
    expect(next.map(p => p.id)).toEqual(['b', 'a', 'c']);
    expect(next[0]!.isCover).toBe(true);
    expect(movePhotoToFront(photos(), 'missing').map(p => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('fixes a stale cover flag', () => {
    const stale = [{ id: 'a', isCover: false, sortOrder: 0 }, { id: 'b', isCover: true, sortOrder: 1 }];
    expect(withCoverFirst(stale).map(p => p.isCover)).toEqual([true, false]);
  });

  it('computes the drop slot from the drag distance', () => {
    expect(dropIndexFor(0, 0, 92, 3)).toBe(0);
    expect(dropIndexFor(0, 100, 92, 3)).toBe(1);
    expect(dropIndexFor(0, 500, 92, 3)).toBe(2);
    expect(dropIndexFor(2, -200, 92, 3)).toBe(0);
    expect(dropIndexFor(1, 40, 92, 3)).toBe(1);
  });
});

describe('listing steps', () => {
  const empty: ListingStepInput = { media: [], name: '', priceStr: '', variants: [], shipDateError: null };
  const full: ListingStepInput = { media: [{ id: 'a' }, { id: 'b' }], name: 'Boxy tee', priceStr: '45', variants: [], shipDateError: null };

  it('validates each step with the existing publish rules', () => {
    expect(isListingStepValid(0, empty)).toBe(false);
    expect(isListingStepValid(0, { ...empty, media: [{ id: 'a' }] })).toBe(true);
    expect(isListingStepValid(1, { ...full, name: '   ' })).toBe(false);
    expect(isListingStepValid(1, { ...full, shipDateError: 'Add a ship date' })).toBe(false);
    expect(isListingStepValid(2, { ...full, priceStr: '0' })).toBe(false);
    expect(isListingStepValid(2, { ...full, priceStr: '4.999' })).toBe(false);
    expect(isListingStepValid(2, { ...full, compareAtStr: '40' })).toBe(false);
    expect(isListingStepValid(2, { ...full, variants: [{ title: 'S', sku: 'X' }, { title: 'M', sku: 'X' }] })).toBe(false);
    expect(isListingStepValid(2, full)).toBe(true);
    expect(isListingStepValid(3, full)).toBe(true);
    expect(isListingStepValid(3, { ...full, media: [] })).toBe(false);
  });

  it('finds the first step that needs something', () => {
    expect(firstIncompleteStep(empty)).toBe(0);
    expect(firstIncompleteStep({ ...full, name: '' })).toBe(1);
    expect(firstIncompleteStep(full)).toBe(3);
  });

  it('only lets a new listing jump forward past valid steps; editing jumps anywhere', () => {
    expect(canJumpToStep(0, 2, empty, false)).toBe(true);
    expect(canJumpToStep(2, 0, empty, false)).toBe(false);
    expect(canJumpToStep(2, 0, { ...full, priceStr: '' }, false)).toBe(true);
    expect(canJumpToStep(3, 0, empty, true)).toBe(true);
  });
});

describe('draft buyer preview row', () => {
  const base: DraftPreviewInput = {
    name: ' Boxy tee ', description: 'Heavy cotton.', category: 'T-shirt',
    imageUris: ['/objects/uploads/a', '', '/objects/uploads/b'],
    priceCents: 4500, compareAtPriceCents: 6000, stock: 3, trackInventory: true,
    isPreOrder: false, options: [], variants: [],
  };

  it('builds one default variant with the retail price and stock', () => {
    const row = buildDraftPreviewRow(base);
    expect(row.name).toBe('Boxy tee');
    expect(row.images).toEqual(['/objects/uploads/a', '/objects/uploads/b']);
    expect(row.variants).toEqual([{ id: 'draft-preview-default', priceCents: 4500, stock: 3, compareAtPriceCents: 6000 }]);
  });

  it('maps size and color options onto variants', () => {
    const row = buildDraftPreviewRow({
      ...base,
      compareAtPriceCents: null,
      options: [
        { id: 'o1', type: 'size', name: 'Size', values: [{ id: 's', value: 'S' }, { id: 'm', value: 'M' }] },
        { id: 'o2', type: 'color', name: 'Color', values: [{ id: 'blk', value: 'Black' }] },
      ],
      variants: [
        { id: 'v1', optionValues: [{ optionId: 'o1', valueId: 's' }, { optionId: 'o2', valueId: 'blk' }], priceCents: null, qty: 0 },
        { id: 'v2', optionValues: [{ optionId: 'o1', valueId: 'm' }, { optionId: 'o2', valueId: 'blk' }], priceCents: 5000, qty: 4 },
      ],
    });
    expect(row.variants).toEqual([
      { id: 'v1', size: 'S', color: 'Black', priceCents: 4500, stock: 0 },
      { id: 'v2', size: 'M', color: 'Black', priceCents: 5000, stock: 4 },
    ]);
  });

  it('keeps pre-order dates only when valid and untracked stock stays buyable', () => {
    const row = buildDraftPreviewRow({ ...base, stock: 0, trackInventory: false, isPreOrder: true, preOrderClosingDate: 'soon', preOrderEstShipDate: '2026-12-01' });
    expect(row.preOrderClosingDate).toBeNull();
    expect(row.preOrderEstShipDate).toBe('2026-12-01');
    expect(row.variants[0]!.stock).toBe(1);
  });
});
