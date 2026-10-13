import { describe, expect, it } from 'vitest';
import { buildOrderFeeBreakdown, orderFeeColumnsFromApi } from '../orderFeeBreakdown';
import type { FeeSchedule } from '../feeSchedule';

const S: FeeSchedule = { platformFeeBps: 500, processing: { bps: 290, fixedCents: 30 } };

const paid = {
  totalCents: 10_000, subtotalCents: 10_000, discountAmountCents: 0, shippingCents: 0,
  fundsState: 'settled_direct', platformFeeCents: 500, processingFeeCents: 318, processingFeeChargedCents: 320,
  sellerNetCents: 9_180, platformFeeRefundedCents: 0, refundedCents: 0, threadCashAppliedCents: 0,
};

const view = (b: ReturnType<typeof buildOrderFeeBreakdown>) => b?.lines.map((l) => [l.label, l.cents]);

describe('buildOrderFeeBreakdown', () => {
  it('shows the stored columns and the stored net', () => {
    const b = buildOrderFeeBreakdown(orderFeeColumnsFromApi(paid), S);
    expect(b?.estimated).toBe(false);
    expect(b?.feesCents).toBe(820);
    expect(view(b)).toEqual([
      ['Order total', 10_000], ['Platform fee (5%)', -500], ['Payment processing', -320], ['You earn', 9_180],
    ]);
  });

  it('prefers the processing fee the seller was charged, falls back to the actual one', () => {
    const b = buildOrderFeeBreakdown(orderFeeColumnsFromApi({ ...paid, processingFeeChargedCents: 0 }), S);
    expect(b?.lines.find((l) => l.key === 'processing')?.cents).toBe(-318);
  });

  it('adds Thread Cash, refunds and refunded fees, and every line adds up to the net', () => {
    const b = buildOrderFeeBreakdown(orderFeeColumnsFromApi({
      ...paid, totalCents: 9_000, discountAmountCents: 1_000, threadCashAppliedCents: 1_000,
      sellerNetCents: 8_180, refundedCents: 2_500, platformFeeRefundedCents: 125,
    }), S);
    expect(view(b)).toEqual([
      ['Order total', 9_000], ['Thread Cash applied', 1_000], ['Platform fee (5%)', -500], ['Payment processing', -320],
      ['Refunded to buyer', -2_500], ['Refunded fees', 125], ['You earn', 6_805],
    ]);
    const lines = b!.lines.filter((l) => l.key !== 'net').reduce((s, l) => s + l.cents, 0);
    expect(lines).toBe(6_805);
  });

  it('drops the Thread Cash top-up on a full refund (Brandthread reverses it)', () => {
    const b = buildOrderFeeBreakdown(orderFeeColumnsFromApi({
      ...paid, totalCents: 9_000, threadCashAppliedCents: 1_000, sellerNetCents: 8_180,
      refundedCents: 9_000, platformFeeRefundedCents: 500,
    }), S);
    expect(b?.lines.some((l) => l.key === 'thread_cash')).toBe(false);
    expect(b?.lines.at(-1)?.cents).toBe(8_180 - 9_000 + 500);
  });

  it('omits the percentage when the recorded fee is not the schedule rate', () => {
    const b = buildOrderFeeBreakdown(orderFeeColumnsFromApi({ ...paid, platformFeeCents: 300, sellerNetCents: 9_380 }), S);
    expect(b?.lines[1].label).toBe('Platform fee');
  });

  it('falls back to a labelled estimate before the fees are recorded', () => {
    const b = buildOrderFeeBreakdown(orderFeeColumnsFromApi({
      totalCents: 10_000, subtotalCents: 10_000, shippingCents: 0, fundsState: null,
      platformFeeCents: 0, processingFeeCents: 0, processingFeeChargedCents: 0, sellerNetCents: 0,
    }), S);
    expect(b?.estimated).toBe(true);
    expect(view(b)).toEqual([
      ['Order total', 10_000], ['Platform fee (5%)', -500], ['Payment processing', -320], ['You earn', 9_180],
    ]);
  });

  it('shows nothing with neither recorded fees nor a schedule', () => {
    expect(buildOrderFeeBreakdown(orderFeeColumnsFromApi({ ...paid, fundsState: null, platformFeeCents: 0, processingFeeCents: 0, processingFeeChargedCents: 0, sellerNetCents: 0 }), null)).toBeNull();
  });

  it('still shows recorded fees without a schedule, without a percentage', () => {
    const b = buildOrderFeeBreakdown(orderFeeColumnsFromApi(paid), null);
    expect(b?.lines[1].label).toBe('Platform fee');
  });
});
