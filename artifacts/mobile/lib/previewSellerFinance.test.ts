import { describe, expect, it } from 'vitest';
import { buildDemoSellerFinance, demoProcessingFeeCents } from './previewSellerFinance';
import { buildDemoSellerOrders } from './previewDeliveryOrders';

describe('buildDemoSellerFinance', () => {
  const { balance, transactions } = buildDemoSellerFinance();

  it('has one charge per paid demo seller order, net of the processing fee', () => {
    const orders = buildDemoSellerOrders().filter((o) => o.paidAt);
    const charges = transactions.filter((t) => t.type === 'charge');
    expect(charges).toHaveLength(orders.length);
    for (const c of charges) {
      expect(c.fee).toBe(demoProcessingFeeCents(c.amount));
      expect(c.net).toBe(c.amount - c.fee);
    }
  });

  it('refunds the auto-refunded order', () => {
    const refunded = buildDemoSellerOrders().filter((o) => o.autoRefundedAt);
    const refunds = transactions.filter((t) => t.type === 'refund');
    expect(refunds).toHaveLength(refunded.length);
    expect(refunds.every((r) => r.net < 0 && r.fee === 0)).toBe(true);
  });

  it('balance is exactly the sum of the transactions', () => {
    const total = transactions.reduce((sum, t) => sum + t.net, 0);
    expect(balance.available.amount + balance.pending.amount).toBe(total);
    expect(balance.available.amount).toBeGreaterThan(0);
    expect(balance.connected).toBe(true);
    expect(balance.nextPayout?.amount).toBe(balance.available.amount);
  });

  it('lists the newest movement first', () => {
    const times = transactions.map((t) => t.created);
    expect([...times].sort().reverse()).toEqual(times);
  });
});
