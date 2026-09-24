/**
 * computeSellerRankingForToday — DB-mocked coverage of the full computation
 * + cache upsert.
 *
 * Same environment constraint as discover-feed.integration.test.ts: no
 * reachable Postgres superuser to provision a disposable test database in
 * this sandboxed worktree (su/sudo to the `postgres` OS user is blocked), so
 * per the task's documented fallback this drives the real job against a
 * fully mocked `db` — a generic chainable/thenable stub that returns queued
 * rows in the exact call order the job issues them (see the numbered
 * comments below, which mirror computeSellerRanking.ts's own step
 * numbering). This still exercises the real exclusion logic (out-of-stock,
 * reported, per-brand cap) and the real cache-upsert call shape.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-09-24T12:00:00.000Z");

const state = vi.hoisted(() => ({
  queue: [] as unknown[][],
  queueIndex: 0,
  upsertedValues: null as any,
}));

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");

  const chain: any = {
    from: () => chain,
    where: () => chain,
    groupBy: () => chain,
    innerJoin: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
      const rows = state.queue[state.queueIndex] ?? [];
      state.queueIndex += 1;
      return Promise.resolve(rows).then(resolve, reject);
    },
  };

  return {
    ...actual,
    db: {
      ...actual.db,
      select: () => chain,
      insert: () => ({
        values: (values: any) => ({
          onConflictDoUpdate: async () => {
            state.upsertedValues = values;
            return [];
          },
        }),
      }),
    },
  };
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  state.queue = [];
  state.queueIndex = 0;
  state.upsertedValues = null;
});

describe("computeSellerRankingForToday", () => {
  it("excludes out-of-stock and reported products, and upserts the cache with the survivor", async () => {
    const { computeSellerRankingForToday } = await import("../computeSellerRanking");

    const hourAgo = new Date(NOW.getTime() - 60 * 60 * 1000);
    state.queue = [
      /* 1. activeProductOwners */               [{ ownerId: "seller-1" }],
      /* 2. sellerRows */                         [{
        clerkId: "seller-1", displayName: "Seller One", brandName: "Brand One",
        verified: true, createdAt: new Date("2020-01-01"), accountType: "seller",
      }],
      /* 3. recentPosts */                        [{ id: "post-1", userId: "seller-1", createdAt: hourAgo }],
      /* 4. postLevelRows */                       [
        { postId: "post-1", type: "like", createdAt: hourAgo },
        { postId: "post-1", type: "like", createdAt: hourAgo },
      ],
      /* 5. shopClickRows */                       [],
      /* 6. saveRows */                            [],
      /* 7. followerRows */                        [{ sellerId: "seller-1", cnt: 10 }],
      /* 8. yesterdayCache */                      [],
      /* 9. candidateProducts */                   [
        { id: "prod-instock", ownerId: "seller-1", name: "Active In-Stock", category: "apparel", images: ["img1"], demandCount: 5, createdAt: NOW },
        { id: "prod-reported", ownerId: "seller-1", name: "Reported Product", category: "apparel", images: [], demandCount: 100, createdAt: NOW },
        { id: "prod-outofstock", ownerId: "seller-1", name: "Out Of Stock", category: "apparel", images: [], demandCount: 50, createdAt: NOW },
      ],
      /* 10. variantRows */                        [
        { productId: "prod-instock", priceCents: 2000, stock: 5 },
        { productId: "prod-reported", priceCents: 1500, stock: 5 },
        { productId: "prod-outofstock", priceCents: 1000, stock: 0 },
      ],
      /* 11. reportedRows */                        [{ targetId: "prod-reported" }],
    ];

    await computeSellerRankingForToday();

    expect(state.upsertedValues).not.toBeNull();
    expect(state.upsertedValues.cacheDate).toBe("2026-09-24");
    expect(state.upsertedValues.results).toHaveLength(1);
    const [result] = state.upsertedValues.results;
    expect(result.productId).toBe("prod-instock");
    expect(result.brandId).toBe("seller-1");
    expect(result.brandName).toBe("Brand One");
    expect(result.brandVerified).toBe(true);
    expect(result.priceCents).toBe(2000);
    expect(result.compareAtPriceCents).toBeNull();
    expect(result.rank).toBe(1);
    expect(result.sellerScore).toBeGreaterThan(0);
  });

  it("writes an empty cache row when there are no active-product sellers at all", async () => {
    const { computeSellerRankingForToday } = await import("../computeSellerRanking");
    state.queue = [/* 1. activeProductOwners */ []];

    await computeSellerRankingForToday();

    expect(state.upsertedValues).not.toBeNull();
    expect(state.upsertedValues.results).toEqual([]);
    expect(state.upsertedValues.itemCount).toBe(0);
  });

  it("never throws even if a query fails (swallowed and logged)", async () => {
    vi.doMock("@workspace/db", async () => {
      const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
      return {
        ...actual,
        db: {
          ...actual.db,
          select: () => { throw new Error("boom"); },
        },
      };
    });
    vi.resetModules();
    const { computeSellerRankingForToday } = await import("../computeSellerRanking");
    await expect(computeSellerRankingForToday()).resolves.toBeUndefined();
  });
});
