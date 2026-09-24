/**
 * GET /api/public/discover/feed — DB-mocked coverage.
 *
 * This environment has no reachable Postgres superuser for provisioning a
 * disposable integration-test database (the sandboxed worktree blocks the
 * su/sudo needed to create a role/db as the `postgres` OS user), so per the
 * task's documented fallback this asserts against a fully mocked `db`
 * object instead of a real one — same approach already used elsewhere in
 * this package (see jobs/__tests__/teamInviteReminder.test.ts,
 * routes/__tests__/post-slide-validation.test.ts). It still boots a real
 * express() app and exercises the real route handler and pagination math;
 * only the `@workspace/db` table reads are stubbed.
 *
 * Covers:
 *  - cache hit: pagination (limit/offset/nextOffset), rank recalculated
 *    per-offset, `source: "cache"`.
 *  - cache miss: synchronous recompute is triggered exactly once (dedup via
 *    the module-level in-flight promise) and the freshly-written row is
 *    served with `source: "computed"`.
 *  - genuinely empty result: `source: "empty"`, `nextOffset: null`.
 *  - validation: limit above 50 is rejected.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

function mkItem(rank: number, brandId: string) {
  return {
    rank,
    productId: `product-${rank}`,
    brandId,
    brandName: `Brand ${rank}`,
    brandVerified: rank % 2 === 0,
    productName: `Product ${rank}`,
    priceCents: 1000 + rank,
    compareAtPriceCents: null,
    images: [`https://cdn.test/${rank}.jpg`],
    category: "apparel",
    sellerScore: 10 - rank * 0.1,
  };
}

const state = vi.hoisted(() => ({
  cachedRow: null as null | { computedAt: Date; results: unknown[]; itemCount: number },
  computeCalls: 0,
  freshRowAfterCompute: null as null | { computedAt: Date; results: unknown[]; itemCount: number },
  selectCallCount: 0,
}));

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  return {
    ...actual,
    db: {
      ...actual.db,
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              state.selectCallCount += 1;
              // First select-of-the-request is the initial cache read; a
              // second one (only reached on cache miss) reads the row the
              // synchronous recompute just wrote.
              const row = state.selectCallCount % 2 === 1 ? state.cachedRow : state.freshRowAfterCompute;
              return row ? [row] : [];
            },
          }),
        }),
      }),
    },
  };
});

vi.mock("../../jobs/computeSellerRanking", async () => {
  const actual = await vi.importActual<typeof import("../../jobs/computeSellerRanking")>("../../jobs/computeSellerRanking");
  return {
    ...actual,
    computeSellerRankingForToday: async () => {
      state.computeCalls += 1;
    },
  };
});

let server: Server;
let base = "";

beforeAll(async () => {
  const { default: publicRouter } = await import("../public");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
    next();
  });
  app.use("/api/public", publicRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.cachedRow = null;
  state.freshRowAfterCompute = null;
  state.computeCalls = 0;
  state.selectCallCount = 0;
});

describe("GET /api/public/discover/feed", () => {
  it("serves a fresh cache hit, paginated, with recalculated ranks", async () => {
    const items = [1, 2, 3, 4, 5].map((i) => mkItem(i, `brand-${i}`));
    state.cachedRow = { computedAt: new Date(), results: items, itemCount: items.length };

    const res = await fetch(`${base}/api/public/discover/feed?limit=2&offset=1`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.source).toBe("cache");
    expect(body.items).toHaveLength(2);
    // offset=1 -> items[1], items[2] (original ranks 2, 3), re-ranked from the offset
    expect(body.items[0]).toMatchObject({ rank: 2, productId: "product-2" });
    expect(body.items[1]).toMatchObject({ rank: 3, productId: "product-3" });
    expect(body.nextOffset).toBe(3);
    expect(state.computeCalls).toBe(0);
  });

  it("returns nextOffset null when the page reaches the end of the list", async () => {
    const items = [1, 2, 3].map((i) => mkItem(i, `brand-${i}`));
    state.cachedRow = { computedAt: new Date(), results: items, itemCount: items.length };

    const res = await fetch(`${base}/api/public/discover/feed?limit=10&offset=0`);
    const body = await res.json() as any;
    expect(body.items).toHaveLength(3);
    expect(body.nextOffset).toBeNull();
  });

  it("recomputes synchronously on a cache miss and serves the freshly written row", async () => {
    state.cachedRow = null; // nothing cached yet
    const fresh = [1, 2].map((i) => mkItem(i, `brand-${i}`));
    state.freshRowAfterCompute = { computedAt: new Date(), results: fresh, itemCount: fresh.length };

    const res = await fetch(`${base}/api/public/discover/feed?limit=20&offset=0`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.source).toBe("computed");
    expect(body.items).toHaveLength(2);
    expect(state.computeCalls).toBe(1);
  });

  it("serves an empty result when even a synchronous recompute finds nothing", async () => {
    state.cachedRow = null;
    state.freshRowAfterCompute = null;

    const res = await fetch(`${base}/api/public/discover/feed`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.source).toBe("empty");
    expect(body.items).toEqual([]);
    expect(body.nextOffset).toBeNull();
  });

  it("rejects a limit above 50", async () => {
    const res = await fetch(`${base}/api/public/discover/feed?limit=51`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).code).toBe("VALIDATION_ERROR");
  });

  it("rejects a negative offset", async () => {
    const res = await fetch(`${base}/api/public/discover/feed?offset=-1`);
    expect(res.status).toBe(400);
  });
});
