/**
 * Runs only when REDIS_TEST_URL points at a throwaway Redis (e.g.
 * `redis-server --port 6380` and REDIS_TEST_URL=redis://127.0.0.1:6380).
 * Skipped otherwise, so CI without Redis stays green.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env["REDIS_TEST_URL"];
const d = url ? describe : describe.skip;

d("Redis-backed rate limit and cache store", () => {
  let mod: typeof import("../rateLimitStore");
  let store: typeof import("../cacheStore");
  let redis: typeof import("../redis");

  beforeAll(async () => {
    process.env["REDIS_URL"] = url;
    redis = await import("../redis");
    redis.__resetRedisForTests();
    mod = await import("../rateLimitStore");
    store = await import("../cacheStore");
  });
  afterAll(async () => { await redis.closeRedis(); delete process.env["REDIS_URL"]; });

  it("counts inside a window, resets after it, and reports the remaining time", async () => {
    const key = `it:${Date.now()}`;
    const a = await mod.consumeRateLimitRedis(key, 400);
    const b = await mod.consumeRateLimitRedis(key, 400);
    expect([a?.count, b?.count]).toEqual([1, 2]);
    expect(b!.resetAt.getTime() - Date.now()).toBeLessThanOrEqual(400);
    await new Promise((r) => setTimeout(r, 450));
    expect((await mod.consumeRateLimitRedis(key, 400))?.count).toBe(1);
  });

  it("is atomic under concurrency", async () => {
    const key = `atomic:${Date.now()}`;
    const results = await Promise.all(Array.from({ length: 50 }, () => mod.consumeRateLimitRedis(key, 5000)));
    expect(results.map((r) => r!.count).sort((x, y) => x - y)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it("cache store round-trips with a TTL and deletes", async () => {
    const s = store.getCacheStore()!;
    expect(s).not.toBeNull();
    await s.set("it:k", "v", 1);
    expect(await s.get("it:k")).toBe("v");
    await s.del("it:k");
    expect(await s.get("it:k")).toBeNull();
  });
});

describe("with Redis unreachable", () => {
  it("returns null quickly so callers fall back to Postgres", async () => {
    process.env["REDIS_URL"] = "redis://127.0.0.1:1";
    const redis = await import("../redis");
    redis.__resetRedisForTests();
    const { consumeRateLimitRedis } = await import("../rateLimitStore");
    const started = Date.now();
    expect(await consumeRateLimitRedis("x", 1000)).toBeNull();
    expect(Date.now() - started).toBeLessThan(2500);
    expect(redis.redisStatus()).toBe("down");
    await redis.closeRedis();
    delete process.env["REDIS_URL"];
    redis.__resetRedisForTests();
  });
});
