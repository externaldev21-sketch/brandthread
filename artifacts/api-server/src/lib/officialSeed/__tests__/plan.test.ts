import { describe, expect, it } from "vitest";
import { OFFICIAL_SEED_CONFIG, officialSeedPublicDefault, spacingForPool } from "../config";
import { officialPositions, planSeedPage, seedEligibility, type SeedCursor, type SeedPageRow } from "../plan";

const NOW = new Date("2026-10-15T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

const organic = (n: number, prefix = "r"): SeedPageRow[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, official: false }));
const officials = (n: number) => Array.from({ length: n }, (_, i) => `o${i + 1}`);
const fresh: SeedCursor = { position: 0, lastOfficialPosition: 0 };

function noBackToBack(items: { kind: string }[]): boolean {
  return items.every((item, i) => i === 0 || !(item.kind === "official" && items[i - 1].kind === "official"));
}

describe("spacingForPool", () => {
  it("grows the gap with the size of the real-post pool", () => {
    expect(spacingForPool(0)).toBe(3);
    expect(spacingForPool(49)).toBe(3);
    expect(spacingForPool(50)).toBe(6);
    expect(spacingForPool(199)).toBe(6);
    expect(spacingForPool(200)).toBe(12);
    expect(spacingForPool(999)).toBe(12);
  });

  it("stops seeding (normal ranking only) at 1,000+ real posts", () => {
    expect(spacingForPool(1_000)).toBeNull();
    expect(spacingForPool(25_000)).toBeNull();
  });

  it("reads its thresholds from config, never below 2", () => {
    expect(spacingForPool(5, [{ poolBelow: 10, every: 1 }])).toBe(2);
    expect(spacingForPool(5, [{ poolBelow: 10, every: 4 }])).toBe(4);
    expect(OFFICIAL_SEED_CONFIG.spacingTiers.every((t) => t.every >= 2)).toBe(true);
  });
});

describe("seedEligibility", () => {
  const base = { now: NOW, threadsViewed: 0, poolSize: 10, unseenCount: 10 };

  it("seeds a brand-new user at the pool's spacing", () => {
    expect(seedEligibility({ ...base, accountCreatedAt: daysAgo(0) })).toEqual({ eligible: true, every: 3 });
    expect(seedEligibility({ ...base, poolSize: 120, accountCreatedAt: daysAgo(2) })).toEqual({ eligible: true, every: 6 });
  });

  it("ends the window after 7 days or ~50 Threads viewed", () => {
    expect(seedEligibility({ ...base, accountCreatedAt: daysAgo(7) })).toMatchObject({ eligible: false, reason: "not_new_user" });
    expect(seedEligibility({ ...base, accountCreatedAt: daysAgo(1), threadsViewed: 50 })).toMatchObject({ eligible: false, reason: "threads_viewed" });
    expect(seedEligibility({ ...base, accountCreatedAt: null })).toMatchObject({ eligible: false });
  });

  it("stops once every official Thread has been seen or the pool is large", () => {
    expect(seedEligibility({ ...base, accountCreatedAt: daysAgo(1), unseenCount: 0 })).toMatchObject({ reason: "all_seen" });
    expect(seedEligibility({ ...base, accountCreatedAt: daysAgo(1), poolSize: 1_500 })).toMatchObject({ reason: "pool_large" });
  });
});

describe("planSeedPage", () => {
  it("puts the first official Thread in slot 1, then one every 3rd slot", () => {
    const plan = planSeedPage({ organic: organic(12), candidates: officials(3), cursor: fresh, every: 3 });
    expect(officialPositions(plan)).toEqual([1, 4, 7]);
    expect(plan.items.map((i) => i.id).slice(0, 7)).toEqual(["o1", "r1", "r2", "o2", "r3", "r4", "o3"]);
  });

  it("handles the full 10-video starter set until every one is placed", () => {
    const plan = planSeedPage({ organic: organic(40), candidates: officials(10), cursor: fresh, every: 3 });
    expect(officialPositions(plan)).toEqual([1, 4, 7, 10, 13, 16, 19, 22, 25, 28]);
    expect(new Set(plan.items.filter((i) => i.kind === "official").map((i) => i.id)).size).toBe(10);
    // After the starter set, the rest is pure organic.
    expect(plan.items.slice(28).every((i) => i.kind === "organic")).toBe(true);
  });

  it("spreads officials out as the pool grows", () => {
    const at6 = planSeedPage({ organic: organic(30), candidates: officials(10), cursor: fresh, every: spacingForPool(120)! });
    expect(officialPositions(at6)).toEqual([1, 7, 13, 19, 25, 31, 37]);
    const at12 = planSeedPage({ organic: organic(30), candidates: officials(10), cursor: fresh, every: spacingForPool(500)! });
    expect(officialPositions(at12)).toEqual([1, 13, 25]);
  });

  it("never repeats an official Thread, even if a candidate id is duplicated", () => {
    const plan = planSeedPage({ organic: organic(20), candidates: ["o1", "o1", "o2"], cursor: fresh, every: 3 });
    const ids = plan.items.filter((i) => i.kind === "official").map((i) => i.id);
    expect(ids).toEqual(["o1", "o2"]);
  });

  it("never puts two official posts back to back, even with no real posts", () => {
    const empty = planSeedPage({ organic: [], candidates: officials(10), cursor: fresh, every: 3, isLastPage: true });
    expect(empty.items).toEqual([{ kind: "official", id: "o1" }]);
    const tiny = planSeedPage({ organic: organic(2), candidates: officials(10), cursor: fresh, every: 3, isLastPage: true });
    expect(tiny.items.map((i) => i.id)).toEqual(["o1", "r1", "r2", "o2"]);
    expect(noBackToBack(tiny.items)).toBe(true);
  });

  it("removes unseen officials from the organic list (the planner places them)", () => {
    const rows: SeedPageRow[] = [{ id: "o2", official: true }, ...organic(6)];
    const plan = planSeedPage({ organic: rows, candidates: ["o1", "o2"], cursor: fresh, every: 3 });
    expect(plan.dropped).toEqual(["o2"]);
    expect(plan.items.filter((i) => i.id === "o2")).toHaveLength(1);
    expect(officialPositions(plan)).toEqual([1, 4]);
  });

  it("leaves seen officials to normal ranking but never adjacent to another official", () => {
    // "s1" and "s2" are official posts the viewer already saw: normal ranking keeps them.
    const rows: SeedPageRow[] = [
      { id: "s1", official: true }, { id: "s2", official: true }, ...organic(4),
    ];
    const plan = planSeedPage({ organic: rows, candidates: ["o1"], cursor: fresh, every: 3 });
    expect(noBackToBack(plan.items)).toBe(true);
    expect(plan.items[0]).toEqual({ kind: "official", id: "o1" });
    // s1 would follow o1 directly and s2 would follow s1 — both wait for normal ranking.
    expect(plan.dropped).toEqual(["s1", "s2"]);
  });

  it("carries spacing across pages via the cursor", () => {
    const page1 = planSeedPage({ organic: organic(5, "a"), candidates: officials(4), cursor: fresh, every: 3 });
    expect(officialPositions(page1)).toEqual([1, 4, 7]);
    expect(page1.cursor).toEqual({ position: 8, lastOfficialPosition: 7 });
    // o1–o3 were served on page 1, so the caller only passes o4.
    const page2 = planSeedPage({ organic: organic(5, "b"), candidates: ["o4"], cursor: page1.cursor, every: 3 });
    // Last official was slot 7, so the next is slot 10 = second item of page 2.
    expect(page2.items.map((i) => i.id)).toEqual(["b1", "o4", "b2", "b3", "b4", "b5"]);
    expect(page2.items[0].kind).toBe("organic");
  });

  it("is a no-op once every official has been seen", () => {
    const plan = planSeedPage({ organic: organic(6), candidates: [], cursor: fresh, every: 3 });
    expect(plan.items.every((i) => i.kind === "organic")).toBe(true);
    expect(plan.items).toHaveLength(6);
  });
});

describe("OFFICIAL_SEED_CONTENT_PUBLIC default", () => {
  it("is OFF in production and ON in development/staging unless set", () => {
    expect(officialSeedPublicDefault({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(false);
    expect(officialSeedPublicDefault({ APP_ENV: "production" } as NodeJS.ProcessEnv)).toBe(false);
    expect(officialSeedPublicDefault({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(true);
    expect(officialSeedPublicDefault({ APP_ENV: "staging", NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("follows an explicit env value", () => {
    expect(officialSeedPublicDefault({ NODE_ENV: "production", OFFICIAL_SEED_CONTENT_PUBLIC: "true" } as NodeJS.ProcessEnv)).toBe(true);
    expect(officialSeedPublicDefault({ NODE_ENV: "development", OFFICIAL_SEED_CONTENT_PUBLIC: "false" } as NodeJS.ProcessEnv)).toBe(false);
  });
});
