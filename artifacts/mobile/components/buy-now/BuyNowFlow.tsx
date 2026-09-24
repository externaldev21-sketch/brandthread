/**
 * BuyNowFlow — shared, self-contained Buy Now flow: variant picker (when
 * needed) -> fast checkout -> order success.
 *
 * Scope note (read before extending): "fast checkout" here means a compact,
 * single-screen review of product + saved default address + total, paying
 * through the SAME Stripe-hosted session (`api.buyer.checkout.createSession`
 * + WebBrowser + `verifySession`) that /buyer-checkout.tsx already uses —
 * this component does not collect card details itself (Brandthread never
 * does; Stripe Checkout is the sole payment entry point everywhere in this
 * app). When there is no saved default address to review (first-time buyer,
 * or signed out), a true one-screen "fast" checkout isn't possible without
 * duplicating full address-collection UI, so this flow degrades gracefully:
 * it creates the buy-now session via `createBuyNowSession` (exactly like
 * ShopProductSheet does) and hands off to the existing `/thread-checkout`
 * route, which already implements the full 4-step address/payment flow.
 *
 * Usable by Discover today, and designed to be dropped into feed.tsx's
 * ShopProductSheet buy-now path later — that wiring is intentionally left
 * as a follow-up (see the mobile agent's final report).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity,
  TouchableWithoutFeedback, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { CachedImage } from '@/components/CachedImage';
import { formatCents } from '@/lib/money';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import {
  createBuyNowSession, getBuyerProduct, getCart,
} from '@/services/cartService';
import type { BuyerProduct, BuyerProductVariant } from '@/services/cartTypes';
import { VariantPickerSheet } from '@/components/buy-now/VariantPickerSheet';
import { OrderSuccessSheet, type OrderSuccessData } from '@/components/buy-now/OrderSuccessSheet';

type FlowPhase = 'loading' | 'error' | 'variant' | 'review' | 'paying' | 'success';

export function BuyNowFlow({
  productId, product: initialProduct, variant: initialVariant, quantity: initialQuantity = 1,
  onClose, onOrderPlaced,
}: {
  productId?: string;
  product?: BuyerProduct;
  variant?: BuyerProductVariant;
  quantity?: number;
  onClose: () => void;
  onOrderPlaced?: () => void;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const router = useRouter();

  const [phase, setPhase] = useState<FlowPhase>('loading');
  const [error, setError] = useState('');
  const [product, setProduct] = useState<BuyerProduct | null>(initialProduct ?? null);
  const [variant, setVariant] = useState<BuyerProductVariant | null>(initialVariant ?? null);
  const [quantity, setQuantity] = useState(initialQuantity);
  const [defaultAddress, setDefaultAddress] = useState<any | null>(null);
  const [profileEmail, setProfileEmail] = useState<string | null>(null);
  const [orderData, setOrderData] = useState<OrderSuccessData | null>(null);

  const hydrate = useCallback(async () => {
    setPhase('loading');
    setError('');
    try {
      const p = initialProduct ?? (productId ? await getBuyerProduct(productId) : null);
      if (!p) { setError('Product not found.'); setPhase('error'); return; }
      setProduct(p);

      const resolvedVariant = initialVariant
        ?? (p.options.length === 0 && p.variants.length === 1 ? p.variants[0] : null);

      if (!resolvedVariant) {
        setPhase('variant');
        return;
      }
      setVariant(resolvedVariant);
      await loadReviewContext();
      setPhase('review');
    } catch {
      setError("Couldn't load this product. Try again.");
      setPhase('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadReviewContext() {
    try {
      const [addresses, profile] = await Promise.all([
        api.buyer.addresses.list().catch(() => []),
        api.auth.me().catch(() => null),
      ]);
      const def = addresses.find((a: any) => a.isDefault) ?? addresses[0] ?? null;
      setDefaultAddress(def);
      setProfileEmail((profile as any)?.email ?? null);
    } catch {
      setDefaultAddress(null);
    }
  }

  useEffect(() => { hydrate(); }, [hydrate]);

  async function handleVariantConfirmed(p: BuyerProduct, v: BuyerProductVariant, q: number) {
    setProduct(p);
    setVariant(v);
    setQuantity(q);
    await loadReviewContext();
    setPhase('review');
  }

  async function handlePay() {
    if (!product || !variant || !defaultAddress) return;
    setPhase('paying');
    setError('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    try {
      const cart = await getCart();
      await createBuyNowSession(product, variant, quantity, cart);

      const result = await api.buyer.checkout.createSession(
        [{ variantId: variant.id, productId: product.id, quantity }],
        {
          contactEmail: profileEmail ?? '',
          contactPhone: defaultAddress.phone ?? '',
          shippingAddress: {
            recipientName: defaultAddress.recipientName ?? '',
            street: defaultAddress.street ?? defaultAddress.line1 ?? '',
            line2: defaultAddress.line2,
            city: defaultAddress.city ?? '',
            state: defaultAddress.state ?? '',
            postalCode: defaultAddress.postalCode ?? '',
            country: defaultAddress.country || 'US',
            phone: defaultAddress.phone ?? '',
          },
          clientIdempotencyKey: `buynow_${product.id}_${variant.id}_${Date.now()}`,
        },
      );

      const browser = await WebBrowser.openBrowserAsync(result.url);
      if (browser.type === 'cancel' || browser.type === 'dismiss') {
        setError('Payment was cancelled.');
        setPhase('review');
        return;
      }

      let verification: any;
      for (let attempt = 0; attempt < 6; attempt++) {
        verification = await api.buyer.checkout.verifySession(result.sessionId);
        if (verification.orderId || verification.paymentStatus === 'paid') break;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      if (verification?.paymentStatus !== 'paid' || !verification.orderId) {
        setError(verification?.declineReason ?? "We're still confirming your payment. Check Orders shortly.");
        setPhase('review');
        return;
      }

      const addressLine = [defaultAddress.city, defaultAddress.state].filter(Boolean).join(', ');
      const fullAddress = [
        defaultAddress.street ?? defaultAddress.line1,
        defaultAddress.city, defaultAddress.state, defaultAddress.postalCode,
      ].filter(Boolean).join(', ');

      setOrderData({
        orderId: verification.orderId,
        orderNumber: verification.orderNumber ?? verification.orderId,
        productName: product.name,
        itemCount: quantity,
        brandName: product.sellerName,
        thumbnailUri: variant.imageUri ?? product.imageUris[0],
        totalCents: verification.amountTotal ?? undefined,
        shippingAddressLine: addressLine || undefined,
        fullShippingAddress: fullAddress || undefined,
        paymentMethodLabel: 'Card on file',
      });
      setPhase('success');
      onOrderPlaced?.();
    } catch {
      setError('We could not start secure checkout. Please try again.');
      setPhase('review');
    }
  }

  /** No saved default address — hand off to the existing full checkout flow
   *  rather than building a duplicate address-collection screen here. */
  async function handleContinueInCheckout() {
    if (!product || !variant) return;
    try {
      const cart = await getCart();
      await createBuyNowSession(product, variant, quantity, cart);
      onClose();
      router.push('/thread-checkout' as never);
    } catch {
      setError("Couldn't start checkout. Try again.");
    }
  }

  if (phase === 'success' && orderData) {
    return (
      <OrderSuccessSheet
        order={orderData}
        onTrackOrder={(orderId) => {
          onClose();
          router.push(`/buyer-order-detail?id=${encodeURIComponent(orderId)}` as never);
        }}
        onContinue={onClose}
      />
    );
  }

  if (phase === 'variant' && product) {
    return (
      <VariantPickerSheet
        productId={product.id}
        initialProduct={product}
        onClose={onClose}
        onConfirm={handleVariantConfirmed}
      />
    );
  }

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.backdrop} />
      </TouchableWithoutFeedback>
      <View style={[s.sheet, { backgroundColor: theme.surface, paddingBottom: insets.bottom + SP.md }]}>
        <View style={s.handle} />
        <View style={s.header}>
          <Text style={[s.title, { color: theme.text }]}>Buy Now</Text>
          <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
            <Feather name="x" size={18} color={theme.text} />
          </TouchableOpacity>
        </View>

        {phase === 'loading' && (
          <View style={s.centerBox}><ActivityIndicator color={theme.accent} /></View>
        )}

        {phase === 'error' && (
          <View style={s.centerBox}>
            <Text style={{ color: theme.error, marginBottom: SP.sm, textAlign: 'center' }}>{error}</Text>
            <TouchableOpacity onPress={hydrate} accessibilityRole="button" accessibilityLabel="Retry">
              <Text style={{ color: theme.accent, fontFamily: FONT.semibold }}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {(phase === 'review' || phase === 'paying') && product && variant && (
          <>
            <View style={s.productRow}>
              {(variant.imageUri ?? product.imageUris[0]) ? (
                <CachedImage source={{ uri: variant.imageUri ?? product.imageUris[0] }} style={s.thumb} contentFit="cover" />
              ) : <View style={[s.thumb, { backgroundColor: theme.cardElevated }]} />}
              <View style={{ flex: 1 }}>
                <Text style={[s.productName, { color: theme.text }]} numberOfLines={2}>{product.name}</Text>
                <Text style={[s.variantTitle, { color: theme.muted }]}>{variant.title} · Qty {quantity}</Text>
              </View>
              <Text style={[s.price, { color: theme.accent }]}>{formatCents(variant.priceCents * quantity)}</Text>
            </View>

            <View style={[s.divider, { backgroundColor: theme.border }]} />

            {defaultAddress ? (
              <View style={s.addressRow}>
                <Feather name="map-pin" size={14} color={theme.muted} />
                <Text style={[s.addressText, { color: theme.text }]} numberOfLines={2}>
                  {defaultAddress.recipientName ? `${defaultAddress.recipientName} · ` : ''}
                  {defaultAddress.street ?? defaultAddress.line1}, {defaultAddress.city}, {defaultAddress.state}
                </Text>
              </View>
            ) : (
              <Text style={[s.noAddressText, { color: theme.muted }]}>
                No saved address yet — continue to checkout to add one.
              </Text>
            )}

            {!!error && <Text style={[s.errorText, { color: theme.error }]}>{error}</Text>}

            {defaultAddress ? (
              <TouchableOpacity
                onPress={handlePay}
                disabled={phase === 'paying'}
                style={[s.payBtn, { backgroundColor: theme.accent }, phase === 'paying' && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel="Pay now"
              >
                {phase === 'paying' ? <ActivityIndicator color={theme.onAccent} size="small" /> : (
                  <Text style={[s.payBtnText, { color: theme.onAccent }]}>Pay {formatCents(variant.priceCents * quantity)}</Text>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={handleContinueInCheckout}
                style={[s.payBtn, { backgroundColor: theme.accent }]}
                accessibilityRole="button"
                accessibilityLabel="Continue to checkout"
              >
                <Text style={[s.payBtnText, { color: theme.onAccent }]}>Continue to Checkout</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: SP.md },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SP.sm },
  title: { fontSize: FS.md, fontFamily: FONT.bold },
  centerBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: SP.xl },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: SP.md },
  thumb: { width: 56, height: 56, borderRadius: RADIUS.sm },
  productName: { fontSize: FS.base, fontFamily: FONT.semibold },
  variantTitle: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  price: { fontSize: FS.base, fontFamily: FONT.bold },
  divider: { height: 1, marginBottom: SP.md },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: SP.md },
  addressText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.medium },
  noAddressText: { fontSize: FS.sm, fontFamily: FONT.regular, marginBottom: SP.md },
  errorText: { fontSize: FS.xs, fontFamily: FONT.medium, marginBottom: SP.sm },
  payBtn: { minHeight: 52, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', marginBottom: SP.md },
  payBtnText: { fontSize: FS.base, fontFamily: FONT.bold },
});
