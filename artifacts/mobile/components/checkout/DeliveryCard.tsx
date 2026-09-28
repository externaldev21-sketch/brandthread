/**
 * Delivery method — GOAT Order Review's bordered option cards: one card per
 * available method, each showing its price and ETA, the selected one drawn
 * with a solid monochrome border and a filled radio. One group per seller
 * (a multi-seller cart ships separately, so each seller gets its own list).
 *
 * Each option card is the only pressable in its subtree — no nested
 * "Details" button inside it (see tests/checkout-no-nested-pressables).
 */
import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import type { CheckoutSession, CheckoutShippingMethod } from '@/services/cartTypes';
import { FONT, FS, SP } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';
import { RADII } from '@/constants/radii';
import { CheckoutCard, RadioDot } from './CheckoutPrimitives';

export function DeliveryCard({
  session, onSelect,
}: {
  session: CheckoutSession;
  onSelect: (sellerId: string, methodId: string) => void;
}) {
  const { theme } = useAppTheme();
  const multiSeller = session.deliveryGroups.length > 1;

  return (
    <CheckoutCard title="Delivery" testID="checkout-delivery">
      {session.deliveryGroups.map((group, groupIndex) => (
        <View key={group.sellerId} style={groupIndex > 0 ? { marginTop: SP.md } : undefined} accessibilityRole="radiogroup">
          {multiSeller ? (
            <Text style={[styles.groupLabel, { color: theme.muted }]}>
              From {group.sellerName} · {group.items.length} {group.items.length === 1 ? 'item' : 'items'}
            </Text>
          ) : null}
          <View style={styles.options}>
            {group.availableMethods.length === 0 ? (
              // Designed empty state: the seller returned no shipping option
              // (Place order stays disabled via getCheckoutBlockingSection,
              // and the footer says "Choose a delivery option to continue").
              <View style={[styles.empty, { borderColor: theme.border }]} testID="checkout-delivery-empty">
                <Feather name="truck" size={16} color={theme.muted} style={{ marginTop: 1 }} />
                <View style={styles.copy}>
                  <Text style={[styles.service, { color: theme.text }]}>No delivery option available</Text>
                  <Text style={[styles.eta, { color: theme.muted }]}>
                    We couldn’t get a shipping rate from {group.sellerName}. Close checkout and try again in a moment.
                  </Text>
                </View>
              </View>
            ) : group.availableMethods.map(method => (
              <DeliveryOption
                key={method.id}
                sellerId={group.sellerId}
                method={method}
                selected={group.selectedMethodId === method.id}
                onSelect={onSelect}
              />
            ))}
          </View>
        </View>
      ))}
    </CheckoutCard>
  );
}

/** One bordered option card — the only pressable in its subtree, with a stable press handler. */
function DeliveryOption({
  sellerId, method, selected, onSelect,
}: {
  sellerId: string;
  method: CheckoutShippingMethod;
  selected: boolean;
  onSelect: (sellerId: string, methodId: string) => void;
}) {
  const { theme } = useAppTheme();
  const price = method.priceCents === 0 ? 'Free' : formatCents(method.priceCents);
  const handlePress = useCallback(() => onSelect(sellerId, method.id), [onSelect, sellerId, method.id]);
  return (
    <PressableScale
      onPress={handlePress}
      style={[
        styles.option,
        { borderColor: selected ? theme.text : theme.border, borderWidth: selected ? 1.5 : 1 },
      ]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${method.service}, ${method.estimatedDelivery}, ${price}`}
      rippleEnabled={false}
      testID={`checkout-delivery-${method.id}`}
    >
      <RadioDot selected={selected} />
      <View style={styles.copy}>
        <Text style={[styles.service, { color: theme.text }]} numberOfLines={2}>{method.service}</Text>
        <Text style={[styles.eta, { color: theme.muted }]} numberOfLines={2}>
          {method.estimatedDelivery}{method.trackingIncluded ? ' · Tracked' : ''}
        </Text>
      </View>
      <Text style={[styles.price, { color: theme.text }]}>{price}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  empty: {
    flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm + 4,
    borderRadius: RADII.card, borderWidth: 1, borderStyle: 'dashed',
    paddingHorizontal: SP.sm + 6, paddingVertical: SP.sm + 6,
  },
  groupLabel: { fontFamily: FONT.medium, fontSize: FS.sm, marginBottom: SP.sm },
  options: { gap: SP.sm },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm + 4,
    borderRadius: RADII.card, paddingHorizontal: SP.sm + 6, paddingVertical: SP.sm + 6,
  },
  copy: { flex: 1, minWidth: 0 },
  service: { fontFamily: FONT.semibold, fontSize: FS.base },
  eta: { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 2, lineHeight: 18 },
  price: { fontFamily: FONT.semibold, fontSize: FS.base, ...TABULAR_NUMS },
});
