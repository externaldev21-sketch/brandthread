import * as Sentry from "@sentry/node";

/**
 * Error reporting for the API (Sentry).
 *
 * Opt-in: with SENTRY_DSN unset (or a placeholder) nothing is initialised and
 * every function here is a no-op, so local development and tests behave
 * exactly as before.
 *
 * What gets reported:
 * - Uncaught exceptions and unhandled promise rejections (Sentry defaults).
 * - Every error-level log line that carries an `err` / `error` value, which
 *   covers the global API error handler, route-level catch blocks and the
 *   background jobs. Expected client errors (logged with status < 500) are
 *   skipped. See `reportLoggedError`, called from the logger's hook.
 *
 * Only the error itself plus a few non-personal tags (job, error code, status,
 * request id, method and path without query string) are sent. Request bodies,
 * headers, cookies and the other fields on the log line are not.
 */

const PINO_ERROR_LEVEL = 50;
const PLACEHOLDER_PATTERN = /^(REPLACE_WITH_|your[-_]|<|\$)/i;

let enabled = false;

export function resolveDsn(raw: string | undefined): string | null {
  const dsn = raw?.trim();
  if (!dsn || PLACEHOLDER_PATTERN.test(dsn)) return null;
  try {
    const url = new URL(dsn);
    if (!/^https?:$/.test(url.protocol) || !url.username || !url.pathname.replace(/\//g, "")) return null;
  } catch {
    return null;
  }
  return dsn;
}

export function initMonitoring(env: NodeJS.ProcessEnv = process.env): boolean {
  if (enabled) return true;
  const dsn = resolveDsn(env.SENTRY_DSN);
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: env.SENTRY_ENVIRONMENT?.trim() || env.NODE_ENV || "development",
    release: env.SENTRY_RELEASE?.trim() || undefined,
    sendDefaultPii: false,
    // Errors only. The server is bundled by esbuild, so OpenTelemetry
    // auto-instrumentation would not see Express anyway; skip its loader hooks.
    registerEsmLoaderHooks: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.data;
        delete event.request.query_string;
        if (event.request.url) event.request.url = event.request.url.split("?")[0];
      }
      return event;
    },
  });
  enabled = true;
  return true;
}

export function isMonitoringEnabled(): boolean {
  return enabled;
}

type LogObject = Record<string, unknown>;

function errorFrom(obj: LogObject): unknown {
  const candidate = obj.err ?? obj.error;
  return candidate instanceof Error ? candidate : null;
}

/** Pure: decides whether one pino call should become a Sentry event. */
export function shouldReportLog(level: number, firstArg: unknown): boolean {
  if (level < PINO_ERROR_LEVEL) return false;
  if (!firstArg || typeof firstArg !== "object") return false;
  const obj = firstArg as LogObject;
  if (!errorFrom(obj)) return false;
  const status = typeof obj.status === "number" ? obj.status : null;
  return status === null || status >= 500;
}

/** Pure: the non-personal tags attached to a reported log line. */
export function tagsFor(firstArg: LogObject, bindings: LogObject): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const key of ["job", "errorCode"]) {
    if (typeof firstArg[key] === "string") tags[key] = firstArg[key] as string;
  }
  if (typeof firstArg.status === "number") tags.status = String(firstArg.status);
  const req = bindings.req as LogObject | undefined;
  if (req && typeof req === "object") {
    if (req.id !== undefined) tags.request_id = String(req.id);
    if (typeof req.method === "string") tags.method = req.method;
    if (typeof req.url === "string") tags.path = req.url.split("?")[0];
  }
  return tags;
}

/**
 * Called by the logger for every log call. Never throws and never changes
 * what is logged.
 */
export function reportLoggedError(level: number, args: unknown[], bindings: LogObject): void {
  if (!enabled) return;
  try {
    const [firstArg, message] = args;
    if (!shouldReportLog(level, firstArg)) return;
    const obj = firstArg as LogObject;
    Sentry.withScope((scope) => {
      scope.setTags(tagsFor(obj, bindings));
      if (typeof message === "string") scope.setExtra("log_message", message);
      scope.setLevel(level >= 60 ? "fatal" : "error");
      Sentry.captureException(errorFrom(obj));
    });
  } catch {
    // Reporting must never break logging.
  }
}

/** Flushes queued events, e.g. before the process exits. */
export async function flushMonitoring(timeoutMs = 2000): Promise<void> {
  if (!enabled) return;
  await Sentry.flush(timeoutMs);
}
