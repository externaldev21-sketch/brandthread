import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  REPLAY_SHOPPABLE_DAYS,
  canViewReplay,
  isReplayExpired,
  replayExpiresAt,
  normalizeVisibility,
  replayDurationSeconds,
  shapeReplay,
  type ReplayRow,
} from "../liveReplayAccess";

const base: ReplayRow = {
  id: "11111111-1111-1111-1111-111111111111",
  seller_id: "seller_1",
  title: "Fall drop",
  replay_url: "https://cdn.example/replay.mp4",
  replay_post_id: "22222222-2222-2222-2222-222222222222",
  replay_visibility: "public",
  replay_deleted_at: null,
  started_at: "2026-09-01T10:00:00.000Z",
  ended_at: "2026-09-01T10:30:00.000Z",
  post_status: "published",
  post_moderation_status: "visible",
};

// The fixture live ended 2026-09-01; pin "now" to the day after so the
// 7-day shoppable window doesn't make these rules depend on the real date.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-02T00:00:00.000Z"));
});
afterAll(() => { vi.useRealTimers(); });

describe("canViewReplay", () => {
  it("shows a public replay to anyone, including signed-out visitors", () => {
    expect(canViewReplay(null, base)).toBe(true);
    expect(canViewReplay("buyer_1", base)).toBe(true);
  });

  it("never shows a replay that has no confirmed recording", () => {
    expect(canViewReplay("seller_1", { ...base, replay_url: null })).toBe(false);
    expect(canViewReplay("seller_1", { ...base, replay_post_id: null })).toBe(false);
  });

  it("hides a hidden replay from everyone but its owner", () => {
    const hidden = { ...base, replay_visibility: "hidden" };
    expect(canViewReplay(null, hidden)).toBe(false);
    expect(canViewReplay("buyer_1", hidden)).toBe(false);
    expect(canViewReplay("seller_1", hidden)).toBe(true);
  });

  it("hides a deleted replay from everyone, owner included", () => {
    const deleted = { ...base, replay_deleted_at: "2026-09-02T00:00:00.000Z" };
    expect(canViewReplay("seller_1", deleted)).toBe(false);
    expect(canViewReplay("buyer_1", deleted)).toBe(false);
  });

  it("hides a replay whose post was archived or moderated from non-owners", () => {
    expect(canViewReplay("buyer_1", { ...base, post_status: "archived" })).toBe(false);
    expect(canViewReplay("buyer_1", { ...base, post_moderation_status: "removed" })).toBe(false);
    expect(canViewReplay("buyer_1", { ...base, post_moderation_status: "held" })).toBe(false);
  });

  it("hides from a viewer with a block either way, but not from the owner", () => {
    expect(canViewReplay("buyer_1", base, { blocked: true })).toBe(false);
    expect(canViewReplay("seller_1", base, { blocked: true })).toBe(true);
  });
});

describe("shapeReplay", () => {
  it("only tells the owner the visibility", () => {
    const hidden = { ...base, replay_visibility: "hidden" };
    expect(shapeReplay(hidden, "seller_1")).toMatchObject({ isOwner: true, visibility: "hidden" });
    const visitor = shapeReplay(base, "buyer_1");
    expect(visitor.isOwner).toBe(false);
    expect("visibility" in visitor).toBe(false);
  });

  it("derives duration from start/end and never invents one", () => {
    expect(replayDurationSeconds(base)).toBe(1800);
    expect(replayDurationSeconds({ started_at: null, ended_at: base.ended_at })).toBeNull();
    expect(replayDurationSeconds({ started_at: base.ended_at, ended_at: base.started_at })).toBeNull();
  });
});

describe("normalizeVisibility", () => {
  it("accepts only public/hidden", () => {
    expect(normalizeVisibility("public")).toBe("public");
    expect(normalizeVisibility("hidden")).toBe("hidden");
    expect(normalizeVisibility("private")).toBeNull();
    expect(normalizeVisibility(undefined)).toBeNull();
  });
});

describe("7-day shoppable replays", () => {
  it("expires REPLAY_SHOPPABLE_DAYS after the live ended", () => {
    expect(REPLAY_SHOPPABLE_DAYS).toBe(7);
    expect(replayExpiresAt(base)?.toISOString()).toBe("2026-09-08T10:30:00.000Z");
    expect(isReplayExpired(base, new Date("2026-09-08T10:29:59.000Z"))).toBe(false);
    expect(isReplayExpired(base, new Date("2026-09-08T10:30:00.000Z"))).toBe(true);
    expect(replayExpiresAt({ ended_at: null })).toBeNull();
  });

  it("hides an expired replay from visitors but keeps it for the owner, marked expired", () => {
    const later = new Date("2026-09-10T00:00:00.000Z");
    expect(canViewReplay("buyer_1", base, { now: later })).toBe(false);
    expect(canViewReplay(null, base, { now: later })).toBe(false);
    expect(canViewReplay("seller_1", base, { now: later })).toBe(true);
    expect(shapeReplay(base, "seller_1", later)).toMatchObject({ expired: true, expiresAt: "2026-09-08T10:30:00.000Z" });
    expect(shapeReplay(base, "buyer_1")).toMatchObject({ expired: false });
  });
});
