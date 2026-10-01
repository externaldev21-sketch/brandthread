import { describe, expect, it } from 'vitest';
import {
  demoStatementDetail, demoStatementList, formatSignedCents, isStatementMonth, statementFileName,
} from '@/lib/statements';

describe('statements helpers', () => {
  it('validates months and builds file names', () => {
    expect(isStatementMonth('2026-08')).toBe(true);
    expect(isStatementMonth('2026-13')).toBe(false);
    expect(isStatementMonth(undefined)).toBe(false);
    expect(statementFileName('2026-08', 'pdf')).toBe('brandthread-statement-2026-08.pdf');
  });
  it('formats integer cents without float dollars', () => {
    expect(formatSignedCents(-5)).toBe('-$0.05');
    expect(formatSignedCents(12_345_678)).toBe('$123,456.78');
  });
  it('demo detail reconciles', () => {
    for (const m of demoStatementList().months) {
      const t = demoStatementDetail(m.month).totals;
      expect(t.netCents).toBe(t.grossSalesCents + t.refundsCents + t.disputesCents + t.platformFeesCents + t.stripeFeesCents + t.adjustmentsCents);
      expect(t.balanceChangeCents).toBe(t.netCents + t.payoutsCents);
    }
  });
});
