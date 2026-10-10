import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/serviceConfig', () => ({ serviceRequest: vi.fn() }));

import {
  combineSchedule, describeLiveCode, pinnedProductIdFromRow, scheduleDayOptions, scheduleTimeOptions,
} from '@/lib/live/liveCommerce';
import {
  clearLiveCheckoutContext, getLiveCheckoutContext, setLiveCheckoutContext,
} from '@/lib/live/liveCheckoutContext';
import { paymentGroups } from '@/lib/checkoutPayment';

const tags = [{ productId: 'a' }, { productId: 'b', highlighted: true }];

describe('pinnedProductIdFromRow', () => {
  it('prefers the explicit pin', () => {
    expect(pinnedProductIdFromRow({ product_tags: tags, pinned_product_id: 'a', pin_updated_at: '2026-01-01' })).toBe('a');
  });
  it('an explicit unpin means nothing is pinned (no fallback to the first product)', () => {
    expect(pinnedProductIdFromRow({ product_tags: tags, pinned_product_id: null, pin_updated_at: '2026-01-01' })).toBeNull();
  });
  it('ignores a pin whose product was untagged', () => {
    expect(pinnedProductIdFromRow({ product_tags: tags, pinned_product_id: 'zzz', pin_updated_at: '2026-01-01' })).toBeNull();
  });
  it('legacy streams fall back to the highlighted tag, then the first product', () => {
    expect(pinnedProductIdFromRow({ product_tags: tags })).toBe('b');
    expect(pinnedProductIdFromRow({ product_tags: [{ productId: 'a' }] })).toBe('a');
    expect(pinnedProductIdFromRow({ product_tags: [] })).toBeNull();
  });
});

describe('describeLiveCode', () => {
  it('reads plainly for each type', () => {
    expect(describeLiveCode({ type: 'percentage', value: 15 })).toBe('15% off');
    expect(describeLiveCode({ type: 'fixed', value: 5 })).toBe('$5.00 off');
    expect(describeLiveCode({ type: 'free_shipping', value: 0 })).toBe('Free shipping');
  });
});

describe('live checkout context', () => {
  it('only applies to the seller of the live and expires', () => {
    clearLiveCheckoutContext();
    expect(getLiveCheckoutContext('s1')).toBeNull();
    setLiveCheckoutContext({ streamId: 'st1', sellerId: 's1' });
    expect(getLiveCheckoutContext('s1')?.streamId).toBe('st1');
    expect(getLiveCheckoutContext('other')).toBeNull();
    expect(getLiveCheckoutContext('s1', Date.now() + 5 * 3_600_000)).toBeNull();
    clearLiveCheckoutContext();
  });
  it('keeps a tapped code across a re-set on the same stream, drops it on another', () => {
    setLiveCheckoutContext({ streamId: 'st1', sellerId: 's1', code: 'LIVE15' });
    setLiveCheckoutContext({ streamId: 'st1', sellerId: 's1' });
    expect(getLiveCheckoutContext('s1')?.code).toBe('LIVE15');
    setLiveCheckoutContext({ streamId: 'st2', sellerId: 's1' });
    expect(getLiveCheckoutContext('s1')?.code).toBeNull();
    clearLiveCheckoutContext();
  });
  it('payment groups carry liveStreamId only with a code and a matching live', () => {
    const session: any = {
      deliveryGroups: [{ sellerId: 's1', items: [{ variantId: 'v', productId: 'p', quantity: 1 }] }],
      discounts: [{ code: 'LIVE15', isValid: true }],
    };
    expect(paymentGroups(session)[0]).not.toHaveProperty('liveStreamId');
    setLiveCheckoutContext({ streamId: 'st1', sellerId: 's1' });
    expect(paymentGroups(session)[0]).toMatchObject({ discountCode: 'LIVE15', liveStreamId: 'st1' });
    expect(paymentGroups({ ...session, discounts: [] })[0]).not.toHaveProperty('liveStreamId');
    clearLiveCheckoutContext();
  });
});

describe('schedule pickers', () => {
  it('lists today first, then consecutive days', () => {
    const days = scheduleDayOptions(new Date(2026, 9, 1, 15, 0), 3);
    expect(days.map(d => d.label).slice(0, 2)).toEqual(['Today', 'Tomorrow']);
    expect(days[2].date.getDate()).toBe(3);
  });
  it('offers half-hour slots across the day', () => {
    const t = scheduleTimeOptions();
    expect(t).toHaveLength(48);
    expect(t[0].label).toBe('12:00 AM');
    expect(t[27].label).toBe('1:30 PM');
  });
  it('combines a day and slot in local time', () => {
    const d = combineSchedule(new Date(2026, 9, 1), { hour: 19, minute: 30 });
    expect([d.getHours(), d.getMinutes(), d.getDate()]).toEqual([19, 30, 1]);
  });
});
