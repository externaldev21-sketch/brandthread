/**
 * Client-side checks for the seller's creator program forms (Program settings
 * and the per-creator rate on Creator detail). The bounds mirror the API
 * (artifacts/api-server/src/routes/seller-affiliate.ts PUT /program and
 * lib/affiliate/commission.ts), so a bad value is caught inline instead of
 * coming back as a 400 after Save.
 */
import { COMMISSION_MAX_PERCENT, COMMISSION_MIN_PERCENT, isCommissionInRange } from './commissionRange';

export const MAX_BUYER_DISCOUNT_PERCENT = 50; // MAX_BUYER_DISCOUNT_BPS 5000
export const MIN_WINDOW_DAYS = 1;
export const MAX_WINDOW_DAYS = 365;
export const MAX_HOLD_DAYS = 120;
export const MAX_MIN_PAYOUT_USD = 10_000; // 1_000_000 cents

export type ProgramField = 'commission' | 'discount' | 'windowDays' | 'holdDays' | 'minPayout';
export type ProgramErrors = Partial<Record<ProgramField, string>>;

export interface ProgramSettingsInput {
  commission: number;
  /** The stored default; re-sending it unchanged is always allowed (legacy rates). */
  savedCommission: number;
  discount: string;
  windowDays: string;
  holdDays: string;
  minPayout: string;
  autoApprove: boolean;
}

export interface ProgramSettingsBody {
  commissionPercent?: number;
  buyerDiscountPercent: number;
  windowDays: number;
  holdDays: number;
  minPayoutCents: number;
  autoApprove: boolean;
}

/**
 * Error for a commission the seller is about to save, or null when it's fine.
 * An unchanged stored value passes even when it's outside today's range, the
 * same as the server (isAllowedSellerCommission).
 */
export function commissionError(value: number, saved?: number | null): string | null {
  if (saved != null && value === saved) return null;
  if (isCommissionInRange(value)) return null;
  return `Commission must be between ${COMMISSION_MIN_PERCENT}% and ${COMMISSION_MAX_PERCENT}%.`;
}

// Plain digits with an optional decimal part. Rejects '', '-5', '1e3', '0x10'.
const DECIMAL = /^\d+(\.\d+)?$/;
const INTEGER = /^\d+$/;

function parse(raw: string, integer: boolean): number | null {
  const v = raw.trim();
  if (!(integer ? INTEGER : DECIMAL).test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function validateProgramSettings(input: ProgramSettingsInput):
  { ok: true; body: ProgramSettingsBody } | { ok: false; errors: ProgramErrors } {
  const errors: ProgramErrors = {};

  const commission = commissionError(input.commission, input.savedCommission);
  if (commission) errors.commission = commission;

  const discount = parse(input.discount, false);
  if (discount == null || discount > MAX_BUYER_DISCOUNT_PERCENT) {
    errors.discount = `Enter a discount from 0 to ${MAX_BUYER_DISCOUNT_PERCENT}%.`;
  }

  const windowDays = parse(input.windowDays, true);
  if (windowDays == null || windowDays < MIN_WINDOW_DAYS || windowDays > MAX_WINDOW_DAYS) {
    errors.windowDays = `Enter whole days from ${MIN_WINDOW_DAYS} to ${MAX_WINDOW_DAYS}.`;
  }

  const holdDays = parse(input.holdDays, true);
  if (holdDays == null || holdDays > MAX_HOLD_DAYS) {
    errors.holdDays = `Enter whole days from 0 to ${MAX_HOLD_DAYS}.`;
  }

  const minPayout = parse(input.minPayout, false);
  if (minPayout == null || minPayout > MAX_MIN_PAYOUT_USD) {
    errors.minPayout = `Enter an amount from $0 to $${MAX_MIN_PAYOUT_USD.toLocaleString('en-US')}.`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    body: {
      ...(input.commission !== input.savedCommission ? { commissionPercent: input.commission } : {}),
      buyerDiscountPercent: discount!,
      windowDays: windowDays!,
      holdDays: holdDays!,
      minPayoutCents: Math.round(minPayout! * 100),
      autoApprove: input.autoApprove,
    },
  };
}
