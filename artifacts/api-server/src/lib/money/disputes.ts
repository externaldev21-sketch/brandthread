/**
 * Dispute money movement.
 *
 * Stripe takes the disputed amount back the moment a dispute opens
 * (charge.dispute.funds_withdrawn) and returns it only if the dispute is won
 * (charge.dispute.funds_reinstated). A lost dispute therefore needs no second
 * movement: the money already left when the dispute opened.
 *
 * The ledger already has the right shape for this. A withdrawal is a clawback
 * with no refund row, exactly like a refund issued from the Stripe dashboard
 * (recordExternalRefunds): buyer_payments goes up by the amount, and the
 * seller's share comes out of their held funds, or is recorded as owed to
 * Brandthread (platform_funds_advanced) when the money was already paid out.
 * A reinstatement posts the exact opposite of each withdrawal it reverses.
 *
 * Known gap, deliberately not modelled: Stripe's dispute fee (and any refund
 * of it on a win). Who bears it is a business decision; the fee is stored in
 * the dispute_events payload so nothing is lost, but no ledger posting is made.
 */
import { and, eq, like, sql } from "drizzle-orm";
import { db, ledgerTransactions } from "@workspace/db";
import { logger } from "../logger";
import { adjustDropWalletForRefund } from "./escrow";
import { orderHeldCents, postLedgerTransaction, type DbExecutor, type LedgerPosting } from "./ledger";

type OrderRow = {
  id: string;
  owner_id: string;
  drop_id: string | null;
  charge_model: string | null;
  funds_state: string | null;
};

function rows<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []);
}

export const withdrawalKey = (stripeDisputeId: string, stripeEventId: string) =>
  `dispute-withdrawn/${stripeDisputeId}/${stripeEventId}`;
export const reinstatementKey = (withdrawalTransactionId: string) =>
  `dispute-reinstated/${withdrawalTransactionId}`;

async function lockOrder(tx: DbExecutor, orderId: string): Promise<OrderRow | undefined> {
  const [order] = rows<OrderRow>(await tx.execute(sql`
    SELECT id, owner_id, drop_id, charge_model, funds_state
    FROM orders WHERE id = ${orderId}::uuid FOR UPDATE
  `));
  return order;
}

export type DisputeLedgerResult =
  | { posted: true; transactionId: string }
  | { posted: false; reason: "no_order" | "no_charge_model" | "already_posted" | "nothing_to_reverse" };

/** Dispute opened: Stripe took `amountCents` back from the platform balance. */
export async function recordDisputeWithdrawal(input: {
  stripeDisputeId: string;
  stripeEventId: string;
  orderId: string | null;
  amountCents: number;
  chargeId: string | null;
  occurredAt?: Date;
}): Promise<DisputeLedgerResult> {
  if (!input.orderId) return { posted: false, reason: "no_order" };
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    return { posted: false, reason: "nothing_to_reverse" };
  }
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, input.orderId!);
    if (!order) return { posted: false, reason: "no_order" } as const;
    if (!order.charge_model) return { posted: false, reason: "no_charge_model" } as const;

    const sellerId = order.owner_id;
    const amount = input.amountCents;
    const postings: LedgerPosting[] = [{ account: "buyer_payments", amountCents: amount }];
    let walletAdjust = 0;
    if ((order.charge_model === "held" || order.charge_model === "transfer") && order.funds_state !== "released") {
      const held = Math.max(0, await orderHeldCents(tx, order.id, sellerId));
      const fromOrder = Math.min(amount, held);
      postings.push({ account: "seller_held", partyId: sellerId, amountCents: -fromOrder });
      postings.push({ account: "seller_held", partyId: sellerId, orderId: null, amountCents: -(amount - fromOrder) });
      walletAdjust = order.drop_id ? amount : 0;
    } else {
      postings.push({ account: "platform_funds_advanced", partyId: sellerId, amountCents: -amount });
    }
    const result = await postLedgerTransaction(tx, {
      idempotencyKey: withdrawalKey(input.stripeDisputeId, input.stripeEventId),
      kind: "dispute_funds_withdrawn",
      sellerId,
      orderId: order.id,
      dropId: order.drop_id,
      stripeObjectId: input.stripeDisputeId,
      occurredAt: input.occurredAt,
      memo: "Stripe withdrew disputed funds; returned if the dispute is won",
      postings,
    });
    if (!result.posted || !result.transactionId) return { posted: false, reason: "already_posted" } as const;
    if (walletAdjust && order.drop_id) await adjustDropWalletForRefund(tx, order.drop_id, walletAdjust);
    logger.warn({ orderId: order.id, amountCents: amount, stripeDisputeId: input.stripeDisputeId },
      "Recorded disputed funds withdrawn by Stripe");
    return { posted: true, transactionId: result.transactionId } as const;
  });
}

/** Dispute won: Stripe returned the money. Reverses every open withdrawal for the dispute. */
export async function recordDisputeReinstatement(input: {
  stripeDisputeId: string;
  occurredAt?: Date;
}): Promise<DisputeLedgerResult[]> {
  const withdrawals = await db.select({ id: ledgerTransactions.id, orderId: ledgerTransactions.orderId })
    .from(ledgerTransactions)
    .where(and(
      eq(ledgerTransactions.kind, "dispute_funds_withdrawn"),
      like(ledgerTransactions.idempotencyKey, `dispute-withdrawn/${input.stripeDisputeId}/%`),
    ));
  if (withdrawals.length === 0) return [{ posted: false, reason: "nothing_to_reverse" }];

  const results: DisputeLedgerResult[] = [];
  for (const withdrawal of withdrawals) {
    results.push(await db.transaction(async (tx) => {
      const order = withdrawal.orderId ? await lockOrder(tx, withdrawal.orderId) : undefined;
      const original = rows<{ account: string; party_id: string | null; drop_id: string | null; order_id: string | null; amount_cents: string }>(
        await tx.execute(sql`
          SELECT account, party_id, drop_id, order_id, amount_cents
          FROM ledger_postings WHERE transaction_id = ${withdrawal.id}::uuid
        `),
      );
      if (original.length === 0) return { posted: false, reason: "nothing_to_reverse" } as const;
      const result = await postLedgerTransaction(tx, {
        idempotencyKey: reinstatementKey(withdrawal.id),
        kind: "dispute_funds_reinstated",
        sellerId: order?.owner_id ?? null,
        orderId: withdrawal.orderId,
        dropId: order?.drop_id ?? null,
        stripeObjectId: input.stripeDisputeId,
        occurredAt: input.occurredAt,
        memo: "Dispute won; Stripe returned the withdrawn funds",
        postings: original.map((p) => ({
          account: p.account as LedgerPosting["account"],
          partyId: p.party_id,
          dropId: p.drop_id,
          orderId: p.order_id,
          amountCents: -Number(p.amount_cents),
        })),
      });
      if (!result.posted || !result.transactionId) return { posted: false, reason: "already_posted" } as const;
      const heldReturned = original
        .filter((p) => p.account === "seller_held")
        .reduce((sum, p) => sum + Math.abs(Number(p.amount_cents)), 0);
      if (order?.drop_id && heldReturned > 0) await adjustDropWalletForRefund(tx, order.drop_id, -heldReturned);
      return { posted: true, transactionId: result.transactionId } as const;
    }));
  }
  return results;
}
