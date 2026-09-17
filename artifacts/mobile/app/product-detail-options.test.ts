/**
 * Product detail — option selection feedback tests
 *
 * Covers:
 * - Required-option feedback: unselected options highlighted after add attempt
 * - allSelected detection for single and multiple option products
 * - Low-stock / sold-out cue logic from variant state
 * - Add-to-bag confirmation auto-clear timer guard
 * - Option availability filtering (combo availability)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Pure helpers (mirrored from buyer-product-detail.tsx) ────────────────────

interface OptionValue {
  optionId: string;
  valueId: string;
}

interface Variant {
  id: string;
  isAvailable: boolean;
  inventoryQuantity: number;
  optionValues: OptionValue[];
}

interface Option {
  id: string;
  name: string;
  values: { id: string; label: string }[];
}

function findVariant(
  variants: Variant[],
  options: Option[],
  selections: Record<string, string>,
): Variant | null {
  const optionIds = options.map(o => o.id);
  if (Object.keys(selections).length < optionIds.length) return null;
  return (
    variants.find(v =>
      optionIds.every(optId => {
        const valueId = selections[optId];
        return v.optionValues.some(ov => ov.optionId === optId && ov.valueId === valueId);
      }),
    ) ?? null
  );
}

function isVariantComboAvailable(
  variants: Variant[],
  optionId: string,
  valueId: string,
  otherSelections: Record<string, string>,
): boolean {
  const candidate = { ...otherSelections, [optionId]: valueId };
  const filledOptionIds = Object.keys(candidate);
  return variants.some(
    v =>
      v.isAvailable &&
      filledOptionIds.every(oid =>
        v.optionValues.some(ov => ov.optionId === oid && ov.valueId === candidate[oid]),
      ),
  );
}

function allOptionsSelected(options: Option[], selections: Record<string, string>): boolean {
  return options.length > 0 && Object.keys(selections).length === options.length;
}

// Stock cue logic from the action bar
type StockCue = 'in_stock' | 'low_stock' | 'sold_out' | 'no_selection';

function getStockCue(variant: Variant | null, allSelected: boolean): StockCue {
  if (!allSelected) return 'no_selection';
  if (!variant) return 'no_selection';
  if (!variant.isAvailable || variant.inventoryQuantity === 0) return 'sold_out';
  if (variant.inventoryQuantity <= 5) return 'low_stock';
  return 'in_stock';
}

// ─── Test data ────────────────────────────────────────────────────────────────

const SIZE_OPTION: Option = {
  id: 'opt_size',
  name: 'Size',
  values: [
    { id: 'size_S', label: 'S' },
    { id: 'size_M', label: 'M' },
    { id: 'size_L', label: 'L' },
  ],
};

const COLOR_OPTION: Option = {
  id: 'opt_color',
  name: 'Color',
  values: [
    { id: 'color_black', label: 'Black' },
    { id: 'color_white', label: 'White' },
  ],
};

const VARIANTS: Variant[] = [
  {
    id: 'var_S_black',
    isAvailable: true,
    inventoryQuantity: 10,
    optionValues: [
      { optionId: 'opt_size', valueId: 'size_S' },
      { optionId: 'opt_color', valueId: 'color_black' },
    ],
  },
  {
    id: 'var_S_white',
    isAvailable: true,
    inventoryQuantity: 3,
    optionValues: [
      { optionId: 'opt_size', valueId: 'size_S' },
      { optionId: 'opt_color', valueId: 'color_white' },
    ],
  },
  {
    id: 'var_M_black',
    isAvailable: false,
    inventoryQuantity: 0,
    optionValues: [
      { optionId: 'opt_size', valueId: 'size_M' },
      { optionId: 'opt_color', valueId: 'color_black' },
    ],
  },
  {
    id: 'var_L_black',
    isAvailable: true,
    inventoryQuantity: 1,
    optionValues: [
      { optionId: 'opt_size', valueId: 'size_L' },
      { optionId: 'opt_color', valueId: 'color_black' },
    ],
  },
];

// ─── allOptionsSelected ────────────────────────────────────────────────────────

describe('Product detail — allOptionsSelected', () => {
  it('returns false when no options are selected', () => {
    expect(allOptionsSelected([SIZE_OPTION, COLOR_OPTION], {})).toBe(false);
  });

  it('returns false when only some options are selected', () => {
    expect(allOptionsSelected([SIZE_OPTION, COLOR_OPTION], { opt_size: 'size_S' })).toBe(false);
  });

  it('returns true when all options are selected', () => {
    expect(allOptionsSelected([SIZE_OPTION, COLOR_OPTION], {
      opt_size: 'size_S',
      opt_color: 'color_black',
    })).toBe(true);
  });

  it('returns false for a product with options but empty selections', () => {
    expect(allOptionsSelected([SIZE_OPTION], {})).toBe(false);
  });

  it('returns true for single-option product with one selection', () => {
    expect(allOptionsSelected([SIZE_OPTION], { opt_size: 'size_S' })).toBe(true);
  });

  it('returns false for product with no options (options.length === 0)', () => {
    // No options means nothing to select — allSelected should still gate the add button.
    // The screen uses: product.options.length > 0 && ...
    expect(allOptionsSelected([], {})).toBe(false);
  });
});

// ─── Required-option feedback ─────────────────────────────────────────────────

describe('Product detail — required option feedback (optionsTouched)', () => {
  it('unselected option shows required cue when optionsTouched is true', () => {
    const optionsTouched = true;
    const selections: Record<string, string> = {};
    const isUnselected = (optionId: string) => optionsTouched && !selections[optionId];

    expect(isUnselected('opt_size')).toBe(true);
    expect(isUnselected('opt_color')).toBe(true);
  });

  it('does not show required cue when optionsTouched is false', () => {
    const optionsTouched = false;
    const selections: Record<string, string> = {};
    const isUnselected = (optionId: string) => optionsTouched && !selections[optionId];

    expect(isUnselected('opt_size')).toBe(false);
  });

  it('does not show required cue for already-selected options', () => {
    const optionsTouched = true;
    const selections: Record<string, string> = { opt_size: 'size_S' };
    const isUnselected = (optionId: string) => optionsTouched && !selections[optionId];

    expect(isUnselected('opt_size')).toBe(false);
    expect(isUnselected('opt_color')).toBe(true); // still unselected
  });

  it('setting optionsTouched on add attempt without all selections marks options', () => {
    let optionsTouched = false;
    const selections: Record<string, string> = { opt_size: 'size_S' }; // missing color

    function handleAddToCart() {
      if (!allOptionsSelected([SIZE_OPTION, COLOR_OPTION], selections)) {
        optionsTouched = true;
        return 'needs_options';
      }
      return 'added';
    }

    const result = handleAddToCart();
    expect(result).toBe('needs_options');
    expect(optionsTouched).toBe(true);
  });

  it('proceeds to add when all options are selected', () => {
    const optionsTouched = false;
    const selections: Record<string, string> = { opt_size: 'size_S', opt_color: 'color_black' };

    function handleAddToCart() {
      if (!allOptionsSelected([SIZE_OPTION, COLOR_OPTION], selections)) {
        return 'needs_options';
      }
      return 'added';
    }

    expect(handleAddToCart()).toBe('added');
  });
});

// ─── findVariant ──────────────────────────────────────────────────────────────

describe('Product detail — findVariant', () => {
  it('returns the correct variant for complete selections', () => {
    const v = findVariant(VARIANTS, [SIZE_OPTION, COLOR_OPTION], {
      opt_size: 'size_S',
      opt_color: 'color_black',
    });
    expect(v?.id).toBe('var_S_black');
  });

  it('returns null for partial selections', () => {
    const v = findVariant(VARIANTS, [SIZE_OPTION, COLOR_OPTION], { opt_size: 'size_S' });
    expect(v).toBeNull();
  });

  it('returns null for empty selections', () => {
    const v = findVariant(VARIANTS, [SIZE_OPTION, COLOR_OPTION], {});
    expect(v).toBeNull();
  });

  it('finds the out-of-stock variant correctly', () => {
    const v = findVariant(VARIANTS, [SIZE_OPTION, COLOR_OPTION], {
      opt_size: 'size_M',
      opt_color: 'color_black',
    });
    expect(v?.id).toBe('var_M_black');
    expect(v?.isAvailable).toBe(false);
  });
});

// ─── Stock cues ───────────────────────────────────────────────────────────────

describe('Product detail — stock cue logic', () => {
  it('returns "no_selection" when options are not fully selected', () => {
    expect(getStockCue(null, false)).toBe('no_selection');
  });

  it('returns "sold_out" for an unavailable variant', () => {
    const v = VARIANTS.find(v => v.id === 'var_M_black')!;
    expect(getStockCue(v, true)).toBe('sold_out');
  });

  it('returns "sold_out" for a variant with zero inventory', () => {
    const v: Variant = { id: 'x', isAvailable: true, inventoryQuantity: 0, optionValues: [] };
    expect(getStockCue(v, true)).toBe('sold_out');
  });

  it('returns "low_stock" for inventoryQuantity <= 5', () => {
    const v = VARIANTS.find(v => v.id === 'var_S_white')!; // qty 3
    expect(getStockCue(v, true)).toBe('low_stock');
  });

  it('returns "low_stock" for the last unit (qty === 1)', () => {
    const v = VARIANTS.find(v => v.id === 'var_L_black')!; // qty 1
    expect(getStockCue(v, true)).toBe('low_stock');
  });

  it('returns "in_stock" for a well-stocked variant', () => {
    const v = VARIANTS.find(v => v.id === 'var_S_black')!; // qty 10
    expect(getStockCue(v, true)).toBe('in_stock');
  });
});

// ─── Variant combo availability ───────────────────────────────────────────────

describe('Product detail — variant combo availability', () => {
  it('S + black is available', () => {
    expect(isVariantComboAvailable(VARIANTS, 'opt_color', 'color_black', { opt_size: 'size_S' })).toBe(true);
  });

  it('M + black is unavailable (sold out)', () => {
    expect(isVariantComboAvailable(VARIANTS, 'opt_color', 'color_black', { opt_size: 'size_M' })).toBe(false);
  });

  it('L + black is available (low stock but available)', () => {
    expect(isVariantComboAvailable(VARIANTS, 'opt_color', 'color_black', { opt_size: 'size_L' })).toBe(true);
  });

  it('M + white has no variant (returns false)', () => {
    // There is no var_M_white in VARIANTS
    expect(isVariantComboAvailable(VARIANTS, 'opt_color', 'color_white', { opt_size: 'size_M' })).toBe(false);
  });

  it('S + white is available (low stock)', () => {
    expect(isVariantComboAvailable(VARIANTS, 'opt_color', 'color_white', { opt_size: 'size_S' })).toBe(true);
  });
});

// ─── Add-to-bag confirmation auto-clear guard ──────────────────────────────────

describe('Product detail — add-to-bag confirmation auto-clear', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('clears addedToCart after 2500ms', () => {
    let addedToCart = false;
    const setAddedToCart = (v: boolean) => { addedToCart = v; };

    // Simulate the success path
    setAddedToCart(true);
    expect(addedToCart).toBe(true);

    const timer = setTimeout(() => setAddedToCart(false), 2500);
    vi.advanceTimersByTime(2500);
    expect(addedToCart).toBe(false);

    clearTimeout(timer);
  });

  it('re-triggering clears previous timer and starts a fresh one', () => {
    let addedToCart = false;
    const setAddedToCart = (v: boolean) => { addedToCart = v; };

    let timerRef: ReturnType<typeof setTimeout> | null = null;

    function triggerAdded() {
      setAddedToCart(true);
      if (timerRef) clearTimeout(timerRef);
      timerRef = setTimeout(() => setAddedToCart(false), 2500);
    }

    triggerAdded();
    vi.advanceTimersByTime(1000); // 1s passes
    triggerAdded(); // re-trigger resets the 2.5s clock
    vi.advanceTimersByTime(2000); // only 2s passes since second trigger
    expect(addedToCart).toBe(true); // still showing because timer was reset

    vi.advanceTimersByTime(500); // 2.5s since second trigger
    expect(addedToCart).toBe(false); // now cleared

    if (timerRef) clearTimeout(timerRef);
  });

  it('does not clear before 2500ms', () => {
    let addedToCart = true;
    const timer = setTimeout(() => { addedToCart = false; }, 2500);
    vi.advanceTimersByTime(2000);
    expect(addedToCart).toBe(true);
    clearTimeout(timer);
  });
});
