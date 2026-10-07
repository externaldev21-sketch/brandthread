/**
 * Seller Thread Cash cash-out: converts a seller's earned Thread Cash
 * (from Live gifts and message payments — see thread_cash_entries sources
 * 'live_gift' / 'send_received') into real money in their Stripe Connect
 * payout balance, exactly like `checkoutTopup.ts`'s buyer-side top-up: a
 * platform-funded Stripe Transfer to the seller's connected account,
 * recorded in the double-entry ledger, idempotency-keyed so a retried
 * request can never double-pay.
 *
 * Thread Cash a seller has EARNED (unlike a buyer's platform-funded reward
 * credit) is real value owed to them — buyers paid real money for it via
 * Apple IAP (see docs/payments/thread-cash-cash-out.md for the full
 * accounting note) — so, unlike buyer Thread Cash, it is cashable.
 */
import type Stripe from "stripe";
import { eq, sql } from "drizzle-orm";
import { db, threadCashEntries, users } from "@workspace/db";
import { postLedgerTransaction } from "../money/ledger";
import { ThreadCashError, assertThreadCashNotFrozen, balanceLockKey, getBalanceCents, getCashableBalanceCents } from "./wallet";
import { payoutPauseForRecovery } from "../money/sellerRecovery";

type StripeLike = {
  transfers: {
    create: (
      params: Stripe.TransferCreateParams,
      options?: Stripe.RequestOptions,
    ) => Promise<Stripe.Transfer>;
  };
};

/**
 * The cash-out rate and fee, in basis points (10,000 = 100%). Dev can
 * change these two constants at any time — no migration, no redeploy of
 * anything else. Default: 1 Thread Cash cent = 1 payout cent (1 TC = $1),
 * no fee. If a fee is ever introduced, the UI (Payouts screen) reads
 * `computeCashOutPayoutCents` so it always shows the real fee live.
 */
export const THREAD_CASH_CASH_OUT_RATE_BPS = 10_000;
export const THREAD_CASH_CASH_OUT_FEE_BPS = 0;

export function computeCashOutPayoutCents(threadCashCents: number): { payoutCents: number; feeCents: number } {
  const grossCents = Math.floor((threadCashCents * THREAD_CASH_CASH_OUT_RATE_BPS) / 10_000);
  const feeCents = Math.floor((grossCents * THREAD_CASH_CASH_OUT_FEE_BPS) / 10_000);
  return { payoutCents: grossCents - feeCents, feeCents };
}

export type CashOutResult = {
  threadCashCents: number;
  payoutCents: number;
  feeCents: number;
  transferId: string;
};

export async function cashOutThreadCash(
  stripeClient: StripeLike | null,
  sellerId: string,
  threadCashCents: number,
  idempotencyKey: string,
): Promise<CashOutResult> {
  if (!Number.isInteger(threadCashCents) || threadCashCents < 1) {
    throw new ThreadCashError("Enter a valid Thread Cash amount.");
  }
  if (!idempotencyKey || idempotencyKey.length > 160) {
    throw new ThreadCashError("A valid idempotency key is required.", 400, "THREAD_CASH_IDEMPOTENCY_KEY_REQUIRED");
  }
  if (!stripeClient) {
    throw new ThreadCashError("Cash out isn't available right now. Try again shortly.", 502, "THREAD_CASH_CASH_OUT_UNAVAILABLE");
  }

  return db.transaction(async (tx) => {
    // The same per-user balance lock sends, live gifts and checkout
    // redemptions take — a cash-out racing any of them could otherwise
    // pass its balance check while the other also spends the same cents,
    // leaving a negative balance after a real transfer was already paid.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${balanceLockKey(sellerId)}))`);

    const [existing] = await tx.select()
      .from(threadCashEntries)
      .where(eq(threadCashEntries.idempotencyKey, idempotencyKey))
      .limit(1);
    if (existing) {
      // Keys are unique across every user's entries: only this seller's own
      // earlier cash-out may be replayed, never someone else's transfer.
      if (existing.buyerId !== sellerId || existing.source !== "cash_out") {
        throw new ThreadCashError("This request key was already used. Try again.", 409, "THREAD_CASH_IDEMPOTENCY_KEY_REUSED");
      }
      const debitedCents = -existing.amountCents;
      const { payoutCents, feeCents } = computeCashOutPayoutCents(debitedCents);
      return { threadCashCents: debitedCents, payoutCents, feeCents, transferId: existing.referenceId ?? "" };
    }

    await assertThreadCashNotFrozen(tx, sellerId);

    const balance = await getBalanceCents(tx, sellerId);
    if (threadCashCents > balance) {
      throw new ThreadCashError(
        `Insufficient Thread Cash. You have $${(balance / 100).toFixed(2)}.`,
        400,
        "INSUFFICIENT_THREAD_CASH",
      );
    }
    // Only paid Thread Cash received from other people is real money owed
    // to the seller; promo credit (rewards, and promo a buyer gifted) is
    // spendable in Brandthread but never withdrawable (./funding.ts).
    const cashable = await getCashableBalanceCents(tx, sellerId);
    if (threadCashCents > cashable) {
      throw new ThreadCashError(
        cashable > 0
          ? `You can withdraw up to $${(cashable / 100).toFixed(2)}. Promo credit isn't withdrawable — it can be spent in Brandthread.`
          : "Promo credit isn't withdrawable — it can be spent in Brandthread. Only Thread Cash buyers paid for can be cashed out.",
        400,
        "THREAD_CASH_NOT_CASHABLE",
      );
    }
    // A lost chargeback still being recovered pauses every payout, this one too.
    const recovery = await payoutPauseForRecovery(tx, sellerId);
    if (recovery.paused) {
      throw new ThreadCashError(
        `Payouts are paused while $${(recovery.owedCents / 100).toFixed(2)} from a lost chargeback is recovered from your upcoming order payouts.`,
        409,
        "PAYOUTS_PAUSED_RECOVERY",
      );
    }

    const [seller] = await tx.select({ stripeAccountId: users.stripeAccountId })
      .from(users).where(eq(users.clerkId, sellerId)).limit(1);
    if (!seller?.stripeAccountId) {
      throw new ThreadCashError("Connect Stripe to cash out your Thread Cash.", 400, "THREAD_CASH_CASH_OUT_NO_STRIPE_ACCOUNT");
    }

    const { payoutCents, feeCents } = computeCashOutPayoutCents(threadCashCents);
    if (payoutCents < 1) {
      throw new ThreadCashError("That's too small an amount to cash out.", 400, "THREAD_CASH_CASH_OUT_TOO_SMALL");
    }

    let transfer: Stripe.Transfer;
    try {
      transfer = await stripeClient.transfers.create({
        amount: payoutCents,
        currency: "usd",
        destination: seller.stripeAccountId,
        metadata: { sellerId, kind: "thread_cash_cash_out", threadCashCents: String(threadCashCents) },
      }, { idempotencyKey: `thread-cash-cash-out/${idempotencyKey}` });
    } catch (err) {
      throw new ThreadCashError("Could not process the cash out right now. Try again.", 502, "THREAD_CASH_CASH_OUT_TRANSFER_FAILED");
    }

    await tx.insert(threadCashEntries).values({
      buyerId: sellerId,
      amountCents: -threadCashCents,
      source: "cash_out",
      // Cash-outs only ever spend paid Thread Cash (cashable ≤ paid balance).
      funding: "paid",
      referenceId: transfer.id,
      idempotencyKey,
      note: feeCents > 0
        ? `Cashed out $${(threadCashCents / 100).toFixed(2)} Thread Cash for $${(payoutCents / 100).toFixed(2)} (fee $${(feeCents / 100).toFixed(2)})`
        : `Cashed out $${(threadCashCents / 100).toFixed(2)} Thread Cash for $${(payoutCents / 100).toFixed(2)}`,
    });

    await postLedgerTransaction(tx, {
      idempotencyKey: `thread-cash-cash-out/${idempotencyKey}`,
      kind: "thread_cash_seller_cash_out",
      sellerId,
      stripeObjectId: transfer.id,
      memo: "Seller cashed out Thread Cash to their payout balance",
      postings: [
        { account: "thread_cash_seller_cash_out", amountCents: -payoutCents },
        { account: "seller_paid_out", partyId: sellerId, amountCents: payoutCents },
      ],
    });

    return { threadCashCents, payoutCents, feeCents, transferId: transfer.id };
  });
}
