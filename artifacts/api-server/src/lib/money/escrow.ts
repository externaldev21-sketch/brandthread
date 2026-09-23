/**
 * Held preorder funds ("escrow") and per-order release.
 *
 * Owner's rules implemented here:
 *  - In-stock orders are paid straight to the seller (destination charge).
 *  - Preorder-drop orders are charged to Brandthread and HELD, even after
 *    Stripe confirms the payment.
 *  - From held funds the seller pays the manufacturer's bulk order and buys
 *    shipping labels in-app.
 *  - Each order's remaining funds are released to the seller only when THAT
 *    order has a tracking number — one transfer per order, never a lump sum.
 *
 * All amounts are integer cents. All state changes are conditional updates
 * driven by lib/money/stateMachines.ts, and every movement is a ledger
 * transaction with a deterministic idempotency key.
 */
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import {
  db, drops, dropWallets, dropWalletTransactions, ledgerPostings, orderReleases, orders, users,
} from "@workspace/db";
import { stripe as defaultStripe } from "../stripe";
import { logger } from "../logger";
import { runningProRataShareCents, type OrderSplit } from "./fees";
import {
  accountBalanceCents, dropUnallocatedHeldCents, orderHeldCents, postLedgerTransaction, type DbExecutor,
} from "./ledger";
import {
  DROP_OPEN_STATES, dropEscrowMachine, orderFundsMachine, releaseMachine,
  type DropEscrowState, type OrderFundsState,
} from "./stateMachines";
import { isDefinitiveStripeRejection, safeErrorMessage, stripeErrorCode, type ChargeDetails } from "./stripeMoney";
import type Stripe from "stripe";

type StripeLike = Pick<Stripe, "transfers">;

/** A transfer stuck in "transferring" longer than this is retried (same key). */
export const RELEASE_LEASE_MS = 2 * 60_000;

function rows<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []);
}

// ─── Drop escrow lifecycle helpers ────────────────────────────────────────────

/**
 * Moves a drop's escrow state to `to` if (and only if) the current state is
 * allowed to move there. Returns true when this call made the move.
 */
export async function advanceDropEscrow(
  executor: DbExecutor,
  dropId: string,
  to: DropEscrowState,
  extra: Partial<typeof drops.$inferInsert> = {},
): Promise<boolean> {
  const sources = dropEscrowMachine.sourcesOf(to);
  if (sources.length === 0) return false;
  const [moved] = await executor.update(drops)
    .set({ escrowState: to, updatedAt: new Date(), ...extra })
    .where(and(eq(drops.id, dropId), inArray(drops.escrowState, sources)))
    .returning({ id: drops.id });
  return Boolean(moved);
}

/**
 * A drop is complete when it no longer takes preorders (status closed or
 * fulfilled) and no order still has money held or in flight.
 */
export async function maybeCompleteDrop(executor: DbExecutor, dropId: string): Promise<boolean> {
  const [drop] = await executor.select({ status: drops.status, escrowState: drops.escrowState })
    .from(drops).where(eq(drops.id, dropId)).limit(1);
  if (!drop || !drop.escrowState || !(DROP_OPEN_STATES as string[]).includes(drop.escrowState)) return false;
  if (drop.status !== "closed" && drop.status !== "fulfilled") return false;
  const [open] = await executor.select({ id: orders.id }).from(orders).where(and(
    eq(orders.dropId, dropId),
    eq(orders.chargeModel, "held"),
    inArray(orders.fundsState, ["held", "release_pending"]),
  )).limit(1);
  if (open) return false;
  return advanceDropEscrow(executor, dropId, "completed");
}

async function moveOrderFunds(
  executor: DbExecutor,
  orderId: string,
  from: OrderFundsState,
  to: OrderFundsState,
): Promise<boolean> {
  orderFundsMachine.assert(from, to);
  const [moved] = await executor.update(orders)
    .set({ fundsState: to, updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), eq(orders.fundsState, from)))
    .returning({ id: orders.id });
  return Boolean(moved);
}

// ─── Wallet projection ────────────────────────────────────────────────────────
// drop_wallets is a cached, human-friendly view of the held ledger balance:
//   balance  = everything ever deposited for the drop (seller net)
//   released = everything that left the held pool (labels, bulk, releases,
//              refunds) — always equal to what the ledger says left
//   reserved = amounts claimed but still in flight at Stripe / the carrier
// so balance − released = the ledger's seller_held balance for the drop.

export async function ensureDropWallet(executor: DbExecutor, dropId: string, sellerId: string): Promise<string> {
  const [created] = await executor.insert(dropWallets).values({
    dropId,
    sellerId,
    stripeTransferGroup: `drop_${dropId}`,
    ledgerVersion: 2,
  }).onConflictDoNothing({ target: dropWallets.dropId }).returning({ id: dropWallets.id });
  if (created) return created.id;
  const [existing] = await executor.select({ id: dropWallets.id, sellerId: dropWallets.sellerId })
    .from(dropWallets).where(eq(dropWallets.dropId, dropId)).limit(1);
  if (!existing || existing.sellerId !== sellerId) {
    throw new Error(`Drop wallet for ${dropId} belongs to a different seller`);
  }
  return existing.id;
}

/**
 * Lock order for held money, everywhere: order row → drop row → wallet row.
 * Every path that touches a drop wallet takes the drop lock first, so two
 * concurrent money operations on one drop can never deadlock.
 */
export async function lockDrop(executor: DbExecutor, dropId: string): Promise<void> {
  await executor.execute(sql`SELECT id FROM drops WHERE id = ${dropId}::uuid FOR UPDATE`);
}

async function adjustWallet(
  executor: DbExecutor,
  dropId: string,
  delta: { balance?: number; released?: number; reserved?: number },
): Promise<void> {
  await lockDrop(executor, dropId);
  await executor.update(dropWallets).set({
    balanceCents: sql`${dropWallets.balanceCents} + ${delta.balance ?? 0}`,
    releasedCents: sql`${dropWallets.releasedCents} + ${delta.released ?? 0}`,
    reservedCents: sql`GREATEST(0, ${dropWallets.reservedCents} + ${delta.reserved ?? 0})`,
    updatedAt: new Date(),
  }).where(eq(dropWallets.dropId, dropId));
}

/** A refund took `amountCents` of seller money out of a drop's held pool. */
export async function adjustDropWalletForRefund(executor: DbExecutor, dropId: string, amountCents: number): Promise<void> {
  if (amountCents === 0) return;
  await adjustWallet(executor, dropId, { released: amountCents });
}

// ─── Order paid ───────────────────────────────────────────────────────────────

export type PaidOrderInput = {
  orderId: string;
  sellerId: string;
  dropId: string | null;
  chargeModel: "destination" | "held";
  split: OrderSplit;
  /**
   * Destination charges: the processing-fee estimate that was included in
   * application_fee_amount (what the seller actually paid). Held charges:
   * ignored — the seller pays Stripe's exact fee.
   */
  processingFeeChargedCents?: number;
  charge: ChargeDetails;
  paymentIntentId: string | null;
  occurredAt: Date;
};

/**
 * Records the money side of a newly paid order inside the order-creation
 * transaction: fee split, charge ids, funds state, ledger, and (for held
 * orders) the drop wallet deposit. Safe to call twice — the second call is a
 * no-op because funds_state is only set when it is still empty.
 */
export async function recordOrderPaid(executor: DbExecutor, input: PaidOrderInput): Promise<void> {
  const { split } = input;
  const actualProcessing = input.charge.processingFeeCents;
  const held = input.chargeModel === "held";
  if (held && !input.dropId) throw new Error("A held order must belong to a drop");

  let sellerNet: number;
  let processingCharged: number;
  let processingActual: number;
  if (held) {
    // Held charges land on Brandthread's balance, so the seller bears
    // exactly what Stripe charged (split was built with the real fee).
    sellerNet = split.sellerNetCents;
    processingCharged = split.processingFeeCents;
    processingActual = split.processingFeeCents;
  } else {
    // Destination charges: the seller received gross − application fee,
    // where the fee = 5% + the processing estimate fixed at session creation.
    processingCharged = Math.min(
      input.processingFeeChargedCents ?? split.processingFeeCents,
      split.grossCents - split.platformFeeCents,
    );
    sellerNet = split.grossCents - split.platformFeeCents - processingCharged;
    processingActual = actualProcessing ?? processingCharged;
  }

  const [claimed] = await executor.update(orders).set({
    chargeModel: input.chargeModel,
    fundsState: held ? "held" : "settled_direct",
    platformFeeCents: split.platformFeeCents,
    processingFeeCents: processingActual,
    processingFeeChargedCents: processingCharged,
    sellerNetCents: sellerNet,
    stripeChargeId: input.charge.chargeId,
    stripeTransferId: input.charge.transferId,
    stripeApplicationFeeId: input.charge.applicationFeeId,
    updatedAt: new Date(),
  }).where(and(eq(orders.id, input.orderId), sql`${orders.fundsState} IS NULL`))
    .returning({ id: orders.id });
  if (!claimed) return;

  const common = { orderId: input.orderId, dropId: input.dropId };
  if (held) {
    await postLedgerTransaction(executor, {
      idempotencyKey: `order-paid/${input.orderId}`,
      kind: "order_paid_held",
      sellerId: input.sellerId,
      ...common,
      stripeObjectId: input.paymentIntentId,
      occurredAt: input.occurredAt,
      memo: "Preorder payment held by Brandthread until this order ships",
      postings: [
        { account: "buyer_payments", amountCents: -split.grossCents },
        { account: "seller_held", partyId: input.sellerId, amountCents: sellerNet },
        { account: "platform_revenue", amountCents: split.platformFeeCents },
        { account: "stripe_processing_fees", amountCents: processingActual },
      ],
    });
    const walletId = await ensureDropWallet(executor, input.dropId!, input.sellerId);
    await adjustWallet(executor, input.dropId!, { balance: sellerNet });
    await executor.insert(dropWalletTransactions).values({
      walletId,
      type: "deposit",
      amountCents: sellerNet,
      orderId: input.orderId,
      description: "Preorder payment held (after 5% Brandthread fee and Stripe processing)",
      stripeTransferId: input.paymentIntentId,
    });
    await executor.update(drops).set({
      totalCollectedCents: sql`${drops.totalCollectedCents} + ${split.grossCents}`,
      orderCount: sql`${drops.orderCount} + 1`,
      updatedAt: new Date(),
    }).where(eq(drops.id, input.dropId!));
  } else {
    await postLedgerTransaction(executor, {
      idempotencyKey: `order-paid/${input.orderId}`,
      kind: "order_paid_direct",
      sellerId: input.sellerId,
      ...common,
      stripeObjectId: input.paymentIntentId,
      occurredAt: input.occurredAt,
      memo: "In-stock order paid straight to the seller's Stripe account",
      postings: [
        { account: "buyer_payments", amountCents: -split.grossCents },
        { account: "seller_paid_out", partyId: input.sellerId, amountCents: sellerNet },
        { account: "platform_revenue", amountCents: split.platformFeeCents },
        { account: "stripe_processing_fees", amountCents: processingActual },
        { account: "processing_fee_variance", amountCents: processingCharged - processingActual },
      ],
    });
  }
}

// ─── Per-order release ────────────────────────────────────────────────────────

export type ReleaseRequestResult =
  | { status: "requested" | "exists"; releaseId: string }
  | { status: "not_held" | "no_tracking" | "not_found" | "drop_closed" | "funds_not_held"; releaseId?: undefined };

/**
 * Step 1 of a release, all inside one database transaction: checks the
 * order is held and has tracking, computes the amount (this order's held
 * money minus its running pro-rata share of the drop's bulk payment), records
 * the release row, and moves the order to release_pending. Idempotent: a
 * second call returns the existing release.
 */
export async function requestOrderRelease(
  orderId: string,
  trigger: "tracking" | "label" | "manual" | "sweeper",
): Promise<ReleaseRequestResult> {
  return db.transaction(async (tx) => {
    const [order] = rows<{
      id: string; owner_id: string; drop_id: string | null; charge_model: string | null;
      funds_state: string | null; tracking_number: string | null;
    }>(await tx.execute(sql`
      SELECT id, owner_id, drop_id, charge_model, funds_state, tracking_number
      FROM orders WHERE id = ${orderId}::uuid FOR UPDATE
    `));
    if (!order) return { status: "not_found" } as const;
    if (order.charge_model !== "held" || !order.drop_id) return { status: "not_held" } as const;

    const [existing] = await tx.select({ id: orderReleases.id })
      .from(orderReleases).where(eq(orderReleases.orderId, orderId)).limit(1);
    if (existing) return { status: "exists", releaseId: existing.id } as const;
    if (order.funds_state !== "held") return { status: "funds_not_held" } as const;

    const hasTracking = Boolean(order.tracking_number?.trim()) || rows(await tx.execute(sql`
      SELECT 1 FROM shipping_labels
      WHERE order_id = ${orderId}::uuid AND status = 'active' AND tracking_number IS NOT NULL
      LIMIT 1
    `)).length > 0;
    if (!hasTracking) return { status: "no_tracking" } as const;

    // Lock the drop: releases in one drop are serialized, so the running
    // pro-rata share below sees a consistent set of remaining orders.
    const [drop] = rows<{ escrow_state: string | null }>(await tx.execute(sql`
      SELECT escrow_state FROM drops WHERE id = ${order.drop_id}::uuid FOR UPDATE
    `));
    if (!drop?.escrow_state || !(DROP_OPEN_STATES as string[]).includes(drop.escrow_state)) {
      return { status: "drop_closed" } as const;
    }

    const sellerId = order.owner_id;
    const dropId = order.drop_id;
    const orderHeld = Math.max(0, await orderHeldCents(tx, orderId, sellerId));
    const unallocatedBulk = Math.max(0, -(await dropUnallocatedHeldCents(tx, dropId, sellerId)));

    const waiting = await tx.select({
      orderId: ledgerPostings.orderId,
      held: sql<string>`COALESCE(SUM(${ledgerPostings.amountCents}), 0)`,
    }).from(ledgerPostings)
      .innerJoin(orders, eq(orders.id, ledgerPostings.orderId))
      .where(and(
        eq(ledgerPostings.account, "seller_held"),
        eq(ledgerPostings.partyId, sellerId),
        eq(orders.dropId, dropId),
        eq(orders.chargeModel, "held"),
        eq(orders.fundsState, "held"),
      ))
      .groupBy(ledgerPostings.orderId);
    const remainingWeight = waiting.reduce((sum, row) => sum + Math.max(0, Number(row.held)), 0);

    const bulkShare = runningProRataShareCents({
      unallocatedCostCents: unallocatedBulk,
      orderWeightCents: orderHeld,
      remainingWeightCents: Math.max(remainingWeight, orderHeld),
      isLastRemainingOrder: waiting.length <= 1,
      capCents: orderHeld,
    });
    const amount = orderHeld - bulkShare;
    const labelCents = await accountBalanceCents(tx, { account: "shipping_carrier", orderId });

    const [release] = await tx.insert(orderReleases).values({
      orderId,
      dropId,
      sellerId,
      state: "pending",
      trigger,
      amountCents: amount,
      labelCents: Math.max(0, labelCents),
      bulkShareCents: bulkShare,
    }).returning({ id: orderReleases.id });

    if (bulkShare > 0) {
      // Charge this order its share of the bulk manufacturing payment, which
      // until now sat against the drop as a whole.
      await postLedgerTransaction(tx, {
        idempotencyKey: `bulk-allocation/${orderId}`,
        kind: "bulk_cost_allocated",
        sellerId,
        orderId,
        dropId,
        memo: "This order's share of the bulk manufacturing payment",
        postings: [
          { account: "seller_held", partyId: sellerId, orderId, amountCents: -bulkShare },
          { account: "seller_held", partyId: sellerId, orderId: null, amountCents: bulkShare },
        ],
      });
    }
    await moveOrderFunds(tx, orderId, "held", "release_pending");
    await adjustWallet(tx, dropId, { reserved: amount });
    await advanceDropEscrow(tx, dropId, "fulfilling");
    return { status: "requested", releaseId: release.id } as const;
  });
}

export type ReleaseExecution = {
  releaseId: string;
  state: string;
  amountCents: number;
  stripeTransferId: string | null;
  errorCode?: string | null;
};

/**
 * Step 2 of a release: sends the Stripe transfer for one order and settles
 * it. Crash-safe and retry-safe:
 *  - The idempotency key is order-release/<order>/<attempt>. An ambiguous
 *    failure (network, 5xx) leaves the row "transferring" and a retry reuses
 *    the SAME key, so Stripe returns the original transfer instead of paying
 *    twice. Only a definitive 4xx rejection moves to "failed" and bumps the
 *    attempt for the next try.
 *  - source_transaction ties the transfer to this order's own charge, so it
 *    can never exceed what the buyer paid and waits for those funds to settle.
 */
export async function executeOrderRelease(
  releaseId: string,
  options: { stripe?: StripeLike | null; reclaimStale?: boolean } = {},
): Promise<ReleaseExecution> {
  const stripeClient = options.stripe === undefined ? defaultStripe : options.stripe;

  const claim = await db.transaction(async (tx) => {
    const [release] = rows<{
      id: string; order_id: string; drop_id: string | null; seller_id: string; state: string;
      amount_cents: number; attempt: number; stripe_transfer_id: string | null; updated_at: Date;
    }>(await tx.execute(sql`SELECT * FROM order_releases WHERE id = ${releaseId}::uuid FOR UPDATE`));
    if (!release) throw new Error(`Release ${releaseId} not found`);
    const staleTransfer = release.state === "transferring" && options.reclaimStale
      && Date.now() - new Date(release.updated_at).valueOf() >= RELEASE_LEASE_MS;
    if (release.state !== "pending" && release.state !== "failed" && !staleTransfer) {
      return { release, go: false as const };
    }
    const [seller] = await tx.select({ stripeAccountId: users.stripeAccountId })
      .from(users).where(eq(users.clerkId, release.seller_id)).limit(1);
    const [order] = await tx.select({ stripeChargeId: orders.stripeChargeId })
      .from(orders).where(eq(orders.id, release.order_id)).limit(1);
    if (release.amount_cents > 0 && (!seller?.stripeAccountId || !stripeClient)) {
      await tx.update(orderReleases).set({
        lastErrorCode: stripeClient ? "SELLER_ACCOUNT_NOT_READY" : "STRIPE_NOT_CONFIGURED",
        lastErrorMessage: stripeClient
          ? "The seller has no connected Stripe account yet; the release will retry."
          : "Stripe is not configured on this server.",
        updatedAt: new Date(),
      }).where(eq(orderReleases.id, releaseId));
      return { release: { ...release, state: release.state }, go: false as const, blocked: true };
    }
    if (!staleTransfer) {
      releaseMachine.assert(release.state as "pending" | "failed", "transferring");
      await tx.update(orderReleases).set({
        state: "transferring",
        stripeDestination: seller?.stripeAccountId ?? null,
        updatedAt: new Date(),
      }).where(and(eq(orderReleases.id, releaseId), eq(orderReleases.state, release.state)));
    } else {
      await tx.update(orderReleases).set({ updatedAt: new Date() }).where(eq(orderReleases.id, releaseId));
    }
    return {
      release,
      go: true as const,
      destination: seller?.stripeAccountId ?? null,
      chargeId: order?.stripeChargeId ?? null,
    };
  });

  if (!claim.go) {
    const [current] = await db.select().from(orderReleases).where(eq(orderReleases.id, releaseId)).limit(1);
    return {
      releaseId,
      state: current?.state ?? claim.release.state,
      amountCents: current?.amountCents ?? claim.release.amount_cents,
      stripeTransferId: current?.stripeTransferId ?? null,
      errorCode: current?.lastErrorCode ?? null,
    };
  }

  const release = claim.release;
  let transferId: string | null = null;
  if (release.amount_cents > 0) {
    try {
      const transfer = await stripeClient!.transfers.create({
        amount: release.amount_cents,
        currency: "usd",
        destination: claim.destination!,
        ...(release.drop_id ? { transfer_group: `drop_${release.drop_id}` } : {}),
        ...(claim.chargeId ? { source_transaction: claim.chargeId } : {}),
        description: "Brandthread preorder release for one shipped order",
        metadata: {
          kind: "order_release",
          releaseId,
          orderId: release.order_id,
          dropId: release.drop_id ?? "",
          sellerId: release.seller_id,
        },
      }, { idempotencyKey: `order-release/${release.order_id}/${release.attempt}` });
      transferId = transfer.id;
    } catch (error) {
      const definitive = isDefinitiveStripeRejection(error);
      await db.update(orderReleases).set({
        ...(definitive ? { state: "failed", attempt: release.attempt + 1 } : {}),
        lastErrorCode: stripeErrorCode(error),
        lastErrorMessage: safeErrorMessage(error),
        updatedAt: new Date(),
      }).where(and(eq(orderReleases.id, releaseId), eq(orderReleases.state, "transferring")));
      logger.error({ err: error, releaseId, orderId: release.order_id, definitive }, "Order release transfer failed");
      return {
        releaseId,
        state: definitive ? "failed" : "transferring",
        amountCents: release.amount_cents,
        stripeTransferId: null,
        errorCode: stripeErrorCode(error),
      };
    }
  }

  await db.transaction(async (tx) => {
    const [settled] = await tx.update(orderReleases).set({
      state: "paid",
      stripeTransferId: transferId,
      paidAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
      updatedAt: new Date(),
    }).where(and(eq(orderReleases.id, releaseId), eq(orderReleases.state, "transferring")))
      .returning({ id: orderReleases.id });
    if (!settled) return;
    await moveOrderFunds(tx, release.order_id, "release_pending", "released");
    if (release.amount_cents > 0) {
      await postLedgerTransaction(tx, {
        idempotencyKey: `order-release/${release.order_id}`,
        kind: "order_released",
        sellerId: release.seller_id,
        orderId: release.order_id,
        dropId: release.drop_id,
        stripeObjectId: transferId,
        memo: "Held preorder funds released to the seller for one shipped order",
        postings: [
          { account: "seller_held", partyId: release.seller_id, amountCents: -release.amount_cents },
          { account: "seller_paid_out", partyId: release.seller_id, amountCents: release.amount_cents },
        ],
      });
    }
    if (release.drop_id) {
      await adjustWallet(tx, release.drop_id, { reserved: -release.amount_cents, released: release.amount_cents });
      const [wallet] = await tx.select({ id: dropWallets.id }).from(dropWallets)
        .where(eq(dropWallets.dropId, release.drop_id)).limit(1);
      if (wallet) {
        await tx.insert(dropWalletTransactions).values({
          walletId: wallet.id,
          type: "release",
          amountCents: release.amount_cents,
          orderId: release.order_id,
          description: "Released to seller on shipment",
          stripeTransferId: transferId,
        });
      }
      await maybeCompleteDrop(tx, release.drop_id);
    }
  });

  return { releaseId, state: "paid", amountCents: release.amount_cents, stripeTransferId: transferId };
}

/**
 * Convenience: request + execute. Never throws for business outcomes; a
 * release that cannot run yet stays recorded and the sweeper retries it.
 */
export async function releaseOrderFunds(
  orderId: string,
  trigger: "tracking" | "label" | "manual" | "sweeper",
  options: { stripe?: StripeLike | null } = {},
): Promise<ReleaseRequestResult & { execution?: ReleaseExecution }> {
  const requested = await requestOrderRelease(orderId, trigger);
  if (!requested.releaseId) return requested;
  const execution = await executeOrderRelease(requested.releaseId, { stripe: options.stripe, reclaimStale: true });
  return { ...requested, execution };
}

/**
 * Background safety net: finishes releases that a crash or an unavailable
 * Stripe left behind, and releases held orders whose tracking already exists.
 */
export async function sweepOrderReleases(options: { stripe?: StripeLike | null; now?: Date } = {}): Promise<number> {
  const now = options.now ?? new Date();
  const staleBefore = new Date(now.valueOf() - RELEASE_LEASE_MS);
  const open = await db.select({ id: orderReleases.id }).from(orderReleases).where(or(
    eq(orderReleases.state, "pending"),
    eq(orderReleases.state, "failed"),
    and(eq(orderReleases.state, "transferring"), lt(orderReleases.updatedAt, staleBefore)),
  )).limit(200);
  let settled = 0;
  for (const row of open) {
    try {
      const result = await executeOrderRelease(row.id, { stripe: options.stripe, reclaimStale: true });
      if (result.state === "paid") settled++;
    } catch (err) {
      logger.error({ err, releaseId: row.id }, "Release sweep failed for one release");
    }
  }
  const trackedButHeld = rows<{ id: string }>(await db.execute(sql`
    SELECT o.id FROM orders o
    WHERE o.charge_model = 'held' AND o.funds_state = 'held'
      AND (
        (o.tracking_number IS NOT NULL AND btrim(o.tracking_number) <> '')
        OR EXISTS (
          SELECT 1 FROM shipping_labels l
          WHERE l.order_id = o.id AND l.status = 'active' AND l.tracking_number IS NOT NULL
        )
      )
    LIMIT 200
  `));
  for (const row of trackedButHeld) {
    try {
      const result = await releaseOrderFunds(row.id, "sweeper", { stripe: options.stripe });
      if (result.execution?.state === "paid") settled++;
    } catch (err) {
      logger.error({ err, orderId: row.id }, "Release sweep failed for one tracked order");
    }
  }
  return settled;
}

// ─── Shipping labels ──────────────────────────────────────────────────────────

/**
 * A label was bought for an order. Held orders pay from that order's held
 * money. In-stock orders were already paid out to the seller, so Brandthread
 * fronts the carrier cost (recorded as advanced) and recovers it with a
 * partial reversal of the order's transfer — see recoverLabelCost.
 */
export async function recordLabelPurchased(executor: DbExecutor, input: {
  labelId: string;
  orderId: string;
  sellerId: string;
  dropId: string | null;
  chargeModel: string | null;
  priceCents: number;
}): Promise<void> {
  if (input.priceCents <= 0) return;
  if (input.chargeModel === "held" && input.dropId) {
    const { posted } = await postLedgerTransaction(executor, {
      idempotencyKey: `label/${input.labelId}`,
      kind: "label_paid_from_held",
      sellerId: input.sellerId,
      orderId: input.orderId,
      dropId: input.dropId,
      memo: "Shipping label paid from this order's held preorder funds",
      postings: [
        { account: "seller_held", partyId: input.sellerId, amountCents: -input.priceCents },
        { account: "shipping_carrier", amountCents: input.priceCents },
      ],
    });
    if (posted) await adjustWallet(executor, input.dropId, { reserved: -input.priceCents, released: input.priceCents });
    return;
  }
  if (input.chargeModel === "destination") {
    await postLedgerTransaction(executor, {
      idempotencyKey: `label/${input.labelId}`,
      kind: "label_advanced",
      sellerId: input.sellerId,
      orderId: input.orderId,
      memo: "Shipping label paid by Brandthread; recovered from the seller's balance",
      postings: [
        { account: "platform_funds_advanced", partyId: input.sellerId, amountCents: -input.priceCents },
        { account: "shipping_carrier", amountCents: input.priceCents },
      ],
    });
  }
}

/** The carrier refunded a voided label: undo exactly what the purchase did. */
export async function recordLabelVoided(executor: DbExecutor, input: {
  labelId: string;
  orderId: string;
  sellerId: string;
  dropId: string | null;
  chargeModel: string | null;
  priceCents: number;
}): Promise<void> {
  const purchased = await accountBalanceCents(executor, { account: "shipping_carrier", orderId: input.orderId });
  if (purchased <= 0 || input.priceCents <= 0) return;
  if (input.chargeModel === "held" && input.dropId) {
    const { posted } = await postLedgerTransaction(executor, {
      idempotencyKey: `label-void/${input.labelId}`,
      kind: "label_void_to_held",
      sellerId: input.sellerId,
      orderId: input.orderId,
      dropId: input.dropId,
      memo: "Voided label refunded back to this order's held funds",
      postings: [
        { account: "shipping_carrier", amountCents: -input.priceCents },
        { account: "seller_held", partyId: input.sellerId, amountCents: input.priceCents },
      ],
    });
    if (posted) await adjustWallet(executor, input.dropId, { released: -input.priceCents });
    return;
  }
  await postLedgerTransaction(executor, {
    idempotencyKey: `label-void/${input.labelId}`,
    kind: "label_void_advanced",
    sellerId: input.sellerId,
    orderId: input.orderId,
    memo: "Voided label refunded to Brandthread (credited to the seller if already recovered)",
    postings: [
      { account: "shipping_carrier", amountCents: -input.priceCents },
      { account: "platform_funds_advanced", partyId: input.sellerId, amountCents: input.priceCents },
    ],
  });
}

/**
 * Recovers an in-stock order's label cost from the seller by reversing that
 * much of the order's destination transfer. Idempotent per label.
 */
export async function recoverLabelCost(
  labelId: string,
  options: { stripe?: Pick<Stripe, "transfers"> | null } = {},
): Promise<"recovered" | "already" | "skipped" | "failed"> {
  const stripeClient = options.stripe === undefined ? defaultStripe : options.stripe;
  const [label] = rows<{
    id: string; order_id: string; owner_id: string; price_cents: number; status: string;
    charge_model: string | null; stripe_transfer_id: string | null;
  }>(await db.execute(sql`
    SELECT l.id, l.order_id, l.owner_id, l.price_cents, l.status, o.charge_model, o.stripe_transfer_id
    FROM shipping_labels l JOIN orders o ON o.id = l.order_id
    WHERE l.id = ${labelId}::uuid
  `));
  if (!label || label.charge_model !== "destination" || label.status !== "active") return "skipped";
  const done = rows(await db.execute(sql`
    SELECT 1 FROM ledger_transactions WHERE idempotency_key = ${`label-recovery/${labelId}`}
  `));
  if (done.length) return "already";
  if (!label.stripe_transfer_id || !stripeClient) return "skipped";
  try {
    const reversal = await stripeClient.transfers.createReversal(label.stripe_transfer_id, {
      amount: label.price_cents,
      description: "Brandthread shipping label",
      metadata: { kind: "label_recovery", labelId, orderId: label.order_id },
    }, { idempotencyKey: `label-recovery/${labelId}` });
    await db.transaction((tx) => postLedgerTransaction(tx, {
      idempotencyKey: `label-recovery/${labelId}`,
      kind: "label_cost_recovered",
      sellerId: label.owner_id,
      orderId: label.order_id,
      stripeObjectId: reversal.id,
      memo: "Label cost recovered from the seller's Stripe balance",
      postings: [
        { account: "seller_paid_out", partyId: label.owner_id, amountCents: -label.price_cents },
        { account: "platform_funds_advanced", partyId: label.owner_id, amountCents: label.price_cents },
      ],
    }));
    return "recovered";
  } catch (err) {
    logger.error({ err, labelId }, "Label cost recovery failed; the seller balance shows it as owed");
    return "failed";
  }
}

// ─── Bulk manufacturing payments from held funds ──────────────────────────────

export async function recordBulkPaidFromHeld(executor: DbExecutor, input: {
  sampleOrderId: string;
  dropId: string;
  sellerId: string;
  manufacturerId: string;
  amountCents: number;
  transferId: string | null;
}): Promise<boolean> {
  const { posted } = await postLedgerTransaction(executor, {
    idempotencyKey: `bulk-payment/${input.sampleOrderId}`,
    kind: "bulk_paid_from_held",
    sellerId: input.sellerId,
    dropId: input.dropId,
    sampleOrderId: input.sampleOrderId,
    stripeObjectId: input.transferId,
    memo: "Manufacturer bulk order paid from the drop's held preorder funds",
    postings: [
      { account: "seller_held", partyId: input.sellerId, orderId: null, amountCents: -input.amountCents },
      { account: "manufacturer_paid", partyId: input.manufacturerId, orderId: null, amountCents: input.amountCents },
    ],
  });
  if (posted) await advanceDropEscrow(executor, input.dropId, "production");
  return posted;
}

export async function recordBulkReversalToHeld(executor: DbExecutor, input: {
  providerEventId: string;
  sampleOrderId: string;
  dropId: string;
  sellerId: string;
  manufacturerId: string;
  amountCents: number;
  transferId: string | null;
}): Promise<void> {
  await postLedgerTransaction(executor, {
    idempotencyKey: `bulk-reversal/${input.providerEventId}`,
    kind: "bulk_payment_reversed",
    sellerId: input.sellerId,
    dropId: input.dropId,
    sampleOrderId: input.sampleOrderId,
    stripeObjectId: input.transferId,
    memo: "Manufacturer transfer reversed back into the drop's held funds",
    postings: [
      { account: "manufacturer_paid", partyId: input.manufacturerId, orderId: null, amountCents: -input.amountCents },
      { account: "seller_held", partyId: input.sellerId, orderId: null, amountCents: input.amountCents },
    ],
  });
}
