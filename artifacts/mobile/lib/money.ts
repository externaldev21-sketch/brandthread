/**
 * Monetary boundary helpers.
 *
 * Monetary values are integer cents everywhere except a text input or a
 * formatted display string.  Do not replace parseDecimalToCents with
 * parseFloat(value) * 100: binary floating point makes that conversion
 * inexact for otherwise valid decimal input.
 */

export type MoneyRounding = 'down' | 'up' | 'nearest';

const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;

function assertCents(cents: number): number {
  if (!Number.isSafeInteger(cents)) throw new Error('Money amount must be a safe integer number of cents.');
  return cents;
}

/** Strictly parse a user-entered decimal currency amount into integer cents. */
export function parseDecimalToCents(value: string): number | null {
  const input = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(input)) return null;
  const [wholeText, fractionText = ''] = input.split('.');
  const whole = Number(wholeText);
  if (!Number.isSafeInteger(whole) || whole > Math.floor(MAX_SAFE_CENTS / 100)) return null;
  const fraction = Number((fractionText + '00').slice(0, 2));
  const cents = whole * 100 + fraction;
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Format integer cents only; formatting is deliberately a UI-boundary operation. */
export function formatCents(cents: number, currency = 'USD'): string {
  assertCents(cents);
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100).toLocaleString('en-US');
  const fraction = String(absolute % 100).padStart(2, '0');
  return currency === 'USD' ? `${sign}$${whole}.${fraction}` : `${sign}${currency} ${whole}.${fraction}`;
}

/** Calculate a basis-point share of cents with an explicit rounding policy. */
export function centsAtBasisPoints(cents: number, basisPoints: number, rounding: MoneyRounding = 'nearest'): number {
  assertCents(cents);
  if (!Number.isSafeInteger(basisPoints)) throw new Error('Basis points must be an integer.');
  const numerator = cents * basisPoints;
  if (!Number.isSafeInteger(numerator)) throw new Error('Money calculation exceeds safe integer range.');
  const quotient = numerator / 10_000;
  const rounded = rounding === 'down' ? Math.floor(quotient)
    : rounding === 'up' ? Math.ceil(quotient)
    : Math.round(quotient);
  return assertCents(rounded);
}

/** Calculate an integer-percent share using the same explicit rounding rules. */
export function centsAtPercent(cents: number, percent: number, rounding: MoneyRounding = 'nearest'): number {
  if (!Number.isSafeInteger(percent)) throw new Error('Percent must be an integer.');
  return centsAtBasisPoints(cents, percent * 100, rounding);
}

/** Divide cents for a display/allocation with an explicit rounding policy. */
export function divideCents(cents: number, divisor: number, rounding: MoneyRounding = 'nearest'): number {
  assertCents(cents);
  if (!Number.isSafeInteger(divisor) || divisor <= 0) throw new Error('Divisor must be a positive integer.');
  const result = cents / divisor;
  return assertCents(rounding === 'down' ? Math.floor(result) : rounding === 'up' ? Math.ceil(result) : Math.round(result));
}

/** Return an integer percentage for two integer quantities without float math. */
export function integerPercent(numerator: number, denominator: number, rounding: MoneyRounding = 'nearest'): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new Error('Percentage requires safe integer values and a positive denominator.');
  }
  const scaledNumerator = numerator * 100;
  if (!Number.isSafeInteger(scaledNumerator)) throw new Error('Percentage calculation exceeds safe integer range.');
  const value = scaledNumerator / denominator;
  return rounding === 'down' ? Math.floor(value) : rounding === 'up' ? Math.ceil(value) : Math.round(value);
}