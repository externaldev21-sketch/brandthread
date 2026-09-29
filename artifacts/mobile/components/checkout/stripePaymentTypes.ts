/**
 * The contract both Stripe wrappers implement:
 *  - StripePayment.tsx      iOS / Android (@stripe/stripe-react-native)
 *  - StripePayment.web.tsx  web (@stripe/react-stripe-js)
 * Card numbers only ever live inside Stripe's own fields; nothing here
 * carries them. The screen gets back an outcome, never card data.
 */
import type { CartQuote, WalletContact } from '@/lib/checkoutPayment';

export const APPLE_MERCHANT_ID = 'merchant.com.brandthread.mobile';

export function stripePublishableKey(): string {
  return (process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '').trim();
}

export type ConfirmOutcome =
  | { status: 'succeeded' | 'processing' }
  /** The buyer closed the wallet sheet or the bank's 3DS check. */
  | { status: 'canceled' }
  | { status: 'failed'; code: string | null; message: string };

/** Creates (or re-fetches) the cart's PaymentIntent; null when that failed and the screen already said why. */
export type GetClientSecret = () => Promise<string | null>;

export type BillingDetails = {
  name: string;
  email: string;
  phone: string;
  address: { line1: string; line2: string | null; city: string; state: string; postalCode: string; country: string };
};

/** Registered by <PaymentController/> inside the provider so the screen can pay. */
export interface PaymentControllerApi {
  /** Pays with the card typed into <CardEntry/>. */
  confirmCard(getClientSecret: GetClientSecret, billing: BillingDetails): Promise<ConfirmOutcome | null>;
  /** Pays with a card already saved on the buyer's Stripe customer. */
  confirmSaved(getClientSecret: GetClientSecret, paymentMethodId: string): Promise<ConfirmOutcome | null>;
}

export type ExpressPayProps = {
  /** The page's current estimate, shown in the sheet until the address is known. */
  amountCents: number;
  subtotalCents: number;
  shippingCents: number;
  /** Prices the cart for the address the buyer picks in the sheet. */
  quote: (address: WalletContact['address']) => Promise<CartQuote | null>;
  /** The sheet was authorized: create the intent for its address and contact. */
  createIntent: (wallet: WalletContact) => Promise<string | null>;
  onOutcome: (outcome: ConfirmOutcome, wallet: WalletContact | null) => void;
  /** Whether a wallet is really usable here; the row hides itself otherwise (no dead buttons). */
  onAvailability: (available: boolean) => void;
  disabled?: boolean;
};
