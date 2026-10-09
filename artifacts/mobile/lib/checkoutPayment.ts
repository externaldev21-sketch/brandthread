/**
 * One-page checkout: the pure parts of paying in the app (no React, no
 * Stripe SDK), so they can be unit-tested.
 *
 *  - which way this order pays: in the app (one PaymentIntent for the whole
 *    cart, confirmed with Stripe's own card field / Apple Pay / Google Pay),
 *    Stripe-hosted Checkout (the fallback), or the dev-web preview's fake
 *    path;
 *  - the exact request bodies sent to /api/buyer/checkout/payment-intent.
 *    They are built field by field from a whitelist, so card data can never
 *    ride along (PCI SAQ-A: card numbers only ever go to Stripe);
 *  - the delivery window shown per seller ("Ships in 3–5 business days");
 *  - turning a wallet sheet's contact into the page's address and contact.
 */
import type { CheckoutAddress, CheckoutContact, CheckoutSession } from '@/services/cartTypes';
import { getLiveCheckoutContext } from '@/lib/live/liveCheckoutContext';

/** Stripe's minimum USD card charge (the server enforces it too). */
export const MIN_CARD_CHARGE_CENTS_CLIENT = 50;

export type PaymentPath = 'preview' | 'in_app' | 'hosted';

export type HostedReason =
  | 'flag' | 'guest' | 'stripe_unavailable' | 'preorder' | 'thread_cash' | 'loyalty' | 'server';

/**
 * In-app payment is the default. Stripe-hosted Checkout is kept only as a
 * fallback, for what the in-app flow does not cover (see
 * api-server lib/money/cartCheckout.ts), and behind the hostedCheckoutFallback
 * kill switch.
 */
export function choosePaymentPath(input: {
  previewOnly: boolean;
  signedIn: boolean;
  hostedFallbackFlag: boolean;
  stripeAvailable: boolean;
  hasPreOrder: boolean;
  threadCashApplied: boolean;
  loyaltyApplied: boolean;
  /** The server answered USE_HOSTED_CHECKOUT for this order earlier. */
  serverSaidHosted: boolean;
}): { path: PaymentPath; reason: HostedReason | null } {
  if (input.previewOnly) return { path: 'preview', reason: null };
  const reason: HostedReason | null =
    input.hostedFallbackFlag ? 'flag'
      : !input.signedIn ? 'guest'
        : !input.stripeAvailable ? 'stripe_unavailable'
          : input.hasPreOrder ? 'preorder'
            : input.threadCashApplied ? 'thread_cash'
              : input.loyaltyApplied ? 'loyalty'
                : input.serverSaidHosted ? 'server'
                  : null;
  return reason ? { path: 'hosted', reason } : { path: 'in_app', reason: null };
}

// ─── Request bodies (whitelisted, never card data) ───────────────────────────

export type PaymentIntentGroup = {
  items: Array<{ variantId: string; productId: string; quantity: number }>;
  discountCode?: string;
  /** Live the buyer is shopping from — lets a live-only code validate server-side. */
  liveStreamId?: string;
  /** A store gift card from the buyer's wallet, spent on this seller's group only. */
  giftCard?: { cardId: string };
};

export type PaymentIntentAddress = {
  recipientName: string;
  street: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type CreatePaymentIntentBody = {
  groups: PaymentIntentGroup[];
  contactEmail: string;
  contactPhone: string;
  shippingAddress: PaymentIntentAddress;
  clientIdempotencyKey: string;
  saveCard: boolean;
};

export type QuoteBody = {
  groups: PaymentIntentGroup[];
  shippingAddress: { street?: string; line2?: string | null; city?: string; state?: string; postalCode: string; country: string };
};

type SessionForPayment = Pick<CheckoutSession, 'deliveryGroups' | 'discounts'> & Partial<Pick<CheckoutSession, 'giftCards'>>;

/**
 * One group per seller. A single-seller order takes the one valid code; a
 * multi-store order takes each seller's own code (a discount tagged with that
 * seller's id), so a code never crosses stores.
 */
export function paymentGroups(session: SessionForPayment): PaymentIntentGroup[] {
  const single = session.deliveryGroups.length === 1;
  return session.deliveryGroups.map(group => {
    const code = single
      ? session.discounts.find(d => d.isValid)?.code
      : session.discounts.find(d => d.isValid && d.sellerId === group.sellerId)?.code;
    const liveStreamId = code ? getLiveCheckoutContext(group.sellerId ?? null)?.streamId : undefined;
    return {
      items: group.items.map(item => ({
        variantId: String(item.variantId),
        productId: String(item.productId),
        quantity: Number(item.quantity),
      })),
      ...(code ? { discountCode: String(code) } : {}),
      ...(liveStreamId ? { liveStreamId } : {}),
      ...(session.giftCards?.[group.sellerId] ? { giftCard: { cardId: session.giftCards[group.sellerId].cardId } } : {}),
    };
  });
}

export function recipientName(address: Partial<CheckoutAddress>): string {
  return [address.firstName, address.lastName].map(part => (part ?? '').trim()).filter(Boolean).join(' ');
}

export function buildCreatePaymentIntentBody(input: {
  session: SessionForPayment;
  contact: Partial<CheckoutContact>;
  address: Partial<CheckoutAddress>;
  idempotencyKey: string;
  saveCard: boolean;
}): CreatePaymentIntentBody {
  const { address, contact } = input;
  return {
    groups: paymentGroups(input.session),
    contactEmail: String(contact.email ?? '').trim(),
    contactPhone: String(contact.phone ?? '').trim(),
    shippingAddress: {
      recipientName: recipientName(address),
      street: String(address.line1 ?? '').trim(),
      line2: address.line2?.trim() ? String(address.line2).trim() : null,
      city: String(address.city ?? '').trim(),
      state: String(address.state ?? '').trim(),
      postalCode: String(address.postalCode ?? '').trim(),
      country: String(address.country || 'US').trim().toUpperCase(),
    },
    clientIdempotencyKey: String(input.idempotencyKey),
    saveCard: input.saveCard === true,
  };
}

/** Enough of an address to price shipping and tax: ZIP + country (US), plus state/city when known. */
export function canQuote(address: Partial<CheckoutAddress>): boolean {
  const zip = (address.postalCode ?? '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9 -]{1,15}$/.test(zip) && !!(address.country ?? 'US');
}

export function buildQuoteBody(session: SessionForPayment, address: Partial<CheckoutAddress>): QuoteBody {
  return {
    groups: paymentGroups(session),
    shippingAddress: {
      ...(address.line1?.trim() ? { street: address.line1.trim() } : {}),
      ...(address.city?.trim() ? { city: address.city.trim() } : {}),
      ...(address.state?.trim() ? { state: address.state.trim() } : {}),
      postalCode: (address.postalCode ?? '').trim(),
      country: (address.country || 'US').trim().toUpperCase(),
    },
  };
}

/** Stable key for "has anything that changes the price changed?". */
export function quoteKey(body: QuoteBody): string {
  return JSON.stringify(body);
}

// ─── Server answers ───────────────────────────────────────────────────────────

export type QuoteGroup = {
  sellerId: string;
  checkoutSessionId: string;
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  taxCents: number;
  /** Covered by a store gift card; totalCents is what the card payment still covers. */
  giftCardCents?: number;
  totalCents: number;
  processingDays: number | null;
};

/** paymentMethodTypes: what the server will offer for this cart (card, plus klarna / afterpay_clearpay when every seller opted in). */
export type CartQuote = { amountCents: number; groups: QuoteGroup[]; paymentMethodTypes?: string[] };

/** Whether the quote offers Buy now, pay later (web Payment Element only; native keeps card / wallets). */
export function quoteOffersBnpl(quote: CartQuote | null | undefined): boolean {
  return !!quote?.paymentMethodTypes?.some(type => type === 'klarna' || type === 'afterpay_clearpay');
}

export type PaymentIntentStart = CartQuote & {
  paymentIntentId: string;
  clientSecret: string;
  status: string;
};

export type PaymentIntentStatus = {
  status: string;
  paymentStatus: 'paid' | 'processing' | 'unpaid';
  amountTotal: number;
  declineReason: string | null;
  orders: Array<{ orderId: string; orderNumber: string; sellerId: string; amountTotalCents: number }>;
  complete: boolean;
};

/** A quote response the page can trust (amount + one numeric entry per seller group). */
export function isCartQuote(value: unknown): value is CartQuote {
  const quote = value as CartQuote | null;
  return !!quote && Number.isFinite(quote.amountCents) && Array.isArray(quote.groups)
    && quote.groups.every(group => !!group && Number.isFinite(group.totalCents) && Number.isFinite(group.taxCents) && Number.isFinite(group.shippingCents));
}

/** Totals for the page and the Pay button once the server has priced the cart. */
export type QuoteTotals = {
  subtotalCents: number; shippingCents: number; discountCents: number; taxCents: number; totalCents: number;
  /** Present only when a store gift card is applied. */
  giftCardCents?: number;
};

export function quoteTotals(quote: CartQuote): QuoteTotals {
  const base = quote.groups.reduce((sum, group) => ({
    subtotalCents: sum.subtotalCents + group.subtotalCents,
    shippingCents: sum.shippingCents + group.shippingCents,
    discountCents: sum.discountCents + group.discountCents,
    taxCents: sum.taxCents + group.taxCents,
    totalCents: sum.totalCents + group.totalCents,
  }), { subtotalCents: 0, shippingCents: 0, discountCents: 0, taxCents: 0, totalCents: 0 });
  const giftCardCents = quote.groups.reduce((sum, group) => sum + (group.giftCardCents ?? 0), 0);
  // Only present when a store gift card is applied, so other orders keep their exact shape.
  return giftCardCents > 0 ? { ...base, giftCardCents } : base;
}

// ─── Delivery window ─────────────────────────────────────────────────────────

export const GENERIC_DELIVERY_WINDOW = 'Ships in 3–5 business days';

/**
 * The seller's processing time as a promise the buyer can plan around.
 * Never blank: without a configured processing time it falls back to a
 * generic window.
 */
export function deliveryWindowLabel(input: { processingDays?: number | null; isPreOrder?: boolean }): string {
  if (input.isPreOrder) return 'Ships after production';
  const days = input.processingDays;
  if (typeof days !== 'number' || !Number.isFinite(days) || days < 0) return GENERIC_DELIVERY_WINDOW;
  if (days <= 1) return 'Ships in 1 business day';
  return `Ships in ${Math.round(days)} business days`;
}

// ─── Wallet sheets ───────────────────────────────────────────────────────────

export type WalletContact = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address: {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    country?: string | null;
  };
};

/** Apple Pay / Google Pay supplied the name, address and contact: map them onto the page's shapes. */
export function walletContactToCheckout(wallet: WalletContact): { address: Partial<CheckoutAddress>; contact: Partial<CheckoutContact> } {
  const name = (wallet.name ?? '').trim();
  const space = name.indexOf(' ');
  return {
    address: {
      firstName: space > 0 ? name.slice(0, space) : name,
      lastName: space > 0 ? name.slice(space + 1).trim() : '',
      line1: (wallet.address.line1 ?? '').trim(),
      line2: (wallet.address.line2 ?? '').trim(),
      city: (wallet.address.city ?? '').trim(),
      state: (wallet.address.state ?? '').trim(),
      postalCode: (wallet.address.postalCode ?? '').trim(),
      country: (wallet.address.country || 'US').trim().toUpperCase(),
    },
    contact: {
      ...(wallet.email ? { email: wallet.email.trim() } : {}),
      ...(wallet.phone ? { phone: wallet.phone.trim() } : {}),
    },
  };
}

/** Cents as the decimal string Apple Pay cart items take. */
export function centsToAmountString(cents: number): string {
  return (Math.max(0, Math.round(cents)) / 100).toFixed(2);
}

/** Stripe decline codes in the buyer's words. */
export function paymentErrorMessage(code?: string | null, fallback?: string | null): string {
  const known: Record<string, string> = {
    card_declined: 'Your card was declined. Try another card or contact your bank.',
    insufficient_funds: 'Your card was declined for insufficient funds. Try another card.',
    expired_card: 'That card has expired. Try another card.',
    incorrect_cvc: 'The security code didn’t match. Check it and try again.',
    processing_error: 'Something went wrong processing your card. Try again.',
    incorrect_number: 'That card number looks incorrect. Check it and try again.',
    authentication_required: 'Your bank needs to confirm this payment. Try again and complete the check.',
    payment_intent_authentication_failure: 'Your bank couldn’t confirm this payment. Try again or use another card.',
  };
  if (code && known[code]) return known[code];
  return fallback?.trim() || 'Your payment didn’t go through. Try again or use another card.';
}
