import { describe, expect, it, vi } from 'vitest';
import {
  buildFulfillRequest, canFulfill, initialSelection, linesToFulfill, orderTitle, selectedCount,
  shipmentGroups, stepSelection, submitFulfillRequest, trackingRequired, type FulfillOrderFacts,
} from './orderFulfillment';

const line = (id: string, quantity = 1, extra: Record<string, unknown> = {}) => ({ id, quantity, trackingNumber: null, carrier: null, refundedAt: null, ...extra });

function order(extra: Partial<FulfillOrderFacts> = {}): FulfillOrderFacts {
  return { status: 'processing', isPreOrder: false, deliverBy: null, autoRefundedAt: null, lineItems: [line('a'), line('b', 2)], ...extra };
}

const form = (extra: Partial<{ trackingNumber: string; carrier: string; notifyCustomer: boolean }> = {}) => ({
  trackingNumber: '', carrier: 'UPS', notifyCustomer: true, ...extra,
});

describe('linesToFulfill', () => {
  it('lists unshipped, unrefunded lines of an open order', () => {
    const o = order({ lineItems: [line('a'), line('b', 1, { trackingNumber: '1Z' }), line('c', 1, { refundedAt: '2026-01-01' })] });
    expect(linesToFulfill(o).map(l => l.id)).toEqual(['a']);
    expect(canFulfill(o)).toBe(true);
  });

  it('is empty once the order shipped, closed or was auto-refunded', () => {
    expect(linesToFulfill(order({ status: 'shipped' }))).toEqual([]);
    expect(linesToFulfill(order({ status: 'delivered' }))).toEqual([]);
    expect(linesToFulfill(order({ status: 'cancelled' }))).toEqual([]);
    expect(linesToFulfill(order({ autoRefundedAt: '2026-01-01' }))).toEqual([]);
  });
});

describe('selection', () => {
  it('starts with every line fully selected', () => {
    expect(initialSelection([line('a'), line('b', 3)])).toEqual({ a: 1, b: 3 });
  });

  it('steps whole lines only: down unselects, up selects the full quantity', () => {
    expect(stepSelection(3, 2, 3)).toBe(0);
    expect(stepSelection(0, 1, 3)).toBe(3);
    expect(stepSelection(1, 1, 1)).toBe(1);
  });

  it('counts the selected units', () => {
    expect(selectedCount([line('a'), line('b', 2)], { a: 1, b: 0 })).toBe(1);
    expect(selectedCount([line('a'), line('b', 2)], { a: 1, b: 2 })).toBe(3);
  });
});

describe('buildFulfillRequest', () => {
  it('needs at least one selected item', () => {
    expect(buildFulfillRequest(order(), { a: 0, b: 0 }, form())).toEqual({ ok: false, error: 'Select at least one item to fulfill.' });
  });

  it('whole order with tracking → add tracking (which marks it shipped)', () => {
    const r = buildFulfillRequest(order(), { a: 1, b: 2 }, form({ trackingNumber: ' 1Z999 ' }));
    expect(r).toEqual({ ok: true, request: { kind: 'order-tracking', body: { trackingNumber: '1Z999', carrier: 'UPS' } } });
  });

  it('whole order without tracking → mark shipped, unless the server requires tracking', () => {
    expect(buildFulfillRequest(order(), { a: 1, b: 2 }, form())).toEqual({ ok: true, request: { kind: 'order-status', notifyCustomer: true } });
    const pre = buildFulfillRequest(order({ isPreOrder: true }), { a: 1, b: 2 }, form());
    expect(pre.ok).toBe(false);
    const guaranteed = buildFulfillRequest(order({ deliverBy: '2026-12-01' }), { a: 1, b: 2 }, form());
    expect(guaranteed).toMatchObject({ ok: false, error: expect.stringContaining('tracking number') });
  });

  it('some items → per-item tracking, which always needs a number', () => {
    expect(buildFulfillRequest(order(), { a: 1, b: 0 }, form())).toEqual({ ok: false, error: 'Add a tracking number to ship some of the items.' });
    expect(buildFulfillRequest(order(), { a: 1, b: 0 }, form({ trackingNumber: '9400', carrier: '' }))).toEqual({
      ok: true, request: { kind: 'items', body: { itemIds: ['a'], trackingNumber: '9400' } },
    });
  });

  it('the rest of a partly shipped order ships per item', () => {
    const o = order({ lineItems: [line('a', 1, { trackingNumber: '1Z' }), line('b')] });
    expect(buildFulfillRequest(o, { b: 1 }, form({ trackingNumber: '9400' }))).toMatchObject({ ok: true, request: { kind: 'items', body: { itemIds: ['b'] } } });
  });

  it('passes notifyCustomer:false only when the switch is off', () => {
    const quiet = buildFulfillRequest(order(), { a: 1, b: 2 }, form({ trackingNumber: '1Z', notifyCustomer: false }));
    expect(quiet).toMatchObject({ ok: true, request: { body: { notifyCustomer: false } } });
    const partial = buildFulfillRequest(order(), { a: 1 }, form({ trackingNumber: '1Z', notifyCustomer: false }));
    expect(partial).toMatchObject({ ok: true, request: { kind: 'items', body: { notifyCustomer: false } } });
  });

  it('refuses an over-long tracking number', () => {
    expect(buildFulfillRequest(order(), { a: 1, b: 2 }, form({ trackingNumber: 'x'.repeat(101) })).ok).toBe(false);
  });
});

describe('submitFulfillRequest', () => {
  const api = () => ({ addTracking: vi.fn(async () => ({})), addItemsTracking: vi.fn(async () => ({})), updateStatus: vi.fn(async () => ({})) });

  it('uses the existing endpoints for each kind', async () => {
    const a = api();
    await submitFulfillRequest(a, 'o1', { kind: 'order-tracking', body: { trackingNumber: '1Z', carrier: 'UPS' } });
    expect(a.addTracking).toHaveBeenCalledWith('o1', { trackingNumber: '1Z', carrier: 'UPS' });
    await submitFulfillRequest(a, 'o1', { kind: 'items', body: { itemIds: ['a'], trackingNumber: '9' } });
    expect(a.addItemsTracking).toHaveBeenCalledWith('o1', { itemIds: ['a'], trackingNumber: '9' });
    await submitFulfillRequest(a, 'o1', { kind: 'order-status', notifyCustomer: true });
    expect(a.updateStatus).toHaveBeenLastCalledWith('o1', 'shipped', undefined);
    await submitFulfillRequest(a, 'o1', { kind: 'order-status', notifyCustomer: false });
    expect(a.updateStatus).toHaveBeenLastCalledWith('o1', 'shipped', { notifyCustomer: false });
  });
});

describe('shipmentGroups', () => {
  it('groups shipped items by tracking number', () => {
    const o = { ...order({ lineItems: [line('a', 1, { trackingNumber: 'T1', carrier: 'UPS' }), line('b', 2, { trackingNumber: 'T2' }), line('c', 1, { trackingNumber: 'T1' }), line('d')] }) };
    const groups = shipmentGroups(o);
    expect(groups.map(g => [g.trackingNumber, g.items.map(i => i.id), g.quantity])).toEqual([['T1', ['a', 'c'], 2], ['T2', ['b'], 2]]);
  });

  it('a shipped order without item tracking is one shipment with the order tracking', () => {
    const groups = shipmentGroups({ ...order({ status: 'shipped' }), trackingNumber: 'ORD1', carrier: 'USPS' });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ trackingNumber: 'ORD1', carrier: 'USPS', quantity: 3 });
  });

  it('nothing shipped → no groups', () => {
    expect(shipmentGroups(order())).toEqual([]);
  });
});

describe('helpers', () => {
  it('trackingRequired mirrors the server rule', () => {
    expect(trackingRequired({ isPreOrder: true, deliverBy: null })).toBe(true);
    expect(trackingRequired({ isPreOrder: false, deliverBy: '2026-01-01' })).toBe(true);
    expect(trackingRequired({ isPreOrder: false, deliverBy: null })).toBe(false);
  });

  it('orderTitle prefixes one hash', () => {
    expect(orderTitle('1001')).toBe('#1001');
    expect(orderTitle('#1001')).toBe('#1001');
    expect(orderTitle('')).toBe('Order');
  });
});

describe('preview twins', () => {
  const raw = () => ({
    id: 'o', status: 'processing', totalCents: 5000, refundedCents: 0, trackingNumber: null, carrier: null, shippedAt: null,
    items: [{ id: 'a', trackingNumber: null }, { id: 'b', trackingNumber: null }],
  });

  it('ships the whole order with tracking', async () => {
    const { applyFulfillLocally } = await import('./orderFulfillment');
    const next = applyFulfillLocally(raw(), { kind: 'order-tracking', body: { trackingNumber: 'T', carrier: 'UPS' } }, '2026-10-09T10:00:00.000Z');
    expect(next).toMatchObject({ status: 'shipped', trackingNumber: 'T', carrier: 'UPS', shippedAt: '2026-10-09T10:00:00.000Z' });
    expect(next.items.every(i => i.trackingNumber === 'T')).toBe(true);
  });

  it('ships some items and the order once the last one ships', async () => {
    const { applyFulfillLocally } = await import('./orderFulfillment');
    const once = applyFulfillLocally(raw(), { kind: 'items', body: { itemIds: ['a'], trackingNumber: 'T1' } }, 'now');
    expect(once.status).toBe('processing');
    expect(once.items[0].trackingNumber).toBe('T1');
    const twice = applyFulfillLocally(once, { kind: 'items', body: { itemIds: ['b'], trackingNumber: 'T2' } }, 'later');
    expect(twice.status).toBe('shipped');
  });

  it('refunds add up and the refundable amount follows', async () => {
    const { applyRefundLocally, refundableCentsOf } = await import('./orderFulfillment');
    const r = applyRefundLocally(applyRefundLocally(raw(), 1000), 500);
    expect(r.refundedCents).toBe(1500);
    expect(refundableCentsOf(r)).toBe(3500);
    expect(refundableCentsOf({ totalCents: 5000, grossChargedCents: 5600, refundedCents: 600 })).toBe(5000);
  });
});
