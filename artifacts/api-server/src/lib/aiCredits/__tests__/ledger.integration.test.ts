/**
 * AI credit ledger: allowance grants, bucket order, atomic spending under
 * concurrency, daily caps, refunds, purchases and alert de-duplication.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { aiCreditAccounts, aiCreditLedger, aiSpendAlerts, aiSpendDaily, db } from "@workspace/db";

vi.mock("../../nativeEntitlements", () => ({
  getEffectiveEntitlement: vi.fn(async (id: string) =>
    id.includes("-pro-") ? { planId: "pro", provider: "revenuecat" } : { planId: "starter", provider: "none" }),
}));

import { MONTHLY_ALLOWANCE } from "../catalogue";
import { currentDay, debitCredits, getAccount, grantPurchasedCredits, listHistory, refundDebit } from "../ledger";
import { raiseSpendAlerts } from "../alerts";

const users: string[] = [];
const newUser = (tag = "free") => { const id = `ai-credits-test-${tag}-${crypto.randomUUID()}`; users.push(id); return id; };

beforeEach(() => {
  delete process.env.AI_DAILY_CREDIT_CAP_PER_USER;
  delete process.env.AI_GLOBAL_DAILY_CREDIT_CAP;
});

afterEach(async () => {
  if (users.length) {
    await db.delete(aiCreditLedger).where(inArray(aiCreditLedger.clerkUserId, users));
    await db.delete(aiCreditAccounts).where(inArray(aiCreditAccounts.clerkUserId, users));
    await db.delete(aiSpendDaily).where(inArray(aiSpendDaily.clerkUserId, users));
    await db.delete(aiSpendAlerts).where(sql`scope LIKE 'user:ai-credits-test-%'`);
    users.length = 0;
  }
  await db.execute(sql`DELETE FROM ai_spend_daily WHERE clerk_user_id = '*' AND day = ${currentDay()}`);
  await db.execute(sql`DELETE FROM ai_spend_alerts WHERE scope = 'global' AND day = ${currentDay()}`);
});

describe("monthly allowance", () => {
  it("grants the plan allowance on first use and records it in the ledger", async () => {
    const u = newUser();
    const acct = await getAccount(u);
    expect(acct.plan).toBe("free");
    expect(acct.balance).toBe(MONTHLY_ALLOWANCE.free);
    const { entries } = await listHistory(u);
    expect(entries.map((e) => e.kind)).toEqual(["monthly_grant"]);
  });

  it("uses the paid plan's larger allowance", async () => {
    const u = newUser("pro");
    expect((await getAccount(u)).balance).toBe(MONTHLY_ALLOWANCE.pro);
  });

  it("expires what is left and grants a fresh allowance in a new month", async () => {
    const u = newUser();
    await getAccount(u, new Date("2031-01-10T00:00:00Z"));
    await debitCredits({ clerkUserId: u, cost: 5, toolKey: "t", now: new Date("2031-01-11T00:00:00Z") });
    const feb = await getAccount(u, new Date("2031-02-01T00:00:00Z"));
    expect(feb.balance).toBe(MONTHLY_ALLOWANCE.free);
    const { entries } = await listHistory(u);
    expect(entries.map((e) => e.kind)).toContain("monthly_expire");
  });
});

describe("debit", () => {
  it("spends monthly credits before purchased ones", async () => {
    const u = newUser();
    await grantPurchasedCredits({ clerkUserId: u, credits: 100, idempotencyKey: `t:${u}` });
    const r = await debitCredits({ clerkUserId: u, cost: MONTHLY_ALLOWANCE.free + 10, toolKey: "t" });
    expect(r.ok).toBe(true);
    const [acct] = await db.select().from(aiCreditAccounts).where(eq(aiCreditAccounts.clerkUserId, u));
    expect(acct!.monthlyBalance).toBe(0);
    expect(acct!.purchasedBalance).toBe(90);
  });

  it("refuses when the balance is too low and changes nothing", async () => {
    const u = newUser();
    const r = await debitCredits({ clerkUserId: u, cost: MONTHLY_ALLOWANCE.free + 1, toolKey: "t" });
    expect(r).toMatchObject({ ok: false, reason: "insufficient_credits", balance: MONTHLY_ALLOWANCE.free });
  });

  it("never overspends when requests race", async () => {
    const u = newUser();
    const results = await Promise.all(Array.from({ length: 30 }, () => debitCredits({ clerkUserId: u, cost: 1, toolKey: "t" })));
    expect(results.filter((r) => r.ok)).toHaveLength(MONTHLY_ALLOWANCE.free);
    expect((await getAccount(u)).balance).toBe(0);
  });

  it("enforces the per-user daily cap", async () => {
    process.env.AI_DAILY_CREDIT_CAP_PER_USER = "6";
    const u = newUser("pro");
    expect((await debitCredits({ clerkUserId: u, cost: 5, toolKey: "t" })).ok).toBe(true);
    const r = await debitCredits({ clerkUserId: u, cost: 2, toolKey: "t" });
    expect(r).toMatchObject({ ok: false, reason: "user_daily_cap" });
  });

  it("enforces the global daily cap across users", async () => {
    process.env.AI_GLOBAL_DAILY_CREDIT_CAP = "3";
    const a = newUser(); const b = newUser();
    expect((await debitCredits({ clerkUserId: a, cost: 2, toolKey: "t" })).ok).toBe(true);
    expect(await debitCredits({ clerkUserId: b, cost: 2, toolKey: "t" })).toMatchObject({ ok: false, reason: "global_daily_cap" });
  });
});

describe("refund", () => {
  it("restores both buckets and the spend counters exactly once", async () => {
    const u = newUser();
    await grantPurchasedCredits({ clerkUserId: u, credits: 10, idempotencyKey: `t:${u}` });
    const d = await debitCredits({ clerkUserId: u, cost: MONTHLY_ALLOWANCE.free + 4, toolKey: "t" });
    if (!d.ok) throw new Error("debit failed");
    expect(await refundDebit(d.entryId)).toBe(true);
    expect(await refundDebit(d.entryId)).toBe(false);
    const [acct] = await db.select().from(aiCreditAccounts).where(eq(aiCreditAccounts.clerkUserId, u));
    expect([acct!.monthlyBalance, acct!.purchasedBalance]).toEqual([MONTHLY_ALLOWANCE.free, 10]);
    const [spent] = await db.select().from(aiSpendDaily).where(eq(aiSpendDaily.clerkUserId, u));
    expect(spent!.spent).toBe(0);
  });
});

describe("purchases", () => {
  it("credits a pack once per idempotency key", async () => {
    const u = newUser();
    const key = `pack:${u}`;
    const [a, b] = await Promise.all([
      grantPurchasedCredits({ clerkUserId: u, credits: 100, idempotencyKey: key }),
      grantPurchasedCredits({ clerkUserId: u, credits: 100, idempotencyKey: key }),
    ]);
    expect([a.granted, b.granted].sort()).toEqual([false, true]);
    expect((await getAccount(u)).purchasedBalance).toBe(100);
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
