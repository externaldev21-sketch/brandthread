import { describe, expect, it } from "vitest";
import {
  DEFAULT_REWARDS_POLICY, budgetPeriodStart, monthlyRewardsBudgetCents, rewardsPolicy,
} from "../rewardsConfig";
import { replayLots } from "../lots";
import { isExpiringCredit } from "../rules";

describe("rewardsPolicy", () => {
  it("fails closed with nothing set: earning off, 90-day expiry, tight caps", () => {
    expect(rewardsPolicy({})).toEqual(DEFAULT_REWARDS_POLICY);
    expect(DEFAULT_REWARDS_POLICY).toMatchObject({
      earnEnabled: false,
      earnWithoutCheckoutSpend: false,
      rewardExpiryDays: 90,
      deviceMaxAccountsPerDay: 1,
      sendMinAccountAgeDays: 7,
    });
  });

  it("only an exact 'true' turns earning on", () => {
    expect(rewardsPolicy({ THREAD_CASH_EARN_ENABLED: "true" }).earnEnabled).toBe(true);
    expect(rewardsPolicy({ THREAD_CASH_EARN_ENABLED: " TRUE " }).earnEnabled).toBe(true);
    expect(rewardsPolicy({ THREAD_CASH_EARN_ENABLED: "1" }).earnEnabled).toBe(false);
    expect(rewardsPolicy({ THREAD_CASH_EARN_ENABLED: "yes" }).earnEnabled).toBe(false);
  });

  it("ignores out-of-range or garbage numbers instead of crashing", () => {
    const policy = rewardsPolicy({
      THREAD_CASH_REWARD_EXPIRY_DAYS: "0",
      THREAD_CASH_DEVICE_MAX_ACCOUNTS_PER_DAY: "50",
      THREAD_CASH_REWARDS_BUDGET_BPS_OF_GMV: "abc",
      THREAD_CASH_REWARDS_MONTHLY_CAP_CENTS: "-5",
    });
    expect(policy.rewardExpiryDays).toBe(90);
    expect(policy.deviceMaxAccountsPerDay).toBe(1);
    expect(policy.budgetBpsOfGmv).toBe(100);
    expect(policy.monthlyCapCents).toBe(50_000);
    expect(rewardsPolicy({ THREAD_CASH_REWARD_EXPIRY_DAYS: "60" }).rewardExpiryDays).toBe(60);
  });
});

describe("monthlyRewardsBudgetCents", () => {
  const policy = { ...DEFAULT_REWARDS_POLICY, budgetBpsOfGmv: 100, monthlyCapCents: 50_000 };

  it("is bps of trailing GMV, never above the absolute cap", () => {
    expect(monthlyRewardsBudgetCents(1_000_000, policy)).toBe(10_000); // 1% of $10k
    expect(monthlyRewardsBudgetCents(100_000_000, policy)).toBe(50_000); // capped at $500
  });

  it("is zero with no GMV", () => {
    expect(monthlyRewardsBudgetCents(0, policy)).toBe(0);
    expect(monthlyRewardsBudgetCents(-10, policy)).toBe(0);
  });

  it("the period is the UTC calendar month", () => {
    expect(budgetPeriodStart(new Date("2026-10-09T23:59:00-07:00")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("expiry by funding", () => {
  it("paid funds never expire; promo always does, whatever the source", () => {
    expect(isExpiringCredit("live_gift", "paid")).toBe(false);
    expect(isExpiringCredit("live_gift", "promo")).toBe(true);
    expect(isExpiringCredit("send_received", "promo")).toBe(true);
    // Without a funding the old source rule applies.
    expect(isExpiringCredit("live_gift")).toBe(false);
    expect(isExpiringCredit("daily_checkin")).toBe(true);
  });

  it("replayLots gives paid lots no expiry", () => {
    const at = new Date("2026-01-01T00:00:00Z");
    const lots = replayLots([
      { id: "a", amountCents: 100, source: "live_gift", referenceId: null, createdAt: at, funding: "paid" },
      { id: "b", amountCents: 100, source: "live_gift", referenceId: null, createdAt: at, funding: "promo" },
    ], 90);
    expect(lots.find((l) => l.entryId === "a")?.expiresAt).toBeNull();
    expect(lots.find((l) => l.entryId === "b")?.expiresAt?.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });
});
