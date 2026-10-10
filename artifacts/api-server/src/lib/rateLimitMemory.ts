/**
 * Per-instance rate-limit counters with a batched Postgres sync (BT-474).
 *
 * Before: without REDIS_URL every API request ran an INSERT ... ON CONFLICT
 * on `rate_limit_buckets`, and a slow database turned into 503s for every
 * route, checkout included. Now, without Redis:
 *
 *  - Every bucket is counted in this process's memory. No database work on
 *    the request path. Same fixed-window semantics and limits as before.
 *  - Buckets that must hold across instances and deploys (sign-in guessing,
 *    invite codes, gift-card codes, money, checkout, daily caps; see
 *    GLOBAL_RATE_LIMIT_POLICIES) are also added to `rate_limit_buckets` in one
 *    batched statement every RATE_LIMIT_FLUSH_MS (default 5 s). The total the
 *    database returns becomes this instance's view of the shared count, so
 *    instances see each other's traffic within one flush interval.
 *  - A failed flush keeps the pending hits and retries next tick; the
 *    request path never waits on it.
 *
 * Memory is bounded: expired windows are swept on every flush and the map is
 * capped (oldest entries go first).
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";

export type Counter = { count: number; resetAt: Date };

/**
 * Buckets synced to Postgres. Names only (not the policy type) so a policy a
 * sibling PR adds, like "money-transfer", is covered the day it lands.
 */
export const GLOBAL_RATE_LIMIT_POLICIES: ReadonlySet<string> = new Set([
  "authentication",
  "access-code",
  "access-waitlist",
  "gift-card-lookup",
  "contact-match",
  "checkout",
  "money-transfer",
  "community-create",
  "email-subscribe",
]);

/** The bucket key is "<policy>:<identity>" (or "<policy>:ipcap:..."). */
export function policyOfKey(key: string): string {
  const i = key.indexOf(":");
  return i < 0 ? key : key.slice(0, i);
}

type Entry = {
  /** Hits this instance counted in the current window. */
  local: number;
  /** Hits not yet written to Postgres (global buckets only). */
  pending: number;
  /** Shared total as of the last flush (includes our flushed hits). */
  remote: number;
  windowMs: number;
  resetAt: number;
  global: boolean;
};

export interface FlushSink {
  /** Adds `count` hits to each key; returns the shared totals. */
  add(rows: Array<{ key: string; count: number; windowMs: number }>): Promise<Array<{ key: string; count: number; resetAt: Date }>>;
  /** Deletes long-expired buckets (called at most once a minute). */
  sweep?(): Promise<void>;
}

/** Same window rules as consumeRateLimitBucket, for many keys in one statement. */
export const postgresFlushSink: FlushSink = {
  async add(rows) {
    if (rows.length === 0) return [];
    const result = await pool.query(
      `INSERT INTO rate_limit_buckets (bucket_key, request_count, window_started_at, expires_at)
       SELECT k, c, now(), now() + (w * interval '1 millisecond')
       FROM unnest($1::text[], $2::int[], $3::bigint[]) AS t(k, c, w)
       ON CONFLICT (bucket_key) DO UPDATE SET
         request_count = CASE
           WHEN rate_limit_buckets.expires_at <= now() THEN EXCLUDED.request_count
           ELSE rate_limit_buckets.request_count + EXCLUDED.request_count
         END,
         window_started_at = CASE
           WHEN rate_limit_buckets.expires_at <= now() THEN now()
           ELSE rate_limit_buckets.window_started_at
         END,
         expires_at = CASE
           WHEN rate_limit_buckets.expires_at <= now() THEN EXCLUDED.expires_at
           ELSE rate_limit_buckets.expires_at
         END
       RETURNING bucket_key, request_count, expires_at`,
      [rows.map((r) => r.key), rows.map((r) => r.count), rows.map((r) => r.windowMs)],
    );
    return (result.rows as Array<{ bucket_key: string; request_count: number | string; expires_at: Date | string }>).map((r) => ({
      key: r.bucket_key,
      count: Number(r.request_count),
      resetAt: r.expires_at instanceof Date ? r.expires_at : new Date(r.expires_at),
    }));
  },
  async sweep() {
    await pool.query("DELETE FROM rate_limit_buckets WHERE expires_at < now() - interval '1 hour'");
  },
};

export class MemoryRateLimitStore {
  private readonly entries = new Map<string, Entry>();
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;
  private warned = false;
  private lastSweep = 0;
  private readonly flushMs: number;
  private readonly maxEntries: number;
  private readonly sink: FlushSink | null;
  private readonly isGlobal: (policy: string) => boolean;
  private readonly now: () => number;

  constructor(opts: {
    sink?: FlushSink | null;
    flushMs?: number;
    maxEntries?: number;
    isGlobal?: (policy: string) => boolean;
    now?: () => number;
  } = {}) {
    this.sink = opts.sink === undefined ? postgresFlushSink : opts.sink;
    this.flushMs = opts.flushMs ?? (Number(process.env.RATE_LIMIT_FLUSH_MS) || 5_000);
    this.maxEntries = opts.maxEntries ?? 200_000;
    this.isGlobal = opts.isGlobal ?? ((p) => GLOBAL_RATE_LIMIT_POLICIES.has(p));
    this.now = opts.now ?? Date.now;
  }

  consume(key: string, windowMs: number): Counter {
    const now = this.now();
    let e = this.entries.get(key);
    if (!e || e.resetAt <= now) {
      if (e) this.entries.delete(key);
      e = {
        local: 0, pending: 0, remote: 0, windowMs,
        resetAt: now + windowMs,
        global: this.sink !== null && this.isGlobal(policyOfKey(key)),
      };
      this.entries.set(key, e);
      this.enforceCap();
    }
    e.local += 1;
    if (e.global) {
      e.pending += 1;
      this.ensureTimer();
    }
    const count = e.global ? Math.max(e.local, e.remote + e.pending) : e.local;
    return { count, resetAt: new Date(e.resetAt) };
  }

  /** Writes pending hits of global buckets. Safe to call concurrently. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.doFlush().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  private async doFlush(): Promise<void> {
    const now = this.now();
    const batch: Array<{ key: string; count: number; windowMs: number; entry: Entry }> = [];
    for (const [key, e] of this.entries) {
      if (e.resetAt <= now) {
        // Window over. Unsent hits of an expired window no longer matter.
        this.entries.delete(key);
        continue;
      }
      if (e.global && e.pending > 0) batch.push({ key, count: e.pending, windowMs: e.windowMs, entry: e });
    }
    if (this.sink?.sweep && now - this.lastSweep >= 60_000) {
      this.lastSweep = now;
      this.sink.sweep().catch(() => { this.lastSweep = 0; });
    }
    if (!this.sink || batch.length === 0) return;
    for (let i = 0; i < batch.length; i += 500) {
      const chunk = batch.slice(i, i + 500);
      try {
        const totals = await this.sink.add(chunk.map(({ key, count, windowMs }) => ({ key, count, windowMs })));
        const byKey = new Map(totals.map((t) => [t.key, t]));
        for (const item of chunk) {
          const total = byKey.get(item.key);
          const current = this.entries.get(item.key);
          // Skip if the entry rolled over to a new window during the flush.
          if (!total || current !== item.entry) continue;
          current.pending = Math.max(0, current.pending - item.count);
          current.remote = total.count;
          current.resetAt = total.resetAt.getTime();
        }
        this.warned = false;
      } catch (err) {
        if (!this.warned) {
          this.warned = true;
          logger.warn({ err: err instanceof Error ? err.message : String(err) }, "Rate-limit flush to Postgres failed; counting per instance until it recovers");
        }
        return;
      }
    }
  }

  private ensureTimer(): void {
    if (this.timer || !this.sink) return;
    this.timer = setInterval(() => { void this.flush(); }, this.flushMs);
    this.timer.unref?.();
  }

  private enforceCap(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  size(): number { return this.entries.size; }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

let shared: MemoryRateLimitStore | null = null;

export function getMemoryRateLimitStore(): MemoryRateLimitStore {
  return (shared ??= new MemoryRateLimitStore());
}

/** Test seam. */
export function __resetMemoryRateLimitStoreForTests(): void {
  shared?.stop();
  shared = null;
}
