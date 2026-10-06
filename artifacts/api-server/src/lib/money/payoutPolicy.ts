/**
 * PAYOUT POLICY — the single source of truth for how long and how much of a
 * seller's money Brandthread holds back before it can be paid out.
 *
 * Two product decisions are still open. Both are ONE constant each, below,
 * and nothing else in the codebase may define or hard-code them (other
 * modules read them through this file or through GET /api/finance/balance
 * and GET /api/finance/payout-schedule). See docs/payments/payout-policy.md.
 *
 *   1. PAYOUT_PROTECTION_MODE  'hold' | 'reserve'
 *        hold     every order's funds are not payable until holdReleaseDate().
 *        reserve  funds flow on the normal payout schedule, but
 *                 RESERVE_BPS of each order is kept in a rolling reserve until
 *                 holdReleaseDate().
 *   2. INTERNATIONAL_HOLD_DAYS  15 | 30
 *        Days an international (non-HOME_COUNTRY) order is held (hold mode)
 *        or reserved (reserve mode) before release.
 *
 * Everything is integer cents and whole days. Platform fee stays ONLY in
 * ./fees.ts (PLATFORM_FEE_BPS).
 */
import { bpsOfCents, assertCents } from "./fees";

export type PayoutProtectionMode = "hold" | "reserve";

/** OPEN DECISION 1. Default 'hold'. Flip this one constant to switch behaviour. */
export const PAYOUT_PROTECTION_MODE: PayoutProtectionMode = "hold";

/** OPEN DECISION 2. Default 15. Either 15 or 30. */
export const INTERNATIONAL_HOLD_DAYS: 15 | 30 = 15;

/** Country whose orders count as domestic (ISO 3166-1 alpha-2). */
export const HOME_COUNTRY = "US";

/**
 * Stripe's standard US payout timing: funds from a charge become available
 * 2 business days after the charge (Stripe "rolling" payout delay), and
 * Stripe creates the payout automatically from then on. Used as the domestic
 * hold, so domestic orders add nothing on top of Stripe's own timing.
 */
export const DOMESTIC_PAYOUT_DELAY_DAYS = 2;

/** Reserve mode: share of each order kept back, in basis points (1000 = 10%). */
export const RESERVE_BPS = 1000;

/** Reserve mode: days a domestic order's reserve is kept before release. */
export const RESERVE_ROLLING_DAYS = 30;

/**
 * Whether the app should present held funds as binding. Policy is computed
 * regardless; until Dev decides the two constants above this stays false and
 * the mobile app does not show a "held" line. It never changes what Stripe
 * pays out by itself.
 */
export const PAYOUT_POLICY_ENFORCED = false;

/**
 * Stripe Instant Payouts: 1% of the payout, minimum $0.50 (Stripe's published
 * US pricing as of writing; not verifiable from this sandbox, so re-check at
 * https://stripe.com/pricing before launch). Named constants, nothing else
 * hard-codes them.
 */
export const INSTANT_PAYOUT_FEE_BPS = 100;
export const INSTANT_PAYOUT_MIN_FEE_CENTS = 50;

export const PAYOUT_WEEKLY_ANCHORS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
] as const;
export type WeeklyAnchor = (typeof PAYOUT_WEEKLY_ANCHORS)[number];

const DAY_MS = 86_400_000;

export function isDomesticCountry(country: string | null | undefined): boolean {
  const c = (country ?? "").trim().toUpperCase();
  // An order with no recorded country predates country capture; treat it as
  // domestic rather than penalising the seller for missing data.
  return c === "" || c === HOME_COUNTRY;
}

/**
 * ─── HOOK: delivery guarantee / hold until delivered ─────────────────────
 * The "hold until delivered" guarantee (lib/delivery/payoutGate.ts, its own
 * PAYOUT_MODE env) is a separate mechanism and is intentionally NOT wired
 * into this policy yet. When it should apply here it plugs in through
 * `extraHoldUntil` (see HoldReleaseOptions): return the date the guarantee
 * requires funds to stay held until (for example the order's
 * payout_release_at), or null when it does not apply. holdReleaseDate() then
 * takes the later of that date and the policy date. Nothing else in this
 * file needs to change.
 */
export type ExtraHoldUntil = (ctx: { paidAt: Date; country: string | null | undefined }) => Date | null;

export type HoldReleaseOptions = {
  mode?: PayoutProtectionMode;
  internationalDays?: number;
  /** Hook for the delivery guarantee (not implemented; see above). */
  extraHoldUntil?: ExtraHoldUntil;
};

export type HoldAnchor = Date | { paidAt?: Date | null; deliveredAt?: Date | null };

/** Days funds are held (hold mode) or reserved (reserve mode) for this country. */
export function holdDays(country: string | null | undefined, opts: HoldReleaseOptions = {}): number {
  const mode = opts.mode ?? PAYOUT_PROTECTION_MODE;
  if (isDomesticCountry(country)) {
    return mode === "hold" ? DOMESTIC_PAYOUT_DELAY_DAYS : RESERVE_ROLLING_DAYS;
  }
  return opts.internationalDays ?? INTERNATIONAL_HOLD_DAYS;
}

/**
 * When the held (or reserved) funds of an order are released. The clock
 * starts at delivery when a delivered-at is supplied, else at payment.
 */
export function holdReleaseDate(
  anchor: HoldAnchor,
  country: string | null | undefined,
  opts: HoldReleaseOptions = {},
): Date {
  const base = anchor instanceof Date ? anchor : (anchor.deliveredAt ?? anchor.paidAt ?? null);
  if (!base || Number.isNaN(base.valueOf())) throw new RangeError("holdReleaseDate needs a valid paidAt or deliveredAt");
  const policyDate = new Date(base.valueOf() + holdDays(country, opts) * DAY_MS);
  const paidAt = anchor instanceof Date ? anchor : (anchor.paidAt ?? base);
  const extra = opts.extraHoldUntil?.({ paidAt, country }) ?? null;
  return extra && extra.valueOf() > policyDate.valueOf() ? extra : policyDate;
}

export type HoldableOrder = {
  /** What the seller earns from the order, in cents (after fees and refunds). */
  netCents: number;
  paidAt: Date;
  deliveredAt?: Date | null;
  country?: string | null;
};

export type HeldFunds = {
  mode: PayoutProtectionMode;
  heldCents: number;
  /** Earliest release date among orders still held, or null. */
  nextReleaseAt: Date | null;
  /** Orders still held. */
  count: number;
};

/** How much of one order is held/reserved at `now` (0 once released). */
export function heldCentsForOrder(order: HoldableOrder, now: Date, opts: HoldReleaseOptions = {}): number {
  assertCents(order.netCents, "netCents");
  const releaseAt = holdReleaseDate(
    { paidAt: order.paidAt, deliveredAt: order.deliveredAt ?? null }, order.country, opts,
  );
  if (releaseAt.valueOf() <= now.valueOf()) return 0;
  const mode = opts.mode ?? PAYOUT_PROTECTION_MODE;
  return mode === "hold" ? order.netCents : bpsOfCents(order.netCents, RESERVE_BPS);
}

export function computeHeldFunds(orders: HoldableOrder[], now: Date, opts: HoldReleaseOptions = {}): HeldFunds {
  const mode = opts.mode ?? PAYOUT_PROTECTION_MODE;
  let heldCents = 0;
  let count = 0;
  let next: Date | null = null;
  for (const order of orders) {
    const held = heldCentsForOrder(order, now, opts);
    if (held <= 0) continue;
    heldCents += held;
    count += 1;
    const releaseAt = holdReleaseDate(
      { paidAt: order.paidAt, deliveredAt: order.deliveredAt ?? null }, order.country, opts,
    );
    if (!next || releaseAt.valueOf() < next.valueOf()) next = releaseAt;
  }
  return { mode, heldCents, nextReleaseAt: next, count };
}

// ─── Instant payout fee ─────────────────────────────────────────────────────

/** Fee Stripe charges for an instant payout of `amountCents`: 1%, min $0.50. */
export function instantPayoutFeeCents(amountCents: number): number {
  assertCents(amountCents, "amountCents");
  if (amountCents === 0) return 0;
  return Math.max(INSTANT_PAYOUT_MIN_FEE_CENTS, bpsOfCents(amountCents, INSTANT_PAYOUT_FEE_BPS));
}

/**
 * Largest instant payout that still fits in `availableCents` once its fee is
 * paid from the same balance (amount + fee <= available). The fee grows
 * monotonically with the amount, so a binary search is exact.
 */
export function maxInstantPayoutCents(availableCents: number): number {
  assertCents(availableCents, "availableCents");
  let lo = 0;
  let hi = Math.max(0, availableCents - INSTANT_PAYOUT_MIN_FEE_CENTS);
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (mid + instantPayoutFeeCents(mid) <= availableCents) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// ─── Next payout estimate ───────────────────────────────────────────────────

export type PayoutScheduleInterval = "daily" | "weekly" | "monthly" | "manual";

export type NextPayoutEstimate =
  | { kind: "existing"; date: Date; amountCents: number; payoutId: string }
  | { kind: "scheduled"; date: Date; amountCents: number }
  | { kind: "manual"; date: null; amountCents: number }
  | { kind: "none"; date: null; amountCents: 0 };

function isBusinessDay(d: Date): boolean {
  const day = d.getUTCDay();
  return day !== 0 && day !== 6;
}

function nextBusinessDay(from: Date): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1, 12));
  while (!isBusinessDay(d)) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

function nextWeekday(from: Date, anchor: WeeklyAnchor): Date {
  const target = (PAYOUT_WEEKLY_ANCHORS.indexOf(anchor) + 1) % 7; // monday=1 ... sunday=0
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1, 12));
  while (d.getUTCDay() !== target) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/**
 * When the next payout is expected and for how much. A payout Stripe has
 * already created (pending/in transit) wins. Otherwise the amount is the
 * available balance that the next scheduled run will pick up; funds still
 * pending or held by policy are not included. Manual schedules have no date.
 */
export function estimateNextPayout(input: {
  now: Date;
  interval: PayoutScheduleInterval | null;
  weeklyAnchor?: WeeklyAnchor | null;
  monthlyAnchor?: number | null;
  availableCents: number;
  heldCents?: number;
  existing?: { id: string; amountCents: number; arrivalDate: Date } | null;
}): NextPayoutEstimate {
  assertCents(input.availableCents, "availableCents");
  if (input.existing) {
    return { kind: "existing", date: input.existing.arrivalDate, amountCents: input.existing.amountCents, payoutId: input.existing.id };
  }
  const payable = Math.max(0, input.availableCents - Math.max(0, input.heldCents ?? 0));
  switch (input.interval) {
    case "daily":
      return payable > 0 ? { kind: "scheduled", date: nextBusinessDay(input.now), amountCents: payable } : { kind: "none", date: null, amountCents: 0 };
    case "weekly": {
      if (payable <= 0 || !input.weeklyAnchor) return { kind: "none", date: null, amountCents: 0 };
      return { kind: "scheduled", date: nextWeekday(input.now, input.weeklyAnchor), amountCents: payable };
    }
    case "monthly": {
      const anchor = input.monthlyAnchor;
      if (payable <= 0 || !anchor || anchor < 1 || anchor > 31) return { kind: "none", date: null, amountCents: 0 };
      const y = input.now.getUTCFullYear();
      const m = input.now.getUTCMonth();
      const thisMonth = new Date(Date.UTC(y, m, Math.min(anchor, new Date(Date.UTC(y, m + 1, 0)).getUTCDate()), 12));
      const date = thisMonth.valueOf() > input.now.valueOf()
        ? thisMonth
        : new Date(Date.UTC(y, m + 1, Math.min(anchor, new Date(Date.UTC(y, m + 2, 0)).getUTCDate()), 12));
      return { kind: "scheduled", date, amountCents: payable };
    }
    case "manual":
      return { kind: "manual", date: null, amountCents: payable };
    default:
      return { kind: "none", date: null, amountCents: 0 };
  }
}

/** Plain-JSON view of the policy for API responses (never the constants' names). */
export function payoutPolicySnapshot() {
  return {
    mode: PAYOUT_PROTECTION_MODE,
    enforced: PAYOUT_POLICY_ENFORCED,
    domesticDays: holdDays(HOME_COUNTRY),
    internationalDays: INTERNATIONAL_HOLD_DAYS,
    reserveBps: PAYOUT_PROTECTION_MODE === "reserve" ? RESERVE_BPS : null,
    instantFeeBps: INSTANT_PAYOUT_FEE_BPS,
    instantMinFeeCents: INSTANT_PAYOUT_MIN_FEE_CENTS,
  };
}
