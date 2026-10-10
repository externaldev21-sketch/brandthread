/**
 * Carrier label adjustments (re-weigh / re-size surcharges).
 *
 * Every label is bought through Brandthread's one Shippo account, so when a
 * carrier bills extra because the parcel was heavier or bigger than the label
 * said, Shippo charges Brandthread. This books each adjustment once against
 * the seller who bought the label, the same way the label itself was paid:
 *
 *  - order money still held (seller not paid yet): taken from that order's
 *    held funds, so the eventual transfer is simply smaller ("from_held");
 *  - seller already paid: Brandthread fronts it, then reverses that amount
 *    from the order's seller transfer ("recovered"), or the seller balance
 *    shows it as owed when the reversal can't be made ("owed").
 *
 * The seller gets an Activity row + push either way. Adjustments arrive from
 * Shippo's billing (invoice / adjustment export) through the admin route in
 * routes/admin-shipping-adjustments.ts; external_id makes a re-import a no-op.
 */
import { and, eq, or, sql } from "drizzle-orm";
import { db, orders, shippingLabelAdjustments, shippingLabels } from "@workspace/db";
import type Stripe from "stripe";
import { stripe as defaultStripe } from "../stripe";
import { postLedgerTransaction } from "../money/ledger";
import { logger } from "../logger";
import { publishNotification } from "../../routes/notifications-feed";

export type LabelAdjustmentInput = {
  /** The carrier / Shippo adjustment id — one booking per id. */
  externalId: string;
  amountCents: number;
  reason?: string | null;
  transactionId?: string | null;
  trackingNumber?: string | null;
};

export type LabelAdjustmentOutcome =
  | { status: "from_held" | "recovered" | "owed"; adjustmentId: string; orderId: string; sellerId: string }
  | { status: "duplicate" | "label_not_found" | "invalid" };

export type AdjustmentPath = "from_held" | "reverse_transfer" | "owed";

/** Pure: which money path an adjustment takes for this order. */
export function adjustmentPath(order: { chargeModel: string | null; fundsState: string | null; stripeTransferId: string | null }): AdjustmentPath {
  if (order.fundsState === "held" && !order.stripeTransferId) return "from_held";
  if (order.stripeTransferId && (order.chargeModel === "transfer" || order.chargeModel === "destination")) return "reverse_transfer";
  return "owed";
}

export function adjustmentInputError(input: Partial<LabelAdjustmentInput>): string | null {
  if (typeof input.externalId !== "string" || !input.externalId.trim() || input.externalId.length > 200) return "externalId is required";
  if (!Number.isSafeInteger(input.amountCents) || (input.amountCents as number) <= 0 || (input.amountCents as number) > 100_000) {
    return "amountCents must be a positive whole number of cents";
  }
  if (!input.transactionId && !input.trackingNumber) return "transactionId or trackingNumber is required";
  return null;
}

function dollars(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export async function recordLabelAdjustment(
  input: LabelAdjustmentInput,
  options: { stripe?: Pick<Stripe, "transfers"> | null } = {},
): Promise<LabelAdjustmentOutcome> {
  if (adjustmentInputError(input)) return { status: "invalid" };
  const stripeClient = options.stripe === undefined ? defaultStripe : options.stripe;
  const match = [
    ...(input.transactionId ? [eq(shippingLabels.providerTransactionId, input.transactionId)] : []),
    ...(input.trackingNumber ? [eq(shippingLabels.trackingNumber, input.trackingNumber)] : []),
  ];
  const [label] = await db.select({
    id: shippingLabels.id, orderId: shippingLabels.orderId, ownerId: shippingLabels.ownerId,
  }).from(shippingLabels).where(and(eq(shippingLabels.provider, "shippo"), or(...match))).limit(1);
  if (!label) return { status: "label_not_found" };

  const [order] = await db.select({
    orderNumber: orders.orderNumber, chargeModel: orders.chargeModel, fundsState: orders.fundsState, stripeTransferId: orders.stripeTransferId,
  }).from(orders).where(eq(orders.id, label.orderId)).limit(1);
  if (!order) return { status: "label_not_found" };

  const amount = input.amountCents;
  const path = adjustmentPath(order);
  const key = `label-adjustment/${input.externalId}`;

  const created = await db.transaction(async (tx) => {
    const [row] = await tx.insert(shippingLabelAdjustments).values({
      externalId: input.externalId, labelId: label.id, orderId: label.orderId, ownerId: label.ownerId,
      amountCents: amount, reason: input.reason ?? null, status: path === "from_held" ? "from_held" : "owed",
    }).onConflictDoNothing({ target: shippingLabelAdjustments.externalId }).returning({ id: shippingLabelAdjustments.id });
    if (!row) return null;
    await postLedgerTransaction(tx, path === "from_held" ? {
      idempotencyKey: key,
      kind: "label_adjustment_from_held",
      sellerId: label.ownerId,
      orderId: label.orderId,
      memo: "Carrier label adjustment paid from this order's held funds",
      postings: [
        { account: "seller_held", partyId: label.ownerId, amountCents: -amount },
        { account: "shipping_carrier", amountCents: amount },
      ],
    } : {
      idempotencyKey: key,
      kind: "label_adjustment_advanced",
      sellerId: label.ownerId,
      orderId: label.orderId,
      memo: "Carrier label adjustment paid by Brandthread; recovered from the seller",
      postings: [
        { account: "platform_funds_advanced", partyId: label.ownerId, amountCents: -amount },
        { account: "shipping_carrier", amountCents: amount },
      ],
    });
    return row;
  });
  if (!created) return { status: "duplicate" };

  let status: "from_held" | "recovered" | "owed" = path === "from_held" ? "from_held" : "owed";
  if (path === "reverse_transfer" && stripeClient && order.stripeTransferId) {
    try {
      const reversal = await stripeClient.transfers.createReversal(order.stripeTransferId, {
        amount,
        description: "Brandthread carrier label adjustment",
        metadata: { kind: "label_adjustment_recovery", labelId: label.id, orderId: label.orderId, adjustmentId: created.id },
      }, { idempotencyKey: `${key}/recovery` });
      await db.transaction(async (tx) => {
        await postLedgerTransaction(tx, {
          idempotencyKey: `${key}/recovery`,
          kind: "label_adjustment_recovered",
          sellerId: label.ownerId,
          orderId: label.orderId,
          stripeObjectId: reversal.id,
          memo: "Carrier label adjustment recovered from the seller's Stripe balance",
          postings: [
            { account: "seller_paid_out", partyId: label.ownerId, amountCents: -amount },
            { account: "platform_funds_advanced", partyId: label.ownerId, amountCents: amount },
          ],
        });
        await tx.update(shippingLabelAdjustments)
          .set({ status: "recovered", stripeReversalId: reversal.id, updatedAt: sql`now()` })
          .where(eq(shippingLabelAdjustments.id, created.id));
      });
      status = "recovered";
    } catch (err) {
      logger.error({ err, adjustmentId: created.id }, "Label adjustment recovery failed; the seller balance shows it as owed");
    }
  }

  publishNotification({
    userId: label.ownerId,
    category: "orders",
    pushCategory: "order",
    type: "label_adjustment",
    title: `Carrier adjustment on order #${order.orderNumber}`,
    body: `The carrier charged ${dollars(amount)} more because the parcel's weight or size didn't match the label${input.reason ? ` (${input.reason})` : ""}. Weigh and measure the box before buying a label.`,
    targetId: label.orderId,
    targetType: "order",
  }).catch(() => { /* non-critical */ });

  return { status, adjustmentId: created.id, orderId: label.orderId, sellerId: label.ownerId };
}
