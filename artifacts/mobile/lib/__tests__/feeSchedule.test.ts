import { describe, expect, it } from 'vitest';
import { bpsOfCents, bpsToPercentLabel, parseFeeSchedule, processingRateLabel, quoteFromSchedule } from '../feeSchedule';

// Test-local fixture only: the app itself has no fee numbers and gets them from the API.
const S = { platformFeeBps: 500, processing: { bps: 290, fixedCents: 30 } };

describe('feeSchedule', () => {
  it('parses only well-formed payloads', () => {
    expect(parseFeeSchedule(S)).toEqual(S);
    expect(parseFeeSchedule(null)).toBeNull();
    expect(parseFeeSchedule({ platformFeeBps: '500', processing: S.processing })).toBeNull();
    expect(parseFeeSchedule({ platformFeeBps: 500 })).toBeNull();
    expect(parseFeeSchedule({ platformFeeBps: 1.5, processing: S.processing })).toBeNull();
  });

  it('rounds half-up in integer cents', () => {
    expect(bpsOfCents(1010, 500)).toBe(51);
    expect(bpsOfCents(9, 500)).toBe(0);
    expect(bpsOfCents(10, 500)).toBe(1);
    expect(bpsOfCents(0, 500)).toBe(0);
    expect(bpsOfCents(100_000_000, 500)).toBe(5_000_000);
  });

  it('quotes like the server', () => {
    expect(quoteFromSchedule(S, 10_000)).toEqual({ grossCents: 10_000, platformFeeCents: 500, processingFeeCents: 320, sellerNetCents: 9180 });
    expect(quoteFromSchedule(S, 1010)).toMatchObject({ platformFeeCents: 51, processingFeeCents: 59, sellerNetCents: 900 });
    expect(quoteFromSchedule(S, 2500, { quantity: 2, shippingCents: 500 })).toMatchObject({ grossCents: 5500, platformFeeCents: 250, processingFeeCents: 190 });
  });

  it('never produces a negative net and always adds up', () => {
    for (const p of [0, 1, 9, 10, 29, 30, 31, 99, 100, 12345]) {
      const q = quoteFromSchedule(S, p);
      expect(q.sellerNetCents).toBeGreaterThanOrEqual(0);
      expect(q.platformFeeCents + q.processingFeeCents + q.sellerNetCents).toBe(q.grossCents);
    }
    expect(quoteFromSchedule(S, 0)).toEqual({ grossCents: 0, platformFeeCents: 0, processingFeeCents: 0, sellerNetCents: 0 });
  });

  it('labels rates', () => {
    expect(bpsToPercentLabel(500)).toBe('5%');
    expect(bpsToPercentLabel(290)).toBe('2.9%');
    expect(bpsToPercentLabel(125)).toBe('1.25%');
    expect(processingRateLabel(S)).toBe('2.9% + 30¢');
  });
});
