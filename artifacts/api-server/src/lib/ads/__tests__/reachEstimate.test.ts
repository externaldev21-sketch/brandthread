/**
 * Budget-true reach estimate (lib/ads/reachEstimate.ts). The mobile copy
 * (artifacts/mobile/services/adReach.ts) asserts the same figures in
 * services/__tests__/adReach.test.ts so the two can't drift apart.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUDIENCE_FLOOR_DAILY_ACTIVE, DEFAULT_AUDIENCE_FLOOR_TOTAL, estimateCampaignReach, reachConfig,
  reachablePool, resolveAudience, type ReachModel,
} from "../reachEstimate";

const floor = { total: DEFAULT_AUDIENCE_FLOOR_TOTAL, dailyActive: DEFAULT_AUDIENCE_FLOOR_DAILY_ACTIVE };
const model: ReachModel = { cpmCents: 2000, audience: resolveAudience({ total: 12, dailyActive: 3 }, floor) };
const reach = (dailyDollars: number, days: number, m: ReachModel = model) =>
  estimateCampaignReach({ totalBudgetCents: dailyDollars * 100 * days, durationDays: days, model: m });

describe("estimateCampaignReach", () => {
  it("$130/day for 25 days reaches far more people than $130/day for 2 days (same figures as the app)", () => {
    expect(reach(130, 2)).toMatchObject({ low: 5069, high: 6550, impressions: 13_000 });
    expect(reach(130, 25)).toMatchObject({ low: 20_935, high: 24_673, impressions: 162_500 });
  });

  it("soft-caps at the reachable pool (diminishing returns, never linear forever)", () => {
    const r = reach(1000, 30);
    expect(r.high).toBeLessThanOrEqual(r.reachablePool);
    expect(reach(1000, 10).high / reach(100, 10).high).toBeLessThan(1.5);
  });

  it("is monotonic in both total budget and days", () => {
    expect(reach(50, 8).high).toBeGreaterThan(reach(50, 7).high);
    expect(reach(60, 7).high).toBeGreaterThan(reach(50, 7).high);
  });
});

describe("audience", () => {
  it("uses the honest floor when the measured base is small, and says so", () => {
    expect(resolveAudience({ total: 12, dailyActive: 3 }, floor)).toEqual({ ...floor, source: "floor" });
  });

  it("uses the measured base once it is big enough", () => {
    expect(resolveAudience({ total: 90_000, dailyActive: 21_000 }, floor)).toEqual({ total: 90_000, dailyActive: 21_000, source: "measured" });
    expect(resolveAudience({ total: 90_000, dailyActive: 0 }, floor).dailyActive).toBe(1);
  });

  it("a longer flight reaches a bigger pool of people who open the app", () => {
    expect(reachablePool(floor, 2)).toBeLessThan(reachablePool(floor, 25));
    expect(reachablePool(floor, 25)).toBeLessThanOrEqual(floor.total);
  });

  it("platform constants are configurable", () => {
    expect(reachConfig({ AD_EFFECTIVE_CPM_CENTS: "1500", AD_AUDIENCE_FLOOR_TOTAL: "5000" } as NodeJS.ProcessEnv))
      .toEqual({ cpmCents: 1500, floorTotal: 5000, floorDailyActive: DEFAULT_AUDIENCE_FLOOR_DAILY_ACTIVE });
    expect(reachConfig({ AD_EFFECTIVE_CPM_CENTS: "nope" } as NodeJS.ProcessEnv).cpmCents).toBe(2000);
  });
});
