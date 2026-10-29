/**
 * Manufacturer audit fixes: price ranges with thousands separators, and a
 * cancelled / refunded bulk card is not an active, fully paid order.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { serviceRequest } = vi.hoisted(() => ({ serviceRequest: vi.fn() }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('../lib/serviceConfig', () => ({ serviceRequest }));
vi.mock('@/lib/devPreview', () => ({ isPreviewDemoMode: () => false, isSellerDevPreview: () => false }));

import { mapPublicManufacturer } from './manufacturerDirectoryMapper';
import { getProductionOrders } from './manufacturerService';

beforeEach(() => serviceRequest.mockReset());

describe('mapPublicManufacturer price range', () => {
  it('reads "$1,200 - $2,500" as $1,200–$2,500, not $1–$200', () => {
    const m = mapPublicManufacturer({ id: 'x', priceRange: '$1,200 - $2,500' });
    expect([m.unitPriceMinCents, m.unitPriceMaxCents]).toEqual([120_000, 250_000]);
  });

  it('keeps plain ranges and decimals unchanged', () => {
    expect(mapPublicManufacturer({ id: 'x', priceRange: '$8 - $20' }).unitPriceMaxCents).toBe(2000);
    expect(mapPublicManufacturer({ id: 'x', priceRange: '$4.50-$7.25' }).unitPriceMinCents).toBe(450);
  });
});

describe('bulk order status', () => {
  const base = { orderType: 'bulk', manufacturerId: 'm', title: 'Tee run', quantity: 100, priceCents: 50_000, revision: 1, createdAt: '2026-01-01', updatedAt: '2026-01-02' };

  it('a cancelled or refunded card is cancelled with nothing deposited', async () => {
    serviceRequest.mockResolvedValueOnce([
      { ...base, id: 'c', status: 'cancelled' },
      { ...base, id: 'r', status: 'refunded' },
      { ...base, id: 'p', status: 'cut_and_sew' },
    ]);
    const orders = Object.fromEntries((await getProductionOrders()).map((o) => [o.id, o]));
    expect(orders.c).toMatchObject({ status: 'cancelled', depositAmountCents: 0 });
    expect(orders.r).toMatchObject({ status: 'cancelled', depositAmountCents: 0 });
    expect(orders.p).toMatchObject({ status: 'active', depositAmountCents: 50_000 });
  });
});
