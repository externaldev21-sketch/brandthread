import { beforeEach, describe, expect, it, vi } from 'vitest';

const { serviceRequest } = vi.hoisted(() => ({ serviceRequest: vi.fn() }));

vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(), setItem: vi.fn() } }));
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest }));
vi.mock('@/lib/devPreview', () => ({
  isSellerDevPreview: () => false, isBuyerDevPreview: () => false, isPreviewDemoMode: () => false,
}));

import { exportOrdersCsv, voidShippingLabel } from './orderService';
import type { Order } from './orderTypes';

describe('orderService (audit)', () => {
  beforeEach(() => serviceRequest.mockReset());

  it('maps the snake_case row a repeated void returns (label already voided)', async () => {
    // POST /api/shipping-labels/:orderId/:labelId/void answers a duplicate with the raw SQL row.
    serviceRequest.mockResolvedValue({
      label: {
        id: 'lbl-1', carrier: 'USPS', service: 'Priority', status: 'voided',
        tracking_number: '9400', label_url: 'https://l/1.pdf', price_cents: 845, created_at: '2026-10-01T00:00:00.000Z',
      },
      duplicate: true,
    });
    const label = await voidShippingLabel('order-1', 'lbl-1');
    expect(label).toMatchObject({
      status: 'voided', trackingNumber: '9400', labelUrl: 'https://l/1.pdf', priceCents: 845,
      purchasedAt: '2026-10-01T00:00:00.000Z', refundPending: false,
    });
  });

  it('quotes CSV cells so a $1,000+ total or a comma in a name stays one column', async () => {
    const order = {
      orderNumber: 'BT-1', customer: { name: 'Lee, Ana' }, createdAt: '2026-10-01T00:00:00.000Z',
      payment: { totalCents: 123456 }, paymentStatus: 'paid', fulfillmentStatus: 'unfulfilled',
    } as unknown as Order;
    const [, row] = (await exportOrdersCsv([order])).split('\n');
    expect(row.split('","')).toHaveLength(6);
    expect(row).toContain('"Lee, Ana"');
    expect(row).toContain('"$1,234.56"');
  });
});
