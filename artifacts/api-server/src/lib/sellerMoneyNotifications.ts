/**
 * Seller-side money notifications that had no row before:
 *
 *   seller · dispute_opened        — a buyer's bank opened a chargeback; the
 *                                    order's payout is paused until it closes
 *   seller · dispute_closed        — the chargeback was won / lost / closed
 *   seller · order_delivered_seller — the carrier (or the buyer) confirmed
 *                                    delivery; the payout clock has started
 *   seller · payout_transfer_sent  — the order's money was transferred to the
 *                                    seller's Stripe account
 *
 * Dispute rows target `dispute` (opens /dispute-detail) when the seller owns
 * the dispute record, else their `order`. All best-effort: a notification
 * failure never fails the money/state change that triggered it.
 */
import { publishNotification } from "../routes/notifications-feed";
import { logger } from "./logger";
import { formatOrderCents } from "./orderNotifications";

type Notify = Parameters<typeof publishNotification>[0];

async function send(input: Notify): Promise<void> {
  try {
    await publishNotification(input);
  } catch (err) {
    logger.warn({ err, type: input.type, targetId: input.targetId }, "Seller money notification failed");
  }
}

const REASONS: Record<string, string> = {
  fraudulent: "the cardholder says they didn't make this purchase",
  product_not_received: "the buyer says the order didn't arrive",
  product_unacceptable: "the buyer says the item wasn't as described",
  duplicate: "the buyer says they were charged twice",
  credit_not_processed: "the buyer says a refund wasn't processed",
  unrecognized: "the buyer doesn't recognise the charge",
  subscription_canceled: "the buyer says they cancelled",
  general: "the buyer's bank opened a dispute",
};

export async function notifySellerDisputeOpened(input: {
  sellerId: string;
  orderId: string;
  orderNumber: string;
  disputeId: string | null;
  amountCents: number;
  reason: string | null;
  evidenceDueBy: Date | null;
}): Promise<void> {
  const why = REASONS[input.reason ?? ""] ?? REASONS.general;
  const due = input.evidenceDueBy
    ? ` Respond by ${input.evidenceDueBy.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}.`
    : "";
  await send({
    userId: input.sellerId,
    category: "disputes",
    type: "dispute_opened",
    title: `Chargeback on order #${input.orderNumber}`,
    body: `${formatOrderCents(input.amountCents)} is disputed: ${why}. This order's payout is paused.${due}`,
    targetId: input.disputeId ?? input.orderId,
    targetType: input.disputeId ? "dispute" : "order",
    cta: input.disputeId ? "Respond" : "View order",
  });
}

export async function notifySellerDisputeClosed(input: {
  sellerId: string;
  orderId: string | null;
  orderNumber: string | null;
  disputeId: string;
  amountCents: number;
  outcome: string;
}): Promise<void> {
  const label = input.orderNumber ? `order #${input.orderNumber}` : "your order";
  const copy = input.outcome === "won"
    ? { title: `Chargeback won on ${label}`, body: `The bank ruled in your favour. ${formatOrderCents(input.amountCents)} stays with you and the payout resumes.` }
    : input.outcome === "lost"
      ? { title: `Chargeback lost on ${label}`, body: `The bank returned ${formatOrderCents(input.amountCents)} to the buyer.` }
      : { title: `Chargeback closed on ${label}`, body: "The dispute is closed." };
  await send({
    userId: input.sellerId,
    category: "disputes",
    type: "dispute_closed",
    ...copy,
    targetId: input.disputeId,
    targetType: "dispute",
  });
}

export async function notifySellerOrderDelivered(input: {
  sellerId: string;
  orderId: string;
  orderNumber: string;
  payoutReleaseAt: Date | null;
  byBuyer: boolean;
}): Promise<void> {
  const when = input.payoutReleaseAt
    ? ` Your payout for it releases ${input.payoutReleaseAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}.`
    : "";
  await send({
    userId: input.sellerId,
    category: "orders",
    type: "order_delivered_seller",
    title: `Order #${input.orderNumber} delivered`,
    body: `${input.byBuyer ? "The buyer confirmed they received it." : "The carrier confirmed delivery."}${when}`,
    targetId: input.orderId,
    targetType: "order",
  });
}

export async function notifySellerPayoutTransferred(input: {
  sellerId: string;
  orderId: string;
  orderNumber: string;
  amountCents: number;
}): Promise<void> {
  await send({
    userId: input.sellerId,
    category: "payouts",
    type: "payout_transfer_sent",
    title: `${formatOrderCents(input.amountCents)} paid for order #${input.orderNumber}`,
    body: "It's in your Stripe balance and goes to your bank on your payout schedule.",
    targetId: input.orderId,
    targetType: "payout",
  });
}
