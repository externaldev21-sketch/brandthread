/**
 * Brandthread's part of the instant payout fee (lib/money/payoutPolicy.ts:
 * 1.5% in all = Stripe's 1% + Brandthread's INSTANT_PAYOUT_PLATFORM_FEE_BPS).
 *
 * Stripe debits its own 1% from the seller's balance when the payout is
 * created. Brandthread's part is collected AFTER the payout succeeded, the
 * same way a shipping label's cost is recovered (escrow.ts recoverLabelCost):
 * a transfer reversal on the seller's own order transfers, which moves the
 * money from the seller's Stripe balance back to Brandthread. Collecting
 * after (never before) the payout means a payout Stripe refuses is never
 * charged for.
 *
 * Ledger, mirroring labels:
 *   instant-payout-fee/<attemptId>          platform_revenue +fee,
 *                                           platform_funds_advanced −fee (seller owes)
 *   instant-payout-fee-recovery/<attemptId>/<reversalId>
 *                                           seller_paid_out −x,
 *                                           platform_funds_advanced +x
 *
 * Exactly-once: every reversal carries the attempt id in its metadata and a
 * per-(attempt, transfer) Stripe idempotency key. Before reversing on a
 * transfer we look for our own earlier reversal on it, so a crash between
 * Stripe and the ledger write is picked up instead of charged twice. The
 * candidate transfers are the seller's orders paid before the cash-out, newest
 * first, so a retry walks them in the same order. Whatever can't be collected
 * yet stays owed in the ledger and the money sweep retries it.
 */
import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@workspace/db";
import { stripe as defaultStripe } from "../stripe";
import { logger } from "../logger";
import { postLedgerTransaction, type DbExecutor } from "./ledger";

export const INSTANT_FEE_REVERSAL_KIND = "instant_payout_fee";
/** Order transfers looked at per collection run. */
const MAX_CANDIDATE_TRANSFERS = 50;
/** How far back the sweep retries an uncollected fee. */
const SWEEP_WINDOW_DAYS = 30;

export type InstantFeeStripe = {
  transfers: Pick<Stripe["transfers"], "retrieve" | "listReversals" | "createReversal">;
};

export type InstantFeeCollection = {
  status: "collected" | "partial" | "skipped" | "failed";
  feeCents: number;
  collectedCents: number;
  outstandingCents: number;
};

type AttemptRow = {
  id: string;
  owner_id: string;
  method: string;
  status: string;
  platform_fee_cents: number;
  stripe_payout_id: string | null;
  created_at: Date | string;
};

function rows<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

export function chargeKey(attemptId: string): string {
  return `instant-payout-fee/${attemptId}`;
}

function recoveryKey(attemptId: string, reversalId: string): string {
  return `instant-payout-fee-recovery/${attemptId}/${reversalId}`;
}

/** Cents of this attempt's fee already recovered in the ledger. */
export async function collectedInstantFeeCents(executor: DbExecutor, attemptId: string): Promise<number> {
  const [row] = rows<{ total: string | number | null }>(await executor.execute(sql`
    SELECT COALESCE(SUM(p.amount_cents), 0) AS total
    FROM ledger_transactions t JOIN ledger_postings p ON p.transaction_id = t.id
    WHERE t.kind = 'instant_payout_fee_recovered'
      AND t.idempotency_key LIKE ${`instant-payout-fee-recovery/${attemptId}/%`}
      AND p.account = 'platform_funds_advanced'
  `));
  return Number(row?.total ?? 0);
}

async function recordRecovery(attempt: AttemptRow, reversalId: string, amountCents: number): Promise<boolean> {
  const { posted } = await db.transaction((tx) => postLedgerTransaction(tx, {
    idempotencyKey: recoveryKey(attempt.id, reversalId),
    kind: "instant_payout_fee_recovered",
    sellerId: attempt.owner_id,
    stripeObjectId: reversalId,
    memo: "Instant payout fee collected from the seller's Stripe balance",
    postings: [
      { account: "seller_paid_out", partyId: attempt.owner_id, amountCents: -amountCents },
      { account: "platform_funds_advanced", partyId: attempt.owner_id, amountCents },
    ],
  }));
  return posted;
}

/** Our own earlier reversal for this attempt on a transfer, if Stripe has one. */
async function findOwnReversal(
  stripeClient: InstantFeeStripe,
  transfer: Stripe.Transfer,
  attemptId: string,
): Promise<Stripe.TransferReversal | null> {
  const isOurs = (r: Stripe.TransferReversal) =>
    r.metadata?.kind === INSTANT_FEE_REVERSAL_KIND && r.metadata?.attemptId === attemptId;
  const inline = transfer.reversals?.data ?? [];
  const hit = inline.find(isOurs);
  if (hit) return hit;
  if (!transfer.reversals?.has_more) return null;
  let startingAfter: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const list = await stripeClient.transfers.listReversals(transfer.id, {
      limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const found = list.data.find(isOurs);
    if (found) return found;
    if (!list.has_more || list.data.length === 0) return null;
    startingAfter = list.data[list.data.length - 1].id;
  }
  return null;
}

/**
 * Collects (what is still owed of) Brandthread's part of one instant
 * cash-out's fee. Safe to call any number of times, concurrently or after a
 * crash: it never takes more than the fee fixed on the attempt.
 */
export async function collectInstantPayoutPlatformFee(
  attemptId: string,
  options: { stripe?: InstantFeeStripe | null } = {},
): Promise<InstantFeeCollection> {
  const stripeClient = options.stripe === undefined ? (defaultStripe as unknown as InstantFeeStripe | null) : options.stripe;
  const [attempt] = rows<AttemptRow>(await db.execute(sql`
    SELECT id, owner_id, method, status, platform_fee_cents, stripe_payout_id, created_at
    FROM seller_cashout_attempts WHERE id = ${attemptId}::uuid
  `));
  const none = (status: InstantFeeCollection["status"], feeCents = 0): InstantFeeCollection =>
    ({ status, feeCents, collectedCents: 0, outstandingCents: feeCents });
  if (!attempt || attempt.method !== "instant" || attempt.status !== "succeeded" || !attempt.stripe_payout_id) {
    return none("skipped");
  }
  const feeCents = Number(attempt.platform_fee_cents ?? 0);
  if (feeCents <= 0) return none("skipped");

  // The fee is earned once the payout exists; until it is collected the
  // seller owes it (platform_funds_advanced < 0), exactly like a label.
  await db.transaction((tx) => postLedgerTransaction(tx, {
    idempotencyKey: chargeKey(attempt.id),
    kind: "instant_payout_fee",
    sellerId: attempt.owner_id,
    stripeObjectId: attempt.stripe_payout_id,
    memo: "Brandthread part of the instant payout fee",
    postings: [
      { account: "platform_revenue", partyId: attempt.owner_id, amountCents: feeCents },
      { account: "platform_funds_advanced", partyId: attempt.owner_id, amountCents: -feeCents },
    ],
  }));

  let collected = await collectedInstantFeeCents(db, attempt.id);
  const result = (status: InstantFeeCollection["status"]): InstantFeeCollection => ({
    status, feeCents, collectedCents: collected, outstandingCents: Math.max(0, feeCents - collected),
  });
  if (collected >= feeCents) return result("collected");
  if (!stripeClient) return result("failed");

  const createdAt = attempt.created_at instanceof Date ? attempt.created_at : new Date(attempt.created_at);
  const candidates = rows<{ transfer_id: string }>(await db.execute(sql`
    SELECT stripe_transfer_id AS transfer_id FROM orders
    WHERE owner_id = ${attempt.owner_id}
      AND stripe_transfer_id LIKE 'tr\\_%'
      AND charge_model IN ('destination', 'transfer')
      AND paid_at IS NOT NULL AND paid_at <= ${createdAt}
    ORDER BY paid_at DESC, id DESC
    LIMIT ${MAX_CANDIDATE_TRANSFERS}
  `));

  try {
    for (const { transfer_id: transferId } of candidates) {
      if (collected >= feeCents) break;
      const transfer = await stripeClient.transfers.retrieve(transferId);
      const own = await findOwnReversal(stripeClient, transfer, attempt.id);
      if (own) {
        // Already reversed on this transfer (maybe by a run that crashed
        // before its ledger write): record it, never reverse again here.
        if (await recordRecovery(attempt, own.id, own.amount)) collected += own.amount;
        else collected = await collectedInstantFeeCents(db, attempt.id);
        continue;
      }
      const reversible = Math.max(0, (transfer.amount ?? 0) - (transfer.amount_reversed ?? 0));
      const take = Math.min(reversible, feeCents - collected);
      if (take <= 0) continue;
      const reversal = await stripeClient.transfers.createReversal(transferId, {
        amount: take,
        description: "Brandthread instant payout fee",
        metadata: { kind: INSTANT_FEE_REVERSAL_KIND, attemptId: attempt.id, payoutId: attempt.stripe_payout_id },
      }, { idempotencyKey: `instant-payout-fee/${attempt.id}/${transferId}` });
      if (await recordRecovery(attempt, reversal.id, reversal.amount)) collected += reversal.amount;
      else collected = await collectedInstantFeeCents(db, attempt.id);
    }
  } catch (err) {
    logger.error({ err, attemptId }, "Instant payout fee collection failed; it stays owed and the money sweep retries");
    return result("failed");
  }
  if (collected >= feeCents) return result("collected");
  return result(collected > 0 ? "partial" : "failed");
}

/** Money sweep: retries instant fees that are still (partly) owed. */
export async function sweepInstantPayoutFees(options: { stripe?: InstantFeeStripe | null; now?: Date } = {}): Promise<number> {
  const since = new Date((options.now ?? new Date()).valueOf() - SWEEP_WINDOW_DAYS * 86_400_000);
  const owed = rows<{ id: string }>(await db.execute(sql`
    SELECT a.id FROM seller_cashout_attempts a
    WHERE a.method = 'instant' AND a.status = 'succeeded' AND a.platform_fee_cents > 0
      AND a.stripe_payout_id IS NOT NULL AND a.created_at >= ${since}
      AND a.platform_fee_cents > COALESCE((
        SELECT SUM(p.amount_cents) FROM ledger_transactions t
        JOIN ledger_postings p ON p.transaction_id = t.id
        WHERE t.kind = 'instant_payout_fee_recovered'
          AND t.idempotency_key LIKE 'instant-payout-fee-recovery/' || a.id::text || '/%'
          AND p.account = 'platform_funds_advanced'
      ), 0)
    ORDER BY a.created_at ASC
    LIMIT 50
  `));
  let collected = 0;
  for (const { id } of owed) {
    const outcome = await collectInstantPayoutPlatformFee(id, { stripe: options.stripe });
    if (outcome.status === "collected") collected += 1;
  }
  return collected;
}
