/**
 * Where Stripe's hosted Checkout sends the buyer back to, and how the app
 * reads the result (BT-251).
 *
 * Native: brandthread://checkout-return (the app's registered scheme from
 * app.json). The page is opened with WebBrowser.openAuthSessionAsync, so the
 * redirect closes the browser by itself and the next store in a multi-store
 * cart opens right after. Web, and a universal link that opens the app
 * cold: https://<origin>/checkout-return, served by app/checkout-return.tsx.
 *
 * Closing the browser is never proof the buyer didn't pay (they may tap Done
 * on Stripe's success page), so the caller always verifies with the server,
 * which reads Stripe's live status, before saying anything.
 *
 * Pure module: no react-native imports, safe to unit test.
 */

export const CHECKOUT_RETURN_PATH = 'checkout-return';
export const NATIVE_CHECKOUT_RETURN_BASE = `brandthread://${CHECKOUT_RETURN_PATH}`;

export type CheckoutReturnUrls = {
  /** Sent to the server as Stripe's success_url ({CHECKOUT_SESSION_ID} is filled in by Stripe). */
  successUrl: string;
  /** Sent to the server as Stripe's cancel_url. */
  cancelUrl: string;
  /** Prefix openAuthSessionAsync watches for. */
  redirectUrl: string;
};

export function checkoutReturnUrls(webOrigin?: string | null): CheckoutReturnUrls {
  const origin = (webOrigin ?? '').trim().replace(/\/+$/, '');
  const base = /^https?:\/\/[^\s/]+$/i.test(origin)
    ? `${origin}/${CHECKOUT_RETURN_PATH}`
    : NATIVE_CHECKOUT_RETURN_BASE;
  return {
    successUrl: `${base}?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}?cancelled=1`,
    redirectUrl: base,
  };
}

export type HostedCheckoutVerdict = 'paid' | 'declined' | 'cancelled' | 'pending';

/**
 * What to tell the buyer after the hosted page closed.
 * - paid: Stripe says paid (whatever the browser reported).
 * - declined: Stripe returned a decline reason.
 * - cancelled: the buyer closed the page or hit Stripe's back link and
 *   Stripe has no payment for the session.
 * - pending: they finished on Stripe's side but it isn't confirmed yet.
 */
export function hostedCheckoutVerdict(input: {
  browserType: string;
  returnedUrl?: string | null;
  paymentStatus?: string | null;
  orderId?: string | null;
  declineReason?: string | null;
}): HostedCheckoutVerdict {
  if (input.paymentStatus === 'paid' || input.orderId) return 'paid';
  if (input.declineReason) return 'declined';
  const returnedToCancel = typeof input.returnedUrl === 'string' && /[?&]cancelled=1(?:&|$)/.test(input.returnedUrl);
  if (input.browserType !== 'success' || returnedToCancel) return 'cancelled';
  return 'pending';
}

/** URLs for the running app: the page's https origin on web, the app scheme on native. */
export function currentCheckoutReturnUrls(): CheckoutReturnUrls {
  const location = typeof window !== 'undefined' ? (window as { location?: { protocol?: string; origin?: string } }).location : undefined;
  const webOrigin = location?.protocol === 'https:' || location?.protocol === 'http:' ? location.origin : null;
  return checkoutReturnUrls(webOrigin);
}
