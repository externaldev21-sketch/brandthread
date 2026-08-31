import { describe, expect, it } from 'vitest';
import { BUYER_CANCELLABLE_STATUSES, BUYER_CANCELLATION_WINDOW_MS, canBuyerCancel } from '../services/orderPolicy';

describe('commerce account policy surfaces', () => {
  it('never offers buyer cancellation for shipped or delivered orders', () => {
    expect(BUYER_CANCELLABLE_STATUSES).toEqual(['new', 'processing', 'ready_to_ship']);
    expect(BUYER_CANCELLABLE_STATUSES).not.toContain('shipped');
    expect(BUYER_CANCELLABLE_STATUSES).not.toContain('delivered');
  });

  it('allows the exact day-21 boundary and rejects day 22', () => {
    const now = Date.UTC(2026, 7, 31, 12);
    expect(canBuyerCancel('new', new Date(now - BUYER_CANCELLATION_WINDOW_MS).toISOString(), now)).toBe(true);
    expect(canBuyerCancel('new', new Date(now - BUYER_CANCELLATION_WINDOW_MS - 1).toISOString(), now)).toBe(false);
  });
});