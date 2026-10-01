/**
 * Server-side product analytics (PostHog), for the funnel steps the server is
 * the authority on (today: a paid order).
 *
 * Opt-in and inert by default:
 * - With POSTHOG_API_KEY unset (or in NODE_ENV=test) every function here is a
 *   no-op and no network call is ever made.
 * - Events are queued in memory and sent in batches from a timer. Capturing
 *   never throws, never awaits the network and never slows a request.
 * - Only allow-listed event names and property keys are sent, and property
 *   values must be short tokens, numbers or booleans, so free text, emails and
 *   other personal data cannot leave the server even by mistake.
 * - People are identified by their opaque Clerk user id only.
 */

export const ANALYTICS_EVENTS = {
  purchase_completed: ["amount_bucket", "currency", "item_count", "charge_model", "is_guest"],
} as const satisfies Record<string, readonly string[]>;

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS;

const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,48}$/;
const PLACEHOLDER_PATTERN = /^(REPLACE_WITH_|your[-_]|<|\$|replace_me)/i;
const DEFAULT_HOST = "https://us.i.posthog.com";

type Primitive = string | number | boolean;

/** Returns only the allow-listed, safely-shaped properties for an event, or null for an unknown event. */
export function sanitizeProperties(event: string, props: Record<string, unknown> | undefined): Record<string, Primitive> | null {
  if (!Object.prototype.hasOwnProperty.call(ANALYTICS_EVENTS, event)) return null;
  const allowed: readonly string[] = ANALYTICS_EVENTS[event as AnalyticsEventName];
  const out: Record<string, Primitive> = {};
  for (const key of allowed) {
    const value = props?.[key];
    if (typeof value === "boolean") out[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "string" && SAFE_TOKEN.test(value)) out[key] = value;
  }
  return out;
}

/** Coarse order-value bucket in whole dollars, so the exact amount is never sent. */
export function amountBucket(cents: number): string {
  if (!Number.isFinite(cents) || cents < 0) return "unknown";
  const dollars = cents / 100;
  if (dollars < 25) return "0-25";
  if (dollars < 50) return "25-50";
  if (dollars < 100) return "50-100";
  if (dollars < 250) return "100-250";
  if (dollars < 500) return "250-500";
  if (dollars < 1000) return "500-1000";
  return "1000-plus";
}

export function resolveApiKey(raw: string | undefined): string | null {
  const key = raw?.trim();
  if (!key || PLACEHOLDER_PATTERN.test(key)) return null;
  return key;
}

export function resolveHost(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_HOST;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return DEFAULT_HOST;
    return url.origin;
  } catch {
    return DEFAULT_HOST;
  }
}

type QueuedEvent = { event: string; distinct_id: string; properties: Record<string, unknown>; timestamp: string };

export type AnalyticsOptions = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  batchSize?: number;
  flushIntervalMs?: number;
  maxQueue?: number;
  timeoutMs?: number;
};

export type AnalyticsClient = {
  enabled: boolean;
  capture(event: AnalyticsEventName, distinctId: string | null | undefined, props?: Record<string, unknown>): void;
  flush(): Promise<void>;
};

export function createAnalytics(options: AnalyticsOptions = {}): AnalyticsClient {
  const env = options.env ?? process.env;
  const apiKey = resolveApiKey(env.POSTHOG_API_KEY);
  const enabled = Boolean(apiKey) && env.NODE_ENV !== "test";
  if (!enabled || !apiKey) {
    return { enabled: false, capture() {}, async flush() {} };
  }
  const endpoint = `${resolveHost(env.POSTHOG_HOST)}/batch/`;
  const doFetch = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  const batchSize = options.batchSize ?? 20;
  const flushIntervalMs = options.flushIntervalMs ?? 5000;
  const maxQueue = options.maxQueue ?? 500;
  const timeoutMs = options.timeoutMs ?? 4000;
  let queue: QueuedEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function flush(): Promise<void> {
    if (timer) { clearTimeout(timer); timer = null; }
    if (queue.length === 0 || !doFetch) return;
    const batch = queue.slice(0, batchSize);
    queue = queue.slice(batch.length);
    try {
      const controller = new AbortController();
      const abort = setTimeout(() => controller.abort(), timeoutMs);
      try {
        await doFetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: apiKey, batch }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(abort);
      }
    } catch {
      // Analytics is best-effort: a failed batch is dropped, never retried or thrown.
    }
    if (queue.length > 0) schedule();
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; void flush(); }, flushIntervalMs);
    (timer as { unref?: () => void }).unref?.();
  }

  return {
    enabled: true,
    capture(event, distinctId, props) {
      try {
        const properties = sanitizeProperties(event, props);
        if (!properties) return;
        const id = typeof distinctId === "string" && SAFE_TOKEN.test(distinctId) ? distinctId : null;
        if (queue.length >= maxQueue) queue.shift();
        queue.push({
          event,
          distinct_id: id ?? `anon_${Math.random().toString(36).slice(2, 12)}`,
          properties: {
            ...properties,
            $lib: "brandthread-api",
            $geoip_disable: true,
            ...(id ? {} : { $process_person_profile: false }),
          },
          timestamp: new Date().toISOString(),
        });
        if (queue.length >= batchSize) void flush();
        else schedule();
      } catch {
        // Never let analytics break a request.
      }
    },
    flush,
  };
}

let shared: AnalyticsClient | null = null;
function client(): AnalyticsClient {
  shared ??= createAnalytics();
  return shared;
}

/** Fire-and-forget. Safe to call anywhere; does nothing without POSTHOG_API_KEY. */
export function captureServerEvent(event: AnalyticsEventName, distinctId: string | null | undefined, props?: Record<string, unknown>): void {
  try {
    client().capture(event, distinctId, props);
  } catch {
    // ignore
  }
}

export async function flushAnalytics(): Promise<void> {
  try {
    await client().flush();
  } catch {
    // ignore
  }
}
