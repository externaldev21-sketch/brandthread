/**
 * Pure configuration for crash and error reporting (Sentry).
 *
 * Kept free of React Native imports so it can be unit-tested in Node. The
 * runtime wiring lives in `lib/monitoring.ts`.
 *
 * Reporting is strictly opt-in: with no DSN (or a leftover placeholder) the
 * SDK is never initialised and every report call is a no-op, so local
 * development, previews and forks run exactly as before.
 */

export type MonitoringEnv = {
  /** Public DSN. Safe to ship in the app bundle; it only allows sending events. */
  dsn?: string;
  /** Overrides the environment tag (defaults to the update channel or dev/production). */
  environment?: string;
  /** Fraction of sessions that record performance traces, 0–1. */
  tracesSampleRate?: string;
};

export type BreadcrumbLike = {
  category?: string;
  type?: string;
  data?: Record<string, unknown>;
  message?: string;
};

const PLACEHOLDER_PATTERN = /^(REPLACE_WITH_|your[-_]|<|\$)/i;
const DEFAULT_TRACES_SAMPLE_RATE = 0.1;

/** Returns the DSN when it looks usable, otherwise null (reporting stays off). */
export function resolveDsn(raw: string | undefined): string | null {
  const dsn = raw?.trim();
  if (!dsn || PLACEHOLDER_PATTERN.test(dsn)) return null;
  try {
    const url = new URL(dsn);
    if (!/^https?:$/.test(url.protocol) || !url.username || !url.pathname.replace(/\//g, '')) return null;
  } catch {
    return null;
  }
  return dsn;
}

export function resolveTracesSampleRate(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_TRACES_SAMPLE_RATE;
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_TRACES_SAMPLE_RATE;
  return Math.min(1, Math.max(0, value));
}

export function resolveEnvironment(
  explicit: string | undefined,
  updateChannel: string | null | undefined,
  isDev: boolean,
): string {
  if (explicit?.trim()) return explicit.trim();
  if (isDev) return 'development';
  if (updateChannel?.trim()) return updateChannel.trim();
  return 'production';
}

/** Removes query strings and fragments, which can carry tokens or search terms. */
export function stripUrlQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/**
 * Filters breadcrumbs before they are attached to a crash report.
 * Console output is dropped outside development (it can contain user data),
 * and request/navigation URLs lose their query strings.
 */
export function scrubBreadcrumb<T extends BreadcrumbLike>(breadcrumb: T, isDev: boolean): T | null {
  if (!isDev && breadcrumb.category === 'console') return null;
  if (!breadcrumb.data) return breadcrumb;
  const data = { ...breadcrumb.data };
  for (const key of ['url', 'from', 'to']) {
    if (typeof data[key] === 'string') data[key] = stripUrlQuery(data[key] as string);
  }
  return { ...breadcrumb, data };
}
