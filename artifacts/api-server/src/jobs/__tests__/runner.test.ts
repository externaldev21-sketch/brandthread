import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/db")>(), pool: {},
}));
vi.mock("../../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// The real job modules pull in the whole app; only the runner logic is under test.
vi.mock("../../lib/communityPush", () => ({ startCommunityPushJob: vi.fn() }));

const { backgroundJobsEnabled, startSingletonJobsWithLeadership, SINGLETON_JOBS, PER_INSTANCE_JOBS } =
  await import("../runner");

/** In-memory stand-in for the Postgres advisory lock shared by several processes. */
function sharedLock() {
  let holder: number | null = null;
  return (id: number) => ({
    async tryAcquire() {
      if (holder === null || holder === id) { holder = id; return true; }
      return false;
    },
    async stillHeld() { return holder === id; },
    crash() { if (holder === id) holder = null; },
  });
}

const flush = () => new Promise((r) => setImmediate(r));

describe("background job runner", () => {
  const stops: Array<() => void> = [];
  afterEach(() => { stops.splice(0).forEach((s) => s()); vi.useRealTimers(); });

  it("starts the jobs in only one of two copies of the server", async () => {
    const lockFor = sharedLock();
    const a = vi.fn();
    const b = vi.fn();
    stops.push(startSingletonJobsWithLeadership({ lock: lockFor(1), singletonJobs: [["job", a]], retryMs: 10_000 }));
    stops.push(startSingletonJobsWithLeadership({ lock: lockFor(2), singletonJobs: [["job", b]], retryMs: 10_000 }));
    await flush();
    expect(a.mock.calls.length + b.mock.calls.length).toBe(1);
  });

  it("lets a follower take over when the leader dies", async () => {
    vi.useFakeTimers();
    const lockFor = sharedLock();
    const leaderLock = lockFor(1);
    const leader = vi.fn();
    const follower = vi.fn();
    stops.push(startSingletonJobsWithLeadership({ lock: leaderLock, singletonJobs: [["job", leader]], retryMs: 1000, onLeadershipLost: () => {} }));
    await vi.advanceTimersByTimeAsync(0);
    stops.push(startSingletonJobsWithLeadership({ lock: lockFor(2), singletonJobs: [["job", follower]], retryMs: 1000 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(leader).toHaveBeenCalledTimes(1);
    expect(follower).not.toHaveBeenCalled();

    stops[0]!();
    leaderLock.crash();
    await vi.advanceTimersByTimeAsync(1000);
    expect(follower).toHaveBeenCalledTimes(1);
  });

  it("restarts a leader that lost its lock to another process", async () => {
    vi.useFakeTimers();
    const lockFor = sharedLock();
    const first = lockFor(1);
    const onLost = vi.fn();
    stops.push(startSingletonJobsWithLeadership({ lock: first, singletonJobs: [["job", vi.fn()]], heartbeatMs: 1000, onLeadershipLost: onLost }));
    await vi.advanceTimersByTimeAsync(0);
    first.crash();
    await lockFor(2).tryAcquire();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it("honours BACKGROUND_JOBS=off", () => {
    expect(backgroundJobsEnabled({})).toBe(true);
    expect(backgroundJobsEnabled({ BACKGROUND_JOBS: "off" })).toBe(false);
    expect(backgroundJobsEnabled({ BACKGROUND_JOBS: "false" })).toBe(false);
    expect(backgroundJobsEnabled({ BACKGROUND_JOBS: "on" })).toBe(true);
  });

  it("covers all 44 integrated background jobs without duplicate names", () => {
    expect(SINGLETON_JOBS.length + PER_INSTANCE_JOBS.length).toBe(44);
    const names = [...SINGLETON_JOBS, ...PER_INSTANCE_JOBS].map(([n]) => n);
    expect(new Set(names).size).toBe(44);
  });
});
