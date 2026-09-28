/**
 * Order confirmation — HBX "ORDER COMPLETE" (order number + view order),
 * lululemon "Order Confirmation" (shipping address, estimated delivery, need
 * help, continue shopping), SSENSE thank-you (order number / delivery /
 * shipping blocks).
 *
 * Navigation rules carried over unchanged from the previous screen:
 * "Track order" routes ONLY with a verified server order id (never the
 * display number) and stays disabled while the order is still finalizing.
 */
import React, { useEffect } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import * as Haptics from 'expo-haptics';
import { PressableScale } from '@/components/BrandthreadUI';
import { Button, SuccessCheck } from '@/components/ui';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/hooks/useApi';
import { requestContextualPushPermission } from '@/lib/contextualPushPermission';
import { formatCents } from '@/lib/money';
import type { CheckoutSession } from '@/services/cartTypes';
import { FONT, FS, SP } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { TABULAR_NUMS } from '@/constants/typography';
import { CheckoutCard, Hairline } from './CheckoutPrimitives';

export interface VerifiedOrderRef {
  id: string;
  number: string;
  sellerId: string;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: theme.muted }]}>{label}</Text>
      <View style={styles.detailValue}>{children}</View>
    </View>
  );
}

export function OrderConfirmation({
  session, verifiedOrders, finalizing, onRefresh, refreshing, totalPaidCents,
}: {
  session: CheckoutSession;
  verifiedOrders: VerifiedOrderRef[];
  finalizing: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  totalPaidCents: number;
}) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const api = useApi();
  const { isSignedIn, userId } = useAuth();

  const items = session.deliveryGroups.flatMap(group => group.items);
  const deliveryEstimates = session.deliveryGroups
    .map(group => group.availableMethods.find(method => method.id === group.selectedMethodId)?.estimatedDelivery)
    .filter((value): value is string => !!value);
  const preOrderEstimates = items.map(item => item.preOrderEstShipDate).filter((value): value is string => !!value);
  const estimates = [...new Set([...deliveryEstimates, ...preOrderEstimates])];
  const firstGroup = session.deliveryGroups[0];
  const firstVerified = verifiedOrders[0] ?? null;
  const email = session.contact?.email ?? '';
  const address = session.shippingAddress;

  useEffect(() => {
    // A completed purchase is a meaningful, server-backed moment — exactly
    // when contextualPushPermission.ts wants to ask, never on first launch.
    if (firstVerified?.id) void requestContextualPushPermission(userId, api);
  }, [firstVerified?.id, userId, api]);

  function trackOrder() {
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
      <View style={styles.hero}>
        {finalizing ? (
          <View style={[styles.pending, { borderColor: theme.border }]}>
            <Feather name="clock" size={32} color={theme.text} />
          </View>
        ) : (
          <SuccessCheck size={72} iconSize={34} haptic={false} />
        )}
        <Text style={[styles.eyebrow, { color: theme.muted }]}>{finalizing ? 'PAYMENT RECEIVED' : 'ORDER CONFIRMED'}</Text>
        <Text style={[styles.headline, { color: theme.text }]}>{finalizing ? 'Almost there' : 'Thank you for your order'}</Text>
        <Text style={[styles.body, { color: theme.muted }]}>
          {finalizing
            ? 'We’re finalizing your order with the seller. This can take a moment after payment.'
            : email
              ? `A confirmation is on its way to ${email}.`
              : 'Your order is confirmed. We’ll keep you updated every step of the way.'}
        </Text>
      </View>

      <CheckoutCard title="Order details">
        <DetailRow label={verifiedOrders.length > 1 ? 'Order numbers' : 'Order number'}>
          {verifiedOrders.length > 0 ? verifiedOrders.map(order => (
            <Text key={order.id} style={[styles.detailStrong, { color: theme.text }]} testID="checkout-order-number">{order.number}</Text>
          )) : (
            <Text style={[styles.detailText, { color: theme.muted }]}>Assigned once payment is confirmed</Text>
          )}
        </DetailRow>
        <Hairline />
        <DetailRow label="Estimated delivery">
          {estimates.length > 0 ? estimates.map(estimate => (
            <Text key={estimate} style={[styles.detailText, { color: theme.text }]}>{estimate}</Text>
          )) : (
            <Text style={[styles.detailText, { color: theme.text }]}>Shared as soon as the seller ships</Text>
          )}
          {estimates.length > 1 ? (
            <Text style={[styles.detailSub, { color: theme.muted }]}>Arrives in {estimates.length} shipments</Text>
          ) : null}
        </DetailRow>
        {address?.line1 ? (
          <>
            <Hairline />
            <DetailRow label="Shipping to">
              <Text style={[styles.detailText, { color: theme.text }]}>{[address.firstName, address.lastName].filter(Boolean).join(' ')}</Text>
              <Text style={[styles.detailSub, { color: theme.muted }]}>
                {[address.line1, address.line2].filter(Boolean).join(', ')}{'\n'}{address.city}, {address.state} {address.postalCode}
              </Text>
            </DetailRow>
          </>
        ) : null}
        <Hairline />
        <DetailRow label="Total">
          <Text style={[styles.detailStrong, { color: theme.text }, TABULAR_NUMS]}>{formatCents(totalPaidCents)}</Text>
        </DetailRow>
      </CheckoutCard>

      {items.length > 0 ? (
        <CheckoutCard title={`${items.length} ${items.length === 1 ? 'item' : 'items'}`}>
          {items.map((item, index) => (
            <View key={item.id}>
              {index > 0 ? <Hairline /> : null}
              <View style={styles.itemRow}>
                {item.imageUri ? (
                  <Image source={{ uri: item.imageUri }} style={[styles.thumb, { borderColor: theme.border }]} resizeMode="cover" />
                ) : (
                  <View style={[styles.thumb, styles.thumbFallback, { borderColor: theme.border, backgroundColor: theme.cardElevated }]}>
                    <Feather name="image" size={14} color={theme.subtle} />
                  </View>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.itemName, { color: theme.text }]} numberOfLines={1}>{item.productName}</Text>
                  <Text style={[styles.detailSub, { color: theme.muted }]} numberOfLines={1}>
                    {[item.variantTitle, `Qty ${item.quantity}`].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </CheckoutCard>
      ) : null}

      {finalizing ? (
        <Button label="Check order status" variant="primary" loading={refreshing} onPress={onRefresh} fullWidth style={{ marginTop: SP.xs }} />
      ) : (
        <View style={styles.actions}>
          <Button
            label="Track order"
            icon="package"
            variant="primary"
            disabled={!firstVerified?.id}
            onPress={trackOrder}
            fullWidth
            testID="checkout-track-order"
          />
          <Button label="Continue shopping" variant="secondary" onPress={() => router.replace('/(buyer)/discover' as never)} fullWidth />
          {!isSignedIn ? (
            <Button label="Create an account" variant="tertiary" onPress={() => router.replace('/sign-in' as never)} fullWidth />
          ) : null}
        </View>
      )}

      {firstGroup ? (
        <CheckoutCard title="Need help?" style={{ marginTop: SP.md }}>
          <PressableScale
            onPress={messageSeller}
            style={styles.helpRow}
            accessibilityRole="button"
            accessibilityLabel={`Message ${firstGroup.sellerName}`}
            rippleEnabled={false}
          >
            <Feather name="message-circle" size={18} color={theme.text} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemName, { color: theme.text }]}>Message {firstGroup.sellerName}</Text>
              <Text style={[styles.detailSub, { color: theme.muted }]}>Questions about sizing, shipping or your order</Text>
            </View>
            <Feather name="chevron-right" size={18} color={theme.muted} />
          </PressableScale>
        </CheckoutCard>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingTop: SP.md, paddingBottom: SP.lg },
  pending: { width: 72, height: 72, borderRadius: 36, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontFamily: FONT.semibold, fontSize: FS.xs, letterSpacing: 1.4, marginTop: SP.md },
  headline: { fontFamily: FONT.bold, fontSize: FS.xxl, letterSpacing: -0.6, marginTop: 6, textAlign: 'center' },
  body: { fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 21, textAlign: 'center', marginTop: SP.sm, maxWidth: 320 },
  detailRow: { flexDirection: 'row', gap: SP.md },
  detailLabel: { width: 118, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20 },
  detailValue: { flex: 1, minWidth: 0 },
  detailText: { fontFamily: FONT.medium, fontSize: FS.sm, lineHeight: 20 },
  detailStrong: { fontFamily: FONT.semibold, fontSize: FS.base, lineHeight: 20 },
  detailSub: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, marginTop: 2 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm + 4 },
  thumb: { width: 44, height: 54, borderRadius: RADII.chip, borderWidth: StyleSheet.hairlineWidth },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  itemName: { fontFamily: FONT.semibold, fontSize: FS.base },
  actions: { gap: SP.sm, marginTop: SP.xs },
  helpRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm + 4 },
});
