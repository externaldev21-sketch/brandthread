import { describe, expect, it } from 'vitest';
import { buildPackingSlipHtml, buildPackingSlipsHtml, packingSlipItems } from './packingSlip';
import type { Order } from '@/services/orderTypes';

function line(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, productId: `p-${id}`, productName: `Item ${id}`, variant: 'Black / M', sku: `SKU-${id}`, quantity: 1,
    unitPriceCents: 2500, discountAmountCents: 0, taxAmountCents: 0, totalCents: 2500,
    fulfillmentSource: 'seller', isPreOrder: false, ...extra,
  };
}

function order(lines: ReturnType<typeof line>[], extra: Record<string, unknown> = {}): Order {
  return {
    id: 'o1', orderNumber: '1001', sellerName: 'Threadhaus',
    customer: { name: 'Sam Lee', shippingAddress: { name: 'Sam Lee', line1: '1 Main St', city: 'Austin', state: 'TX', zip: '78701', country: 'US' } },
    lineItems: lines, notes: [], ...extra,
  } as unknown as Order;
}

describe('packing slip bulk and parcel selection', () => {
  it('lists only the items in this parcel', () => {
    const o = order([line('a'), line('b'), line('c')]);
    expect(packingSlipItems(o, ['b']).map(li => li.id)).toEqual(['b']);
    const html = buildPackingSlipHtml(o, { itemIds: ['b'] });
    expect(html).toContain('Item b');
    expect(html).not.toContain('Item a');
  });

  it('defaults to items not shipped or refunded yet, and to every unrefunded item on a reprint', () => {
    const o = order([line('a', { trackingNumber: '1Z' }), line('b'), line('c', { refundedAt: '2026-01-01' })]);
    expect(packingSlipItems(o).map(li => li.id)).toEqual(['b']);
    const shipped = order([line('a', { trackingNumber: '1Z' }), line('c', { refundedAt: '2026-01-01' })]);
    expect(packingSlipItems(shipped).map(li => li.id)).toEqual(['a']);
  });

  it('shows the variant and SKU on each line', () => {
    const html = buildPackingSlipHtml(order([line('a')]));
    expect(html).toContain('Black / M · SKU SKU-a');
  });

  it('leaves every price off a gift slip', () => {
    const o = order([line('a')]);
    expect(buildPackingSlipHtml(o)).toContain('$25.00');
    const gift = buildPackingSlipHtml(o, { hidePrices: true });
    expect(gift).not.toContain('$25.00');
    expect(gift).not.toContain('>Price<');
  });

  it('puts each order of a bulk print on its own page', () => {
    const html = buildPackingSlipsHtml([order([line('a')]), order([line('b')], { id: 'o2', orderNumber: '1002' })]);
    expect(html.match(/class="slip"/g)).toHaveLength(2);
    expect(html).toContain('Order #1001');
    expect(html).toContain('Order #1002');
    expect(html).toContain('page-break-before');
  });

  it('escapes buyer-provided text', () => {
    const html = buildPackingSlipHtml(order([line('a', { productName: '<b>Tee</b>' })]));
    expect(html).toContain('&lt;b&gt;Tee&lt;/b&gt;');
  });
});
