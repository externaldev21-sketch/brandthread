import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAYOUT_HOLD_RULE, buildHeldForDeliveryView, heldOrderStatusLine, holdRuleLine, previewHeldForDelivery,
} from './payoutHoldTiming';
import type { HeldOrderTiming } from './financeSummary';

const now = new Date('2026-10-10T12:00:00Z');
const order = (patch: Partial<HeldOrderTiming>): HeldOrderTiming => ({
  orderId: 'o1', orderNumber: '1042', isPreorder: false, netCents: 4250,
  state: 'awaiting_delivery', deliverBy: null, payoutReleaseAt: null, ...patch,
});

describe('holdRuleLine', () => {
  it('matches the server default: paid 3 days after delivery', () => {
    expect(holdRuleLine()).toBe('Paid 3 days after delivery');
    expect(holdRuleLine(DEFAULT_PAYOUT_HOLD_RULE)).toBe('Paid 3 days after delivery');
  });

  it('follows the configured buffer and mode', () => {
    expect(holdRuleLine({ ...DEFAULT_PAYOUT_HOLD_RULE, bufferDays: 1 })).toBe('Paid 1 day after delivery');
    expect(holdRuleLine({ ...DEFAULT_PAYOUT_HOLD_RULE, bufferDays: 0 })).toBe('Paid when the order is delivered');
    expect(holdRuleLine({ ...DEFAULT_PAYOUT_HOLD_RULE, mode: 'immediate' })).toBe('Pre-orders are paid when they ship');
  });
});

describe('heldOrderStatusLine', () => {
  it('shows the payout date once delivered', () => {
    expect(heldOrderStatusLine(order({ state: 'scheduled', payoutReleaseAt: '2026-10-13T12:00:00Z' }), now, 'UTC')).toBe('Paid Oct 13');
  });

  it('says paying out once the release date has passed', () => {
    expect(heldOrderStatusLine(order({ state: 'scheduled', payoutReleaseAt: '2026-10-09T12:00:00Z' }), now)).toBe('Paying out');
  });

  it('waits for delivery, naming pre-orders', () => {
    expect(heldOrderStatusLine(order({}), now)).toBe('Waiting for delivery');
    expect(heldOrderStatusLine(order({ isPreorder: true }), now)).toBe('Pre-order, waiting for delivery');
  });

  it('explains pauses and ship-time releases', () => {
    expect(heldOrderStatusLine(order({ state: 'paused' }), now)).toBe('On hold while a return or chargeback is open');
    expect(heldOrderStatusLine(order({ state: 'on_ship', isPreorder: true }), now)).toBe('Pre-order, paid when it ships');
    expect(heldOrderStatusLine(order({ state: 'on_ship' }), now)).toBe('Paid when it ships');
  });
});

describe('buildHeldForDeliveryView', () => {
  it('shows the rule with a zero total for a new seller', () => {
    const view = buildHeldForDeliveryView(null);
    expect(view).toMatchObject({ visible: true, label: 'Held until delivery', amount: '$0.00', rule: 'Paid 3 days after delivery', orders: [] });
  });

  it('caps the order list and counts the rest', () => {
    const orders = [1, 2, 3, 4, 5].map((n) => order({ orderId: `o${n}`, orderNumber: `#10${n}` }));
    const view = buildHeldForDeliveryView({ held: { amount: 21250, formatted: '', drops: [], orders } }, { now });
    expect(view.orders).toHaveLength(3);
    expect(view.orders[0]).toEqual({ id: 'o1', title: 'Order #101', status: 'Waiting for delivery', amount: '$42.50' });
    expect(view.moreCount).toBe(2);
    expect(view.amount).toBe('$212.50');
  });

  it('hides when nothing is held and payouts are not held for delivery', () => {
    const view = buildHeldForDeliveryView({ held: { amount: 0, formatted: '', drops: [], rule: { ...DEFAULT_PAYOUT_HOLD_RULE, mode: 'immediate' }, orders: [] } });
    expect(view.visible).toBe(false);
  });

  it('names the soonest dated payout, summing orders paid that day', () => {
    const orders = [
      order({ orderId: 'a', state: 'scheduled', payoutReleaseAt: '2026-10-14T12:00:00Z', netCents: 1000 }),
      order({ orderId: 'b', state: 'scheduled', payoutReleaseAt: '2026-10-12T12:00:00Z', netCents: 4250 }),
      order({ orderId: 'c', state: 'scheduled', payoutReleaseAt: '2026-10-12T15:00:00Z', netCents: 750 }),
      order({ orderId: 'd', state: 'awaiting_delivery' }),
    ];
    const view = buildHeldForDeliveryView({ held: { amount: 6000, formatted: '', drops: [], orders } }, { now, timeZone: 'UTC' });
    expect(view.next).toBe('Next $50.00 on Oct 12');
    expect(buildHeldForDeliveryView({ held: { amount: 0, formatted: '', drops: [], orders: [order({})] } }, { now }).next).toBeNull();
  });

  it('demo data sums to its total', () => {
    const demo = previewHeldForDelivery(now);
    expect(demo.held.amount).toBe(demo.held.orders!.reduce((s, o) => s + o.netCents, 0));
  });
});
