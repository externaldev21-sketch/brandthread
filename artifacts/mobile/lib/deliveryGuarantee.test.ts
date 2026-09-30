import { describe, expect, it } from 'vitest';
import {
  autoRefundSummary, deliveryHeadline, formatCalendarDate, formatLocalDate, formatTimeLeft, guaranteeLine,
  mapDelivery, normalizeDeliverySteps, sellerOrderConflictMessage, unshippedItems, preOrderShipDateError, safeTrackingUrl, sellerCountdown, sellerShipByLine,
} from './deliveryGuarantee';
import type { BuyerDelivery } from '@/services/orderTypes';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-10-01T12:00:00Z');

describe('formatLocalDate / guaranteeLine', () => {
  // 02:00 UTC on Oct 15 is still the 14th in Los Angeles.
  const deliverBy = '2026-10-15T02:00:00Z';

  it('renders the same instant on different local dates depending on the zone', () => {
    expect(formatLocalDate(deliverBy, { locale: 'en-US', timeZone: 'America/Los_Angeles' })).toBe('Oct 14, 2026');
    expect(formatLocalDate(deliverBy, { locale: 'en-US', timeZone: 'Pacific/Auckland' })).toBe('Oct 15, 2026');
  });

  it('builds the guarantee line in the given zone', () => {
    expect(guaranteeLine(deliverBy, { locale: 'en-US', timeZone: 'America/Los_Angeles' }))
      .toBe('Guaranteed delivery by Oct 14, 2026 or automatic refund');
    expect(guaranteeLine(deliverBy, { locale: 'en-US', timeZone: 'Asia/Tokyo' }))
      .toBe('Guaranteed delivery by Oct 15, 2026 or automatic refund');
  });

  it('has no line without a usable deadline', () => {
    expect(guaranteeLine(null)).toBeNull();
    expect(guaranteeLine('not a date')).toBeNull();
  });

  it('builds the seller ship-by line', () => {
    expect(sellerShipByLine(deliverBy, { locale: 'en-US', timeZone: 'UTC' }))
      .toBe('Ship and add tracking by Oct 15, 2026 or this order will be auto-refunded');
  });

  it('shows date-only estimates as the calendar day they name, in any zone', () => {
    expect(formatCalendarDate('2026-10-15', { locale: 'en-US', timeZone: 'America/Los_Angeles' })).toBe('Oct 15, 2026');
    expect(formatCalendarDate('2026-10-15', { locale: 'en-US', timeZone: 'Pacific/Auckland' })).toBe('Oct 15, 2026');
  });
});

describe('formatTimeLeft', () => {
  it('uses days + hours above a day', () => {
    expect(formatTimeLeft(12 * DAY + 4 * HOUR + 59 * 60_000)).toBe('12d 4h left');
    expect(formatTimeLeft(DAY)).toBe('1d 0h left');
  });
  it('uses hours + minutes under a day, minutes under an hour', () => {
    expect(formatTimeLeft(5 * HOUR + 12 * 60_000)).toBe('5h 12m left');
    expect(formatTimeLeft(42 * 60_000)).toBe('42m left');
    expect(formatTimeLeft(1_000)).toBe('1m left');
  });
});

describe('sellerCountdown', () => {
  it('counts down and turns urgent under two days', () => {
    const nine = sellerCountdown({ deliverBy: new Date(NOW + 9 * DAY + 3 * HOUR).toISOString() }, false, NOW);
    expect(nine).toMatchObject({ kind: 'left', label: '9d 3h left', urgent: false });
    const soon = sellerCountdown({ deliverBy: new Date(NOW + 2 * DAY - 1).toISOString() }, false, NOW);
    expect(soon?.urgent).toBe(true);
    const edge = sellerCountdown({ deliverBy: new Date(NOW + 2 * DAY).toISOString() }, false, NOW);
    expect(edge?.urgent).toBe(false);
  });

  it('reports overdue and auto-refunded', () => {
    expect(sellerCountdown({ deliverBy: new Date(NOW - 1).toISOString() }, false, NOW))
      .toMatchObject({ kind: 'overdue', label: 'Overdue', urgent: true });
    expect(sellerCountdown({ deliverBy: new Date(NOW - DAY).toISOString(), autoRefundedAt: new Date(NOW).toISOString() }, false, NOW))
      .toMatchObject({ kind: 'refunded', label: 'Auto-refunded' });
  });

  it('has no chip when shipped, delivered, or there is no deadline', () => {
    const deliverBy = new Date(NOW + DAY).toISOString();
    expect(sellerCountdown({ deliverBy }, true, NOW)).toBeNull();
    expect(sellerCountdown({ deliverBy, deliveredAt: new Date(NOW).toISOString() }, false, NOW)).toBeNull();
    expect(sellerCountdown({ deliverBy: null }, false, NOW)).toBeNull();
  });
});

describe('delivery steps and mapping', () => {
  it('always yields the five steps in order, filling gaps as upcoming', () => {
    const steps = normalizeDeliverySteps([
      { key: 'shipped', label: 'Shipped', state: 'current', at: '2026-10-02T10:00:00Z' },
      { key: 'ordered', label: 'Ordered', state: 'done', at: '2026-10-01T10:00:00Z' },
      { key: 'mystery', label: 'X', state: 'done', at: null },
    ]);
    expect(steps.map(s => s.key)).toEqual(['ordered', 'preparing', 'shipped', 'out_for_delivery', 'delivered']);
    expect(steps.map(s => s.state)).toEqual(['done', 'upcoming', 'current', 'upcoming', 'upcoming']);
    expect(steps[1].label).toBe('Preparing');
  });

  it('maps a missing or junk block to undefined', () => {
    expect(mapDelivery(undefined)).toBeUndefined();
    expect(mapDelivery('x')).toBeUndefined();
  });

  it('maps the contract shape defensively', () => {
    const d = mapDelivery({
      deliverBy: '2026-10-16T00:00:00Z', isPreorder: true, promisedShipDate: '2026-10-05T00:00:00Z',
      canConfirmReceipt: true, disputePaused: true,
      events: [{ status: 'in_transit', description: 'Arrived', location: null, at: '2026-10-03T00:00:00Z' }, { bad: true }],
      autoRefund: { refundedCents: 4200, refundedAt: '2026-10-17T00:00:00Z', partial: true, label: 'Refunded, not delivered in time' },
    })!;
    expect(d.isPreorder).toBe(true);
    expect(d.canConfirmReceipt).toBe(true);
    expect(d.events).toHaveLength(1);
    expect(d.autoRefund).toMatchObject({ refundedCents: 4200, partial: true });
    expect(d.steps).toHaveLength(5);
    expect(d.trackingUrl).toBeNull();
  });

  it('only opens http(s) tracking links', () => {
    expect(safeTrackingUrl('https://www.ups.com/track?x=1')).toBe('https://www.ups.com/track?x=1');
    expect(safeTrackingUrl('javascript:alert(1)')).toBeNull();
    expect(safeTrackingUrl(null)).toBeNull();
  });
});

describe('autoRefundSummary / deliveryHeadline', () => {
  const base = { refundedAt: '2026-10-17T12:00:00Z', label: 'Refunded, not delivered in time' };
  const opts = { locale: 'en-US', timeZone: 'UTC' };

  it('words full vs partial refunds', () => {
    expect(autoRefundSummary({ ...base, refundedCents: 12900, partial: false }, opts))
      .toBe('$129.00 was refunded in full to your original payment method. Refunded Oct 17, 2026.');
    expect(autoRefundSummary({ ...base, refundedCents: 4500, partial: true }, opts))
      .toContain("for the items that weren't delivered in time");
  });

  const delivery = (over: Partial<BuyerDelivery>): BuyerDelivery => ({
    ...(mapDelivery({}) as BuyerDelivery), ...over,
  });

  it('picks the list headline', () => {
    expect(deliveryHeadline({ status: 'shipped', delivery: delivery({ autoRefund: { ...base, refundedCents: 1, partial: false } }) }, opts))
      .toEqual({ text: 'Refunded, not delivered in time', tone: 'muted' });
    expect(deliveryHeadline({ status: 'delivered', delivery: delivery({ deliveredAt: '2026-10-12T15:00:00Z' }) }, opts))
      .toEqual({ text: 'Delivered Oct 12, 2026', tone: 'success' });
    expect(deliveryHeadline({ status: 'shipped', estimatedDelivery: '2026-10-15' }, opts))
      .toEqual({ text: 'Arriving Oct 15, 2026', tone: 'neutral' });
    expect(deliveryHeadline({ status: 'processing', delivery: delivery({ isPreorder: true, promisedShipDate: '2026-11-01T12:00:00Z' }) }, opts))
      .toEqual({ text: 'Seller ships by Nov 1, 2026', tone: 'neutral' });
    expect(deliveryHeadline({ status: 'cancelled' }, opts)).toBeNull();
  });
});

describe('preOrderShipDateError', () => {
  const now = new Date(2026, 9, 1, 15, 0); // Oct 1 2026, local

  it('is silent when pre-orders are off', () => {
    expect(preOrderShipDateError(false, '', now)).toBeNull();
  });
  it('requires a value', () => {
    expect(preOrderShipDateError(true, '', now)).toMatch(/required/);
    expect(preOrderShipDateError(true, '   ', now)).toMatch(/required/);
    expect(preOrderShipDateError(true, undefined, now)).toMatch(/required/);
  });
  it('rejects bad formats and impossible dates', () => {
    expect(preOrderShipDateError(true, '10/05/2026', now)).toMatch(/YYYY-MM-DD/);
    expect(preOrderShipDateError(true, '2026-02-30', now)).toMatch(/does not exist/);
  });
  it('requires a future date (today is not enough)', () => {
    expect(preOrderShipDateError(true, '2026-10-01', now)).toMatch(/future/);
    expect(preOrderShipDateError(true, '2026-09-30', now)).toMatch(/future/);
    expect(preOrderShipDateError(true, '2026-10-02', now)).toBeNull();
  });
});

describe('seller conflicts', () => {
  it('explains the 409 codes', () => {
    expect(sellerOrderConflictMessage('AUTO_REFUNDED')).toMatch(/automatically refunded/);
    expect(sellerOrderConflictMessage('DELIVERY_NOT_SELLER_CONFIRMED')).toMatch(/carrier or the buyer/);
    expect(sellerOrderConflictMessage('OTHER')).toBeNull();
    expect(sellerOrderConflictMessage(undefined)).toBeNull();
  });
  it('lists items still to ship', () => {
    const items = [{ id: 'a', trackingNumber: 'T1' }, { id: 'b' }, { id: 'c', refundedAt: '2026-10-01' }];
    expect(unshippedItems(items).map(i => i.id)).toEqual(['b']);
  });
});
