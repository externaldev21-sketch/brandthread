/**
 * Bag quantity stepper limits (polish item 112). Pure, unit-tested.
 *
 * CartItem.maxQuantity is the variant's real stock when it was known at add
 * time; cartService stores 99 (or nothing, for lines synced from older
 * clients) when stock was 0 or unknown. Only a real stock number may limit
 * the stepper with an "Only N left" note; an unknown stock never invents one.
 */

/** Same cap cartService.updateCartItemQuantity applies when stock is unknown. */
export const UNKNOWN_STOCK_CAP = 99;

/** The line's real stock limit, or null when stock is unknown. */
export function knownStockLimit(maxQuantity: number | null | undefined): number | null {
  if (typeof maxQuantity !== 'number' || !Number.isSafeInteger(maxQuantity) || maxQuantity <= 0) return null;
  return maxQuantity;
}

/** The stepper's max for a line: real stock when known, otherwise the service's own cap. */
export function stepperMax(maxQuantity: number | null | undefined): number {
  return knownStockLimit(maxQuantity) ?? UNKNOWN_STOCK_CAP;
}

/** Clamp a requested quantity into [min, max]. */
export function clampQuantity(next: number, min: number, max: number): number {
  const hi = Math.max(min, max);
  return Math.min(hi, Math.max(min, next));
}

export type StepResult =
  | { kind: 'change'; next: number }
  | { kind: 'at-max'; max: number }
  | { kind: 'none' };

/**
 * What one + / − tap does. At the max, + reports 'at-max' (the stepper gives
 * one warning haptic and the line shows its note) instead of changing.
 */
export function stepQuantity(value: number, delta: 1 | -1, min: number, max: number): StepResult {
  if (delta > 0 && value >= max) return { kind: 'at-max', max };
  const next = clampQuantity(value + delta, min, max);
  return next === value ? { kind: 'none' } : { kind: 'change', next };
}

/** The bag row already shows its own low-stock badge at or below this stock. */
export const LOW_STOCK_BADGE_MAX = 3;

/**
 * Whether the stepper's "Only N left" note should appear after + at the limit:
 * only for a known stock above the badge threshold, so the row never repeats
 * the badge's own "Only N left" (at ≤3 the tap still gives its haptic).
 */
export function showsLimitNote(stockLimit: number | null): stockLimit is number {
  return stockLimit !== null && stockLimit > LOW_STOCK_BADGE_MAX;
}

/** Inline note under the stepper after + is pressed at the limit. */
export function stockLimitNote(max: number): string {
  return `Only ${max} left`;
}
