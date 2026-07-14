import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  BG, SURFACE, CARD, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM,
  ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD,
  GRAD_PRIMARY, GRAD_CARD_GLOW,
  FONT, FS, SP, RADIUS, COMP, ICON,
} from '@/lib/theme';
import {
  BrandthreadScreen, BrandthreadCard, GradientCard,
  PrimaryButton, SecondaryButton, IconButton,
  SearchBar, FilterChip, StatusBadge,
  EmptyState, SectionHeader, StatCard, GuidedTip,
} from '@/components/BrandthreadUI';
import { DEMO_ORDERS } from '@/services/data';
import type { Order } from '@/services/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type FilterLabel = 'All' | 'New' | 'Processing' | 'Ready' | 'Shipped' | 'Returns' | 'Disputes';

const FILTERS: FilterLabel[] = ['All', 'New', 'Processing', 'Ready', 'Shipped', 'Returns', 'Disputes'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusVariant(status: string): 'info' | 'purple' | 'warning' | 'success' | 'neutral' | 'error' {
  switch (status) {
    case 'new':              return 'info';
    case 'processing':       return 'purple';
    case 'ready_to_ship':    return 'warning';
    case 'shipped':          return 'success';
    case 'returned':         return 'neutral';
    case 'refund_requested': return 'warning';
    case 'disputed':         return 'error';
    default:                 return 'neutral';
  }
}

function statusDisplayLabel(status: string): string {
  switch (status) {
    case 'new':              return 'New';
    case 'processing':       return 'Processing';
    case 'ready_to_ship':    return 'Ready to ship';
    case 'shipped':          return 'Shipped';
    case 'returned':         return 'Returned';
    case 'refund_requested': return 'Refund';
    case 'disputed':         return 'Disputed';
    // Map data.ts statuses to display labels
    case 'delivered':        return 'Shipped';
    case 'refunded':         return 'Returned';
    case 'cancelled':        return 'Returned';
    default:                 return status;
  }
}

function normaliseStatus(status: string): string {
  // Map actual data statuses to our filter buckets
  if (status === 'delivered') return 'shipped';
  if (status === 'refunded')  return 'returned';
  if (status === 'cancelled') return 'returned';
  return status;
}

function filterMatches(order: Order, filter: FilterLabel): boolean {
  const s = normaliseStatus(order.status);
  switch (filter) {
    case 'All':        return true;
    case 'New':        return s === 'new';
    case 'Processing': return s === 'processing';
    case 'Ready':      return s === 'ready_to_ship';
    case 'Shipped':    return s === 'shipped';
    case 'Returns':    return s === 'returned' || s === 'refund_requested';
    case 'Disputes':   return s === 'disputed';
  }
}

function totalRevenue(orders: Order[]): string {
  const total = orders.reduce((sum, o) => sum + o.total, 0);
  return '$' + total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function OrdersScreen() {
  const insets = useSafeAreaInsets();

  const [search, setSearch]   = useState('');
  const [filter, setFilter]   = useState<FilterLabel>('All');

  // ─── Stats ─────────────────────────────────────────────────────────────────

  const newCount        = DEMO_ORDERS.filter(o => normaliseStatus(o.status) === 'new').length;
  const processingCount = DEMO_ORDERS.filter(o => normaliseStatus(o.status) === 'processing').length;
  const readyCount      = DEMO_ORDERS.filter(o => normaliseStatus(o.status) === 'ready_to_ship').length;
  const shippedCount    = DEMO_ORDERS.filter(o => normaliseStatus(o.status) === 'shipped').length;
  const returnsCount    = DEMO_ORDERS.filter(o =>
    normaliseStatus(o.status) === 'returned' || normaliseStatus(o.status) === 'refund_requested'
  ).length;

  // ─── Filtered orders ───────────────────────────────────────────────────────

  const filteredOrders = useMemo(() => {
    let list = DEMO_ORDERS.filter(o => filterMatches(o, filter));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(o =>
        o.orderNumber.toLowerCase().includes(q) ||
        o.customer.name.toLowerCase().includes(q) ||
        o.items.some(i => i.productName.toLowerCase().includes(q))
      );
    }
    return list;
  }, [search, filter]);

  return (
    <BrandthreadScreen noSafeTop>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Header ────────────────────────────────────────────────────── */}
        <View style={[s.header, { paddingTop: insets.top + 8 }]}>
          <Text style={s.headerTitle}>Orders</Text>
        </View>

        {/* ── Summary Stats ─────────────────────────────────────────────── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.statsScroll}
          contentContainerStyle={s.statsContent}
        >
          <StatCard
            label="New"
            value={String(newCount)}
            icon="inbox"
            accent={BLUE}
            style={s.statCard}
          />
          <StatCard
            label="Processing"
            value={String(processingCount)}
            icon="refresh-cw"
            accent={PURPLE}
            style={s.statCard}
          />
          <StatCard
            label="Ready"
            value={String(readyCount)}
            icon="package"
            accent={ORANGE}
            style={s.statCard}
          />
          <StatCard
            label="Shipped"
            value={String(shippedCount)}
            icon="truck"
            accent={SUCCESS}
            style={s.statCard}
          />
          <StatCard
            label="Returns"
            value={String(returnsCount)}
            icon="rotate-ccw"
            accent={RED}
            style={s.statCard}
          />
          <StatCard
            label="Revenue"
            value={totalRevenue(DEMO_ORDERS)}
            icon="dollar-sign"
            accent={GOLD}
            style={s.statCard}
          />
        </ScrollView>

        {/* ── Search + Filters ──────────────────────────────────────────── */}
        <View style={s.searchWrap}>
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search orders…"
          />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.filtersScroll}
          contentContainerStyle={s.filtersContent}
        >
          {FILTERS.map(f => (
            <FilterChip
              key={f}
              label={f}
              active={filter === f}
              onPress={() => setFilter(f)}
            />
          ))}
        </ScrollView>

        {/* ── Orders List ───────────────────────────────────────────────── */}
        <View style={s.listWrap}>
          {filteredOrders.length === 0 ? (
            <EmptyState
              icon="shopping-bag"
              title="No orders yet"
              description="Orders from buyers appear here once your store is live."
              style={s.emptyState}
            />
          ) : (
            filteredOrders.map(order => (
              <OrderCard key={order.id} order={order} />
            ))
          )}
        </View>
      </ScrollView>
    </BrandthreadScreen>
  );
}

// ─── Order Card ───────────────────────────────────────────────────────────────

function OrderCard({ order }: { order: Order }) {
  const itemCount  = order.items.reduce((s, i) => s + i.quantity, 0);
  const firstItem  = order.items[0];
  const extraCount = order.items.length - 1;
  const normStatus = normaliseStatus(order.status);

  function handlePress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert('Order ' + order.orderNumber);
  }

  function handleAccept() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Accept', 'Order ' + order.orderNumber + ' accepted.');
  }

  function handleMarkReady() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Mark Ready', 'Order ' + order.orderNumber + ' marked ready.');
  }

  function handleShip() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Ship', 'Order ' + order.orderNumber + ' marked as shipped.');
  }

  function handleReview() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Review', 'Opening dispute review for ' + order.orderNumber);
  }

  const actionButton = (() => {
    switch (normStatus) {
      case 'new':
        return (
          <PrimaryButton
            small
            label="Accept"
            onPress={handleAccept}
            colors={['#3B82F6', '#22D3EE']}
            style={s.actionBtn}
          />
        );
      case 'processing':
        return (
          <SecondaryButton
            small
            label="Mark ready"
            onPress={handleMarkReady}
            accent={ORANGE}
            style={s.actionBtn}
          />
        );
      case 'ready_to_ship':
        return (
          <PrimaryButton
            small
            label="Ship"
            onPress={handleShip}
            colors={['#10B981', '#34D399']}
            style={s.actionBtn}
          />
        );
      case 'disputed':
        return (
          <PrimaryButton
            small
            label="Review"
            onPress={handleReview}
            colors={['#F87171', '#F97316']}
            style={s.actionBtn}
          />
        );
      default:
        return null;
    }
  })();

  return (
    <BrandthreadCard
      style={s.orderCard}
      onPress={handlePress}
    >
      {/* Top row: order number + badge + date */}
      <View style={s.orderTop}>
        <Text style={s.orderNum}>{order.orderNumber}</Text>
        <StatusBadge
          label={statusDisplayLabel(order.status)}
          variant={statusVariant(normStatus)}
          small
        />
        <Text style={s.orderDate}>2 days ago</Text>
      </View>

      {/* Customer name */}
      <Text style={s.customerName}>{order.customer.name}</Text>

      {/* Items summary */}
      <Text style={s.itemsSummary} numberOfLines={1}>
        {firstItem.productName}
        {extraCount > 0 ? ` and ${extraCount} more` : ''}
      </Text>

      {/* Bottom row: item count + total + action */}
      <View style={s.orderBottom}>
        <Text style={s.itemCount}>{itemCount} {itemCount === 1 ? 'item' : 'items'}</Text>
        <View style={s.bottomRight}>
          <Text style={s.orderTotal}>${order.total.toFixed(2)}</Text>
          {actionButton}
        </View>
      </View>
    </BrandthreadCard>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  scrollContent: {
    paddingBottom: COMP.tabBarH + SP.xl,
  },

  // Header
  header: {
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
  },
  headerTitle: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.3,
  },

  // Stats
  statsScroll: {
    flexGrow: 0,
    marginTop: SP.sm,
  },
  statsContent: {
    paddingHorizontal: SP.md,
    gap: SP.sm,
    paddingBottom: SP.xs,
  },
  statCard: {
    minWidth: 100,
  },

  // Search
  searchWrap: {
    paddingHorizontal: SP.md,
    marginTop: SP.md,
    marginBottom: SP.sm,
  },

  // Filters
  filtersScroll: {
    flexGrow: 0,
    marginBottom: SP.sm,
  },
  filtersContent: {
    paddingHorizontal: SP.md,
    gap: SP.sm,
  },

  // List
  listWrap: {
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
    gap: 0,
  },
  emptyState: {
    marginTop: SP.xl,
  },

  // Order card
  orderCard: {
    marginBottom: 10,
    gap: SP.xs,
  },
  orderTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
  },
  orderNum: {
    fontSize: FS.sm,
    fontFamily: FONT.bold,
    color: PURPLE_LIGHT,
    flex: 1,
  },
  orderDate: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: SUBTLE,
    marginLeft: 'auto',
  },
  customerName: {
    fontSize: FS.base,
    fontFamily: FONT.medium,
    color: FG,
  },
  itemsSummary: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  orderBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SP.xs,
  },
  itemCount: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: SUBTLE,
    flex: 1,
  },
  bottomRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
  },
  orderTotal: {
    fontSize: FS.base,
    fontFamily: FONT.bold,
    color: FG,
  },
  actionBtn: {
    minWidth: 80,
  },
});
