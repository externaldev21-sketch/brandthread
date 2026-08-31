import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();

const { getItem, setItem } = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem,
    setItem,
  },
}));

import {
  getBadgeCount,
  getLastViewedAt,
  setBadgeCount,
} from './orderBadgeStore';
import {
  getSellerOrderBadgeCount,
  openSellerOrders,
  SELLER_ORDERS_ROUTE,
} from './sellerOrderBadge';

describe('seller order badge contract', () => {
  beforeEach(() => {
    storage.clear();
    getItem.mockImplementation(async (key: string) => storage.get(key) ?? null);
    setItem.mockImplementation(async (key: string, value: string) => {
      storage.set(key, value);
    });
  });

  it('gives home and the Orders tab the same unseen count for one seller', () => {
    const sellerId = 'seller-badge-parity';
    setBadgeCount(sellerId, 4, 1);

    const homeRowCount = getSellerOrderBadgeCount(sellerId);
    const ordersTabBadgeCount = getSellerOrderBadgeCount(sellerId);

    expect(homeRowCount).toBe(4);
    expect(ordersTabBadgeCount).toBe(homeRowCount);
  });

  it('clears the seller count before navigating from the home row', () => {
    const sellerId = 'seller-open-orders';
    setBadgeCount(sellerId, 2, 1);
    const navigation = vi.fn(() => {
      expect(getSellerOrderBadgeCount(sellerId)).toBe(0);
    });

    openSellerOrders(sellerId, navigation);

    expect(navigation).toHaveBeenCalledWith(SELLER_ORDERS_ROUTE);
    expect(navigation).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledWith(
      `bt:orders:lastViewed:${sellerId}`,
      expect.any(String),
    );
  });

  it('keeps badge watermarks isolated when sellers share a device', async () => {
    const sellerA = 'seller-storage-a';
    const sellerB = 'seller-storage-b';
    storage.set(`bt:orders:lastViewed:${sellerA}`, '100');
    storage.set(`bt:orders:lastViewed:${sellerB}`, '200');

    const { initFromStorage } = await import('./orderBadgeStore');
    await initFromStorage(sellerA);
    await initFromStorage(sellerB);

    expect(getLastViewedAt(sellerA)).toBe(100);
    expect(getLastViewedAt(sellerB)).toBe(200);

    setBadgeCount(sellerA, 3, 201);
    expect(getBadgeCount(sellerA)).toBe(3);
    expect(getBadgeCount(sellerB)).toBe(0);
    expect(getSellerOrderBadgeCount(sellerB)).toBe(0);
    expect(getItem).toHaveBeenCalledWith(`bt:orders:lastViewed:${sellerA}`);
    expect(getItem).toHaveBeenCalledWith(`bt:orders:lastViewed:${sellerB}`);
  });
});