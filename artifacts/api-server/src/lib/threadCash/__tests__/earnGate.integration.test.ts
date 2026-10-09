/**
 * The server-side gate on every Thread Cash reward (revenue audit BT-112,
 * BT-123, BT-125, BT-131): kill switch (env + feature flags, fail closed),
 * monthly GMV-tied budget, per-device cap across accounts, and the money
 * ledger postings that make the outstanding liability visible.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("../../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));

import { eq, inArray } from "drizzle-orm";
import { db, ledgerPostings, ledgerTransactions, threadCashEntries, threadCashStreaks } from "@workspace/db";
import { awardDailyCheckInOnce, getBalanceCents } from "../wallet";
import { getRewardsBudgetStatus, normalizeDeviceId, threadCashEarnPauseReason } from "../earnGate";
import { expireThreadCashForBuyer } from "../expiry";
import { getThreadCashLiabilityReport } from "../liability";
import { rewardsPolicy } from "../rewardsConfig";
import { allowThreadCashRewards, seedRewardsGmv, testDeviceId } from "../../../testUtils/threadCashRewards";

const buyers: string[] = [];
function newBuyer(): string {
  const id = `tc-earn-gate-${crypto.randomUUID()}`;
  buyers.push(id);
  return id;
}

let restoreEnv: () => void;
let server: Server;
let base = "";

beforeAll(async () => {
  restoreEnv = allowThreadCashRewards({ THREAD_CASH_DEVICE_MAX_ACCOUNTS_PER_DAY: "1" });
  await seedRewardsGmv();
  const { default: router } = await import("../../../routes/thread-cash");
  const app = express();
  app.use(express.json());
  app.use("/api/thread-cash", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  restoreEnv();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
afterEach(async () => {
  if (buyers.length) {
    await db.delete(threadCashEntries).where(inArray(threadCashEntries.buyerId, buyers));
    await db.delete(threadCashStreaks).where(inArray(threadCashStreaks.buyerId, buyers));
    buyers.length = 0;
  }
});

function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const restore = allowThreadCashRewards(vars);
  return fn().finally(restore);
}

async function ledgerFor(idempotencyKey: string): Promise<Record<string, number>> {
  const [txn] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.idempotencyKey, idempotencyKey)).limit(1);
  if (!txn) return {};
  const postings = await db.select().from(ledgerPostings).where(eq(ledgerPostings.transactionId, txn.id));
  const out: Record<string, number> = {};
  for (const p of postings) out[p.account] = (out[p.account] ?? 0) + p.amountCents;
  return out;
}

describe("kill switch (fails closed)", () => {
  it("pays nothing unless THREAD_CASH_EARN_ENABLED is exactly 'true'", async () => {
    const buyerId = newBuyer();
    await withEnv({ THREAD_CASH_EARN_ENABLED: "" }, async () => {
      await expect(awardDailyCheckInOnce({ buyerId, localDate: "2026-01-01", earnedCents: 10, streakBonusCents: 0, deviceId: testDeviceId() }))
        .rejects.toMatchObject({ code: "THREAD_CASH_EARN_PAUSED", status: 503 });
    });
    expect(await getBalanceCents(db, buyerId)).toBe(0);
  });

  // Flags are passed in rather than flipped in the shared test database,
  // which other suites read concurrently.
  const flags = (on: Record<string, boolean>) => async (key: string) => on[key] ?? false;

  it("pays nothing while the 'threadCash' flag is off, even with the env on", async () => {
    expect(await threadCashEarnPauseReason(rewardsPolicy(), flags({ threadCash: false, threadCashCheckoutDiscount: true })))
      .toBe("thread_cash_off");
    // A missing flag row reads as off too.
    expect(await threadCashEarnPauseReason(rewardsPolicy(), flags({}))).toBe("thread_cash_off");
  });

  it("by default accrues nothing while checkout spend is off (no unusable liability piles up)", async () => {
    const strict = rewardsPolicy({ ...process.env, THREAD_CASH_EARN_WITHOUT_CHECKOUT_SPEND: "" });
    expect(await threadCashEarnPauseReason(strict, flags({ threadCash: true }))).toBe("checkout_spend_off");
    expect(await threadCashEarnPauseReason(strict, flags({ threadCash: true, threadCashCheckoutDiscount: true }))).toBeNull();
    // Only an explicit opt-in lets rewards accrue ahead of checkout spend.
    const optIn = rewardsPolicy({ ...process.env, THREAD_CASH_EARN_WITHOUT_CHECKOUT_SPEND: "true" });
    expect(await threadCashEarnPauseReason(optIn, flags({ threadCash: true }))).toBeNull();
  });

  it("the daily claim route answers 200 'not awarded' (so the app stops retrying) and heartbeats are not recorded", async () => {
    const buyerId = newBuyer();
    await withEnv({ THREAD_CASH_EARN_ENABLED: "false" }, async () => {
      const heartbeat = await fetch(`${base}/api/thread-cash/daily/heartbeat`, {
        method: "POST", headers: { "content-type": "application/json", "x-test-user": buyerId },
        body: JSON.stringify({ timezone: "UTC", activeSeconds: 60 }),
      });
      expect(await heartbeat.json()).toMatchObject({ ok: true, paused: true, heartbeatCount: 0 });

      const res = await fetch(`${base}/api/thread-cash/daily/claim`, {
        method: "POST", headers: { "content-type": "application/json", "x-test-user": buyerId },
        body: JSON.stringify({ timezone: "UTC", deviceId: testDeviceId(), activeSeconds: 600 }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, awarded: false, code: "THREAD_CASH_EARN_PAUSED", earnedCents: 0 });
    });
    expect(await getBalanceCents(db, buyerId)).toBe(0);
  });
});

describe("per-device cap", () => {
  it("one device earns the daily reward for one account per day, across every account on it", async () => {
    const deviceId = testDeviceId();
    const first = newBuyer();
    const second = newBuyer();
    await awardDailyCheckInOnce({ buyerId: first, localDate: "2026-02-01", earnedCents: 10, streakBonusCents: 0, deviceId });
    // A different account on the same phone — and with the id in another case.
    await expect(awardDailyCheckInOnce({ buyerId: second, localDate: "2026-02-01", earnedCents: 10, streakBonusCents: 0, deviceId: deviceId.toUpperCase() }))
      .rejects.toMatchObject({ code: "THREAD_CASH_DEVICE_CHECKIN_CAP" });
    // A different local date doesn't dodge it: the window is a rolling 24h.
    await expect(awardDailyCheckInOnce({ buyerId: second, localDate: "2026-02-02", earnedCents: 10, streakBonusCents: 0, deviceId }))
      .rejects.toMatchObject({ code: "THREAD_CASH_DEVICE_CHECKIN_CAP" });
    expect(await getBalanceCents(db, second)).toBe(0);
    // The first account itself is not blocked by its own earlier claim.
    await awardDailyCheckInOnce({ buyerId: first, localDate: "2026-02-02", earnedCents: 10, streakBonusCents: 0, deviceId });
    expect(await getBalanceCents(db, first)).toBe(20);
  });

  it("fails closed without a valid device id", async () => {
    const buyerId = newBuyer();
    for (const deviceId of [null, "", "short", "has spaces in it padded out"]) {
      await expect(awardDailyCheckInOnce({ buyerId, localDate: "2026-02-03", earnedCents: 10, streakBonusCents: 0, deviceId }))
        .rejects.toMatchObject({ code: "THREAD_CASH_DEVICE_REQUIRED" });
    }
    expect(normalizeDeviceId("3F2504E0-4F89-11D3-9A0C-0305E82C3301")).toBe("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
  });
});

describe("monthly budget", () => {
  it("is bps of trailing-30-day GMV, capped", async () => {
    const status = await getRewardsBudgetStatus();
    expect(status.gmv30dCents).toBeGreaterThan(0);
    expect(status.budgetCents).toBe(Math.min(status.gmv30dCents, rewardsPolicy().monthlyCapCents));
    expect(status.remainingCents).toBe(Math.max(0, status.budgetCents - status.issuedCents));
  });

  it("stops rewards once the month's budget is spent", async () => {
    const buyerId = newBuyer();
    await withEnv({ THREAD_CASH_REWARDS_MONTHLY_CAP_CENTS: "0" }, async () => {
      await expect(awardDailyCheckInOnce({ buyerId, localDate: "2026-03-01", earnedCents: 10, streakBonusCents: 0, deviceId: testDeviceId() }))
        .rejects.toMatchObject({ code: "THREAD_CASH_REWARDS_BUDGET_EXHAUSTED" });
    });
    expect(await getBalanceCents(db, buyerId)).toBe(0);
  });
});

describe("money ledger", () => {
  it("books each reward as marketing expense owed to the buyer, and reverses it on expiry", async () => {
    const buyerId = newBuyer();
    await awardDailyCheckInOnce({ buyerId, localDate: "2026-04-07", earnedCents: 10, streakBonusCents: 25, deviceId: testDeviceId() });
    const rows = await db.select().from(threadCashEntries).where(eq(threadCashEntries.buyerId, buyerId));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.funding).toBe("promo");
      expect(await ledgerFor(`thread-cash-reward/${row.id}`)).toEqual({
        thread_cash_rewards_expense: -row.amountCents,
        thread_cash_liability: row.amountCents,
      });
    }

    // Credit that lapsed (older than the 90-day policy) leaves the liability.
    const [old] = await db.insert(threadCashEntries).values({
      buyerId, amountCents: 40, source: "daily_checkin", referenceId: "2025-01-01",
      createdAt: new Date(Date.now() - 120 * 86_400_000),
    }).returning();
    expect(await expireThreadCashForBuyer(buyerId)).toBe(40);
    expect(await ledgerFor(`thread-cash-expiry/${old.id}`)).toEqual({
      thread_cash_liability: -40,
      thread_cash_rewards_expense: 40,
    });
    expect(await getBalanceCents(db, buyerId)).toBe(35);
  });

  it("reports what is owed: ledger liability vs wallets, with nothing double-counted", async () => {
    const before = await getThreadCashLiabilityReport();
    const buyerId = newBuyer();
    await awardDailyCheckInOnce({ buyerId, localDate: "2026-05-01", earnedCents: 10, streakBonusCents: 0, deviceId: testDeviceId() });
    const after = await getThreadCashLiabilityReport();
    expect(after.unbookedCents).toBe(
      after.walletBalanceCents + after.openRedemptionsCents + after.pendingSendsCents - after.ledgerLiabilityCents,
    );
    // Booked rewards move the ledger and the wallets together, so the
    // unbooked (pre-ledger) remainder is unchanged by them (other suites may
    // write concurrently, so only the direction is asserted).
    expect(after.ledgerLiabilityCents).toBeGreaterThanOrEqual(before.ledgerLiabilityCents + 10);
    expect(after.rewardsBudget.budgetCents).toBeGreaterThan(0);
  });
});
