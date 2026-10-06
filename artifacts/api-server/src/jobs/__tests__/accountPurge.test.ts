import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  due: [] as Array<{ clerkId: string; deletedAt: Date | null }>,
  sets: [] as Array<Record<string, unknown>>,
  blockers: {} as Record<string, unknown[]>,
  purged: [] as string[],
  deleted: [] as string[],
  deleteUserError: null as unknown,
  purgeError: null as unknown,
  subscription: null as null | { provider: "stripe"; subscriptionId: string } | { provider: "store" },
  cancelled: [] as string[],
  cancelError: null as unknown,
}));

vi.mock("drizzle-orm", () => {
  const passthrough = (...args: unknown[]) => args;
  return { and: passthrough, asc: passthrough, eq: passthrough, isNotNull: passthrough, lte: passthrough };
});

vi.mock("@workspace/db", () => {
  const columns = new Proxy({}, { get: (_t, key) => String(key) });
  return {
    users: columns,
    db: {
      select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => state.due }) }) }) }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          state.sets.push(values);
          return { where: () => Object.assign(Promise.resolve([]), { catch: () => Promise.resolve([]) }) };
        },
      }),
    },
  };
});

vi.mock("@clerk/express", () => ({
  clerkClient: {
    users: {
      deleteUser: async (id: string) => {
        if (state.deleteUserError) throw state.deleteUserError;
        state.deleted.push(id);
      },
    },
  },
}));

vi.mock("../../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

vi.mock("../../lib/accountDeletion", () => ({
  DELETION_POSTPONE_DAYS: 7,
  addDays: (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000),
  getDeletionBlockers: async (id: string) => state.blockers[id] ?? [],
  purgeAccount: async (id: string) => {
    if (state.purgeError) throw state.purgeError;
    state.purged.push(id);
    return true;
  },
}));

vi.mock("../../lib/accountDeletionBilling", () => ({
  getDeletionSubscription: async () => state.subscription,
  cancelSubscriptionAtPurge: async (id: string) => {
    if (state.cancelError) throw state.cancelError;
    state.cancelled.push(id);
  },
}));

import { runAccountPurge } from "../accountPurge";

const now = new Date("2026-03-01T00:00:00.000Z");

beforeEach(() => {
  state.due = [];
  state.sets = [];
  state.blockers = {};
  state.purged = [];
  state.deleted = [];
  state.deleteUserError = null;
  state.purgeError = null;
  state.subscription = null;
  state.cancelled = [];
  state.cancelError = null;
});

describe("runAccountPurge", () => {
  it("does nothing when no account is due", async () => {
    expect(await runAccountPurge(now)).toEqual({ purged: 0, postponed: 0, failed: 0 });
    expect(state.purged).toEqual([]);
  });

  it("purges a due account, removes the Clerk user and clears the schedule", async () => {
    state.due = [{ clerkId: "user_a", deletedAt: null }];
    expect(await runAccountPurge(now)).toEqual({ purged: 1, postponed: 0, failed: 0 });
    expect(state.purged).toEqual(["user_a"]);
    expect(state.deleted).toEqual(["user_a"]);
    expect(state.sets.at(-1)).toMatchObject({ deletionScheduledFor: null });
  });

  it("postpones 7 days and purges nothing when blockers reappeared", async () => {
    state.due = [{ clerkId: "user_b", deletedAt: null }];
    state.blockers = { user_b: [{ code: "seller_open_orders" }] };
    expect(await runAccountPurge(now)).toEqual({ purged: 0, postponed: 1, failed: 0 });
    expect(state.purged).toEqual([]);
    expect(state.deleted).toEqual([]);
    expect((state.sets[0].deletionScheduledFor as Date).toISOString()).toBe("2026-03-08T00:00:00.000Z");
  });

  it("only finishes Clerk removal for an already-purged tombstone (retry-safe)", async () => {
    state.due = [{ clerkId: "user_c", deletedAt: new Date() }];
    await runAccountPurge(now);
    expect(state.purged).toEqual([]);
    expect(state.deleted).toEqual(["user_c"]);
  });

  it("treats a Clerk 404 as already removed", async () => {
    state.due = [{ clerkId: "user_d", deletedAt: new Date() }];
    state.deleteUserError = Object.assign(new Error("not found"), { status: 404 });
    expect(await runAccountPurge(now)).toEqual({ purged: 1, postponed: 0, failed: 0 });
  });

  it("backs off an account whose purge fails and keeps going", async () => {
    state.due = [{ clerkId: "user_e", deletedAt: null }, { clerkId: "user_f", deletedAt: null }];
    state.purgeError = new Error("db down");
    expect(await runAccountPurge(now)).toEqual({ purged: 0, postponed: 0, failed: 2 });
    expect((state.sets[0].deletionScheduledFor as Date).getTime()).toBeGreaterThan(now.getTime());
  });

  // QA-0073: a purged account is never charged again.
  it("cancels a web-billed (Stripe) plan before purging", async () => {
    state.due = [{ clerkId: "user_a", deletedAt: null }];
    state.subscription = { provider: "stripe", subscriptionId: "sub_1" };
    expect(await runAccountPurge(now)).toEqual({ purged: 1, postponed: 0, failed: 0 });
    expect(state.cancelled).toEqual(["sub_1"]);
    expect(state.purged).toEqual(["user_a"]);
  });

  it("does not purge when Stripe cannot cancel, and retries later", async () => {
    state.due = [{ clerkId: "user_a", deletedAt: null }];
    state.subscription = { provider: "stripe", subscriptionId: "sub_1" };
    state.cancelError = new Error("stripe down");
    expect(await runAccountPurge(now)).toEqual({ purged: 0, postponed: 0, failed: 1 });
    expect(state.purged).toEqual([]);
  });

  it("purges store-billed accounts (only the person can cancel those; the delete screen told them how)", async () => {
    state.due = [{ clerkId: "user_a", deletedAt: null }];
    state.subscription = { provider: "store" };
    expect(await runAccountPurge(now)).toEqual({ purged: 1, postponed: 0, failed: 0 });
    expect(state.cancelled).toEqual([]);
  });
});
