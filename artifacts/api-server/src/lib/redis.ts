/**
 * Optional Redis connection (Upstash or any redis:// / rediss:// provider).
 *
 * REDIS_URL unset => `getRedis()` returns null and every caller keeps its
 * pre-Redis behavior. Redis is never required for correctness: callers must
 * treat a null client or a thrown error as "cache miss / use the database".
 *
 * A circuit breaker stops us hammering a dead Redis: after a failure the
 * client is reported unavailable for REDIS_COOLDOWN_MS, so each request does
 * not pay a connect timeout.
 */
import { Redis } from "ioredis";
import { logger } from "./logger";

const COOLDOWN_MS = Number(process.env["REDIS_COOLDOWN_MS"]) || 5_000;
const COMMAND_TIMEOUT_MS = Number(process.env["REDIS_COMMAND_TIMEOUT_MS"]) || 250;

let client: Redis | null = null;
let downUntil = 0;
let warned = false;

export function redisConfigured(): boolean {
  return Boolean(process.env["REDIS_URL"]);
}

export function getRedis(): Redis | null {
  const url = process.env["REDIS_URL"];
  if (!url) return null;
  if (Date.now() < downUntil) return null;
  if (!client) {
    client = new Redis(url, {
      // Fail fast: a slow cache is worse than no cache.
      commandTimeout: COMMAND_TIMEOUT_MS,
      connectTimeout: 2_000,
      maxRetriesPerRequest: 1,
      // Queue commands while the first connection is made; commandTimeout bounds the wait.
      enableOfflineQueue: true,
      retryStrategy: (times) => Math.min(times * 200, 2_000),
    });
    client.on("error", (err) => {
      noteRedisFailure(err);
    });
  }
  return client;
}

/** Call when a Redis command throws so the breaker opens. */
export function noteRedisFailure(err: unknown): void {
  downUntil = Date.now() + COOLDOWN_MS;
  if (!warned) {
    warned = true;
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "Redis unavailable; falling back to the database (further warnings suppressed)");
  }
}

export function redisStatus(): "disabled" | "ok" | "down" {
  if (!redisConfigured()) return "disabled";
  return Date.now() < downUntil ? "down" : "ok";
}

export async function closeRedis(): Promise<void> {
  const c = client;
  client = null;
  if (c) await c.quit().catch(() => c.disconnect());
}

/** Test seam. */
export function __resetRedisForTests(): void {
  client = null;
  downUntil = 0;
  warned = false;
}
