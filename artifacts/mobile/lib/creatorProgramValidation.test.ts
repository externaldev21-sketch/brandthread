import { describe, expect, it } from 'vitest';
import { commissionError, validateProgramSettings, type ProgramSettingsInput } from './creatorProgramValidation';

const base: ProgramSettingsInput = {
  commission: 10, savedCommission: 10, discount: '0', windowDays: '30', holdDays: '30', minPayout: '25', autoApprove: false,
};

describe('commissionError', () => {
  it('accepts the 5–10% range', () => {
    expect(commissionError(5)).toBeNull();
    expect(commissionError(7.5)).toBeNull();
    expect(commissionError(10)).toBeNull();
  });
  it('rejects values outside the range', () => {
    expect(commissionError(150)).toBe('Commission must be between 5% and 10%.');
    expect(commissionError(-5)).toBe('Commission must be between 5% and 10%.');
    expect(commissionError(4)).not.toBeNull();
  });
  it('allows an unchanged stored legacy rate', () => {
    expect(commissionError(20, 20)).toBeNull();
    expect(commissionError(20, 10)).not.toBeNull();
  });
});

describe('validateProgramSettings', () => {
  it('builds the API body and omits an unchanged commission', () => {
    const r = validateProgramSettings({ ...base, minPayout: '12.5' });
    expect(r).toEqual({ ok: true, body: { buyerDiscountPercent: 0, windowDays: 30, holdDays: 30, minPayoutCents: 1250, autoApprove: false } });
  });

  it('sends a changed commission', () => {
    const r = validateProgramSettings({ ...base, commission: 8 });
    expect(r.ok && r.body.commissionPercent).toBe(8);
  });

  it('flags empty, negative and non-numeric fields instead of saving 0', () => {
    const r = validateProgramSettings({ ...base, discount: '', windowDays: '-5', holdDays: 'abc', minPayout: ' ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['discount', 'holdDays', 'minPayout', 'windowDays']);
  });

  it('enforces the server bounds', () => {
    const over = validateProgramSettings({ ...base, discount: '51', windowDays: '366', holdDays: '121', minPayout: '10001' });
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.errors.discount).toBe('Enter a discount from 0 to 50%.');
      expect(over.errors.windowDays).toBe('Enter whole days from 1 to 365.');
      expect(over.errors.holdDays).toBe('Enter whole days from 0 to 120.');
      expect(over.errors.minPayout).toBe('Enter an amount from $0 to $10,000.');
    }
    const edge = validateProgramSettings({ ...base, discount: '50', windowDays: '365', holdDays: '0', minPayout: '10000' });
    expect(edge.ok).toBe(true);
  });

  it('rejects a zero-day window and fractional days', () => {
    const r = validateProgramSettings({ ...base, windowDays: '0', holdDays: '1.5' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['holdDays', 'windowDays']);
  });

  it('flags an out-of-range commission that was changed', () => {
    const r = validateProgramSettings({ ...base, commission: 150 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.commission).toBe('Commission must be between 5% and 10%.');
  });
});
