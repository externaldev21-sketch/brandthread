import { describe, expect, it } from "vitest";
import { MemoryRateLimitStore, policyOfKey, type FlushSink } from "../rateLimitMemory";

function fakeSink(opts: { fail?: boolean } = {}) {
  const totals = new Map<string, number>();
  const calls: Array<Array<{ key: string; count: number }>> = [];
  const sink: FlushSink & { fail: boolean } = {
    fail: opts.fail ?? false,
    async add(rows) {
      if (sink.fail) throw new Error("db down");
      calls.push(rows.map(({ key, count }) => ({ key, count })));
      return rows.map((r) => {
        const n = (totals.get(r.key) ?? 0) + r.count;
        totals.set(r.key, n);
        return { key: r.key, count: n, resetAt: new Date(Date.now() + r.windowMs) };
      });
    },
  };
  return { sink, totals, calls };
}

describe("MemoryRateLimitStore", () => {
  it("counts a fixed window per key and resets when it ends", () => {
    let now = 1_000_000;
    const store = new MemoryRateLimitStore({ sink: null, now: () => now });
    expect(store.consume("public-read:ip:a", 60_000).count).toBe(1);
    expect(store.consume("public-read:ip:a", 60_000).count).toBe(2);
    expect(store.consume("public-read:ip:b", 60_000).count).toBe(1);
    const c = store.consume("public-read:ip:a", 60_000);
    expect(c.count).toBe(3);
    expect(c.resetAt.getTime()).toBe(1_000_000 + 60_000);
    now += 60_000;
    expect(store.consume("public-read:ip:a", 60_000).count).toBe(1);
  });

  it("never writes non-global buckets to the database", async () => {
    const { sink, calls } = fakeSink();
    const store = new MemoryRateLimitStore({ sink, flushMs: 60_000 });
    for (let i = 0; i < 50; i++) store.consume("public-read:ip:a", 60_000);
    store.consume("mutation:user:u", 60_000);
    await store.flush();
    expect(calls).toEqual([]);
    store.stop();
  });

  it("batches global buckets into one flush and adopts the shared total", async () => {
    const { sink, totals, calls } = fakeSink();
    const store = new MemoryRateLimitStore({ sink, flushMs: 60_000 });
    store.consume("authentication:ip:1", 600_000);
    store.consume("authentication:ip:1", 600_000);
    store.consume("checkout:user:u", 300_000);
    // Another instance already counted 25 sign-in attempts for this IP.
    totals.set("authentication:ip:1", 25);
    await store.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      { key: "authentication:ip:1", count: 2 },
      { key: "checkout:user:u", count: 1 },
    ]);
    // 27 shared + this hit.
    expect(store.consume("authentication:ip:1", 600_000).count).toBe(28);
    store.stop();
  });

  it("keeps pending hits when a flush fails and sends them next time", async () => {
    const f = fakeSink({ fail: true });
    const store = new MemoryRateLimitStore({ sink: f.sink, flushMs: 60_000 });
    store.consume("access-code:ip:1", 60_000);
    store.consume("access-code:ip:1", 60_000);
    await store.flush();
    expect(f.calls).toEqual([]);
    // Still enforced locally while the database is away.
    expect(store.consume("access-code:ip:1", 60_000).count).toBe(3);
    f.sink.fail = false;
    await store.flush();
    expect(f.calls).toEqual([[{ key: "access-code:ip:1", count: 3 }]]);
    expect(f.totals.get("access-code:ip:1")).toBe(3);
    store.stop();
  });

  it("is bounded: expired windows are swept and the map is capped", async () => {
    let now = 0;
    const store = new MemoryRateLimitStore({ sink: null, maxEntries: 3, now: () => now });
    for (const k of ["a", "b", "c", "d"]) store.consume(`public-read:ip:${k}`, 1_000);
    expect(store.size()).toBe(3);
    now = 5_000;
    await store.flush();
    expect(store.size()).toBe(0);
  });

  it("reads the policy from a bucket key", () => {
    expect(policyOfKey("authentication:user:u")).toBe("authentication");
    expect(policyOfKey("upload:ipcap:ip:1.2.3.4")).toBe("upload");
  });
});
