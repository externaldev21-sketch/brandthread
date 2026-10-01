/**
 * Pure helpers for the seller's payout schedule (Stripe Connect
 * settings.payouts.schedule) and Instant Payout eligibility. No Stripe client
 * here, so everything is unit-testable.
 *
 * "Instant" in the app is not a Stripe schedule: it is the `manual` schedule
 * plus on-demand instant payouts (POST /api/finance/payout {method:"instant"}).
 */
import { PAYOUT_WEEKLY_ANCHORS, type WeeklyAnchor } from "./payoutPolicy";

export type SettableInterval = "daily" | "weekly" | "manual";

export type ScheduleUpdate = {
  interval: SettableInterval;
  weeklyAnchor?: WeeklyAnchor;
};

export type ScheduleValidation =
  | { ok: true; update: ScheduleUpdate }
  | { ok: false; code: "INVALID_SCHEDULE"; message: string };

/** Validates the PATCH /payout-schedule body. Unknown fields are ignored. */
export function validateScheduleInput(body: unknown): ScheduleValidation {
  const fail = (message: string): ScheduleValidation => ({ ok: false, code: "INVALID_SCHEDULE", message });
  if (!body || typeof body !== "object") return fail("A schedule is required");
  const { interval, weeklyAnchor } = body as { interval?: unknown; weeklyAnchor?: unknown };
  if (interval !== "daily" && interval !== "weekly" && interval !== "manual") {
    return fail("interval must be daily, weekly or manual");
  }
  if (interval === "weekly") {
    if (typeof weeklyAnchor !== "string" || !(PAYOUT_WEEKLY_ANCHORS as readonly string[]).includes(weeklyAnchor)) {
      return fail("weeklyAnchor must be a day of the week");
    }
    return { ok: true, update: { interval, weeklyAnchor: weeklyAnchor as WeeklyAnchor } };
  }
  if (weeklyAnchor !== undefined && weeklyAnchor !== null) return fail("weeklyAnchor only applies to a weekly schedule");
  return { ok: true, update: { interval } };
}

export type CurrentSchedule = {
  interval: string | null;
  weeklyAnchor: string | null;
  delayDays: number | null;
  monthlyAnchor: number | null;
};

export function currentScheduleOf(account: any): CurrentSchedule | null {
  const s = account?.settings?.payouts?.schedule;
  if (!s) return null;
  return {
    interval: s.interval ?? null,
    weeklyAnchor: s.weekly_anchor ?? null,
    delayDays: s.delay_days ?? null,
    monthlyAnchor: s.monthly_anchor ?? null,
  };
}

/** True when Stripe already has exactly this schedule (makes PATCH idempotent). */
export function scheduleMatches(current: CurrentSchedule | null, update: ScheduleUpdate): boolean {
  if (!current || current.interval !== update.interval) return false;
  return update.interval !== "weekly" || current.weeklyAnchor === update.weeklyAnchor;
}

/** The Stripe `settings.payouts.schedule` object for an update. */
export function stripeScheduleParams(update: ScheduleUpdate) {
  return update.interval === "weekly"
    ? { interval: "weekly" as const, weekly_anchor: update.weeklyAnchor }
    : { interval: update.interval };
}

export type InstantEligibility =
  | { eligible: true; destination: { id: string; brand: string | null; last4: string | null; funding: string | null } }
  | { eligible: false; reason: "no_destination" | "not_instant_capable" };

function usableExternalAccount(a: any, currency: string): boolean {
  return a?.currency?.toLowerCase() === currency
    && a.status !== "errored" && a.status !== "verification_failed";
}

/**
 * Real Stripe Instant Payouts only work to an external account whose
 * `available_payout_methods` includes "instant" (a debit card, or an instant
 * capable bank). Eligibility comes from Stripe, never inferred from the brand.
 */
export function findInstantDestination(externalAccounts: any[], currency = "usd"): InstantEligibility {
  const usable = externalAccounts.filter((a) => usableExternalAccount(a, currency));
  if (usable.length === 0) return { eligible: false, reason: "no_destination" };
  const capable = usable
    .filter((a) => Array.isArray(a.available_payout_methods) && a.available_payout_methods.includes("instant"))
    .sort((a, b) => Number(b.default_for_currency === true) - Number(a.default_for_currency === true))[0];
  if (!capable) return { eligible: false, reason: "not_instant_capable" };
  return {
    eligible: true,
    destination: {
      id: capable.id,
      brand: capable.brand ?? capable.bank_name ?? null,
      last4: capable.last4 ?? null,
      funding: capable.funding ?? (capable.object === "bank_account" ? "bank" : null),
    },
  };
}
