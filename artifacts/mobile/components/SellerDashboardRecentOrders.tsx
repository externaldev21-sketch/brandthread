import React from 'react';
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
        {orders.slice(0, 5).map((order, index, arr) => (
          <SellerDashboardListItem
            key={order.id}
            icon="shopping-bag"
            title={order.buyerName}
            subtitle={`${order.orderNumber} · ${order.itemCount} ${order.itemCount === 1 ? 'item' : 'items'}`}
            value={formatMoney(order.totalCents)}
            rightElement={<StatusBadge label={orderStatusLabel(order.status)} variant={orderStatusVariant(order.status)} small />}
            onPress={() => onOpenOrder(order.id)}
            isLast={index === arr.length - 1}
          />
        ))}
      </SellerDashboardListGroup>
    </View>
  );
}

const emptyStyles = StyleSheet.create({
  text: { fontFamily: FONT.regular, fontSize: FS.sm, paddingVertical: SP.sm },
});
