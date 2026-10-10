/**
 * Affiliate commissions are funded by the SELLER, never by Brandthread.
 *
 * Owner's rule: a creator's commission is the seller's marketing cost. The
 * buyer's whole payment already went out as usual (Brandthread's 5%, Stripe
 * processing, the rest to the seller), so before a creator is paid the
 * commission is taken back from what that order paid the seller:
 *
 *  fund    `fundCommissionFromSeller`: a Stripe transfer reversal on the
 *          order's own seller transfer (destination charge, cart transfer or
 *          preorder release), never more than that order still has paid out.
 *          Ledger: seller_paid_out → affiliate_commission_reserve (per order).
 *          Runs when the commission is about to be paid (payouts.ts), so a
 *          seller is never charged while creator payouts are switched off.
 *  pay     payouts.ts pays the creator only from funded commissions and posts
 *          affiliate_commission_reserve → affiliate_paid_out.
 *  return  `returnUnneededFunding`: when a refund reverses a commission the
 *          seller already funded (and the creator was not paid that part),
 *          the excess goes back to the seller with a transfer.
 *
 * An order whose seller money is still held by Brandthread is funded later,
 * once it is released: it stays unpaid until then. If Stripe cannot reverse
 * (the seller's balance is empty) the commission simply stays unfunded and
 * unpaid, and the sweep tries again; Brandthread never fronts it.
 *
 * Idempotent: each funding step is keyed by `affiliate-funding/<commission>/
 * <funded so far>` for both the Stripe reversal and the ledger transaction,
 * and the column update is guarded by the previous funded amount.
 */
import { and, eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db, affiliateCommissionEvents, affiliateCommissions, orderReleases, orders, users } from "@workspace/db";
import { logger } from "../logger";
import { accountBalanceCents, postLedgerTransaction } from "../money/ledger";
import { netCommissionCents } from "./commission";

type StripeMoney = Pick<Stripe, "transfers">;

/** What the seller still has to fund: net commission minus what they funded. */
export function fundingNeededCents(c: { amountCents: number; reversedCents: number; sellerFundedCents: number }): number {
  return Math.max(0, netCommissionCents(c) - c.sellerFundedCents);
}

/**
 * Funded money no longer needed for the creator: a refund reversed part of
 * the commission after the seller funded it. What the creator was already
 * paid (and has not yet repaid by netting) stays in reserve.
 */
export function fundingExcessCents(c: { amountCents: number; reversedCents: number; paidCents: number; sellerFundedCents: number }): number {
  return Math.max(0, c.sellerFundedCents - Math.max(netCommissionCents(c), c.paidCents));
}

const fundingKey = (commissionId: string, fundedBefore: number) => `affiliate-funding/${commissionId}/${fundedBefore}`;
const returnKey = (commissionId: string, fundedBefore: number) => `affiliate-funding-return/${commissionId}/${fundedBefore}`;

/** The Stripe transfer that paid this order's seller, if it went out. */
async function sellerTransferFor(order: { id: string; chargeModel: string | null; stripeTransferId: string | null }): Promise<string | null> {
  if (order.chargeModel === "held") {
    const [release] = await db.select({ transferId: orderReleases.stripeTransferId, state: orderReleases.state })
      .from(orderReleases).where(eq(orderReleases.orderId, order.id)).limit(1);
    return release?.state === "paid" ? release.transferId : null;
  }
  return order.stripeTransferId;
}

export type FundingResult = { status: "funded" | "short"; fundedCents: number; neededCents: number };

/**
 * Takes the commission's unfunded part back from the seller's payout for its
 * order. Returns "funded" only when the commission is now fully funded.
 */
export async function fundCommissionFromSeller(stripeClient: StripeMoney, commissionId: string): Promise<FundingResult> {
  const [c] = await db.select().from(affiliateCommissions).where(eq(affiliateCommissions.id, commissionId)).limit(1);
  if (!c) return { status: "short", fundedCents: 0, neededCents: 0 };
  const needed = fundingNeededCents(c);
  if (needed === 0) return { status: "funded", fundedCents: c.sellerFundedCents, neededCents: 0 };

  const [order] = await db.select({
    id: orders.id, chargeModel: orders.chargeModel, stripeTransferId: orders.stripeTransferId,
  }).from(orders).where(eq(orders.id, c.orderId)).limit(1);
  const transferId = order ? await sellerTransferFor(order) : null;
  if (!order || !transferId) {
    // Still held by Brandthread (or never paid out): fund once it is released.
    return { status: "short", fundedCents: c.sellerFundedCents, neededCents: needed };
  }
  const stillPaidOut = await accountBalanceCents(db, { account: "seller_paid_out", partyId: c.sellerId, orderId: c.orderId });
  const take = Math.min(needed, Math.max(0, stillPaidOut));
  if (take <= 0) return { status: "short", fundedCents: c.sellerFundedCents, neededCents: needed };

  const fundedBefore = c.sellerFundedCents;
  const key = fundingKey(c.id, fundedBefore);
  let reversal: Stripe.TransferReversal;
  try {
    reversal = await stripeClient.transfers.createReversal(transferId, {
      amount: take,
      description: "Creator commission on this order, funded by the store",
      metadata: { kind: "affiliate_commission_funding", commissionId: c.id, orderId: c.orderId, sellerId: c.sellerId },
    }, { idempotencyKey: key });
  } catch (err) {
    logger.warn({ err, commissionId: c.id, orderId: c.orderId }, "Affiliate commission could not be taken from the seller yet; the creator is not paid until it is");
    return { status: "short", fundedCents: fundedBefore, neededCents: needed };
  }

  const fundedNow = await db.transaction(async (tx) => {
    const { posted } = await postLedgerTransaction(tx, {
      idempotencyKey: key,
      kind: "affiliate_commission_funded",
      sellerId: c.sellerId,
      orderId: c.orderId,
      stripeObjectId: reversal.id,
      memo: "Creator commission taken back from the seller's payout for this order",
      postings: [
        { account: "seller_paid_out", partyId: c.sellerId, amountCents: -take },
        { account: "affiliate_commission_reserve", partyId: c.sellerId, amountCents: take },
      ],
    });
    if (!posted) {
      const [current] = await tx.select({ funded: affiliateCommissions.sellerFundedCents })
        .from(affiliateCommissions).where(eq(affiliateCommissions.id, c.id)).limit(1);
      return current?.funded ?? fundedBefore;
    }
    const [updated] = await tx.update(affiliateCommissions).set({
      sellerFundedCents: sql`${affiliateCommissions.sellerFundedCents} + ${take}`, updatedAt: new Date(),
    }).where(and(eq(affiliateCommissions.id, c.id), eq(affiliateCommissions.sellerFundedCents, fundedBefore)))
      .returning({ funded: affiliateCommissions.sellerFundedCents });
    if (!updated) throw new Error("Affiliate commission funding changed concurrently");
    await tx.insert(affiliateCommissionEvents).values({
      commissionId: c.id, sellerId: c.sellerId, creatorId: c.creatorId, kind: "seller_funded", amountCents: take,
      meta: { reversalId: reversal.id, transferId },
    });
    return updated.funded;
  });
  const left = fundingNeededCents({ ...c, sellerFundedCents: fundedNow });
  return { status: left === 0 ? "funded" : "short", fundedCents: fundedNow, neededCents: left };
}

/**
 * Gives the seller back funded commission a refund made unnecessary. Skips
 * commissions inside an open payout. Returns the cents returned.
 */
export async function returnUnneededFunding(stripeClient: StripeMoney, commissionId: string): Promise<number> {
  const [c] = await db.select().from(affiliateCommissions).where(eq(affiliateCommissions.id, commissionId)).limit(1);
  if (!c || c.payoutId) return 0;
  const excess = fundingExcessCents(c);
  if (excess <= 0) return 0;
  const [seller] = await db.select({ stripeAccountId: users.stripeAccountId }).from(users)
    .where(eq(users.clerkId, c.sellerId)).limit(1);
  if (!seller?.stripeAccountId) return 0;
  const fundedBefore = c.sellerFundedCents;
  const key = returnKey(c.id, fundedBefore);
  let transfer: Stripe.Transfer;
  try {
    transfer = await stripeClient.transfers.create({
      amount: excess,
      currency: "usd",
      destination: seller.stripeAccountId,
      transfer_group: c.orderId,
      description: "Creator commission returned after a refund",
      metadata: { kind: "affiliate_commission_funding_return", commissionId: c.id, orderId: c.orderId, sellerId: c.sellerId },
    }, { idempotencyKey: key });
  } catch (err) {
    logger.error({ err, commissionId: c.id }, "Returning unneeded affiliate funding failed; the sweep retries it");
    return 0;
  }
  return db.transaction(async (tx) => {
    const { posted } = await postLedgerTransaction(tx, {
      idempotencyKey: key,
      kind: "affiliate_commission_funding_returned",
      sellerId: c.sellerId,
      orderId: c.orderId,
      stripeObjectId: transfer.id,
      memo: "Commission funding returned to the seller after a refund reversed it",
      postings: [
        { account: "affiliate_commission_reserve", partyId: c.sellerId, amountCents: -excess },
        { account: "seller_paid_out", partyId: c.sellerId, amountCents: excess },
      ],
    });
    if (!posted) return 0;
    await tx.update(affiliateCommissions).set({
      sellerFundedCents: sql`${affiliateCommissions.sellerFundedCents} - ${excess}`, updatedAt: new Date(),
    }).where(and(eq(affiliateCommissions.id, c.id), eq(affiliateCommissions.sellerFundedCents, fundedBefore)));
    await tx.insert(affiliateCommissionEvents).values({
      commissionId: c.id, sellerId: c.sellerId, creatorId: c.creatorId, kind: "seller_funding_returned", amountCents: -excess,
      meta: { transferId: transfer.id },
    });
    return excess;
  });
}

/** Sweep: return every seller's funding that refunds made unnecessary. */
export async function returnAllUnneededFunding(stripeClient: StripeMoney, limit = 100): Promise<number> {
  const res = await db.execute(sql`
    SELECT id FROM affiliate_commissions
     WHERE payout_id IS NULL
       AND seller_funded_cents > GREATEST(amount_cents - reversed_cents, paid_cents)
     LIMIT ${limit}
  `);
  let n = 0;
  for (const row of ((res as unknown as { rows?: Array<{ id: string }> }).rows ?? [])) {
    if (await returnUnneededFunding(stripeClient, row.id) > 0) n++;
  }
  return n;
}
