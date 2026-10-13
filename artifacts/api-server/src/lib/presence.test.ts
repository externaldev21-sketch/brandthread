import { beforeEach, describe, expect, it, vi } from "vitest";

const updates = vi.hoisted(() => [] as unknown[]);

vi.mock("@workspace/db", () => {
  const chain: any = {
    update: () => chain,
    set: (values: unknown) => { updates.push(values); return chain; },
    where: () => Promise.resolve(),
  };
  return { db: chain, users: {} };
});
vi.mock("drizzle-orm", () => ({ eq: () => null, inArray: () => null }));
vi.mock("./logger", () => ({ logger: { debug: () => undefined } }));

import { ONLINE_WINDOW_MS, TOUCH_INTERVAL_MS, presenceFor, resetPresenceThrottle, touchPresence } from "./presence";

const NOW = Date.parse("2026-10-13T12:00:00Z");
const row = (minutesAgo: number | null, show = true) => ({
  lastActiveAt: minutesAgo === null ? null : new Date(NOW - minutesAgo * 60_000),
  showActivityStatus: show,
});

beforeEach(() => {
  updates.length = 0;
  resetPresenceThrottle();
});

describe("presenceFor", () => {
  it("is online inside the window and offline after it", () => {
    expect(presenceFor(row(0), row(2), NOW)).toEqual({ isOnline: true, lastSeenAt: new Date(NOW - 120_000).toISOString() });
    expect(presenceFor(row(0), row(ONLINE_WINDOW_MS / 60_000 + 1), NOW).isOnline).toBe(false);
  });

  it("hides status both ways when either person turned it off", () => {
    expect(presenceFor(row(0, false), row(1), NOW)).toEqual({ isOnline: false });
    expect(presenceFor(row(0), row(1, false), NOW)).toEqual({ isOnline: false });
  });

  it("is offline with no activity recorded or unknown users", () => {
    expect(presenceFor(row(0), row(null), NOW)).toEqual({ isOnline: false });
    expect(presenceFor(undefined, row(1), NOW)).toEqual({ isOnline: false });
  });
});

describe("touchPresence", () => {
  it("writes at most once per interval per user", () => {
    touchPresence("u1", NOW);
    touchPresence("u1", NOW + 1_000);
    touchPresence("u2", NOW + 1_000);
    touchPresence("u1", NOW + TOUCH_INTERVAL_MS);
    expect(updates).toHaveLength(3);
  });
});
