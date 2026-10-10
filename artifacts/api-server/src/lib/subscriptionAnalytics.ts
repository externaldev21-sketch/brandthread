/**
 * Maps seller-subscription webhook payloads to funnel analytics events
 * (BT-450): trial start, purchase, cancel, end and past_due, keyed by the
 * seller's Clerk id. Pure, so every mapping is unit tested; the webhook
 * handlers call captureServerEvent with the result.
 */
import type { AnalyticsEventName } from "./analytics";

export type SubscriptionAnalyticsEvent = {
  event: AnalyticsEventName;
  props: Record<string, string | boolean>;
};

/**
 * customer.subscription.created / .updated. `previousStatus` is what the
 * seller row held before this event; `previousAttributes` is Stripe's
 * event.data.previous_attributes (only on .updated).
 */
export function stripeSubscriptionEvents(input: {
  sub: { status?: string; cancel_at_period_end?: boolean };
  plan: string | null;
  previousStatus: string | null | undefined;
  previousAttributes?: Record<string, unknown> | null;
}): SubscriptionAnalyticsEvent[] {
  const status = input.sub.status ?? "";
  const before = input.previousStatus ?? "none";
  const plan = input.plan ?? "unknown";
  const base = { plan, provider: "stripe" };
  const out: SubscriptionAnalyticsEvent[] = [];
  if (status === "trialing" && before !== "trialing") {
    out.push({ event: "trial_started", props: base });
  }
  if (status === "active" && before !== "active" && before !== "past_due") {
    out.push({ event: "subscription_started", props: { ...base, from_trial: before === "trialing" } });
  }
  if (status === "past_due" && before !== "past_due") {
    out.push({ event: "subscription_past_due", props: base });
  }
  const cancelTurnedOn = input.sub.cancel_at_period_end === true
    && input.previousAttributes != null
    && input.previousAttributes.cancel_at_period_end === false;
  if (cancelTurnedOn) {
    out.push({ event: "subscription_cancelled", props: { ...base, in_trial: status === "trialing" } });
  }
  return out;
}

/** customer.subscription.deleted: access ended. */
export function stripeSubscriptionEndedEvent(plan: string | null): SubscriptionAnalyticsEvent {
  return { event: "subscription_ended", props: { plan: plan ?? "unknown", provider: "stripe" } };
}

const NATIVE_PLANS: Record<string, string> = {
  brandthread_starter_monthly: "starter",
  brandthread_growth_monthly: "growth",
  brandthread_pro_monthly: "pro",
  brandthread_scale_monthly: "pro",
};

function nativePlan(productId: unknown): string {
  if (typeof productId !== "string") return "unknown";
  return NATIVE_PLANS[productId.split(":")[0]] ?? "unknown";
}

function nativeProvider(store: unknown): string {
  if (store === "APP_STORE" || store === "MAC_APP_STORE") return "app_store";
  if (store === "PLAY_STORE") return "play_store";
  return "revenuecat";
}

/** A RevenueCat webhook event (https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields). */
export function revenueCatSubscriptionEvent(event: {
  type?: unknown;
  product_id?: unknown;
  period_type?: unknown;
  store?: unknown;
  is_trial_conversion?: unknown;
}): SubscriptionAnalyticsEvent | null {
  const plan = nativePlan(event.product_id);
  if (plan === "unknown") return null; // consumables, credit packs, promotions
  const base = { plan, provider: nativeProvider(event.store) };
  const trial = event.period_type === "TRIAL";
  switch (event.type) {
    case "INITIAL_PURCHASE":
      return trial
        ? { event: "trial_started", props: base }
        : { event: "subscription_started", props: { ...base, from_trial: false } };
    case "RENEWAL":
      return event.is_trial_conversion === true
        ? { event: "subscription_started", props: { ...base, from_trial: true } }
        : null;
    case "CANCELLATION":
      return { event: "subscription_cancelled", props: { ...base, in_trial: trial } };
    case "EXPIRATION":
      return { event: "subscription_ended", props: base };
    case "BILLING_ISSUE":
      return { event: "subscription_past_due", props: base };
    default:
      return null;
  }
}
