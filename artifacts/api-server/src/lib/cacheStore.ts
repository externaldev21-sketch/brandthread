/**
 * Tiny key/value cache abstraction so cache logic is testable without Redis
 * and so "no Redis" is just "no store".
 */
import { getRedis, noteRedisFailure } from "./redis";

export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(...keys: string[]): Promise<void>;
}

class RedisStore implements CacheStore {
  async get(key: string): Promise<string | null> {
    const r = getRedis();
    if (!r) return null;
    try { return await r.get(key); } catch (err) { noteRedisFailure(err); return null; }
  }
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    const r = getRedis();
    if (!r) return;
    try { await r.set(key, value, "EX", ttlSeconds); } catch (err) { noteRedisFailure(err); }
  }
  async del(...keys: string[]): Promise<void> {
    const r = getRedis();
    if (!r || keys.length === 0) return;
    try { await r.del(...keys); } catch (err) { noteRedisFailure(err); }
  }
}

/** In-memory store for tests. */
export class MemoryStore implements CacheStore {
  private data = new Map<string, { value: string; expiresAt: number }>();
  async get(key: string) {
    const hit = this.data.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) { this.data.delete(key); return null; }
    return hit.value;
  }
  async set(key: string, value: string, ttlSeconds: number) {
    this.data.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
  async del(...keys: string[]) { for (const k of keys) this.data.delete(k); }
  get size() { return this.data.size; }
}

let override: CacheStore | null | undefined;

/** The active store, or null when caching is off (no REDIS_URL, or CACHE_DISABLED=1). */
export function getCacheStore(): CacheStore | null {
  if (override !== undefined) return override;
  if (process.env["CACHE_DISABLED"] === "1") return null;
  return getRedis() ? new RedisStore() : null;
}

export function __setCacheStoreForTests(store: CacheStore | null | undefined): void {
  override = store;
}
