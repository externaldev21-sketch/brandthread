import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-print', () => ({ printToFileAsync: vi.fn() }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: vi.fn(), shareAsync: vi.fn() }));

import { buildPackingSlipHtml } from './packingSlip';
import type { Order } from '@/services/orderTypes';

function order(extra: Partial<Order> = {}): Order {
  return {
    orderNumber: 'BT-00042',
    sellerName: 'Northline',
    customer: {
      shippingAddress: { name: 'Sam Lee', line1: '148 Mercer Street', city: 'New York', state: 'NY', zip: '10012', country: 'US' },
    },
    lineItems: [
      { id: 'li1', productName: 'Merino Crew', variant: 'M', quantity: 2, unitPriceCents: 6800 },
      { id: 'li2', productName: 'Wool Beanie', variant: '', quantity: 1, unitPriceCents: 3200 },
    ],
    payment: { subtotalCents: 16800, totalCents: 18144 },
    notes: [],
    ...extra,
  } as unknown as Order;
}

describe('buildPackingSlipHtml', () => {
  it('lists prices on a regular packing slip', () => {
    const html = buildPackingSlipHtml(order());
    expect(html).toContain('Northline');
    expect(html).toContain('>Price<');
    expect(html).toContain('$68.00');
    expect(html).toContain('$32.00');
    expect(html).not.toContain('Gift receipt');
  });

  it('prints a gift order as a gift receipt with no prices or totals', () => {
    const html = buildPackingSlipHtml(order({
      gift: { to: 'Sam Lee', from: 'Alex <Kim>', message: 'Happy birthday.\nSee you soon' },
    }));
    expect(html).toContain('<h1>Gift receipt</h1>');
    expect(html).toContain('Northline · Order #BT-00042');
    expect(html).toContain('<strong>To:</strong> Sam Lee');
    expect(html).toContain('<strong>From:</strong> Alex &lt;Kim&gt;');
    expect(html).toContain('Happy birthday.<br/>See you soon');
    expect(html).toContain('Merino Crew');
    expect(html).not.toContain('Price');
    expect(html).not.toMatch(/\$\d/);
    expect(html).not.toContain('181.44');
  });

  it('a gift with no note still hides prices', () => {
    const html = buildPackingSlipHtml(order({ gift: { to: null, from: null, message: null } }));
    expect(html).toContain('Gift receipt');
    expect(html).not.toMatch(/\$\d/);
    expect(html).not.toContain('class="note gift"');
  });
});
