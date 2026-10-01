import { describe, expect, it } from 'vitest';
import {
  breakdownRows, choiceFromSchedule, instantFeeLabel, instantUnavailableReason, nextPayoutLabel,
  payoutStatusLabel, type PayoutDetail, type PayoutScheduleInfo,
} from './payoutScheduleView';

const line = (amount: number) => ({ amount, formatted: `$${(Math.abs(amount) / 100).toFixed(2)}` });
const detail = (over: Partial<NonNullable<PayoutDetail['breakdown']>['lines']> = {}): PayoutDetail => ({
  connected: true,
  payout: null,
  breakdown: {
    lines: {
      sales: line(10_000), platformFee: line(-500), stripeFee: line(-320), refunds: line(0),
      disputes: line(0), holds: line(0), adjustments: line(0), ...over,
    },
    net: line(9_180), reconciled: true, remainder: line(0), transactionCount: 1, truncated: false,
  },
});

describe('payout schedule view helpers', () => {
  it('maps the Stripe interval to a radio choice (manual is Instant)', () => {
    const at = (interval: string | null) => choiceFromSchedule({ schedule: { interval, weeklyAnchor: null, delayDays: null } });
    expect(at('daily')).toBe('daily');
    expect(at('weekly')).toBe('weekly');
    expect(at('manual')).toBe('instant');
    expect(at('monthly')).toBeNull();
    expect(choiceFromSchedule({ schedule: null })).toBeNull();
  });

  it('explains why Instant is unavailable and says nothing when it is', () => {
    const base = { eligible: false, destination: null, feeBps: 100, minFeeCents: 50, maxAmount: null, quote: null };
    expect(instantUnavailableReason({ ...base, reason: 'not_instant_capable' })).toMatch(/debit card/);
    expect(instantUnavailableReason({ ...base, reason: 'payouts_disabled' })).toMatch(/verifying/);
    expect(instantUnavailableReason({ ...base, reason: 'not_connected' })).toMatch(/Connect Stripe/);
    expect(instantUnavailableReason({ ...base, eligible: true, reason: null })).toBeNull();
  });

  it('formats the fee from the server constants', () => {
    expect(instantFeeLabel({ feeBps: 100, minFeeCents: 50 })).toBe('1% fee, minimum $0.50');
    expect(instantFeeLabel({ feeBps: 150, minFeeCents: 50 })).toBe('1.50% fee, minimum $0.50');
  });

  it('drops empty optional breakdown rows but always shows Sales, fees and Net', () => {
    const rows = breakdownRows(detail());
    expect(rows.map((r) => r.key)).toEqual(['sales', 'platformFee', 'stripeFee', 'net']);
    expect(rows[rows.length - 1]).toMatchObject({ label: 'Net payout', strong: true });
    const more = breakdownRows(detail({ refunds: line(-2_000), adjustments: line(40) }));
    expect(more.map((r) => r.key)).toEqual(['sales', 'platformFee', 'stripeFee', 'refunds', 'adjustments', 'net']);
  });

  it('has no rows when the payout has no breakdown (manual payouts)', () => {
    expect(breakdownRows({ connected: true, payout: null, breakdown: null })).toEqual([]);
  });

  it('labels statuses and the next payout', () => {
    expect(payoutStatusLabel('in_transit')).toBe('In transit');
    expect(payoutStatusLabel('canceled')).toBe('Canceled');
    const est = (over: Partial<NonNullable<PayoutScheduleInfo['nextPayoutEstimate']>>) =>
      ({ kind: 'scheduled', date: '2026-10-01T00:00:00.000Z', amount: 500, formatted: '$5.00', ...over });
    expect(nextPayoutLabel(est({}))).toBe('$5.00 around Oct 1, 2026');
    expect(nextPayoutLabel(est({ kind: 'manual', date: null }))).toMatch(/^Manual/);
    expect(nextPayoutLabel(est({ kind: 'none', date: null }))).toBeNull();
    expect(nextPayoutLabel(null)).toBeNull();
  });
});
