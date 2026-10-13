import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for the fx_rates table.
const table = new Map<string, { baseCurrency: string; currency: string; rate: string; rateDate: string | null; fetchedAt: Date }>();
vi.mock("@workspace/db", () => ({
  fxRates: { baseCurrency: "base_currency", currency: "currency" },
  db: {
    select: () => ({ from: () => ({ where: async () => [...table.values()] }) }),
    insert: () => ({
      values: (row: any) => ({
        onConflictDoUpdate: async () => { table.set(row.currency, row); },
      }),
    }),
  },
}));

const { getFxRates, parseFxFeed, resetFxCacheForTests } = await import("../fxRates");

const FEED = { amount: 1, base: "USD", date: "2026-10-12", rates: { EUR: 0.9187, GBP: 0.7702, JPY: 149.36, bad: 3, NEG: -1 } };
const ON = { FX_RATES_ENABLED: "true" };

beforeEach(() => {
  table.clear();
  resetFxCacheForTests();
});

describe("FX rates (display only)", () => {
  it("parses the ECB/Frankfurter feed and drops junk", () => {
    const snap = parseFxFeed(FEED, new Date("2026-10-13T00:00:00Z"))!;
    expect(snap.rates).toEqual({ USD: 1, EUR: 0.9187, GBP: 0.7702, JPY: 149.36 });
    expect(snap.date).toBe("2026-10-12");
    expect(parseFxFeed({ base: "EUR", rates: { USD: 1.1 } })).toBeNull();
    expect(parseFxFeed({})).toBeNull();
  });

  it("returns null with the flag off and never fetches", async () => {
    const fetchImpl = vi.fn();
    expect(await getFxRates({ env: {}, fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches once, then serves memory for 12 hours, then refetches", async () => {
    let now = new Date("2026-10-13T00:00:00Z");
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => FEED }));
    const first = await getFxRates({ env: ON, fetchImpl, now: () => now });
    expect(first?.rates.EUR).toBe(0.9187);
    expect(table.size).toBe(4); // persisted
    now = new Date(now.getTime() + 11 * 3600 * 1000);
    await getFxRates({ env: ON, fetchImpl, now: () => now });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now = new Date(now.getTime() + 2 * 3600 * 1000);
    await getFxRates({ env: ON, fetchImpl, now: () => now });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("uses FX_RATES_URL and falls back to stored rates when the feed is down", async () => {
    const ok = vi.fn(async () => ({ ok: true, status: 200, json: async () => FEED }));
    await getFxRates({ env: { ...ON, FX_RATES_URL: "https://fx.example/latest" }, fetchImpl: ok, now: () => new Date("2026-10-01T00:00:00Z") });
    expect((ok.mock.calls[0] as unknown[])[0]).toBe("https://fx.example/latest");
    resetFxCacheForTests();
    const down = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const snap = await getFxRates({ env: ON, fetchImpl: down, now: () => new Date("2026-10-13T00:00:00Z") });
    expect(down).toHaveBeenCalledTimes(1);
    expect(snap?.rates.GBP).toBe(0.7702);
  });

  it("returns null when there is no feed and nothing stored", async () => {
    const down = vi.fn(async () => { throw new Error("offline"); });
    expect(await getFxRates({ env: ON, fetchImpl: down })).toBeNull();
  });
});
