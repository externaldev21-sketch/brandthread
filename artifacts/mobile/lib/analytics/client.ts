import { isSafeToken, resolveHost, resolveKey, sanitizeProperties, type AnalyticsEventName, type AnalyticsProps } from './events';

/**
 * Tiny fetch-based PostHog client. No SDK, no native module, nothing to crash
 * at start-up: with no key it is a total no-op (no timers, no network); with a
 * key it queues allow-listed events in memory and posts them in batches.
 *
 * Gating, in order: key present -> not suppressed (preview / dev bypass) ->
 * consent granted. Events captured while gated are dropped, not held back, so
 * nothing is ever sent retroactively.
 */
export type AnalyticsClientOptions = {
  key?: string;
  host?: string;
  fetchImpl?: typeof fetch;
  batchSize?: number;
  flushIntervalMs?: number;
  maxQueue?: number;
  timeoutMs?: number;
  platform?: string;
};

type Queued = { event: string; distinct_id: string; properties: Record<string, unknown>; timestamp: string };

export type AnalyticsClient = {
  enabled: boolean;
  track(event: AnalyticsEventName, props?: AnalyticsProps): void;
  identify(userId: string | null | undefined): void;
  setConsent(granted: boolean): void;
  setSuppressed(suppressed: boolean): void;
  setPlatform(platform: string): void;
  flush(): Promise<void>;
};

function anonymousId(): string {
  return `anon_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
}

export function createAnalyticsClient(options: AnalyticsClientOptions = {}): AnalyticsClient {
  const key = resolveKey(options.key);
  if (!key) {
    return { enabled: false, track() {}, identify() {}, setConsent() {}, setSuppressed() {}, setPlatform() {}, async flush() {} };
  }
  const endpoint = `${resolveHost(options.host)}/batch/`;
  const doFetch = options.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
  const batchSize = options.batchSize ?? 20;
  const flushIntervalMs = options.flushIntervalMs ?? 10_000;
  const maxQueue = options.maxQueue ?? 200;
  const timeoutMs = options.timeoutMs ?? 5000;
  const sessionAnonId = anonymousId();
  let userId: string | null = null;
  let consent = false;
  let suppressed = false;
  let platform = options.platform;
  let queue: Queued[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function flush(): Promise<void> {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!doFetch || queue.length === 0) return;
    if (!consent || suppressed) { queue = []; return; }
    const batch = queue.slice(0, batchSize);
    queue = queue.slice(batch.length);
    try {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const abort = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        await doFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: key, batch }),
          signal: controller?.signal,
        });
      } finally {
        if (abort) clearTimeout(abort);
      }
    } catch {
      // Best-effort: a failed batch is dropped.
    }
    if (queue.length > 0) schedule();
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; void flush(); }, flushIntervalMs);
  }

  return {
    enabled: true,
    track(event, props) {
      try {
        if (!consent || suppressed) return;
        const properties = sanitizeProperties(event, props);
        if (!properties) return;
        if (queue.length >= maxQueue) queue.shift();
        queue.push({
          event,
          distinct_id: userId ?? sessionAnonId,
          properties: {
            ...properties,
            $lib: 'brandthread-mobile',
            $geoip_disable: true,
            ...(platform ? { platform } : {}),
            ...(userId ? {} : { $process_person_profile: false }),
          },
          timestamp: new Date().toISOString(),
        });
        if (queue.length >= batchSize) void flush();
        else schedule();
      } catch {
        // Analytics must never throw into UI code.
      }
    },
    identify(id) {
      userId = isSafeToken(id) ? id : null;
    },
    setConsent(granted) {
      consent = granted === true;
      if (!consent) queue = [];
    },
    setSuppressed(value) {
      suppressed = value === true;
      if (suppressed) queue = [];
    },
    setPlatform(value) {
      platform = isSafeToken(value) ? value : undefined;
    },
    flush,
  };
}
