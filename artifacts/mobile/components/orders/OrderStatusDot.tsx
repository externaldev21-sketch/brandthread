/**
 * Seller order status: a small dot + one word, and an outlined "Late" tag
 * when a paid order has waited more than 48h to ship. Used by the Orders tab
 * rows and the order detail header. Mapping lives in lib/orderStatusDot.ts.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { FONT, FS, RADIUS } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { orderStatusDot, statusDotColor } from '@/lib/orderStatusDot';
import type { OrderStatus, PaymentStatus } from '@/services/orderTypes';

export function OrderStatusDot({
  status, paymentStatus, late = false, size = 'sm', testID,
}: {
  status: OrderStatus;
  paymentStatus: PaymentStatus | string;
  late?: boolean;
  /** sm = list row (13pt), md = order detail (15pt). */
  size?: 'sm' | 'md';
  testID?: string;
}) {
  const { theme } = useAppTheme();
  const spec = orderStatusDot({ status, paymentStatus });
  const color = statusDotColor(spec.tone, theme);
  const dot = size === 'md' ? 8 : 6;
  const stopped = !spec.filled;
  return (
    <View
      style={st.row}
      testID={testID}
      accessible
      accessibilityLabel={late ? `${spec.label}, late` : spec.label}
    >
      <View
        style={{
          width: dot, height: dot, borderRadius: dot / 2,
          backgroundColor: spec.filled ? color : 'transparent',
          borderWidth: spec.filled ? 0 : 1.5,
          borderColor: color,
        }}
      />
      <Text
        style={[st.word, { fontSize: size === 'md' ? FS.base : FS.sm, color: stopped ? theme.muted : theme.text }]}
        numberOfLines={1}
      >
        {spec.label}
      </Text>
      {late ? (
        <View style={[st.late, { borderColor: theme.border }]} testID={testID ? `${testID}-late` : undefined}>
          <Text style={[st.lateText, { color: theme.muted }]}>Late</Text>
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  word: { fontFamily: FONT.medium },
  late: {
    borderWidth: 1,
    borderRadius: RADIUS.xs,
    paddingHorizontal: 4,
    // 1pt keeps the 11pt tag on the same line height as the 13pt word.
    paddingVertical: 1,
  },
  lateText: { fontSize: FS.xs, fontFamily: FONT.semibold, letterSpacing: 0.2 },
});
