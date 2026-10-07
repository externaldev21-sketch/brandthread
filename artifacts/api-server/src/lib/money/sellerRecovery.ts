/**
 * Seller recovery: what happens to the money when a chargeback is LOST.
 *
 * Owner's rules (decided defaults, docs/payments/money-flow.md §11):
 *  - The seller bears their share of the lost sale plus Stripe's dispute fee.
 *    Their share is what the order paid them (seller net, pro-rata to the
 *    disputed amount); Brandthread gives up its own 5% and the processing fee
 *    on that sale (platform_dispute_losses).
 *  - The part still HELD by Brandthread (hold-until-delivered, preorders) is
 *    simply never paid out.
 *  - The part already PAID OUT is pulled back with a Stripe transfer reversal
 *    on that order's own transfer, as far as it goes. Whatever is left is a
 *    recovery the seller owes: their balance may go negative, payouts and
 *    Thread Cash cash-outs pause, and every later order release nets the debt
 *    first (oldest recovery first). When nothing is owed any more, payouts
 *    resume on their own and the seller is told.
 *  - If Stripe later reinstates the funds (charge.dispute.funds_reinstated),
 *    the seller is made whole: the open debt is forgiven and anything already
 *    taken is paid back (only Stripe's dispute fee stays with the seller when
 *    Stripe keeps it).
 *
 * Every movement is one balanced ledger transaction with a deterministic
 * idempotency key, posted in the same database transaction as the row it
 * describes, so retried webhooks and retried releases never double-count.
 * Stripe failures never throw out of the webhook: the debt simply stays open.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import {
  db, disputes, orders, sellerRecoveries, sellerRecoveryApplications, users,
} from "@workspace/db";
import { stripe as defaultStripe } from "../stripe";
import { logger } from "../logger";
import { accountBalanceCents, orderHeldCents, postLedgerTransaction, type DbExecutor, type LedgerPosting } from "./ledger";
import { ordersForDisputedPayment } from "../delivery/disputePause";
import { notifySellerRecoveriesCleared, notifySellerRecoveryOpened } from "../sellerMoneyNotifications";

type StripeTransfers = Pick<Stripe, "transfers">;
export type SellerRecovery = typeof sellerRecoveries.$inferSelect;

/** Stripe's US dispute fee, used only when the dispute object carries no balance transactions. */
export function defaultDisputeFeeCents(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.STRIPE_DISPUTE_FEE_CENTS);
  return Number.isSafeInteger(raw) && raw >= 0 ? raw : 1_500;
}

function rows<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []);
}

function ref(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") return (value as { id: string }).id;
  return null;
}

/** The dispute fee Stripe charged (net of any it returned), from the dispute's balance transactions. */
export function disputeFeeFromDispute(dispute: any, fallback = defaultDisputeFeeCents()): number {
  const bts = Array.isArray(dispute?.balance_transactions) ? dispute.balance_transactions : [];
  const objects = bts.filter((bt: unknown) => bt && typeof bt === "object" && Number.isSafeInteger((bt as any).fee));
  if (objects.length === 0) return fallback;
  return Math.max(0, objects.reduce((sum: number, bt: any) => sum + bt.fee, 0));
}

export function outstandingCents(r: Pick<SellerRecovery, "amountCents" | "feeCents" | "recoveredCents" | "forgivenCents">): number {
  return Math.max(0, r.amountCents + r.feeCents - r.recoveredCents - r.forgivenCents);
}

export function recoveryLockKey(sellerId: string): string {
  return `seller-recovery:${sellerId}`;
}

async function lockSellerRecoveries(executor: DbExecutor, sellerId: string): Promise<void> {
  await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${recoveryLockKey(sellerId)}))`);
}

/** What the seller still owes from lost chargebacks (0 when payouts aren't paused). */
export async function sellerRecoveryOwedCents(executor: DbExecutor, sellerId: string): Promise<number> {
  const [row] = await executor.select({
    owed: sql<string>`COALESCE(SUM(GREATEST(0, ${sellerRecoveries.amountCents} + ${sellerRecoveries.feeCents} - ${sellerRecoveries.recoveredCents} - ${sellerRecoveries.forgivenCents})), 0)`,
  }).from(sellerRecoveries)
    .where(and(eq(sellerRecoveries.sellerId, sellerId), eq(sellerRecoveries.status, "open")));
  return Number(row?.owed ?? 0);
}

export async function payoutPauseForRecovery(executor: DbExecutor, sellerId: string): Promise<{ paused: boolean; owedCents: number }> {
  const owedCents = await sellerRecoveryOwedCents(executor, sellerId);
  return { paused: owedCents > 0, owedCents };
}

/** Splits `total` across `weights` exactly (the last share takes the remainder). */
export function allocateCents(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (weights.length === 0) return [];
  if (sum <= 0) return weights.map((_, i) => (i === weights.length - 1 ? total : 0));
  let left = total;
  return weights.map((w, i) => {
    if (i === weights.length - 1) return left;
    const share = Number((BigInt(total) * BigInt(Math.max(0, w))) / BigInt(sum));
    left -= share;
    return share;
  });
}

// ─── Applying money to recoveries ─────────────────────────────────────────────

type ApplySource = "transfer_reversal" | "release_netting" | "payout_netting" | "manual";

/**
 * Applies `allocations` to open recoveries in one balanced ledger transaction:
 * `debit` is where the money came from (the seller's paid-out balance for a
 * transfer reversal, a releasing order's held money for netting), credited to
 * seller_recoverable. Returns the recoveries this fully recovered. Must run
 * inside a transaction holding the seller's recovery lock.
 */
async function applyToRecoveries(tx: DbExecutor, input: {
  sellerId: string;
  allocations: Array<{ recovery: SellerRecovery; amountCents: number }>;
  source: ApplySource;
  ledgerKey: string;
  kind: string;
  memo: string;
  debit: LedgerPosting;
  stripeRef?: string | null;
  orderId?: string | null;
  dropId?: string | null;
}): Promise<{ applied: number; recovered: SellerRecovery[] }> {
  const allocations = input.allocations.filter((a) => a.amountCents > 0);
  const applied = allocations.reduce((sum, a) => sum + a.amountCents, 0);
  if (applied <= 0) return { applied: 0, recovered: [] };
  const { posted } = await postLedgerTransaction(tx, {
    idempotencyKey: input.ledgerKey,
    kind: input.kind,
    sellerId: input.sellerId,
    orderId: input.orderId ?? null,
    dropId: input.dropId ?? null,
    stripeObjectId: input.stripeRef ?? null,
    memo: input.memo,
    postings: [
      { ...input.debit, amountCents: -applied },
      ...allocations.map((a) => ({
        account: "seller_recoverable" as const,
        partyId: input.sellerId,
        orderId: a.recovery.orderId,
        amountCents: a.amountCents,
      })),
    ],
  });
  if (!posted) return { applied: 0, recovered: [] };
  const recovered: SellerRecovery[] = [];
  const now = new Date();
  for (const a of allocations) {
    await tx.insert(sellerRecoveryApplications).values({
      recoveryId: a.recovery.id,
      source: input.source,
      amountCents: a.amountCents,
      stripeRef: input.stripeRef ?? null,
      orderId: input.orderId ?? null,
    });
    const nextRecovered = a.recovery.recoveredCents + a.amountCents;
    const done = outstandingCents({ ...a.recovery, recoveredCents: nextRecovered }) === 0;
    const [updated] = await tx.update(sellerRecoveries).set({
      recoveredCents: nextRecovered,
      ...(done ? { status: "recovered", recoveredAt: now } : {}),
      updatedAt: now,
    }).where(eq(sellerRecoveries.id, a.recovery.id)).returning();
    if (done && updated) recovered.push(updated);
  }
  return { applied, recovered };
}

async function openRecoveriesOldestFirst(tx: DbExecutor, sellerId: string): Promise<SellerRecovery[]> {
  return tx.select().from(sellerRecoveries)
    .where(and(eq(sellerRecoveries.sellerId, sellerId), eq(sellerRecoveries.status, "open")))
    .orderBy(asc(sellerRecoveries.createdAt), asc(sellerRecoveries.id));
}

/**
 * Nets the seller's open recoveries (oldest first) from money about to be
 * released to them. Posts seller_held −n → seller_recoverable +n, so the
 * order's held balance (and therefore the transfer) shrinks by exactly n.
 * Must run inside the release's transaction; the caller records the result
 * so a retried transfer sends the same amount.
 */
export async function netRecoveriesFromRelease(tx: DbExecutor, input: {
  sellerId: string;
  orderId: string;
  dropId?: string | null;
  availableCents: number;
  /** Unique per release, e.g. order-release/<orderId>. */
  ledgerKey: string;
  releaseRef?: string | null;
}): Promise<{ nettedCents: number; recovered: SellerRecovery[] }> {
  if (input.availableCents <= 0) return { nettedCents: 0, recovered: [] };
  await lockSellerRecoveries(tx, input.sellerId);
  let left = input.availableCents;
  const allocations: Array<{ recovery: SellerRecovery; amountCents: number }> = [];
  for (const recovery of await openRecoveriesOldestFirst(tx, input.sellerId)) {
    if (left <= 0) break;
    const take = Math.min(left, outstandingCents(recovery));
    if (take <= 0) continue;
    allocations.push({ recovery, amountCents: take });
    left -= take;
  }
  if (allocations.length === 0) return { nettedCents: 0, recovered: [] };
  const { applied, recovered } = await applyToRecoveries(tx, {
    sellerId: input.sellerId,
    allocations,
    source: "release_netting",
    ledgerKey: `recovery-netting/${input.ledgerKey}`,
    kind: "recovery_release_netted",
    memo: "Kept from this order's payout to cover a lost chargeback",
    debit: { account: "seller_held", partyId: input.sellerId, orderId: input.orderId, dropId: input.dropId ?? null, amountCents: 0 },
    stripeRef: input.releaseRef ?? null,
    orderId: input.orderId,
    dropId: input.dropId ?? null,
  });
  return { nettedCents: applied, recovered };
}

/**
 * After a commit that recovered something: tell the seller once their
 * last open recovery is paid (payouts resume automatically — the pause is
 * just "any open recovery").
 */
export async function announceRecovered(sellerId: string, recovered: SellerRecovery[]): Promise<void> {
  if (recovered.length === 0) return;
  try {
    const owed = await sellerRecoveryOwedCents(db, sellerId);
    if (owed > 0) return;
    const last = recovered[recovered.length - 1];
    const total = recovered.reduce((sum, r) => sum + r.recoveredCents, 0);
    await notifySellerRecoveriesCleared({ sellerId, recoveryId: last.id, recoveredCents: total });
  } catch (err) {
    logger.warn({ err, sellerId }, "Recovery-cleared notification failed");
  }
}

// ─── Lost chargeback ──────────────────────────────────────────────────────────

type LossOrder = {
  id: string; owner_id: string; drop_id: string | null; charge_model: string | null; funds_state: string | null;
  seller_net_cents: number; gross_charged_cents: number; total_cents: number; order_number: string;
  stripe_transfer_id: string | null; stripe_thread_cash_transfer_id: string | null; thread_cash_applied_cents: number;
};

async function lockLossOrder(tx: DbExecutor, orderId: string): Promise<LossOrder | undefined> {
  const [order] = rows<LossOrder>(await tx.execute(sql`
    SELECT id, owner_id, drop_id, charge_model, funds_state, seller_net_cents, gross_charged_cents, total_cents,
           order_number, stripe_transfer_id, stripe_thread_cash_transfer_id, thread_cash_applied_cents
    FROM orders WHERE id = ${orderId}::uuid FOR UPDATE
  `));
  return order;
}

/** What the seller still holds from this order's own transfer (excludes a separate Thread Cash top-up). */
async function orderPaidOutCents(executor: DbExecutor, order: Pick<LossOrder, "id" | "owner_id" | "stripe_thread_cash_transfer_id" | "thread_cash_applied_cents">): Promise<number> {
  const paid = await accountBalanceCents(executor, { account: "seller_paid_out", partyId: order.owner_id, orderId: order.id });
  const topup = order.stripe_thread_cash_transfer_id ? order.thread_cash_applied_cents : 0;
  return Math.max(0, paid - topup);
}

export type LossResult = {
  orderId: string;
  sellerId: string;
  disputedCents: number;
  feeCents: number;
  heldCancelledCents: number;
  owedCents: number;
  recovery: SellerRecovery | null;
  opened: boolean;
};

async function recordOrderLoss(input: {
  orderId: string;
  stripeDisputeId: string;
  disputeId: string | null;
  paymentIntentId: string | null;
  disputedCents: number;
  feeCents: number;
}): Promise<LossResult | null> {
  return db.transaction(async (tx) => {
    const order = await lockLossOrder(tx, input.orderId);
    if (!order || !order.charge_model) return null;
    const sellerId = order.owner_id;
    await lockSellerRecoveries(tx, sellerId);

    const [existing] = await tx.select().from(sellerRecoveries).where(and(
      eq(sellerRecoveries.stripeDisputeId, input.stripeDisputeId),
      eq(sellerRecoveries.orderId, order.id),
    )).limit(1);
    if (existing) {
      return {
        orderId: order.id, sellerId, disputedCents: input.disputedCents, feeCents: existing.feeCents,
        heldCancelledCents: existing.heldCancelledCents, owedCents: outstandingCents(existing), recovery: existing, opened: false,
      };
    }

    const gross = order.gross_charged_cents || order.total_cents;
    const shareRaw = gross > 0
      ? Number((BigInt(input.disputedCents) * BigInt(Math.max(0, order.seller_net_cents))) / BigInt(gross))
      : 0;
    const held = order.funds_state === "held" ? Math.max(0, await orderHeldCents(tx, order.id, sellerId)) : 0;
    const paidOut = await orderPaidOutCents(tx, order);
    const sellerShare = Math.max(0, Math.min(shareRaw, input.disputedCents, held + paidOut));
    const fromHeld = Math.min(sellerShare, held);
    const fromPaid = sellerShare - fromHeld;
    const owed = fromPaid + input.feeCents;

    const { posted } = await postLedgerTransaction(tx, {
      idempotencyKey: `chargeback-lost/${input.stripeDisputeId}/${order.id}`,
      kind: "chargeback_lost",
      sellerId,
      orderId: order.id,
      dropId: order.drop_id,
      stripeObjectId: input.stripeDisputeId,
      memo: "Chargeback lost: the buyer's bank kept the money; the seller's share and Stripe's fee are recovered from the seller",
      postings: [
        { account: "buyer_payments", amountCents: input.disputedCents },
        { account: "stripe_dispute_fees", amountCents: input.feeCents },
        { account: "seller_held", partyId: sellerId, orderId: order.id, amountCents: -fromHeld },
        { account: "seller_recoverable", partyId: sellerId, orderId: order.id, amountCents: -owed },
        { account: "platform_dispute_losses", amountCents: -(input.disputedCents - sellerShare) },
      ],
    });
    if (!posted) return null;

    if (fromHeld > 0) {
      if (order.drop_id) {
        // drop_wallets is a projection of seller_held: the cancelled part left the pool.
        await tx.execute(sql`SELECT id FROM drops WHERE id = ${order.drop_id}::uuid FOR UPDATE`);
        await tx.execute(sql`
          UPDATE drop_wallets SET released_cents = released_cents + ${fromHeld}, updated_at = now()
          WHERE drop_id = ${order.drop_id}::uuid
        `);
      }
      if (held - fromHeld <= 0) {
        // Nothing left to pay out for this order: it never releases.
        await tx.update(orders).set({ fundsState: "refunded", updatedAt: new Date() })
          .where(and(eq(orders.id, order.id), eq(orders.fundsState, "held")));
      } else {
        // A partial chargeback: the rest of the order is still the seller's.
        await tx.update(orders).set({ disputePausedAt: null, updatedAt: new Date() }).where(eq(orders.id, order.id));
      }
    }

    let recovery: SellerRecovery | null = null;
    if (owed > 0) {
      [recovery] = await tx.insert(sellerRecoveries).values({
        sellerId,
        disputeId: input.disputeId,
        stripeDisputeId: input.stripeDisputeId,
        orderId: order.id,
        paymentIntentId: input.paymentIntentId,
        amountCents: fromPaid,
        feeCents: input.feeCents,
        heldCancelledCents: fromHeld,
      }).returning();
    }
    return {
      orderId: order.id, sellerId, disputedCents: input.disputedCents, feeCents: input.feeCents,
      heldCancelledCents: fromHeld, owedCents: owed, recovery, opened: Boolean(recovery),
    };
  });
}

/**
 * Tries to pull an open recovery back right away by reversing the disputed
 * order's own transfer, up to what that transfer still holds for the seller.
 * Never throws: a failed or partial reversal leaves the rest owed.
 */
export async function recoverByTransferReversal(
  recoveryId: string,
  options: { stripe?: StripeTransfers | null } = {},
): Promise<{ reversedCents: number; recovered: boolean }> {
  const stripeClient = options.stripe === undefined ? defaultStripe : options.stripe;
  const [recovery] = await db.select().from(sellerRecoveries).where(eq(sellerRecoveries.id, recoveryId)).limit(1);
  if (!recovery || recovery.status !== "open" || !recovery.orderId || !stripeClient) return { reversedCents: 0, recovered: false };
  const ledgerKey = `recovery-reversal/${recovery.id}`;
  const already = rows(await db.execute(sql`SELECT 1 FROM ledger_transactions WHERE idempotency_key = ${ledgerKey}`));
  if (already.length) return { reversedCents: 0, recovered: false };

  const [order] = rows<LossOrder & { release_transfer_id: string | null }>(await db.execute(sql`
    SELECT o.id, o.owner_id, o.stripe_transfer_id, o.stripe_thread_cash_transfer_id, o.thread_cash_applied_cents,
           (SELECT r.stripe_transfer_id FROM order_releases r WHERE r.order_id = o.id AND r.state = 'paid' LIMIT 1) AS release_transfer_id
    FROM orders o WHERE o.id = ${recovery.orderId}::uuid
  `));
  const transferId = order?.stripe_transfer_id ?? order?.release_transfer_id ?? null;
  if (!order || !transferId) return { reversedCents: 0, recovered: false };
  const amount = Math.min(outstandingCents(recovery), await orderPaidOutCents(db, order));
  if (amount <= 0) return { reversedCents: 0, recovered: false };

  let reversal: Stripe.TransferReversal;
  try {
    reversal = await stripeClient.transfers.createReversal(transferId, {
      amount,
      description: "Brandthread: lost chargeback",
      metadata: { kind: "chargeback_recovery", recoveryId: recovery.id, orderId: recovery.orderId, disputeId: recovery.stripeDisputeId },
    }, { idempotencyKey: ledgerKey });
  } catch (err) {
    logger.warn({ err, recoveryId: recovery.id, transferId }, "Chargeback transfer reversal failed; the debt stays open and is netted from upcoming payouts");
    return { reversedCents: 0, recovered: false };
  }

  const result = await db.transaction(async (tx) => {
    await lockSellerRecoveries(tx, recovery.sellerId);
    const [fresh] = await tx.select().from(sellerRecoveries).where(eq(sellerRecoveries.id, recovery.id)).limit(1);
    if (!fresh || fresh.status !== "open") return { applied: 0, recovered: [] as SellerRecovery[] };
    // Stripe moved `amount`; the books must say so even if something else
    // recovered part of this debt in the meantime (the excess stays as credit).
    return applyToRecoveries(tx, {
      sellerId: recovery.sellerId,
      allocations: [{ recovery: fresh, amountCents: Math.min(amount, outstandingCents(fresh)) }],
      source: "transfer_reversal",
      ledgerKey,
      kind: "recovery_transfer_reversed",
      memo: "Lost chargeback recovered by reversing the order's transfer",
      debit: { account: "seller_paid_out", partyId: recovery.sellerId, orderId: recovery.orderId, amountCents: 0 },
      stripeRef: reversal.id,
      orderId: recovery.orderId,
    });
  });
  return { reversedCents: result.applied, recovered: result.recovered.length > 0 };
}

/**
 * charge.dispute.closed with status "lost". Idempotent per (dispute, order):
 * a retried webhook finds the recovery already recorded and does nothing.
 */
export async function recordLostChargeback(
  dispute: any,
  options: { stripe?: StripeTransfers | null } = {},
): Promise<LossResult[]> {
  const stripeDisputeId = typeof dispute?.id === "string" ? dispute.id : null;
  const disputed = Number(dispute?.amount);
  if (!stripeDisputeId || !Number.isSafeInteger(disputed) || disputed <= 0) return [];
  const paymentIntentId = ref(dispute.payment_intent);
  const chargeId = ref(dispute.charge);
  const [disputeRow] = await db.select({ id: disputes.id, orderId: disputes.orderId }).from(disputes)
    .where(eq(disputes.stripeDisputeId, stripeDisputeId)).limit(1);
  const covered = await ordersForDisputedPayment(paymentIntentId, chargeId, disputeRow?.orderId ?? null);
  if (covered.length === 0) {
    logger.warn({ stripeDisputeId }, "Lost chargeback matches no order; nothing to recover");
    return [];
  }

  const fee = disputeFeeFromDispute(dispute);
  const weights = covered.map((o) => o.grossChargedCents || o.totalCents);
  const shares = allocateCents(disputed, weights);
  const fees = allocateCents(fee, weights);

  const results: LossResult[] = [];
  for (let i = 0; i < covered.length; i++) {
    const result = await recordOrderLoss({
      orderId: covered[i].id,
      stripeDisputeId,
      disputeId: disputeRow?.id ?? null,
      paymentIntentId,
      disputedCents: shares[i],
      feeCents: fees[i],
    });
    if (result) results.push(result);
  }

  for (const result of results) {
    if (!result.opened || !result.recovery) continue;
    const { recovered } = await recoverByTransferReversal(result.recovery.id, options);
    const [fresh] = await db.select().from(sellerRecoveries).where(eq(sellerRecoveries.id, result.recovery.id)).limit(1);
    result.recovery = fresh ?? result.recovery;
    result.owedCents = fresh ? outstandingCents(fresh) : result.owedCents;
    if (!recovered && result.owedCents > 0) {
      const order = covered.find((o) => o.id === result.orderId);
      await notifySellerRecoveryOpened({
        sellerId: result.sellerId,
        recoveryId: result.recovery.id,
        owedCents: await sellerRecoveryOwedCents(db, result.sellerId),
        orderNumber: order?.orderNumber ?? null,
      });
    }
  }
  logger.info({ stripeDisputeId, orders: results.length }, "Lost chargeback recorded");
  return results;
}

// ─── Reinstated (dispute reversed in the seller's favour) ─────────────────────

/**
 * charge.dispute.funds_reinstated: Stripe returned the disputed money. Undo
 * each order's loss: forgive what is still owed, pay back what was already
 * taken (netting any other open recovery first). Stripe's fee stays with the
 * seller only if Stripe kept it. Idempotent per (dispute, order).
 */
export async function reinstateLostChargeback(
  dispute: any,
  options: { stripe?: StripeTransfers | null } = {},
): Promise<Array<{ orderId: string; creditedCents: number; forgivenCents: number }>> {
  const stripeClient = options.stripe === undefined ? defaultStripe : options.stripe;
  const stripeDisputeId = typeof dispute?.id === "string" ? dispute.id : null;
  if (!stripeDisputeId) return [];
  const losses = rows<{ id: string; order_id: string; seller_id: string; drop_id: string | null }>(await db.execute(sql`
    SELECT id, order_id, seller_id, drop_id FROM ledger_transactions
    WHERE kind = 'chargeback_lost' AND idempotency_key LIKE ${`chargeback-lost/${stripeDisputeId}/%`}
  `));
  if (losses.length === 0) return [];
  // Stripe returns its dispute fee on some reinstatements; the net fee on
  // the dispute's balance transactions tells which.
  const netFee = disputeFeeFromDispute(dispute, Number.NaN);
  const feeReturned = Number.isNaN(netFee) ? false : netFee <= 0;

  const out: Array<{ orderId: string; creditedCents: number; forgivenCents: number }> = [];
  for (const loss of losses) {
    const step = await db.transaction(async (tx) => {
      await lockSellerRecoveries(tx, loss.seller_id);
      const postings = rows<{ account: string; amount_cents: string }>(await tx.execute(sql`
        SELECT account, amount_cents FROM ledger_postings WHERE transaction_id = ${loss.id}::uuid
      `));
      const sum = (account: string) => postings.filter((p) => p.account === account).reduce((s, p) => s + Number(p.amount_cents), 0);
      const disputedCents = sum("buyer_payments");
      const feeCents = sum("stripe_dispute_fees");
      const fromHeld = -sum("seller_held");
      const owedAtLoss = -sum("seller_recoverable");
      const fromPaid = owedAtLoss - feeCents;
      const sellerShare = fromHeld + fromPaid;
      const [recovery] = await tx.select().from(sellerRecoveries).where(and(
        eq(sellerRecoveries.stripeDisputeId, stripeDisputeId),
        eq(sellerRecoveries.orderId, loss.order_id),
      )).limit(1);
      const outstanding = recovery ? outstandingCents(recovery) : 0;
      const feeBack = feeReturned ? feeCents : 0;
      const reduction = sellerShare + feeBack;
      const forgive = Math.min(outstanding, reduction);
      const credit = reduction - forgive;
      const { posted } = await postLedgerTransaction(tx, {
        idempotencyKey: `chargeback-reinstated/${stripeDisputeId}/${loss.order_id}`,
        kind: "chargeback_reinstated",
        sellerId: loss.seller_id,
        orderId: loss.order_id,
        dropId: loss.drop_id,
        stripeObjectId: stripeDisputeId,
        memo: "Chargeback reversed: Stripe returned the money; the seller is made whole",
        postings: [
          { account: "buyer_payments", amountCents: -disputedCents },
          { account: "stripe_dispute_fees", amountCents: -feeBack },
          { account: "seller_recoverable", partyId: loss.seller_id, orderId: loss.order_id, amountCents: forgive },
          { account: "seller_held", partyId: loss.seller_id, orderId: loss.order_id, amountCents: credit },
          { account: "platform_dispute_losses", amountCents: disputedCents - sellerShare },
        ],
      });
      if (!posted) return null;
      if (recovery && forgive > 0) {
        await tx.insert(sellerRecoveryApplications).values({
          recoveryId: recovery.id, source: "reinstated", amountCents: forgive, stripeRef: stripeDisputeId,
        });
      }
      let closed: SellerRecovery | null = null;
      if (recovery) {
        // Closed unless Stripe kept a dispute fee the seller still owes.
        const closes = outstanding - forgive === 0;
        if (closes && recovery.status === "open") closed = { ...recovery, forgivenCents: recovery.forgivenCents + forgive };
        await tx.update(sellerRecoveries).set({
          forgivenCents: recovery.forgivenCents + forgive,
          ...(closes ? { status: "reinstated", recoveredAt: recovery.recoveredAt ?? new Date() } : {}),
          updatedAt: new Date(),
        }).where(eq(sellerRecoveries.id, recovery.id));
      }
      // Anything owed back to the seller first pays down their other debts.
      const netted = credit > 0
        ? await netRecoveriesFromRelease(tx, {
          sellerId: loss.seller_id, orderId: loss.order_id, dropId: loss.drop_id, availableCents: credit,
          ledgerKey: `chargeback-reinstated/${stripeDisputeId}/${loss.order_id}`,
        })
        : { nettedCents: 0, recovered: [] as SellerRecovery[] };
      return {
        credit, forgive, toTransfer: credit - netted.nettedCents,
        recovered: closed ? [closed, ...netted.recovered] : netted.recovered,
      };
    });
    if (!step) continue;
    await announceRecovered(loss.seller_id, step.recovered);
    if (step.toTransfer > 0) await payReinstatedCredit(stripeClient, loss, stripeDisputeId, step.toTransfer);
    out.push({ orderId: loss.order_id, creditedCents: step.credit, forgivenCents: step.forgive });
  }
  return out;
}

async function payReinstatedCredit(
  stripeClient: StripeTransfers | null,
  loss: { order_id: string; seller_id: string; drop_id: string | null },
  stripeDisputeId: string,
  amount: number,
): Promise<void> {
  const key = `chargeback-reinstated-payout/${stripeDisputeId}/${loss.order_id}`;
  const [seller] = await db.select({ stripeAccountId: users.stripeAccountId }).from(users)
    .where(eq(users.clerkId, loss.seller_id)).limit(1);
  if (!stripeClient || !seller?.stripeAccountId) {
    logger.error({ orderId: loss.order_id, amount }, "Reinstated chargeback credit waiting: no Stripe account; it stays held for the seller");
    return;
  }
  try {
    const transfer = await stripeClient.transfers.create({
      amount,
      currency: "usd",
      destination: seller.stripeAccountId,
      transfer_group: loss.order_id,
      description: "Brandthread: chargeback reversed",
      metadata: { kind: "chargeback_reinstated", orderId: loss.order_id, disputeId: stripeDisputeId },
    }, { idempotencyKey: key });
    await db.transaction((tx) => postLedgerTransaction(tx, {
      idempotencyKey: key,
      kind: "chargeback_reinstated_paid",
      sellerId: loss.seller_id,
      orderId: loss.order_id,
      dropId: loss.drop_id,
      stripeObjectId: transfer.id,
      memo: "Chargeback reversed: money paid back to the seller",
      postings: [
        { account: "seller_held", partyId: loss.seller_id, orderId: loss.order_id, amountCents: -amount },
        { account: "seller_paid_out", partyId: loss.seller_id, orderId: loss.order_id, amountCents: amount },
      ],
    }));
  } catch (err) {
    logger.error({ err, orderId: loss.order_id, amount }, "Reinstated chargeback credit transfer failed; it stays held for the seller");
  }
}

// ─── Write-off (support tooling) ──────────────────────────────────────────────

/** Brandthread forgives what is left of a recovery (platform absorbs it). */
export async function writeOffRecovery(recoveryId: string, memo = "Recovery written off"): Promise<number> {
  const result = await db.transaction(async (tx) => {
    const [peek] = await tx.select({ sellerId: sellerRecoveries.sellerId }).from(sellerRecoveries)
      .where(eq(sellerRecoveries.id, recoveryId)).limit(1);
    if (!peek) return null;
    await lockSellerRecoveries(tx, peek.sellerId);
    const [recovery] = await tx.select().from(sellerRecoveries).where(eq(sellerRecoveries.id, recoveryId)).limit(1);
    if (!recovery || recovery.status !== "open") return null;
    const left = outstandingCents(recovery);
    if (left <= 0) return null;
    const { posted } = await postLedgerTransaction(tx, {
      idempotencyKey: `recovery-write-off/${recovery.id}`,
      kind: "recovery_written_off",
      sellerId: recovery.sellerId,
      orderId: recovery.orderId,
      memo,
      postings: [
        { account: "seller_recoverable", partyId: recovery.sellerId, orderId: recovery.orderId, amountCents: left },
        { account: "platform_dispute_losses", amountCents: -left },
      ],
    });
    if (!posted) return null;
    await tx.insert(sellerRecoveryApplications).values({ recoveryId: recovery.id, source: "write_off", amountCents: left });
    const [updated] = await tx.update(sellerRecoveries).set({
      forgivenCents: recovery.forgivenCents + left, status: "written_off", recoveredAt: new Date(), updatedAt: new Date(),
    }).where(eq(sellerRecoveries.id, recovery.id)).returning();
    return { left, updated };
  });
  if (!result) return 0;
  await announceRecovered(result.updated.sellerId, [result.updated]);
  return result.left;
}

// ─── Read model ───────────────────────────────────────────────────────────────

export async function listSellerRecoveries(sellerId: string, limit = 50) {
  const list = await db.execute(sql`
    SELECT r.*, o.order_number, d.reason AS dispute_reason, d.status AS dispute_status, d.id AS dispute_row_id
    FROM seller_recoveries r
    LEFT JOIN orders o ON o.id = r.order_id
    LEFT JOIN disputes d ON d.stripe_dispute_id = r.stripe_dispute_id
    WHERE r.seller_id = ${sellerId}
    ORDER BY (r.status = 'open') DESC, r.created_at DESC
    LIMIT ${limit}
  `);
  const recs = rows<any>(list);
  const ids = recs.map((r) => r.id as string);
  const apps = ids.length
    ? rows<any>(await db.execute(sql`
      SELECT a.*, o.order_number FROM seller_recovery_applications a
      LEFT JOIN orders o ON o.id = a.order_id
      WHERE a.recovery_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
      ORDER BY a.created_at ASC
    `))
    : [];
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return recs.map((r) => {
    const outstanding = outstandingCents({
      amountCents: r.amount_cents, feeCents: r.fee_cents, recoveredCents: r.recovered_cents, forgivenCents: r.forgiven_cents,
    });
    return {
      id: r.id as string,
      orderId: r.order_id as string | null,
      orderNumber: (r.order_number as string | null) ?? null,
      disputeId: (r.dispute_row_id as string | null) ?? r.dispute_id ?? null,
      stripeDisputeId: r.stripe_dispute_id as string,
      disputeReason: (r.dispute_reason as string | null) ?? null,
      amountCents: r.amount_cents as number,
      feeCents: r.fee_cents as number,
      heldCancelledCents: r.held_cancelled_cents as number,
      recoveredCents: r.recovered_cents as number,
      forgivenCents: r.forgiven_cents as number,
      outstandingCents: r.status === "open" ? outstanding : 0,
      status: r.status as "open" | "recovered" | "written_off" | "reinstated",
      createdAt: iso(r.created_at)!,
      recoveredAt: iso(r.recovered_at),
      applications: apps.filter((a) => a.recovery_id === r.id).map((a) => ({
        id: a.id as string,
        source: a.source as string,
        amountCents: a.amount_cents as number,
        stripeRef: (a.stripe_ref as string | null) ?? null,
        orderId: (a.order_id as string | null) ?? null,
        orderNumber: (a.order_number as string | null) ?? null,
        createdAt: iso(a.created_at)!,
      })),
    };
  });
}
