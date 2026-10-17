/**
 * Order confirmation — Depop's "Thank you!" screen (mobbin.com/flows/
 * 3e64944f-1bac-404b-bbed-118e33e94a68) with GOAT's pinned "Discover more"
 * (mobbin.com/flows/92a0951d-9af9-455d-8a9b-18d905b43b9f), reskinned
 * monochrome: "Thank you for your order!", the email the confirmation went
 * to, Message seller / View order side by side, then estimated delivery,
 * ships to, total, the items, and "More from {Brand}". No confetti and no
 * animated check — neither reference has one.
 *
 * This file exports two pieces used together by app/buyer-checkout.tsx:
 *  - `OrderConfirmation` — the scrollable content, rendered inside the
 *    screen's existing ScrollView.
 *  - `OrderConfirmationActions` — the primary/secondary buttons, rendered
 *    as a SIBLING of that ScrollView (not inside it), so they're a true
 *    pinned-above-the-home-indicator footer that can never be scrolled
 *    past or clipped, on any screen height.
 *
 * Navigation rules carried over unchanged from the previous screen:
 * "Track order" routes ONLY with a verified server order id (never the
 * display number) and stays disabled while the order is still finalizing.
 */
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '@/components/BrandthreadUI';
import { Button } from '@/components/ui';
import { Avatar } from '@/components/ui/Avatar';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/hooks/useApi';
import { requestContextualPushPermission } from '@/lib/contextualPushPermission';
import { countRealOrders, maybeRequestStoreReview } from '@/lib/storeReviewPrompt';
import { formatCents } from '@/lib/money';
import type { CheckoutSession } from '@/services/cartTypes';
import { FONT, FS, SP } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { TABULAR_NUMS } from '@/constants/typography';
import { Hairline } from './CheckoutPrimitives';
import { groupDeliveryWindow } from './OrderSummarySection';

export interface VerifiedOrderRef {
  id: string;
  number: string;
  sellerId: string;
}

/** Same web-preview safe-area fix as components/thread-cash/CelebrationHost.tsx:
 *  react-native-safe-area-context reads 0 for insets.top on the plain
 *  390x844 web preview (no real notch/Dynamic Island to measure), so a
 *  small fixed pad there isn't enough — 54 clears it there too. */
function topInset(insetsTop: number): number {
  return Platform.OS === 'web' ? Math.max(insetsTop, 54) : insetsTop;
}

function Row({ label, children, testID }: { label: string; children: React.ReactNode; testID?: string }) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.row} testID={testID}>
      <Text style={[styles.rowLabel, { color: theme.muted }]}>{label}</Text>
      <View style={styles.rowValue}>{children}</View>
    </View>
  );
}

/**
 * A secondary action as a plain text row in the scroll content (icon, label,
 * chevron), not a full-width button. `subtle` is quieter still (muted, no
 * icon weight) for "Create an account".
 */
function LinkRow({ icon, label, hint, onPress, subtle, testID }: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  hint?: string;
  onPress: () => void;
  subtle?: boolean;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  return (
    <PressableScale
      onPress={onPress}
      style={styles.linkRow}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      rippleEnabled={false}
      testID={testID}
    >
      <Feather name={icon} size={subtle ? 16 : 18} color={subtle ? theme.muted : theme.text} />
      <Text style={[subtle ? styles.linkSubtle : styles.linkLabel, { color: subtle ? theme.muted : theme.text }]}>{label}</Text>
      <Feather name="chevron-right" size={16} color={theme.muted} />
    </PressableScale>
  );
}

function SellerProductsCarousel({ sellerId, sellerName }: { sellerId: string; sellerName: string }) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const api = useApi();
  const [products, setProducts] = useState<any[] | null>(null);

  useEffect(() => {
    let alive = true;
    api.publicSellers.get(sellerId)
      .then((data) => { if (alive) setProducts((data?.products ?? []).slice(0, 8)); })
      .catch(() => { if (alive) setProducts([]); });
    return () => { alive = false; };
  }, [api, sellerId]);

  if (!products || products.length === 0) return null;

  return (
    <View style={styles.moreSection} testID="order-confirmation-more-from-brand">
      <Text style={[styles.sectionHeading, { color: theme.muted }]}>More from {sellerName}</Text>
      <View style={styles.moreScroll} testID="order-confirmation-more-scroll">
        {products.map((product) => {
          const priceCents = product.variants?.length
            ? product.variants.reduce((min: number, v: any) => Math.min(min, v.priceCents ?? 0), product.variants[0]?.priceCents ?? 0)
            : (product.priceCents ?? 0);
          return (
            <PressableScale
              key={product.id}
              style={styles.moreTile}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push({ pathname: '/buyer-product-detail' as any, params: { productId: product.id } });
              }}
              accessibilityRole="button"
              accessibilityLabel={product.name}
              rippleEnabled={false}
            >
              <View style={[styles.moreThumb, { backgroundColor: theme.cardElevated, borderColor: theme.border }]}>
                {product.images?.[0] ? (
                  <CachedImage source={{ uri: product.images[0] }} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <Feather name="image" size={18} color={theme.subtle} />
                )}
              </View>
              <Text style={[styles.moreName, { color: theme.text }]} numberOfLines={1}>{product.name}</Text>
              <Text style={[styles.morePrice, { color: theme.muted }, TABULAR_NUMS]}>{formatCents(priceCents)}</Text>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

export function OrderConfirmation({
  session, verifiedOrders, finalizing, totalPaidCents,
}: {
  session: CheckoutSession;
  verifiedOrders: VerifiedOrderRef[];
  finalizing: boolean;
  totalPaidCents: number;
}) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const api = useApi();
  const { userId, isSignedIn } = useAuth();

  const items = session.deliveryGroups.flatMap(group => group.items);
  const deliveryEstimates = session.deliveryGroups
    .filter(group => group.availableMethods.some(method => method.id === group.selectedMethodId))
    .map(group => groupDeliveryWindow(group));
  const preOrderEstimates = items.map(item => item.preOrderEstShipDate).filter((value): value is string => !!value);
  const estimates = [...new Set([...deliveryEstimates, ...preOrderEstimates])];
  const firstGroup = session.deliveryGroups[0];
  const firstVerified = verifiedOrders[0] ?? null;
  const address = session.shippingAddress;
  const payment = session.paymentMethod;
  const singleSeller = session.deliveryGroups.length === 1 ? firstGroup : null;
  const brandAvatarUri = firstGroup?.items[0]?.sellerAvatarUri;

  useEffect(() => {
    // A completed purchase is a meaningful, server-backed moment — exactly
    // when contextualPushPermission.ts wants to ask, never on first launch.
    if (firstVerified?.id) void requestContextualPushPermission(userId, api);
  }, [firstVerified?.id, userId, api]);

  useEffect(() => {
    // A buyer's 5th order is a good moment to ask for an App Store review
    // (rate limited inside maybeRequestStoreReview). Wait so the confirmation
    // is seen first.
    if (!firstVerified?.id || !userId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api.buyer.orders.list()
        .then((orders) => { if (!cancelled && countRealOrders(orders) === 5) void maybeRequestStoreReview(userId, 'fifth_order'); })
        .catch(() => {});
    }, 4000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [firstVerified?.id, userId, api]);

  function openOrder() {
    // ONLY navigate with a verified server order ID — never the display number.
    if (!firstVerified?.id) return;
    router.push(('/buyer-order-detail?id=' + encodeURIComponent(firstVerified.id)) as never);
  }

  function messageSeller() {
    if (!firstGroup) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const initials = firstGroup.sellerName.split(/\s+/).map(word => word[0] ?? '').slice(0, 2).join('').toUpperCase();
    router.push((
      '/buyer-conversation?participantId=' + encodeURIComponent(firstGroup.sellerId)
      + '&participantName=' + encodeURIComponent(firstGroup.sellerName)
      + '&participantHandle=' + encodeURIComponent('')
      + '&participantInitials=' + encodeURIComponent(initials)
      + '&participantColor=' + encodeURIComponent(theme.accent)
      + '&participantAccountType=seller'
      + '&type=buyer_to_seller_order'
      + '&contextOrderNumber=' + encodeURIComponent(firstVerified?.number ?? '')
    ) as never);
  }

  return (
    <View testID="checkout-confirmation">
      <View style={styles.titleBlock}>
        <Text style={[styles.thanks, { color: theme.text }]} accessibilityRole="header">
          {finalizing ? 'Payment received' : 'Thank you for your order!'}
        </Text>
        <Text style={[styles.body, { color: theme.muted }]}>
          {finalizing
            ? 'We’re finalizing your order with the seller. This can take a moment after payment.'
            : session.contact?.email
              ? `We’ve sent your order confirmation to ${session.contact.email}.`
              : 'You’ll find this order in your orders.'}
        </Text>
        {!finalizing && verifiedOrders.length > 0 ? (
          <Text style={[styles.orderNumberLine, { color: theme.muted }, TABULAR_NUMS]} testID="checkout-order-number">
            {verifiedOrders.map(order => `Order ${order.number}`).join(' · ')}
          </Text>
        ) : null}
        {firstGroup ? (
          <View style={styles.heroActions}>
            <View style={{ flex: 1 }}>
              <Button label="Message" accessibilityLabel="Message seller" variant="secondary" onPress={messageSeller} fullWidth testID="checkout-message-seller" />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label="View order"
                variant="primary"
                onPress={openOrder}
                disabled={!firstVerified?.id || finalizing}
                fullWidth
                testID="checkout-view-receipt"
              />
            </View>
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <Row label="Estimated delivery" testID="order-confirmation-delivery-row">
          {estimates.length > 0 ? estimates.map(estimate => (
            <Text key={estimate} style={[styles.rowText, { color: theme.text }]}>{estimate}</Text>
          )) : (
            <Text style={[styles.rowText, { color: theme.text }]}>Seller will confirm delivery date</Text>
          )}
          {estimates.length > 1 ? (
            <Text style={[styles.rowSub, { color: theme.muted }]}>Arrives in {estimates.length} shipments</Text>
          ) : null}
        </Row>
        {address?.line1 ? (
          <>
            <Hairline />
            <Row label="Ships to">
              <Text style={[styles.rowText, { color: theme.text }]}>{[address.firstName, address.lastName].filter(Boolean).join(' ')}</Text>
              <Text style={[styles.rowSub, { color: theme.muted }]}>
                {[address.line1, address.line2].filter(Boolean).join(', ')}{'\n'}{address.city}, {address.state} {address.postalCode}
              </Text>
            </Row>
          </>
        ) : null}
        <Hairline />
        {(session.threadCashRedemption?.discountCents ?? 0) > 0 ? (
          <>
            <Row label="Thread Cash">
              <Text style={[styles.rowText, { color: theme.text }, TABULAR_NUMS]} testID="checkout-confirmation-thread-cash">
                −{formatCents(session.threadCashRedemption!.discountCents)}
              </Text>
            </Row>
            <Hairline />
          </>
        ) : null}
        <Row label={(session.threadCashRedemption?.discountCents ?? 0) > 0 ? 'Charged to card' : 'Total'}>
          <Text style={[styles.rowStrong, { color: theme.text }, TABULAR_NUMS]}>{formatCents(totalPaidCents)}</Text>
          {payment?.last4 ? (
            <Text style={[styles.rowSub, { color: theme.muted }]}>
              {payment.brand ? `${payment.brand} ` : ''}•••• {payment.last4}
            </Text>
          ) : null}
        </Row>
      </View>

      {firstGroup ? (
        <View style={styles.sellerHeader} testID="order-confirmation-seller-row">
          <Avatar uri={brandAvatarUri} name={firstGroup.sellerName} size={32} />
          <Text style={[styles.sellerName, { color: theme.text }]} numberOfLines={1}>{firstGroup.sellerName}</Text>
        </View>
      ) : null}

      {items.length > 0 ? (
        <View style={styles.section}>
          {items.map((item, index) => (
            <View key={item.id}>
              {index > 0 ? <Hairline /> : null}
              <View style={styles.itemRow}>
                {item.imageUri ? (
                  <CachedImage source={{ uri: item.imageUri }} style={[styles.thumb, { borderColor: theme.border }]} contentFit="cover" />
                ) : (
                  <View style={[styles.thumb, styles.thumbFallback, { borderColor: theme.border, backgroundColor: theme.cardElevated }]}>
                    <Feather name="image" size={16} color={theme.subtle} />
                  </View>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.itemName, { color: theme.text }]} numberOfLines={2}>{item.productName}</Text>
                  <Text style={[styles.rowSub, { color: theme.muted }]} numberOfLines={1}>
                    {[item.variantTitle, `Qty ${item.quantity}`].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Text style={[styles.itemPrice, { color: theme.text }, TABULAR_NUMS]}>{formatCents(item.priceCents * item.quantity)}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {!isSignedIn ? (
        <View style={styles.section} testID="order-confirmation-links">
          <Hairline style={styles.linkHairline} />
          <LinkRow
            icon="user-plus"
            label="Create an account to track orders faster"
            onPress={() => router.replace('/sign-in' as never)}
            subtle
            testID="checkout-create-account"
          />
        </View>
      ) : null}

      {!finalizing && singleSeller ? (
        <SellerProductsCarousel sellerId={singleSeller.sellerId} sellerName={singleSeller.sellerName} />
      ) : null}
    </View>
  );
}

/**
 * The ONE pinned action — Track order (or "Check order status" while the
 * order is still finalizing). A SIBLING of the screen's ScrollView (see
 * app/buyer-checkout.tsx), never inside its scrollable content, so it sits
 * above the home indicator on every screen height. View receipt, Continue
 * shopping and Create an account are text rows in the scroll content, so the
 * item list stays visible.
 */
export function OrderConfirmationActions({
  verifiedOrders, finalizing, onRefresh, refreshing,
}: {
  verifiedOrders: VerifiedOrderRef[];
  finalizing: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const firstVerified = verifiedOrders[0] ?? null;

  const bottomPad = Math.max(insets.bottom, SP.sm) + SP.sm;

  return (
    <View style={[styles.actions, { borderTopColor: theme.border, paddingBottom: bottomPad }]}>
      {finalizing ? (
        <Button label="Check order status" variant="primary" loading={refreshing} onPress={onRefresh} fullWidth />
      ) : (
        <Button
          label="Continue shopping"
          variant="primary"
          onPress={() => router.replace('/(buyer)/discover' as never)}
          fullWidth
          testID="checkout-continue-shopping"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  titleBlock: { paddingTop: SP.md, paddingBottom: SP.lg },
  thanks: { fontFamily: FONT.bold, fontSize: FS.xxl, letterSpacing: -0.6 },
  orderNumberLine: { fontFamily: FONT.medium, fontSize: FS.sm, marginTop: SP.sm },
  heroActions: { flexDirection: 'row', gap: SP.sm, marginTop: SP.lg },
  eyebrow: { fontFamily: FONT.semibold, fontSize: FS.xs, letterSpacing: 1.2, textTransform: 'uppercase' },
  orderNumbers: { marginTop: 4, gap: 2 },
  orderNumber: { fontFamily: FONT.bold, fontSize: FS.xxl, letterSpacing: -0.6 },
  orderNumberPending: { fontFamily: FONT.medium, fontSize: FS.base, marginTop: 4 },
  body: { fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 21, marginTop: 6 },

  section: { marginBottom: SP.md },
  sectionHeading: { fontFamily: FONT.semibold, fontSize: FS.xs, letterSpacing: 0.9, textTransform: 'uppercase', marginBottom: SP.sm },

  row: { flexDirection: 'row', gap: SP.md, paddingVertical: SP.sm + 2 },
  rowLabel: { width: 118, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20 },
  rowValue: { flex: 1, minWidth: 0 },
  rowText: { fontFamily: FONT.medium, fontSize: FS.sm, lineHeight: 20 },
  rowStrong: { fontFamily: FONT.semibold, fontSize: FS.base, lineHeight: 20 },
  rowSub: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, marginTop: 2 },

  sellerHeader: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm + 4 },
  sellerName: { fontFamily: FONT.semibold, fontSize: FS.base, flexShrink: 1 },

  itemRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm + 4, paddingVertical: SP.sm + 2 },
  thumb: { width: 54, height: 72, borderRadius: RADII.chip, borderWidth: StyleSheet.hairlineWidth },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  itemName: { fontFamily: FONT.semibold, fontSize: FS.base },
  itemPrice: { fontFamily: FONT.semibold, fontSize: FS.sm },

  helpRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm + 4, paddingVertical: SP.sm },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm + 4, minHeight: 48 },
  linkLabel: { flex: 1, fontFamily: FONT.medium, fontSize: FS.base },
  linkSubtle: { flex: 1, fontFamily: FONT.regular, fontSize: FS.sm },
  linkHairline: { marginVertical: 0 },

  moreSection: { marginTop: SP.xs, marginBottom: SP.md },
  moreScroll: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm + 4 },
  moreTile: { width: 96 },
  moreThumb: { width: 96, height: 128, borderRadius: RADII.chip, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 6 },
  moreName: { fontFamily: FONT.medium, fontSize: FS.sm },
  morePrice: { fontFamily: FONT.semibold, fontSize: FS.sm, marginTop: 2 },

  actions: { gap: SP.sm, paddingHorizontal: SP.md, paddingTop: SP.sm, borderTopWidth: StyleSheet.hairlineWidth },
});
