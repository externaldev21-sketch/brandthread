/**
 * The complete list of product-analytics events the app may send, and the only
 * property keys each one may carry. Anything else is dropped before it is
 * queued, so a stray email, name, message or search string cannot be sent even
 * by a careless call site. Kept free of React Native imports so it runs in Node
 * tests. See docs/reliability/observability.md.
 */
export const ANALYTICS_EVENTS = {
  app_opened: ['platform'],
  signup_started: ['method'],
  signup_completed: ['method'],
  onboarding_completed: ['account_type'],
  product_viewed: ['surface'],
  add_to_cart: ['quantity'],
  checkout_started: ['flow', 'item_count'],
  post_viewed: ['post_type'],
  video_watched: ['surface'],
  follow: ['surface'],
  message_sent: ['surface', 'has_attachment'],
  live_joined: ['surface'],
  seller_onboarding_completed: [],
  product_published: [],
  // Seller paywall (BT-450). Trial start, purchase, cancel and end are sent
  // by the server from the Stripe / RevenueCat webhooks, not from here.
  paywall_viewed: ['source', 'from_onboarding'],
  plan_selected: ['plan'],
  paywall_purchase_cancelled: ['plan'],
  paywall_dismissed: ['from_onboarding'],
} as const satisfies Record<string, readonly string[]>;

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS;
export type AnalyticsProps = Partial<Record<string, string | number | boolean | null | undefined>>;

type Primitive = string | number | boolean;

// Short identifier-like tokens only: no spaces, no "@", so free text and
// email addresses can never pass as a property value.
const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,48}$/;

export function isSafeToken(value: unknown): value is string {
  return typeof value === 'string' && SAFE_TOKEN.test(value);
}

/** Allow-listed, safely shaped properties for an event, or null when the event is unknown. */
export function sanitizeProperties(event: string, props: Record<string, unknown> | undefined): Record<string, Primitive> | null {
  if (!Object.prototype.hasOwnProperty.call(ANALYTICS_EVENTS, event)) return null;
  const allowed: readonly string[] = ANALYTICS_EVENTS[event as AnalyticsEventName];
  const out: Record<string, Primitive> = {};
  for (const key of allowed) {
    const value = props?.[key];
    if (typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (isSafeToken(value)) out[key] = value;
  }
  return out;
}

const PLACEHOLDER_PATTERN = /^(REPLACE_WITH_|your[-_]|<|\$|replace_me)/i;
export const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

export function resolveKey(raw: string | undefined): string | null {
  const key = raw?.trim();
  if (!key || PLACEHOLDER_PATTERN.test(key)) return null;
  return key;
}

export function resolveHost(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_POSTHOG_HOST;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return DEFAULT_POSTHOG_HOST;
    return url.origin;
  } catch {
    return DEFAULT_POSTHOG_HOST;
  }
}
