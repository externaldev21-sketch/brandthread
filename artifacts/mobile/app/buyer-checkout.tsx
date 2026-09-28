/**
 * Buyer checkout — single canonical route for every purchase path:
 *   - Buy Now from a product page / saved items (`?source=buynow`)
 *   - the cart's multi-item checkout (`/thread-checkout?source=cart`)
 *   - the Shop sheet's Buy now (`/thread-checkout`, a re-export of this file)
 *
 * Layout (rebuilt against Mobbin references, see the PR for the full list):
 *   PRIMARY  GOAT "Order Review" — real title, product row with photo,
 *            delivery options as bordered cards with price + ETA, a Payment
 *            section led by a black/white wallet button, ONE total block,
 *            and a plain terms line under the button (no checkbox).
 *   SUPPORT  SSENSE "Placing an order" (Contact/Shipping/Delivery/Payment/
 *            Promo as sections; empty "Add shipping address" state),
 *            Shop app (address autocomplete + saved addresses), HBX and
 *            lululemon (order complete / confirmation screens).
 *
 * Grouped Glass cards, monochrome, Inter, the shared Button. The sticky
 * footer holds only "Place order · $total" (+ what's missing, + the terms
 * line) — the price breakdown itself appears exactly once, in the scroll.
 *
 * Logic is unchanged from the previous screen: session load/restore, saved
 * addresses, server cart validation, the per-seller Stripe-hosted Checkout
 * loop with verify retries, paidGroups persistence / multi-seller retry
 * without double-charging, reconciliation, address save, analytics.
 * Stripe Checkout is the sole payment entry point; card data is never
 * collected here.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useThreadPull } from '@/contexts/ThreadPullTransitionContext';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { ThreadCashCard } from '@/components/checkout/ThreadCashCard';
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
import { formatCents } from '@/lib/money';
import {
  getCheckoutBlockingSection,
  getCheckoutDisplayTotals,
  getCheckoutNextStepHint,
  getFirstIncompleteCheckoutSection,
  mergeCheckoutFormState,
  withoutImplicitTermsAck,
} from '@/lib/checkoutReadiness';
import { CheckoutSkeleton, PressableScale } from '@/components/BrandthreadUI';
import { StickyFooter } from '@/components/layout';
import { trackAndRelayConversionEvent } from '@/lib/marketingPixels';
import { Button, ErrorState, IconButton } from '@/components/ui';
import { BuyerProtectionNote } from '@/components/BuyerProtectionNote';
import { CheckoutCard } from '@/components/checkout/CheckoutPrimitives';
import { OrderSummaryCard } from '@/components/checkout/OrderSummaryCard';
import { ContactCard } from '@/components/checkout/ContactCard';
import { ShippingAddressCard, type CheckoutAddressDraft, type SavedAddress } from '@/components/checkout/ShippingAddressCard';
import { DeliveryCard } from '@/components/checkout/DeliveryCard';
import { PaymentCard, type SavedCard } from '@/components/checkout/PaymentCard';
import { PromoCodeCard } from '@/components/checkout/PromoCodeCard';
import { PriceBreakdownCard } from '@/components/checkout/PriceBreakdownCard';
import { CheckoutTermsLine } from '@/components/checkout/CheckoutTermsLine';
import { OrderConfirmation } from '@/components/checkout/OrderConfirmation';
import { COMP, FONT, FS, SP } from '@/lib/theme';

// Maps known Stripe decline reason codes to plain-language copy. Falls back to a
// generic decline message when the code is unrecognized, and to a "still
// confirming" message when there's no decline reason at all (e.g. a timeout).
function humanDeclineReason(reason?: string | null): string {
  if (!reason) return "We're still confirming your payment. This can take a minute — check your order status shortly.";
  const known: Record<string, string> = {
    card_declined: 'Your card was declined. Try another card or contact your bank.',
    insufficient_funds: 'Your card was declined for insufficient funds. Try another card.',
    expired_card: 'That card has expired. Try another card.',
    incorrect_cvc: 'The security code didn’t match. Check it and try again.',
    processing_error: 'Something went wrong processing your card. Try again.',
    incorrect_number: 'That card number looks incorrect. Check it and try again.',
  };
  return known[reason] ?? 'Your card was declined. Try another card or contact your bank.';
}

/**
 * A fully verified order reference returned from the server after Stripe payment.
 * `id`     — server-assigned UUID / numeric ID used for all API calls and navigation.
 * `number` — human-readable display string shown to the buyer (e.g. "BT-1234").
 */
export interface VerifiedOrder {
  id: string;
  number: string;
  sellerId: string;
}

type CheckoutError = { title: string; message: string };

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function BuyerCheckoutScreen() {
  const { theme } = useAppTheme();
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

  const [session, setSession] = useState<CheckoutSession | null>(null);
  const [contact, setContact] = useState<Partial<CheckoutContact>>({ orderUpdates: 'email', marketingConsent: false });
  const [address, setAddress] = useState<CheckoutAddressDraft>({ country: 'US' });
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<CheckoutError | null>(null);
  const [canRetryPayment, setCanRetryPayment] = useState(false);
  const [footerHeight, setFooterHeight] = useState(180);
  const scrollRef = useRef<ScrollView>(null);
  /**
   * Fully verified orders — each entry has a real server `id` (used for navigation/API)
   * and a human-readable `number` (used for display only).
   */
  const [verifiedOrders, setVerifiedOrders] = useState<VerifiedOrder[]>([]);
  const [pendingSessionIds, setPendingSessionIds] = useState<string[]>([]);
  /**
   * In-memory map: sellerId → verified server order ID.
   * Populated as each Stripe session is verified so we can skip already-paid groups
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
      // The generic terms checkbox is now the plain line under Place order —
      // drop it from sessions saved before that change (pre-order acks stay).
      next.acknowledgments = withoutImplicitTermsAck(next.acknowledgments ?? []);
      let restoredContact: Partial<CheckoutContact> = next.contact ?? { orderUpdates: 'email', marketingConsent: false };
      let restoredAddress: CheckoutAddressDraft = next.shippingAddress ?? { country: 'US', saveAddress: true };
      // Dev-web preview only: an all-preview order gets the preview buyer's
      // demo contact and address, so Place order is one tap on the live
      // preview. isPreviewCheckoutGroup is false for any real product or
      // seller and in production builds, so real checkouts are unchanged.
      if (next.deliveryGroups.length > 0 && next.deliveryGroups.every(isPreviewCheckoutGroup)) {
        ({ contact: restoredContact, address: restoredAddress } = withPreviewCheckoutDetails(restoredContact, restoredAddress));
      }
      const firstIncomplete = getFirstIncompleteCheckoutSection(restoredContact, restoredAddress, next);
      if (next.step !== 'confirmation') next.step = firstIncomplete;

      setSession(next);
      setContact(restoredContact);
      setAddress(restoredAddress);

      // Restore paid state — only entries with a verified orderId are considered confirmed.
      // Entries with only orderNumber (legacy sessions) are treated as pending until
      // re-verification returns an orderId.
      const restoredVerified: VerifiedOrder[] = [];
      const restoredPending: string[] = [];
      for (const [sellerId, payment] of Object.entries(next.paidGroups ?? {})) {
        if (payment.orderId && payment.orderNumber) {
          // Both id and number present — fully verified.
          restoredVerified.push({ id: payment.orderId, number: payment.orderNumber, sellerId });
          paidRef.current.set(sellerId, payment.orderId);
        } else if (payment.orderId && !payment.orderNumber) {
          // id but no display number (edge case) — still navigable, show id as fallback display.
          restoredVerified.push({ id: payment.orderId, number: payment.orderId, sellerId });
          paidRef.current.set(sellerId, payment.orderId);
        } else {
          // No orderId — needs re-verification against Stripe.
          restoredPending.push(payment.guestAccessToken
            ? `${payment.stripeSessionId}|${payment.guestAccessToken}`
            : payment.stripeSessionId);
        }
      }
      setVerifiedOrders(restoredVerified);
      setPendingSessionIds(restoredPending);

      // Meta Pixel + Conversions API — fires once when checkout actually
      // starts (session freshly loaded/created), not on every re-render.
      if (next.step !== 'confirmation') {
        void trackAndRelayConversionEvent(
          'InitiateCheckout',
          { value: next.summary.totalCents / 100, currency: next.summary.currency },
          { valueCents: next.summary.totalCents, currency: next.summary.currency },
        );
      }

      // Load saved addresses (and cards on file) for authenticated users
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
        // Stripe-backed saved cards (the same Customer the Checkout Session
        // is created for). Display only — Stripe Checkout offers them.
        void api.reviews.paymentMethods()
          .then((data: any) => setSavedCards(Array.isArray(data?.paymentMethods) ? data.paymentMethods : []))
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

  const handleSelectAddress = (addr: any) => {
    const parts = addr.recipientName ? addr.recipientName.split(' ') : [];
    const firstName = parts[0] || '';
    const lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';
    setAddress({
      id: addr.id,
      firstName,
      lastName,
      line1: addr.street,
      line2: addr.line2,
      city: addr.city,
      state: addr.state,
      postalCode: addr.postalCode,
      country: addr.country,
      saveAddress: false,
    });
    setContact(previous => ({
      ...previous,
      phone: addr.phone || previous.phone || '',
    }));
  };

  const persist = async (next: CheckoutSession) => {
    const snapshot = mergeCheckoutFormState(next, contact, address);
    sessionRef.current = snapshot;
    setSession(snapshot);
    await saveCheckoutProgress(snapshot);
  };

  const current = session as CheckoutSession;

  // Dev-web preview only (lib/previewCheckout.ts): every group is seeded
  // preview products, so there is no server cart or Stripe to talk to.
  const previewOnly = !!current?.deliveryGroups?.length && current.deliveryGroups.every(isPreviewCheckoutGroup);

  // ── Thread Cash (item 109) ──────────────────────────────────────────────
  // Single-seller, signed-in orders only (a token discounts one Stripe
  // session), behind the OFF-by-default 'threadCashCheckoutDiscount' flag.
  const sessionRef = useRef(session);
  sessionRef.current = session;
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

  const validateServerCart = async () => {
    if (!isSignedIn || previewOnly) return true;
    try {
      const result = await validateCart(
        current.deliveryGroups.flatMap(g => g.items),
        current.discounts.filter(d => d.isValid).map(d => d.code),
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

  /**
   * Single "Place order" action (also behind the express wallet button).
   * The button only enables once getCheckoutBlockingSection() is clear, so
   * this re-checks defensively, validates the cart server-side, then pays.
   * No payment logic below this point changes.
   */
  const handlePlaceOrder = async () => {
    if (placing) return;
    if (getCheckoutBlockingSection(contact, address, current) !== null) return;
    setError(null);
    setPlacing(true);
    const cartOk = await validateServerCart();
    if (!cartOk) { setPlacing(false); return; }
    await persist({ ...current, contact: contact as CheckoutContact, shippingAddress: address as CheckoutAddress, step: 'review' });
    await pay();
  };

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
                recipientName: `${address.firstName} ${address.lastName}`.trim(),
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
              ...(current.deliveryGroups.length === 1 && current.discounts.find(d => d.isValid)
                ? { discountCode: current.discounts.find(d => d.isValid)!.code }
                : {}),
            },
          );
        } else {
          // Guest checkout: signed-out buyers pay without an account; the
          // Contact card's email is where the receipt and order updates go.
          result = await api.guest.checkout.createSession(
            group.items.map(item => ({ variantId: item.variantId, productId: item.productId, quantity: item.quantity })),
            {
              contactEmail: contact.email!,
              contactPhone: contact.phone!,
              shippingAddress: {
                name: `${address.firstName} ${address.lastName}`.trim(),
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
        // We poll for orderId specifically; orderNumber alone is insufficient for navigation.
        let verification: any;
        for (let attempt = 0; attempt < 6; attempt++) {
          if (isSignedIn) {
            verification = await api.buyer.checkout.verifySession(result.sessionId);
          } else {
            verification = await api.guest.checkout.verifySession(result.sessionId, result.guestAccessToken);
          }
          if (verification.orderId || verification.paymentStatus === 'paid') break;
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        if (verification?.paymentStatus !== 'paid') {
          showError({
            title: verification?.declineReason ? 'Payment declined' : 'Payment not confirmed yet',
            message: humanDeclineReason(verification?.declineReason),
          });
          setCanRetryPayment(true);
          setPlacing(false);
          return;
        }

        if (verification.orderId) {
          // Both id (for API/routing) and number (for display) from the verify response.
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
          // verified order (this branch only runs the first time a group's
          // payment resolves to a real order id).
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

      // Save address if requested
      if (isSignedIn && address.saveAddress !== false && !address.id) {
        try {
          await api.buyer.addresses.create({
            label: address.label || 'Saved Address',
            recipientName: `${address.firstName} ${address.lastName}`.trim(),
            street: address.line1,
            line2: address.line2 || undefined,
            city: address.city,
            state: address.state,
            postalCode: address.postalCode,
            country: address.country || 'US',
            phone: contact.phone || undefined,
            isDefault: (address as any).isDefault || false,
          });
        } catch {
          // ignore — address save is non-fatal
        }
      }

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
    // Start from what we already have; append newly-reconciled orders.
    const found: VerifiedOrder[] = [...verifiedOrders];
    const paidGroups = { ...(current.paidGroups ?? {}) };

    for (const pending of pendingSessionIds) {
      try {
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
            .find(([, payment]) => payment.stripeSessionId === sessionId)?.[0];
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
  const headerTop = Platform.OS === 'web' ? Math.max(insets.top, SP.sm) : insets.top;

  const header = (title: string, onClose: () => void, closeLabel: string) => (
    <View style={[styles.header, { paddingTop: headerTop + SP.xs, borderBottomColor: theme.border }]}>
      <IconButton name="x" variant="plain" onPress={onClose} accessibilityLabel={closeLabel} testID="checkout-close" />
      <Text style={[styles.headerTitle, { color: theme.text }]} accessibilityRole="header">{title}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );

  if (loadFailed) {
    return (
      <View style={[styles.root, { backgroundColor: theme.background }]}>
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
  const totals = getCheckoutDisplayTotals(current);
  const itemCount = current.deliveryGroups.reduce((sum, group) => sum + group.items.reduce((n, item) => n + item.quantity, 0), 0);
  const ready = getCheckoutBlockingSection(contact, address, current) === null && !(threadCashEligible && threadCash.busy);
  const nextStep = getCheckoutNextStepHint(contact, address, current);
  const multiSeller = current.deliveryGroups.length > 1;
  const preorderAcks = current.acknowledgments;
  const ctaLabel = `${canRetryPayment ? 'Try again' : 'Place order'} · ${formatCents(totals.totalCents)}`;
  const onCta = () => void (canRetryPayment ? retryPayment() : handlePlaceOrder());

  if (isConfirmation) {
    const paidCents = Object.values(current.paidGroups ?? {}).reduce((sum, group) => sum + (group.amountTotalCents ?? 0), 0);
    return (
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        {header('Order confirmation', () => router.replace('/(buyer)/discover' as never), 'Close')}
        <ScrollView
          contentContainerStyle={{ padding: SP.md, paddingBottom: footerBottomPad + SP.lg }}
          bounces={false}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
        >
          <OrderConfirmation
            session={current}
            verifiedOrders={verifiedOrders}
            finalizing={pendingSessionIds.length > 0}
            onRefresh={refreshOrders}
            refreshing={placing}
            totalPaidCents={paidCents > 0 ? paidCents : totals.totalCents}
          />
        </ScrollView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {header('Checkout', leaveCheckout, 'Close checkout')}

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: SP.md, paddingBottom: footerHeight + SP.lg }}
        keyboardShouldPersistTaps="handled"
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        testID="checkout-scroll"
      >
        {error ? (
          <View
            style={[styles.errorBanner, { borderColor: theme.error, backgroundColor: theme.card }]}
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            testID="checkout-error"
          >
            <Feather name="alert-circle" size={18} color={theme.error} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.errorTitle, { color: theme.text }]}>{error.title}</Text>
              <Text style={[styles.errorText, { color: theme.muted }]}>{error.message}</Text>
            </View>
            <IconButton name="x" variant="plain" size={16} onPress={() => setError(null)} accessibilityLabel="Dismiss" />
          </View>
        ) : null}

        <OrderSummaryCard session={current} />

        <ContactCard contact={contact} onChange={setContact} showErrors={false} />

        <ShippingAddressCard
          address={address}
          onChange={setAddress}
          savedAddresses={isSignedIn ? savedAddresses : []}
          onSelectSaved={handleSelectAddress}
          canSaveAddresses={!!isSignedIn}
        />

        <DeliveryCard
          session={current}
          onSelect={(sellerId, methodId) =>
            void persist({
              ...current,
              deliveryGroups: current.deliveryGroups.map(g =>
                g.sellerId === sellerId ? { ...g, selectedMethodId: methodId } : g,
              ),
            })
          }
        />

        <PaymentCard
          onExpressPay={onCta}
          disabled={!ready}
          loading={placing}
          savedCards={isSignedIn ? savedCards : []}
          sellerCount={current.deliveryGroups.length}
        />
        {previewOnly ? (
          // Dev-web preview only: said plainly, since no Stripe page opens.
          <View style={styles.previewNote} testID="checkout-preview-note">
            <Feather name="info" size={13} color={theme.muted} />
            <Text style={[styles.previewNoteText, { color: theme.muted }]}>
              Preview order: placing it won’t charge a card or reach Stripe.
            </Text>
          </View>
        ) : null}

        <PromoCodeCard
          discounts={current.discounts}
          unavailableReason={multiSeller ? 'Promo codes apply to single-seller orders. Check out each seller separately to use a code.' : undefined}
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
        />

        {/* Thread Cash (item 109): one on/off row after the promo code. It
            stacks after the code and follows the total live (see
            hooks/useCheckoutThreadCash.ts). Hidden while the
            'threadCashCheckoutDiscount' flag is off, for guests, and for
            multi-seller orders. */}
        {threadCashEligible && <ThreadCashCard state={threadCash} />}

        {/* Pre-order disclosures stay explicit, required checkboxes. */}
        {preorderAcks.length > 0 && (
          <CheckoutCard title="Pre-order terms" testID="checkout-preorder-terms">
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
                <View style={[styles.checkbox, { borderColor: ack.acknowledged ? theme.text : theme.subtle, backgroundColor: ack.acknowledged ? theme.text : 'transparent' }]}>
                  {ack.acknowledged ? <Feather name="check" size={13} color={theme.background} /> : null}
                </View>
                <Text style={[styles.ackText, { color: theme.muted }]}>{ack.label}</Text>
              </PressableScale>
            ))}
          </CheckoutCard>
        )}

        <PriceBreakdownCard totals={totals} itemCount={itemCount} />

        {/* Purchase protection trust row — the app's existing copy (Terms-sourced). */}
        <BuyerProtectionNote
          flat
          style={styles.trust}
          preorder={current.deliveryGroups.some(group => group.items.some(item => item.isPreOrder))}
        />
      </ScrollView>

      {/* Sticky footer: one primary action carrying the live total, what's
          still missing (while disabled), and the terms line. */}
      <StickyFooter style={{ paddingBottom: footerBottomPad, paddingTop: SP.sm + 4 }}>
        <View onLayout={event => setFooterHeight(event.nativeEvent.layout.height + footerBottomPad + SP.sm + 4)} testID="checkout-footer">
          {!ready && nextStep ? (
            <View style={styles.hintRow} testID="checkout-next-step">
              <Feather name="info" size={13} color={theme.muted} />
              <Text style={[styles.hint, { color: theme.muted }]}>{nextStep}</Text>
            </View>
          ) : null}
          <Button
            label={ctaLabel}
            icon="lock"
            loading={placing}
            disabled={!ready}
            fullWidth
            onPress={onCta}
            accessibilityHint={ready ? 'Opens Stripe secure checkout' : nextStep ?? undefined}
            testID="checkout-place-order"
          />
          <View style={{ marginTop: SP.sm + 2 }}>
            <CheckoutTermsLine />
          </View>
        </View>
      </StickyFooter>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  previewNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -SP.xs, marginBottom: SP.sm + 4, paddingHorizontal: 2 },
  previewNoteText: { flex: 1, fontFamily: FONT.regular, fontSize: FS.xs + 1, lineHeight: 17 },
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SP.sm, paddingBottom: SP.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: FONT.semibold, fontSize: FS.md },
  headerSpacer: { width: COMP.minTouchTarget, height: COMP.minTouchTarget },
  errorBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm + 2,
    borderWidth: 1, borderRadius: 16, padding: SP.md - 2, paddingRight: SP.xs, marginBottom: SP.sm + 4,
  },
  errorTitle: { fontFamily: FONT.semibold, fontSize: FS.base },
  errorText: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, marginTop: 3 },
  ack: { flexDirection: 'row', gap: SP.sm + 4, alignItems: 'flex-start', paddingVertical: SP.xs },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  ackText: { flex: 1, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20 },
  trust: { paddingVertical: SP.xs, paddingHorizontal: SP.xs },
  hintRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: SP.sm },
  hint: { fontFamily: FONT.medium, fontSize: FS.sm },
});
