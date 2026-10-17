import { describe, expect, it } from "vitest";
import { parseDeliveryEstimate } from "./metaGraph";
import { dailySpendCentsFor } from "../routes/meta-ads";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const curve = {
  estimate_ready: true,
  estimate_mau_lower_bound: 1_200_000,
  estimate_mau_upper_bound: 1_400_000,
  daily_outcomes_curve: [
    { spend: 0, reach: 0 },
    { spend: 1_000, reach: 2_000 },
    { spend: 3_000, reach: 5_000 },
  ],
};

describe("parseDeliveryEstimate", () => {
  it("reads reach off Meta's own curve at the daily spend", () => {
    expect(parseDeliveryEstimate(curve, 1_000).dailyReach).toBe(2_000);
    expect(parseDeliveryEstimate(curve, 2_000).dailyReach).toBe(3_500);
    expect(parseDeliveryEstimate(curve, 9_000).dailyReach).toBe(5_000); // capped at Meta's last point
    const e = parseDeliveryEstimate(curve, 500);
    expect(e.dailyReach).toBe(1_000);
    expect(e.audienceSizeLower).toBe(1_200_000);
    expect(e.audienceSizeUpper).toBe(1_400_000);
  });
  it("reports no reach (never a made-up one) when Meta returns no curve", () => {
    const e = parseDeliveryEstimate({ estimate_ready: false }, 1_000);
    expect(e.ready).toBe(false);
    expect(e.dailyReach).toBeNull();
    expect(e.audienceSizeLower).toBeNull();
  });
});

describe("dailySpendCentsFor", () => {
  it("uses a daily budget as-is and spreads a lifetime budget over its days", () => {
    expect(dailySpendCentsFor({ budgetType: "daily", budgetCents: 2_000, startTime: null, endTime: null })).toBe(2_000);
    const start = new Date("2026-10-01T00:00:00Z");
    const end = new Date("2026-10-11T00:00:00Z");
    expect(dailySpendCentsFor({ budgetType: "lifetime", budgetCents: 10_000, startTime: start, endTime: end })).toBe(1_000);
    expect(dailySpendCentsFor({ budgetType: "lifetime", budgetCents: 10_000, startTime: null, endTime: null })).toBe(10_000);
  });
});

describe("meta-ads route", () => {
  it("no longer ships the fixed $1 = 40–90 people formula", () => {
    const src = readFileSync(resolve(__dirname, "../routes/meta-ads.ts"), "utf8");
    expect(src).not.toMatch(/dollars \* 40|dollars \* 90/);
    expect(src).toContain('router.get("/campaigns/:id/reach-estimate"');
  });
});
