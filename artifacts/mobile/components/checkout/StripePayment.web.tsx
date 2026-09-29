/**
 * In-app payment on web: @stripe/react-stripe-js with a deferred intent.
 * The Elements provider is created with the page's amount. The
 * PaymentIntent is created only when the buyer taps Pay.
 *
 *  - <CardEntry/>          Stripe's Payment Element (card only). It is an
 *                          iframe served by Stripe, so card data never
 *                          touches Brandthread's page or server.
 *  - <ExpressPay/>         Stripe's Express Checkout Element: Apple Pay in
 *                          Safari, Google Pay in Chrome. It renders only the
 *                          wallets this browser really supports, and hides
 *                          itself when there are none.
 *  - <PaymentController/>  elements.submit() → create the intent →
 *                          stripe.confirmPayment({ redirect: 'if_required' }).
 *                          3DS shows as Stripe's modal.
 *
 * Needs EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY. Without it, checkout falls back to
 * Stripe-hosted Checkout.
 */
import React, { useImperativeHandle, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { loadStripe, type Stripe, type StripeElements, type StripeElementsOptions } from '@stripe/stripe-js';
import { Elements, ExpressCheckoutElement, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { MIN_CARD_CHARGE_CENTS_CLIENT, type CartQuote, type WalletContact } from '@/lib/checkoutPayment';
import {
  stripePublishableKey,
  type BillingDetails, type ConfirmOutcome, type ExpressPayProps, type GetClientSecret, type PaymentControllerApi,
} from './stripePaymentTypes';

let stripePromise: Promise<Stripe | null> | null = null;

function stripeLoader(): Promise<Stripe | null> | null {
  const key = stripePublishableKey();
  if (!key) return null;
  stripePromise ??= loadStripe(key);
  return stripePromise;
}

export function stripePaymentAvailable(): boolean {
  return !!stripePublishableKey();
}

/** Monochrome, Inter, dark fields with a hairline border (the page's own field style). */
const APPEARANCE: StripeElementsOptions['appearance'] = {
  theme: 'night',
  variables: {
    colorPrimary: '#FFFFFF',
    colorBackground: '#000000',
    colorText: '#FFFFFF',
    colorTextSecondary: '#8A8A8A',
    colorTextPlaceholder: '#6B6B6B',
    colorDanger: '#FFFFFF',
    colorIcon: '#8A8A8A',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSizeBase: '16px',
    borderRadius: '12px',
    spacingUnit: '4px',
  },
  rules: {
    '.Input': { border: '1px solid rgba(255,255,255,0.14)', boxShadow: 'none', backgroundColor: '#000000' },
    '.Input:focus': { border: '1px solid rgba(255,255,255,0.6)', boxShadow: 'none' },
    '.Input--invalid': { border: '1px solid #FFFFFF', boxShadow: 'none' },
    '.Label': { color: '#8A8A8A', fontWeight: '500', fontSize: '13px' },
    '.Error': { color: '#FFFFFF' },
    '.Tab': { border: '1px solid rgba(255,255,255,0.14)', backgroundColor: '#000000', boxShadow: 'none' },
  },
};

export function StripePaymentProvider({ amountCents, children }: { amountCents: number; children: React.ReactNode }) {
  const loader = stripeLoader();
  const options = useMemo<StripeElementsOptions>(() => ({
    mode: 'payment',
    currency: 'usd',
    // Deferred intent: the amount only drives what the wallet sheet shows;
    // the server's PaymentIntent is the charge. Stripe needs at least 50¢.
    amount: Math.max(MIN_CARD_CHARGE_CENTS_CLIENT, Math.round(amountCents)),
    paymentMethodTypes: ['card'],
    // Matches the server (cards are kept on the buyer's Stripe customer for
    // next time, as the hosted flow always did).
    setupFutureUsage: 'off_session',
    appearance: APPEARANCE,
    fonts: [{ cssSrc: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap' }],
  }), [amountCents]);
  if (!loader) return <>{children}</>;
  return <Elements stripe={loader} options={options}>{children}</Elements>;
}

// ─── Outcomes ────────────────────────────────────────────────────────────────

type WebError = { type?: string; code?: string; decline_code?: string; message?: string };

function failed(error: WebError): ConfirmOutcome {
  return {
    status: 'failed',
    code: error.decline_code ?? error.code ?? null,
    message: error.message ?? 'Your payment didn’t go through.',
  };
}

function fromIntent(status: string | undefined): ConfirmOutcome {
  if (status === 'succeeded') return { status: 'succeeded' };
  if (status === 'processing' || status === 'requires_capture') return { status: 'processing' };
  // requires_payment_method after a closed 3DS window
  return { status: 'canceled' };
}

function returnUrl(): string {
  return typeof window !== 'undefined' ? window.location.href : 'https://brandthread.app/';
}

async function confirmWithElements(stripe: Stripe, elements: StripeElements, clientSecret: string, billing?: BillingDetails): Promise<ConfirmOutcome> {
  const { error, paymentIntent } = await stripe.confirmPayment({
    elements,
    clientSecret,
    redirect: 'if_required',
    confirmParams: {
      return_url: returnUrl(),
      ...(billing ? {
        payment_method_data: { billing_details: { name: billing.name, email: billing.email, phone: billing.phone } },
      } : {}),
    },
  });
  if (error) return failed(error);
  return fromIntent(paymentIntent?.status);
}

// ─── Card field ──────────────────────────────────────────────────────────────

export function CardEntry({ onCompleteChange }: { onCompleteChange: (complete: boolean) => void; disabled?: boolean }) {
  if (!stripePaymentAvailable()) return null;
  return (
    <View testID="checkout-card-field">
      <PaymentElement
        options={{
          layout: 'tabs',
          wallets: { applePay: 'never', googlePay: 'never' },
          // Name, email and phone come from the page's own fields.
          fields: { billingDetails: { name: 'never', email: 'never', phone: 'never' } },
        }}
        onChange={event => onCompleteChange(event.complete)}
      />
    </View>
  );
}

// ─── Controller ──────────────────────────────────────────────────────────────

/** Stripe's hooks throw outside <Elements>, which only exists with a publishable key. */
export const PaymentController = React.forwardRef<PaymentControllerApi>(function PaymentController(_props, ref) {
  if (!stripePaymentAvailable()) return null;
  return <ElementsPaymentController ref={ref} />;
});

const ElementsPaymentController = React.forwardRef<PaymentControllerApi>(function ElementsPaymentController(_props, ref) {
  const stripe = useStripe();
  const elements = useElements();
  useImperativeHandle(ref, () => ({
    async confirmCard(getClientSecret: GetClientSecret, billing: BillingDetails) {
      if (!stripe || !elements) return { status: 'failed', code: null, message: 'The secure card form is still loading. Try again.' };
      const { error: submitError } = await elements.submit();
      if (submitError) return failed(submitError);
      const clientSecret = await getClientSecret();
      if (!clientSecret) return null;
      return confirmWithElements(stripe, elements, clientSecret, billing);
    },
    async confirmSaved(getClientSecret: GetClientSecret, paymentMethodId: string) {
      if (!stripe) return { status: 'failed', code: null, message: 'Payments are still loading. Try again.' };
      const clientSecret = await getClientSecret();
      if (!clientSecret) return null;
      const { error, paymentIntent } = await stripe.confirmPayment({
        clientSecret,
        redirect: 'if_required',
        confirmParams: { payment_method: paymentMethodId, return_url: returnUrl() },
      });
      if (error) return failed(error);
      return fromIntent(paymentIntent?.status);
    },
  }), [stripe, elements]);
  return null;
});

// ─── Apple Pay / Google Pay ──────────────────────────────────────────────────

function sheetLines(amountCents: number, shippingCents: number, taxCents: number) {
  // Items + tax + the shipping rate add up to exactly the amount.
  return {
    lineItems: [
      { name: 'Items', amount: Math.max(0, amountCents - shippingCents - taxCents) },
      ...(taxCents > 0 ? [{ name: 'Tax', amount: taxCents }] : []),
    ],
    shippingRates: [{ id: 'seller-shipping', displayName: 'Shipping', amount: shippingCents }],
  };
}

export function ExpressPay(props: ExpressPayProps) {
  if (!stripePaymentAvailable()) return null;
  return <ElementsExpressPay {...props} />;
}

function ElementsExpressPay({ amountCents, shippingCents, quote, createIntent, onOutcome, onAvailability, disabled }: ExpressPayProps) {
  const stripe = useStripe();
  const elements = useElements();
  const priced = useRef<CartQuote | null>(null);

  return (
    <View style={{ opacity: disabled ? 0.4 : 1 }} pointerEvents={disabled ? 'none' : 'auto'} testID="checkout-express-pay">
      <ExpressCheckoutElement
        options={{
          buttonType: { applePay: 'buy', googlePay: 'buy' },
          buttonTheme: { applePay: 'white', googlePay: 'white' },
          buttonHeight: 50,
          layout: { maxColumns: 1, maxRows: 2, overflow: 'never' },
          paymentMethods: { link: 'never', amazonPay: 'never', paypal: 'never', klarna: 'never' },
          emailRequired: true,
          phoneNumberRequired: true,
          shippingAddressRequired: true,
          allowedShippingCountries: ['US'],
        }}
        onReady={event => {
          const methods = event.availablePaymentMethods;
          onAvailability(!!methods && (!!methods.applePay || !!methods.googlePay));
        }}
        onClick={event => {
          priced.current = null;
          event.resolve(sheetLines(amountCents, shippingCents, 0));
        }}
        onShippingAddressChange={async event => {
          const next = await quote({
            city: event.address.city, state: event.address.state,
            postalCode: event.address.postal_code, country: event.address.country,
          }).catch(() => null);
          if (!next || !elements) {
            event.reject();
            return;
          }
          priced.current = next;
          const ship = next.groups.reduce((sum, group) => sum + group.shippingCents, 0);
          const tax = next.groups.reduce((sum, group) => sum + group.taxCents, 0);
          elements.update({ amount: Math.max(MIN_CARD_CHARGE_CENTS_CLIENT, next.amountCents) });
          event.resolve(sheetLines(next.amountCents, ship, tax));
        }}
        onConfirm={async event => {
          if (!stripe || !elements) {
            event.paymentFailed({ reason: 'fail' });
            return;
          }
          const { error: submitError } = await elements.submit();
          if (submitError) {
            event.paymentFailed({ reason: 'fail' });
            onOutcome(failed(submitError), null);
            return;
          }
          const shipping = event.shippingAddress;
          const wallet: WalletContact = {
            name: shipping?.name ?? event.billingDetails?.name ?? '',
            email: event.billingDetails?.email ?? null,
            phone: event.billingDetails?.phone ?? null,
            address: {
              line1: shipping?.address.line1 ?? '',
              line2: shipping?.address.line2 ?? null,
              city: shipping?.address.city ?? '',
              state: shipping?.address.state ?? '',
              postalCode: shipping?.address.postal_code ?? '',
              country: shipping?.address.country ?? 'US',
            },
          };
          const clientSecret = await createIntent(wallet);
          if (!clientSecret) {
            event.paymentFailed({ reason: 'fail' });
            return;
          }
          onOutcome(await confirmWithElements(stripe, elements, clientSecret), wallet);
        }}
      />
    </View>
  );
}
