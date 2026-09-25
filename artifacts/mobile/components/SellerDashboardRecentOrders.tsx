import React from 'react';
import { View } from 'react-native';

import { StatusBadge } from '@/components/BrandthreadUI';
import {
  SellerDashboardListGroup,
  SellerDashboardListItem,
  SellerDashboardSectionHeader,
} from '@/components/SellerDashboardSections';
import { formatCents } from '@/lib/money';
import type { RecentOrderSummary } from '@/lib/sellerDashboardStats';

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
}: {
  orders: RecentOrderSummary[];
  onOpenOrder: (id: string) => void;
  onSeeAll: () => void;
}) {
  if (orders.length === 0) return null;

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
            value={formatCents(order.totalCents)}
            rightElement={<StatusBadge label={orderStatusLabel(order.status)} variant={orderStatusVariant(order.status)} small />}
            onPress={() => onOpenOrder(order.id)}
            isLast={index === arr.length - 1}
          />
        ))}
      </SellerDashboardListGroup>
    </View>
  );
}
