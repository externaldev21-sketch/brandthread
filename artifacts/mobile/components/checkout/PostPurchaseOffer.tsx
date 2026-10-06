/**
 * Post-purchase offer on the order confirmation — the seller Checkout
 * settings' "Post-purchase features", following Shopify's one-click
 * post-purchase page: right after paying, one product from the same shop at
 * the seller's discount, added with the card from the order just placed.
 *
 *   GET  /api/buyer/post-purchase/:orderId          → the offer (or not available)
 *   POST /api/buyer/post-purchase/:orderId/accept   → the server prices it and
 *        charges the original card (api-server lib/postPurchaseOffer.ts)
 *   GET  /api/buyer/checkout/payment-intent/:id     → the new order, made by the webhook
 *
 * If the bank asks for 3DS, the PaymentIntent comes back requires_action and
 * the screen's Stripe controller finishes it with the same saved card. The
 * section renders nothing while loading or when there is no offer, so a
 * buyer never sees an empty box. Flat, monochrome, like the rest of the page.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { randomUUID } from 'expo-crypto';
import { Button } from '@/components/ui';
import { CachedImage } from '@/components/CachedImage';
import { useApi } from '@/hooks/useApi';
import { formatCents } from '@/lib/money';
import { ApiError } from '@/lib/networkNotice';
import { paymentErrorMessage } from '@/lib/checkoutPayment';
import type { BuyerOffer } from '@/lib/checkoutExtras';
import { FONT, FS, SP } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { TABULAR_NUMS } from '@/constants/typography';
import { OptionRow, TextAction, useCheckoutColors, type CheckoutColors } from './CheckoutPrimitives';
import { useCheckoutT } from './CheckoutLanguage';
import type { PaymentControllerApi } from './stripePaymentTypes';

type Offer = Extract<BuyerOffer, { available: true }>;

const ERROR_COPY: Record<string, string> = {
  EXPIRED: 'This offer has expired.',
  OUT_OF_STOCK: 'This item just sold out.',
  ALREADY_ACCEPTED: 'This offer was already added to your order.',
};

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function brandName(brand: string | null): string {
  if (!brand) return '';
  return brand === 'amex' ? 'Amex' : brand.charAt(0).toUpperCase() + brand.slice(1);
}

export function PostPurchaseOffer({
  orderId, orderNumber, controller,
}: {
  orderId: string;
  orderNumber: string;
  /** The page's Stripe controller, to finish a 3DS check with the saved card. */
  controller?: React.RefObject<PaymentControllerApi | null>;
}) {
  const api = useApi();
  const router = useRouter();
  const t = useCheckoutT();
  const ck = useCheckoutColors();
  const styles = useMemo(() => makeStyles(ck), [ck]);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<{ amountCents: number; orderId: string | null; orderNumber: string | null } | null>(null);
  const keyRef = useRef(`pp_${randomUUID()}`);

  useEffect(() => {
    let alive = true;
    api.buyer.checkout.postPurchase.get(orderId)
      .then(result => {
        if (!alive || !result?.available) return;
        setOffer(result);
        setVariantId(result.variants.find(v => v.inStock)?.variantId ?? null);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [api, orderId]);

  if (!offer || dismissed) return null;

  const variant = offer.variants.find(v => v.variantId === variantId) ?? null;
  const card = offer.card.last4 ? `${brandName(offer.card.brand)} •••• ${offer.card.last4}`.trim() : t('your card');

  async function waitForOrder(paymentIntentId: string) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const status = await api.buyer.checkout.paymentIntent.get(paymentIntentId).catch(() => null);
      const order = status?.orders?.[0];
      if (order) return { orderId: order.orderId, orderNumber: order.orderNumber };
      if (status && status.paymentStatus === 'unpaid' && status.status === 'canceled') return null;
      await wait(1500);
    }
    return null;
  }

  async function add() {
    if (!variant || adding) return;
    setAdding(true);
    setError(null);
    try {
      let result = await api.buyer.checkout.postPurchase.accept(orderId, { variantId: variant.variantId, clientIdempotencyKey: keyRef.current });
      if (result.status === 'requires_action') {
        const pay = controller?.current;
        const outcome = pay && result.clientSecret
          ? await pay.confirmSaved(async () => result.clientSecret, result.paymentMethodId)
          : null;
        if (!outcome || outcome.status === 'failed' || outcome.status === 'canceled') {
          setError(outcome?.status === 'failed' ? t(paymentErrorMessage(outcome.code, outcome.message)) : t('Your bank needs to confirm this payment.'));
          setAdding(false);
          return;
        }
        result = { ...result, status: outcome.status };
      }
      const made = await waitForOrder(result.paymentIntentId);
      setAdded({ amountCents: result.amountCents, orderId: made?.orderId ?? null, orderNumber: made?.orderNumber ?? null });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      const apiError = err instanceof ApiError ? err : null;
      const known = apiError?.code ? ERROR_COPY[apiError.code] : undefined;
      if (apiError?.status === 402) setError(t(paymentErrorMessage(apiError.code, apiError.message)));
      else setError(t(known ?? 'We couldn’t add this to your order. You haven’t been charged.'));
      if (apiError?.code === 'EXPIRED' || apiError?.code === 'ALREADY_ACCEPTED') keyRef.current = `pp_${randomUUID()}`;
    }
    setAdding(false);
  }

  if (added) {
    return (
      <View style={styles.section} testID="post-purchase-added">
        <View style={styles.addedRow}>
          <Feather name="check-circle" size={20} color={ck.text} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{t('Added to your order')}</Text>
            <Text style={styles.sub}>{t('Charged {amount} to {card}.', { amount: formatCents(added.amountCents), card })}</Text>
            {added.orderNumber ? <Text style={styles.sub}>{t('Order {number}', { number: added.orderNumber })}</Text> : null}
          </View>
          {added.orderId ? (
            <TextAction
              label={t('View receipt')}
              onPress={() => router.push(('/buyer-order-detail?id=' + encodeURIComponent(added.orderId!)) as never)}
              testID="post-purchase-view-receipt"
            />
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.section} testID="post-purchase-offer">
      <Text style={styles.heading} accessibilityRole="header">{t('Add to your order')}</Text>
      <View style={styles.productRow}>
        {offer.product.image ? (
          <CachedImage source={{ uri: offer.product.image }} style={styles.thumb} contentFit="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbFallback]}><Feather name="image" size={18} color={ck.subtle} /></View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.seller} numberOfLines={1}>{offer.sellerName}</Text>
          <Text style={styles.name} numberOfLines={2}>{offer.product.name}</Text>
          {variant ? (
            <View style={styles.priceRow}>
              <Text style={styles.price}>{formatCents(variant.offerPriceCents)}</Text>
              {variant.offerPriceCents < variant.priceCents ? (
                <Text style={styles.was}>{formatCents(variant.priceCents)}</Text>
              ) : null}
              {offer.discountPercent > 0 ? (
                <View style={styles.badge}><Text style={styles.badgeText}>{t('{percent}% off', { percent: offer.discountPercent })}</Text></View>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>

      {offer.variants.length > 1 ? (
        <View accessibilityRole="radiogroup" style={styles.options}>
          {offer.variants.map((option, index) => (
            <OptionRow
              key={option.variantId}
              selected={option.variantId === variantId}
              onPress={() => { if (option.inStock) setVariantId(option.variantId); }}
              title={option.label || t('Option')}
              lines={option.inStock ? [formatCents(option.offerPriceCents)] : [t('Sold out')]}
              last={index === offer.variants.length - 1}
              testID={`post-purchase-variant-${option.variantId}`}
            />
          ))}
        </View>
      ) : null}

      <Text style={styles.sub}>{t('Ships with order {number}. No extra shipping.', { number: orderNumber })}</Text>
      <Text style={styles.sub}>{t('Pay now with {card}. Tax is added at payment.', { card })}</Text>

      {error ? (
        <View style={styles.errorRow} accessibilityRole="alert" testID="post-purchase-error">
          <Feather name="alert-circle" size={14} color={ck.text} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={variant ? t('Add to order · {amount}', { amount: formatCents(variant.offerPriceCents) }) : t('Sold out')}
          icon="plus"
          variant="secondary"
          loading={adding}
          disabled={!variant}
          onPress={() => void add()}
          fullWidth
          testID="post-purchase-add"
        />
        <View style={styles.decline}>
          <TextAction label={t('No thanks')} onPress={() => setDismissed(true)} testID="post-purchase-decline" />
        </View>
      </View>
    </View>
  );
}

function makeStyles(ck: CheckoutColors) {
  return StyleSheet.create({
    section: { borderTopWidth: 1, borderTopColor: ck.divider, paddingTop: SP.md, marginBottom: SP.md },
    heading: { fontFamily: FONT.semibold, fontSize: FS.xs, letterSpacing: 0.9, textTransform: 'uppercase', color: ck.muted, marginBottom: SP.sm + 4 },
    productRow: { flexDirection: 'row', gap: SP.sm + 4, alignItems: 'flex-start', marginBottom: SP.sm + 4 },
    thumb: { width: 72, height: 96, borderRadius: RADII.chip, borderWidth: StyleSheet.hairlineWidth, borderColor: ck.fieldBorder, overflow: 'hidden' },
    thumbFallback: { alignItems: 'center', justifyContent: 'center' },
    seller: { fontFamily: FONT.medium, fontSize: FS.sm, color: ck.muted },
    name: { fontFamily: FONT.semibold, fontSize: FS.base, lineHeight: 20, color: ck.text, marginTop: 2 },
    priceRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: SP.sm, marginTop: SP.xs + 2 },
    price: { fontFamily: FONT.bold, fontSize: FS.md, color: ck.text, ...TABULAR_NUMS },
    was: { fontFamily: FONT.regular, fontSize: FS.sm, color: ck.muted, textDecorationLine: 'line-through', ...TABULAR_NUMS },
    badge: { borderWidth: 1, borderColor: ck.fieldBorder, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    badgeText: { fontFamily: FONT.semibold, fontSize: FS.xs, color: ck.text },
    options: { marginBottom: SP.sm },
    sub: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, color: ck.muted, marginTop: 2 },
    errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SP.sm },
    errorText: { flex: 1, fontFamily: FONT.medium, fontSize: FS.sm, color: ck.text },
    actions: { marginTop: SP.md },
    decline: { alignItems: 'center', marginTop: SP.sm + 2 },
    addedRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm + 4 },
  });
}
