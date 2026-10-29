/**
 * "Gift" row on the seller's order detail and fulfillment screens: who the
 * gift is to and from, and the buyer's gift message. The packing slip for a
 * gift order prints as a gift receipt with prices hidden (lib/packingSlip.ts).
 * Renders nothing for an order that is not a gift.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BrandthreadCard } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, ICON, SP } from '@/lib/theme';
import type { Order } from '@/services/orderTypes';

type Theme = ReturnType<typeof useAppTheme>['theme'];

export function OrderGiftNote({ gift }: { gift: Order['gift'] }) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  if (!gift) return null;
  return (
    <View testID="order-gift-note">
      <BrandthreadCard>
        <View style={s.header}>
          <Feather name="gift" size={ICON.sm} color={theme.text} />
          <Text style={s.title}>Gift</Text>
        </View>
        {gift.to ? (
          <View style={s.row}>
            <Text style={s.label}>To</Text>
            <Text style={s.value} numberOfLines={1}>{gift.to}</Text>
          </View>
        ) : null}
        {gift.from ? (
          <View style={s.row}>
            <Text style={s.label}>From</Text>
            <Text style={s.value} numberOfLines={1}>{gift.from}</Text>
          </View>
        ) : null}
        {gift.message ? <Text style={s.message}>{gift.message}</Text> : null}
        <Text style={s.hint}>Packing slip prints as a gift receipt with prices hidden</Text>
      </BrandthreadCard>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
    title: { fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text },
    row: { flexDirection: 'row', justifyContent: 'space-between', gap: SP.md, paddingVertical: SP.xs },
    label: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted },
    value: { flexShrink: 1, fontSize: FS.sm, fontFamily: FONT.medium, color: theme.text },
    message: { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 18, color: theme.text, marginTop: SP.xs },
    hint: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: SP.sm },
  });
}
