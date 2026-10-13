import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", async () => ({ ...(await import("@workspace/db/schema")), db: {}, pool: {} }));

import { PRICE_HISTORY_DAYS, windowPriceHistory } from "./priceHistory";

const NOW = new Date("2026-10-13T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe("windowPriceHistory", () => {
  it("is unchanged with no history", () => {
    expect(windowPriceHistory([], NOW)).toEqual({ changed: false, points: [] });
  });

  it("is unchanged when the only change was before the window", () => {
    const rows = [{ priceCents: 5000, recordedAt: daysAgo(200) }, { priceCents: 4000, recordedAt: daysAgo(120) }];
    expect(windowPriceHistory(rows, NOW)).toEqual({ changed: false, points: [] });
  });

  it("carries the price in effect to the window start, then the changes", () => {
    const rows = [
      { priceCents: 22000, recordedAt: daysAgo(150) },
      { priceCents: 19000, recordedAt: daysAgo(30) },
      { priceCents: 17500, recordedAt: daysAgo(5) },
    ];
    const out = windowPriceHistory(rows, NOW);
    expect(out.changed).toBe(true);
    expect(out.points.map((p) => p.priceCents)).toEqual([22000, 19000, 17500]);
    expect(out.points[0].at).toBe(daysAgo(PRICE_HISTORY_DAYS).toISOString());
  });

  it("counts a product created inside the window that has since changed", () => {
    const rows = [{ priceCents: 4000, recordedAt: daysAgo(10) }, { priceCents: 3000, recordedAt: daysAgo(2) }];
    const out = windowPriceHistory(rows, NOW);
    expect(out.changed).toBe(true);
    expect(out.points).toHaveLength(2);
  });

  it("is unchanged when a price went down and back to the same value only once in view", () => {
    // Single in-window row equal to the carried price is not a visible change.
    const rows = [{ priceCents: 4000, recordedAt: daysAgo(100) }, { priceCents: 4000, recordedAt: daysAgo(3) }];
    expect(windowPriceHistory(rows, NOW).changed).toBe(false);
  });

  it("ignores rows stamped in the future", () => {
    const rows = [{ priceCents: 4000, recordedAt: daysAgo(100) }, { priceCents: 3000, recordedAt: new Date(NOW.getTime() + 60_000) }];
    expect(windowPriceHistory(rows, NOW).changed).toBe(false);
  });
});
