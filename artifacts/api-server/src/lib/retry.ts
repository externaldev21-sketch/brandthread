/**
 * Small shared retry-with-backoff helper for outbound calls to external
 * services (shipping rates, marketing platform reads, push delivery, etc).
 *
 * Only wrap calls that are safe to run more than once: idempotent reads, or
 * writes that are already idempotent on the provider side (e.g. carry a
 * provider idempotency key, or a request id the provider dedupes on). Do NOT
 * wrap non-idempotent, money-moving calls (a Stripe charge/transfer/refund
 * without an idempotency key) — a retried write can double-charge or
 * double-refund a real person. When unsure, don't wrap it.
 */
import { logger } from "./logger";

export interface RetryOptions {
  /** Total attempts, including the first (non-retry) call. Default 3. */
  attempts?: number;
  /** Base delay in ms before the first retry. Default 250ms. */
  baseDelayMs?: number;
  /** Delay multiplier per subsequent retry. Default 2 (exponential). */
  factor?: number;
  /** Upper bound on any single delay, before jitter. Default 5s. */
  maxDelayMs?: number;
  /**
   * Decides whether a given error should be retried. Defaults to retrying
   * everything except errors that look like a 4xx client error (those won't
   * succeed on retry). Override for provider-specific semantics.
   */
  isRetryable?: (err: unknown) => boolean;
  /** Label used in log lines when a retry happens, e.g. "shippo.getRate". */
  label?: string;
}

function statusOf(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const value = (err as { status?: unknown; statusCode?: unknown }).status
    ?? (err as { statusCode?: unknown }).statusCode;
  return typeof value === "number" ? value : undefined;
}

/**
 * Default retry predicate: retry network-level failures (no status code, e.g.
 * fetch throwing on a connection reset/timeout) and 429/5xx responses. Never
 * retry a plain 4xx — the request itself was rejected and resending it
 * unchanged will just fail the same way.
 */
export function defaultIsRetryable(err: unknown): boolean {
  const status = statusOf(err);
  if (status === undefined) return true;
  if (status === 429) return true;
  return status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn`, retrying with exponential backoff and full jitter on failure.
 * Rethrows the last error once attempts are exhausted.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 250;
  const factor = options.factor ?? 2;
  const maxDelayMs = options.maxDelayMs ?? 5_000;
  const isRetryable = options.isRetryable ?? defaultIsRetryable;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const isLastAttempt = attempt === attempts;
      if (isLastAttempt || !isRetryable(err)) throw err;

      const rawDelay = Math.min(maxDelayMs, baseDelayMs * factor ** (attempt - 1));
      const delayMs = Math.floor(rawDelay / 2 + Math.random() * (rawDelay / 2));
      logger.warn(
        {
          err,
          label: options.label,
          attempt,
          attempts,
          delayMs,
        },
        "Retrying external call after failure",
      );
      await sleep(delayMs);
    }
  }
  // Unreachable — the loop always returns or throws — but keeps TS satisfied.
  throw lastErr;
}
