import { describe, expect, it } from "vitest";
import {
  DEFAULT_DUNNING_MAX_RETRIES,
  decidePaymentFailed,
  decidePaymentRecovered,
  dunningAwareStatus,
  dunningMaxRetries,
  dunningSummary,
  isDunningPaused,
  pausedNoticeCopy,
  retryNoticeCopy,
} from "../dunning";
import {
  annualLookupKey, intervalFromSubscription, parseBillingInterval, planAmountCents, priceSpecFor,
} from "../annual";
import { sellerPlanFromStripeLookupKey } from "../../stripePlanMapping";

const nextRetry = Math.floor(Date.UTC(2026, 9, 16, 12) / 1000);

describe("dunning state machine", () => {
  const base = { invoiceId: "in_1", nextPaymentAttempt: nextRetry, maxRetries: 3, record: null };

  it("attempts 1–3 notify with 'retry N of 3' and the next retry date", () => {
    for (const attempt of [1, 2, 3]) {
      const decision = decidePaymentFailed({ ...base, attemptCount: attempt, record: attempt > 1 ? { invoiceId: "in_1", lastAttempt: attempt - 1, pausedAt: null } : null });
      expect(decision).toEqual({
        kind: "notify", attempt, retryNumber: attempt, maxRetries: 3, nextRetryAt: new Date(nextRetry * 1000),
      });
    }
  });

  it("pauses when the 3rd retry fails (attempt_count 4 = initial + 3 retries)", () => {
    expect(decidePaymentFailed({ ...base, attemptCount: 4, nextPaymentAttempt: null, record: { invoiceId: "in_1", lastAttempt: 3, pausedAt: null } }))
      .toEqual({ kind: "pause", attempt: 4, maxRetries: 3 });
  });

  it("pauses even if retries were skipped in between (attempt_count jumps past the limit)", () => {
    expect(decidePaymentFailed({ ...base, attemptCount: 6, record: null }).kind).toBe("pause");
  });

  it("honours a custom retry limit", () => {
    expect(decidePaymentFailed({ ...base, attemptCount: 2, maxRetries: 1 }).kind).toBe("pause");
    expect(decidePaymentFailed({ ...base, attemptCount: 5, maxRetries: 5 }).kind).toBe("notify");
  });

  it("ignores a replayed or older attempt on the same invoice", () => {
    const record = { invoiceId: "in_1", lastAttempt: 2, pausedAt: null };
    expect(decidePaymentFailed({ ...base, attemptCount: 2, record })).toEqual({ kind: "ignore", reason: "replay" });
    expect(decidePaymentFailed({ ...base, attemptCount: 1, record })).toEqual({ kind: "ignore", reason: "replay" });
  });

  it("ignores further failures on an invoice that already paused the plan", () => {
    const record = { invoiceId: "in_1", lastAttempt: 4, pausedAt: new Date() };
    expect(decidePaymentFailed({ ...base, attemptCount: 5, record })).toEqual({ kind: "ignore", reason: "already_paused" });
  });

  it("starts over for a new invoice", () => {
    const record = { invoiceId: "in_old", lastAttempt: 3, pausedAt: null };
    expect(decidePaymentFailed({ ...base, invoiceId: "in_new", attemptCount: 1, record }).kind).toBe("notify");
  });

  it("treats a missing attempt_count as the first attempt and a missing retry date as unknown", () => {
    expect(decidePaymentFailed({ ...base, attemptCount: undefined, nextPaymentAttempt: null }))
      .toEqual({ kind: "notify", attempt: 1, retryNumber: 1, maxRetries: 3, nextRetryAt: null });
  });

  it("resumes only a dunning pause, clears a recovered retry run, and leaves everything else alone", () => {
    expect(decidePaymentRecovered({ record: { invoiceId: "in_1", lastAttempt: 4, pausedAt: new Date() } })).toEqual({ kind: "resume" });
    expect(decidePaymentRecovered({ record: null, subscriptionMetadata: { dunningPausedAt: "2026-10-13" } })).toEqual({ kind: "resume" });
    expect(decidePaymentRecovered({ record: { invoiceId: "in_1", lastAttempt: 2, pausedAt: null } })).toEqual({ kind: "clear" });
    expect(decidePaymentRecovered({ record: null })).toEqual({ kind: "noop" });
    // #835's voluntary pause: lastPausedAt only.
    expect(decidePaymentRecovered({ record: null, subscriptionMetadata: { lastPausedAt: "1" } })).toEqual({ kind: "noop" });
  });
});

describe("dunning status + config", () => {
  it("maps a dunning pause to 'paused' but leaves a voluntary pause alone", () => {
    expect(dunningAwareStatus({ status: "past_due", pause_collection: { behavior: "void" }, metadata: { dunningPausedAt: "x" } })).toBe("paused");
    expect(dunningAwareStatus({ status: "active", pause_collection: { behavior: "void", resumes_at: 1 }, metadata: { lastPausedAt: "1" } })).toBe("active");
    expect(dunningAwareStatus({ status: "active", pause_collection: null, metadata: { dunningPausedAt: "x" } })).toBe("active");
    expect(isDunningPaused({ pause_collection: null, metadata: {} })).toBe(false);
  });

  it("reads BILLING_DUNNING_MAX_RETRIES with a default of 3", () => {
    expect(DEFAULT_DUNNING_MAX_RETRIES).toBe(3);
    expect(dunningMaxRetries({})).toBe(3);
    expect(dunningMaxRetries({ BILLING_DUNNING_MAX_RETRIES: "5" })).toBe(5);
    expect(dunningMaxRetries({ BILLING_DUNNING_MAX_RETRIES: "zero" })).toBe(3);
    expect(dunningMaxRetries({ BILLING_DUNNING_MAX_RETRIES: "0" })).toBe(3);
  });

  it("summarises retrying and paused states for the app", () => {
    const at = new Date(nextRetry * 1000);
    expect(dunningSummary({ lastAttempt: 2, maxRetries: 3, nextRetryAt: at, pausedAt: null }, "past_due"))
      .toEqual({ state: "retrying", retryNumber: 2, maxRetries: 3, nextRetryAt: at.toISOString() });
    expect(dunningSummary({ lastAttempt: 2, maxRetries: 3, nextRetryAt: at, pausedAt: null }, "active")).toBeNull();
    expect(dunningSummary({ lastAttempt: 4, maxRetries: 3, nextRetryAt: null, pausedAt: at }, "past_due"))
      .toEqual({ state: "paused", pausedAt: at.toISOString(), maxRetries: 3 });
    expect(dunningSummary(null, "past_due")).toBeNull();
  });

  it("writes retry and pause copy with the retry date", () => {
    const copy = retryNoticeCopy({ retryNumber: 1, maxRetries: 3, nextRetryAt: new Date(nextRetry * 1000), planLabel: "Growth" });
    expect(copy.title).toBe("Payment didn't go through");
    expect(copy.body).toContain("We'll try again on Oct 16 (retry 1 of 3).");
    expect(pausedNoticeCopy({ maxRetries: 3, planLabel: "Growth" }).body).toContain("tried your card 4 times");
  });
});

describe("annual plans (2 months free)", () => {
  it("prices a year at 10 × monthly", () => {
    expect(planAmountCents("starter", "year")).toBe(19_990);
    expect(planAmountCents("growth", "year")).toBe(49_000);
    expect(planAmountCents("pro", "year")).toBe(129_000);
    expect(planAmountCents("growth", "month")).toBe(4_900);
  });

  it("uses brandthread_<plan>_annual lookup keys with a yearly interval", () => {
    expect(priceSpecFor("pro", "year")).toMatchObject({ lookupKey: "brandthread_pro_annual", amountCents: 129_000, interval: "year" });
    expect(priceSpecFor("pro", "month")).toMatchObject({ lookupKey: "brandthread_pro_199_monthly", amountCents: 12_900, interval: "month" });
  });

  it("maps annual lookup keys back to the same plans", () => {
    for (const plan of ["starter", "growth", "pro"] as const) {
      expect(sellerPlanFromStripeLookupKey(annualLookupKey(plan))).toBe(plan);
    }
    // Legacy key semantics are unchanged.
    expect(sellerPlanFromStripeLookupKey("brandthread_pro_monthly")).toBe("growth");
  });

  it("validates the checkout interval", () => {
    expect(parseBillingInterval(undefined)).toBe("month");
    expect(parseBillingInterval("month")).toBe("month");
    expect(parseBillingInterval("year")).toBe("year");
    expect(parseBillingInterval("annual")).toBeNull();
    expect(parseBillingInterval(12)).toBeNull();
  });

  it("reads a subscription's interval", () => {
    expect(intervalFromSubscription({ items: { data: [{ price: { recurring: { interval: "year" } } }] } })).toBe("year");
    expect(intervalFromSubscription({ items: { data: [{ price: { recurring: { interval: "month" } } }] } })).toBe("month");
    expect(intervalFromSubscription({})).toBe("month");
  });
});
