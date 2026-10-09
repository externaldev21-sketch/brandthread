/**
 * Buyer checkout: ONE page for every purchase path (Buy Now, the cart's
 * "Checkout from {Seller}", the Shop sheet), copied from the Shop app's
 * Review & Pay screen (Mobbin 469375d4-5ee8-450a-80ca-30582b5e7b38) and
 * reskinned for Brandthread. Top to bottom:
 *
 *   Express    Apple Pay / Google Pay. The sheet supplies the name, the
 *              shipping address and the payment.
 *   CONTACT    email, phone
 *   SHIPPING   saved addresses as rows + "Use a new address", or the inline
 *              form: full name, street (Google Places), apt, city, state,
 *              ZIP, country
 *   PAYMENT    saved cards as rows + Stripe's secure card field
 *   PROMO / THREAD CASH / pre-order terms, when they apply
 *   ORDER SUMMARY  items by seller (3:4 thumbnails), delivery window,
 *              subtotal, shipping, tax, total
 *   sticky     "Pay $X"
 *
 * Flat pure-black page: no card containers, small uppercase labels, 1px
 * hairlines between sections, and an opaque black header bar fully below
 * the notch that the content scrolls under.
 *
 * Payment (lib/checkoutPayment.ts choosePaymentPath):
 *  - in-app (default): the server prices the cart, reserves stock and creates
 *    ONE PaymentIntent for every seller (routes/checkout-intent.ts). The app
 *    confirms it with Stripe's SDK, which handles 3DS. The paid webhook then
 *    creates one order per seller. Card data only ever goes to Stripe.
 *  - hosted fallback: the previous per-seller Stripe Checkout loop,
 *    unchanged. Used for guests, preorders, Thread Cash, loyalty, a build
 *    without Stripe's native module (Expo Go), or when the
 *    hostedCheckoutFallback flag is on.
 *  - preview: the dev-web preview's fake pay path (no Stripe), with the same
 *    confirmation screen.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStableCallback } from '@/hooks/useStableCallback';
import {
  KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { randomUUID } from 'expo-crypto';
import { useAuth } from '@clerk/expo';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useThreadPull } from '@/contexts/ThreadPullTransitionContext';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { useCheckoutThreadCash } from '@/hooks/useCheckoutThreadCash';
import { threadCashCeilingCents, withThreadCashRedemption } from '@/lib/threadCashCheckout';
import { isPreviewCheckoutGroup, placePreviewOrder, withPreviewCheckoutDetails } from '@/lib/previewCheckout';
import {
  applyDiscount, createCheckoutSession,
  getCart, getCheckoutSession, removeCartItems, removeDiscount, saveCheckoutProgress, validateCart,
} from '@/services/cartService';
import {
  CheckoutAddress, CheckoutContact, CheckoutDiscount, CheckoutSession,
} from '@/services/cartTypes';
import { useApi } from '@/hooks/useApi';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { formatCents } from '@/lib/money';
import {
  getCheckoutBlockingSection,
  getCheckoutDisplayTotals,
  getCheckoutNextStepHint,
  getFirstIncompleteCheckoutSection,
  mergeCheckoutFormState,
  withoutImplicitTermsAck,
  type CheckoutDisplayTotals,
} from '@/lib/checkoutReadiness';
import {
  buildCreatePaymentIntentBody, buildQuoteBody, canQuote, choosePaymentPath, paymentErrorMessage,
  isCartQuote, quoteKey, quoteOffersBnpl, quoteTotals, recipientName, walletContactToCheckout,
  type CartQuote, type PaymentIntentStart, type WalletContact,
} from '@/lib/checkoutPayment';
import { ApiError } from '@/lib/networkNotice';
import { CheckoutSkeleton, PressableScale } from '@/components/BrandthreadUI';
import { StickyFooter } from '@/components/layout';
import { trackAndRelayConversionEvent } from '@/lib/marketingPixels';
import { Button, ErrorState, IconButton } from '@/components/ui';
import { BuyerProtectionNote } from '@/components/BuyerProtectionNote';
import { CheckoutSection, GUTTER, useCheckoutColors, type CheckoutColors } from '@/components/checkout/CheckoutPrimitives';
import { ContactSection } from '@/components/checkout/ContactSection';
import { ShippingSection, type CheckoutAddressDraft, type SavedAddress } from '@/components/checkout/ShippingSection';
import {
  BNPL, ExpressSection, HostedExpressButton, NEW_CARD, PaymentSection, type SavedCard,
} from '@/components/checkout/PaymentSection';
import { PromoCodeSection } from '@/components/checkout/PromoCodeSection';
import { GiftCardSection } from '@/components/checkout/GiftCardSection';
import { ThreadCashSection } from '@/components/checkout/ThreadCashSection';
import { OrderSummarySection } from '@/components/checkout/OrderSummarySection';
import { CheckoutTermsLine } from '@/components/checkout/CheckoutTermsLine';
import { OrderConfirmation, OrderConfirmationActions } from '@/components/checkout/OrderConfirmation';
import {
  ExpressPay, PaymentController, StripePaymentProvider, stripePaymentAvailable,
} from '@/components/checkout/StripePayment';
import type { ConfirmOutcome, PaymentControllerApi } from '@/components/checkout/stripePaymentTypes';
import { FONT, FS, SP } from '@/lib/theme';
import { getLiveCheckoutContext } from '@/lib/live/liveCheckoutContext';
import { FirstRunTip } from '@/components/first-run-tips/FirstRunTip';
import { BUYER_CHECKOUT_STEPS } from '@/lib/firstRunTips/content';

/**
 * A fully verified order reference returned from the server after payment.
 * `id`     — server-assigned UUID used for all API calls and navigation.
 * `number` — human-readable display string shown to the buyer (e.g. "BT-1234").
 */
export interface VerifiedOrder {
  id: string;
  number: string;
  sellerId: string;
}

type CheckoutError = { title: string; message: string };

/** Pending reconciliation entry for an in-app payment (vs a hosted Checkout Session id). */
const PI_PREFIX = 'pi:';
// Stable empties for guests, so memoized sections aren't handed a fresh []
// on every render (every keystroke in the contact/address fields).
const NO_SAVED_CARDS: SavedCard[] = [];
const NO_SAVED_ADDRESSES: SavedAddress[] = [];
// The wallet button (Apple Pay / Google Pay / Link) only depends on totals and
// stable callbacks — skip it when the buyer is typing an address.
const MemoExpressPay = React.memo(ExpressPay);

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function BuyerCheckoutScreen() {
  const ck = useCheckoutColors();
  const styles = useMemo(() => makeStyles(ck), [ck]);
  const { source } = useLocalSearchParams<{ source?: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const { back } = useThreadPull();
  // thread-checkout.tsx is a redirect alias — use ThreadPull transition if coming from there
  const usesThreadPull = pathname === '/thread-checkout';
  const leaveCheckout = () => (usesThreadPull ? back() : goBackOr(router));
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { isSignedIn } = useAuth();
  const threadCashCheckoutEnabled = useFeatureFlag('threadCashCheckoutDiscount');
  const hostedFallbackFlag = useFeatureFlag('hostedCheckoutFallback');

  const [session, setSession] = useState<CheckoutSession | null>(null);
  const [contact, setContact] = useState<Partial<CheckoutContact>>({ orderUpdates: 'email', marketingConsent: false });
  const [address, setAddress] = useState<CheckoutAddressDraft>({ country: 'US' });
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  const [selectedCard, setSelectedCard] = useState<string>(NEW_CARD);
  const [cardComplete, setCardComplete] = useState(false);
  const [walletAvailable, setWalletAvailable] = useState(false);
  const [quote, setQuote] = useState<{ key: string; value: CartQuote } | null>(null);
  const [serverSaidHosted, setServerSaidHosted] = useState(false);
  const [stripeLoadFailed, setStripeLoadFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<CheckoutError | null>(null);
  const [canRetryPayment, setCanRetryPayment] = useState(false);
  const [footerHeight, setFooterHeight] = useState(150);
  const scrollRef = useRef<ScrollView>(null);
  const controllerRef = useRef<PaymentControllerApi>(null);
  const startedRef = useRef<PaymentIntentStart | null>(null);
  /**
   * Fully verified orders — each entry has a real server `id` (used for navigation/API)
   * and a human-readable `number` (used for display only).
   */
  const [verifiedOrders, setVerifiedOrders] = useState<VerifiedOrder[]>([]);
  const [pendingSessionIds, setPendingSessionIds] = useState<string[]>([]);
  /**
   * In-memory map: sellerId → verified server order ID.
   * Populated as each payment is verified so we can skip already-paid groups
   * if pay() is called again (retry path) without double-charging.
   */
  const paidRef = useRef(new Map<string, string>());

  const showError = (next: CheckoutError) => {
    setError(next);
    // The banner sits at the top of the scroll content — bring it into view.
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  // Load / restore checkout session
  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      let next = await getCheckoutSession();
      if (!next) {
        const cart = await getCart();
        if (!cart.items.length) { leaveCheckout(); return; }
        next = await createCheckoutSession(cart, source === 'buynow');
      }
      // Normalize legacy step values
      if (next.step === 'contact' || next.step === 'shipping' || next.step === 'discounts' || next.step === 'payment') {
        next.step = 'information';
      }
      // The generic terms checkbox is now the plain line under Pay — drop it
      // from sessions saved before that change (pre-order acks stay).
      next.acknowledgments = withoutImplicitTermsAck(next.acknowledgments ?? []);
      let restoredContact: Partial<CheckoutContact> = next.contact ?? { orderUpdates: 'email', marketingConsent: false };
      let restoredAddress: CheckoutAddressDraft = next.shippingAddress ?? { country: 'US', saveAddress: true };
      // Dev-web preview only: an all-preview order gets the preview buyer's
      // demo contact and address, so Pay is one tap on the live preview.
      // isPreviewCheckoutGroup is false for any real product or seller and in
      // production builds, so real checkouts are unchanged.
      if (next.deliveryGroups.length > 0 && next.deliveryGroups.every(isPreviewCheckoutGroup)) {
        ({ contact: restoredContact, address: restoredAddress } = withPreviewCheckoutDetails(restoredContact, restoredAddress));
      }
      const firstIncomplete = getFirstIncompleteCheckoutSection(restoredContact, restoredAddress, next);
      if (next.step !== 'confirmation') next.step = firstIncomplete;

      setSession(next);
      setContact(restoredContact);
      setAddress(restoredAddress);

      // Restore paid state — only entries with a verified orderId are considered confirmed.
      const restoredVerified: VerifiedOrder[] = [];
      const restoredPending = new Set<string>();
      for (const [sellerId, payment] of Object.entries(next.paidGroups ?? {})) {
        if (payment.orderId) {
          restoredVerified.push({ id: payment.orderId, number: payment.orderNumber ?? payment.orderId, sellerId });
          paidRef.current.set(sellerId, payment.orderId);
        } else if (payment.stripeSessionId.startsWith('pi_') && payment.stripeSessionId.includes(':')) {
          // In-app payment: "<paymentIntentId>:<checkoutRowId>".
          restoredPending.add(`${PI_PREFIX}${payment.stripeSessionId.split(':')[0]}`);
        } else if (!payment.stripeSessionId.startsWith('preview_')) {
          restoredPending.add(payment.guestAccessToken
            ? `${payment.stripeSessionId}|${payment.guestAccessToken}`
            : payment.stripeSessionId);
        }
      }
      setVerifiedOrders(restoredVerified);
      // A pending in-app payment only matters once it was confirmed (the
      // confirmation step); before that it is simply retried with Pay.
      setPendingSessionIds(next.step === 'confirmation' ? [...restoredPending] : [...restoredPending].filter(id => !id.startsWith(PI_PREFIX)));

      // Meta Pixel + Conversions API — fires once when checkout actually
      // starts (session freshly loaded/created), not on every re-render.
      if (next.step !== 'confirmation') {
        void trackAndRelayConversionEvent(
          'InitiateCheckout',
          { value: next.summary.totalCents / 100, currency: next.summary.currency },
          { valueCents: next.summary.totalCents, currency: next.summary.currency },
        );
      }

      // Saved addresses and cards for signed-in buyers
      if (isSignedIn) {
        try {
          const [addresses, profile] = await Promise.all([
            api.buyer.addresses.list(),
            api.auth.me(),
          ]);
          setSavedAddresses(addresses as SavedAddress[]);
          setContact(previous => ({
            ...previous,
            email: previous.email?.trim() || profile.email || '',
          }));
          if (addresses.length > 0 && !next.shippingAddress) {
            const defaultAddr = addresses.find((a: any) => a.isDefault) || addresses[0];
            handleSelectAddress(defaultAddr);
          }
        } catch {
          // ignore
        }
        // Cards on the buyer's Stripe customer (the one the PaymentIntent is created for).
        void api.reviews.paymentMethods()
          .then((data: any) => {
            const cards: SavedCard[] = Array.isArray(data?.paymentMethods) ? data.paymentMethods : [];
            setSavedCards(cards);
            const preferred = cards.find(card => card.isDefault) ?? cards[0];
            if (preferred) setSelectedCard(preferred.id);
          })
          .catch(() => setSavedCards([]));
      }

      setLoading(false);
    } catch {
      // e.g. a seller's shipping rate couldn't be loaded — never spin forever.
      setLoadFailed(true);
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Only touches state setters, so one identity for the memoized ShippingSection.
  const handleSelectAddress = useCallback((addr: SavedAddress) => {
    const parts = addr.recipientName ? addr.recipientName.split(' ') : [];
    setAddress({
      id: addr.id,
      firstName: parts[0] || '',
      lastName: parts.length > 1 ? parts.slice(1).join(' ') : '',
      line1: addr.street,
      line2: addr.line2 ?? '',
      city: addr.city,
      state: addr.state,
      postalCode: addr.postalCode,
      country: addr.country ?? 'US',
      saveAddress: false,
    });
    setContact(previous => ({
      ...previous,
      phone: addr.phone || previous.phone || '',
    }));
  }, []);

  const sessionRef = useRef(session);
  sessionRef.current = session;

  const persist = async (next: CheckoutSession, overrides?: { contact?: Partial<CheckoutContact>; address?: Partial<CheckoutAddress> }) => {
    const snapshot = mergeCheckoutFormState(next, overrides?.contact ?? contact, overrides?.address ?? address);
    sessionRef.current = snapshot;
    setSession(snapshot);
    await saveCheckoutProgress(snapshot);
  };

  const current = session as CheckoutSession;

  // Dev-web preview only (lib/previewCheckout.ts): every group is seeded
  // preview products, so there is no server cart or Stripe to talk to.
  const previewOnly = !!current?.deliveryGroups?.length && current.deliveryGroups.every(isPreviewCheckoutGroup);

  // ── Live-only code tapped in a live ─────────────────────────────────────
  // A viewer who tapped a live code in the stream has it applied here once
  // (the server still validates it against the live at checkout).
  const liveCodeToApply = !previewOnly && session?.deliveryGroups?.length === 1 && !session.discounts.some(d => d.isValid)
    ? getLiveCheckoutContext(session.deliveryGroups[0].sellerId)?.code ?? null
    : null;
  useEffect(() => {
    if (!liveCodeToApply || !sessionRef.current) return;
    let active = true;
    void applyDiscount(liveCodeToApply, sessionRef.current.summary.subtotalCents, sessionRef.current.discounts)
      .then(async discount => {
        if (!active || !discount.isValid || !sessionRef.current) return;
        await persist({ ...sessionRef.current, discounts: [discount], idempotencyKey: `ck_${randomUUID()}` });
      })
      .catch(() => {});
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveCodeToApply]);

  // ── Thread Cash (item 109) ──────────────────────────────────────────────
  // Single-seller, signed-in orders only (a token discounts one Stripe
  // session), behind the OFF-by-default 'threadCashCheckoutDiscount' flag.
  const threadCashEligible = !!session && !!isSignedIn && threadCashCheckoutEnabled
    && session.deliveryGroups.length === 1 && session.step !== 'confirmation'
    // Preview orders never reach the server, so there's no wallet to use.
    && !previewOnly;
  const liveTotals = session ? getCheckoutDisplayTotals(session) : null;
  const threadCash = useCheckoutThreadCash({
    enabled: threadCashEligible,
    redemption: session?.threadCashRedemption ?? null,
    ceilingCents: session && liveTotals
      ? threadCashCeilingCents({
          subtotalCents: liveTotals.subtotalCents,
          shippingCents: liveTotals.shippingCents,
          promoCents: liveTotals.promoCents,
          loyaltyCents: session.loyaltyRedemption?.discountCents ?? 0,
        })
      : 0,
    onChange: async (redemption) => {
      if (!sessionRef.current) return;
      await persist(withThreadCashRedemption(sessionRef.current, redemption, `ck_${randomUUID()}`));
    },
  });

  // ── Which way this order pays ───────────────────────────────────────────
  const payment = useMemo(() => choosePaymentPath({
    previewOnly,
    signedIn: !!isSignedIn,
    hostedFallbackFlag,
    stripeAvailable: stripePaymentAvailable() && !stripeLoadFailed,
    hasPreOrder: !!session?.deliveryGroups.some(group => group.hasPreOrder || group.items.some(item => item.isPreOrder)),
    threadCashApplied: (session?.threadCashRedemption?.discountCents ?? 0) > 0,
    loyaltyApplied: (session?.loyaltyRedemption?.discountCents ?? 0) > 0,
    serverSaidHosted,
  }), [previewOnly, isSignedIn, hostedFallbackFlag, session, serverSaidHosted, stripeLoadFailed]);
  const inApp = payment.path === 'in_app';

  // ── Server quote: real shipping + tax for the address (in-app only) ─────
  const quoteBody = session && inApp && canQuote(address) ? buildQuoteBody(session, address) : null;
  const currentQuoteKey = quoteBody ? quoteKey(quoteBody) : null;
  useEffect(() => {
    if (!quoteBody || !currentQuoteKey || quote?.key === currentQuoteKey) return;
    let active = true;
    const timer = setTimeout(() => {
      api.buyer.checkout.paymentIntent.quote(quoteBody)
        // Only a well-formed quote replaces the session's estimate; anything
        // else (an old server, a proxy page) leaves the page on the estimate.
        .then(value => { if (active && isCartQuote(value)) setQuote({ key: currentQuoteKey, value }); })
        .catch((err: unknown) => {
          if (!active) return;
          const apiError = err instanceof ApiError ? err : null;
          if (apiError?.code === 'USE_HOSTED_CHECKOUT') setServerSaidHosted(true);
          else if (apiError && apiError.status >= 400 && apiError.status < 500 && apiError.status !== 429) {
            setError({ title: 'Some items in your order changed', message: apiError.message });
          }
        });
    }, 450);
    return () => { active = false; clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuoteKey]);
  const activeQuote = quote && quote.key === currentQuoteKey ? quote.value : null;

  const validateServerCart = async () => {
    if (!isSignedIn || previewOnly) return true;
    try {
      const result = await validateCart(
        current.deliveryGroups.flatMap(g => g.items),
        current.discounts.filter(d => d.isValid).map(d => d.code),
        getLiveCheckoutContext(current.deliveryGroups[0]?.sellerId)?.streamId,
      );
      if (!result.isValid) {
        // Out of stock / price changed / unavailable — shown inline, not as an alert.
        showError({
          title: 'Some items in your order changed',
          message: result.issues.map(i => `• ${i.message}`).join('\n') || 'Review your cart and try again.',
        });
        return false;
      }
      return true;
    } catch {
      showError({
        title: 'Unable to verify your order',
        message: 'We could not confirm current prices and availability. Check your connection and try again.',
      });
      return false;
    }
  };

  // ─── In-app payment (one PaymentIntent for the cart) ──────────────────────

  /** A new pay attempt after a failure: the old intent is closed and its stock released. */
  const startFreshAttempt = async (intent: PaymentIntentStart | null, base: CheckoutSession) => {
    if (intent) {
      await api.buyer.checkout.paymentIntent.cancel(intent.paymentIntentId).catch(() => {});
    }
    startedRef.current = null;
    const paidGroups = { ...(base.paidGroups ?? {}) };
    for (const group of base.deliveryGroups) {
      if (paidGroups[group.sellerId] && !paidGroups[group.sellerId].orderId) delete paidGroups[group.sellerId];
    }
    await persist({ ...base, paidGroups, idempotencyKey: `ck_${randomUUID()}` });
  };

  /** Creates the cart's PaymentIntent for this address/contact. Null (and the reason shown) on failure. */
  const startPaymentIntent = async (
    base: CheckoutSession,
    who: { contact: Partial<CheckoutContact>; address: Partial<CheckoutAddress> },
  ): Promise<string | null> => {
    try {
      const started = await api.buyer.checkout.paymentIntent.create(buildCreatePaymentIntentBody({
        session: base,
        contact: who.contact,
        address: who.address,
        idempotencyKey: base.idempotencyKey,
        saveCard: true,
      }));
      startedRef.current = started;
      // Remember the intent so a restart can find the orders it produced.
      const paidGroups = { ...(base.paidGroups ?? {}) };
      for (const group of started.groups) {
        paidGroups[group.sellerId] = { stripeSessionId: `${started.paymentIntentId}:${group.checkoutSessionId}` };
      }
      await persist({ ...base, paidGroups, step: 'review' }, who);
      return started.clientSecret;
    } catch (err) {
      const apiError = err instanceof ApiError ? err : null;
      if (apiError?.code === 'USE_HOSTED_CHECKOUT') {
        setServerSaidHosted(true);
        showError({ title: 'One more step', message: 'This order is paid on Stripe’s secure page. Tap Pay again to continue. You haven’t been charged.' });
      } else if (apiError?.code === 'PAYMENT_CANCELED') {
        await startFreshAttempt(null, base);
        showError({ title: 'Payment closed', message: 'That payment attempt timed out. Tap Pay again to start a new one. You haven’t been charged.' });
      } else if (apiError && apiError.status >= 400 && apiError.status < 500 && apiError.status !== 429) {
        showError({ title: 'We couldn’t start your payment', message: apiError.message });
      } else {
        showError({ title: 'We couldn’t start your payment', message: 'Something went wrong reaching our payment service. Check your connection and try again. You haven’t been charged.' });
      }
      return null;
    }
  };

  /** After Stripe answered: wait for the webhook's orders, then show the confirmation. */
  const finishInApp = async (
    outcome: ConfirmOutcome | null,
    who: { contact: Partial<CheckoutContact>; address: Partial<CheckoutAddress> },
  ) => {
    const base = sessionRef.current ?? current;
    const started = startedRef.current;
    if (!outcome) { setPlacing(false); return; }
    if (outcome.status === 'canceled' || outcome.status === 'failed') {
      await startFreshAttempt(started, base);
      if (outcome.status === 'failed') {
        showError({ title: 'Payment declined', message: paymentErrorMessage(outcome.code, outcome.message) });
      } else if (started) {
        showError({ title: 'Payment cancelled', message: 'You weren’t charged. Your order is still here whenever you’re ready.' });
      }
      setPlacing(false);
      return;
    }
    if (!started) { setPlacing(false); return; }

    // Paid (or processing). The orders are created by Stripe's webhook, so
    // wait for them briefly; the confirmation screen can finish the rest.
    let status: Awaited<ReturnType<typeof api.buyer.checkout.paymentIntent.get>> | null = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      status = await api.buyer.checkout.paymentIntent.get(started.paymentIntentId).catch(() => null);
      if (status?.complete) break;
      await wait(1500);
    }
    const paidGroups = { ...(base.paidGroups ?? {}) };
    const confirmed: VerifiedOrder[] = [...verifiedOrders];
    for (const order of status?.orders ?? []) {
      if (paidRef.current.has(order.sellerId)) continue;
      confirmed.push({ id: order.orderId, number: order.orderNumber, sellerId: order.sellerId });
      paidRef.current.set(order.sellerId, order.orderId);
      paidGroups[order.sellerId] = {
        ...(paidGroups[order.sellerId] ?? { stripeSessionId: started.paymentIntentId }),
        orderId: order.orderId,
        orderNumber: order.orderNumber,
        amountTotalCents: order.amountTotalCents,
      };
    }
    setVerifiedOrders(confirmed);
    setPendingSessionIds(status?.complete ? [] : [`${PI_PREFIX}${started.paymentIntentId}`]);
    void trackAndRelayConversionEvent(
      'Purchase',
      { value: started.amountCents / 100, currency: base.summary.currency, content_ids: base.deliveryGroups.flatMap(group => group.items.map(item => item.productId)) },
      { valueCents: started.amountCents, currency: base.summary.currency },
    );
    await removeCartItems(base.deliveryGroups.flatMap(group => group.items.map(item => item.id)));
    await saveAddressIfAsked(who);
    startedRef.current = null;
    await persist({ ...base, paidGroups, step: 'confirmation' }, who);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setPlacing(false);
  };

  const payInApp = async () => {
    const controller = controllerRef.current;
    if (!controller) { setPlacing(false); return; }
    const who = { contact, address };
    // An earlier attempt may already have been paid (the app closed before
    // the confirmation). Never confirm or charge that cart again.
    const pendingIntent = Object.values(current.paidGroups ?? {})
      .map(paid => paid.stripeSessionId)
      .find(id => id.startsWith('pi_') && id.includes(':'))?.split(':')[0];
    if (pendingIntent) {
      const status = await api.buyer.checkout.paymentIntent.get(pendingIntent).catch(() => null);
      if (status && status.paymentStatus !== 'unpaid') {
        startedRef.current = { paymentIntentId: pendingIntent, clientSecret: '', status: status.status, amountCents: status.amountTotal, groups: [] };
        await finishInApp({ status: 'succeeded' }, who);
        return;
      }
    }
    const billing = {
      name: recipientName(address),
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      address: {
        line1: address.line1 ?? '', line2: address.line2 || null, city: address.city ?? '',
        state: address.state ?? '', postalCode: address.postalCode ?? '', country: address.country || 'US',
      },
    };
    const getClientSecret = () => startPaymentIntent(current, who);
    let outcome: ConfirmOutcome | null;
    try {
      outcome = selectedCard === NEW_CARD || selectedCard === BNPL || !savedCards.some(card => card.id === selectedCard)
        ? await controller.confirmCard(getClientSecret, billing)
        : await controller.confirmSaved(getClientSecret, selectedCard);
    } catch {
      outcome = { status: 'failed', code: null, message: 'Something went wrong confirming your payment. Try again.' };
    }
    await finishInApp(outcome, who);
  };

  // Apple Pay / Google Pay (in-app): the sheet supplies the address and contact.
  const walletCheckout = (wallet: WalletContact) => {
    const mapped = walletContactToCheckout(wallet);
    return {
      contact: { ...contact, ...mapped.contact },
      address: { ...mapped.address, saveAddress: false } as CheckoutAddressDraft,
    };
  };

  // Stable identities (always calling the latest closure) so the memoized
  // wallet button below isn't re-rendered by every keystroke in the forms.
  const expressQuote = useStableCallback(async (walletAddress: WalletContact['address']) => {
    if (!session) return null;
    try {
      const value = await api.buyer.checkout.paymentIntent.quote(buildQuoteBody(session, {
        city: walletAddress.city ?? '', state: walletAddress.state ?? '',
        postalCode: walletAddress.postalCode ?? '', country: walletAddress.country ?? 'US',
      }));
      return isCartQuote(value) ? value : null;
    } catch {
      return null;
    }
  });

  const expressCreateIntent = useStableCallback(async (wallet: WalletContact) => {
    setError(null);
    setPlacing(true);
    const who = walletCheckout(wallet);
    setContact(who.contact);
    setAddress(who.address);
    const clientSecret = await startPaymentIntent(current, who);
    if (!clientSecret) setPlacing(false);
    return clientSecret;
  });

  const expressOutcome = useStableCallback((outcome: ConfirmOutcome, wallet: WalletContact | null) => {
    if (outcome.status === 'canceled' && !startedRef.current) return; // closed the sheet before paying
    setPlacing(true);
    void finishInApp(outcome, wallet ? walletCheckout(wallet) : { contact, address });
  });

  const saveAddressIfAsked = async (who: { address: CheckoutAddressDraft; contact: Partial<CheckoutContact> }) => {
    if (!isSignedIn || who.address.saveAddress === false || who.address.id) return;
    try {
      await api.buyer.addresses.create({
        label: who.address.label || 'Saved Address',
        recipientName: recipientName(who.address),
        street: who.address.line1,
        line2: who.address.line2 || undefined,
        city: who.address.city,
        state: who.address.state,
        postalCode: who.address.postalCode,
        country: who.address.country || 'US',
        phone: who.contact.phone || undefined,
        isDefault: (who.address as any).isDefault || false,
      });
    } catch {
      // ignore — address save is non-fatal
    }
  };

  /**
   * The single "Pay" action (also behind the hosted/preview wallet button).
   * The button only enables once the page is complete, so this re-checks
   * defensively, then pays the way this order pays.
   */
  const handlePlaceOrder = async () => {
    if (placing) return;
    if (getCheckoutBlockingSection(contact, address, current) !== null) return;
    setError(null);
    setPlacing(true);
    if (inApp) {
      await payInApp();
      return;
    }
    const cartOk = await validateServerCart();
    if (!cartOk) { setPlacing(false); return; }
    await persist({ ...current, contact: contact as CheckoutContact, shippingAddress: address as CheckoutAddress, step: 'review' });
    await pay();
  };

  // ─── Hosted fallback + preview (the previous per-seller loop) ─────────────

  const pay = async () => {
    setPlacing(true);
    setError(null);
    setCanRetryPayment(false);
    const unresolved: string[] = [];
    // Start from already-verified orders so multi-seller retries accumulate correctly.
    const confirmed: VerifiedOrder[] = [...verifiedOrders];
    const paidGroups = { ...(current.paidGroups ?? {}) };

    try {
      for (const group of current.deliveryGroups) {
        // Skip groups already verified in a previous payment attempt this session.
        if (paidRef.current.has(group.sellerId)) continue;

        // Dev-web preview only: seeded preview products "pay" locally with no
        // charge and no Stripe (lib/previewCheckout.ts). Never true for a real
        // product/seller or in a production build.
        if (isPreviewCheckoutGroup(group)) {
          const method = group.availableMethods.find(m => m.id === group.selectedMethodId);
          const previewPaid = placePreviewOrder({
            group,
            shippingCents: method?.priceCents ?? 0,
            contact,
            address,
          });
          const vo: VerifiedOrder = { id: previewPaid.orderId, number: previewPaid.orderNumber, sellerId: group.sellerId };
          confirmed.push(vo);
          paidRef.current.set(group.sellerId, vo.id);
          paidGroups[group.sellerId] = {
            stripeSessionId: `preview_${previewPaid.orderId}`,
            orderId: vo.id,
            orderNumber: vo.number,
            amountTotalCents: previewPaid.amountTotal,
          };
          await persist({ ...current, paidGroups });
          continue;
        }

        let result: any;
        if (isSignedIn) {
          result = await api.buyer.checkout.createSession(
            group.items.map(item => ({ variantId: item.variantId, productId: item.productId, quantity: item.quantity })),
            {
              contactEmail: contact.email!,
              contactPhone: contact.phone!,
              shippingAddress: {
                recipientName: recipientName(address),
                street: address.line1!,
                line2: address.line2,
                city: address.city!,
                state: address.state!,
                postalCode: address.postalCode!,
                country: address.country || 'US',
                phone: contact.phone!,
              },
              clientIdempotencyKey: `${current.idempotencyKey}_${group.sellerId}`,
              ...(current.loyaltyRedemption && current.deliveryGroups.length === 1
                ? { loyaltyToken: current.loyaltyRedemption.token }
                : {}),
              // Thread Cash (item 109): the server reserves this token after
              // the promo code, charges the card the rest, and tops the seller
              // up by the Thread Cash amount (lib/threadCash/checkoutTopup.ts).
              ...(current.threadCashRedemption && current.deliveryGroups.length === 1
                ? { threadCashToken: current.threadCashRedemption.token }
                : {}),
              ...(() => {
                const groupCode = current.discounts.find(d => d.isValid && (current.deliveryGroups.length === 1 || d.sellerId === group.sellerId));
                const liveStreamId = groupCode ? getLiveCheckoutContext(group.sellerId)?.streamId : undefined;
                return {
                  ...(groupCode ? { discountCode: groupCode.code } : {}),
                  ...(liveStreamId ? { liveStreamId } : {}),
                };
              })(),
            },
          );
        } else {
          // Guest checkout: signed-out buyers pay without an account; the
          // Contact section's email is where the receipt and order updates go.
          result = await api.guest.checkout.createSession(
            group.items.map(item => ({ variantId: item.variantId, productId: item.productId, quantity: item.quantity })),
            {
              contactEmail: contact.email!,
              contactPhone: contact.phone!,
              shippingAddress: {
                name: recipientName(address),
                street: address.line1!,
                line2: address.line2,
                city: address.city!,
                state: address.state!,
                zip: address.postalCode!,
                country: address.country || 'US',
                phone: contact.phone!,
              },
              clientIdempotencyKey: `${current.idempotencyKey}_${group.sellerId}`,
            },
          );
        }

        paidGroups[group.sellerId] = {
          stripeSessionId: result.sessionId,
          ...(result.guestAccessToken ? { guestAccessToken: result.guestAccessToken } : {}),
        };
        await persist({ ...current, paidGroups });

        const browser = await WebBrowser.openBrowserAsync(result.url);
        if (browser.type === 'cancel' || browser.type === 'dismiss') {
          showError({ title: 'Payment cancelled', message: 'You closed secure checkout before paying. Your order is still saved — place it again whenever you’re ready.' });
          setPlacing(false);
          return;
        }

        // Verify with retries — webhook may be slightly behind.
        let verification: any;
        for (let attempt = 0; attempt < 6; attempt++) {
          if (isSignedIn) {
            verification = await api.buyer.checkout.verifySession(result.sessionId);
          } else {
            verification = await api.guest.checkout.verifySession(result.sessionId, result.guestAccessToken);
          }
          if (verification.orderId || verification.paymentStatus === 'paid') break;
          await wait(2000);
        }

        if (verification?.paymentStatus !== 'paid') {
          showError({
            title: verification?.declineReason ? 'Payment declined' : 'Payment not confirmed yet',
            message: verification?.declineReason
              ? paymentErrorMessage(verification.declineReason)
              : 'We’re still confirming your payment. This can take a minute — check your order status shortly.',
          });
          setCanRetryPayment(true);
          setPlacing(false);
          return;
        }

        if (verification.orderId) {
          const vo: VerifiedOrder = {
            id: verification.orderId,
            number: verification.orderNumber ?? verification.orderId,
            sellerId: group.sellerId,
          };
          confirmed.push(vo);
          paidRef.current.set(group.sellerId, vo.id);
          paidGroups[group.sellerId] = {
            ...paidGroups[group.sellerId],
            orderId: vo.id,
            orderNumber: vo.number,
            amountTotalCents: verification.amountTotal ?? undefined,
          };
          await persist({ ...current, paidGroups });

          // Meta Pixel + Conversions API — fires exactly once per newly
          // verified order.
          const purchaseValueCents = verification.amountTotal ?? current.summary.totalCents;
          void trackAndRelayConversionEvent(
            'Purchase',
            { value: purchaseValueCents / 100, currency: current.summary.currency, content_ids: group.items.map(item => item.productId) },
            { valueCents: purchaseValueCents, currency: current.summary.currency },
          );
        } else {
          // orderId not yet available — persist the stripe session for reconciliation.
          unresolved.push(isSignedIn ? result.sessionId : `${result.sessionId}|${result.guestAccessToken}`);
        }
      }

      setVerifiedOrders(confirmed);
      setPendingSessionIds(unresolved);
      // Remove only the items that were actually part of this checkout
      // session — a single-item Buy Now (or a partial "checkout selected")
      // must never wipe unrelated items still sitting in the buyer's cart.
      if (!unresolved.length) {
        await removeCartItems(current.deliveryGroups.flatMap(group => group.items.map(item => item.id)));
      }
      await saveAddressIfAsked({ address, contact });
      await persist({ ...current, paidGroups, step: 'confirmation' });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      showError({ title: 'Couldn’t start secure checkout', message: 'Something went wrong reaching Stripe. Check your connection and try again — you haven’t been charged.' });
    }
    setPlacing(false);
  };

  const retryPayment = async () => { await pay(); };

  const refreshOrders = useCallback(async () => {
    setPlacing(true);
    const remaining: string[] = [];
    const found: VerifiedOrder[] = [...verifiedOrders];
    const paidGroups = { ...(current.paidGroups ?? {}) };

    for (const pending of pendingSessionIds) {
      try {
        if (pending.startsWith(PI_PREFIX)) {
          const status = await api.buyer.checkout.paymentIntent.get(pending.slice(PI_PREFIX.length));
          for (const order of status.orders) {
            if (paidRef.current.has(order.sellerId)) continue;
            found.push({ id: order.orderId, number: order.orderNumber, sellerId: order.sellerId });
            paidRef.current.set(order.sellerId, order.orderId);
            paidGroups[order.sellerId] = {
              ...(paidGroups[order.sellerId] ?? { stripeSessionId: pending.slice(PI_PREFIX.length) }),
              orderId: order.orderId,
              orderNumber: order.orderNumber,
              amountTotalCents: order.amountTotalCents,
            };
          }
          if (!status.complete) remaining.push(pending);
          continue;
        }
        let result: any;
        const sessionId = pending.includes('|') ? pending.split('|')[0] : pending;
        if (pending.includes('|')) {
          const [sid, token] = pending.split('|');
          result = await api.guest.checkout.verifySession(sid, token);
        } else {
          result = await api.buyer.checkout.verifySession(pending);
        }
        // Only reconcile when the server returns a real orderId, not just an orderNumber.
        if (result.orderId) {
          const sellerId = Object.entries(paidGroups)
            .find(([, paid]) => paid.stripeSessionId === sessionId)?.[0];
          const vo: VerifiedOrder = {
            id: result.orderId,
            number: result.orderNumber ?? result.orderId,
            sellerId: sellerId ?? '',
          };
          found.push(vo);
          if (sellerId) {
            paidRef.current.set(sellerId, vo.id);
            paidGroups[sellerId] = {
              ...paidGroups[sellerId],
              orderId: vo.id,
              orderNumber: vo.number,
              amountTotalCents: result.amountTotal ?? undefined,
            };
          }
        } else {
          remaining.push(pending);
        }
      } catch {
        remaining.push(pending);
      }
    }

    setVerifiedOrders(found);
    setPendingSessionIds(remaining);
    await persist({ ...current, paidGroups, step: 'confirmation' });
    if (!remaining.length) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await removeCartItems(current.deliveryGroups.flatMap(group => group.items.map(item => item.id)));
    }
    setPlacing(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, current, verifiedOrders, pendingSessionIds]);

  // ─── Render ────────────────────────────────────────────────────────────────

  // Bottom inset for the sticky footer — the chat composer's floor pattern
  // (seller-conversation.tsx): never flush with the screen edge, even on web
  // or a device with no home indicator.
  const footerBottomPad = Math.max(insets.bottom, SP.sm) + SP.sm;
  // Fully below the notch / Dynamic Island — the same shared inset every
  // ScreenHeader uses, so this custom (deliberately flat pure-black,
  // theme-independent) header bar never drifts from that canonical number.
  const headerTop = useHeaderTopInset();

  const header = (title: string, onClose: () => void, closeLabel: string) => (
    <View style={[styles.header, { paddingTop: headerTop }]} testID="checkout-header">
      <IconButton name="x" variant="plain" onPress={onClose} accessibilityLabel={closeLabel} testID="checkout-close" />
      <Text style={styles.headerTitle} accessibilityRole="header">{title}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );

  if (loadFailed) {
    return (
      <View style={styles.root}>
        {header('Checkout', leaveCheckout, 'Close checkout')}
        <ErrorState
          message="We couldn't load checkout. Check your connection and try again."
          onRetry={() => void load()}
          retryLabel="Try again"
          style={{ flex: 1 }}
        />
      </View>
    );
  }

  if (loading || !session) return <CheckoutSkeleton />;

  const isConfirmation = current.step === 'confirmation';
  const sessionTotals = getCheckoutDisplayTotals(current);
  const quoted = inApp && activeQuote ? quoteTotals(activeQuote) : null;
  const totals: CheckoutDisplayTotals = quoted
    ? {
        subtotalCents: quoted.subtotalCents,
        shippingCents: quoted.shippingCents,
        taxCents: quoted.taxCents,
        promoCents: quoted.discountCents,
        rewardsCents: 0,
        threadCashCents: 0,
        orderTotalCents: quoted.totalCents,
        totalCents: quoted.totalCents,
      }
    : sessionTotals;
  const taxNote = quoted || previewOnly
    ? undefined
    : inApp ? 'Added with your address' : 'Calculated at payment';
  const itemCount = current.deliveryGroups.reduce((sum, group) => sum + group.items.reduce((n, item) => n + item.quantity, 0), 0);
  const cardReady = !inApp || (savedCards.some(card => card.id === selectedCard) ? true : cardComplete);
  const formReady = getCheckoutBlockingSection(contact, address, current) === null && !(threadCashEligible && threadCash.busy);
  const ready = formReady && cardReady;
  const nextStep = getCheckoutNextStepHint(contact, address, current)
    ?? (!cardReady ? 'Enter your card details to continue' : null);
  const multiSeller = current.deliveryGroups.length > 1;
  const preorderAcks = current.acknowledgments;
  const ctaLabel = canRetryPayment ? `Try again · ${formatCents(totals.totalCents)}` : `Pay ${formatCents(totals.totalCents)}`;
  const onCta = () => void (canRetryPayment ? retryPayment() : handlePlaceOrder());

  if (isConfirmation) {
    const paidCents = Object.values(current.paidGroups ?? {}).reduce((sum, group) => sum + (group.amountTotalCents ?? 0), 0);
    return (
      <View style={styles.root}>
        {header('Order confirmation', () => router.replace('/(buyer)/discover' as never), 'Close')}
        <ScrollView
          contentContainerStyle={{ padding: GUTTER }}
          bounces={false}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
        >
          <OrderConfirmation
            session={current}
            verifiedOrders={verifiedOrders}
            finalizing={pendingSessionIds.length > 0}
            totalPaidCents={paidCents > 0 ? paidCents : totals.totalCents}
          />
        </ScrollView>
        {/* A sibling of the ScrollView above, never inside its scrollable
            content — so it's genuinely pinned above the home indicator on
            any screen height, never clipped or scrolled past. */}
        <OrderConfirmationActions
          verifiedOrders={verifiedOrders}
          finalizing={pendingSessionIds.length > 0}
          onRefresh={refreshOrders}
          refreshing={placing}
        />
      </View>
    );
  }

  const expressVisible = inApp ? walletAvailable : true;

  const page = (
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {header('Checkout', leaveCheckout, 'Close checkout')}
        {inApp ? <PaymentController ref={controllerRef} /> : null}

        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: footerHeight + SP.lg }}
          keyboardShouldPersistTaps="handled"
          bounces={false}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
          testID="checkout-scroll"
        >
          {error ? (
            <View style={styles.errorBanner} accessibilityRole="alert" accessibilityLiveRegion="assertive" testID="checkout-error">
              <Feather name="alert-circle" size={18} color={ck.text} style={{ marginTop: 1 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.errorTitle}>{error.title}</Text>
                <Text style={styles.errorText}>{error.message}</Text>
              </View>
              <IconButton name="x" variant="plain" size={16} onPress={() => setError(null)} accessibilityLabel="Dismiss" />
            </View>
          ) : null}

          <ExpressSection visible={expressVisible}>
            {inApp ? (
              <MemoExpressPay
                amountCents={totals.totalCents}
                subtotalCents={totals.subtotalCents}
                shippingCents={totals.shippingCents}
                quote={expressQuote}
                createIntent={expressCreateIntent}
                onOutcome={expressOutcome}
                onAvailability={setWalletAvailable}
                disabled={placing || !cardReadyForWallet(current)}
              />
            ) : (
              <HostedExpressButton onPress={onCta} disabled={!ready} loading={placing} />
            )}
          </ExpressSection>

          <ContactSection contact={contact} onChange={setContact} showErrors={false} first />

          <ShippingSection
            address={address}
            onChange={setAddress}
            savedAddresses={isSignedIn ? savedAddresses : NO_SAVED_ADDRESSES}
            onSelectSaved={handleSelectAddress}
            canSaveAddresses={!!isSignedIn}
            showErrors={false}
          />

          <PaymentSection
            path={payment.path}
            savedCards={isSignedIn ? savedCards : NO_SAVED_CARDS}
            selectedCard={selectedCard}
            onSelectCard={setSelectedCard}
            onCardComplete={setCardComplete}
            sellerCount={current.deliveryGroups.length}
            bnplAvailable={Platform.OS === 'web' && quoteOffersBnpl(quote?.value)}
          />

          {/* Multi-store: each store's code is its own section and only discounts that store's items. */}
          {multiSeller && current.deliveryGroups.map(group => (
            <PromoCodeSection
              key={group.sellerId}
              title={`Promo code · ${group.sellerName}`}
              idSuffix={`-${group.sellerId}`}
              discounts={current.discounts.filter(d => d.sellerId === group.sellerId)}
              onApply={async (code): Promise<CheckoutDiscount> => {
                const discount = await applyDiscount(code, current.summary.subtotalCents, current.discounts, group.sellerId);
                if (discount.isValid) {
                  await persist({
                    ...current,
                    discounts: [...current.discounts.filter(d => d.sellerId !== group.sellerId), discount],
                    idempotencyKey: `ck_${randomUUID()}`,
                  });
                }
                return discount;
              }}
              onRemove={code =>
                void persist({
                  ...current,
                  discounts: current.discounts.filter(d => !(d.code === code && d.sellerId === group.sellerId)),
                  idempotencyKey: `ck_${randomUUID()}`,
                })
              }
            />
          ))}
          {!multiSeller && <PromoCodeSection
            discounts={current.discounts}
            onApply={async (code): Promise<CheckoutDiscount> => {
              const discount = await applyDiscount(code, current.summary.subtotalCents, current.discounts);
              // Only a server-validated code is kept (the server takes one code per order).
              // A new code is a new order total: start a new payment attempt so a
              // payment opened earlier (with the old total) isn't reused.
              if (discount.isValid) await persist({ ...current, discounts: [discount], idempotencyKey: `ck_${randomUUID()}` });
              return discount;
            }}
            onRemove={code =>
              void removeDiscount(code, current.discounts).then(discounts =>
                persist({ ...current, discounts, idempotencyKey: `ck_${randomUUID()}` }),
              )
            }
          />}

          {/* Store gift cards: in-app, signed-in orders. Each card pays only its own store's items. */}
          {inApp && isSignedIn && !previewOnly ? (
            <GiftCardSection
              groups={current.deliveryGroups.map(group => ({ sellerId: group.sellerId, sellerName: group.sellerName }))}
              applied={current.giftCards ?? {}}
              coveredCents={Object.fromEntries((activeQuote?.groups ?? []).map(group => [group.sellerId, group.giftCardCents ?? 0]))}
              onApply={(sellerId, card) => void persist({
                ...current, giftCards: { ...(current.giftCards ?? {}), [sellerId]: card }, idempotencyKey: `ck_${randomUUID()}`,
              })}
              onRemove={sellerId => {
                const next = { ...(current.giftCards ?? {}) };
                delete next[sellerId];
                void persist({ ...current, giftCards: next, idempotencyKey: `ck_${randomUUID()}` });
              }}
            />
          ) : null}

          {/* Thread Cash (item 109): hidden while the flag is off, for guests
              and for multi-seller orders. */}
          {threadCashEligible && <ThreadCashSection state={threadCash} />}

          {/* Pre-order disclosures stay explicit, required checkboxes. */}
          {preorderAcks.length > 0 && (
            <CheckoutSection title="Pre-order terms" testID="checkout-preorder-terms">
              {preorderAcks.map(ack => (
                <PressableScale
                  key={ack.key}
                  style={styles.ack}
                  onPress={() =>
                    void persist({
                      ...current,
                      acknowledgments: current.acknowledgments.map(a =>
                        a.key === ack.key ? { ...a, acknowledged: !a.acknowledged } : a,
                      ),
                    })
                  }
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: ack.acknowledged }}
                  accessibilityLabel={ack.label}
                  accessibilityHint={ack.required ? 'Required before payment' : undefined}
                  rippleEnabled={false}
                >
                  <View style={[styles.checkbox, { borderColor: ack.acknowledged ? ck.text : ck.subtle }]}>
                    {ack.acknowledged ? <Feather name="check" size={13} color={ck.text} /> : null}
                  </View>
                  <Text style={styles.ackText}>{ack.label}</Text>
                </PressableScale>
              ))}
            </CheckoutSection>
          )}

          <OrderSummarySection
            session={current}
            totals={totals}
            itemCount={itemCount}
            taxNote={taxNote}
            quotedGroups={inApp ? activeQuote?.groups : undefined}
            giftCardCents={quoted?.giftCardCents ?? 0}
          />

          {/* Purchase protection trust row — the app's existing copy (Terms-sourced). */}
          <BuyerProtectionNote
            flat
            style={styles.trust}
            preorder={current.deliveryGroups.some(group => group.items.some(item => item.isPreOrder))}
          />
        </ScrollView>

        {/* Sticky footer: one primary action carrying the live total, what's
            still missing (while disabled), and the terms line. */}
        <StickyFooter style={{ paddingBottom: footerBottomPad, paddingTop: SP.sm + 4, backgroundColor: ck.bg, borderTopColor: ck.divider }}>
          <View onLayout={event => setFooterHeight(event.nativeEvent.layout.height + footerBottomPad + SP.sm + 4)} testID="checkout-footer">
            {!ready && nextStep ? (
              <View style={styles.hintRow} testID="checkout-next-step">
                <Feather name="info" size={13} color={ck.muted} />
                <Text style={styles.hint}>{nextStep}</Text>
              </View>
            ) : null}
            <Button
              label={ctaLabel}
              icon="lock"
              loading={placing}
              disabled={!ready}
              fullWidth
              onPress={onCta}
              accessibilityHint={ready ? (inApp ? 'Pays now with the card you chose' : 'Opens Stripe secure checkout') : nextStep ?? undefined}
              testID="checkout-place-order"
            />
            <View style={{ marginTop: SP.sm + 2 }}>
              <CheckoutTermsLine />
            </View>
          </View>
        </StickyFooter>
        <FirstRunTip
          id="buyer-checkout"
          variant="anchored"
          contentReady={!loading}
          anchored={{ steps: BUYER_CHECKOUT_STEPS }}
        />
      </KeyboardAvoidingView>
  );
  // Stripe (and Stripe.js on web) is only loaded when this order pays in the app.
  return inApp
    ? <StripePaymentProvider amountCents={totals.totalCents} paymentMethodTypes={quote?.value.paymentMethodTypes} onUnavailable={() => setStripeLoadFailed(true)}>{page}</StripePaymentProvider>
    : page;
}

/** The wallet sheet supplies contact and address itself; only pre-order terms must be accepted first. */
function cardReadyForWallet(session: CheckoutSession): boolean {
  return !session.acknowledgments.some(ack => ack.required && !ack.acknowledged);
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(ck: CheckoutColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: ck.bg },
    scroll: { flex: 1, backgroundColor: ck.bg },
    // Opaque bar (matches the theme's background), fully below the notch;
    // the page scrolls under it.
    header: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: SP.xs, paddingBottom: SP.xs,
      // No divider under the header (app-wide header rule) — the solid
      // ck.bg fill alone separates it from the content scrolling under it.
      backgroundColor: ck.bg,
      zIndex: 2,
    },
    headerTitle: { flex: 1, textAlign: 'center', fontFamily: FONT.semibold, fontSize: FS.md, color: ck.text },
    headerSpacer: { width: 44, height: 44 },
    errorBanner: {
      flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm + 2,
      borderWidth: 1, borderColor: ck.fieldBorder, borderRadius: 12,
      padding: SP.md - 2, paddingRight: SP.xs, marginTop: SP.md,
    },
    errorTitle: { fontFamily: FONT.semibold, fontSize: FS.base, color: ck.text },
    errorText: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, marginTop: 3, color: ck.muted },
    ack: { flexDirection: 'row', gap: SP.sm + 4, alignItems: 'flex-start', paddingVertical: SP.xs },
    checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
    ackText: { flex: 1, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20, color: ck.muted },
    trust: { paddingVertical: SP.md, paddingHorizontal: 0, borderTopWidth: 1, borderTopColor: ck.divider },
    hintRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: SP.sm },
    hint: { fontFamily: FONT.medium, fontSize: FS.sm, color: ck.muted },
  });
}
