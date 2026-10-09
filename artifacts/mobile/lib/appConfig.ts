/**
 * Client release config from the public GET /api/v1/app/config endpoint
 * (api-server/src/routes/app-config.ts): minimum supported native version per
 * platform, store URLs, release-flag overrides and critical OTA update ids.
 *
 * - Public: works signed out (plain fetch, no auth header).
 * - Throttled: one network request per MIN_REFRESH_MS unless forced; concurrent
 *   callers share one in-flight request.
 * - Fails open: a network error, timeout or malformed body resolves to `null`,
 *   and every consumer treats `null` as "nothing to enforce".
 *
 * Kept free of React Native imports so it can be unit-tested in Node.
 */

export type AppConfig = {
  minSupportedVersion: { ios: string | null; android: string | null };
  latestVersion: string | null;
  storeUrls: { ios: string | null; android: string | null };
  flags: Record<string, boolean>;
  criticalUpdateIds: string[];
};

export const APP_CONFIG_PATH = '/api/v1/app/config';
export const MIN_REFRESH_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 6000;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Validates an untrusted response body. Unknown/invalid fields become empty values. */
export function parseAppConfig(raw: unknown): AppConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const min = (body.minSupportedVersion && typeof body.minSupportedVersion === 'object' ? body.minSupportedVersion : {}) as Record<string, unknown>;
  const urls = (body.storeUrls && typeof body.storeUrls === 'object' ? body.storeUrls : {}) as Record<string, unknown>;
  const flags: Record<string, boolean> = {};
  if (body.flags && typeof body.flags === 'object' && !Array.isArray(body.flags)) {
    for (const [name, value] of Object.entries(body.flags as Record<string, unknown>)) {
      if (typeof value === 'boolean') flags[name] = value;
    }
  }
  const httpsOnly = (value: unknown) => {
    const url = str(value);
    return url && /^(https:|itms-apps:|market:)/i.test(url) ? url : null;
  };
  return {
    minSupportedVersion: { ios: str(min.ios), android: str(min.android) },
    latestVersion: str(body.latestVersion),
    storeUrls: { ios: httpsOnly(urls.ios), android: httpsOnly(urls.android) },
    flags,
    criticalUpdateIds: Array.isArray(body.criticalUpdateIds)
      ? body.criticalUpdateIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [],
  };
}

export type AppConfigLoaderOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  minRefreshMs?: number;
  timeoutMs?: number;
};

export type AppConfigLoader = {
  /** Latest result (null after a failure or before the first load). */
  peek(): AppConfig | null;
  /** Loads the config, reusing the last result inside the refresh window unless `force`. */
  load(options?: { force?: boolean }): Promise<AppConfig | null>;
  /** Called with every successfully loaded config. Returns an unsubscribe function. */
  subscribe(listener: (config: AppConfig) => void): () => void;
};

export function createAppConfigLoader(options: AppConfigLoaderOptions): AppConfigLoader {
  const now = options.now ?? Date.now;
  const minRefreshMs = options.minRefreshMs ?? MIN_REFRESH_MS;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const listeners = new Set<(config: AppConfig) => void>();
  let latest: AppConfig | null = null;
  let lastAttemptAt = -Infinity;
  let inFlight: Promise<AppConfig | null> | null = null;

  async function fetchOnce(): Promise<AppConfig | null> {
    const doFetch = options.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
    if (!doFetch || !options.baseUrl) return null;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await doFetch(`${options.baseUrl.replace(/\/+$/, '')}${APP_CONFIG_PATH}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller?.signal,
      });
      if (!response.ok) return null;
      return parseAppConfig(await response.json());
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    peek: () => latest,
    load({ force = false } = {}) {
      if (inFlight) return inFlight;
      if (!force && now() - lastAttemptAt < minRefreshMs) return Promise.resolve(latest);
      lastAttemptAt = now();
      inFlight = fetchOnce().then((config) => {
        latest = config;
        inFlight = null;
        if (config) {
          for (const listener of listeners) {
            try {
              listener(config);
            } catch {
              // A listener must never break loading.
            }
          }
        }
        return config;
      });
      return inFlight;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// Same base as lib/api.ts (not imported, to keep lib/api out of the startup graph).
const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL
  ?? (process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : '');

const sharedLoader = createAppConfigLoader({ baseUrl: API_BASE });

export const loadAppConfig = sharedLoader.load;
export const peekAppConfig = sharedLoader.peek;
export const subscribeAppConfig = sharedLoader.subscribe;
