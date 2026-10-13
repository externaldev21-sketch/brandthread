/**
 * Post-purchase add-on ("Add to this order"): for a few minutes after a
 * paid order, the buyer can add one more piece from the same seller with one
 * tap. It ships with the order, so there is no shipping charge, and it is
 * paid with the card used for the order (saved on the buyer's Stripe
 * customer at checkout). Pure rules here; routes/order-add-on.ts does I/O.
 */

/** How long after payment the add-on offer stays open. */
export const ADD_ON_WINDOW_MS = 15 * 60 * 1000;

export type AddOnOrderFacts = {
  buyerId: string | null;
  status: string;
  paidAt: Date | null;
  trackingNumber: string | null;
  isPreorder: boolean | null;
  stripePaymentIntentId: string | null;
};

export type AddOnIneligibleReason =
  | "NOT_YOUR_ORDER" | "NOT_PAID" | "WINDOW_CLOSED" | "ALREADY_SHIPPED" | "CANCELLED" | "PREORDER" | "NO_PAYMENT";

/** Why the add-on offer is closed for this order, or null when it is open. */
export function addOnIneligibleReason(order: AddOnOrderFacts, buyerId: string, now: Date = new Date()): AddOnIneligibleReason | null {
  if (!order.buyerId || order.buyerId !== buyerId) return "NOT_YOUR_ORDER";
  if (order.status === "cancelled") return "CANCELLED";
  if (!order.paidAt) return "NOT_PAID";
  if (order.isPreorder) return "PREORDER";
  if (order.trackingNumber || order.status === "shipped" || order.status === "fulfilled") return "ALREADY_SHIPPED";
  if (!order.stripePaymentIntentId) return "NO_PAYMENT";
  if (now.getTime() - order.paidAt.getTime() >= ADD_ON_WINDOW_MS) return "WINDOW_CLOSED";
  return null;
}

export function addOnExpiresAt(paidAt: Date): Date {
  return new Date(paidAt.getTime() + ADD_ON_WINDOW_MS);
}

/**
 * The card the order was paid with, if it can be charged again without the
 * buyer present: a card PaymentMethod attached to the order's customer.
 * Klarna/Afterpay and unsaved cards can't.
 */
export function reusableCard(intent: {
  customer?: string | { id: string } | null;
  payment_method?: string | { id: string; type?: string; customer?: string | { id: string } | null; card?: { brand?: string; last4?: string } } | null;
}): { customerId: string; paymentMethodId: string; brand: string | null; last4: string | null } | null {
  const customerId = typeof intent.customer === "string" ? intent.customer : intent.customer?.id;
  const pm = intent.payment_method;
  if (!customerId || !pm || typeof pm === "string") return null;
  if (pm.type !== "card") return null;
  const pmCustomer = typeof pm.customer === "string" ? pm.customer : pm.customer?.id;
  if (pmCustomer !== customerId) return null;
  return { customerId, paymentMethodId: pm.id, brand: pm.card?.brand ?? null, last4: pm.card?.last4 ?? null };
}
