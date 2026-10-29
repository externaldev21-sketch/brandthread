import React, { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { StatusBadge } from '@/components/BrandthreadUI';
import {
  SellerDashboardListGroup,
  SellerDashboardListItem,
  SellerDashboardSectionHeader,
} from '@/components/SellerDashboardSections';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { FONT, FS, SP } from '@/lib/theme';
import type { RecentOrderSummary } from '@/lib/sellerDashboardStats';
import { formatMoney } from '@/lib/format';
import { LiveRowEnter } from '@/components/motion/LiveRowEnter';

export function orderStatusVariant(status: string): 'success' | 'info' | 'warning' | 'error' | 'neutral' | 'purple' {
  switch (status) {
    case 'shipped':
    case 'delivered': return 'success';
    case 'new':
    case 'pending': return 'info';
    case 'processing': return 'purple';
    case 'ready_to_ship':
    case 'fulfilled': return 'warning';
    case 'refunded':
    case 'cancelled': return 'error';
    default: return 'neutral';
  }
}

export function orderStatusLabel(status: string): string {
  switch (status) {
    case 'ready_to_ship': return 'Ready';
    case 'fulfilled': return 'Ready';
    case 'processing': return 'Processing';
    case 'new':
    case 'pending': return 'New';
    case 'shipped': return 'Shipped';
    case 'delivered': return 'Delivered';
    case 'refunded': return 'Refunded';
    case 'cancelled': return 'Cancelled';
    default: return status;
  }
}

export function SellerDashboardRecentOrders({
  orders,
  onOpenOrder,
  onSeeAll,
  emptyMessage,
}: {
  orders: RecentOrderSummary[];
  onOpenOrder: (id: string) => void;
  onSeeAll: () => void;
  /** Shown under the section title when there are no orders yet (Shopify
   *  home keeps its sections on screen at zero); omit to hide the section. */
  emptyMessage?: string;
}) {
  const { theme } = useAppTheme();
  // Live order pop (pack 2, item 15): each order id's entrance is decided
  // once, the first time it's rendered — the first list shown is taken
  // as-is, and an id that appears after that (a live order landing) slides
  // in from above while the rows below glide down. Sticky per id so a later
  // re-render (the 30s poll) never flips a row's entrance mid-run.
  const entranceRef = useRef<Map<string, boolean> | null>(null);
  const shown = orders.slice(0, 5);
  if (shown.length > 0) {
    const first = entranceRef.current === null;
    const map = entranceRef.current ?? new Map<string, boolean>();
    for (const o of shown) if (!map.has(o.id)) map.set(o.id, !first);
    entranceRef.current = map;
  }
  const isNew = (id: string) => entranceRef.current?.get(id) === true;
  if (orders.length === 0) {
    if (!emptyMessage) return null;
    return (
      <View testID="seller-dashboard-recent-orders">
        <SellerDashboardSectionHeader title="Recent orders" action="See all" onAction={onSeeAll} />
        <Text style={[emptyStyles.text, { color: theme.muted }]}>{emptyMessage}</Text>
      </View>
    );
  }

  return (
    <View testID="seller-dashboard-recent-orders">
      <SellerDashboardSectionHeader title="Recent orders" action="See all" onAction={onSeeAll} />
      <SellerDashboardListGroup>
        {shown.map((order, index, arr) => (
          <LiveRowEnter key={order.id} animate={isNew(order.id)} testID={isNew(order.id) ? 'seller-dashboard-recent-order-new' : undefined}>
          <SellerDashboardListItem
            icon="shopping-bag"
            title={order.buyerName}
            subtitle={`${order.orderNumber} · ${order.itemCount} ${order.itemCount === 1 ? 'item' : 'items'}`}
            value={formatMoney(order.totalCents)}
            rightElement={<StatusBadge label={orderStatusLabel(order.status)} variant={orderStatusVariant(order.status)} small />}
            onPress={() => onOpenOrder(order.id)}
            isLast={index === arr.length - 1}
          />
          </LiveRowEnter>
        ))}
      </SellerDashboardListGroup>
    </View>
  );
}

const emptyStyles = StyleSheet.create({
  text: { fontFamily: FONT.regular, fontSize: FS.sm, paddingVertical: SP.sm },
});
