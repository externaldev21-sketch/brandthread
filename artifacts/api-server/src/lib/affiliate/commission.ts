/**
 * Affiliate program rules, as pure functions (no database, no clock of their
 * own). Everything money-related is integer cents and integer basis points.
 *
 * Rounding rule (documented in the PR and the seller/creator screens):
 *   commission = FLOOR(base_cents * bps / 10_000)
 * Fractions of a cent are never paid, so the seller is never charged more
 * than the stated percentage. 10% of $19.99 (1999c) is 199c, not 200c.
 *
 * Commission base = the order's item subtotal minus seller-funded discounts.
 * Tax and shipping are never commissionable.
 */

export const MAX_COMMISSION_BPS = 5000; // 50% ceiling a seller may set
export const MAX_BUYER_DISCOUNT_BPS = 5000;
export const DEFAULT_WINDOW_DAYS = 30;
export const MAX_WINDOW_DAYS = 365;
export const MAX_HOLD_DAYS = 120;
const DAY_MS = 86_400_000;

export type CommissionStatus = "pending" | "payable" | "paid" | "reversed";

export function isValidBps(bps: unknown, max = MAX_COMMISSION_BPS): bps is number {
  return typeof bps === "number" && Number.isInteger(bps) && bps >= 0 && bps <= max;
}

/** A percent typed by a person (10, 12.5) to basis points; null when invalid. */
export function percentToBps(percent: unknown): number | null {
  const n = typeof percent === "string" ? Number(percent) : percent;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  const bps = Math.round(n * 100);
  return bps <= 10_000 ? bps : null;
}

export function commissionBaseCents(input: { subtotalCents: number; sellerDiscountCents: number }): number {
  const subtotal = Math.max(0, Math.trunc(input.subtotalCents));
  const discount = Math.max(0, Math.trunc(input.sellerDiscountCents));
  return Math.max(0, subtotal - discount);
}

export function computeCommissionCents(baseCents: number, bps: number): number {
  if (!Number.isSafeInteger(baseCents) || !Number.isSafeInteger(bps) || baseCents <= 0 || bps <= 0) return 0;
  return Math.floor((baseCents * bps) / 10_000);
}

export function effectiveBps(programDefaultBps: number, overrideBps: number | null | undefined): number {
  return overrideBps == null ? programDefaultBps : overrideBps;
}

/** The last click still counts if the order was paid inside the window. */
export function isAttributionActive(input: { clickedAt: Date; windowDays: number; at: Date }): boolean {
  const end = input.clickedAt.getTime() + input.windowDays * DAY_MS;
  return input.at.getTime() >= input.clickedAt.getTime() && input.at.getTime() <= end;
}

export function attributionExpiry(clickedAt: Date, windowDays: number): Date {
  return new Date(clickedAt.getTime() + windowDays * DAY_MS);
}

/**
 * A creator can never earn on their own purchase or their own brand. A guest
 * buyer is matched by email too, since a guest has no account id.
 */
export function isSelfReferral(input: {
  creatorId: string;
  sellerId: string;
  buyerId?: string | null;
  creatorEmail?: string | null;
  buyerEmail?: string | null;
}): boolean {
  if (input.creatorId === input.sellerId) return true;
  if (input.buyerId && input.buyerId === input.creatorId) return true;
  const a = input.creatorEmail?.trim().toLowerCase();
  const b = input.buyerEmail?.trim().toLowerCase();
  return Boolean(a && b && a === b);
}

/**
 * How much of a commission is reversed after refunds. The creator keeps the
 * commission on the part of the order that was not refunded:
 *   kept = FLOOR(amount * (gross - refunded) / gross)
 * so a full refund or cancellation reverses everything, and a partial refund
 * reverses in proportion (never more than the commission). Returns the new
 * TOTAL reversed amount; callers apply only the increase over what is already
 * reversed, which makes the operation idempotent.
 */
export function totalReversalCents(input: {
  amountCents: number;
  grossCents: number;
  refundedCents: number;
  cancelled: boolean;
}): number {
  const { amountCents, grossCents } = input;
  if (amountCents <= 0) return 0;
  if (input.cancelled || grossCents <= 0) return amountCents;
  const refunded = Math.min(Math.max(0, input.refundedCents), grossCents);
  const kept = Math.floor((amountCents * (grossCents - refunded)) / grossCents);
  return amountCents - kept;
}

/** Net entitlement after reversals; what is still owed is this minus paid. */
export function netCommissionCents(c: { amountCents: number; reversedCents: number }): number {
  return Math.max(0, c.amountCents - c.reversedCents);
}

export function owedCents(c: { amountCents: number; reversedCents: number; paidCents: number }): number {
  return netCommissionCents(c) - c.paidCents;
}

/**
 * When a pending commission turns payable: only after the order is delivered
 * AND the return window (hold days) has passed. No delivery, no eligibility.
 */
export function commissionEligibleAt(input: { deliveredAt: Date | null | undefined; holdDays: number }): Date | null {
  if (!input.deliveredAt) return null;
  return new Date(input.deliveredAt.getTime() + input.holdDays * DAY_MS);
}

export function statusAfterChange(c: {
  amountCents: number; reversedCents: number; paidCents: number; eligibleAt: Date | null; now: Date; frozen?: boolean;
}): CommissionStatus {
  const net = netCommissionCents(c);
  if (net === 0) return "reversed";
  if (c.paidCents >= net) return "paid";
  if (!c.frozen && c.eligibleAt && c.eligibleAt.getTime() <= c.now.getTime()) return "payable";
  return "pending";
}

export type PayoutPlanRow = { commissionId: string; owed: number; status: CommissionStatus };

/**
 * Decide whether a creator can be paid now. Payable rows add, clawback debts
 * (paid more than still owed) subtract. A payout is made only when the net is
 * at least the program's minimum AND the creator's Connect account can receive
 * transfers; otherwise the money simply keeps accruing.
 */
export function planPayout(input: {
  rows: PayoutPlanRow[];
  minPayoutCents: number;
  accountReady: boolean;
  payoutsAvailable: boolean;
}): { eligible: boolean; amountCents: number; reason: "ok" | "unavailable" | "no_account" | "below_minimum" | "nothing_owed"; rows: PayoutPlanRow[] } {
  const rows = input.rows.filter((r) => (r.status === "payable" && r.owed > 0) || r.owed < 0);
  const amountCents = rows.reduce((s, r) => s + r.owed, 0);
  if (!input.payoutsAvailable) return { eligible: false, amountCents, reason: "unavailable", rows };
  if (amountCents <= 0) return { eligible: false, amountCents, reason: "nothing_owed", rows };
  if (!input.accountReady) return { eligible: false, amountCents, reason: "no_account", rows };
  if (amountCents < Math.max(1, input.minPayoutCents)) return { eligible: false, amountCents, reason: "below_minimum", rows };
  return { eligible: true, amountCents, reason: "ok", rows };
}

/** Unambiguous code alphabet (no 0/O/1/I), 4 random chars after a name stem. */
export function codeStem(name: string): string {
  const stem = name.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/[01OI]/g, "").slice(0, 8);
  return stem.length >= 3 ? stem : "";
}

export function normalizeAffiliateCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9-]{2,23}$/.test(code) ? code : null;
}
