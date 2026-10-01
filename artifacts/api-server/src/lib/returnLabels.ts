/**
 * Prepaid return labels and refund-on-scan.
 *
 * A seller approves a return and sends the buyer a prepaid label: the cheapest
 * carrier rate from the buyer's address to the seller's return address,
 * bought on the seller's account (same ledger entries as an outbound label —
 * `recordLabelPurchased` / `recoverLabelCost`). The refund then waits for the
 * carrier's first scan of that label (Shippo tracking webhook), instead of
 * being issued at approval.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, orders, returns, shippingLabels } from "@workspace/db";
import { createShipment, findTransaction, purchaseTransaction, type ShippoRate } from "./shippo";
import { recordLabelPurchased, recoverLabelCost } from "./money/escrow";
import { orderGrossCents, refundOrder, RefundError } from "./money/refunds";
import { reversePurchasePointsOnce } from "../routes/loyalty";
import { publishNotification } from "../routes/notifications-feed";
import { logger } from "./logger";

export const RETURN_LABEL_REFERENCE = /^brandthread-return-label\/([0-9a-f-]{36})$/i;

export function returnLabelIdFromMetadata(metadata: unknown): string | null {
  if (typeof metadata !== "string") return null;
  const match = metadata.match(RETURN_LABEL_REFERENCE);
  return match ? match[1] : null;
}

export function rateCents(amount: string): number {
  const match = amount.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw Object.assign(new Error("Shipping provider returned an invalid rate"), { status: 502 });
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** The cheapest usable rate, or null when the carrier offered none. */
export function pickCheapestRate(rates: ShippoRate[]): { rate: ShippoRate; priceCents: number } | null {
  let best: { rate: ShippoRate; priceCents: number } | null = null;
  for (const rate of rates) {
    let priceCents: number;
    try { priceCents = rateCents(rate.amount); } catch { continue; }
    if (priceCents <= 0) continue;
    if (!best || priceCents < best.priceCents) best = { rate, priceCents };
  }
  return best;
}

/** Carrier scans that mean the parcel is physically on its way back. */
const SCANNED_STATUSES = new Set(["in_transit", "out_for_delivery", "delivered"]);

export function isFirstScan(status: string): boolean {
  return SCANNED_STATUSES.has(status);
}

export type ReturnLabelAddress = {
  name?: string; street1?: string; street2?: string; city?: string; state?: string; zip?: string;
  country?: string; phone?: string; email?: string;
};

function buyerAddress(value: any): ReturnLabelAddress {
  return {
    name: value?.name, street1: value?.street ?? value?.line1, street2: value?.line2 ?? undefined,
    city: value?.city, state: value?.state, zip: value?.zip, country: value?.country ?? "US",
  };
}

export class ReturnLabelError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}

export async function buyReturnLabel(input: {
  returnId: string;
  sellerId: string;
  returnAddress: ReturnLabelAddress;
  parcel: { length: number; width: number; height: number; weight: number };
}) {
  const [ret] = await db.select().from(returns).where(eq(returns.id, input.returnId)).limit(1);
  if (!ret || ret.sellerId !== input.sellerId) throw new ReturnLabelError("Return not found", 404, "NOT_FOUND");
  if (ret.status !== "pending" && ret.status !== "approved") {
    throw new ReturnLabelError(`This return is already ${ret.status}`, 409, "RETURN_CLOSED");
  }
  const [order] = await db.select().from(orders).where(eq(orders.id, ret.orderId)).limit(1);
  if (!order) throw new ReturnLabelError("Order not found", 404, "NOT_FOUND");

  const [existing] = await db.select().from(shippingLabels).where(and(
    eq(shippingLabels.returnId, ret.id), eq(shippingLabels.direction, "return"),
    inArray(shippingLabels.status, ["purchasing", "active"]),
  )).limit(1);
  if (existing?.status === "active") return { label: existing, duplicate: true };

  let label = existing;
  let priceCents = existing?.priceCents ?? 0;
  if (!label) {
    const shipment = await createShipment({
      address_from: buyerAddress(order.shippingAddress),
      address_to: input.returnAddress as Record<string, unknown>,
      parcels: [{
        length: input.parcel.length, width: input.parcel.width, height: input.parcel.height,
        distance_unit: "in", weight: input.parcel.weight, mass_unit: "lb",
      }],
    });
    const best = pickCheapestRate(shipment.rates);
    if (!best) throw new ReturnLabelError("No carrier rates are available for this return", 409, "NO_RATES");
    priceCents = best.priceCents;
    [label] = await db.insert(shippingLabels).values({
      orderId: order.id, ownerId: input.sellerId, idempotencyKey: `return-label/${ret.id}`,
      providerShipmentId: shipment.object_id, providerRateId: best.rate.object_id,
      carrier: best.rate.provider, service: best.rate.servicelevel?.name ?? best.rate.servicelevel?.token ?? "Return",
      priceCents, status: "purchasing", previousOrderStatus: order.status, direction: "return", returnId: ret.id,
    }).onConflictDoNothing().returning();
    if (!label) throw new ReturnLabelError("A return label is already being created", 409, "IN_PROGRESS");
  }

  const reference = `brandthread-return-label/${label.id}`;
  let transaction;
  try {
    transaction = await findTransaction(reference) ?? await purchaseTransaction(label.providerRateId, reference);
  } catch (err) {
    await db.update(shippingLabels).set({
      status: "failed", failureReason: "Carrier could not create the label",
      idempotencyKey: `${label.idempotencyKey}:failed:${label.id}`, updatedAt: new Date(),
    }).where(and(eq(shippingLabels.id, label.id), eq(shippingLabels.status, "purchasing")));
    throw err;
  }
  if (transaction.status !== "SUCCESS") {
    await db.update(shippingLabels).set({
      status: "failed", failureReason: "Carrier rejected the label",
      idempotencyKey: `${label.idempotencyKey}:failed:${label.id}`, updatedAt: new Date(),
    }).where(and(eq(shippingLabels.id, label.id), eq(shippingLabels.status, "purchasing")));
    throw new ReturnLabelError("The carrier could not create this label", 409, "LABEL_REJECTED");
  }

  const activeLabel = await db.transaction(async (tx) => {
    const [updated] = await tx.update(shippingLabels).set({
      providerTransactionId: transaction.object_id,
      carrier: transaction.rate?.provider ?? label!.carrier,
      service: transaction.rate?.servicelevel?.name ?? label!.service,
      trackingNumber: transaction.tracking_number, labelUrl: transaction.label_url,
      status: "active", updatedAt: new Date(),
    }).where(and(eq(shippingLabels.id, label!.id), eq(shippingLabels.status, "purchasing"))).returning();
    if (!updated) return null; // another request already completed it
    await recordLabelPurchased(tx, {
      labelId: updated.id, orderId: order.id, sellerId: input.sellerId,
      dropId: order.dropId, chargeModel: order.chargeModel, priceCents,
    });
    await tx.update(returns).set({
      status: "approved", returnLabelId: updated.id, returnLabelUrl: updated.labelUrl,
      returnCarrier: updated.carrier, returnTrackingNumber: updated.trackingNumber,
      returnTrackingStatus: "label_created", refundOnScan: true, updatedAt: new Date(),
    }).where(eq(returns.id, ret.id));
    return updated;
  });
  if (!activeLabel) {
    const [done] = await db.select().from(shippingLabels).where(eq(shippingLabels.id, label.id)).limit(1);
    return { label: done, duplicate: true };
  }
  if (order.chargeModel === "destination" || order.chargeModel === "transfer") {
    const labelId = activeLabel.id;
    setImmediate(() => {
      recoverLabelCost(labelId).catch((err) => logger.error({ err, labelId }, "Return label cost recovery failed; sweep will retry"));
    });
  }
  return { label: activeLabel, duplicate: false };
}

/** Issues the refund for an approved return (the same refund path as approval; one refund per return). */
export async function refundReturn(returnId: string): Promise<"refunded" | "skipped"> {
  const [ret] = await db.select().from(returns).where(eq(returns.id, returnId)).limit(1);
  if (!ret || ret.status !== "approved") return "skipped";
  try {
    const result = await refundOrder({
      orderId: ret.orderId,
      amountCents: ret.refundAmountCents ?? undefined,
      reason: "return_approved",
      initiatedBy: ret.sellerId,
      idempotencyKey: `return/${ret.id}`,
      precondition: (order) => {
        if (order.owner_id !== ret.sellerId) throw new RefundError("Only the seller can refund this order", 403, "FORBIDDEN");
      },
      onSucceeded: async (tx, { order, amountCents, refundId }) => {
        await tx.update(returns).set({ status: "refunded", refundAmountCents: amountCents, updatedAt: new Date() })
          .where(eq(returns.id, ret.id));
        if (order.refunded_cents + amountCents >= orderGrossCents(order)) {
          await tx.update(orders).set({ status: "cancelled", updatedAt: new Date() })
            .where(and(eq(orders.id, order.id), inArray(orders.status, ["shipped", "delivered", "pending", "processing", "fulfilled"])));
        }
        if (order.buyer_id) {
          await reversePurchasePointsOnce({
            buyerId: order.buyer_id, orderId: order.id, referenceId: `${order.id}:return:${ret.id}`,
            requestedPoints: Math.floor(amountCents / 100),
            note: `Purchase reward reversed after refund for order ${order.id} (refund ${refundId})`,
          }, tx);
        }
      },
    });
    if (result.stripeRefundId) {
      await db.update(returns).set({ stripeRefundId: result.stripeRefundId }).where(eq(returns.id, ret.id));
    }
    return "refunded";
  } catch (err) {
    logger.error({ err, returnId }, "Refund after the return scan failed; it retries on the next carrier update");
    return "skipped";
  }
}

/**
 * Called by the Shippo tracking webhook for a return label. Records the
 * parcel's progress and refunds on the first carrier scan.
 */
export async function handleReturnLabelTracking(labelId: string, status: string): Promise<{ refunded: boolean }> {
  const [label] = await db.select({ returnId: shippingLabels.returnId }).from(shippingLabels)
    .where(and(eq(shippingLabels.id, labelId), eq(shippingLabels.direction, "return"))).limit(1);
  if (!label?.returnId) return { refunded: false };
  const scanned = isFirstScan(status);
  const [ret] = await db.update(returns).set({
    returnTrackingStatus: status,
    ...(scanned ? { firstScanAt: new Date() } : {}),
    updatedAt: new Date(),
  }).where(eq(returns.id, label.returnId)).returning();
  if (!ret || !scanned || !ret.refundOnScan || ret.status !== "approved") return { refunded: false };
  const outcome = await refundReturn(ret.id);
  if (outcome === "refunded") {
    await publishNotification({
      userId: ret.buyerId, category: "returns", type: "return_refunded", title: "Refund issued",
      body: "Your return was scanned by the carrier and your refund is on its way.",
      targetId: ret.id, targetType: "return", cta: "View return",
    }).catch(() => { /* non-critical */ });
  }
  return { refunded: outcome === "refunded" };
}
