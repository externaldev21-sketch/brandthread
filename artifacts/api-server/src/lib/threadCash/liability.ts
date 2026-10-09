/**
 * Thread Cash on the money ledger (lib/money/ledger.ts), so finance can see
 * what Brandthread owes in Thread Cash at any moment.
 *
 *   issued   reward credit   rewards_expense −X / liability +X
 *   spent    at checkout      liability −X / seller_topup +X   (the top-up
 *            transfer itself posts seller_topup −X / seller_paid_out +X)
 *   returned refunded spend   liability +X / seller_topup −X
 *   expired  promo credit     liability −X / rewards_expense +X
 *   cashed   out              liability −X / seller_cash_out +X (cashOut.ts,
 *            in the cash-out's own ledger transaction)
 *
 * Sends and Live gifts move Thread Cash between holders and leave the total
 * owed unchanged, so they post nothing. Every posting is keyed by the ledger
 * row or order it describes, so retries never double-post.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, threadCashEntries, threadCashTransfers } from "@workspace/db";
import { accountBalanceCents, postLedgerTransaction, type DbExecutor } from "../money/ledger";
import { getRewardsBudgetStatus, type RewardsBudgetStatus } from "./earnGate";

export async function postRewardIssued(
  tx: DbExecutor,
  input: { entryId: string; buyerId: string; amountCents: number; source: string },
): Promise<void> {
  if (input.amountCents <= 0) return;
  await postLedgerTransaction(tx, {
    idempotencyKey: `thread-cash-reward/${input.entryId}`,
    kind: "thread_cash_reward_issued",
    memo: `Thread Cash reward issued (${input.source})`,
    postings: [
      { account: "thread_cash_rewards_expense", partyId: input.buyerId, amountCents: -input.amountCents },
      { account: "thread_cash_liability", amountCents: input.amountCents },
    ],
  });
}

export async function postRewardExpired(
  tx: DbExecutor,
  input: { lotEntryId: string; buyerId: string; amountCents: number },
): Promise<void> {
  if (input.amountCents <= 0) return;
  await postLedgerTransaction(tx, {
    idempotencyKey: `thread-cash-expiry/${input.lotEntryId}`,
    kind: "thread_cash_expired",
    memo: "Unspent Thread Cash reward expired",
    postings: [
      { account: "thread_cash_liability", amountCents: -input.amountCents },
      { account: "thread_cash_rewards_expense", partyId: input.buyerId, amountCents: input.amountCents },
    ],
  });
}

export async function postThreadCashSpent(
  tx: DbExecutor,
  input: { orderId: string; amountCents: number },
): Promise<void> {
  if (input.amountCents <= 0) return;
  await postLedgerTransaction(tx, {
    idempotencyKey: `thread-cash-spent/${input.orderId}`,
    kind: "thread_cash_spent",
    orderId: input.orderId,
    memo: "Thread Cash spent at checkout (Brandthread funds the seller's top-up)",
    postings: [
      { account: "thread_cash_liability", amountCents: -input.amountCents },
      { account: "thread_cash_seller_topup", amountCents: input.amountCents },
    ],
  });
}

export async function postThreadCashSpendReturned(
  tx: DbExecutor,
  input: { orderId: string; amountCents: number },
): Promise<void> {
  if (input.amountCents <= 0) return;
  await postLedgerTransaction(tx, {
    idempotencyKey: `thread-cash-spend-returned/${input.orderId}`,
    kind: "thread_cash_spend_returned",
    orderId: input.orderId,
    memo: "Thread Cash spent on a refunded order returned to the buyer",
    postings: [
      { account: "thread_cash_liability", amountCents: input.amountCents },
      { account: "thread_cash_seller_topup", amountCents: -input.amountCents },
    ],
  });
}

export type ThreadCashLiabilityReport = {
  asOf: string;
  /** What the ledger says is owed (thread_cash_liability). */
  ledgerLiabilityCents: number;
  /** SUM of every wallet: what holders can see. */
  walletBalanceCents: number;
  /** Redeemed into a checkout token but not yet spent on an order — still owed. */
  openRedemptionsCents: number;
  /** Sent to a friend, not yet claimed (left the sender's wallet) — still owed. */
  pendingSendsCents: number;
  /** Wallet balances by funding. Only paid funds can ever be cashed out. */
  promoCents: number;
  paidCents: number;
  /**
   * Owed but never booked: credit issued before the ledger tracked Thread
   * Cash (wallets + open redemptions + pending sends − ledger liability). Book it once with
   * an opening entry when finance signs off on the treatment.
   */
  unbookedCents: number;
  rewardsBudget: RewardsBudgetStatus;
};

export async function getThreadCashLiabilityReport(
  executor: DbExecutor = db,
  now = new Date(),
): Promise<ThreadCashLiabilityReport> {
  const [ledgerLiabilityCents, [wallets], [open], [pending], rewardsBudget] = await Promise.all([
    accountBalanceCents(executor, { account: "thread_cash_liability" }),
    executor.select({
      total: sql<string>`COALESCE(SUM(${threadCashEntries.amountCents}), 0)`,
      promo: sql<string>`COALESCE(SUM(${threadCashEntries.amountCents}) FILTER (WHERE ${threadCashEntries.funding} = 'promo'), 0)`,
      paid: sql<string>`COALESCE(SUM(${threadCashEntries.amountCents}) FILTER (WHERE ${threadCashEntries.funding} = 'paid'), 0)`,
    }).from(threadCashEntries),
    executor.select({
      total: sql<string>`COALESCE(SUM(-${threadCashEntries.amountCents}), 0)`,
    }).from(threadCashEntries).where(and(
      eq(threadCashEntries.source, "redemption"),
      isNull(threadCashEntries.usedAt),
    )),
    executor.select({
      total: sql<string>`COALESCE(SUM(${threadCashTransfers.amountCents}), 0)`,
    }).from(threadCashTransfers).where(eq(threadCashTransfers.status, "pending")),
    getRewardsBudgetStatus(executor, now),
  ]);
  const walletBalanceCents = Number(wallets?.total ?? 0);
  const openRedemptionsCents = Math.max(0, Number(open?.total ?? 0));
  const pendingSendsCents = Math.max(0, Number(pending?.total ?? 0));
  return {
    asOf: now.toISOString(),
    ledgerLiabilityCents,
    walletBalanceCents,
    openRedemptionsCents,
    pendingSendsCents,
    promoCents: Number(wallets?.promo ?? 0),
    paidCents: Number(wallets?.paid ?? 0),
    unbookedCents: walletBalanceCents + openRedemptionsCents + pendingSendsCents - ledgerLiabilityCents,
    rewardsBudget,
  };
}
