import { describe, expect, it } from 'vitest';
import {
  allSelected, buildBulkUpdates, parseCents, parseStock, pruneSelection, quickSelects, sharedValue,
  toggleIds, toggleOne, variantValues, type SelectableVariant, type VariantAxis,
} from '../variantSelection';

const axes: VariantAxis[] = [
  { name: 'Size', values: ['S', 'M', 'L'] },
  { name: 'Colour', values: ['Black', 'White', 'Sand'] },
  { name: 'Fit', values: ['Slim', 'Relaxed'] },
];
const v = (id: string, size: string, color: string, fit: string, patch: Partial<SelectableVariant> = {}): SelectableVariant => ({
  id, size, color, options: { Fit: fit }, priceCents: 3000, stock: 2, compareAtCents: null, ...patch,
});
const variants: SelectableVariant[] = [
  v('a', 'S', 'Black', 'Slim'),
  v('b', 'S', 'White', 'Slim'),
  v('c', 'M', 'Black', 'Relaxed', { stock: 5 }),
  v('d', 'M', 'White', 'Relaxed', { priceCents: 3500, compareAtCents: 4000 }),
];

describe('quickSelects', () => {
  it('lists one entry per option value that has variants, in axis order', () => {
    const qs = quickSelects(axes, variants);
    expect(qs.map((q) => q.label)).toEqual(['Size S', 'Size M', 'Colour Black', 'Colour White', 'Fit Slim', 'Fit Relaxed']);
    expect(qs.find((q) => q.label === 'Colour Black')?.ids).toEqual(['a', 'c']);
    expect(qs.find((q) => q.label === 'Fit Relaxed')?.ids).toEqual(['c', 'd']);
  });

  it('matches "Color" axes to the colour column and custom axes to options', () => {
    const qs = quickSelects([{ name: 'Color', values: ['White'] }], variants);
    expect(qs).toEqual([{ key: 'colour:White', label: 'Color White', ids: ['b', 'd'] }]);
    expect(variantValues(variants[2], axes)).toEqual(['M', 'Black', 'Relaxed']);
  });
});

describe('selection toggles', () => {
  it('adds every variant with a value, and removes them when all are already selected', () => {
    let sel = toggleIds(new Set(), ['a', 'b']);
    expect([...sel]).toEqual(['a', 'b']);
    sel = toggleIds(sel, ['a', 'c']); // partly selected → select the rest
    expect([...sel].sort()).toEqual(['a', 'b', 'c']);
    expect(allSelected(sel, ['a', 'c'])).toBe(true);
    sel = toggleIds(sel, ['a', 'c']);
    expect([...sel]).toEqual(['b']);
    expect(allSelected(sel, [])).toBe(false);
  });

  it('toggles single rows and prunes ids that no longer exist', () => {
    const sel = toggleOne(toggleOne(new Set(['a']), 'b'), 'a');
    expect([...sel]).toEqual(['b']);
    expect([...pruneSelection(new Set(['a', 'zz']), variants)]).toEqual(['a']);
  });
});

describe('parsing', () => {
  it('reads prices and stock', () => {
    expect(parseCents('28')).toBe(2800);
    expect(parseCents('$1,299.5')).toBe(129950);
    expect(parseCents('.99')).toBe(99);
    expect(parseCents('0')).toBeNull();
    expect(parseCents('12.345')).toBeNull();
    expect(parseCents('abc')).toBeNull();
    expect(parseStock('0')).toBe(0);
    expect(parseStock('12')).toBe(12);
    expect(parseStock('1.5')).toBeNull();
    expect(parseStock('-1')).toBeNull();
  });
});

describe('buildBulkUpdates', () => {
  it('sets one stock value on the selected rows and skips rows already at it', () => {
    expect(buildBulkUpdates('stock', '5', ['a', 'c'], variants)).toEqual({ ok: true, updates: [{ variantId: 'a', stock: 5 }] });
    expect(buildBulkUpdates('stock', 'x', ['a'], variants).ok).toBe(false);
  });

  it('sets one price, refusing a price at or above a selected compare-at', () => {
    expect(buildBulkUpdates('price', '28.00', ['a', 'b'], variants)).toEqual({
      ok: true, updates: [{ variantId: 'a', priceCents: 2800 }, { variantId: 'b', priceCents: 2800 }],
    });
    expect(buildBulkUpdates('price', '40', ['a', 'd'], variants).ok).toBe(false);
    expect(buildBulkUpdates('price', '0', ['a'], variants).ok).toBe(false);
  });

  it('sets a compare-at above every selected price, or clears it', () => {
    expect(buildBulkUpdates('compareAt', '40', ['a', 'd'], variants)).toEqual({ ok: true, updates: [{ variantId: 'a', compareAtCents: 4000 }] });
    expect(buildBulkUpdates('compareAt', '32', ['a', 'd'], variants).ok).toBe(false); // d is 35.00
    expect(buildBulkUpdates('compareAt', '', ['a', 'd'], variants)).toEqual({ ok: true, updates: [{ variantId: 'd', compareAtCents: null }] });
    expect(buildBulkUpdates('compareAt', '50', ['d'], variants, { clear: true })).toEqual({ ok: true, updates: [{ variantId: 'd', compareAtCents: null }] });
  });

  it('needs a selection', () => {
    expect(buildBulkUpdates('stock', '1', [], variants).ok).toBe(false);
  });
});

describe('sharedValue', () => {
  it('prefills only when every selected row has the same value', () => {
    expect(sharedValue('price', ['a', 'b'], variants)).toBe('30.00');
    expect(sharedValue('price', ['a', 'd'], variants)).toBe('');
    expect(sharedValue('stock', ['a', 'b'], variants)).toBe('2');
    expect(sharedValue('compareAt', ['d'], variants)).toBe('40.00');
    expect(sharedValue('compareAt', ['a'], variants)).toBe('');
  });
});
