/**
 * The small card a tapped globe dot opens: order number, main item, amount,
 * place and time ago. Anchored above the dot (below it when there's no room)
 * and clamped inside the globe box. Black/white/silver; text uses the app's
 * FONT tokens (bundled Inter on web, the system font on native).
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { formatCents } from '@/lib/money';
import { liveMapCityLabel, recentOrderItemLabel, timeAgo, type LiveMapRecentOrder } from '@/lib/liveMap/liveMap';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { Icon } from '@/components/ui/Icon';
import { GLOBE_COLORS } from './globeColors';

export const POPOVER_WIDTH = 216;
const POPOVER_HEIGHT = 112;
const GAP = 14;

export function popoverPosition(x: number, y: number, boxWidth: number, boxHeight: number, tall = false): { left: number; top: number } {
  const height = POPOVER_HEIGHT + (tall ? 18 : 0);
  const left = Math.min(Math.max(8, x - POPOVER_WIDTH / 2), Math.max(8, boxWidth - POPOVER_WIDTH - 8));
  const above = y - GAP - height;
  const top = above >= 4 ? above : Math.min(y + GAP, Math.max(4, boxHeight - height - 4));
  return { left, top };
}

export function OrderGlobePopover({
  order,
  x,
  y,
  boxWidth,
  boxHeight,
  moreHere = 0,
  onOpen,
  onClose,
}: {
  order: LiveMapRecentOrder;
  /** Other recent orders at the same place (one dot per place). */
  moreHere?: number;
  x: number;
  y: number;
  boxWidth: number;
  boxHeight: number;
  onOpen?: (orderId: string) => void;
  onClose: () => void;
}) {
  const { left, top } = popoverPosition(x, y, boxWidth, boxHeight, moreHere > 0);
  const place = liveMapCityLabel(order);
  const ago = timeAgo(order.at);
  return (
    <View
      style={[styles.card, { left, top }]}
      testID="seller-globe-popover"
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`Order ${order.orderNumber}, ${recentOrderItemLabel(order)}, ${formatCents(order.amountCents)}, ${place}, ${ago}`}
    >
      <View style={styles.topRow}>
        <Text style={styles.orderNumber} numberOfLines={1} testID="seller-globe-popover-number">{order.orderNumber}</Text>
        <TouchableOpacity onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close order details">
          <Icon name="x" size={14} color={MUTED_SILVER} />
        </TouchableOpacity>
      </View>
      <Text style={styles.item} numberOfLines={1} testID="seller-globe-popover-item">{recentOrderItemLabel(order)}</Text>
      <Text style={styles.amount} numberOfLines={1} testID="seller-globe-popover-amount">{formatCents(order.amountCents)}</Text>
      <View style={styles.metaRow}>
        <Text style={styles.meta} numberOfLines={1} testID="seller-globe-popover-place">{place}</Text>
        <Text style={styles.meta} numberOfLines={1} testID="seller-globe-popover-time">{ago}</Text>
      </View>
      {moreHere > 0 && (
        <Text style={styles.more} numberOfLines={1} testID="seller-globe-popover-more">
          {`+${moreHere} more ${moreHere === 1 ? 'order' : 'orders'} here`}
        </Text>
      )}
      {onOpen && (
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          onPress={() => onOpen(order.id)}
          accessibilityRole="button"
          accessibilityLabel={`Open order ${order.orderNumber}`}
        />
      )}
    </View>
  );
}

const SILVER = GLOBE_COLORS.text;
const MUTED_SILVER = GLOBE_COLORS.mutedText;

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    width: POPOVER_WIDTH,
    minHeight: POPOVER_HEIGHT - 8,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm + 2,
    borderRadius: RADIUS.md,
    backgroundColor: 'rgba(12,12,13,0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(217,219,223,0.45)',
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.sm, zIndex: 1 },
  orderNumber: { flex: 1, fontFamily: FONT.semibold, fontSize: FS.sm, color: GLOBE_COLORS.core, fontVariant: ['tabular-nums'] },
  item: { marginTop: 2, fontFamily: FONT.regular, fontSize: FS.sm, color: SILVER },
  amount: { marginTop: SP.xs, fontFamily: FONT.bold, fontSize: FS.lg, color: GLOBE_COLORS.core, fontVariant: ['tabular-nums'] },
  metaRow: { marginTop: 2, flexDirection: 'row', justifyContent: 'space-between', gap: SP.sm },
  meta: { flexShrink: 1, fontFamily: FONT.medium, fontSize: FS.xs, color: MUTED_SILVER },
  more: { marginTop: 4, fontFamily: FONT.medium, fontSize: FS.xs, color: SILVER },
});
