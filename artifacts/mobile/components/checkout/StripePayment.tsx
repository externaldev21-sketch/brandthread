/**
 * In-app payment on iOS / Android: @stripe/stripe-react-native.
 *
 *  - <CardEntry/>          Stripe's CardField. The card number, expiry and
 *                          CVC stay inside Stripe's native view; the app only
 *                          ever learns "complete or not".
 *  - <ExpressPay/>         the official Apple Pay / Google Pay button. The
 *                          sheet supplies the name, shipping address, contact
 *                          and payment; the total is re-priced for the address
 *                          the buyer picks (onShippingContactSelected).
 *  - <PaymentController/>  confirms the cart's PaymentIntent. 3DS is handled
 *                          by the SDK.
 *
 * Stripe's native module is not in Expo Go (it needs an EAS dev build). The
 * SDK is only required once `stripePaymentAvailable()` has found the module
 * and a publishable key, so Expo Go still loads and checkout falls back to
 * Stripe-hosted Checkout.
 */
import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { NativeModules, Platform, StyleSheet, TurboModuleRegistry, View } from 'react-native';
import { centsToAmountString, type CartQuote, type WalletContact } from '@/lib/checkoutPayment';
import { FONT } from '@/lib/theme';
import { reportError } from '@/lib/monitoring';
import { isExpoGo } from '@/lib/expoGoRuntime';
import { reportStripeUnavailableOnce, shouldReportStripeUnavailable, stripeUnavailableReason } from '@/lib/stripeLaunchCheck';
import { useCheckoutColors } from './CheckoutPrimitives';
import {
  APPLE_MERCHANT_ID, stripePublishableKey,
  type BillingDetails, type ConfirmOutcome, type ExpressPayProps, type GetClientSecret, type PaymentControllerApi,
} from './stripePaymentTypes';

// Type-only: erased at build time, so Expo Go never loads the native SDK.
import type { PlatformPay as PlatformPayTypes } from '@stripe/stripe-react-native';

type StripeSdk = typeof import('@stripe/stripe-react-native');

let cachedSdk: StripeSdk | null | undefined;

function nativeModulePresent(): boolean {
  try {
    return !!(TurboModuleRegistry.get('StripeSdk') ?? (NativeModules as Record<string, unknown>).StripeSdk);
  } catch {
    return false;
  }
}

function sdk(): StripeSdk | null {
  if (cachedSdk !== undefined) return cachedSdk;
  const unavailable = stripeUnavailableReason({ hasPublishableKey: !!stripePublishableKey(), nativeModulePresent: nativeModulePresent() });
  if (unavailable) {
    cachedSdk = null;
    // BT-271: a production build without in-app payments is a launch bug, not a quiet fallback.
    if (shouldReportStripeUnavailable({ isDev: __DEV__, isExpoGo: isExpoGo() })) {
      reportStripeUnavailableOnce(unavailable, Platform.OS, reportError);
    }
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedSdk = require('@stripe/stripe-react-native') as StripeSdk;
  } catch {
    cachedSdk = null;
  }
  return cachedSdk;
}

/** True when the app can take a payment itself (dev/prod build with a key). */
export function stripePaymentAvailable(): boolean {
  return sdk() !== null;
}

export function StripePaymentProvider({ children }: { amountCents: number; children: React.ReactNode; onUnavailable?: () => void; paymentMethodTypes?: string[] }) {
  const stripe = sdk();
  if (!stripe) return <>{children}</>;
  const { StripeProvider } = stripe;
  return (
    <StripeProvider publishableKey={stripePublishableKey()} merchantIdentifier={APPLE_MERCHANT_ID} urlScheme="brandthread">
      <>{children}</>
    </StripeProvider>
  );
}

// ─── Outcomes ────────────────────────────────────────────────────────────────

type SdkError = { code?: string; message?: string; localizedMessage?: string; declineCode?: string; stripeErrorCode?: string };

function failed(error: SdkError): ConfirmOutcome {
  if (error.code === 'Canceled') return { status: 'canceled' };
  return {
    status: 'failed',
    code: error.declineCode ?? error.stripeErrorCode ?? null,
    message: error.localizedMessage ?? error.message ?? 'Your payment didn’t go through.',
  };
}

function fromIntent(status: string | undefined): ConfirmOutcome {
  if (status === 'Succeeded') return { status: 'succeeded' };
  if (status === 'Processing' || status === 'RequiresCapture') return { status: 'processing' };
  return { status: 'failed', code: null, message: 'Your bank didn’t approve this payment. Try again or use another card.' };
}

async function confirm(stripe: StripeSdk, clientSecret: string, paymentMethodData: { paymentMethodId?: string; billingDetails?: BillingDetails }): Promise<ConfirmOutcome> {
  const billing = paymentMethodData.billingDetails;
  const params = paymentMethodData.paymentMethodId
    ? { paymentMethodType: 'Card' as const, paymentMethodData: { paymentMethodId: paymentMethodData.paymentMethodId } }
    : {
        paymentMethodType: 'Card' as const,
        paymentMethodData: {
          billingDetails: billing ? {
            name: billing.name,
            email: billing.email,
            phone: billing.phone,
            address: {
              line1: billing.address.line1,
              ...(billing.address.line2 ? { line2: billing.address.line2 } : {}),
              city: billing.address.city,
              state: billing.address.state,
              postalCode: billing.address.postalCode,
              country: billing.address.country,
            },
          } : undefined,
        },
      };
  const { error, paymentIntent } = await stripe.confirmPayment(clientSecret, params);
  if (error) return failed(error as SdkError);
  return fromIntent(paymentIntent?.status);
}

// ─── Card field ──────────────────────────────────────────────────────────────

export function CardEntry({ onCompleteChange, disabled }: { onCompleteChange: (complete: boolean) => void; disabled?: boolean }) {
  const ck = useCheckoutColors();
  const stripe = sdk();
  if (!stripe) return null;
  const { CardField } = stripe;
  return (
    <CardField
      postalCodeEnabled
      countryCode="US"
      disabled={disabled}
      placeholders={{ number: 'Card number' }}
      cardStyle={{
        backgroundColor: ck.bg,
        textColor: ck.text,
        placeholderColor: ck.subtle,
        cursorColor: ck.text,
        textErrorColor: ck.text,
        borderColor: ck.fieldBorder,
        borderWidth: 1,
        borderRadius: 12,
        fontSize: 16,
        fontFamily: FONT.regular,
      }}
      style={styles.cardField}
      onCardChange={details => onCompleteChange(!!details.complete)}
      accessibilityLabel="Card details"
      testID="checkout-card-field"
    />
  );
}

// ─── Controller ──────────────────────────────────────────────────────────────

export const PaymentController = React.forwardRef<PaymentControllerApi>(function PaymentController(_props, ref) {
  useImperativeHandle(ref, () => ({
    async confirmCard(getClientSecret: GetClientSecret, billing: BillingDetails) {
      const stripe = sdk();
      if (!stripe) return { status: 'failed', code: null, message: 'Payments aren’t available in this build.' };
      const clientSecret = await getClientSecret();
      if (!clientSecret) return null;
      return confirm(stripe, clientSecret, { billingDetails: billing });
    },
    async confirmSaved(getClientSecret: GetClientSecret, paymentMethodId: string) {
      const stripe = sdk();
      if (!stripe) return { status: 'failed', code: null, message: 'Payments aren’t available in this build.' };
      const clientSecret = await getClientSecret();
      if (!clientSecret) return null;
      return confirm(stripe, clientSecret, { paymentMethodId });
    },
  }), []);
  return null;
});

// ─── Apple Pay / Google Pay ──────────────────────────────────────────────────

type ShippingContact = {
  emailAddress?: string;
  phoneNumber?: string;
  name?: { givenName?: string; familyName?: string };
  postalAddress?: { street?: string; city?: string; state?: string; postalCode?: string; isoCountryCode?: string; country?: string };
};

function walletFromContact(contact: ShippingContact | undefined, billing?: { name?: string; email?: string; phone?: string; address?: Record<string, string | undefined> }): WalletContact {
  const street = (contact?.postalAddress?.street ?? billing?.address?.line1 ?? '').split('\n');
  return {
    name: [contact?.name?.givenName, contact?.name?.familyName].filter(Boolean).join(' ') || billing?.name || '',
    email: contact?.emailAddress ?? billing?.email ?? null,
    phone: contact?.phoneNumber ?? billing?.phone ?? null,
    address: {
      line1: street[0] ?? '',
      line2: street.slice(1).join(', ') || billing?.address?.line2 || null,
      city: contact?.postalAddress?.city ?? billing?.address?.city ?? '',
      state: contact?.postalAddress?.state ?? billing?.address?.state ?? '',
      postalCode: contact?.postalAddress?.postalCode ?? billing?.address?.postalCode ?? '',
      country: (contact?.postalAddress?.isoCountryCode ?? billing?.address?.country ?? 'US').toUpperCase(),
    },
  };
}

export function ExpressPay({ amountCents, subtotalCents, shippingCents, quote, createIntent, onOutcome, onAvailability, disabled }: ExpressPayProps) {
  const stripe = sdk();
  const [supported, setSupported] = useState(false);
  const priced = useRef<CartQuote | null>(null);

  useEffect(() => {
    let active = true;
    if (!stripe) {
      onAvailability(false);
      return;
    }
    void stripe.isPlatformPaySupported({ googlePay: { testEnv: __DEV__ } })
      .then(value => { if (active) { setSupported(value); onAvailability(value); } })
      .catch(() => { if (active) { setSupported(false); onAvailability(false); } });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stripe]);

  const cartItems = useCallback((next: CartQuote | null): PlatformPayTypes.CartSummaryItem[] => {
    if (!stripe) return [];
    const { PlatformPay } = stripe;
    const tax = next ? next.groups.reduce((sum, group) => sum + group.taxCents, 0) : 0;
    const ship = next ? next.groups.reduce((sum, group) => sum + group.shippingCents, 0) : shippingCents;
    const discount = next ? next.groups.reduce((sum, group) => sum + group.discountCents, 0) : 0;
    const total = next ? next.amountCents : amountCents;
    const item = (label: string, cents: number, pending = false): PlatformPayTypes.ImmediateCartSummaryItem => ({
      paymentType: PlatformPay.PaymentType.Immediate as PlatformPayTypes.PaymentType.Immediate,
      label,
      amount: cents < 0 ? `-${centsToAmountString(-cents)}` : centsToAmountString(cents),
      ...(pending ? { isPending: true } : {}),
    });
    return [
      item('Subtotal', subtotalCents),
      ...(discount > 0 ? [item('Discount', -discount)] : []),
      item('Shipping', ship),
      item('Tax', tax, !next),
      item('Brandthread', total, !next),
    ];
  }, [stripe, amountCents, subtotalCents, shippingCents]);

  const onShippingContactSelected = useCallback(async ({ shippingContact }: { shippingContact: ShippingContact }) => {
    if (!stripe) return;
    const { PlatformPay } = stripe;
    const next = await quote(walletFromContact(shippingContact).address).catch(() => null);
    priced.current = next;
    await stripe.updatePlatformPaySheet({
      applePay: {
        cartItems: cartItems(next),
        shippingMethods: [],
        errors: next ? [] : [{
          errorType: PlatformPay.ApplePaySheetErrorType.UnserviceableShippingAddress,
          message: 'These items can’t ship to this address.',
        }],
      },
    });
  }, [stripe, quote, cartItems]);

  const pay = useCallback(async () => {
    if (!stripe) return;
    const { PlatformPay } = stripe;
    priced.current = null;
    const result = await stripe.createPlatformPayPaymentMethod({
      applePay: {
        cartItems: cartItems(null),
        merchantCountryCode: 'US',
        currencyCode: 'USD',
        requiredShippingAddressFields: [
          PlatformPay.ContactField.Name, PlatformPay.ContactField.PostalAddress,
          PlatformPay.ContactField.PhoneNumber, PlatformPay.ContactField.EmailAddress,
        ],
        requiredBillingContactFields: [PlatformPay.ContactField.PostalAddress],
        supportedCountries: undefined,
      },
      googlePay: {
        testEnv: __DEV__,
        merchantName: 'Brandthread',
        merchantCountryCode: 'US',
        currencyCode: 'USD',
        amount: amountCents,
        label: 'Brandthread',
        isEmailRequired: true,
        shippingAddressConfig: { isRequired: true, isPhoneNumberRequired: true, allowedCountryCodes: ['US'] },
        billingAddressConfig: { isRequired: true, isPhoneNumberRequired: true, format: PlatformPay.BillingAddressFormat.Full },
      },
    });
    if (result.error) {
      onOutcome(failed(result.error as SdkError), null);
      return;
    }
    const billing = result.paymentMethod.billingDetails as { name?: string; email?: string; phone?: string; address?: Record<string, string | undefined> };
    const wallet = walletFromContact(result.shippingContact as ShippingContact | undefined, billing);
    const clientSecret = await createIntent(wallet);
    if (!clientSecret) return;
    onOutcome(await confirm(stripe, clientSecret, { paymentMethodId: result.paymentMethod.id }), wallet);
  }, [stripe, cartItems, amountCents, createIntent, onOutcome]);

  if (!stripe || !supported) return null;
  const { PlatformPayButton, PlatformPay } = stripe;
  return (
    <View style={{ opacity: disabled ? 0.4 : 1 }} pointerEvents={disabled ? 'none' : 'auto'}>
      <PlatformPayButton
        type={PlatformPay.ButtonType.Buy}
        appearance={PlatformPay.ButtonStyle.White}
        borderRadius={999}
        onPress={() => void pay()}
        onShippingContactSelected={event => void onShippingContactSelected(event as { shippingContact: ShippingContact })}
        disabled={disabled}
        style={styles.wallet}
        accessibilityLabel={Platform.OS === 'ios' ? 'Buy with Apple Pay' : 'Buy with Google Pay'}
        testID="checkout-express-pay"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  cardField: { width: '100%', height: 52 },
  wallet: { width: '100%', height: 50 },
});
