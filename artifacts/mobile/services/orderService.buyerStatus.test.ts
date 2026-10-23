import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(), setItem: vi.fn() } }));
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest: vi.fn() }));
vi.mock('@/lib/devPreview', () => ({ isSellerDevPreview: () => false, isBuyerDevPreview: () => false }));

import { mapBuyerOrderStatus } from './orderService';

describe('mapBuyerOrderStatus — buyer progress dots follow the real order state', () => {
  it.each([
    ['pending', 'new'],
    ['processing', 'processing'],
    ['fulfilled', 'ready_to_ship'],
    ['label_purchasing', 'ready_to_ship'],
    ['shipped', 'shipped'],
    ['delivered', 'delivered'],
    ['cancelled', 'cancelled'],
    ['refund_pending', 'refunded'],
  ])('maps %s to %s', (db, ui) => {
    expect(mapBuyerOrderStatus(db)).toBe(ui);
  });
});
