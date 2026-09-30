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
import { getBalanceCents } from "../wallet";

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
    await db.delete(ledgerPostings).where(eq(ledgerPostings.partyId, id));
    await db.delete(ledgerTransactions).where(eq(ledgerTransactions.sellerId, id));
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
});
