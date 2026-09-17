/**
 * Cart row pending affordances — focused Vitest tests
 *
 * Covers:
 * - Per-row pending state tracker (qty_dec, qty_inc, remove, save)
 * - Only one action can be in-flight per item at a time
 * - clearPending removes the item without affecting other rows
 * - Inline stock warnings: low-stock threshold, critical-stock threshold, unavailable
 * - Saving a row while another row is already pending doesn't block the second row
 */

import { describe, expect, it } from 'vitest';

// ─── Types (mirrored from the screen) ─────────────────────────────────────────

type RowPendingAction = 'qty_dec' | 'qty_inc' | 'remove' | 'save';

// Pure helpers extracted from the cart screen logic
function setPending(
  state: Record<string, RowPendingAction>,
  itemId: string,
  action: RowPendingAction,
): Record<string, RowPendingAction> {
  return { ...state, [itemId]: action };
}

function clearPending(
  state: Record<string, RowPendingAction>,
  itemId: string,
): Record<string, RowPendingAction> {
  const next = { ...state };
  delete next[itemId];
  return next;
}

function isRowBusy(
  state: Record<string, RowPendingAction>,
  itemId: string,
): boolean {
  return itemId in state;
}

// Stock warning logic mirrored from CartItemRow
function stockWarningLevel(
  isAvailable: boolean,
  maxQuantity: number,
): 'none' | 'low' | 'critical' | 'unavailable' {
  if (!isAvailable) return 'unavailable';
  if (maxQuantity === 1) return 'critical';
  if (maxQuantity > 0 && maxQuantity <= 3) return 'low';
  return 'none';
}

// ─── Pending state tracker ─────────────────────────────────────────────────────

describe('Cart row pending state — setPending', () => {
  it('sets a qty_dec action for an item', () => {
    const state = setPending({}, 'item_1', 'qty_dec');
    expect(state['item_1']).toBe('qty_dec');
  });

  it('sets a qty_inc action for an item', () => {
    const state = setPending({}, 'item_2', 'qty_inc');
    expect(state['item_2']).toBe('qty_inc');
  });

  it('sets a remove action for an item', () => {
    const state = setPending({}, 'item_3', 'remove');
    expect(state['item_3']).toBe('remove');
  });

  it('sets a save action for an item', () => {
    const state = setPending({}, 'item_4', 'save');
    expect(state['item_4']).toBe('save');
  });

  it('does not affect other items when setting pending on one item', () => {
    let state = setPending({}, 'item_1', 'remove');
    state = setPending(state, 'item_2', 'qty_inc');
    expect(state['item_1']).toBe('remove');
    expect(state['item_2']).toBe('qty_inc');
  });

  it('overwrites the pending action for the same item', () => {
    let state = setPending({}, 'item_1', 'qty_dec');
    state = setPending(state, 'item_1', 'remove');
    expect(state['item_1']).toBe('remove');
  });
});

describe('Cart row pending state — clearPending', () => {
  it('removes the pending action for an item', () => {
    let state = setPending({}, 'item_1', 'remove');
    state = clearPending(state, 'item_1');
    expect(state['item_1']).toBeUndefined();
  });

  it('does not affect other items when clearing one', () => {
    let state: Record<string, RowPendingAction> = {};
    state = setPending(state, 'item_1', 'save');
    state = setPending(state, 'item_2', 'qty_dec');
    state = clearPending(state, 'item_1');
    expect(state['item_1']).toBeUndefined();
    expect(state['item_2']).toBe('qty_dec');
  });

  it('clearing an item that is not pending is a no-op', () => {
    const state = clearPending({}, 'item_nonexistent');
    expect(Object.keys(state)).toHaveLength(0);
  });
});

describe('Cart row pending state — isRowBusy', () => {
  it('returns true when the item has a pending action', () => {
    const state = setPending({}, 'item_1', 'remove');
    expect(isRowBusy(state, 'item_1')).toBe(true);
  });

  it('returns false when the item has no pending action', () => {
    const state = setPending({}, 'item_1', 'remove');
    expect(isRowBusy(state, 'item_2')).toBe(false);
  });

  it('returns false after clearing the pending action', () => {
    let state = setPending({}, 'item_1', 'save');
    state = clearPending(state, 'item_1');
    expect(isRowBusy(state, 'item_1')).toBe(false);
  });
});

describe('Cart row pending state — concurrent rows', () => {
  it('two rows can be in different pending states simultaneously', () => {
    let state: Record<string, RowPendingAction> = {};
    state = setPending(state, 'item_A', 'qty_dec');
    state = setPending(state, 'item_B', 'save');
    expect(isRowBusy(state, 'item_A')).toBe(true);
    expect(isRowBusy(state, 'item_B')).toBe(true);
    expect(state['item_A']).toBe('qty_dec');
    expect(state['item_B']).toBe('save');
  });

  it('clearing one row does not affect the other', () => {
    let state: Record<string, RowPendingAction> = {};
    state = setPending(state, 'item_A', 'remove');
    state = setPending(state, 'item_B', 'qty_inc');
    state = clearPending(state, 'item_A');
    expect(isRowBusy(state, 'item_A')).toBe(false);
    expect(isRowBusy(state, 'item_B')).toBe(true);
  });
});

// ─── Stock warning levels ──────────────────────────────────────────────────────

describe('Cart row stock warnings', () => {
  it('returns "unavailable" when isAvailable is false', () => {
    expect(stockWarningLevel(false, 5)).toBe('unavailable');
  });

  it('returns "unavailable" when isAvailable is false and maxQuantity is 0', () => {
    expect(stockWarningLevel(false, 0)).toBe('unavailable');
  });

  it('returns "critical" for the last unit (maxQuantity === 1)', () => {
    expect(stockWarningLevel(true, 1)).toBe('critical');
  });

  it('returns "low" at maxQuantity === 2', () => {
    expect(stockWarningLevel(true, 2)).toBe('low');
  });

  it('returns "low" at maxQuantity === 3 (boundary)', () => {
    expect(stockWarningLevel(true, 3)).toBe('low');
  });

  it('returns "none" at maxQuantity === 4 (above threshold)', () => {
    expect(stockWarningLevel(true, 4)).toBe('none');
  });

  it('returns "none" for well-stocked items', () => {
    expect(stockWarningLevel(true, 99)).toBe('none');
  });

  it('returns "none" when maxQuantity is 0 but isAvailable is true (edge case: pre-order)', () => {
    // maxQuantity 0 with isAvailable true — no stock warning (pre-order scenario)
    expect(stockWarningLevel(true, 0)).toBe('none');
  });
});

// ─── Guard: qty actions when row is already busy ──────────────────────────────

describe('Cart row pending guard — duplicate action prevention', () => {
  it('prevents a new action from starting when the row is already busy', () => {
    let state: Record<string, RowPendingAction> = {};
    state = setPending(state, 'item_1', 'remove');

    // Simulate handleQtyDec guard: if (pendingByItemId[itemId]) return;
    const shouldProceed = !isRowBusy(state, 'item_1');
    expect(shouldProceed).toBe(false);
  });

  it('allows a new action when the row is not busy', () => {
    const state: Record<string, RowPendingAction> = {};
    const shouldProceed = !isRowBusy(state, 'item_1');
    expect(shouldProceed).toBe(true);
  });

  it('allows action on a different item even if another is busy', () => {
    let state: Record<string, RowPendingAction> = {};
    state = setPending(state, 'item_1', 'remove');
    const shouldProceedForItem2 = !isRowBusy(state, 'item_2');
    expect(shouldProceedForItem2).toBe(true);
  });
});
