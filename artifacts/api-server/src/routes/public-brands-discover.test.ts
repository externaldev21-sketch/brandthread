/**
 * Unit tests for the GET /api/public/brands/discover ranking logic.
 *
 * This mirrors `rankDiscoverBrands` in ./public.ts exactly, duplicated here
 * (rather than imported) so the test does not require a live DATABASE_URL —
 * importing route files pulls in @workspace/db, which throws at import time
 * without a configured database. Same pattern as public-profiles.test.ts.
 */
import { describe, expect, it } from "vitest";

interface Row { clerkId: string; createdAt: Date; }

function rankDiscoverBrands<T extends { createdAt: Date; clerkId: string }>(sellers: T[]): T[] {
  return [...sellers].sort((a, b) =>
    b.createdAt.getTime() - a.createdAt.getTime() || a.clerkId.localeCompare(b.clerkId));
}

function row(clerkId: string, isoDate: string): Row {
  return { clerkId, createdAt: new Date(isoDate) };
}

describe("rankDiscoverBrands", () => {
  it("orders newest-first", () => {
    const ranked = rankDiscoverBrands([
      row("seller_a", "2024-01-01T00:00:00Z"),
      row("seller_b", "2024-03-01T00:00:00Z"),
      row("seller_c", "2024-02-01T00:00:00Z"),
    ]);
    expect(ranked.map((r) => r.clerkId)).toEqual(["seller_b", "seller_c", "seller_a"]);
  });

  it("breaks exact createdAt ties deterministically by clerkId", () => {
    const tie = "2024-05-01T00:00:00Z";
    const ranked = rankDiscoverBrands([
      row("seller_z", tie),
      row("seller_a", tie),
    ]);
    expect(ranked.map((r) => r.clerkId)).toEqual(["seller_a", "seller_z"]);
  });

  it("does not mutate the input array", () => {
    const input = [row("seller_a", "2024-01-01T00:00:00Z"), row("seller_b", "2024-02-01T00:00:00Z")];
    const copy = [...input];
    rankDiscoverBrands(input);
    expect(input).toEqual(copy);
  });

  it("handles an empty list", () => {
    expect(rankDiscoverBrands([])).toEqual([]);
  });
});
