import { describe, expect, it } from 'vitest';
import {
  MAX_ORDER_ACTIVITIES, etaToEpoch, orderActivityState, planNotificationAction, planOrderActivities,
  quickActionsFor, routeForQuickAction, type TrackableOrder,
} from '../nativeSystemLogic';

const base: TrackableOrder = { id: 'o1', orderNumber: 'BT-1', sellerName: 'Northline', status: 'processing' };

describe('orderActivityState (Uber Eats / Amazon stages)', () => {
  it('has no activity before the order ships', () => {
    expect(orderActivityState(base)).toBeNull();
  });
  it('shipped → Shipped with the ETA', () => {
    const s = orderActivityState({ ...base, status: 'shipped', estimatedDelivery: '2026-10-15' });
    expect(s?.stage).toBe('shipped');
    expect(s?.statusText).toBe('Shipped');
    expect(s?.etaEpoch).toBe(etaToEpoch('2026-10-15'));
  });
  it('carrier tracking out_for_delivery wins over shipped', () => {
    expect(orderActivityState({ ...base, status: 'shipped', trackingStatus: 'out_for_delivery' })?.stage).toBe('out_for_delivery');
    expect(orderActivityState({ ...base, status: 'shipped', delivery: { steps: [{ key: 'out_for_delivery', state: 'current' }] } })?.stage).toBe('out_for_delivery');
  });
  it('delivered from status, tracking or deliveredAt', () => {
    expect(orderActivityState({ ...base, status: 'delivered' })?.stage).toBe('delivered');
    expect(orderActivityState({ ...base, status: 'shipped', trackingStatus: 'delivered' })?.stage).toBe('delivered');
    expect(orderActivityState({ ...base, status: 'shipped', delivery: { deliveredAt: '2026-10-10T10:00:00Z' } })?.stage).toBe('delivered');
  });
  it('cancelled / refunded / disputed / auto-refunded orders get none', () => {
    for (const status of ['cancelled', 'refunded', 'disputed']) expect(orderActivityState({ ...base, status })).toBeNull();
    expect(orderActivityState({ ...base, status: 'shipped', delivery: { autoRefund: { partial: false } } })).toBeNull();
  });
});

describe('etaToEpoch', () => {
  it('reads date-only values as the end of that day, and rejects junk', () => {
    expect(etaToEpoch('2026-10-15')).toBe(Math.round(Date.parse('2026-10-15T23:59:00') / 1000));
    expect(etaToEpoch('2026-10-15T15:30:00Z')).toBe(Math.round(Date.parse('2026-10-15T15:30:00Z') / 1000));
    expect(etaToEpoch('soon')).toBeNull();
    expect(etaToEpoch(null)).toBeNull();
  });
});

describe('planOrderActivities', () => {
  it('starts in-transit orders, ends delivered/cancelled ones that are running, ignores the rest', () => {
    const orders: TrackableOrder[] = [
      { ...base, id: 'a', status: 'shipped' },
      { ...base, id: 'b', status: 'delivered' },
      { ...base, id: 'c', status: 'cancelled' },
      { ...base, id: 'd', status: 'delivered' },
      { ...base, id: 'e', status: 'processing' },
    ];
    const plans = planOrderActivities(orders, ['b', 'c']);
    expect(plans.map((p) => [p.kind, p.kind === 'start' ? p.order.id : p.orderId])).toEqual([
      ['start', 'a'], ['end', 'b'], ['end', 'c'],
    ]);
  });
  it('caps new activities but keeps updating ones already running', () => {
    const orders = Array.from({ length: 6 }, (_, i) => ({ ...base, id: `o${i}`, status: 'shipped' }));
    const plans = planOrderActivities(orders, ['o5']);
    const started = plans.filter((p) => p.kind === 'start').map((p) => (p.kind === 'start' ? p.order.id : ''));
    expect(started).toContain('o5');
    expect(started.length).toBe(MAX_ORDER_ACTIVITIES + 1);
    expect(planOrderActivities(orders, []).length).toBe(MAX_ORDER_ACTIVITIES);
  });
});

describe('quick actions', () => {
  it('seller gets New post, Add product, Orders, Search; buyer has no Add product', () => {
    expect(quickActionsFor('seller').map((a) => a.title)).toEqual(['New post', 'Add product', 'Orders', 'Search']);
    expect(quickActionsFor('buyer').map((a) => a.type)).not.toContain('add-product');
    expect(quickActionsFor(null)).toEqual([]);
    expect(routeForQuickAction('orders', 'seller')).toBe('/orders');
    expect(routeForQuickAction('add-product', 'buyer')).toBeNull();
  });
});

describe('planNotificationAction', () => {
  it('reply sends the typed text to the conversation', () => {
    expect(planNotificationAction({ actionIdentifier: 'reply', userText: ' On my way ', data: { conversationId: 'c1' } }))
      .toEqual({ kind: 'send-reply', conversationId: 'c1', text: 'On my way' });
    expect(planNotificationAction({ actionIdentifier: 'reply', userText: '   ', data: { conversationId: 'c1' } })).toEqual({ kind: 'none' });
  });
  it('mark shipped opens the fulfil flow for that order', () => {
    expect(planNotificationAction({ actionIdentifier: 'mark_shipped', data: { orderId: 'o 1' } }))
      .toEqual({ kind: 'open', route: '/fulfill-order?orderId=o%201' });
    expect(planNotificationAction({ actionIdentifier: 'mark_shipped', data: {} })).toEqual({ kind: 'none' });
  });
});
