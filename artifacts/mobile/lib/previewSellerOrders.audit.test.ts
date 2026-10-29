import { describe, expect, it } from 'vitest';
import { getGeneratedSellerOrder, previewSellerOrders } from './previewSellerOrders';

describe('demo seller order numbers (audit)', () => {
  it('gives every demo order its own order number', () => {
    const rows = previewSellerOrders(new Date(2026, 9, 29, 20), 100_000);
    expect(rows.length).toBeGreaterThan(1000);
    const numbers = rows.map((r) => r.orderNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('still resolves a generated order (random and world) by id', () => {
    const now = new Date(2026, 9, 29, 20);
    const rows = previewSellerOrders(now, 200);
    const world = rows.find((r) => /-90\d$/.test(r.id))!;
    const random = rows.find((r) => !/-90\d$/.test(r.id))!;
    expect(getGeneratedSellerOrder(world.id, now)?.orderNumber).toBe(world.orderNumber);
    expect(getGeneratedSellerOrder(random.id, now)?.orderNumber).toBe(random.orderNumber);
  });
});
