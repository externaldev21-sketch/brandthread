import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: authState.userId }),
}));

import {
  appRateLimiter,
  consumeRateLimitBucket,
  normalizeClientIp,
  RATE_LIMIT_POLICIES,
  rateLimitIdentity,
  rateLimitPolicyFor,
} from "./rateLimit";

// Rate limit buckets are persisted in the shared Postgres database, not an
// in-process Map, so any two test runs (different files in parallel vitest
// workers, or the same file re-run) that pick the same client identity
// contend for the same bucket row. A small hand-rolled random range (e.g.
// "198.51.100.<1-200>") collides often enough under parallel test execution
// to make assertions like "the first request is under the limit" flaky.
// crypto.randomUUID() has a collision probability low enough to treat as
// zero for a test run, and normalizeClientIp does no format validation, so
// a UUID-based synthetic address works as a client identity here.
function uniqueClientAddress(): string {
  return `test-${crypto.randomUUID()}`;
}

async function withServer(app: ReturnType<typeof express>, run: (baseUrl: string) => Promise<void>) {
  const server: Server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe("appRateLimiter", () => {
  it("adds standard rate-limit headers", async () => {
    const app = express();
    app.set("trust proxy", 1);
    app.use(appRateLimiter);
    app.get("/api/v1/public/products", (_req, res) => res.json({ ok: true }));

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/public/products`, {
        headers: { "x-forwarded-for": uniqueClientAddress() },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("ratelimit-limit")).toBe("240");
      expect(response.headers.get("ratelimit-remaining")).toBe("239");
    });
  });

  it("selects stricter named policies without double-consuming mutations", () => {
    expect(rateLimitPolicyFor("POST", "/api/v1/auth/sync", false)?.id).toBe("authentication");
    expect(rateLimitPolicyFor("POST", "/api/v1/guest/checkout/session", false)?.id).toBe("checkout");
    expect(rateLimitPolicyFor("POST", "/api/v1/webhooks/stripe", false)?.id).toBe("webhook");
    expect(rateLimitPolicyFor("POST", "/api/v1/products", true)?.id).toBe("mutation");
    expect(rateLimitPolicyFor("GET", "/api/v1/products", true)?.id).toBe("authenticated-read");
    expect(rateLimitPolicyFor("GET", "/api/config/features", false)?.id).toBe("public-read");
  });

  it("normalizes IP identities and prefers authenticated users", () => {
    expect(normalizeClientIp("::ffff:192.0.2.5")).toBe("192.0.2.5");
    const req = {
      clerkUserId: "user_123",
      ip: "192.0.2.10",
      socket: {},
      header: () => undefined,
    } as any;
    expect(rateLimitIdentity(req, {
      id: "mutation", limit: 1, windowMs: 1_000, message: "limited",
    })).toBe("user:user_123");
  });

  it("does not let changing webhook signatures bypass the source-IP bucket", () => {
    const requestForSignature = (signature: string) => ({
      ip: "192.0.2.20",
      socket: {},
      header: (name: string) => name === "stripe-signature" ? signature : undefined,
    }) as any;
    expect(rateLimitIdentity(
      requestForSignature("t=1,v1=first"),
      RATE_LIMIT_POLICIES.webhook,
    )).toBe(rateLimitIdentity(
      requestForSignature("t=2,v1=second"),
      RATE_LIMIT_POLICIES.webhook,
    ));
  });

  it("persists exhaustion across independent consumers", async () => {
    const policy = {
      id: "mutation" as const,
      limit: 2,
      windowMs: 60_000,
      message: "limited",
    };
    const key = `mutation:test:${crypto.randomUUID()}`;
    expect((await consumeRateLimitBucket(key, policy)).count).toBe(1);
    expect((await consumeRateLimitBucket(key, policy)).count).toBe(2);
    expect((await consumeRateLimitBucket(key, policy)).count).toBe(3);
  });

  it("limits authenticated reads across independent app instances", async () => {
    const policy = RATE_LIMIT_POLICIES["authenticated-read"];
    const originalLimit = policy.limit;
    authState.userId = `read-test-${crypto.randomUUID()}`;
    policy.limit = 2;
    const createApp = () => {
      const app = express();
      app.use(appRateLimiter);
      app.get("/api/v1/orders", (_req, res) => res.json({ ok: true }));
      return app;
    };
    try {
      await withServer(createApp(), async (baseUrl) => {
        expect((await fetch(`${baseUrl}/api/v1/orders`)).status).toBe(200);
        expect((await fetch(`${baseUrl}/api/v1/orders`)).status).toBe(200);
      });
      await withServer(createApp(), async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/v1/orders`);
        expect(response.status).toBe(429);
        expect(response.headers.get("retry-after")).not.toBeNull();
      });
    } finally {
      policy.limit = originalLimit;
      authState.userId = null;
    }
  });

  it("limits non-public unauthenticated reads across independent app instances", async () => {
    const policy = RATE_LIMIT_POLICIES["public-read"];
    const originalLimit = policy.limit;
    policy.limit = 2;
    const createApp = () => {
      const app = express();
      app.set("trust proxy", 1);
      app.use(appRateLimiter);
      app.get("/api/config/features", (_req, res) => res.json({ ok: true }));
      return app;
    };
    const headers = { "x-forwarded-for": uniqueClientAddress() };
    try {
      await withServer(createApp(), async (baseUrl) => {
        const first = await fetch(`${baseUrl}/api/config/features`, { headers });
        expect(first.status).toBe(200);
        expect(first.headers.get("ratelimit-limit")).toBe("2");
        expect((await fetch(`${baseUrl}/api/config/features`, { headers })).status).toBe(200);
      });
      await withServer(createApp(), async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/config/features`, { headers });
        expect(response.status).toBe(429);
        expect(response.headers.get("retry-after")).not.toBeNull();
      });
    } finally {
      policy.limit = originalLimit;
    }
  });

  it("does not rate limit health checks", async () => {
    const app = express();
    app.use(appRateLimiter);
    app.get("/api/v1/healthz", (_req, res) => res.json({ ok: true }));

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/healthz`);
      expect(response.status).toBe(200);
      expect(response.headers.get("ratelimit-limit")).toBeNull();
    });
  });
});