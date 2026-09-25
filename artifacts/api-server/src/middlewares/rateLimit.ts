import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { Request, RequestHandler } from "express";

export type RateLimitPolicyName =
  | "authentication"
  | "asset-upload"
  | "checkout"
  | "webhook"
  | "expensive"
  | "mutation"
  | "authenticated-read"
  | "public-read"
  | "messaging"
  | "comment"
  | "follow"
  | "report"
  | "feed-event";

export type RateLimitPolicy = {
  id: RateLimitPolicyName;
  limit: number;
  windowMs: number;
  message: string;
};

// Dev/preview traffic (Replit web preview, local `pnpm dev`) reloads far more
// often than a real client: React StrictMode double-invokes effects, HMR
// remounts screens, and the dev preview bypass (?bt_preview=…) skips Clerk
// auth entirely so every request from one browser tab is bucketed under a
// single unauthenticated IP identity instead of a per-user one. That was
// tripping the "public-read" policy (240 / 5 min) within a minute of normal
// clicking around and flooding the client with 429s. Scale limits up for
// `NODE_ENV=development` only — production and the `test` env (which asserts
// exact policy numbers) are untouched.
const RATE_LIMIT_DEV_MULTIPLIER =
  process.env.NODE_ENV === "development"
    ? Math.max(1, Number(process.env.RATE_LIMIT_DEV_MULTIPLIER) || 12)
    : 1;

function scaled(limit: number): number {
  return limit * RATE_LIMIT_DEV_MULTIPLIER;
}

export const RATE_LIMIT_POLICIES: Record<RateLimitPolicyName, RateLimitPolicy> = {
  authentication: {
    id: "authentication",
    limit: scaled(30),
    windowMs: 10 * 60_000,
    message: "Too many authentication requests. Please wait before trying again.",
  },
  "asset-upload": {
    id: "asset-upload",
    limit: scaled(6),
    windowMs: 60_000,
    message: "Too many asset uploads. Please wait a minute and try again.",
  },
  checkout: {
    id: "checkout",
    limit: scaled(20),
    windowMs: 5 * 60_000,
    message: "Too many checkout requests. Please wait before trying again.",
  },
  webhook: {
    id: "webhook",
    limit: scaled(300),
    windowMs: 60_000,
    message: "Too many webhook deliveries. Please retry shortly.",
  },
  expensive: {
    id: "expensive",
    limit: scaled(30),
    windowMs: 60_000,
    message: "Too many generation requests. Please wait a minute and try again.",
  },
  mutation: {
    id: "mutation",
    limit: scaled(120),
    windowMs: 60_000,
    message: "Too many changes were submitted. Please wait a moment and try again.",
  },
  "authenticated-read": {
    id: "authenticated-read",
    limit: scaled(600),
    windowMs: 5 * 60_000,
    message: "Too many requests. Please wait a moment and try again.",
  },
  "public-read": {
    id: "public-read",
    limit: scaled(240),
    windowMs: 5 * 60_000,
    message: "Too many requests. Please wait a moment and try again.",
  },
  messaging: {
    id: "messaging",
    limit: scaled(30),
    windowMs: 60_000,
    message: "Too many messages sent. Please wait a moment and try again.",
  },
  comment: {
    id: "comment",
    limit: scaled(20),
    windowMs: 60_000,
    message: "Too many comments. Please wait a moment and try again.",
  },
  follow: {
    id: "follow",
    limit: scaled(30),
    windowMs: 60_000,
    message: "Too many follow requests. Please wait a moment and try again.",
  },
  report: {
    id: "report",
    limit: scaled(10),
    windowMs: 5 * 60_000,
    message: "Too many reports submitted. Please wait before submitting another.",
  },
  "feed-event": {
    id: "feed-event",
    // Batched (up to 50 events/request) so this is generous per-request but
    // still bounds a client that retries aggressively or fires unbatched.
    limit: 120,
    windowMs: 60_000,
    message: "Too many feed events submitted. Please wait a moment and try again.",
  },
};

const EXPENSIVE_PATH =
  /\/(ai|logo|mockup|photography|lifestyle|techpack|bg-removal|store\/ai)(\/|$)/;
const AUTH_PATH = /\/auth(?:\/|$)/;
const CHECKOUT_PATH = /\/(?:guest\/checkout|buyer\/checkout|checkout)(?:\/|$)/;
const WEBHOOK_PATH = /\/webhooks(?:\/|$)/;
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function normalizeClientIp(value: string | undefined): string {
  const first = (value ?? "unknown").split(",")[0]?.trim().toLowerCase() || "unknown";
  return first.startsWith("::ffff:") ? first.slice(7) : first;
}

function authenticatedUserId(req: Request): string | null {
  const scopedOwner = (req as Request & { clerkUserId?: string }).clerkUserId;
  if (scopedOwner) return scopedOwner;
  try {
    return getAuth(req).userId ?? null;
  } catch {
    return null;
  }
}

export function rateLimitIdentity(req: Request, policy: RateLimitPolicy): string {
  const userId = authenticatedUserId(req);
  if (userId) return `user:${userId}`;

  const ip = normalizeClientIp(req.ip || req.socket.remoteAddress);
  if (policy.id === "webhook") {
    return `webhook:ip:${ip}`;
  }
  return `ip:${ip}`;
}

export function rateLimitPolicyFor(
  method: string,
  path: string,
  authenticated: boolean,
): RateLimitPolicy | null {
  if (WEBHOOK_PATH.test(path)) return RATE_LIMIT_POLICIES.webhook;
  if (AUTH_PATH.test(path)) return RATE_LIMIT_POLICIES.authentication;
  if (CHECKOUT_PATH.test(path)) return RATE_LIMIT_POLICIES.checkout;
  if (EXPENSIVE_PATH.test(path)) return RATE_LIMIT_POLICIES.expensive;
  if (MUTATION_METHODS.has(method)) return RATE_LIMIT_POLICIES.mutation;
  if (authenticated && (method === "GET" || method === "HEAD")) {
    return RATE_LIMIT_POLICIES["authenticated-read"];
  }
  if (!authenticated && (method === "GET" || method === "HEAD")) {
    return RATE_LIMIT_POLICIES["public-read"];
  }
  return null;
}

export async function consumeRateLimitBucket(
  bucketKey: string,
  policy: RateLimitPolicy,
): Promise<{ count: number; resetAt: Date }> {
  const result = await db.execute(sql`
    WITH expired_cleanup AS (
      DELETE FROM rate_limit_buckets
      WHERE expires_at < now() - interval '1 hour'
    )
    INSERT INTO rate_limit_buckets (
      bucket_key, request_count, window_started_at, expires_at
    )
    VALUES (
      ${bucketKey}, 1, now(), now() + (${policy.windowMs} * interval '1 millisecond')
    )
    ON CONFLICT (bucket_key) DO UPDATE SET
      request_count = CASE
        WHEN rate_limit_buckets.expires_at <= now() THEN 1
        ELSE rate_limit_buckets.request_count + 1
      END,
      window_started_at = CASE
        WHEN rate_limit_buckets.expires_at <= now() THEN now()
        ELSE rate_limit_buckets.window_started_at
      END,
      expires_at = CASE
        WHEN rate_limit_buckets.expires_at <= now()
          THEN now() + (${policy.windowMs} * interval '1 millisecond')
        ELSE rate_limit_buckets.expires_at
      END
    RETURNING request_count, expires_at
  `);
  const row = result.rows[0] as { request_count: number | string; expires_at: Date | string } | undefined;
  if (!row) throw new Error("Rate limit bucket did not return a result");
  return {
    count: Number(row.request_count),
    resetAt: row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at),
  };
}

function middlewareForPolicy(explicitPolicy?: RateLimitPolicyName): RequestHandler {
  return async (req, res, next) => {
    if ((req as Request & { rateLimitApplied?: boolean }).rateLimitApplied) {
      next();
      return;
    }
    if (
      req.method === "OPTIONS" ||
      req.path.endsWith("/health") ||
      /\/healthz(\/|$)/.test(req.path)
    ) {
      next();
      return;
    }

    const userId = authenticatedUserId(req);
    const policy = explicitPolicy
      ? RATE_LIMIT_POLICIES[explicitPolicy]
      : rateLimitPolicyFor(req.method, req.path, Boolean(userId));
    if (!policy) {
      next();
      return;
    }

    const identity = rateLimitIdentity(req, policy);
    const key = `${policy.id}:${identity}`;
    try {
      const counter = await consumeRateLimitBucket(key, policy);
      const remaining = Math.max(0, policy.limit - counter.count);
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((counter.resetAt.getTime() - Date.now()) / 1000),
      );
      res.setHeader("RateLimit-Limit", String(policy.limit));
      res.setHeader("RateLimit-Remaining", String(remaining));
      res.setHeader("RateLimit-Reset", String(Math.ceil(counter.resetAt.getTime() / 1000)));

      if (counter.count > policy.limit) {
        res.setHeader("Retry-After", String(retryAfterSeconds));
        res.status(429).json({
          error: "Rate limit exceeded",
          code: "RATE_LIMITED",
          message: policy.message,
          retryAfterSeconds,
        });
        return;
      }
      if (explicitPolicy) {
        (req as Request & { rateLimitApplied?: boolean }).rateLimitApplied = true;
      }
      next();
    } catch (err) {
      req.log?.error({ err, policy: policy.id }, "Persistent rate limit check failed");
      res.status(503).json({
        error: "Request rate could not be verified",
        code: "RATE_LIMIT_UNAVAILABLE",
        message: "Please try again shortly.",
      });
    }
  };
}

export const appRateLimiter = middlewareForPolicy();

/** Route-level override for stricter policies. Do not combine with appRateLimiter. */
export function rateLimit(policy: RateLimitPolicyName): RequestHandler {
  return middlewareForPolicy(policy);
}

export function resetRateLimitStateForTests(): void {
  // Intentionally no process-local state. Test suites should use unique identities.
}