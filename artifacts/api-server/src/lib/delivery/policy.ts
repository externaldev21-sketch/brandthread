/**
 * Delivery guarantee — the rules, in one pure module (no database, no clock
 * of its own: every function takes `now`).
 *
 *  - A regular order must be DELIVERED within 15 days of purchase; a
 *    pre-order within 15 days of the ship date the seller promised (60 days
 *    from purchase when no date is known), never later than 180 days after
 *    purchase. Purchase = the moment Stripe captured the payment
 *    (orders.paid_at). Deadlines are absolute instants (paid_at + N × 24h),
 *    so daylight-saving changes and server/phone time zones can never move
 *    them. Only *display* is time-zone aware (see formatDeadline).
 *  - "Delivered" means the carrier says delivered, or the buyer confirmed
 *    receipt. Never the seller's say-so.
 *  - Sellers are paid only after delivery + a buffer (PAYOUT_MODE=hold,
 *    the default), so an automatic refund is always funded by money the
 *    platform still holds.
 *
 * Config (env, read lazily so tests can change it):
 *   PAYOUT_MODE                  "hold" (default) | "immediate"
 *   PAYOUT_RELEASE_BUFFER_DAYS   days after delivery before the seller is paid (default 3)
 *   AUTO_REFUND_ENABLED          "false" turns the refund sweep off (default on)
 *   PREORDER_DELIVERY_GRACE_DAYS days after the promised ship date a pre-order
 *                                has to arrive (default 15, 1–60)
 *   PREORDER_MAX_DELIVERY_DAYS   latest pre-order deadline, days after purchase
 *                                (default 180, 60–180)
 */

export const REGULAR_DELIVERY_DAYS = 15;
export const PREORDER_DELIVERY_DAYS = 60;
export const DEFAULT_PAYOUT_BUFFER_DAYS = 3;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Reason stored in orders.cancellation_reason for an automatic refund. */
export const AUTO_REFUND_REASON = "not_delivered_in_time";
export const AUTO_REFUND_LABEL = "Refunded, not delivered in time";

export type PayoutMode = "hold" | "immediate";

export function payoutMode(env: NodeJS.ProcessEnv = process.env): PayoutMode {
  return env.PAYOUT_MODE?.trim().toLowerCase() === "immediate" ? "immediate" : "hold";
}

export function payoutBufferDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.PAYOUT_RELEASE_BUFFER_DAYS);
  return Number.isFinite(raw) && raw >= 0 && raw <= 60 ? raw : DEFAULT_PAYOUT_BUFFER_DAYS;
}

export function autoRefundEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AUTO_REFUND_ENABLED?.trim().toLowerCase() !== "false";
}

export function deliveryWindowDays(isPreorder: boolean): number {
  return isPreorder ? PREORDER_DELIVERY_DAYS : REGULAR_DELIVERY_DAYS;
}

export function computeDeliverBy(purchasedAt: Date, isPreorder: boolean): Date {
  return new Date(purchasedAt.valueOf() + deliveryWindowDays(isPreorder) * DAY_MS);
}

export const DEFAULT_PREORDER_GRACE_DAYS = 15;
export const MAX_PREORDER_DELIVERY_DAYS = 180;

export function preorderGraceDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.PREORDER_DELIVERY_GRACE_DAYS);
  return env.PREORDER_DELIVERY_GRACE_DAYS && Number.isInteger(raw) && raw >= 1 && raw <= 60 ? raw : DEFAULT_PREORDER_GRACE_DAYS;
}

export function preorderMaxDeliveryDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.PREORDER_MAX_DELIVERY_DAYS);
  return env.PREORDER_MAX_DELIVERY_DAYS && Number.isInteger(raw) && raw >= PREORDER_DELIVERY_DAYS && raw <= MAX_PREORDER_DELIVERY_DAYS
    ? raw : MAX_PREORDER_DELIVERY_DAYS;
}

/**
 * The latest promised ship date a pre-order may carry, counted from when it
 * is listed: delivery (ship date + grace) must fit inside the longest
 * pre-order deadline, so the money is never refunded before the seller's
 * own promise is due. 165 days with the defaults.
 */
export function maxPreorderShipDays(env: NodeJS.ProcessEnv = process.env): number {
  return preorderMaxDeliveryDays(env) - preorderGraceDays(env);
}

/**
 * A pre-order's delivery deadline: the promised ship date + the grace days
 * (a date already past counts from purchase), capped at the longest
 * pre-order deadline. With no ship date, the fixed 60-day window.
 */
export function computePreorderDeliverBy(
  purchasedAt: Date,
  promisedShipDate: Date | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Date {
  if (!promisedShipDate || Number.isNaN(promisedShipDate.valueOf())) return computeDeliverBy(purchasedAt, true);
  const from = Math.max(promisedShipDate.valueOf(), purchasedAt.valueOf());
  const latest = purchasedAt.valueOf() + preorderMaxDeliveryDays(env) * DAY_MS;
  return new Date(Math.min(from + preorderGraceDays(env) * DAY_MS, latest));
}

/** Whole days from purchase to a deadline (for "not delivered within N days" copy). */
export function windowDaysBetween(purchasedAt: Date, deliverBy: Date): number {
  return Math.max(1, Math.round((deliverBy.valueOf() - purchasedAt.valueOf()) / DAY_MS));
}

export function computePayoutReleaseAt(deliveredAt: Date, env: NodeJS.ProcessEnv = process.env): Date {
  return new Date(deliveredAt.valueOf() + payoutBufferDays(env) * DAY_MS);
}

export function isOverdue(deliverBy: Date | null | undefined, now: Date): boolean {
  return Boolean(deliverBy) && now.valueOf() > deliverBy!.valueOf();
}

// ─── Seller warnings ──────────────────────────────────────────────────────────

/** Warning tiers, most urgent last. level = index + 1 in orders.deadline_warning_level. */
export const WARNING_TIERS = [
  { level: 1, label: "5 days", beforeMs: 5 * DAY_MS },
  { level: 2, label: "2 days", beforeMs: 2 * DAY_MS },
  { level: 3, label: "12 hours", beforeMs: 12 * HOUR_MS },
] as const;

/**
 * The warning level that is due now, or 0 when none is. Only the most
 * urgent tier that has been crossed is returned, so a job that was down for
 * a day sends ONE warning (the current one), not three.
 */
export function dueWarningLevel(deliverBy: Date, now: Date): 0 | 1 | 2 | 3 {
  const remaining = deliverBy.valueOf() - now.valueOf();
  if (remaining <= 0) return 0;
  let due: 0 | 1 | 2 | 3 = 0;
  for (const tier of WARNING_TIERS) if (remaining <= tier.beforeMs) due = tier.level;
  return due;
}

export function warningLabel(level: number): string {
  return WARNING_TIERS.find((t) => t.level === level)?.label ?? "";
}

// ─── Time-zone aware display ──────────────────────────────────────────────────

/** "Oct 15" in the viewer's zone (defaults to UTC if the zone is unknown). */
export function formatDeadline(deliverBy: Date, timeZone?: string | null): string {
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: timeZone || "UTC" }).format(deliverBy);
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(deliverBy);
  }
}

// ─── Buyer timeline ───────────────────────────────────────────────────────────

export type TimelineStepKey = "ordered" | "preparing" | "shipped" | "out_for_delivery" | "delivered";
export type TimelineStep = {
  key: TimelineStepKey;
  label: string;
  state: "done" | "current" | "upcoming";
  at: string | null;
};

const STEP_LABELS: Record<TimelineStepKey, string> = {
  ordered: "Ordered",
  preparing: "Preparing",
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
};
const STEP_ORDER: TimelineStepKey[] = ["ordered", "preparing", "shipped", "out_for_delivery", "delivered"];

export type TimelineInput = {
  status: string;
  trackingStatus: string | null;
  orderedAt: Date;
  preparingAt?: Date | null;
  shippedAt?: Date | null;
  outForDeliveryAt?: Date | null;
  deliveredAt?: Date | null;
};

/** Where the order is on the five-step tracker. */
export function currentStepKey(input: Pick<TimelineInput, "status" | "trackingStatus" | "deliveredAt">): TimelineStepKey {
  if (input.deliveredAt || input.status === "delivered" || input.trackingStatus === "delivered") return "delivered";
  if (input.trackingStatus === "out_for_delivery") return "out_for_delivery";
  if (
    input.status === "shipped"
    || ["accepted", "in_transit", "label_created", "exception"].includes(input.trackingStatus ?? "")
  ) return "shipped";
  if (["processing", "fulfilled", "label_purchasing"].includes(input.status)) return "preparing";
  return "ordered";
}

export function buildTimeline(input: TimelineInput): TimelineStep[] {
  const current = currentStepKey(input);
  const currentIndex = STEP_ORDER.indexOf(current);
  const at: Record<TimelineStepKey, Date | null | undefined> = {
    ordered: input.orderedAt,
    preparing: input.preparingAt,
    shipped: input.shippedAt,
    out_for_delivery: input.outForDeliveryAt,
    delivered: input.deliveredAt,
  };
  return STEP_ORDER.map((key, index) => ({
    key,
    label: STEP_LABELS[key],
    // The last step, once reached, is "done" rather than a forever-pulsing "current".
    state: index < currentIndex || (index === currentIndex && key === "delivered")
      ? "done" : index === currentIndex ? "current" : "upcoming",
    at: index <= currentIndex && at[key] ? at[key]!.toISOString() : null,
  }));
}

// ─── Partial-shipment refund amount ──────────────────────────────────────────

export type RefundableItem = { id: string; priceCents: number; quantity: number };

/**
 * What to refund for the items that never arrived.
 *
 * Shipping, tax and any discount are spread across items in proportion to
 * their merchandise value, so the refund for a subset is
 * floor(charged × subsetValue ÷ allItemsValue). When the subset is EVERY
 * item that has not been refunded already, the buyer gets the whole
 * remainder (charged − refunded), so rounding can never strand a cent and
 * the pieces always sum to exactly what was charged.
 */
export function undeliveredRefundCents(input: {
  chargedCents: number;
  alreadyRefundedCents: number;
  allItems: RefundableItem[];
  undeliveredItemIds: string[];
  alreadyRefundedItemIds: string[];
}): number {
  const remaining = Math.max(0, input.chargedCents - input.alreadyRefundedCents);
  const undelivered = new Set(input.undeliveredItemIds);
  const refundedBefore = new Set(input.alreadyRefundedItemIds);
  const live = input.allItems.filter((item) => !refundedBefore.has(item.id));
  const subset = live.filter((item) => undelivered.has(item.id));
  if (subset.length === 0) return 0;
  if (subset.length === live.length) return remaining;
  const value = (items: RefundableItem[]) => items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);
  const total = value(input.allItems);
  if (total <= 0) return 0;
  return Math.min(remaining, Math.floor((input.chargedCents * value(subset)) / total));
}

// ─── Listing a pre-order ──────────────────────────────────────────────────────

export type PreorderListingError = {
  status: 400;
  code: "PREORDER_SHIP_DATE_REQUIRED" | "PREORDER_SHIP_DATE_INVALID" | "PREORDER_SHIP_DATE_TOO_FAR";
  error: string;
};

/**
 * A pre-order product must carry the seller's promised ship date, and a newly
 * supplied date must be in the future and close enough that delivery fits
 * the longest pre-order deadline (maxPreorderShipDays). `effective*` are the
 * values the product will have after the write (the request's, else the
 * stored ones).
 */
export function validatePreorderListing(input: {
  effectiveIsPreorder: boolean;
  suppliedShipDate: unknown;
  effectiveShipDate: Date | null;
  now?: Date;
}): PreorderListingError | null {
  if (!input.effectiveIsPreorder) return null;
  if (input.suppliedShipDate !== undefined && input.suppliedShipDate !== null && input.suppliedShipDate !== "") {
    const supplied = new Date(input.suppliedShipDate as string);
    if (Number.isNaN(supplied.valueOf())) {
      return { status: 400, code: "PREORDER_SHIP_DATE_INVALID", error: "preOrderEstShipDate must be a valid date" };
    }
    if (supplied.valueOf() < (input.now ?? new Date()).valueOf() - DAY_MS) {
      return { status: 400, code: "PREORDER_SHIP_DATE_INVALID", error: "preOrderEstShipDate must be in the future" };
    }
    const maxDays = maxPreorderShipDays();
    if (supplied.valueOf() > (input.now ?? new Date()).valueOf() + maxDays * DAY_MS) {
      return {
        status: 400, code: "PREORDER_SHIP_DATE_TOO_FAR",
        error: `A pre-order must ship within ${maxDays} days, so it can be delivered within ${preorderMaxDeliveryDays()} days of purchase.`,
      };
    }
  }
  if (!input.effectiveShipDate) {
    return {
      status: 400, code: "PREORDER_SHIP_DATE_REQUIRED",
      error: `A pre-order needs a ship date. Buyers are promised it, and the order is refunded automatically if it isn't delivered within ${preorderGraceDays()} days of that date.`,
    };
  }
  return null;
}
