/**
 * Order summary — photo, name, variant, qty, price and seller for every line
 * item (GOAT Order Review product row). A single Buy Now item is always
 * shown expanded; a multi-item cart starts collapsed to a thumbnail strip
 * with an item count, and expands in place.
 */
import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { FONT, FS, SP } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';
import { RADII } from '@/constants/radii';
import type { CheckoutSession } from '@/services/cartTypes';
import { CheckoutCard, Hairline } from './CheckoutPrimitives';

type LineItem = CheckoutSession['deliveryGroups'][number]['items'][number];

function Thumb({ uri, size }: { uri?: string; size: { width: number; height: number } }) {
  const { theme } = useAppTheme();
  if (uri) {
    return <Image source={{ uri }} style={[styles.thumb, size, { borderColor: theme.border }]} resizeMode="cover" />;
  }
  return (
    <View style={[styles.thumb, size, styles.thumbFallback, { borderColor: theme.border, backgroundColor: theme.cardElevated }]}>
      <Feather name="image" size={16} color={theme.subtle} />
    </View>
  );
}

function ItemRow({ item, sellerName }: { item: LineItem; sellerName: string }) {
  const { theme } = useAppTheme();
  const variant = [item.variantTitle, `Qty ${item.quantity}`].filter(Boolean).join(' · ');
  return (
    <View style={styles.itemRow} accessible accessibilityLabel={`${item.productName}, ${variant}, ${formatCents(item.priceCents * item.quantity)}, sold by ${sellerName}`}>
      <Thumb uri={item.imageUri} size={{ width: 64, height: 80 }} />
      <View style={styles.itemCopy}>
        <Text style={[styles.itemName, { color: theme.text }]} numberOfLines={2}>{item.productName}</Text>
        <Text style={[styles.itemMeta, { color: theme.muted }]} numberOfLines={1}>{variant}</Text>
        <Text style={[styles.itemMeta, { color: theme.muted }]} numberOfLines={1}>Sold by {sellerName}</Text>
        {item.isPreOrder ? (
          <View style={styles.preorder}>
            <Feather name="clock" size={11} color={theme.muted} />
            <Text style={[styles.itemMeta, { color: theme.muted, marginTop: 0 }]}>
              Pre-order{item.preOrderEstShipDate ? ` · ships ${item.preOrderEstShipDate}` : ''}
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.itemPrice, { color: theme.text }]}>{formatCents(item.priceCents * item.quantity)}</Text>
    </View>
  );
}

export function OrderSummaryCard({ session }: { session: CheckoutSession }) {
  const { theme } = useAppTheme();
  const rows = session.deliveryGroups.flatMap(group => group.items.map(item => ({ item, sellerName: group.sellerName })));
  const itemCount = rows.reduce((sum, row) => sum + row.item.quantity, 0);
  const collapsible = rows.length > 1;
  const [expanded, setExpanded] = useState(!collapsible);

  return (
    <CheckoutCard title={collapsible ? undefined : 'Order summary'} testID="checkout-order-summary">
      {collapsible ? (
        <PressableScale
          onPress={() => setExpanded(value => !value)}
          style={styles.toggle}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={`Order summary, ${itemCount} items. ${expanded ? 'Hide' : 'Show'} items`}
          rippleEnabled={false}
          noMinHeight
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.toggleEyebrow, { color: theme.muted }]}>ORDER SUMMARY</Text>
            <Text style={[styles.toggleTitle, { color: theme.text }]}>{itemCount} items</Text>
          </View>
          {!expanded ? (
            <View style={styles.strip} pointerEvents="none">
              {rows.slice(0, 3).map(({ item }) => (
                <Thumb key={item.id} uri={item.imageUri} size={{ width: 36, height: 44 }} />
              ))}
              {rows.length > 3 ? (
                <Text style={[styles.more, { color: theme.muted }]}>+{rows.length - 3}</Text>
              ) : null}
            </View>
          ) : null}
          <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={theme.muted} />
        </PressableScale>
      ) : null}

      {expanded ? (
        <View style={collapsible ? { marginTop: SP.sm + 4 } : undefined}>
          {rows.map(({ item, sellerName }, index) => (
            <View key={item.id}>
              {index > 0 ? <Hairline /> : null}
              <ItemRow item={item} sellerName={sellerName} />
            </View>
          ))}
        </View>
      ) : null}
    </CheckoutCard>
  );
}

const styles = StyleSheet.create({
  thumb: { borderRadius: RADII.chip, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm + 4 },
  itemCopy: { flex: 1, minWidth: 0 },
  itemName: { fontFamily: FONT.semibold, fontSize: FS.base, lineHeight: 20 },
  itemMeta: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 18, marginTop: 2 },
  itemPrice: { fontFamily: FONT.semibold, fontSize: FS.base, ...TABULAR_NUMS },
  preorder: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: SP.sm + 4 },
  toggleEyebrow: { fontFamily: FONT.semibold, fontSize: FS.xs, letterSpacing: 0.9 },
  toggleTitle: { fontFamily: FONT.semibold, fontSize: FS.base, marginTop: 4 },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  more: { fontFamily: FONT.medium, fontSize: FS.sm, marginLeft: 2 },
});
