/**
 * Pre-order ship-by rules.
 *
 * A pre-order must ship within PREORDER_REFUND_WINDOW_DAYS of when the
 * pre-order closes (or of today when it has no closing date). If it has not
 * shipped by then the buyer is refunded automatically. The refund itself is
 * handled by the order-tracking / auto-refund work; this module only owns the
 * constant and the seller-facing validation, so it can be reconciled with
 * that work by pointing both at one constant.
 */
export const PREORDER_REFUND_WINDOW_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(d: Date): number {
  return Math.floor(d.getTime() / DAY_MS);
}

function fromUtcDay(day: number): Date {
  return new Date(day * DAY_MS);
}

export type ShipByValidation =
  | { ok: true; maxShipBy: Date }
  | { ok: false; code: "INVALID_DATE" | "SHIP_BY_IN_PAST" | "SHIP_BY_TOO_LATE" | "CLOSING_DATE_PASSED"; message: string; maxShipBy: Date };

export function formatShipByDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Latest ship-by date that keeps the pre-order inside the refund window. */
export function maxShipByDate(input: { closingDate?: Date | null; now?: Date }): Date {
  const anchor = input.closingDate ?? input.now ?? new Date();
  return fromUtcDay(utcDay(anchor) + PREORDER_REFUND_WINDOW_DAYS);
}

/**
 * Days are compared as UTC calendar days: day 60 after the anchor is allowed,
 * day 61 is not, and the ship-by day must be after today.
 */
export function validateShipBy(input: {
  shipBy: Date;
  closingDate?: Date | null;
  now?: Date;
}): ShipByValidation {
  const now = input.now ?? new Date();
  const maxShipBy = maxShipByDate({ closingDate: input.closingDate, now });
  if (Number.isNaN(input.shipBy.getTime())) {
    return { ok: false, code: "INVALID_DATE", message: "Enter a valid ship-by date.", maxShipBy };
  }
  if (utcDay(input.shipBy) <= utcDay(now)) {
    return { ok: false, code: "SHIP_BY_IN_PAST", message: "The ship-by date must be in the future.", maxShipBy };
  }
  if (utcDay(maxShipBy) <= utcDay(now)) {
    return {
      ok: false,
      code: "CLOSING_DATE_PASSED",
      message: `The pre-order closing date is more than ${PREORDER_REFUND_WINDOW_DAYS} days ago. Move the closing date forward before setting a ship-by date.`,
      maxShipBy,
    };
  }
  if (utcDay(input.shipBy) > utcDay(maxShipBy)) {
    return {
      ok: false,
      code: "SHIP_BY_TOO_LATE",
      message: `Pre-orders must ship within ${PREORDER_REFUND_WINDOW_DAYS} days of ${input.closingDate ? "closing" : "today"}. The latest you can set is ${formatShipByDate(maxShipBy)}.`,
      maxShipBy,
    };
  }
  return { ok: true, maxShipBy };
}

export function daysUntil(target: Date, now: Date = new Date()): number {
  return Math.max(0, utcDay(target) - utcDay(now));
}

/** Buyer-facing wording; derives the date, never hard-codes the window. */
export function refundRuleCopy(shipBy: Date): string {
  return `If it hasn't shipped by ${formatShipByDate(shipBy)} you're refunded automatically.`;
}
