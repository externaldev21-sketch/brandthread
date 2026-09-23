/**
 * Seller-side order cards, production tracker and in-chat payment.
 *
 * Cards are priced and sent by the manufacturer; the seller pays through the
 * payments service (Stripe Checkout: card, Apple Pay, Google Pay) and then
 * watches the six-stage tracker. State rules come from the shared
 * @workspace/manufacturer-flow package so the app, the manufacturer portal and
 * the API agree on what each card means.
 */
import { serviceRequest } from '../lib/serviceConfig';

export type OrderCardSnapshot = {
  id: string;
  orderType: 'sample' | 'bulk' | string;
  title: string;
  description: string | null;
  quantity: number;
  priceCents: number;
  currency: string;
  status: string;
  issuedBy: string;
  carrier: string | null;
  trackingNumber: string | null;
  paymentReviewState: string;
  manufacturerPayoutReady: boolean;
  revision: number;
  updatedAt: string;
};

export type TimelineStep = {
  stage: string;
  label: string;
  description: string;
  state: 'done' | 'current' | 'upcoming';
  at: string | null;
};

export type OrderTimeline = {
  viewerRole: 'seller' | 'manufacturer';
  order: OrderCardSnapshot;
  manufacturer?: { id: string; businessName: string; country: string; timeZone: string | null };
  steps: TimelineStep[];
  events: Array<{ id: string; actorRole: string; fromStatus: string | null; toStatus: string; note: string | null; createdAt: string }>;
  createdAt: string;
  paidAt: string | null;
  tracking: { carrier: string | null; carrierName: string | null; trackingNumber: string | null; url: string | null };
};

export type DirectoryFacets = {
  total: number;
  countries: Array<{ name: string; count: number }>;
  specialties: Array<{ name: string; count: number }>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertOrderId(id: string) {
  if (!UUID_RE.test(id)) throw new Error('This order link is not valid.');
}

export async function getOrderTimeline(orderId: string): Promise<OrderTimeline> {
  assertOrderId(orderId);
  return serviceRequest<OrderTimeline>(`/api/manufacturers/orders/${encodeURIComponent(orderId)}/timeline`);
}

export async function declineOrderCard(orderId: string, reason?: string): Promise<void> {
  assertOrderId(orderId);
  await serviceRequest(`/api/manufacturers/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify(reason?.trim() ? { reason: reason.trim() } : {}),
  });
}

export async function confirmOrderDelivery(orderId: string): Promise<void> {
  assertOrderId(orderId);
  await serviceRequest(`/api/manufacturers/orders/${encodeURIComponent(orderId)}/confirm-delivery`, { method: 'POST', body: '{}' });
}

export async function getDirectoryFacets(): Promise<DirectoryFacets> {
  return serviceRequest<DirectoryFacets>('/api/manufacturers/public/facets');
}

/** Whether voice/video calling is switched on (Agora keys configured on the server). */
export async function getCallAvailability(): Promise<boolean> {
  try {
    const result = await serviceRequest<{ configured: boolean }>('/api/call/availability', {}, false);
    return result?.configured === true;
  } catch {
    return false;
  }
}

// ── Paying a card ────────────────────────────────────────────────────────────

export type PayOutcome =
  | { status: 'paid' }
  | { status: 'cancelled'; message: string }
  | { status: 'pending'; message: string }
  | { status: 'blocked'; message: string }
  | { status: 'error'; message: string };

export type PayDeps = {
  createReturnUrl: (orderId: string) => string;
  createCheckoutSession: (orderId: string, returnUrl: string) => Promise<{ sessionId: string; url: string | null; paymentStatus: string }>;
  openCheckout: (url: string, returnUrl: string) => Promise<{ type: string }>;
  confirmPayment: (orderId: string) => Promise<unknown>;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '');
}

async function confirm(orderId: string, deps: PayDeps): Promise<PayOutcome> {
  try {
    await deps.confirmPayment(orderId);
    return { status: 'paid' };
  } catch (error) {
    const message = errorText(error);
    if (/not succeeded|no payment session|awaiting payment/i.test(message)) {
      return { status: 'pending', message: 'Payment is still being confirmed by Stripe. The card will update on its own in a moment.' };
    }
    return { status: 'pending', message: 'We couldn\'t confirm the payment yet. Pull to refresh in a moment.' };
  }
}

/**
 * Hosted Stripe Checkout inside an auth session (supports Apple Pay / Google
 * Pay and cards). Only a successful redirect back to the app counts; closing
 * the sheet leaves the card awaiting payment. Confirmation is idempotent
 * server-side, and the webhook reconciles even if the app is closed.
 */
export async function payOrderCard(order: Pick<OrderCardSnapshot, 'id' | 'status' | 'manufacturerPayoutReady'>, deps: PayDeps): Promise<PayOutcome> {
  if (order.status !== 'pending_payment') {
    return order.status === 'cancelled'
      ? { status: 'blocked', message: 'This card was closed and can no longer be paid.' }
      : { status: 'paid' };
  }
  if (order.manufacturerPayoutReady === false) {
    return { status: 'blocked', message: 'The manufacturer is finishing payout verification with Stripe. You can pay as soon as they\'re done.' };
  }
  const returnUrl = deps.createReturnUrl(order.id);
  let session: Awaited<ReturnType<PayDeps['createCheckoutSession']>>;
  try {
    session = await deps.createCheckoutSession(order.id, returnUrl);
  } catch (error) {
    const message = errorText(error);
    if (/payouts are not ready|cannot receive card payment|MANUFACTURER_PAYOUTS_INCOMPLETE/i.test(message)) {
      return { status: 'blocked', message: 'The manufacturer is finishing payout verification with Stripe. You can pay as soon as they\'re done.' };
    }
    if (/not awaiting payment/i.test(message)) {
      return { status: 'blocked', message: 'This card is no longer awaiting payment. Refresh to see its latest status.' };
    }
    if (/not configured|503/i.test(message)) {
      return { status: 'error', message: 'Payments aren\'t available right now. Try again later.' };
    }
    return { status: 'error', message: 'Secure checkout couldn\'t open. Check your connection and try again.' };
  }
  if (session.paymentStatus === 'paid' || !session.url) {
    // An already-settled session has nothing left to show; confirm it.
    return confirm(order.id, deps);
  }
  let result: { type: string };
  try {
    result = await deps.openCheckout(session.url, returnUrl);
  } catch {
    return { status: 'error', message: 'Secure checkout couldn\'t open. Try again.' };
  }
  if (result.type === 'success') return confirm(order.id, deps);
  if (result.type === 'cancel' || result.type === 'dismiss') {
    return { status: 'cancelled', message: 'Checkout closed. The card is still waiting for payment.' };
  }
  return { status: 'pending', message: 'Checkout didn\'t return a confirmation. If you paid, the card will update shortly.' };
}
