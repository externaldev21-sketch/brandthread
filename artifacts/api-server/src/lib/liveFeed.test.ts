import { describe, expect, it } from "vitest";
import { rankLiveFeed, type LiveFeedRow } from "./liveFeed";

function row(id: string, viewers: number, opts: { followed?: boolean; startedAt?: string } = {}): LiveFeedRow {
  return {
    id,
    seller_id: `seller_${id}`,
    viewer_count: viewers,
    started_at: opts.startedAt ?? "2026-09-01T10:00:00Z",
    followed: opts.followed ?? false,
  };
}

describe("rankLiveFeed (GET /api/live/feed ordering)", () => {
  it("puts followed creators first, then orders by viewer count", () => {
    const ranked = rankLiveFeed([
      row("a", 5000),
      row("b", 40, { followed: true }),
      row("c", 900),
      row("d", 1200, { followed: true }),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["d", "b", "a", "c"]);
  });

  it("breaks viewer-count ties by the longest-running stream, then id", () => {
    const ranked = rankLiveFeed([
      row("z", 100, { startedAt: "2026-09-01T10:05:00Z" }),
      row("y", 100, { startedAt: "2026-09-01T10:00:00Z" }),
      row("x", 100, { startedAt: "2026-09-01T10:05:00Z" }),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["y", "x", "z"]);
  });

  it("treats string/null viewer counts from the driver as numbers", () => {
    const ranked = rankLiveFeed([
      { ...row("a", 0), viewer_count: "12" },
      { ...row("b", 0), viewer_count: null },
      { ...row("c", 0), viewer_count: "300" },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("caps the list and does not mutate the input", () => {
    const input = [row("a", 1), row("b", 2), row("c", 3)];
    const copy = [...input];
    expect(rankLiveFeed(input, 2).map((r) => r.id)).toEqual(["c", "b"]);
    expect(input).toEqual(copy);
  });

  it("handles an empty list", () => {
    expect(rankLiveFeed([])).toEqual([]);
  });
});
