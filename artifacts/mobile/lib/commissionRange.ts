/**
 * Seller-set creator commission range, mirrored from the API
 * (artifacts/api-server/src/lib/affiliate/commission.ts: 500–1000 bps).
 */
export const COMMISSION_MIN_PERCENT = 5;
export const COMMISSION_MAX_PERCENT = 10;

/**
 * One whole-percent step up or down, clamped to the range. A value outside
 * the range (a rate stored before the range existed) snaps to the nearest
 * bound; a fractional value moves to the next whole percent.
 */
export function stepCommission(value: number, direction: 1 | -1): number {
  if (!Number.isFinite(value)) return COMMISSION_MAX_PERCENT;
  if (value > COMMISSION_MAX_PERCENT) return COMMISSION_MAX_PERCENT;
  if (value < COMMISSION_MIN_PERCENT) return COMMISSION_MIN_PERCENT;
  const next = direction > 0
    ? (Number.isInteger(value) ? value + 1 : Math.ceil(value))
    : (Number.isInteger(value) ? value - 1 : Math.floor(value));
  return Math.min(COMMISSION_MAX_PERCENT, Math.max(COMMISSION_MIN_PERCENT, next));
}

export function isCommissionInRange(value: number): boolean {
  return Number.isFinite(value) && value >= COMMISSION_MIN_PERCENT && value <= COMMISSION_MAX_PERCENT;
}
