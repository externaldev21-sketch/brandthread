/**
 * Guest in-app payment (BT-257): a signed-out buyer pays the cart's one
 * PaymentIntent through /api/guest/checkout/payment-intent, with no Clerk
 * token. The server hands back a guestAccessToken with the intent; status
 * and cancel need it. It is kept only in memory, for this app session, keyed
 * by the PaymentIntent id (lib/api.ts reads it to pick the guest mount).
 *
 * Pure module: no react-native imports, safe to unit test.
 */

export const GUEST_PAYMENT_INTENT_PATH = '/api/guest/checkout/payment-intent';

const tokens = new Map<string, string>();

/** Remembers the guest token of a just-created intent and returns the response without it. */
export function rememberGuestPaymentToken<T extends { paymentIntentId: string; guestAccessToken?: string }>(started: T): Omit<T, 'guestAccessToken'> {
  const { guestAccessToken, ...rest } = started;
  if (started.paymentIntentId && typeof guestAccessToken === 'string' && guestAccessToken.length >= 32) {
    tokens.set(started.paymentIntentId, guestAccessToken);
  }
  return rest;
}

/** The guest token for an intent this app session created as a guest, or null (a signed-in intent). */
export function guestPaymentToken(paymentIntentId: string): string | null {
  return tokens.get(paymentIntentId) ?? null;
}

/** For tests and sign-in: forget every guest token. */
export function clearGuestPaymentTokens(): void {
  tokens.clear();
}
