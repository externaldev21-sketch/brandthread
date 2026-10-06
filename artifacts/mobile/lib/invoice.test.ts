import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-print', () => ({ printToFileAsync: vi.fn() }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: vi.fn(), shareAsync: vi.fn() }));

import { buildInvoiceHtml, invoiceFromBuyerOrder, type InvoiceInput } from './invoice';

const base: InvoiceInput = {
  orderNumber: 'BT-1', issuedAt: '2026-09-01T12:00:00Z', sellerName: 'Acme <Co>',
  billTo: ['Sam'], shipTo: ['Sam', '1 Main St', 'Austin, TX 78701', 'US'],
  items: [{ name: 'Tee "Classic"', variant: 'M', quantity: 2, unitPriceCents: 2500 }],
  subtotalCents: 5000, discountCents: 500, shippingCents: 800, taxCents: 0, totalCents: 5300, paidCents: 5300, refundedCents: 0, currency: 'USD',
};

describe('buildInvoiceHtml', () => {
  it('lists line totals and the money summary', () => {
    const html = buildInvoiceHtml(base);
    expect(html).toContain('$25.00');
    expect(html).toContain('$50.00');
    expect(html).toContain('-$5.00');
    expect(html).toContain('$53.00');
    expect(html).toContain('2026-09-01');
  });
  it('escapes seller and product text', () => {
    const html = buildInvoiceHtml(base);
    expect(html).toContain('Acme &lt;Co&gt;');
    expect(html).toContain('Tee &quot;Classic&quot;');
    expect(html).not.toContain('<Co>');
  });
  it('omits zero tax, discount and refund rows', () => {
    const html = buildInvoiceHtml({ ...base, discountCents: 0 });
    expect(html).not.toContain('>Tax<');
    expect(html).not.toContain('Discounts');
    expect(html).not.toContain('Refunded');
  });
});

describe('invoiceFromBuyerOrder', () => {
  it('folds Thread Cash into discounts and marks paid only when paidAt is set', () => {
    const order = {
      orderNumber: 'BT-2', createdAt: '2026-09-02T00:00:00Z', sellerName: 'S',
      lineItems: [{ productName: 'Hat', quantity: 1, unitPriceCents: 3000 }],
      shippingAddress: { name: 'Sam', line1: '1 Main', city: 'Austin', state: 'TX', zip: '78701', country: 'US' },
      payment: { subtotalCents: 3000, shippingTotalCents: 0, totalCents: 2500, discountCents: 200, threadCashCents: 300 },
    };
    expect(invoiceFromBuyerOrder(order)).toMatchObject({ discountCents: 500, paidCents: 0 });
    expect(invoiceFromBuyerOrder({ ...order, paidAt: '2026-09-02T01:00:00Z' }).paidCents).toBe(2500);
  });
});
