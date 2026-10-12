import { describe, expect, it } from 'vitest';

import {
  blockCard, defaultButtonText, draftCard, draftFromBlock, draftPatch, draftPricing, draftProblems, dropIndex, emptyDraft,
  liveBlocks, monthGrid, moveItem, parsePrice, priceLabel, shipByLabel, shipByRange, type StoreBlock,
} from './storeBlocks';

const NOW = new Date('2026-10-12T15:00:00Z');

const block = (over: Partial<StoreBlock> = {}): StoreBlock => ({
  id: 'b1', productId: 'p1', kind: 'premade', style: 'callout', position: 0, visible: true, status: 'published',
  title: 'Wool crew', subtitle: 'Merino', buttonText: '', buttonLabel: 'Buy now',
  thumbImage: 'https://cdn.test/t.jpg', thumbImageRef: '/objects/t.jpg', checkoutImage: null, checkoutImageRef: null, description: '',
  product: { name: 'Wool crew', status: 'active', description: 'Made in Porto', image: 'https://cdn.test/p.jpg', moderationLocked: false },
  priceCents: 4800, compareAtPriceCents: 6000, stock: 3, variantCount: 1,
  shipBy: null, shipByLabel: '', preorderCap: null, preorderSold: null, open: true,
  ...over,
});

describe('store blocks', () => {
  it('two kinds with Stan-style default buttons', () => {
    expect(defaultButtonText('premade')).toBe('Buy now');
    expect(defaultButtonText('preorder')).toBe('Pre-order');
  });

  it('labels: prices without .00 and "Ships by Nov 20"', () => {
    expect(priceLabel(4800)).toBe('$48');
    expect(priceLabel(4850)).toBe('$48.50');
    expect(shipByLabel('2026-11-20', NOW)).toBe('Ships by Nov 20');
    expect(shipByLabel('2027-01-05T00:00:00.000Z', NOW)).toBe('Ships by Jan 5, 2027');
    expect(shipByLabel(null, NOW)).toBe('');
  });

  it('parses typed prices', () => {
    expect(parsePrice('48')).toBe(4800);
    expect(parsePrice('$1,200.5')).toBe(120050);
    expect(parsePrice('48.999')).toBeNull();
    expect(parsePrice('')).toBeNull();
  });

  it('pre-orders ship tomorrow at the earliest, 60 days out at the latest', () => {
    expect(shipByRange(NOW)).toEqual({ min: '2026-10-13', max: '2026-12-11' });
  });
});

describe('editor draft', () => {
  it('reads a discounted block as price + discount price', () => {
    const d = draftFromBlock(block());
    expect([d.price, d.discountOn, d.discountPrice]).toEqual(['60', true, '48']);
    expect(d.title).toBe('Wool crew');
    expect(d.description).toBe('Made in Porto'); // the product's, until the block has its own
    expect(draftPricing(d)).toEqual({ priceCents: 4800, compareAtPriceCents: 6000 });
  });

  it('a discount at or above the price is no discount', () => {
    const d = { ...emptyDraft('premade'), title: 'Tee', price: '48', discountOn: true, discountPrice: '60' };
    expect(draftPricing(d)).toEqual({ priceCents: 4800, compareAtPriceCents: null });
    expect(draftProblems(d, { isNew: false, now: NOW }).map((p) => p.field)).toEqual(['discountPrice']);
  });

  it('lists what stops publishing, in step order', () => {
    const d = { ...emptyDraft('preorder'), capOn: true, cap: '0' };
    expect(draftProblems(d, { isNew: true, now: NOW }).map((p) => [p.step, p.field])).toEqual([
      ['thumbnail', 'title'], ['thumbnail', 'price'], ['checkout', 'shipBy'], ['checkout', 'cap'],
    ]);
    const ok = { ...d, title: 'Field jacket', price: '165', shipBy: '2026-11-20', cap: '50' };
    expect(draftProblems(ok, { isNew: true, now: NOW })).toEqual([]);
    expect(draftProblems({ ...ok, shipBy: '2027-03-01' }, { isNew: true, now: NOW })[0].message).toMatch(/60 days/);
    // A new pre-made needs a quantity; a catalog product keeps its own stock.
    const premade = { ...emptyDraft('premade'), title: 'Tee', price: '30', stock: '' };
    expect(draftProblems(premade, { isNew: true, now: NOW }).map((p) => p.field)).toEqual(['stock']);
    expect(draftProblems(premade, { isNew: false, now: NOW })).toEqual([]);
  });

  it('only sends what changed', () => {
    const saved = block();
    const d = draftFromBlock(saved);
    expect(draftPatch(d, saved)).toEqual({});
    expect(draftPatch({ ...d, subtitle: 'Merino wool', discountOn: false }, saved)).toEqual({
      subtitle: 'Merino wool', priceCents: 6000, compareAtPriceCents: null,
    });
    expect(draftPatch(d, saved, { thumbImage: '/objects/new.jpg' })).toEqual({ thumbImage: '/objects/new.jpg' });
  });

  it('sends a pre-order\'s ship date and cap', () => {
    const saved = block({ kind: 'preorder', shipBy: '2026-11-20T00:00:00.000Z', preorderCap: 40, compareAtPriceCents: null });
    const d = draftFromBlock(saved);
    expect(draftPatch(d, saved)).toEqual({});
    expect(draftPatch({ ...d, shipBy: '2026-11-27', capOn: false }, saved)).toEqual({ shipBy: '2026-11-27', preorderCap: null });
  });

  it('the live preview card follows the draft', () => {
    const d = { ...emptyDraft('preorder'), title: 'Field jacket', price: '165', shipBy: '2026-11-20', buttonText: '' };
    expect(draftCard(d)).toMatchObject({ title: 'Field jacket', priceLabel: '$165', buttonText: 'Pre-order' });
    expect(draftCard(d).shipByLabel).toMatch(/^Ships by Nov 20/);
    expect(draftCard(emptyDraft('premade')).title).toBe('Pre-made');
  });
});

describe('store list', () => {
  it('saved blocks become cards; sold out and closed ones say so', () => {
    expect(blockCard(block())).toMatchObject({ title: 'Wool crew', priceLabel: '$48', compareAtLabel: '$60', buttonText: 'Buy now', unavailableLabel: null });
    expect(blockCard(block({ stock: 0 })).unavailableLabel).toBe('Sold out');
    expect(blockCard(block({ kind: 'preorder', open: false })).unavailableLabel).toBe('Pre-orders closed');
  });
  it('the store shows published, visible blocks', () => {
    const list = [block(), block({ id: 'b2', visible: false }), block({ id: 'b3', status: 'draft' })];
    expect(liveBlocks(list).map((b) => b.id)).toEqual(['b1']);
  });
  it('drag to reorder', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    // 72pt rows + 8pt gap: dragging row 0 down 170pt lands on index 2; clamped at the ends.
    expect(dropIndex(0, 170, 80, 4)).toBe(2);
    expect(dropIndex(1, -500, 80, 4)).toBe(0);
    expect(dropIndex(2, 1000, 80, 4)).toBe(3);
    expect(dropIndex(2, 30, 80, 4)).toBe(2);
  });
  it('ship date calendar weeks', () => {
    const weeks = monthGrid(2026, 10); // November 2026 starts on a Sunday
    expect(weeks[0][0]).toBe('2026-11-01');
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });
});
