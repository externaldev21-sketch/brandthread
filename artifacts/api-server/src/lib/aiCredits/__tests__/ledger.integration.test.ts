/**
 * AI credit ledger: plan tiers (all finite), one-month rollover (capped), spend
 * order, per-user daily generation ceiling (counted in units), trial and
 * past-due allowances, global emergency cap, full and partial refunds, metered
 * free tools, purchases, alerts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { aiCreditAccounts, aiCreditLedger, aiProUsage, aiSpendAlerts, aiSpendDaily, db } from "@workspace/db";

vi.mock("../../nativeEntitlements", () => ({
  getEffectiveEntitlement: vi.fn(async (id: string) => {
    const status = id.includes("-trialing-") ? "trialing" : id.includes("-pastdue-") ? "past_due" : id.includes("-grace-") ? "grace" : "active";
    if (id.includes("-pro-")) return { planId: "pro", provider: "revenuecat", status };
    if (id.includes("-growth-")) return { planId: "growth", provider: "stripe", status };
    if (id.includes("-starter-")) return { planId: "starter", provider: "stripe", status };
    return { planId: "starter", provider: "none", status: "none" };
  }),
}));

import { MONTHLY_ALLOWANCE, PLAN_CREDIT_POLICY, creditPolicyForPlan, trialAllowance } from "../catalogue";
import {
  allowTextRequest, billingStateOf, currentDay, debitCredits, getAccount, grantPurchasedCredits, listHistory, meterRequest, refundDebit,
} from "../ledger";
import { raiseSpendAlerts } from "../alerts";

const STARTER = PLAN_CREDIT_POLICY.starter.monthlyAllowance;
const GROWTH = PLAN_CREDIT_POLICY.growth.monthlyAllowance;
const PRO = PLAN_CREDIT_POLICY.pro.monthlyAllowance;

type Tag = "free" | "starter" | "growth" | "pro";
const users: string[] = [];
const newUser = (tag: Tag = "starter", billing: "" | "trialing" | "pastdue" | "grace" = "") => {
  const id = `ai-credits-test-${tag}-${billing ? `${billing}-` : ""}${crypto.randomUUID()}`;
  users.push(id);
  return id;
};
const acctRow = async (u: string) => (await db.select().from(aiCreditAccounts).where(eq(aiCreditAccounts.clerkUserId, u)))[0]!;
const counter = async (key: string) =>
  (await db.select().from(aiSpendDaily).where(and(eq(aiSpendDaily.clerkUserId, key), eq(aiSpendDaily.day, currentDay()))))[0]?.spent ?? 0;
const FEW_DAYS = (n: number) => new Date(Date.UTC(2031, 0, 10 + n));

beforeEach(() => {
  delete process.env.AI_GLOBAL_DAILY_CREDIT_CAP;
  delete process.env.AI_DAILY_GENERATION_CEILING;
  delete process.env.AI_TRIAL_DAILY_GENERATION_CEILING;
  delete process.env.AI_TEXT_DAILY_LIMIT_PER_USER;
  delete process.env.AI_PAST_DUE_GRACE_DAYS;
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
  it("ties finite allowances to the plan", () => {
    expect(STARTER).toBeGreaterThan(0);
    expect(GROWTH).toBeGreaterThan(STARTER);
    expect(PRO).toBeGreaterThan(GROWTH);
    expect(PLAN_CREDIT_POLICY.free.monthlyAllowance).toBe(0);
    expect(MONTHLY_ALLOWANCE.growth).toBe(creditPolicyForPlan("growth").monthlyAllowance);
  });

  it("grants each paid plan its allowance and records it", async () => {
    const s = newUser("starter");
    const g = newUser("growth");
    const p = newUser("pro");
    expect(await getAccount(s)).toMatchObject({ plan: "starter", billing: "paid", unlimited: false, balance: STARTER, monthlyAllowance: STARTER, packsEligible: true });
    expect(await getAccount(g)).toMatchObject({ plan: "growth", balance: GROWTH, lowCreditsThreshold: Math.floor(GROWTH * 0.2), isLow: false });
    expect(await getAccount(p)).toMatchObject({ plan: "pro", unlimited: false, balance: PRO, monthlyAllowance: PRO, packsEligible: false });
    expect((await listHistory(s)).entries.map((e) => e.kind)).toEqual(["monthly_grant"]);
  });

  it("gives accounts without a paid plan zero credits and no packs", async () => {
    const u = newUser("free");
    const acct = await getAccount(u);
    expect(acct).toMatchObject({ plan: "free", balance: 0, monthlyAllowance: 0, packsEligible: false });
    expect(await debitCredits({ clerkUserId: u, cost: 2, toolKey: "t" })).toMatchObject({ ok: false, reason: "insufficient_credits", balance: 0 });
  });

  it("flags a low balance at 20% of the allowance", async () => {
    const u = newUser("starter");
    const threshold = Math.floor(STARTER * 0.2);
    await debitCredits({ clerkUserId: u, cost: STARTER - threshold, toolKey: "t" });
    expect(await getAccount(u)).toMatchObject({ balance: threshold, lowCreditsThreshold: threshold, isLow: true });
  });

  it("maps provider statuses to billing states", () => {
    expect(billingStateOf("trialing")).toBe("trial");
    expect(billingStateOf("trial")).toBe("trial");
    expect(billingStateOf("past_due")).toBe("past_due");
    expect(billingStateOf("grace")).toBe("past_due");
    expect(billingStateOf("active")).toBe("paid");
  });
});

describe("trials", () => {
  it("get the reduced allowance, not the plan's, and no rollover", async () => {
    const u = newUser("pro", "trialing");
    expect(trialAllowance("pro")).toBeLessThan(PRO);
    expect(await getAccount(u)).toMatchObject({ plan: "pro", billing: "trial", balance: trialAllowance("pro"), monthlyAllowance: trialAllowance("pro") });
    expect(await debitCredits({ clerkUserId: u, cost: trialAllowance("pro") + 1, toolKey: "t" })).toMatchObject({ ok: false, reason: "insufficient_credits" });
  });

  it("honours AI_TRIAL_CREDITS but never above the plan allowance", () => {
    process.env.AI_TRIAL_CREDITS = "40";
    expect(trialAllowance("growth")).toBe(40);
    process.env.AI_TRIAL_CREDITS = String(GROWTH * 10);
    expect(trialAllowance("growth")).toBe(GROWTH);
    delete process.env.AI_TRIAL_CREDITS;
  });

  it("have a tighter daily ceiling", async () => {
    process.env.AI_TRIAL_DAILY_GENERATION_CEILING = "2";
    const u = newUser("growth", "trialing");
    expect((await debitCredits({ clerkUserId: u, cost: 1, toolKey: "t", units: 2 })).ok).toBe(true);
    expect(await debitCredits({ clerkUserId: u, cost: 1, toolKey: "t" })).toMatchObject({ ok: false, reason: "rate_limited" });
  });

  it("get the full allowance once the first invoice is paid (trial -> active)", async () => {
    const trialId = newUser("growth", "trialing");
    await debitCredits({ clerkUserId: trialId, cost: 30, toolKey: "t" });
    // Same account, now paid: the row is moved to an id the mock reports active.
    const paidId = newUser("growth");
    await db.insert(aiCreditAccounts).values({ ...(await acctRow(trialId)), clerkUserId: paidId });
    const acct = await getAccount(paidId);
    expect(acct).toMatchObject({ billing: "paid", monthlyAllowance: GROWTH, balance: GROWTH - 30 });
  });
});

describe("past due", () => {
  it("keeps the reduced allowance during the grace period, then blocks AI tools", async () => {
    process.env.AI_PAST_DUE_GRACE_DAYS = "3";
    const u = newUser("growth", "pastdue");
    const day0 = new Date(Date.UTC(2031, 0, 10));
    expect(await getAccount(u, day0)).toMatchObject({ billing: "past_due", balance: trialAllowance("growth") });
    expect((await acctRow(u)).billingIssueSince?.toISOString()).toBe(day0.toISOString());
    expect((await debitCredits({ clerkUserId: u, cost: 5, toolKey: "t", now: new Date(Date.UTC(2031, 0, 12)) })).ok).toBe(true);
    const r = await debitCredits({ clerkUserId: u, cost: 5, toolKey: "t", now: new Date(Date.UTC(2031, 0, 13)) });
    expect(r).toMatchObject({ ok: false, reason: "billing_issue" });
    expect((await getAccount(u, new Date(Date.UTC(2031, 0, 13)))).balance).toBe(0);
  });

  it("treats store billing grace like past due", async () => {
    const u = newUser("pro", "grace");
    expect(await getAccount(u)).toMatchObject({ billing: "past_due", balance: trialAllowance("pro") });
  });

  it("clears the billing issue once paid again", async () => {
    const late = newUser("starter", "pastdue");
    await getAccount(late);
    const paid = newUser("starter");
    await db.insert(aiCreditAccounts).values({ ...(await acctRow(late)), clerkUserId: paid });
    await getAccount(paid);
    expect((await acctRow(paid)).billingIssueSince).toBeNull();
  });
});

describe("rollover", () => {
  it("carries unused monthly credits one month and spends them first", async () => {
    const u = newUser("starter");
    await getAccount(u, FEW_DAYS(0));
    await debitCredits({ clerkUserId: u, cost: 300, toolKey: "t", now: FEW_DAYS(1) });
    const feb = await getAccount(u, new Date("2031-02-01T00:00:00Z"));
    expect(feb).toMatchObject({ rolloverBalance: STARTER - 300, monthlyBalance: STARTER, balance: 2 * STARTER - 300 });
    const r = await debitCredits({ clerkUserId: u, cost: STARTER - 200, toolKey: "t", now: new Date("2031-02-02T00:00:00Z") });
    expect(r.ok).toBe(true);
    const row = await acctRow(u);
    expect([row.rolloverBalance, row.monthlyBalance]).toEqual([0, STARTER - 100]);
  });

  it("expires last month's rollover and never exceeds 2x the allowance", async () => {
    const u = newUser("starter");
    await getAccount(u, new Date("2031-01-05T00:00:00Z"));
    await getAccount(u, new Date("2031-02-05T00:00:00Z"));
    expect(await getAccount(u, new Date("2031-02-06T00:00:00Z"))).toMatchObject({ rolloverBalance: STARTER, balance: 2 * STARTER });
    const mar = await getAccount(u, new Date("2031-03-05T00:00:00Z"));
    expect(mar.rolloverBalance).toBe(STARTER);
    expect(mar.balance).toBe(2 * STARTER);
    const apr = await getAccount(u, new Date("2031-04-05T00:00:00Z"));
    expect(apr.balance).toBeLessThanOrEqual(2 * STARTER);
    const kinds = (await listHistory(u, { limit: 100 })).entries.map((e) => e.kind);
    expect(kinds).toContain("rollover_expire");
    expect(kinds).toContain("rollover");
  });

  it("caps the carry-over at one allowance after a plan change", async () => {
    const u = newUser("growth");
    await getAccount(u, new Date("2031-01-05T00:00:00Z"));
    await db.update(aiCreditAccounts).set({ monthlyBalance: 9000 }).where(eq(aiCreditAccounts.clerkUserId, u));
    const feb = await getAccount(u, new Date("2031-02-05T00:00:00Z"));
    expect(feb.rolloverBalance).toBe(GROWTH);
    expect(feb.monthlyBalance).toBe(GROWTH);
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
    await db.update(aiCreditAccounts).set({ monthlyAllowance: 100, monthlyBalance: 100 }).where(eq(aiCreditAccounts.clerkUserId, u));
    expect((await getAccount(u)).monthlyBalance).toBe(STARTER);
  });

  it("does not roll over for accounts without a paid plan", async () => {
    const u = newUser("free");
    await getAccount(u, new Date("2031-01-05T00:00:00Z"));
    await db.update(aiCreditAccounts).set({ monthlyBalance: 50 }).where(eq(aiCreditAccounts.clerkUserId, u));
    const feb = await getAccount(u, new Date("2031-02-05T00:00:00Z"));
    expect([feb.rolloverBalance, feb.monthlyBalance]).toEqual([0, 0]);
  });
});

describe("debit", () => {
  it("spends rollover, then monthly, then purchased credits", async () => {
    const u = newUser("starter");
    await getAccount(u, FEW_DAYS(0));
    await db.update(aiCreditAccounts).set({ rolloverBalance: 10, monthlyBalance: 20, purchasedBalance: 30 }).where(eq(aiCreditAccounts.clerkUserId, u));
    const now = new Date();
    await db.update(aiCreditAccounts).set({ monthlyPeriod: now.toISOString().slice(0, 7), monthlyAllowance: STARTER }).where(eq(aiCreditAccounts.clerkUserId, u));
    const r = await debitCredits({ clerkUserId: u, cost: 45, toolKey: "t", now });
    expect(r).toMatchObject({ ok: true, balance: 15 });
    const row = await acctRow(u);
    expect([row.rolloverBalance, row.monthlyBalance, row.purchasedBalance]).toEqual([0, 0, 15]);
  });

  it("applies a per-user daily generation ceiling counted in units", async () => {
    process.env.AI_DAILY_GENERATION_CEILING = "4";
    const u = newUser("pro");
    expect((await debitCredits({ clerkUserId: u, cost: 30, toolKey: "model_photo", units: 3 })).ok).toBe(true);
    expect(await debitCredits({ clerkUserId: u, cost: 20, toolKey: "model_photo", units: 2 })).toMatchObject({ ok: false, reason: "rate_limited" });
    expect((await debitCredits({ clerkUserId: u, cost: 10, toolKey: "logo" })).ok).toBe(true);
    expect(await counter(`gen:${u}`)).toBe(4);
  });

  it("refuses when the balance is too low and changes nothing", async () => {
    const u = newUser("starter");
    expect(await debitCredits({ clerkUserId: u, cost: STARTER + 1, toolKey: "t" })).toMatchObject({ ok: false, reason: "insufficient_credits", balance: STARTER });
    expect((await getAccount(u)).balance).toBe(STARTER);
  });

  it("never overspends when requests race", async () => {
    const u = newUser("starter");
    const results = await Promise.all(Array.from({ length: 40 }, () => debitCredits({ clerkUserId: u, cost: 30, toolKey: "t" })));
    expect(results.filter((r) => r.ok)).toHaveLength(Math.floor(STARTER / 30));
    expect((await getAccount(u)).balance).toBe(STARTER % 30);
  });

  it("enforces the global emergency cap across users", async () => {
    process.env.AI_GLOBAL_DAILY_CREDIT_CAP = "3";
    const a = newUser("starter"); const b = newUser("pro");
    expect((await debitCredits({ clerkUserId: a, cost: 2, toolKey: "t" })).ok).toBe(true);
    expect(await debitCredits({ clerkUserId: b, cost: 2, toolKey: "t" })).toMatchObject({ ok: false, reason: "global_daily_cap" });
  });
});

describe("refund", () => {
  it("restores every bucket and the spend counters exactly once", async () => {
    const u = newUser("starter");
    await grantPurchasedCredits({ clerkUserId: u, credits: 10, idempotencyKey: `t:${u}` });
    await db.update(aiCreditAccounts).set({ rolloverBalance: 5 }).where(eq(aiCreditAccounts.clerkUserId, u));
    const d = await debitCredits({ clerkUserId: u, cost: STARTER + 5 + 4, toolKey: "t" });
    if (!d.ok) throw new Error("debit failed");
    expect(await refundDebit(d.entryId)).toBe(true);
    expect(await refundDebit(d.entryId)).toBe(false);
    const row = await acctRow(u);
    expect([row.rolloverBalance, row.monthlyBalance, row.purchasedBalance]).toEqual([5, STARTER, 10]);
    expect(await counter("*")).toBe(0);
    expect(await counter(`gen:${u}`)).toBe(0);
  });

  it("gives back only the failed units of a partly successful run, purchased credits first", async () => {
    const u = newUser("starter");
    await grantPurchasedCredits({ clerkUserId: u, credits: 100, idempotencyKey: `t:${u}` });
    const d = await debitCredits({ clerkUserId: u, cost: STARTER + 90, toolKey: "model_photo", units: 3 });
    if (!d.ok) throw new Error("debit failed");
    const perUnit = (STARTER + 90) / 3;
    expect(await refundDebit(d.entryId, { units: 1 })).toBe(true);
    // A debit is refunded once: a later full refund is ignored.
    expect(await refundDebit(d.entryId)).toBe(false);
    const row = await acctRow(u);
    expect(row.purchasedBalance + row.monthlyBalance + row.rolloverBalance).toBe(10 + Math.floor(perUnit));
    expect(row.purchasedBalance).toBe(Math.min(90, Math.floor(perUnit)) + 10);
    expect(await counter(`gen:${u}`)).toBe(2);
  });
});

describe("metered tools", () => {
  it("counts toward the user's daily limit and the global cap, never the balance", async () => {
    const u = newUser("free");
    expect((await meterRequest({ clerkUserId: u, toolKey: "support_chat", cost: 2, dailyLimit: 2 })).ok).toBe(true);
    const second = await meterRequest({ clerkUserId: u, toolKey: "support_chat", cost: 2, dailyLimit: 2 });
    expect(second.ok).toBe(true);
    expect(await meterRequest({ clerkUserId: u, toolKey: "support_chat", cost: 2, dailyLimit: 2 })).toEqual({ ok: false, reason: "rate_limited" });
    expect(await counter("*")).toBe(4);
    if (!second.ok) throw new Error("meter failed");
    expect(await refundDebit(second.entryId)).toBe(true);
    expect(await refundDebit(second.entryId)).toBe(false);
    expect(await counter("*")).toBe(2);
    expect(await counter(`tool:support_chat:${u}`)).toBe(1);
    expect((await listHistory(u)).entries).toEqual([]);
  });

  it("stops at the global emergency cap", async () => {
    process.env.AI_GLOBAL_DAILY_CREDIT_CAP = "3";
    const u = newUser("free");
    expect((await meterRequest({ clerkUserId: u, toolKey: "support_chat", cost: 2, dailyLimit: 50 })).ok).toBe(true);
    expect(await meterRequest({ clerkUserId: u, toolKey: "support_chat", cost: 2, dailyLimit: 50 })).toEqual({ ok: false, reason: "global_daily_cap" });
  });
});

describe("legacy Pro usage rows", () => {
  it("still refund exactly once", async () => {
    const u = newUser("pro");
    const day = currentDay();
    await db.insert(aiProUsage).values({ clerkUserId: u, period: day.slice(0, 7), creditsUsed: 10, day, generationsToday: 1 });
    const id = crypto.randomUUID();
    await db.execute(sql`INSERT INTO ai_credit_ledger (id, clerk_user_id, kind, delta, tool_key, balance_after, meta)
      VALUES (${id}, ${u}, 'usage', 0, 't', 0, ${JSON.stringify({ day, period: day.slice(0, 7), cost: 10 })}::jsonb)`);
    expect(await refundDebit(id)).toBe(true);
    expect(await refundDebit(id)).toBe(false);
    const [usage] = await db.select().from(aiProUsage).where(eq(aiProUsage.clerkUserId, u));
    expect(usage).toMatchObject({ creditsUsed: 0, generationsToday: 0 });
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
    expect((await getAccount(u)).balance).toBe(STARTER);
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
