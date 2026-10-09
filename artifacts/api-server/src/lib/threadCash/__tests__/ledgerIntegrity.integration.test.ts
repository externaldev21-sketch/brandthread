/**
 * Database-level Thread Cash guarantees (migration 420):
 *  - every wallet entry is mirrored by two journal postings that sum to zero
 *  - a debit that would overdraw a wallet is rejected at COMMIT, even when the
 *    application forgot to check, and even under concurrency
 *  - entry amounts are immutable
 *  - the daily reward is capped per device across accounts, and needs a device
 */
import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db, threadCashConfig, threadCashDeviceClaims, threadCashEntries, threadCashJournal, threadCashStreaks,
} from "@workspace/db";
import { ThreadCashError, awardDailyCheckInOnce, getBalanceCents } from "../wallet";

const testBuyerIds: string[] = [];

afterEach(async () => {
  if (testBuyerIds.length === 0) return;
  const ids = testBuyerIds.splice(0);
  await db.delete(threadCashEntries).where(inArray(threadCashEntries.buyerId, ids));
  await db.delete(threadCashStreaks).where(inArray(threadCashStreaks.buyerId, ids));
  await db.delete(threadCashDeviceClaims).where(inArray(threadCashDeviceClaims.buyerId, ids));
});

function newBuyerId(): string {
  const id = `thread-cash-ledger-test-${crypto.randomUUID()}`;
  testBuyerIds.push(id);
  return id;
}

async function credit(buyerId: string, amountCents: number, source = "admin_adjustment") {
  const [row] = await db.insert(threadCashEntries)
    .values({ buyerId, amountCents, source, referenceId: `test-${crypto.randomUUID()}` })
    .returning({ id: threadCashEntries.id });
  return row.id;
}

describe("double-entry journal", () => {
  it("mirrors every entry as a wallet posting and an opposite counter-account posting", async () => {
    const buyerId = newBuyerId();
    const creditId = await credit(buyerId, 500, "daily_checkin");
    const debitId = await credit(buyerId, -200, "checkout_spend");

    const postings = await db.select().from(threadCashJournal)
      .where(inArray(threadCashJournal.entryId, [creditId, debitId]));
    expect(postings).toHaveLength(4);
    expect(postings.reduce((sum, p) => sum + p.amountCents, 0)).toBe(0);
    expect(postings.find((p) => p.entryId === creditId && p.account === "wallet")?.amountCents).toBe(500);
    expect(postings.find((p) => p.entryId === creditId && p.account === "rewards_issued")?.amountCents).toBe(-500);
    expect(postings.find((p) => p.entryId === debitId && p.account === "checkout_redemptions")?.amountCents).toBe(200);

    const walletSum = postings.filter((p) => p.account === "wallet").reduce((s, p) => s + p.amountCents, 0);
    expect(walletSum).toBe(await getBalanceCents(db, buyerId));

    const unbalanced = await db.execute(sql`
      SELECT entry_id FROM thread_cash_journal_unbalanced WHERE entry_id IN (${creditId}::uuid, ${debitId}::uuid)`);
    expect(unbalanced.rows).toHaveLength(0);
  });

  it("nets a friend transfer to zero in the transfer clearing account", async () => {
    const sender = newBuyerId();
    const recipient = newBuyerId();
    const transferRef = `transfer-${crypto.randomUUID()}`;
    await credit(sender, 300);
    await db.insert(threadCashEntries).values([
      { buyerId: sender, amountCents: -100, source: "send_sent", referenceId: transferRef },
      { buyerId: recipient, amountCents: 100, source: "send_received", referenceId: transferRef },
    ]);
    const [clearing] = (await db.execute(sql`
      SELECT COALESCE(SUM(amount_cents), 0)::int AS total FROM thread_cash_journal
      WHERE account = 'transfer_clearing' AND party_id = ${transferRef}`)).rows as Array<{ total: number }>;
    expect(clearing.total).toBe(0);
  });

  it("refuses to change an entry's amount after the fact", async () => {
    const buyerId = newBuyerId();
    const id = await credit(buyerId, 100);
    await expect(db.update(threadCashEntries).set({ amountCents: 100_000 }).where(eq(threadCashEntries.id, id)))
      .rejects.toThrow();
    // Bookkeeping columns stay writable.
    await db.update(threadCashEntries).set({ note: "ok" }).where(eq(threadCashEntries.id, id));
  });
});

describe("no negative wallets", () => {
  it("rejects a debit larger than the balance", async () => {
    const buyerId = newBuyerId();
    await credit(buyerId, 100);
    const error = await credit(buyerId, -101, "checkout_spend").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as { cause?: { constraint?: string } }).cause?.constraint).toBe("thread_cash_wallet_not_overdrawn");
    expect(await getBalanceCents(db, buyerId)).toBe(100);
  });

  it("allows spending down to exactly zero", async () => {
    const buyerId = newBuyerId();
    await credit(buyerId, 100);
    await credit(buyerId, -100, "checkout_spend");
    expect(await getBalanceCents(db, buyerId)).toBe(0);
  });

  it("checks at commit, so a debit then a credit in one transaction is fine", async () => {
    const buyerId = newBuyerId();
    await db.transaction(async (tx) => {
      await tx.insert(threadCashEntries).values({ buyerId, amountCents: -50, source: "checkout_spend" });
      await tx.insert(threadCashEntries).values({ buyerId, amountCents: 50, source: "refund_credit" });
    });
    expect(await getBalanceCents(db, buyerId)).toBe(0);
  });

  it("lets only one of two concurrent debits through when the balance covers one", async () => {
    const buyerId = newBuyerId();
    await credit(buyerId, 100);
    const results = await Promise.allSettled(
      Array.from({ length: 2 }, () => db.transaction(async (tx) => {
        await tx.insert(threadCashEntries).values({ buyerId, amountCents: -80, source: "checkout_spend" });
        await tx.execute(sql`SELECT pg_sleep(0.05)`);
      })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await getBalanceCents(db, buyerId)).toBe(20);
  });

  it("never blocks a credit", async () => {
    const buyerId = newBuyerId();
    await credit(buyerId, 25);
    expect(await getBalanceCents(db, buyerId)).toBe(25);
  });
});

describe("daily reward per device", () => {
  it("pays one account per device per day by default, whichever account claims first", async () => {
    const deviceId = `device-${crypto.randomUUID()}`;
    const first = newBuyerId();
    const second = newBuyerId();
    await awardDailyCheckInOnce({ buyerId: first, deviceId, localDate: "2025-06-01", earnedCents: 10, streakBonusCents: 0 });
    await expect(awardDailyCheckInOnce({
      buyerId: second, deviceId, localDate: "2025-06-01", earnedCents: 10, streakBonusCents: 0,
    })).rejects.toMatchObject({ code: "THREAD_CASH_DEVICE_CHECKIN_CAP", status: 429 });
    expect(await getBalanceCents(db, second)).toBe(0);
    // The next day the second account can claim on that device.
    await awardDailyCheckInOnce({ buyerId: second, deviceId, localDate: "2025-06-02", earnedCents: 10, streakBonusCents: 0 });
    expect(await getBalanceCents(db, second)).toBe(10);
  });

  it("follows the moderator-configured per-device limit", async () => {
    const [config] = await db.select().from(threadCashConfig).where(eq(threadCashConfig.id, "default"));
    if (!config) await db.insert(threadCashConfig).values({ id: "default" }).onConflictDoNothing();
    const previous = config?.maxCheckInsPerDevicePerDay ?? 1;
    await db.update(threadCashConfig).set({ maxCheckInsPerDevicePerDay: 2 }).where(eq(threadCashConfig.id, "default"));
    try {
      const deviceId = `device-${crypto.randomUUID()}`;
      const [a, b, c] = [newBuyerId(), newBuyerId(), newBuyerId()];
      await awardDailyCheckInOnce({ buyerId: a, deviceId, localDate: "2025-06-01", earnedCents: 10, streakBonusCents: 0 });
      await awardDailyCheckInOnce({ buyerId: b, deviceId, localDate: "2025-06-01", earnedCents: 10, streakBonusCents: 0 });
      await expect(awardDailyCheckInOnce({
        buyerId: c, deviceId, localDate: "2025-06-01", earnedCents: 10, streakBonusCents: 0,
      })).rejects.toBeInstanceOf(ThreadCashError);
    } finally {
      await db.update(threadCashConfig).set({ maxCheckInsPerDevicePerDay: previous }).where(eq(threadCashConfig.id, "default"));
    }
  });

  it("refuses a claim with no device id (the old way around the device cap)", async () => {
    const buyerId = newBuyerId();
    await expect(awardDailyCheckInOnce({ buyerId, localDate: "2025-06-01", earnedCents: 10, streakBonusCents: 0 }))
      .rejects.toMatchObject({ code: "THREAD_CASH_DEVICE_REQUIRED", status: 400 });
    expect(await getBalanceCents(db, buyerId)).toBe(0);
  });

  it("lets the same account re-claim idempotently on the same device", async () => {
    const deviceId = `device-${crypto.randomUUID()}`;
    const buyerId = newBuyerId();
    const first = await awardDailyCheckInOnce({ buyerId, deviceId, localDate: "2025-06-01", earnedCents: 10, streakBonusCents: 0 });
    const second = await awardDailyCheckInOnce({ buyerId, deviceId, localDate: "2025-06-01", earnedCents: 10, streakBonusCents: 0 });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(await getBalanceCents(db, buyerId)).toBe(10);
  });
});
