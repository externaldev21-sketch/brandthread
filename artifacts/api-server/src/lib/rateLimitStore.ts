/**
 * Rate-limit counters in Redis, with the existing Postgres bucket as the
 * fallback. Same fixed-window semantics as consumeRateLimitBucket: the first
 * hit opens a window of `windowMs`, later hits count up, the window resets when
 * it expires. One atomic Lua script, one round trip.
 *
 * Why: the Postgres path is an INSERT ... ON CONFLICT on every API request.
 * At thousands of requests per second that is the busiest write on the database.
 *
 * Redis down or unset => returns null and the caller uses Postgres, so a cache
 * outage never turns into a 503 storm.
 */
import { getRedis, noteRedisFailure } from "./redis";

const SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local t = redis.call('PTTL', KEYS[1])
if t < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); t = tonumber(ARGV[1]) end
return {c, t}
`;

export async function consumeRateLimitRedis(
  bucketKey: string,
  windowMs: number,
): Promise<{ count: number; resetAt: Date } | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    const [count, ttl] = (await r.eval(SCRIPT, 1, `rl:${bucketKey}`, String(windowMs))) as [number, number];
    return { count: Number(count), resetAt: new Date(Date.now() + Math.max(0, Number(ttl))) };
  } catch (err) {
    noteRedisFailure(err);
    return null;
  }
}
