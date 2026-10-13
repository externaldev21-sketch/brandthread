/**
 * Dunning for seller platform subscriptions (Stripe) — item 115.
 *
 * Dev's rule: a failed subscription payment is retried exactly
 * BILLING_DUNNING_MAX_RETRIES times (default 3); when the last retry fails the
 * plan is paused until the seller updates their card and the open invoice is
 * paid.
 *
 * How Stripe's attempt_count maps onto that rule. `invoice.attempt_count`
 * counts every charge attempt on the invoice, including the first one:
 *
 *   attempt_count 1  first charge failed      → "Retry 1 of 3 on <date>"
 *   attempt_count 2  retry 1 failed           → "Retry 2 of 3 on <date>"
 *   attempt_count 3  retry 2 failed           → "Retry 3 of 3 on <date>"
 *   attempt_count 4  retry 3 (the last) failed → pause the plan
 *
 * i.e. pause when attempt_count > maxRetries (initial charge + N retries).
 * Stripe schedules the retries itself (Dashboard → Billing → Revenue recovery
 * → Retries); set that to 3 retries and "leave the subscription past due" so
 * Stripe never cancels before we pause. If Stripe's schedule has fewer retries
 * it simply stops retrying and the subscription stays past_due (next retry
 * date shows as unknown); it is never paused early.
 *
 * The pause uses pause_collection { behavior: "void" } with NO resumes_at, and
 * stamps subscription metadata `dunningPausedAt`. That is how it differs from
 * the seller's voluntary "Pause for a month" (lib/subscriptionPause.ts on
 * PR #835), which always sets resumes_at and `lastPausedAt`.
 *
 * Everything in this file is pure; the webhook side effects live in
 * dunningWebhooks.ts.
 */

export const DUNNING_PAUSED_METADATA_KEY = "dunningPausedAt";
export const DEFAULT_DUNNING_MAX_RETRIES = 3;

/** BILLING_DUNNING_MAX_RETRIES (integer 1–10), default 3. Invalid values fall back to 3. */
export function dunningMaxRetries(env: Record<string, string | undefined> = process.env): number {
  const raw = env.BILLING_DUNNING_MAX_RETRIES?.trim();
  if (!raw) return DEFAULT_DUNNING_MAX_RETRIES;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : DEFAULT_DUNNING_MAX_RETRIES;
}

/** What we last recorded for this seller (seller_subscription_dunning row). */
export type DunningRecord = {
  invoiceId: string | null;
  lastAttempt: number;
  pausedAt: Date | null;
};

export type PaymentFailedDecision =
  | { kind: "ignore"; reason: "replay" | "already_paused" }
  | {
      kind: "notify";
      attempt: number;
      /** The retry Stripe will make next (1-based), e.g. 1 for "Retry 1 of 3". */
      retryNumber: number;
      maxRetries: number;
      nextRetryAt: Date | null;
    }
  | { kind: "pause"; attempt: number; maxRetries: number };

export function stripeUnixToDate(value: unknown): Date | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? new Date(value * 1000) : null;
}

/**
 * invoice.payment_failed → what to do. Replays (same invoice, attempt not
 * newer than the one already handled) and failures on an invoice whose plan
 * is already paused are ignored, so a webhook redelivery never notifies or
 * pauses twice.
 */
export function decidePaymentFailed(input: {
  invoiceId: string;
  attemptCount: unknown;
  nextPaymentAttempt: unknown;
  maxRetries: number;
  record: DunningRecord | null;
}): PaymentFailedDecision {
  const attempt = typeof input.attemptCount === "number" && Number.isInteger(input.attemptCount) && input.attemptCount > 0
    ? input.attemptCount
    : 1;
  const sameInvoice = input.record?.invoiceId === input.invoiceId;
  if (sameInvoice && input.record?.pausedAt) return { kind: "ignore", reason: "already_paused" };
  if (sameInvoice && attempt <= (input.record?.lastAttempt ?? 0)) return { kind: "ignore", reason: "replay" };
  if (attempt > input.maxRetries) return { kind: "pause", attempt, maxRetries: input.maxRetries };
  return {
    kind: "notify",
    attempt,
    retryNumber: attempt,
    maxRetries: input.maxRetries,
    nextRetryAt: stripeUnixToDate(input.nextPaymentAttempt),
  };
}

export type PaymentRecoveredDecision =
  | { kind: "resume" }
  | { kind: "clear" }
  | { kind: "noop" };

/**
 * invoice.paid → resume a dunning-paused plan, clear an in-progress retry
 * sequence, or do nothing. A voluntary pause (#835) is never touched: it has
 * no dunning record and no dunningPausedAt metadata.
 */
export function decidePaymentRecovered(input: {
  record: DunningRecord | null;
  subscriptionMetadata?: Record<string, string> | null;
}): PaymentRecoveredDecision {
  if (input.record?.pausedAt || input.subscriptionMetadata?.[DUNNING_PAUSED_METADATA_KEY]) return { kind: "resume" };
  if (input.record && input.record.lastAttempt > 0) return { kind: "clear" };
  return { kind: "noop" };
}

type SubscriptionLike = {
  status?: string | null;
  pause_collection?: unknown;
  metadata?: Record<string, string> | null;
};

/** Paused by dunning (not by the seller's voluntary pause). */
export function isDunningPaused(sub: SubscriptionLike): boolean {
  return !!sub.pause_collection && !!sub.metadata?.[DUNNING_PAUSED_METADATA_KEY];
}

/**
 * The status stored in users.subscription_status. "paused" is not a granting
 * status in resolveEffectiveEntitlement (only active / trialing / past_due
 * are), so a dunning-paused seller is restricted exactly like a canceled one.
 */
export function dunningAwareStatus(sub: SubscriptionLike): string {
  return isDunningPaused(sub) ? "paused" : String(sub.status ?? "none");
}

export function formatRetryDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export type DunningCopy = { title: string; body: string; push: string; emailSubject: string };

/** planLabel is the bare tier name, e.g. "Growth". */
export function retryNoticeCopy(input: { retryNumber: number; maxRetries: number; nextRetryAt: Date | null; planLabel: string }): DunningCopy {
  const when = input.nextRetryAt
    ? `We'll try again on ${formatRetryDate(input.nextRetryAt)} (retry ${input.retryNumber} of ${input.maxRetries}).`
    : "Update your card so we can try again.";
  return {
    title: "Payment didn't go through",
    body: `We couldn't charge your card for your ${input.planLabel} plan. Update your card to keep your features. ${when}`,
    push: `Update your card to keep your ${input.planLabel} features. ${when}`,
    emailSubject: "Payment didn't go through — update your card",
  };
}

export function pausedNoticeCopy(input: { maxRetries: number; planLabel: string }): DunningCopy {
  return {
    title: "Plan paused",
    body: `We tried your card ${input.maxRetries + 1} times and couldn't charge it, so your ${input.planLabel} plan is paused. Update your card to pay and pick up where you left off.`,
    push: `Your ${input.planLabel} plan is paused after ${input.maxRetries + 1} failed payments. Update your card to resume.`,
    emailSubject: `Your ${input.planLabel} plan is paused`,
  };
}

export function resumedNoticeCopy(planLabel: string): DunningCopy {
  return {
    title: "Plan resumed",
    body: `Payment received. Your ${planLabel} plan is active again.`,
    push: `Payment received. Your ${planLabel} plan is active again.`,
    emailSubject: `Your ${planLabel} plan is active again`,
  };
}

/** Shape of `dunning` in GET /api/seller/subscription/status. */
export type DunningSummary =
  | { state: "retrying"; retryNumber: number; maxRetries: number; nextRetryAt: string | null }
  | { state: "paused"; pausedAt: string; maxRetries: number }
  | null;

export function dunningSummary(row: {
  lastAttempt: number;
  maxRetries: number;
  nextRetryAt: Date | null;
  pausedAt: Date | null;
} | null | undefined, subscriptionStatus?: string | null): DunningSummary {
  if (!row) return null;
  if (row.pausedAt) return { state: "paused", pausedAt: row.pausedAt.toISOString(), maxRetries: row.maxRetries };
  // A retry sequence only matters while Stripe still says the invoice is unpaid.
  if (row.lastAttempt > 0 && (subscriptionStatus === "past_due" || subscriptionStatus === "unpaid")) {
    return {
      state: "retrying",
      retryNumber: Math.min(row.lastAttempt, row.maxRetries),
      maxRetries: row.maxRetries,
      nextRetryAt: row.nextRetryAt?.toISOString() ?? null,
    };
  }
  return null;
}
