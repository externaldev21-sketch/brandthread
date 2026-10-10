import { describe, expect, it } from 'vitest';
import { buildPreviewPayouts } from './previewPayouts';

const now = new Date('2026-10-09T12:00:00Z');

describe('buildPreviewPayouts', () => {
  it('fresh preview is an honest empty account', () => {
    const fresh = buildPreviewPayouts(false, now);
    expect(fresh.available.amount).toBe(0);
    expect(fresh.payouts).toEqual([]);
    expect(fresh.nextPayout).toBeNull();
    expect(fresh.bankLast4).toBeNull();
  });

  it('demo shows the dashboard preview balance, a next payout and newest-first history', () => {
    const demo = buildPreviewPayouts(true, now);
    expect(demo.available.formatted).toBe('$4,281.22');
    expect(demo.nextPayout!.arrivalDate > now.toISOString()).toBe(true);
    expect(demo.payouts[0].status).toBe('in_transit');
    const dates = demo.payouts.map((p) => p.arrivalDate);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});
