import { describe, expect, it } from "vitest";
import { MAX_PINS, pinnedAtIso, planPin } from "./postPins";

const at = (h: number) => new Date(Date.UTC(2026, 9, 1, h));

describe("planPin", () => {
  const three = [
    { postId: "b", pinnedAt: at(2) },
    { postId: "a", pinnedAt: at(1) },
    { postId: "c", pinnedAt: at(3) },
  ];

  it("caps at 3", () => expect(MAX_PINS).toBe(3));

  it("inserts under the cap and is a no-op when already pinned", () => {
    expect(planPin([], "x", false)).toEqual({ action: "insert" });
    expect(planPin(three.slice(0, 2), "x", false)).toEqual({ action: "insert" });
    expect(planPin(three, "a", false)).toEqual({ action: "already" });
  });

  it("at the cap reports the pins oldest first, or replaces the oldest when confirmed", () => {
    expect(planPin(three, "x", false)).toEqual({ action: "limit", pinned: ["a", "b", "c"] });
    expect(planPin(three, "x", true)).toEqual({ action: "replace", removePostId: "a" });
  });

  it("breaks pinned_at ties by post id so the choice is stable", () => {
    expect(planPin([{ postId: "z", pinnedAt: at(1) }, { postId: "y", pinnedAt: at(1) }, { postId: "w", pinnedAt: at(2) }], "x", true))
      .toEqual({ action: "replace", removePostId: "y" });
  });
});

describe("pinnedAtIso", () => {
  it("normalises dates and raw strings, null otherwise", () => {
    expect(pinnedAtIso(at(1))).toBe("2026-10-01T01:00:00.000Z");
    expect(pinnedAtIso("2026-10-01 01:00:00+00")).toBe("2026-10-01T01:00:00.000Z");
    expect(pinnedAtIso(null)).toBeNull();
    expect(pinnedAtIso("garbage")).toBeNull();
  });
});
