import { describe, expect, it } from 'vitest';
import { RETURN_WINDOW_DAYS, deliveredAtMs, openReturnWindow } from '@/lib/returnWindow';

const DAY = 24 * 60 * 60 * 1000;
const ordered = '2026-09-01T12:00:00.000Z';
const delivered = '2026-09-15T12:00:00.000Z';
const at = (iso: string, days = 0) => new Date(iso).getTime() + days * DAY;

describe('return window (buyer return request)', () => {
  it('runs 30 days from delivery, not from the order date', () => {
    const w = openReturnWindow({ createdAt: ordered, delivery: { deliveredAt: delivered } }, at(delivered, 1));
    expect(w).toEqual({ deadline: new Date(at(delivered, RETURN_WINDOW_DAYS)).toISOString(), fromDelivery: true });
  });

  it('still open after 30 days from the order date when delivery came later', () => {
    const now = at(ordered, 35);
    expect(openReturnWindow({ createdAt: ordered }, now)).toBeNull();
    expect(openReturnWindow({ createdAt: ordered, delivery: { deliveredAt: delivered } }, now)).not.toBeNull();
  });

  it('falls back to the order date when no delivery date is known', () => {
    const w = openReturnWindow({ createdAt: ordered, delivery: { deliveredAt: null, steps: [], events: [] } }, at(ordered, 2));
    expect(w).toEqual({ deadline: new Date(at(ordered, 30)).toISOString(), fromDelivery: false });
  });

  it('is hidden (null) once the window has passed, including the exact deadline', () => {
    const order = { createdAt: ordered, delivery: { deliveredAt: delivered } };
    expect(openReturnWindow(order, at(delivered, 30))).toBeNull();
    expect(openReturnWindow(order, at(delivered, 31))).toBeNull();
    expect(openReturnWindow(order, at(delivered, 29))).not.toBeNull();
  });

  it('is null with no usable dates', () => {
    expect(openReturnWindow(null)).toBeNull();
    expect(openReturnWindow({ createdAt: 'not a date' })).toBeNull();
    expect(openReturnWindow({})).toBeNull();
  });

  it('reads the delivered timeline step, then a delivered event, then the latest shipment', () => {
    expect(deliveredAtMs({ steps: [{ key: 'delivered', state: 'done', at: delivered }] })).toBe(at(delivered));
    expect(deliveredAtMs({ steps: [{ key: 'delivered', state: 'upcoming', at: null }] })).toBeNull();
    expect(deliveredAtMs({ events: [{ status: 'in_transit', at: ordered }, { status: 'Delivered', at: delivered }] })).toBe(at(delivered));
    expect(deliveredAtMs({ shipments: [{ deliveredAt: ordered }, { deliveredAt: delivered }, { deliveredAt: null }] })).toBe(at(delivered));
  });
});
