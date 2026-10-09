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
import { getBalanceCents, getCashableBalanceCents } from "../wallet";

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

/** A Live gift a buyer paid real money for (the only cashable Thread Cash). */
async function grant(sellerId: string, amountCents: number, source = "live_gift", funding: "paid" | "promo" = "paid"): Promise<void> {
  await db.insert(threadCashEntries).values({
    buyerId: sellerId, amountCents, source, funding, referenceId: crypto.randomUUID(),
  });
}

afterEach(async () => {
  while (testUserIds.length > 0) {
    const id = testUserIds.pop()!;
    // Ledger rows are immutable (migration 084) and stay; only wallet rows go.
    await db.delete(threadCashEntries).where(eq(threadCashEntries.buyerId, id));
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
    expect(postings.reduce((sum, p) => sum + p.amountCents, 0)).toBe(0);
    const byAccount = (account: string) => postings.filter((p) => p.account === account).reduce((sum, p) => sum + p.amountCents, 0);
    expect(byAccount("seller_paid_out")).toBe(1_500);
    // The Thread Cash is no longer owed once it is cashed out.
    expect(byAccount("thread_cash_liability")).toBe(-1_500);
  });

  it("never cashes out reward or promo credit, nor a peer send — only paid Live gifts", async () => {
    const seller = await makeSeller();
    await grant(seller, 1_000, "daily_checkin", "promo");
    await grant(seller, 1_000, "streak_bonus", "promo");
    await grant(seller, 1_000, "referral", "promo");
    await grant(seller, 1_000, "refund_credit", "promo");
    await grant(seller, 1_000, "live_gift", "promo"); // a buyer relayed reward credit
    await grant(seller, 1_000, "send_received", "paid"); // peer sends are never an earnings rail
    const { stripe, state } = createFakeStripe();

    await expect(cashOutThreadCash(stripe, seller, 1, crypto.randomUUID()))
      .rejects.toMatchObject({ code: "THREAD_CASH_NOT_CASHABLE" });
    expect(state.transfers).toHaveLength(0);
    expect(await getCashableBalanceCents(db, seller)).toBe(0);

    await grant(seller, 700);
    expect(await getCashableBalanceCents(db, seller)).toBe(700);
    await expect(cashOutThreadCash(stripe, seller, 701, crypto.randomUUID()))
      .rejects.toMatchObject({ code: "THREAD_CASH_NOT_CASHABLE" });
    await cashOutThreadCash(stripe, seller, 700, crypto.randomUUID());
    expect(state.transfers).toHaveLength(1);
    expect(await getCashableBalanceCents(db, seller)).toBe(0);
    expect(await getBalanceCents(db, seller)).toBe(6_000);
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
