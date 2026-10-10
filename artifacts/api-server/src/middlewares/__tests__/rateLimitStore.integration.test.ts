/**
 * BT-474: the app-wide limiter no longer writes Postgres per request.
 * Real Express + real test Postgres, RATE_LIMIT_STORE=memory (production's
 * default when REDIS_URL is unset).
 */
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const state = vi.hoisted(() => ({ userId: null as string | null, storeThrows: false }));
vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: state.userId }) }));
vi.mock("../../lib/rateLimitStore", () => ({
  // No Redis in this test. `storeThrows` simulates the counting store failing.
  consumeRateLimitRedis: async () => {
    if (state.storeThrows) throw new Error("store unavailable");
    return null;
  },
}));

import { appRateLimiter, RATE_LIMIT_POLICIES, rateLimitStoreMode } from "../rateLimit";
import { __resetMemoryRateLimitStoreForTests, getMemoryRateLimitStore } from "../../lib/rateLimitMemory";

const ip = () => `test-store-${crypto.randomUUID()}`;
const usedIps: string[] = [];

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(appRateLimiter);
  app.all("/{*any}", (_req, res) => res.json({ ok: true }));
  const server: Server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

async function rowsFor(addr: string) {
  const r = await db.execute(sql`SELECT bucket_key, request_count FROM rate_limit_buckets WHERE bucket_key LIKE ${`%${addr}`}`);
  return r.rows as Array<{ bucket_key: string; request_count: number }>;
}

beforeAll(() => { process.env.RATE_LIMIT_STORE = "memory"; });
afterEach(() => { state.storeThrows = false; state.userId = null; });
afterAll(async () => {
  delete process.env.RATE_LIMIT_STORE;
  __resetMemoryRateLimitStoreForTests();
  for (const a of usedIps) await db.execute(sql`DELETE FROM rate_limit_buckets WHERE bucket_key LIKE ${`%${a}`}`);
});

describe("store selection", () => {
  it("defaults to memory outside tests and can be forced back to Postgres", () => {
    expect(rateLimitStoreMode({ NODE_ENV: "production" })).toBe("memory");
    expect(rateLimitStoreMode({ NODE_ENV: "test" })).toBe("postgres");
    expect(rateLimitStoreMode({ NODE_ENV: "production", RATE_LIMIT_STORE: "postgres" })).toBe("postgres");
  });
});

describe("appRateLimiter with the memory store", () => {
  it("keeps the same headers and writes nothing to Postgres for ordinary reads", async () => {
    const addr = ip();
    usedIps.push(addr);
    await withServer(async (base) => {
      for (let i = 1; i <= 3; i++) {
        const res = await fetch(`${base}/api/v1/public/products`, { headers: { "x-forwarded-for": addr } });
        expect(res.status).toBe(200);
        expect(res.headers.get("ratelimit-limit")).toBe("240");
        expect(res.headers.get("ratelimit-remaining")).toBe(String(240 - i));
      }
    });
    await getMemoryRateLimitStore().flush();
    expect(await rowsFor(addr)).toEqual([]);
  });

  it("still answers 429 with the same body once a bucket is exhausted", async () => {
    const addr = ip();
    usedIps.push(addr);
    const limit = RATE_LIMIT_POLICIES.checkout.limit;
    await withServer(async (base) => {
      let last: Response | null = null;
      for (let i = 0; i <= limit; i++) {
        last = await fetch(`${base}/api/v1/checkout/session`, { method: "POST", headers: { "x-forwarded-for": addr } });
      }
      expect(last!.status).toBe(429);
      const body = await last!.json();
      expect(body).toMatchObject({ error: "Rate limit exceeded", code: "RATE_LIMITED", message: RATE_LIMIT_POLICIES.checkout.message });
      expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
    });
  });

  it("syncs security buckets to Postgres in one batched flush", async () => {
    const addr = ip();
    usedIps.push(addr);
    await withServer(async (base) => {
      for (let i = 0; i < 4; i++) {
        await fetch(`${base}/api/v1/auth/sync`, { method: "POST", headers: { "x-forwarded-for": addr } });
      }
    });
    expect(await rowsFor(addr)).toEqual([]); // nothing written on the request path
    await getMemoryRateLimitStore().flush();
    const rows = await rowsFor(addr);
    expect(rows).toHaveLength(1);
    expect(rows[0].bucket_key).toBe(`authentication:ip:${addr}`);
    expect(Number(rows[0].request_count)).toBe(4);
  });

  it("fails open for ordinary routes and closed for security controls when counting throws", async () => {
    state.storeThrows = true;
    const addr = ip();
    await withServer(async (base) => {
      const read = await fetch(`${base}/api/v1/public/products`, { headers: { "x-forwarded-for": addr } });
      expect(read.status).toBe(200);
      const checkout = await fetch(`${base}/api/v1/checkout/session`, { method: "POST", headers: { "x-forwarded-for": addr } });
      expect(checkout.status).toBe(200);
      const auth = await fetch(`${base}/api/v1/auth/sync`, { method: "POST", headers: { "x-forwarded-for": addr } });
      expect(auth.status).toBe(503);
      expect(await auth.json()).toMatchObject({ code: "RATE_LIMIT_UNAVAILABLE" });
    });
  });
});
