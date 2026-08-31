import { beforeEach, describe, expect, it, vi } from 'vitest';

const { storage, serviceRequest } = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  serviceRequest: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
    multiGet: vi.fn(async (keys: string[]) => keys.map(key => [key, storage.get(key) ?? null])),
  },
}));

vi.mock('@/lib/serviceConfig', () => ({
  serviceRequest,
}));

import { getBuyerOrdersWithStatus } from './orderService';

const buyerAOrder = {
  id: 'order-a',
  orderNumber: 'BT-A',
  ownerId: 'seller-a',
  sellerDisplayName: 'Seller A',
  status: 'pending',
  totalCents: 2400,
  subtotalCents: 2000,
  shippingCents: 400,
  stripePaymentIntentId: 'pi_a',
  shippingAddress: {
    name: 'Buyer A',
    street: '1 Private Lane',
    city: 'Portland',
    state: 'OR',
    zip: '97201',
    country: 'US',
  },
  createdAt: '2026-08-28T12:00:00.000Z',
};

describe('buyer order cache account boundary', () => {
  beforeEach(() => {
    storage.clear();
    serviceRequest.mockReset();
  });

  it('never returns Buyer A orders to Buyer B after an account switch and API failure', async () => {
    serviceRequest.mockResolvedValueOnce([buyerAOrder]);
    const buyerAResult = await getBuyerOrdersWithStatus('buyer-a');

    expect(buyerAResult.orders).toHaveLength(1);
    expect(buyerAResult.fromCache).toBe(false);

    serviceRequest.mockRejectedValueOnce(new Error('offline'));
    const buyerBResult = await getBuyerOrdersWithStatus('buyer-b');

    expect(buyerBResult.orders).toEqual([]);
    expect(buyerBResult.fromCache).toBe(true);
    expect(buyerBResult.error).toBeInstanceOf(Error);
  });
});

describe('buyer order cancellation context', () => {
  beforeEach(() => {
    storage.clear();
    serviceRequest.mockReset();
  });

  it('preserves cancellationReason from the buyer orders API response', async () => {
    serviceRequest.mockResolvedValueOnce([{
      id: 'cancelled-order',
      orderNumber: 'BT-CANCELLED',
      ownerId: 'seller-a',
      sellerDisplayName: 'Seller A',
      status: 'cancelled',
      totalCents: 2400,
      subtotalCents: 2000,
      shippingCents: 400,
      stripePaymentIntentId: 'pi_cancelled',
      cancellationReason: 'buyer_requested',
      createdAt: '2026-08-30T12:00:00.000Z',
    }]);

    const result = await getBuyerOrdersWithStatus('buyer-a');

    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'buyer_requested',
    });
  });
});
