/**
 * Seller Thread Cash cash-out: balance/eligibility checks, the real Stripe
 * Transfer + ledger posting, and exactly-once behavior under a retried
 * idempotency key. Requires a real test database (skipped otherwise, same
 * as every other *.integration.test.ts in this package).
 */
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, ledgerPostings, ledgerTransactions, threadCashEntries, users } from "@workspace/db";
import { createFakeStripe } from "../../money/__tests__/fakeStripe";
import { cashOutThreadCash, computeCashOutPayoutCents } from "../cashOut";
import { getBalanceCents, getCashableBalanceCents, sendLiveGift } from "../wallet";
import { liveStreams } from "@workspace/db";

const testUserIds: string[] = [];

async function makeSeller(withStripeAccount = true): Promise<string> {
  const clerkId = `thread-cash-cash-out-test-${crypto.randomUUID()}`;
  testUserIds.push(clerkId);
  await db.insert(users).values({
    clerkId,
    email: `${clerkId}@test.example`,
    name: "Test Seller",
    stripeAccountId: withStripeAccount ? `acct_test_${crypto.randomUUID().slice(0, 8)}` : null,
  });
  return clerkId;
}

async function grant(sellerId: string, amountCents: number): Promise<void> {
  await db.insert(threadCashEntries).values({
    buyerId: sellerId, amountCents, source: "live_gift", referenceId: crypto.randomUUID(),
  });
}

afterEach(async () => {
  while (testUserIds.length > 0) {
    const id = testUserIds.pop()!;
    await db.delete(threadCashEntries).where(eq(threadCashEntries.buyerId, id));
    // The money ledger is append-only at the database level (migration
    // 084's trigger); its rows reference ids only, so they stay.
    await db.delete(users).where(eq(users.clerkId, id));
  }
});

describe("computeCashOutPayoutCents", () => {
  it("defaults to 1 Thread Cash cent = 1 payout cent, no fee", () => {
    expect(computeCashOutPayoutCents(1_000)).toEqual({ payoutCents: 1_000, feeCents: 0 });
  });
});

describe("cashOutThreadCash", () => {
  it("debits the balance, transfers real money, and posts a balanced ledger entry", async () => {
    const seller = await makeSeller();
    await grant(seller, 2_000);
    const { stripe, state } = createFakeStripe();

    const result = await cashOutThreadCash(stripe, seller, 1_500, crypto.randomUUID());

    expect(result).toEqual({ threadCashCents: 1_500, payoutCents: 1_500, feeCents: 0, transferId: expect.any(String) });
    expect(await getBalanceCents(db, seller)).toBe(500);
    expect(state.transfers).toHaveLength(1);
    expect(state.transfers[0]).toMatchObject({ amount: 1_500, currency: "usd", destination: expect.stringContaining("acct_test_") });

    const [txn] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.sellerId, seller)).limit(1);
    expect(txn?.kind).toBe("thread_cash_seller_cash_out");
    const postings = await db.select().from(ledgerPostings).where(eq(ledgerPostings.transactionId, txn!.id));
    expect(postings.map((p) => p.amountCents).sort()).toEqual([-1_500, 1_500]);
  });

  it("rejects cashing out more than the current balance", async () => {
    const seller = await makeSeller();
    await grant(seller, 500);
    const { stripe, state } = createFakeStripe();

    await expect(cashOutThreadCash(stripe, seller, 1_000, crypto.randomUUID()))
      .rejects.toMatchObject({ code: "INSUFFICIENT_THREAD_CASH" });
    expect(state.transfers).toHaveLength(0);
  });

  it("rejects a seller with no connected Stripe account", async () => {
    const seller = await makeSeller(false);
    await grant(seller, 1_000);
    const { stripe, state } = createFakeStripe();

    await expect(cashOutThreadCash(stripe, seller, 500, crypto.randomUUID()))
      .rejects.toMatchObject({ code: "THREAD_CASH_CASH_OUT_NO_STRIPE_ACCOUNT" });
  });

  it("is idempotent under a retried key: the balance is only ever debited once", async () => {
    const seller = await makeSeller();
    await grant(seller, 2_000);
    const { stripe, state } = createFakeStripe();
    const idempotencyKey = crypto.randomUUID();

    const first = await cashOutThreadCash(stripe, seller, 1_000, idempotencyKey);
    const second = await cashOutThreadCash(stripe, seller, 1_000, idempotencyKey);

    expect(second).toEqual(first);
    expect(await getBalanceCents(db, seller)).toBe(1_000);
    expect(state.transfers).toHaveLength(1);
  });

  it("never debits the balance when the Stripe transfer fails", async () => {
    const seller = await makeSeller();
    await grant(seller, 1_000);
    const { stripe, state } = createFakeStripe();
    state.failNextTransfer = "definitive";

    await expect(cashOutThreadCash(stripe, seller, 500, crypto.randomUUID()))
      .rejects.toMatchObject({ code: "THREAD_CASH_CASH_OUT_TRANSFER_FAILED" });
    expect(await getBalanceCents(db, seller)).toBe(1_000);
  });

  it("never cashes out platform reward credit (check-ins, streaks, refunds)", async () => {
    const seller = await makeSeller();
    await db.insert(threadCashEntries).values([
      { buyerId: seller, amountCents: 500, source: "daily_checkin", referenceId: "2026-10-01" },
      { buyerId: seller, amountCents: 300, source: "streak_bonus", referenceId: crypto.randomUUID() },
    ]);
    const { stripe, state } = createFakeStripe();

    expect(await getCashableBalanceCents(db, seller)).toBe(0);
    await expect(cashOutThreadCash(stripe, seller, 100, crypto.randomUUID()))
      .rejects.toMatchObject({ code: "THREAD_CASH_NOT_CASHABLE" });
    expect(state.transfers).toHaveLength(0);
    expect(await getBalanceCents(db, seller)).toBe(800);
  });

  it("cashes out only what was earned, even with rewards in the same balance", async () => {
    const seller = await makeSeller();
    await grant(seller, 1_000);
    await db.insert(threadCashEntries).values({ buyerId: seller, amountCents: 700, source: "daily_checkin", referenceId: "2026-10-02" });
    const { stripe } = createFakeStripe();

    expect(await getCashableBalanceCents(db, seller)).toBe(1_000);
    await expect(cashOutThreadCash(stripe, seller, 1_200, crypto.randomUUID()))
      .rejects.toMatchObject({ code: "THREAD_CASH_NOT_CASHABLE" });
    await cashOutThreadCash(stripe, seller, 1_000, crypto.randomUUID());
    expect(await getCashableBalanceCents(db, seller)).toBe(0);
    expect(await getBalanceCents(db, seller)).toBe(700);
  });

  it("never replays another user's cash-out for a reused idempotency key", async () => {
    const a = await makeSeller();
    const b = await makeSeller();
    await grant(a, 500);
    await grant(b, 500);
    const { stripe, state } = createFakeStripe();
    const key = crypto.randomUUID();

    await cashOutThreadCash(stripe, a, 400, key);
    await expect(cashOutThreadCash(stripe, b, 400, key))
      .rejects.toMatchObject({ code: "THREAD_CASH_IDEMPOTENCY_KEY_REUSED" });
    expect(state.transfers).toHaveLength(1);
    expect(await getBalanceCents(db, b)).toBe(500);
  });

  it("a cash-out racing a live gift by the same seller never overdraws the balance", async () => {
    const seller = await makeSeller();
    const host = await makeSeller();
    const streamId = crypto.randomUUID();
    await db.insert(liveStreams).values({ id: streamId, sellerId: host, channelName: `cash-out-race-${streamId}`, title: "Race", status: "live" });
    try {
      const { stripe } = createFakeStripe();
      // Each round leaves exactly 150 in the balance and races two writes
      // that each want all of it: at most one may win.
      for (let i = 0; i < 8; i++) {
        const balance = await getBalanceCents(db, seller);
        await grant(seller, 150 - balance);
        await Promise.allSettled([
          cashOutThreadCash(stripe, seller, 150, crypto.randomUUID()),
          sendLiveGift(seller, host, streamId, 150, crypto.randomUUID()),
        ]);
        expect(await getBalanceCents(db, seller)).toBeGreaterThanOrEqual(0);
      }
    } finally {
      await db.delete(liveStreams).where(eq(liveStreams.id, streamId));
    }
  });
});
