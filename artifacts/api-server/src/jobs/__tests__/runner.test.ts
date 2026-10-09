import { afterEach, describe, expect, it, vi } from "vitest";
import { createJobRunner, disabledJobs, jobsEnabled, type LockClient } from "../runner";

/** In-memory stand-in for Postgres transaction-scoped advisory locks shared by several "replicas". */
function fakeLockServer() {
  const held = new Map<string, object>();
  type FakeClient = LockClient & { failNext: boolean; destroyed: boolean; inTx: boolean; keys: Set<string> };
  const clients: FakeClient[] = [];
  function endTx(client: FakeClient) {
    for (const k of client.keys) held.delete(k);
    client.keys.clear();
    client.inTx = false;
  }
  function makeClient(): FakeClient {
    const client: FakeClient = {
      failNext: false, destroyed: false, inTx: false, keys: new Set(),
      async query(text: string, values?: unknown[]) {
        if (client.failNext) { client.failNext = false; throw new Error("connection reset"); }
        if (text === "BEGIN") { client.inTx = true; return { rows: [] }; }
        if (text === "COMMIT" || text === "ROLLBACK") { endTx(client); return { rows: [] }; }
        if (text.startsWith("SET LOCAL")) return { rows: [] };
        if (text.includes("pg_try_advisory_xact_lock")) {
          if (!client.inTx) throw new Error("xact lock outside a transaction");
          const key = String(values?.[0]);
          const owner = held.get(key);
          if (owner && owner !== client) return { rows: [{ locked: false }] };
          held.set(key, client);
          client.keys.add(key);
          return { rows: [{ locked: true }] };
        }
        throw new Error(`unexpected query ${text}`);
      },
      release(err?: Error | boolean) {
        if (err) { client.destroyed = true; endTx(client); }
      },
    };
    clients.push(client);
    return client;
  }
  function pool() {
    return { connect: async () => makeClient(), end: vi.fn(async () => {}) };
  }
  return { pool, held, clients };
}

function silentLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("job runner", () => {
  it("lets only one replica run a job at a time; the other skips while the lock is held", async () => {
    const server = fakeLockServer();
    const a = createJobRunner({ pool: server.pool(), log: silentLog(), env: {} });
    const b = createJobRunner({ pool: server.pool(), log: silentLog(), env: {} });
    const gate = deferred();
    const fnA = vi.fn(() => gate.promise);
    const fnB = vi.fn(async () => {});

    const first = a.runOnce("sweep", fnA);
    await vi.waitFor(() => expect(fnA).toHaveBeenCalledTimes(1));
    expect(await b.runOnce("sweep", fnB)).toBe("skipped_locked");
    expect(fnB).not.toHaveBeenCalled();

    gate.resolve();
    expect(await first).toBe("ran");
    expect(server.held.size).toBe(0); // released in finally
    expect(await b.runOnce("sweep", fnB)).toBe("ran");
    expect(fnB).toHaveBeenCalledTimes(1);
    await a.close();
    await b.close();
  });

  it("different job names don't block each other", async () => {
    const server = fakeLockServer();
    const a = createJobRunner({ pool: server.pool(), log: silentLog(), env: {} });
    const b = createJobRunner({ pool: server.pool(), log: silentLog(), env: {} });
    const gate = deferred();
    const first = a.runOnce("one", () => gate.promise);
    expect(await b.runOnce("two", async () => {})).toBe("ran");
    gate.resolve();
    await first;
    await a.close();
    await b.close();
  });

  it("skips an overlapping tick in the same process", async () => {
    const server = fakeLockServer();
    const runner = createJobRunner({ pool: server.pool(), log: silentLog(), env: {} });
    const gate = deferred();
    const fn = vi.fn(() => gate.promise);
    const first = runner.runOnce("slow", fn);
    expect(await runner.runOnce("slow", fn)).toBe("skipped_overlap");
    gate.resolve();
    expect(await first).toBe("ran");
    expect(fn).toHaveBeenCalledTimes(1);
    await runner.close();
  });

  it("logs a failing run, releases the lock, and keeps the interval going", async () => {
    vi.useFakeTimers();
    const server = fakeLockServer();
    const log = silentLog();
    const runner = createJobRunner({ pool: server.pool(), log, env: {} });
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error("boom");
    });
    runner.schedule("flaky", fn, { intervalMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ job: "flaky", err: expect.any(Error) }),
      "Background job failed",
    );
    expect(server.held.size).toBe(0);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(3);
    await runner.close();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fn).toHaveBeenCalledTimes(3); // close() stops the timers
  });

  it("a synchronous throw is caught too", async () => {
    const server = fakeLockServer();
    const log = silentLog();
    const runner = createJobRunner({ pool: server.pool(), log, env: {} });
    expect(await runner.runOnce("sync", () => { throw new Error("sync boom"); })).toBe("failed");
    expect(server.held.size).toBe(0);
    await runner.close();
  });

  it("fails closed when the lock connection errors, and recovers on the next tick", async () => {
    const server = fakeLockServer();
    const log = silentLog();
    const failing = { connect: vi.fn().mockRejectedValueOnce(new Error("db down")), end: vi.fn(async () => {}) };
    const realPool = server.pool();
    failing.connect.mockImplementation(realPool.connect);
    const runner = createJobRunner({ pool: failing, log, env: {} });
    const fn = vi.fn(async () => {});
    expect(await runner.runOnce("job", fn)).toBe("skipped_lock_error");
    expect(fn).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalled();
    expect(await runner.runOnce("job", fn)).toBe("ran");
    expect(fn).toHaveBeenCalledTimes(1);
    await runner.close();
  });

  it("discards the lock connection when the lock query itself fails", async () => {
    const server = fakeLockServer();
    const pool = { connect: async () => { const c = await server.pool().connect(); (c as any).failNext = true; return c; }, end: vi.fn(async () => {}) };
    const runner = createJobRunner({ pool, log: silentLog(), env: {} });
    expect(await runner.runOnce("job", async () => {})).toBe("skipped_lock_error");
    expect(server.clients[0].destroyed).toBe(true);
    expect(server.held.size).toBe(0);
    await runner.close();
  });

  it("releases the lock (ends the transaction) after each run", async () => {
    const server = fakeLockServer();
    const runner = createJobRunner({ pool: server.pool(), log: silentLog(), env: {} });
    await runner.runOnce("job", async () => {
      expect(server.held.size).toBe(1);
      expect(server.clients[0].inTx).toBe(true);
    });
    expect(server.held.size).toBe(0);
    expect(server.clients[0].inTx).toBe(false);
    expect(server.clients[0].destroyed).toBe(false);
    await runner.close();
  });

  it("runs per-process jobs without taking a lock when distributed is false", async () => {
    const pool = { connect: vi.fn(), end: vi.fn(async () => {}) };
    const runner = createJobRunner({ pool, log: silentLog(), env: {} });
    expect(await runner.runOnce("local", async () => {}, { distributed: false })).toBe("ran");
    expect(pool.connect).not.toHaveBeenCalled();
    await runner.close();
  });

  it("runs an immediate first tick when initialDelayMs is 0", async () => {
    vi.useFakeTimers();
    const server = fakeLockServer();
    const runner = createJobRunner({ pool: server.pool(), log: silentLog(), env: {} });
    const fn = vi.fn(async () => {});
    runner.schedule("now", fn, { intervalMs: 60_000, initialDelayMs: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    await runner.close();
  });

  it("kill switches default to on", async () => {
    expect(jobsEnabled({})).toBe(true);
    expect(jobsEnabled({ BACKGROUND_JOBS_ENABLED: "true" })).toBe(true);
    expect(jobsEnabled({ BACKGROUND_JOBS_ENABLED: "false" })).toBe(false);
    expect(jobsEnabled({ BACKGROUND_JOBS_ENABLED: "0" })).toBe(false);
    expect([...disabledJobs({ DISABLED_JOBS: " a, b ,," })]).toEqual(["a", "b"]);

    vi.useFakeTimers();
    const server = fakeLockServer;
    const fn = vi.fn();
    const off = createJobRunner({ pool: server().pool(), log: silentLog(), env: { BACKGROUND_JOBS_ENABLED: "false" } });
    off.schedule("x", fn, { intervalMs: 10, initialDelayMs: 0 });
    const one = createJobRunner({ pool: server().pool(), log: silentLog(), env: { DISABLED_JOBS: "x" } });
    one.schedule("x", fn, { intervalMs: 10, initialDelayMs: 0 });
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).not.toHaveBeenCalled();
  });
});
