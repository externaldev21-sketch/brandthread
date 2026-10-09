/**
 * Seller recovery: money a seller owes Brandthread, collected from their
 * next order payouts.
 *
 * What lands here (ledger account seller_recoverable, party = seller,
 * negative = owed):
 *  - Refund costs Brandthread fronted. A refund before the seller was paid
 *    returns the buyer's whole payment, but the order only holds the
 *    seller's net (Stripe's fee and any label were already paid from it).
 *    The part the order's own money can't cover is owed by the seller
 *    (refunds.ts). Drop orders keep using their drop's pool, which later
 *    releases of the drop absorb.
 *  - Stripe's dispute fee, once the dispute is closed and the final fee is
 *    known from the dispute's balance transactions (Stripe returns it on
 *    some wins; then nothing is owed).
 *  - A lost chargeback: the part of the withdrawn amount that the order's
 *    held money did not cover (dev records it at funds_withdrawn as
 *    platform_funds_advanced or seller-level seller_held) moves here when
 *    the dispute is lost. An open dispute is never collected: if it is won,
 *    Stripe returns the money and the withdrawal is simply reversed.
 *
 * Collection: every order release (escrow.ts executeOrderRelease) and
 * one-page-checkout transfer (cartTransfers.ts settleTransferOrder) nets the
 * seller's debt first: seller_held(order) −n → seller_recoverable +n, so the
 * transfer shrinks by exactly n. The amount is decided once, before the
 * first transfer attempt, and stored (recovery_netted_cents), so a retry
 * sends the same amount under the same idempotency key.
 *
 * Every movement is one balanced ledger transaction with a deterministic
 * idempotency key, posted in the same database transaction as the state it
 * describes.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "../logger";
import { accountBalanceCents, postLedgerTransaction, type DbExecutor, type LedgerPosting } from "./ledger";

function rows<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []);
}

/** Stripe's US dispute fee, used only when a lost dispute carries no balance transactions. */
export function defaultDisputeFeeCents(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.STRIPE_DISPUTE_FEE_CENTS);
  return env.STRIPE_DISPUTE_FEE_CENTS !== undefined && Number.isSafeInteger(raw) && raw >= 0 ? raw : 1_500;
}

/** The dispute fee Stripe charged (net of any it returned), from the dispute's balance transactions. */
export function disputeFeeFromDispute(dispute: any, fallback = defaultDisputeFeeCents()): number {
  const bts = Array.isArray(dispute?.balance_transactions) ? dispute.balance_transactions : [];
  const objects = bts.filter((bt: unknown) => bt && typeof bt === "object" && Number.isSafeInteger((bt as any).fee));
  if (objects.length === 0) return fallback;
  return Math.max(0, objects.reduce((sum: number, bt: any) => sum + bt.fee, 0));
}

export function recoveryLockKey(sellerId: string): string {
  return `seller-recovery:${sellerId}`;
}

async function lockSellerRecoveries(executor: DbExecutor, sellerId: string): Promise<void> {
  await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${recoveryLockKey(sellerId)}))`);
}

/** What the seller owes Brandthread right now (0 when nothing is owed). */
export async function sellerRecoveryOwedCents(executor: DbExecutor, sellerId: string): Promise<number> {
  return Math.max(0, -(await accountBalanceCents(executor, { account: "seller_recoverable", partyId: sellerId })));
}

/**
 * Where a refund's seller share goes when the order's own money can't cover
 * it: a drop order's pool (absorbed by the drop's later releases), else a
 * debt the seller owes, netted from their next payouts.
 */
export function refundShortfallPosting(
  order: { id: string; owner_id: string; drop_id: string | null },
  amountCents: number,
): LedgerPosting {
  return order.drop_id
    ? { account: "seller_held", partyId: order.owner_id, orderId: null, amountCents }
    : { account: "seller_recoverable", partyId: order.owner_id, orderId: order.id, dropId: null, amountCents };
}

/**
 * Nets what the seller owes from money about to be released to them. Posts
 * seller_held(order) −n → seller_recoverable +n, so the order's held balance
 * (and therefore the transfer) shrinks by exactly n. Must run inside the
 * release's transaction; the caller records the result so a retried
 * transfer sends the same amount.
 */
export async function netRecoveriesFromRelease(tx: DbExecutor, input: {
  sellerId: string;
  orderId: string;
  dropId?: string | null;
  availableCents: number;
  /** Unique per release, e.g. order-release/<orderId>. */
  ledgerKey: string;
  releaseRef?: string | null;
}): Promise<{ nettedCents: number }> {
  if (input.availableCents <= 0) return { nettedCents: 0 };
  await lockSellerRecoveries(tx, input.sellerId);
  const owed = await sellerRecoveryOwedCents(tx, input.sellerId);
  const take = Math.min(owed, input.availableCents);
  if (take <= 0) return { nettedCents: 0 };
  const { posted } = await postLedgerTransaction(tx, {
    idempotencyKey: `recovery-netting/${input.ledgerKey}`,
    kind: "recovery_release_netted",
    sellerId: input.sellerId,
    orderId: input.orderId,
    dropId: input.dropId ?? null,
    stripeObjectId: input.releaseRef ?? null,
    memo: "Kept from this order's payout to cover what the seller owes (refund costs, chargebacks, dispute fees)",
    postings: [
      { account: "seller_held", partyId: input.sellerId, orderId: input.orderId, amountCents: -take },
      { account: "seller_recoverable", partyId: input.sellerId, orderId: input.orderId, amountCents: take },
    ],
  });
  if (posted) logger.info({ sellerId: input.sellerId, orderId: input.orderId, nettedCents: take }, "Seller debt netted from a payout");
  return { nettedCents: posted ? take : 0 };
}

// ─── Closed disputes: the fee and a lost chargeback ──────────────────────────

const FINAL_DISPUTE_STATUSES = new Set(["won", "lost", "warning_closed", "charge_refunded"]);

export type DisputeClosedRecovery = { feeDeltaCents: number; lostMovedCents: number };

/**
 * charge.dispute.closed (and a later funds_reinstated): settles what the
 * seller owes for the dispute.
 *  - Fee: the final fee from the dispute's balance transactions (Stripe's
 *    default fee when a LOST dispute carries none) minus what was already
 *    booked for this dispute, as stripe_dispute_fees +Δ / seller_recoverable −Δ.
 *  - Lost: what the withdrawal booked as owed outside the order's held money
 *    (platform_funds_advanced, seller-level seller_held) becomes a
 *    seller_recoverable debt, so it is netted from the next payouts.
 * Idempotent: the fee posts only a difference, the loss once per withdrawal.
 */
export async function recordDisputeClosedRecovery(input: {
  dispute: any;
  orderId: string;
  stripeEventId: string;
}): Promise<DisputeClosedRecovery> {
  const stripeDisputeId = typeof input.dispute?.id === "string" ? input.dispute.id as string : null;
  const status = String(input.dispute?.status ?? "");
  const none = { feeDeltaCents: 0, lostMovedCents: 0 };
  if (!stripeDisputeId || !FINAL_DISPUTE_STATUSES.has(status)) return none;
  return db.transaction(async (tx) => {
    const [order] = rows<{ id: string; owner_id: string; drop_id: string | null; charge_model: string | null }>(await tx.execute(sql`
      SELECT id, owner_id, drop_id, charge_model FROM orders WHERE id = ${input.orderId}::uuid FOR UPDATE
    `));
    if (!order || !order.charge_model) return none;
    const sellerId = order.owner_id;
    await lockSellerRecoveries(tx, sellerId);

    // Fee: book the difference to the final figure.
    const target = disputeFeeFromDispute(input.dispute, status === "lost" ? defaultDisputeFeeCents() : 0);
    const [booked] = rows<{ total: string }>(await tx.execute(sql`
      SELECT COALESCE(SUM(p.amount_cents), 0) AS total
      FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.transaction_id
      WHERE t.kind = 'dispute_fee' AND t.stripe_object_id = ${stripeDisputeId} AND p.account = 'stripe_dispute_fees'
    `));
    const feeDelta = target - Number(booked?.total ?? 0);
    if (feeDelta !== 0) {
      await postLedgerTransaction(tx, {
        idempotencyKey: `dispute-fee/${stripeDisputeId}/${input.stripeEventId}`,
        kind: "dispute_fee",
        sellerId,
        orderId: order.id,
        dropId: order.drop_id,
        stripeObjectId: stripeDisputeId,
        memo: feeDelta > 0
          ? "Stripe's dispute fee, charged to the seller and recovered from their next payouts"
          : "Stripe returned its dispute fee; credited back to the seller",
        postings: [
          { account: "stripe_dispute_fees", amountCents: feeDelta },
          { account: "seller_recoverable", partyId: sellerId, orderId: order.id, dropId: null, amountCents: -feeDelta },
        ],
      });
    }

    let lostMoved = 0;
    if (status === "lost") {
      const withdrawals = rows<{ id: string }>(await tx.execute(sql`
        SELECT t.id FROM ledger_transactions t
        WHERE t.kind = 'dispute_funds_withdrawn'
          AND t.idempotency_key LIKE ${`dispute-withdrawn/${stripeDisputeId}/%`}
          AND NOT EXISTS (SELECT 1 FROM ledger_transactions r WHERE r.idempotency_key = 'dispute-reinstated/' || t.id::text)
      `));
      for (const withdrawal of withdrawals) {
        // The seller's debt outside the order's own held money.
        const owedParts = rows<{ account: string; party_id: string; amount_cents: string }>(await tx.execute(sql`
          SELECT account, party_id, SUM(amount_cents) AS amount_cents FROM ledger_postings
          WHERE transaction_id = ${withdrawal.id}::uuid AND party_id IS NOT NULL
            AND (account = 'platform_funds_advanced' OR (account = 'seller_held' AND order_id IS NULL AND drop_id IS NULL))
          GROUP BY account, party_id
        `)).filter((p) => Number(p.amount_cents) < 0);
        const total = owedParts.reduce((sum, p) => sum - Number(p.amount_cents), 0);
        if (total <= 0) continue;
        const { posted } = await postLedgerTransaction(tx, {
          idempotencyKey: `dispute-lost/${withdrawal.id}`,
          kind: "chargeback_lost_recoverable",
          sellerId,
          orderId: order.id,
          dropId: order.drop_id,
          stripeObjectId: stripeDisputeId,
          memo: "Chargeback lost: the amount the seller's held money didn't cover is recovered from their next payouts",
          postings: [
            ...owedParts.map((p): LedgerPosting => ({
              account: p.account as LedgerPosting["account"],
              partyId: p.party_id,
              orderId: null,
              dropId: null,
              amountCents: -Number(p.amount_cents),
            })),
            { account: "seller_recoverable", partyId: sellerId, orderId: order.id, dropId: null, amountCents: -total },
          ],
        });
        if (posted) lostMoved += total;
      }
    }
    if (feeDelta !== 0 || lostMoved > 0) {
      logger.info({ stripeDisputeId, orderId: order.id, feeDeltaCents: feeDelta, lostMovedCents: lostMoved },
        "Dispute closed: seller recovery updated");
    }
    return { feeDeltaCents: feeDelta, lostMovedCents: lostMoved };
  });
}

/**
 * A lost dispute reversed later (funds_reinstated): undo the move of the
 * loss into seller_recoverable, inside the reinstatement's transaction.
 */
export async function reverseLostChargebackRecovery(tx: DbExecutor, withdrawalTransactionId: string): Promise<boolean> {
  const [moved] = rows<{ id: string; seller_id: string | null; order_id: string | null; drop_id: string | null; stripe_object_id: string | null }>(
    await tx.execute(sql`
      SELECT id, seller_id, order_id, drop_id, stripe_object_id FROM ledger_transactions
      WHERE idempotency_key = ${`dispute-lost/${withdrawalTransactionId}`}
    `),
  );
  if (!moved) return false;
  const original = rows<{ account: string; party_id: string | null; drop_id: string | null; order_id: string | null; amount_cents: string }>(
    await tx.execute(sql`
      SELECT account, party_id, drop_id, order_id, amount_cents FROM ledger_postings WHERE transaction_id = ${moved.id}::uuid
    `),
  );
  const { posted } = await postLedgerTransaction(tx, {
    idempotencyKey: `dispute-lost-reversed/${withdrawalTransactionId}`,
    kind: "chargeback_lost_reversed",
    sellerId: moved.seller_id,
    orderId: moved.order_id,
    dropId: moved.drop_id,
    stripeObjectId: moved.stripe_object_id,
    memo: "Lost chargeback reversed by Stripe; the seller no longer owes it",
    postings: original.map((p) => ({
      account: p.account as LedgerPosting["account"],
      partyId: p.party_id,
      dropId: p.drop_id,
      orderId: p.order_id,
      amountCents: -Number(p.amount_cents),
    })),
  });
  return posted;
}
