/**
 * Delivery method — GOAT Order Review's bordered option cards: one card per
 * available method, each showing its price and ETA, the selected one drawn
 * with a solid monochrome border and a filled radio. One group per seller
 * (a multi-seller cart ships separately, so each seller gets its own list).
 *
 * Each option card is the only pressable in its subtree — no nested
 * "Details" button inside it (see tests/checkout-no-nested-pressables).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import type { CheckoutSession } from '@/services/cartTypes';
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
            {group.availableMethods.map(method => {
              const selected = group.selectedMethodId === method.id;
              const price = method.priceCents === 0 ? 'Free' : formatCents(method.priceCents);
              return (
                <PressableScale
                  key={method.id}
                  onPress={() => onSelect(group.sellerId, method.id)}
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
            })}
          </View>
        </View>
      ))}
    </CheckoutCard>
  );
}

const styles = StyleSheet.create({
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
