import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { consumeRateLimitRedis } from "../lib/rateLimitStore";
import type { Request, RequestHandler } from "express";
import { UPLOAD_SESSION_MAX_CHUNKS } from "../lib/uploadSessions";

export type RateLimitPolicyName =
  | "authentication"
  | "asset-upload"
  | "upload"
  | "upload-chunk"
  | "checkout"
  | "webhook"
  | "expensive"
  | "mutation"
  | "authenticated-read"
  | "public-read"
  | "messaging"
  | "community-create"
  | "agent-chat"
  | "comment"
  | "follow"
  | "report"
  | "feed-event"
  | "email-subscribe"
  | "post-interact"
  | "gift-card-lookup"
  | "access-code"
  | "access-waitlist"
  | "contact-match";

export type RateLimitPolicy = {
  id: RateLimitPolicyName;
  limit: number;
  windowMs: number;
  message: string;
  /**
   * Extra ceiling shared by every signed-in account behind one IP address.
   * The per-user bucket stops one account from hammering an endpoint; this one
   * stops a single machine from rotating through many accounts (sign-up
   * sweeps, credential stuffing, scripted AI spend). Unsigned requests are
   * already keyed by IP, so it only applies to signed-in traffic.
   */
  ipLimit?: number;
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
    ipLimit: scaled(120),
    message: "Too many authentication requests. Please wait before trying again.",
  },
  "asset-upload": {
    id: "asset-upload",
    limit: scaled(6),
    windowMs: 60_000,
    ipLimit: scaled(30),
    message: "Too many asset uploads. Please wait a minute and try again.",
  },
  upload: {
    id: "upload",
    // Photos, videos and attachments sent to any route. A person posting a
    // carousel sends a handful in a burst, so this is generous per account but
    // still far below what a script uploading to fill storage would send.
    limit: scaled(30),
    windowMs: 60_000,
    ipLimit: scaled(150),
    message: "Too many uploads. Please wait a minute and try again.",
  },
  "upload-chunk": {
    id: "upload-chunk",
    // Chunk PUTs of resumable upload sessions (lib/uploadSessions.ts) have
    // their own bucket so one large video does not exhaust "upload". Sized
    // for three max-size (1 GB / 8 MB = 128 chunk) sessions, retries included,
    // per 10 minutes; open sessions per person are capped separately.
    limit: scaled(UPLOAD_SESSION_MAX_CHUNKS * 3),
    windowMs: 10 * 60_000,
    ipLimit: scaled(UPLOAD_SESSION_MAX_CHUNKS * 12),
    message: "Too many upload parts. Please wait a few minutes and try again.",
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
    ipLimit: scaled(150),
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
    ipLimit: scaled(150),
    message: "Too many messages sent. Please wait a moment and try again.",
  },
  "community-create": {
    id: "community-create",
    // Per-account abuse limit on creating groups (a hard cap on owned groups
    // also applies in routes/communities.ts).
    limit: 5,
    windowMs: 24 * 60 * 60_000,
    message: "You've created a lot of groups today. Please try again tomorrow.",
  },
  "agent-chat": {
    id: "agent-chat",
    limit: scaled(20),
    windowMs: 60_000,
    ipLimit: scaled(100),
    message: "You're chatting with the Brandthread Agent a lot — give it a minute and try again.",
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
  "access-code": {
    id: "access-code",
    // Guessing guard for invite-code validate/redeem. Deliberately low and
    // NOT scaled for dev: a code is the only thing between a stranger and an
    // invite-only launch.
    limit: 10,
    windowMs: 15 * 60_000,
    ipLimit: 30,
    message: "Too many attempts. Please wait a few minutes and try again.",
  },
  "access-waitlist": {
    id: "access-waitlist",
    limit: 5,
    windowMs: 60 * 60_000,
    message: "Too many requests. Please try again later.",
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
  "email-subscribe": {
    id: "email-subscribe",
    // Public, unauthenticated store signup form: per-IP cap. A tighter
    // per-IP+email bucket is applied inside the route.
    limit: 20,
    windowMs: 10 * 60_000,
    message: "Too many signups from this connection. Please try again later.",
  },
  "post-interact": {
    id: "post-interact",
    // Likes/views/watch-time pings from a fast-scrolling feed; generous for
    // real use, but bounds scripted like/unlike toggling.
    limit: scaled(240),
    windowMs: 60_000,
    message: "You're doing that too fast. Please wait a moment and try again.",
  },
  // Brute-force guard for gift card codes: every code lookup, claim and
  // checkout redemption by code counts (lib/giftCards/checkout.ts).
  "gift-card-lookup": {
    id: "gift-card-lookup",
    limit: 15,
    windowMs: 15 * 60_000,
    message: "Too many gift card code attempts. Please wait a few minutes and try again.",
  },
  "contact-match": {
    id: "contact-match",
    // Contact matching is an enumeration surface (up to 2000 hashes per call),
    // so it is capped per account well below normal read traffic.
    limit: 10,
    windowMs: 60 * 60_000,
    message: "You've checked contacts a lot. Please try again later.",
  },
};

const EXPENSIVE_PATH =
  /\/(ai|logo|mockup|photography|lifestyle|techpack|bg-removal|store\/ai|support-chat\/message)(\/|$)/;
// Binary uploads are recognised by what they carry, not only by route name, so
// a new upload endpoint is covered the day it ships.
const UPLOAD_PATH = /\/(?:upload|upload-media|upload-photo|images\/upload|avatar\/upload|logo\/upload|banner\/upload|media)(?:\/|$)/;
const UPLOAD_CONTENT_TYPE = /^(?:image|video|audio)\/|^application\/(?:pdf|octet-stream)\b/i;
// Resumable sessions: chunk PUTs use "upload-chunk"; creating a session and
// handing a finished one to its route (X-Upload-Id) count as one "upload".
const UPLOAD_CHUNK_PATH = /\/(?:upload-sessions|posts\/uploads)\/[^/]+\/chunks\/[^/]+$/;
const UPLOAD_SESSION_CREATE_PATH = /\/(?:upload-sessions|posts\/uploads)\/?$/;
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

/** Bucket shared by all signed-in accounts on one IP for `policy.ipLimit`. */
export function ipCeilingKey(req: Request, policy: RateLimitPolicy): string {
  const ip = normalizeClientIp(req.ip || req.socket.remoteAddress);
  return `${policy.id}:ipcap:ip:${ip}`;
}

export function rateLimitPolicyFor(
  method: string,
  path: string,
  authenticated: boolean,
  contentType?: string,
  uploadHandoff = false,
): RateLimitPolicy | null {
  if (WEBHOOK_PATH.test(path)) return RATE_LIMIT_POLICIES.webhook;
  if (AUTH_PATH.test(path)) return RATE_LIMIT_POLICIES.authentication;
  if (CHECKOUT_PATH.test(path)) return RATE_LIMIT_POLICIES.checkout;
  if (EXPENSIVE_PATH.test(path)) return RATE_LIMIT_POLICIES.expensive;
  if (method === "PUT" && UPLOAD_CHUNK_PATH.test(path)) return RATE_LIMIT_POLICIES["upload-chunk"];
  if (
    (method === "POST" || method === "PUT") &&
    (uploadHandoff || (method === "POST" && UPLOAD_SESSION_CREATE_PATH.test(path)) ||
      UPLOAD_PATH.test(path) || (contentType && UPLOAD_CONTENT_TYPE.test(contentType)))
  ) {
    return RATE_LIMIT_POLICIES.upload;
  }
  if (MUTATION_METHODS.has(method)) return RATE_LIMIT_POLICIES.mutation;
  if (authenticated && (method === "GET" || method === "HEAD")) {
    return RATE_LIMIT_POLICIES["authenticated-read"];
  }
  if (!authenticated && (method === "GET" || method === "HEAD")) {
    return RATE_LIMIT_POLICIES["public-read"];
  }
  return null;
}

// Expired buckets used to be deleted inside every request's statement, i.e. a
// table-range DELETE on the hot path of every API call. They are only garbage,
// so it is enough for each instance to sweep them once a minute, off-path.
const BUCKET_SWEEP_EVERY_MS = 60_000;
let lastBucketSweepAt = 0;

function sweepExpiredBuckets(): void {
  const now = Date.now();
  if (now - lastBucketSweepAt < BUCKET_SWEEP_EVERY_MS) return;
  lastBucketSweepAt = now;
  void db
    .execute(sql`DELETE FROM rate_limit_buckets WHERE expires_at < now() - interval '1 hour'`)
    .catch(() => { lastBucketSweepAt = 0; });
}

export async function consumeRateLimitBucket(
  bucketKey: string,
  policy: RateLimitPolicy,
): Promise<{ count: number; resetAt: Date }> {
  sweepExpiredBuckets();
  const result = await db.execute(sql`
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
      : rateLimitPolicyFor(req.method, req.path, Boolean(userId), req.headers["content-type"], Boolean(req.headers["x-upload-id"]));
    if (!policy) {
      next();
      return;
    }

    const identity = rateLimitIdentity(req, policy);
    const key = `${policy.id}:${identity}`;
    try {
      const counter = (await consumeRateLimitRedis(key, policy.windowMs)) ?? (await consumeRateLimitBucket(key, policy));
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
      if (userId && policy.ipLimit) {
        const ipCounter = await consumeRateLimitBucket(ipCeilingKey(req, policy), {
          ...policy,
          limit: policy.ipLimit,
        });
        if (ipCounter.count > policy.ipLimit) {
          const ipRetry = Math.max(
            1,
            Math.ceil((ipCounter.resetAt.getTime() - Date.now()) / 1000),
          );
          res.setHeader("Retry-After", String(ipRetry));
          res.status(429).json({
            error: "Rate limit exceeded",
            code: "RATE_LIMITED",
            message: policy.message,
            retryAfterSeconds: ipRetry,
          });
          return;
        }
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