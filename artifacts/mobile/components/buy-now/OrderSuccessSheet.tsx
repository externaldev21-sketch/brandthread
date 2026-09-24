/**
 * OrderSuccessSheet — Luma-style "Order placed!" confirmation, in Brandthread's
 * monochrome-brand look (the success circle is theme.accent, never green).
 *
 * Every detail row is real order data passed in by BuyNowFlow — there is no
 * placeholder copy. A row that has no data (e.g. no resolved payment-method
 * label) is simply omitted rather than shown empty.
 *
 * Map card: react-native-maps is NOT a dependency of this app (confirmed
 * against package.json) and this component intentionally does not add one.
 * The "map" is a static, non-interactive rounded address card that opens the
 * OS Maps app via Linking — see the header comment on the address row below
 * for the react-native-maps upgrade path.
 */
import React, { useEffect, useRef } from 'react';
import {
  Animated, Easing, Linking, Platform, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { CachedImage } from '@/components/CachedImage';
import { formatCents } from '@/lib/money';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

export interface OrderSuccessData {
  orderId: string;
  orderNumber: string;
  productName: string;
  itemCount: number;
  brandName: string;
  thumbnailUri?: string;
  totalCents?: number;
  estimatedDelivery?: string;
  shippingAddressLine?: string; // "123 Main St, Springfield"
  fullShippingAddress?: string; // full address for the maps deep-link
  paymentMethodLabel?: string; // e.g. "Visa •• 4242" or "Apple Pay"
}

function DetailRow({ icon, label, value }: { icon: React.ComponentProps<typeof Feather>['name']; label: string; value: string }) {
  const { theme } = useAppTheme();
  return (
    <View style={s.detailRow}>
      <Feather name={icon} size={15} color={theme.muted} style={{ width: 20 }} />
      <Text style={[s.detailLabel, { color: theme.muted }]}>{label}</Text>
      <Text style={[s.detailValue, { color: theme.text }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

/** Staggered fade/slide-up reveal — each item's delay offsets from the previous. */
function useStagger(count: number, stepMs = 70) {
  const values = useRef(Array.from({ length: count }, () => new Animated.Value(0))).current;
  useEffect(() => {
    Animated.stagger(stepMs, values.map(v => Animated.timing(v, {
      toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }))).start();
  }, [values, stepMs]);
  return values.map(v => ({
    opacity: v,
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
  }));
}

export function OrderSuccessSheet({
  order, onTrackOrder, onContinue,
}: {
  order: OrderSuccessData;
  onTrackOrder: (orderId: string) => void;
  onContinue: () => void;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const checkScale = useRef(new Animated.Value(0)).current;

  // Rows revealed in sequence: headline, product, divider+details, map, buttons.
  const stagger = useStagger(5, 75);

  useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Animated.spring(checkScale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 10 }).start();
  }, [checkScale]);

  const heading = order.itemCount > 1
    ? `${order.itemCount} items from ${order.brandName}`
    : order.productName;

  function openMaps() {
    if (!order.fullShippingAddress) return;
    const query = encodeURIComponent(order.fullShippingAddress);
    const url = Platform.select({
      ios: `maps://?q=${query}`,
      android: `geo:0,0?q=${query}`,
      default: `https://maps.apple.com/?q=${query}`,
    })!;
    Linking.openURL(url).catch(() => {
      Linking.openURL(`https://maps.apple.com/?q=${query}`).catch(() => {});
    });
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onContinue} accessibilityLabel="Dismiss" />
      <View style={[s.sheet, { backgroundColor: theme.surface, paddingBottom: insets.bottom + SP.md }]}>
        <View style={s.handle} />
        <TouchableOpacity onPress={onContinue} style={s.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
          <Feather name="x" size={16} color={theme.text} />
        </TouchableOpacity>

        <Animated.View style={[s.checkWrap, { transform: [{ scale: checkScale }] }]}>
          <View style={[s.checkCircle, { backgroundColor: theme.accent }]}>
            <Feather name="check" size={38} color={theme.onAccent} />
          </View>
        </Animated.View>

        <Animated.Text style={[s.eyebrow, { color: theme.muted }, stagger[0]]}>Order placed!</Animated.Text>

        <Animated.View style={[s.productRow, stagger[1]]}>
          {order.thumbnailUri && (
            <CachedImage source={{ uri: order.thumbnailUri }} style={s.thumb} contentFit="cover" />
          )}
          <Text style={[s.heading, { color: theme.text }]} numberOfLines={2}>{heading}</Text>
        </Animated.View>

        <Animated.View style={stagger[2]}>
          <View style={[s.divider, { backgroundColor: theme.border }]} />
          <View style={{ gap: 10, marginTop: SP.sm }}>
            <DetailRow icon="hash" label="Order" value={order.orderNumber} />
            {order.estimatedDelivery && (
              <DetailRow icon="truck" label="Arrives" value={order.estimatedDelivery} />
            )}
            {order.shippingAddressLine && (
              <DetailRow icon="map-pin" label="Ship to" value={order.shippingAddressLine} />
            )}
            {order.paymentMethodLabel && (
              <DetailRow icon="credit-card" label="Paid with" value={order.paymentMethodLabel} />
            )}
            {order.totalCents != null && (
              <DetailRow icon="check-circle" label="Total" value={formatCents(order.totalCents)} />
            )}
          </View>
        </Animated.View>

        {order.fullShippingAddress && (
          <Animated.View style={stagger[3]}>
            <TouchableOpacity
              onPress={openMaps}
              style={[s.mapCard, { backgroundColor: theme.cardElevated, borderColor: theme.border }]}
              accessibilityRole="button"
              accessibilityLabel="Open in Maps"
            >
              <View style={[s.mapIconCircle, { backgroundColor: theme.accentDim }]}>
                <Feather name="map" size={18} color={theme.accent} />
              </View>
              <Text style={[s.mapText, { color: theme.text }]} numberOfLines={2}>{order.fullShippingAddress}</Text>
              <Feather name="external-link" size={14} color={theme.muted} />
            </TouchableOpacity>
          </Animated.View>
        )}

        <Animated.View style={[s.buttons, stagger[4]]}>
          <TouchableOpacity
            style={[s.primaryBtn, { backgroundColor: theme.accent }]}
            onPress={() => onTrackOrder(order.orderId)}
            accessibilityRole="button"
            accessibilityLabel="Track order"
          >
            <Text style={[s.primaryBtnText, { color: theme.onAccent }]}>Track Order</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.secondaryBtn, { backgroundColor: theme.cardElevated }]}
            onPress={onContinue}
            accessibilityRole="button"
            accessibilityLabel="Continue"
          >
            <Text style={[s.secondaryBtnText, { color: theme.text }]}>Continue</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: SP.lg, paddingTop: SP.sm,
    maxHeight: '92%',
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 4 },
  closeBtn: { position: 'absolute', top: SP.md, right: SP.md, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  checkWrap: { alignItems: 'center', marginTop: SP.lg, marginBottom: SP.sm },
  checkCircle: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { textAlign: 'center', fontSize: FS.sm, fontFamily: FONT.medium },
  productRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 6, paddingHorizontal: SP.md },
  thumb: { width: 40, height: 40, borderRadius: RADIUS.sm },
  heading: { fontSize: FS.xl, fontFamily: FONT.bold, textAlign: 'center', flexShrink: 1 },
  divider: { height: 1, marginTop: SP.md },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailLabel: { fontSize: FS.sm, fontFamily: FONT.regular, width: 78 },
  detailValue: { flex: 1, fontSize: FS.sm, fontFamily: FONT.semibold, textAlign: 'right' },
  mapCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: RADIUS.md, borderWidth: 1, padding: SP.sm, marginTop: SP.md },
  mapIconCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  mapText: { flex: 1, fontSize: FS.xs, fontFamily: FONT.medium },
  buttons: { gap: 10, marginTop: SP.lg },
  primaryBtn: { minHeight: 52, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { fontSize: FS.base, fontFamily: FONT.bold },
  secondaryBtn: { minHeight: 52, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { fontSize: FS.base, fontFamily: FONT.semibold },
});
