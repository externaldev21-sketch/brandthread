/**
 * AI credit ledger: plan tiers, one-month rollover (capped), spend order,
 * no per-user daily cap for Starter/Growth, Pro never blocked + hidden
 * fair-use / ceiling, global emergency cap, refunds, purchases, alerts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, like, sql } from "drizzle-orm";
import { aiCreditAccounts, aiCreditLedger, aiProUsage, aiSpendAlerts, aiSpendDaily, db } from "@workspace/db";

vi.mock("../../nativeEntitlements", () => ({
  getEffectiveEntitlement: vi.fn(async (id: string) => {
    if (id.includes("-pro-")) return { planId: "pro", provider: "revenuecat" };
    if (id.includes("-growth-")) return { planId: "growth", provider: "stripe" };
    if (id.includes("-starter-")) return { planId: "starter", provider: "stripe" };
    return { planId: "starter", provider: "none" };
  }),
}));

import { MONTHLY_ALLOWANCE, PLAN_CREDIT_POLICY, creditPolicyForPlan } from "../catalogue";
import {
  allowTextRequest, currentDay, debitCredits, getAccount, grantPurchasedCredits, listHistory, refundDebit,
} from "../ledger";
import { raiseSpendAlerts } from "../alerts";

const users: string[] = [];
const newUser = (tag: "free" | "starter" | "growth" | "pro" = "starter") => {
  const id = `ai-credits-test-${tag}-${crypto.randomUUID()}`;
  users.push(id);
  return id;
};
const acctRow = async (u: string) => (await db.select().from(aiCreditAccounts).where(eq(aiCreditAccounts.clerkUserId, u)))[0]!;
// A user whose id contains "-pro-" etc. selects the plan in the mock above.
const planUser = (plan: "free" | "starter" | "growth" | "pro") => newUser(plan);
const FEW_DAYS = (n: number) => new Date(Date.UTC(2031, 0, 10 + n));

beforeEach(() => {
  delete process.env.AI_GLOBAL_DAILY_CREDIT_CAP;
  delete process.env.AI_PRO_FAIR_USE_CREDITS;
  delete process.env.AI_PRO_DAILY_GENERATION_CEILING;
  delete process.env.AI_TEXT_DAILY_LIMIT_PER_USER;
});

afterEach(async () => {
  if (users.length) {
    await db.delete(aiCreditLedger).where(inArray(aiCreditLedger.clerkUserId, users));
    await db.delete(aiCreditAccounts).where(inArray(aiCreditAccounts.clerkUserId, users));
    await db.delete(aiProUsage).where(inArray(aiProUsage.clerkUserId, users));
    await db.delete(aiSpendDaily).where(like(aiSpendDaily.clerkUserId, "%ai-credits-test-%"));
    await db.delete(aiSpendAlerts).where(sql`scope LIKE 'user:ai-credits-test-%'`);
    users.length = 0;
  }
  await db.execute(sql`DELETE FROM ai_spend_daily WHERE clerk_user_id = '*'`);
  await db.execute(sql`DELETE FROM ai_spend_alerts WHERE scope = 'global' AND day = ${currentDay()}`);
});

describe("plan policy", () => {
  it("ties allowances to the plan", () => {
    expect(PLAN_CREDIT_POLICY.starter.monthlyAllowance).toBe(1000);
    expect(PLAN_CREDIT_POLICY.growth.monthlyAllowance).toBe(4000);
    expect(PLAN_CREDIT_POLICY.pro.monthlyAllowance).toBeNull();
    expect(PLAN_CREDIT_POLICY.free.monthlyAllowance).toBe(0);
    expect(MONTHLY_ALLOWANCE.growth).toBe(creditPolicyForPlan("growth").monthlyAllowance);
  });

  it("grants Starter and Growth their allowance and records it", async () => {
    const s = newUser("starter");
    const g = newUser("growth");
    expect(await getAccount(s)).toMatchObject({ plan: "starter", unlimited: false, balance: 1000, monthlyAllowance: 1000, packsEligible: true });
    expect(await getAccount(g)).toMatchObject({ plan: "growth", balance: 4000, lowCreditsThreshold: 800, isLow: false });
    expect((await listHistory(s)).entries.map((e) => e.kind)).toEqual(["monthly_grant"]);
  });

  it("gives accounts without a paid plan zero credits and no packs", async () => {
    const u = newUser("free");
    const acct = await getAccount(u);
    expect(acct).toMatchObject({ plan: "free", balance: 0, monthlyAllowance: 0, packsEligible: false });
    expect(await debitCredits({ clerkUserId: u, cost: 2, toolKey: "t" })).toMatchObject({ ok: false, reason: "insufficient_credits", balance: 0 });
  });

  it("treats Pro as unlimited with no balance", async () => {
    const u = newUser("pro");
    expect(await getAccount(u)).toMatchObject({ plan: "pro", unlimited: true, balance: 0, monthlyAllowance: null, packsEligible: false, isLow: false });
  });

  it("flags a low balance at 20% of the allowance", async () => {
    const u = newUser("starter");
    await debitCredits({ clerkUserId: u, cost: 800, toolKey: "t" });
    expect(await getAccount(u)).toMatchObject({ balance: 200, lowCreditsThreshold: 200, isLow: true });
  });
});

describe("rollover", () => {
  it("carries unused monthly credits one month and spends them first", async () => {
    const u = newUser("starter");
    await getAccount(u, FEW_DAYS(0));
    await debitCredits({ clerkUserId: u, cost: 300, toolKey: "t", now: FEW_DAYS(1) });
    const feb = await getAccount(u, new Date("2031-02-01T00:00:00Z"));
    expect(feb).toMatchObject({ rolloverBalance: 700, monthlyBalance: 1000, balance: 1700 });
    const r = await debitCredits({ clerkUserId: u, cost: 800, toolKey: "t", now: new Date("2031-02-02T00:00:00Z") });
    expect(r.ok).toBe(true);
    const row = await acctRow(u);
    expect([row.rolloverBalance, row.monthlyBalance]).toEqual([0, 900]);
  });

  it("expires last month's rollover and never exceeds 2x the allowance", async () => {
    const u = newUser("starter");
    await getAccount(u, new Date("2031-01-05T00:00:00Z"));
    await getAccount(u, new Date("2031-02-05T00:00:00Z")); // Jan unused: rollover 1000
    expect(await getAccount(u, new Date("2031-02-06T00:00:00Z"))).toMatchObject({ rolloverBalance: 1000, balance: 2000 });
    const mar = await getAccount(u, new Date("2031-03-05T00:00:00Z")); // Feb rollover expires, Feb monthly rolls
    expect(mar.rolloverBalance).toBe(1000);
    expect(mar.balance).toBe(2000);
    const apr = await getAccount(u, new Date("2031-04-05T00:00:00Z"));
    expect(apr.balance).toBeLessThanOrEqual(2 * 1000);
    const kinds = (await listHistory(u, { limit: 100 })).entries.map((e) => e.kind);
    expect(kinds).toContain("rollover_expire");
    expect(kinds).toContain("rollover");
  });

  it("caps the carry-over at one allowance after a plan change", async () => {
    const u = newUser("growth");
    // Pretend the account held far more than one allowance last month.
    await getAccount(u, new Date("2031-01-05T00:00:00Z"));
    await db.update(aiCreditAccounts).set({ monthlyBalance: 9000 }).where(eq(aiCreditAccounts.clerkUserId, u));
    const feb = await getAccount(u, new Date("2031-02-05T00:00:00Z"));
    expect(feb.rolloverBalance).toBe(4000);
    expect(feb.monthlyBalance).toBe(4000);
  });

  it("keeps purchased credits across months", async () => {
    const u = newUser("starter");
    await getAccount(u, new Date("2031-01-05T00:00:00Z"));
    await grantPurchasedCredits({ clerkUserId: u, credits: 500, idempotencyKey: `t:${u}` });
    const later = await getAccount(u, new Date("2031-05-05T00:00:00Z"));
    expect(later.purchasedBalance).toBe(500);
  });

  it("tops up the difference on a mid-month upgrade", async () => {
    const u = newUser("starter");
    await getAccount(u);
    await db.update(aiCreditAccounts).set({ monthlyAllowance: 400, monthlyBalance: 400 }).where(eq(aiCreditAccounts.clerkUserId, u));
    expect((await getAccount(u)).monthlyBalance).toBe(1000);
  });

  it("does not roll over for accounts without a paid plan", async () => {
    const u = newUser("free");
    await getAccount(u, new Date("2031-01-05T00:00:00Z"));
    await db.update(aiCreditAccounts).set({ monthlyBalance: 50 }).where(eq(aiCreditAccounts.clerkUserId, u));
    const feb = await getAccount(u, new Date("2031-02-05T00:00:00Z"));
    expect([feb.rolloverBalance, feb.monthlyBalance]).toEqual([0, 0]);
  });
});

describe("debit (Starter / Growth)", () => {
  it("spends rollover, then monthly, then purchased credits", async () => {
    const u = newUser("starter");
    await getAccount(u, FEW_DAYS(0));
    await db.update(aiCreditAccounts).set({ rolloverBalance: 10, monthlyBalance: 20, purchasedBalance: 30 }).where(eq(aiCreditAccounts.clerkUserId, u));
    const now = new Date();
    await db.update(aiCreditAccounts).set({ monthlyPeriod: now.toISOString().slice(0, 7), monthlyAllowance: 1000 }).where(eq(aiCreditAccounts.clerkUserId, u));
    const r = await debitCredits({ clerkUserId: u, cost: 45, toolKey: "t", now });
    expect(r).toMatchObject({ ok: true, balance: 15 });
    const row = await acctRow(u);
    expect([row.rolloverBalance, row.monthlyBalance, row.purchasedBalance]).toEqual([0, 0, 15]);
  });

  it("has no per-user daily cap: a user can spend their whole allowance in a day", async () => {
    const u = newUser("starter");
    for (let i = 0; i < 4; i += 1) expect((await debitCredits({ clerkUserId: u, cost: 250, toolKey: "t" })).ok).toBe(true);
    expect((await getAccount(u)).balance).toBe(0);
    const g = newUser("growth");
    expect((await debitCredits({ clerkUserId: g, cost: 3900, toolKey: "t" })).ok).toBe(true);
  });

  it("refuses when the balance is too low and changes nothing", async () => {
    const u = newUser("starter");
    expect(await debitCredits({ clerkUserId: u, cost: 1001, toolKey: "t" })).toMatchObject({ ok: false, reason: "insufficient_credits", balance: 1000 });
    expect((await getAccount(u)).balance).toBe(1000);
  });

  it("never overspends when requests race", async () => {
    const u = newUser("starter");
    const results = await Promise.all(Array.from({ length: 40 }, () => debitCredits({ clerkUserId: u, cost: 30, toolKey: "t" })));
    expect(results.filter((r) => r.ok)).toHaveLength(33);
    expect((await getAccount(u)).balance).toBe(10);
  });

  it("enforces the global emergency cap across users", async () => {
    process.env.AI_GLOBAL_DAILY_CREDIT_CAP = "3";
    const a = newUser("starter"); const b = newUser("growth");
    expect((await debitCredits({ clerkUserId: a, cost: 2, toolKey: "t" })).ok).toBe(true);
    expect(await debitCredits({ clerkUserId: b, cost: 2, toolKey: "t" })).toMatchObject({ ok: false, reason: "global_daily_cap" });
  });
});

describe("Pro", () => {
  it("is never blocked by a balance and records no balance change", async () => {
    const u = newUser("pro");
    for (let i = 0; i < 5; i += 1) {
      expect(await debitCredits({ clerkUserId: u, cost: 50, toolKey: "video_gen" })).toMatchObject({ ok: true, unlimited: true, lowPriority: false });
    }
    const [usage] = await db.select().from(aiProUsage).where(eq(aiProUsage.clerkUserId, u));
    expect(usage).toMatchObject({ creditsUsed: 250, generationsToday: 5 });
    expect((await getAccount(u)).balance).toBe(0);
    expect((await listHistory(u)).entries).toEqual([]);
  });

  it("switches to the slow queue after 10,000 credits-worth in a month", async () => {
    const u = newUser("pro");
    await db.insert(aiProUsage).values({ clerkUserId: u, period: new Date().toISOString().slice(0, 7), creditsUsed: 9995, day: currentDay(), generationsToday: 0 });
    expect(await debitCredits({ clerkUserId: u, cost: 8, toolKey: "t" })).toMatchObject({ ok: true, lowPriority: false });
    expect(await debitCredits({ clerkUserId: u, cost: 8, toolKey: "t" })).toMatchObject({ ok: true, lowPriority: true });
  });

  it("resets the monthly fair-use count in a new month", async () => {
    const u = newUser("pro");
    await db.insert(aiProUsage).values({ clerkUserId: u, period: "2031-01", creditsUsed: 50_000, day: "2031-01-10", generationsToday: 5 });
    expect(await debitCredits({ clerkUserId: u, cost: 5, toolKey: "t", now: new Date("2031-02-02T00:00:00Z") })).toMatchObject({ ok: true, lowPriority: false });
  });

  it("applies a hidden daily ceiling of 400 generations", async () => {
    const u = newUser("pro");
    await db.insert(aiProUsage).values({ clerkUserId: u, period: new Date().toISOString().slice(0, 7), creditsUsed: 0, day: currentDay(), generationsToday: 399 });
    expect((await debitCredits({ clerkUserId: u, cost: 1, toolKey: "t" })).ok).toBe(true);
    expect(await debitCredits({ clerkUserId: u, cost: 1, toolKey: "t" })).toMatchObject({ ok: false, reason: "rate_limited" });
  });

  it("honours the env-tunable ceiling and refunds usage exactly once", async () => {
    process.env.AI_PRO_DAILY_GENERATION_CEILING = "2";
    const u = newUser("pro");
    const first = await debitCredits({ clerkUserId: u, cost: 10, toolKey: "t" });
    if (!first.ok) throw new Error("debit failed");
    await debitCredits({ clerkUserId: u, cost: 10, toolKey: "t" });
    expect((await debitCredits({ clerkUserId: u, cost: 10, toolKey: "t" })).ok).toBe(false);
    expect(await refundDebit(first.entryId)).toBe(true);
    expect(await refundDebit(first.entryId)).toBe(false);
    const [usage] = await db.select().from(aiProUsage).where(eq(aiProUsage.clerkUserId, u));
    expect(usage).toMatchObject({ creditsUsed: 10, generationsToday: 1 });
    expect((await debitCredits({ clerkUserId: u, cost: 10, toolKey: "t" })).ok).toBe(true);
  });

  it("still counts toward the global emergency cap", async () => {
    process.env.AI_GLOBAL_DAILY_CREDIT_CAP = "5";
    const u = newUser("pro");
    expect((await debitCredits({ clerkUserId: u, cost: 4, toolKey: "t" })).ok).toBe(true);
    expect(await debitCredits({ clerkUserId: u, cost: 4, toolKey: "t" })).toMatchObject({ ok: false, reason: "global_daily_cap" });
  });
});

describe("refund", () => {
  it("restores every bucket and the spend counter exactly once", async () => {
    const u = newUser("starter");
    await grantPurchasedCredits({ clerkUserId: u, credits: 10, idempotencyKey: `t:${u}` });
    await db.update(aiCreditAccounts).set({ rolloverBalance: 5 }).where(eq(aiCreditAccounts.clerkUserId, u));
    const d = await debitCredits({ clerkUserId: u, cost: 1000 + 5 + 4, toolKey: "t" });
    if (!d.ok) throw new Error("debit failed");
    expect(await refundDebit(d.entryId)).toBe(true);
    expect(await refundDebit(d.entryId)).toBe(false);
    const row = await acctRow(u);
    expect([row.rolloverBalance, row.monthlyBalance, row.purchasedBalance]).toEqual([5, 1000, 10]);
    const [spent] = await db.select().from(aiSpendDaily).where(sql`${aiSpendDaily.clerkUserId} = '*' AND ${aiSpendDaily.day} = ${currentDay()}`);
    expect(spent!.spent).toBe(0);
  });
});

describe("purchases", () => {
  it("credits a pack once per idempotency key", async () => {
    const u = newUser("starter");
    const key = `pack:${u}`;
    const [a, b] = await Promise.all([
      grantPurchasedCredits({ clerkUserId: u, credits: 500, idempotencyKey: key }),
      grantPurchasedCredits({ clerkUserId: u, credits: 500, idempotencyKey: key }),
    ]);
    expect([a.granted, b.granted].sort()).toEqual([false, true]);
    expect((await getAccount(u)).purchasedBalance).toBe(500);
  });
});

describe("text ceiling", () => {
  it("counts silently and stops at the configured daily limit", async () => {
    process.env.AI_TEXT_DAILY_LIMIT_PER_USER = "3";
    const u = newUser("starter");
    const answers = [];
    for (let i = 0; i < 5; i += 1) answers.push(await allowTextRequest(u));
    expect(answers).toEqual([true, true, true, false, false]);
    expect((await getAccount(u)).balance).toBe(1000);
  });
});

describe("alerts", () => {
  it("fires each global threshold once per day", async () => {
    process.env.AI_GLOBAL_DAILY_CREDIT_CAP = "10";
    process.env.AI_SPEND_ALERT_THRESHOLDS = "50,100";
    const day = currentDay();
    await raiseSpendAlerts({ day, clerkUserId: "x", globalSpent: 6, blocked: null });
    await raiseSpendAlerts({ day, clerkUserId: "x", globalSpent: 7, blocked: null });
    await raiseSpendAlerts({ day, clerkUserId: "x", globalSpent: 10, blocked: null });
    const rows = await db.execute(sql`SELECT threshold FROM ai_spend_alerts WHERE day = ${day} AND scope = 'global' ORDER BY threshold`);
    expect(rows.rows.map((r: any) => r.threshold)).toEqual([50, 100]);
    delete process.env.AI_SPEND_ALERT_THRESHOLDS;
  });
});
