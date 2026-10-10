/**
 * Which orders may buy a shipping label on Brandthread's carrier account.
 *
 * A label is paid by Brandthread first and then taken out of the order's own
 * money (held funds, or a reversal of the seller's transfer — see
 * recordLabelPurchased / recoverLabelCost in escrow.ts). That only works for
 * orders a buyer actually paid through Stripe on one of the charge models the
 * ledger knows how to settle. Manual / off-platform orders (POST /api/orders,
 * charge_model NULL, no PaymentIntent) have no money to take the label from,
 * so Brandthread would pay the carrier and never get it back.
 */

export const LABEL_CHARGE_MODELS = ["held", "transfer", "destination"] as const;

export const LABEL_REQUIRES_PAID_ORDER = "LABEL_REQUIRES_PAID_ORDER";

export const LABEL_REQUIRES_PAID_ORDER_MESSAGE =
  "Shipping labels are only available for orders paid through Brandthread checkout. Ship this order with your own carrier account and add the tracking number.";

export interface LabelEligibilityInput {
  stripePaymentIntentId?: string | null;
  chargeModel?: string | null;
}

export type LabelEligibility =
  | { ok: true }
  | { ok: false; status: 409; code: typeof LABEL_REQUIRES_PAID_ORDER; message: string };

export function labelEligibility(order: LabelEligibilityInput): LabelEligibility {
  const paymentIntent = typeof order.stripePaymentIntentId === "string" ? order.stripePaymentIntentId.trim() : "";
  const model = order.chargeModel ?? null;
  if (paymentIntent && model && (LABEL_CHARGE_MODELS as readonly string[]).includes(model)) return { ok: true };
  return { ok: false, status: 409, code: LABEL_REQUIRES_PAID_ORDER, message: LABEL_REQUIRES_PAID_ORDER_MESSAGE };
}

/** Same check for a raw `SELECT * FROM orders` row (snake_case columns). */
export function labelEligibilityFromRow(row: { stripe_payment_intent_id?: string | null; charge_model?: string | null }): LabelEligibility {
  return labelEligibility({ stripePaymentIntentId: row.stripe_payment_intent_id, chargeModel: row.charge_model });
}
