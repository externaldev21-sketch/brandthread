import { getAuth } from "@clerk/express";
import type { RequestHandler } from "express";

type RateLimitPolicy = {
  id: string;
  limit: number;
  windowMs: number;
  message: string;
};

type Counter = {
  count: number;
  resetAt: number;
};

const counters = new Map<string, Counter>();
let lastSweepAt = 0;

const POLICIES = {
  authentication: {
    id: "authentication",
    limit: 30,
    windowMs: 10 * 60_000,
    message: "Too many sign-in requests. Please wait before trying again.",
  },
  expensive: {
    id: "expensive",
    limit: 30,
    windowMs: 60_000,
    message: "Too many generation requests. Please wait a minute and try again.",
  },
  mutation: {
    id: "mutation",
    limit: 120,
    windowMs: 60_000,
    message: "Too many changes were submitted. Please wait a moment and try again.",
  },
  read: {
    id: "read",
    limit: 600,
    windowMs: 5 * 60_000,
    message: "Too many requests. Please wait a moment and try again.",
  },
  anonymousRead: {
    id: "anonymous-read",
    limit: 240,
    windowMs: 5 * 60_000,
    message: "Too many requests. Please wait a moment and try again.",
  },
} satisfies Record<string, RateLimitPolicy>;

const EXPENSIVE_PATH =
  /\/(ai|logo|mockup|photography|lifestyle|techpack|bg-removal|store\/ai)(\/|$)/;
const AUTH_PATH = /\/auth\/(sync|username\/check|profile)(\/|$)/;

function policyFor(method: string, path: string, authenticated: boolean): RateLimitPolicy {
  if (AUTH_PATH.test(path)) return POLICIES.authentication;
  if (EXPENSIVE_PATH.test(path)) return POLICIES.expensive;
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) return POLICIES.mutation;
  return authenticated ? POLICIES.read : POLICIES.anonymousRead;
}

function identityFor(req: Parameters<RequestHandler>[0]): string {
  const userId = getAuth(req).userId;
  if (userId) return `user:${userId}`;
  return `ip:${req.ip || req.socket.remoteAddress || "unknown"}`;
}

function sweepExpired(now: number): void {
  if (now - lastSweepAt < 60_000) return;
  lastSweepAt = now;
  for (const [key, counter] of counters) {
    if (counter.resetAt <= now) counters.delete(key);
  }
}

export const appRateLimiter: RequestHandler = (req, res, next) => {
  if (
    req.method === "OPTIONS" ||
    req.path.endsWith("/health") ||
    req.path.endsWith("/healthz") ||
    req.path.includes("/webhooks/")
  ) {
    next();
    return;
  }

  const now = Date.now();
  sweepExpired(now);
  const identity = identityFor(req);
  const authenticated = identity.startsWith("user:");
  const policy = policyFor(req.method, req.path, authenticated);
  const key = `${policy.id}:${identity}`;
  const current = counters.get(key);
  const counter =
    !current || current.resetAt <= now
      ? { count: 1, resetAt: now + policy.windowMs }
      : { count: current.count + 1, resetAt: current.resetAt };
  counters.set(key, counter);

  const remaining = Math.max(0, policy.limit - counter.count);
  const retryAfterSeconds = Math.max(1, Math.ceil((counter.resetAt - now) / 1000));
  res.setHeader("RateLimit-Limit", String(policy.limit));
  res.setHeader("RateLimit-Remaining", String(remaining));
  res.setHeader("RateLimit-Reset", String(Math.ceil(counter.resetAt / 1000)));

  if (counter.count > policy.limit) {
    res.setHeader("Retry-After", String(retryAfterSeconds));
    res.status(429).json({
      code: "RATE_LIMITED",
      message: policy.message,
      retryAfterSeconds,
    });
    return;
  }
  next();
};

export function resetRateLimitStateForTests(): void {
  counters.clear();
  lastSweepAt = 0;
}