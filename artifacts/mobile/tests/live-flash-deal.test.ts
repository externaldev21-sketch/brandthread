import { describe, expect, it } from 'vitest';
import {
  FLASH_DEAL_DURATIONS, activeDeals, dealRemainingMs, formatDealCountdown, upsertDeal,
} from '@/lib/live/flashDeal';

const NOW = Date.parse('2026-10-13T12:00:00.000Z');

describe('flash deal timer', () => {
  it('offers no timer, 5, 10 and 15 minutes (the server accepts the same)', () => {
    expect(FLASH_DEAL_DURATIONS.map(d => d.minutes)).toEqual([null, 5, 10, 15]);
  });
  it('counts down from the server expiry and never goes negative', () => {
    expect(dealRemainingMs('2026-10-13T12:10:00.000Z', NOW)).toBe(600_000);
    expect(dealRemainingMs('2026-10-13T11:59:00.000Z', NOW)).toBe(0);
    expect(dealRemainingMs(null, NOW)).toBeNull();
    expect(dealRemainingMs('garbage', NOW)).toBeNull();
  });
  it('formats mm:ss, rounding up so a live deal never reads 0:00', () => {
    expect(formatDealCountdown(600_000)).toBe('10:00');
    expect(formatDealCountdown(599_001)).toBe('10:00');
    expect(formatDealCountdown(65_000)).toBe('1:05');
    expect(formatDealCountdown(400)).toBe('0:01');
    expect(formatDealCountdown(0)).toBe('0:00');
  });
  it('drops expired deals and keeps untimed codes', () => {
    const codes = [
      { id: 'a', expiresAt: '2026-10-13T12:05:00.000Z' },
      { id: 'b', expiresAt: '2026-10-13T11:59:59.000Z' },
      { id: 'c', expiresAt: null },
    ];
    expect(activeDeals(codes, NOW).map(c => c.id)).toEqual(['a', 'c']);
  });
  it('adds a new deal from the socket on top, replacing the same id', () => {
    const list = [{ id: 'a', v: 1 }, { id: 'b', v: 1 }];
    expect(upsertDeal(list, { id: 'b', v: 2 })).toEqual([{ id: 'b', v: 2 }, { id: 'a', v: 1 }]);
  });
});
