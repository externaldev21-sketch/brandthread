import { describe, expect, it, vi } from "vitest";

/**
 * Audit: the Postgres leader lock holds one app-pool connection checked out
 * for as long as this process leads. Stopping the runner (shutdown) must hand
 * that connection back, or `pool.end()` in index.ts / worker.ts waits on it
 * forever (pg-pool only ends once every checked-out client is released).
 */
const fake = vi.hoisted(() => {
  const clients: Array<{ release: ReturnType<typeof vi.fn> }> = [];
  let gate: Promise<void> | null = null;
  return {
    clients,
    setGate(p: Promise<void> | null) { gate = p; },
    pool: {
      async connect() {
        if (gate) await gate;
        const client = {
          on: vi.fn(),
          query: vi.fn(async () => ({ rows: [{ locked: true }] })),
          release: vi.fn(),
        };
        clients.push(client);
        return client;
      },
    },
  };
});

vi.mock("@workspace/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/db")>(), pool: fake.pool,
}));
vi.mock("../../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../lib/communityPush", () => ({ startCommunityPushJob: vi.fn() }));

const { startSingletonJobsWithLeadership } = await import("../runner");

const flush = () => new Promise((r) => setImmediate(r));

describe("leader lock release on stop (audit)", () => {
  it("returns the leader's lock connection to the pool when stopped", async () => {
    fake.clients.length = 0;
    const job = vi.fn();
    const stop = startSingletonJobsWithLeadership({ singletonJobs: [["job", job]], retryMs: 60_000, heartbeatMs: 60_000 });
    await flush();
    expect(job).toHaveBeenCalledTimes(1);
    expect(fake.clients).toHaveLength(1);
    expect(fake.clients[0]!.release).not.toHaveBeenCalled();

    stop();
    expect(fake.clients[0]!.release).toHaveBeenCalledTimes(1);
  });

  it("releases a lock won after stop() was already called, and starts no jobs", async () => {
    fake.clients.length = 0;
    let open!: () => void;
    fake.setGate(new Promise<void>((r) => { open = r; }));
    const job = vi.fn();
    const stop = startSingletonJobsWithLeadership({ singletonJobs: [["job", job]], retryMs: 60_000, heartbeatMs: 60_000 });
    stop();
    open();
    fake.setGate(null);
    await flush();
    await flush();
    expect(job).not.toHaveBeenCalled();
    expect(fake.clients).toHaveLength(1);
    expect(fake.clients[0]!.release).toHaveBeenCalledTimes(1);
  });
});
