/**
 * Brandthread Inventory Hub — Full screen with 7 tabs.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, ScrollView, FlatList, TouchableOpacity,
  TextInput, StyleSheet, RefreshControl, ActivityIndicator, Alert, Share,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import {
  BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM,
  ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD,
  GRAD_PRIMARY, GRAD_CARD_GLOW, FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import {
  BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton,
  IconButton, FilterChip, StatusBadge, SectionHeader,
  EmptyState, StatCard, SearchBar,
} from '@/components/BrandthreadUI';
import {
  getInventoryOverview, getInventoryItems, searchInventory, filterInventory,
  getAlerts, getTransfers, getIncoming, getCounts, getEvents,
  getValuation, dismissAlert, exportInventoryCsv,
} from '@/services/inventoryService';
import {
  InventoryItem, InventoryOverview, InventoryAlert, InventoryTransfer,
  IncomingInventory, InventoryCount, InventoryFilterKey,
} from '@/services/inventoryTypes';

// ─── Types ────────────────────────────────────────────────────────────────────

type TabKey = 'overview' | 'products' | 'alerts' | 'transfers' | 'incoming' | 'counts' | 'history';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview',   label: 'Overview'  },
  { key: 'products',   label: 'Products'  },
  { key: 'alerts',     label: 'Alerts'    },
  { key: 'transfers',  label: 'Transfers' },
  { key: 'incoming',   label: 'Incoming'  },
  { key: 'counts',     label: 'Counts'    },
  { key: 'history',    label: 'History'   },
];

const FILTER_CHIPS: { key: InventoryFilterKey; label: string }[] = [
  { key: 'all',          label: 'All'          },
  { key: 'available',    label: 'Available'    },
  { key: 'low_stock',    label: 'Low Stock'    },
  { key: 'out_of_stock', label: 'Out of Stock' },
  { key: 'incoming',     label: 'Incoming'     },
  { key: 'reserved',     label: 'Reserved'     },
  { key: 'pre_order',    label: 'Pre-order'    },
  { key: 'damaged',      label: 'Damaged'      },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtMoney(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function itemStatusColor(status: string): string {
  switch (status) {
    case 'available':    return SUCCESS;
    case 'low_stock':    return ORANGE;
    case 'out_of_stock': return RED;
    case 'pre_order':    return BLUE;
    case 'incoming':     return CYAN;
    case 'reserved':     return PURPLE;
    case 'damaged':      return RED;
    default:             return MUTED;
  }
}

function itemStatusVariant(status: string): 'success' | 'warning' | 'error' | 'info' | 'purple' | 'neutral' {
  switch (status) {
    case 'available':    return 'success';
    case 'low_stock':    return 'warning';
    case 'out_of_stock': return 'error';
    case 'pre_order':    return 'info';
    case 'incoming':     return 'info';
    case 'reserved':     return 'purple';
    case 'damaged':      return 'error';
    default:             return 'neutral';
  }
}

function transferStatusColor(status: string): string {
  switch (status) {
    case 'draft':        return SUBTLE;
    case 'ready':        return CYAN;
    case 'in_transit':   return BLUE;
    case 'received':     return SUCCESS;
    case 'discrepancy':  return RED;
    case 'cancelled':    return MUTED;
    default:             return MUTED;
  }
}

function transferStatusVariant(status: string): 'neutral' | 'info' | 'success' | 'error' | 'warning' {
  switch (status) {
    case 'draft':               return 'neutral';
    case 'ready':               return 'info';
    case 'in_transit':          return 'info';
    case 'partially_received':  return 'warning';
    case 'received':            return 'success';
    case 'discrepancy':         return 'error';
    case 'cancelled':           return 'neutral';
    default:                    return 'neutral';
  }
}

function incomingStatusVariant(status: string): 'neutral' | 'info' | 'success' | 'error' | 'warning' | 'purple' {
  switch (status) {
    case 'planned':          return 'neutral';
    case 'ordered':          return 'info';
    case 'in_production':    return 'info';
    case 'ready_to_ship':    return 'warning';
    case 'in_transit':       return 'purple';
    case 'received':         return 'success';
    case 'delayed':          return 'error';
    default:                 return 'neutral';
  }
}

function incomingSourceVariant(source: string): 'purple' | 'info' | 'neutral' {
  switch (source) {
    case 'manufacturer': return 'purple';
    case 'purchase_order': return 'info';
    default:             return 'neutral';
  }
}

function eventTypeColor(type: string): string {
  switch (type) {
    case 'adjustment':           return PURPLE;
    case 'reservation':          return ORANGE;
    case 'reservation_released': return SUCCESS;
    case 'fulfillment':          return CYAN;
    case 'return_restock':       return SUCCESS;
    case 'transfer_in':          return BLUE;
    case 'transfer_out':         return ORANGE;
    case 'production_received':  return SUCCESS;
    case 'count_adjustment':     return CYAN;
    default:                     return MUTED;
  }
}

function eventTypeLabel(type: string): string {
  switch (type) {
    case 'adjustment':           return 'Adjustment';
    case 'reservation':          return 'Reserved';
    case 'reservation_released': return 'Released';
    case 'fulfillment':          return 'Fulfilled';
    case 'return_restock':       return 'Return Restocked';
    case 'transfer_in':          return 'Transfer In';
    case 'transfer_out':         return 'Transfer Out';
    case 'production_received':  return 'Production Received';
    case 'incoming_received':    return 'Incoming Received';
    case 'count_adjustment':     return 'Count Adjustment';
    case 'oversell':             return 'Oversell';
    case 'pre_order_committed':  return 'Pre-order Committed';
    default:                     return type;
  }
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function InventoryScreen() {
  const colors = useColors();
  const { theme } = useAppTheme();
  const router = useRouter();
  const { userId } = useAuth();
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [overview, setOverview] = useState<InventoryOverview | null>(null);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [filtered, setFiltered] = useState<InventoryItem[]>([]);
  const [alerts, setAlerts] = useState<InventoryAlert[]>([]);
  const [transfers, setTransfers] = useState<InventoryTransfer[]>([]);
  const [incoming, setIncoming] = useState<IncomingInventory[]>([]);
  const [counts, setCounts] = useState<InventoryCount[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<InventoryFilterKey>('all');

  const loadData = useCallback(async () => {
    if (!userId) {
      setOverview(null);
      setItems([]);
      setFiltered([]);
      setAlerts([]);
      setTransfers([]);
      setIncoming([]);
      setCounts([]);
      setEvents([]);
      setLoadError(false);
      setLoading(false);
      setHasLoadedOnce(true);
      return;
    }
    try {
      const [ov, its, alrts, trfs, inc, cnts, evts] = await Promise.all([
        getInventoryOverview(),
        getInventoryItems(),
        getAlerts(),
        getTransfers(),
        getIncoming(),
        getCounts(),
        getEvents(),
      ]);
      setOverview(ov ?? null);
      const safeIts = Array.isArray(its) ? its : [];
      setItems(safeIts);
      setFiltered(filterInventory(safeIts, activeFilter));
      setAlerts(Array.isArray(alrts) ? alrts : []);
      setTransfers(Array.isArray(trfs) ? trfs : []);
      setIncoming(Array.isArray(inc) ? inc : []);
      setCounts(Array.isArray(cnts) ? cnts : []);
      setEvents(Array.isArray(evts) ? evts : []);
      setLoadError(false);
    } catch (e) {
      // Keep whatever inventory we already loaded — never wipe good data or
      // show a fake empty state just because a background refresh failed.
      setLoadError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setHasLoadedOnce(true);
    }
  }, [activeFilter, userId]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const handleRetryInitialLoad = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    loadData();
  }, [loadData]);

  const handleSearch = useCallback(async (q: string) => {
    setSearchQuery(q);
    const results = await searchInventory(q);
    setFiltered(filterInventory(Array.isArray(results) ? results : [], activeFilter));
  }, [activeFilter]);

  const handleFilter = useCallback((f: InventoryFilterKey) => {
    setActiveFilter(f);
    setFiltered(filterInventory(items, f));
  }, [items]);

  const handleExport = useCallback(async () => {
    try {
      const csv = await exportInventoryCsv();
      await Share.share({ message: csv, title: 'Inventory export' });
    } catch {
      Alert.alert("Couldn't export inventory", 'Check your connection and try again.');
    }
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [loadData]);

  // ─── Header ────────────────────────────────────────────────────────────────

  const renderHeader = () => (
    <View style={[s.header, { paddingTop: insets.top + SP.sm }]}>
      <TouchableOpacity
        onPress={() => goBackOr(router)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={0.75}
        style={{ width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center' as const, justifyContent: 'center' as const }}
      >
        <Feather name="arrow-left" size={ICON.sm} color={FG} />
      </TouchableOpacity>
      <Text style={[s.headerTitle, { flex: 1, marginLeft: SP.sm }]}>Inventory</Text>
      <View style={s.headerActions}>
        <IconButton name="search" onPress={() => setActiveTab('products')} />
        <IconButton name="download" onPress={handleExport} />
        <TouchableOpacity
          style={s.addBtn}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push('/inventory-adjust' as never);
          }}
          activeOpacity={0.8}
        >
          <LinearGradient colors={theme.primaryGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.addBtnGrad}>
            <Feather name="plus" size={ICON.sm} color={theme.onAccent} />
            <Text style={[s.addBtnText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Add</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ─── Tab Bar ────────────────────────────────────────────────────────────────

  const renderTabBar = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={s.tabBar}
      contentContainerStyle={s.tabBarContent}
    >
      {TABS.map(tab => {
        const isActive = activeTab === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            onPress={() => {
              Haptics.selectionAsync();
              setActiveTab(tab.key);
            }}
            style={s.tab}
            activeOpacity={0.7}
          >
            <Text style={[s.tabLabel, isActive && s.tabLabelActive]}>{tab.label}</Text>
            {isActive && <View style={s.tabUnderline} />}
            {tab.key === 'alerts' && alerts.length > 0 && (
              <View style={s.tabBadge}>
                <Text style={s.tabBadgeText}>{alerts.length}</Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  // ─── TAB: OVERVIEW ──────────────────────────────────────────────────────────

  const renderOverview = () => {
    if (!overview) return <ActivityIndicator color={PURPLE} style={{ marginTop: SP.xl }} />;

    if (items.length === 0 && alerts.length === 0 && incoming.length === 0) {
      return (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[s.tabContent, { flexGrow: 1 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={PURPLE} />}
        >
          <EmptyState
            icon="package"
            title="No products yet"
            description="Add your first product to start tracking stock levels, locations and alerts."
            action={{ label: 'Add product', onPress: () => router.push('/add-product' as never), icon: 'plus' }}
          />
        </ScrollView>
      );
    }

    const stats = [
      { label: 'On Hand',       value: String(overview.totalOnHand),                  color: FG,      filter: null },
      { label: 'Available',     value: String(overview.totalAvailable),                color: SUCCESS, filter: 'available' as InventoryFilterKey },
      { label: 'Reserved',      value: String(overview.totalReserved),                 color: ORANGE,  filter: 'reserved' as InventoryFilterKey },
      { label: 'Incoming',      value: String(overview.totalIncoming),                 color: CYAN,    filter: 'incoming' as InventoryFilterKey },
      { label: 'Pre-order',     value: String(overview.totalCommitted),                color: BLUE,    filter: 'pre_order' as InventoryFilterKey },
      { label: 'Low Stock',     value: String(overview.lowStockCount),                 color: overview.lowStockCount > 0 ? ORANGE : MUTED, filter: 'low_stock' as InventoryFilterKey },
      { label: 'Out of Stock',  value: String(overview.outOfStockCount),               color: overview.outOfStockCount > 0 ? RED : MUTED, filter: 'out_of_stock' as InventoryFilterKey },
      { label: 'Inv. Value',    value: fmtMoney(overview.inventoryValueCents),         color: GOLD,    filter: null },
    ];

    return (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.tabContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={PURPLE} />}
      >
        {/* Stat grid */}
        <View style={s.statGrid}>
          {stats.map(stat => (
            <TouchableOpacity
              key={stat.label}
              style={s.statCell}
              activeOpacity={stat.filter ? 0.75 : 1}
              onPress={() => {
                if (stat.filter) {
                  setActiveTab('products');
                  handleFilter(stat.filter);
                }
              }}
            >
              <BrandthreadCard style={s.statCardInner}>
                <Text style={[s.statValue, { color: stat.color }]}>{stat.value}</Text>
                <Text style={s.statLabel}>{stat.label}</Text>
              </BrandthreadCard>
            </TouchableOpacity>
          ))}
        </View>

        {/* Locations strip */}
        <View style={s.locRow}>
          <TouchableOpacity
            style={s.locChip}
            onPress={() => router.push('/inventory-location' as never)}
            activeOpacity={0.8}
          >
            <Feather name="map-pin" size={ICON.xs} color={CYAN} />
            <Text style={s.locChipText}>{overview.locationCount} locations</Text>
            <Feather name="chevron-right" size={ICON.xs} color={MUTED} />
          </TouchableOpacity>
        </View>

        {/* Quick actions */}
        <View style={s.quickActions}>
          {[
            { label: '+ Adjust Stock', icon: 'edit-3' as const, route: '/inventory-adjust', color: PURPLE },
            { label: 'Transfer',     icon: 'shuffle'  as const, route: '/inventory-transfer', color: CYAN },
            { label: 'Incoming',    icon: 'package'  as const, route: '/inventory-incoming', color: BLUE },
            { label: 'Count',       icon: 'clipboard' as const, route: '/inventory-count',   color: ORANGE },
          ].map(action => (
            <TouchableOpacity
              key={action.label}
              style={[s.quickAction, { borderColor: action.color + '44' }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push(action.route as never);
              }}
              activeOpacity={0.8}
            >
              <Feather name={action.icon} size={ICON.sm} color={action.color} />
              <Text style={[s.quickActionLabel, { color: action.color }]}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Alerts preview */}
        {alerts.length > 0 && (
          <View style={s.sectionBlock}>
            <SectionHeader
              title="Low Stock Alerts"
              action={{ label: 'View All →', onPress: () => setActiveTab('alerts') }}
            />
            {alerts.slice(0, 3).map(alert => (
              <BrandthreadCard key={alert.id} style={s.alertPreviewCard}>
                <View style={s.alertPreviewRow}>
                  <View style={s.alertPreviewLeft}>
                    <Text style={s.alertPreviewName} numberOfLines={1}>{alert.productName}</Text>
                    <Text style={s.alertPreviewVariant}>{alert.variantLabel} · {alert.sku}</Text>
                    <Text style={[s.alertPreviewQty, { color: alert.level === 'out_of_stock' ? RED : ORANGE }]}>
                      {alert.available} available
                    </Text>
                  </View>
                  <SecondaryButton
                    label="Restock"
                    small
                    onPress={() => router.push(('/inventory-adjust?itemId=' + alert.itemId) as never)}
                    accent={ORANGE}
                    style={s.alertPreviewBtn}
                  />
                </View>
              </BrandthreadCard>
            ))}
          </View>
        )}

        {/* Incoming preview */}
        {incoming.length > 0 && (
          <View style={s.sectionBlock}>
            <SectionHeader
              title="Incoming Stock"
              action={{ label: 'View All →', onPress: () => setActiveTab('incoming') }}
            />
            {incoming.slice(0, 2).map(inc => (
              <BrandthreadCard key={inc.id} style={s.incomingPreviewCard}>
                <View style={s.incomingPreviewRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.incomingPreviewName} numberOfLines={1}>{inc.productName}</Text>
                    <Text style={s.incomingPreviewMeta}>{inc.variantLabel} · {inc.quantity} units</Text>
                    <Text style={s.incomingPreviewDate}>
                      Expected: {fmtDate(inc.expectedDate)} · {inc.destinationLocationName}
                    </Text>
                  </View>
                  <StatusBadge label={inc.status.replace(/_/g, ' ')} variant={incomingStatusVariant(inc.status)} small />
                </View>
              </BrandthreadCard>
            ))}
          </View>
        )}

        <View style={{ height: SP.xxl + 80 }} />
      </ScrollView>
    );
  };

  // ─── TAB: PRODUCTS ──────────────────────────────────────────────────────────

  const renderInventoryItem = ({ item }: { item: InventoryItem }) => (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => router.push(('/inventory-detail?id=' + item.id) as never)}
      style={s.itemCardWrap}
    >
      <BrandthreadCard style={s.itemCard}>
        <View style={s.itemCardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={s.itemCardName} numberOfLines={1}>{item.productName}</Text>
            <Text style={s.itemCardVariant}>{item.variantLabel} · SKU: {item.sku}</Text>
          </View>
          <StatusBadge
            label={item.status.replace(/_/g, ' ').toUpperCase()}
            variant={itemStatusVariant(item.status)}
            small
          />
        </View>

        <View style={s.itemCardDivider} />

        <View style={s.itemCardStats}>
          <View style={s.itemStat}>
            <Text style={s.itemStatLabel}>On Hand</Text>
            <Text style={s.itemStatValue}>{item.onHand}</Text>
          </View>
          <View style={s.itemStat}>
            <Text style={s.itemStatLabel}>Available</Text>
            <Text style={[s.itemStatValue, { color: SUCCESS }]}>{item.available}</Text>
          </View>
          <View style={s.itemStat}>
            <Text style={s.itemStatLabel}>Reserved</Text>
            <Text style={[s.itemStatValue, { color: ORANGE }]}>{item.reserved}</Text>
          </View>
          <View style={s.itemStat}>
            <Text style={s.itemStatLabel}>Incoming</Text>
            <Text style={[s.itemStatValue, { color: CYAN }]}>{item.incoming}</Text>
          </View>
        </View>

        <Text style={s.itemCardMeta}>
          Value: {fmtMoney(item.inventoryValueCents)} · Threshold: {item.lowStockThreshold}
        </Text>

        <View style={s.itemCardDivider} />

        <View style={s.itemCardActions}>
          <SecondaryButton
            label="Adjust"
            small
            icon="edit-3"
            onPress={() => router.push(('/inventory-adjust?itemId=' + item.id) as never)}
            style={s.itemActionBtn}
          />
          <SecondaryButton
            label="View Detail →"
            small
            onPress={() => router.push(('/inventory-detail?id=' + item.id) as never)}
            accent={CYAN}
            style={s.itemActionBtn}
          />
        </View>
      </BrandthreadCard>
    </TouchableOpacity>
  );

  const renderProducts = () => (
    <View style={{ flex: 1 }}>
      <View style={s.searchRow}>
        <SearchBar
          value={searchQuery}
          onChange={handleSearch}
          placeholder="Search products, SKUs, barcodes…"
          style={s.searchBar}
        />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.chipBar}
        contentContainerStyle={s.chipBarContent}
      >
        {FILTER_CHIPS.map(chip => (
          <FilterChip
            key={chip.key}
            label={chip.label}
            active={activeFilter === chip.key}
            onPress={() => handleFilter(chip.key)}
          />
        ))}
      </ScrollView>
      <FlatList
        data={filtered}
        keyExtractor={i => i.id}
        renderItem={renderInventoryItem}
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          items.length === 0 && !searchQuery && activeFilter === 'all' ? (
            <EmptyState
              icon="package"
              title="No products yet"
              description="Add your first product to start tracking stock levels, locations and alerts."
              action={{ label: 'Add product', onPress: () => router.push('/add-product' as never), icon: 'plus' }}
            />
          ) : (
            <EmptyState
              icon="package"
              title="No items found"
              description="Try adjusting your search or filter."
            />
          )
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={PURPLE} />}
      />
    </View>
  );

  // ─── TAB: ALERTS ────────────────────────────────────────────────────────────

  const renderAlerts = () => {
    if (alerts.length === 0) {
      return (
        <ScrollView contentContainerStyle={s.tabContent}>
          <EmptyState
            icon="bell"
            title="No active alerts"
            description="Your inventory levels look healthy. Alerts will appear here when stock drops below your thresholds."
          />
        </ScrollView>
      );
    }
    return (
      <FlatList
        data={alerts}
        keyExtractor={a => a.id}
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={PURPLE} />}
        renderItem={({ item: alert }) => {
          const glowColors: readonly [string, string] =
            alert.level === 'out_of_stock' ? [RED_DIM, 'rgba(248,113,113,0.04)'] :
            alert.level === 'critical'     ? [RED_DIM, 'rgba(248,113,113,0.02)'] :
                                             [ORANGE_DIM, 'rgba(249,115,22,0.02)'];
          return (
            <GradientCard colors={glowColors} style={s.alertCard}>
              <View style={s.alertCardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={s.alertCardName}>{alert.productName}</Text>
                  <Text style={s.alertCardVariant}>{alert.variantLabel} · {alert.sku}</Text>
                </View>
                <StatusBadge
                  label={alert.level.replace(/_/g, ' ').toUpperCase()}
                  variant={alert.level === 'out_of_stock' || alert.level === 'critical' ? 'error' : 'warning'}
                  small
                />
              </View>
              <View style={s.alertCardBody}>
                <Text style={[s.alertQty, { color: alert.level === 'out_of_stock' ? RED : ORANGE }]}>
                  Available: {alert.available} units
                </Text>
                <Text style={s.alertMeta}>
                  Threshold: {alert.threshold} · {alert.daysOfStockEstimate !== null ? `~${alert.daysOfStockEstimate} days of stock` : 'Out of stock'}
                </Text>
                {alert.incoming > 0 && (
                  <Text style={[s.alertMeta, { color: CYAN }]}>{alert.incoming} units incoming</Text>
                )}
                <Text style={s.alertSuggested}>Suggested restock: {alert.suggestedRestockQty} units</Text>
              </View>
              <View style={s.alertCardActions}>
                <SecondaryButton
                  label="Restock"
                  small
                  icon="plus"
                  onPress={() => router.push(('/inventory-adjust?itemId=' + alert.itemId) as never)}
                  accent={ORANGE}
                  style={s.alertBtn}
                />
                <SecondaryButton
                  label="Set alert level"
                  small
                  onPress={() => router.push(('/inventory-detail?id=' + alert.itemId) as never)}
                  accent={PURPLE}
                  style={s.alertBtn}
                />
                <SecondaryButton
                  label="Dismiss"
                  small
                  onPress={async () => {
                    await dismissAlert(alert.id);
                    loadData();
                  }}
                  accent={MUTED}
                  style={s.alertBtn}
                />
              </View>
            </GradientCard>
          );
        }}
      />
    );
  };

  // ─── TAB: TRANSFERS ─────────────────────────────────────────────────────────

  const renderTransfers = () => (
    <View style={{ flex: 1 }}>
      <View style={s.tabActionBar}>
        <PrimaryButton
          label="+ New Transfer"
          onPress={() => router.push('/inventory-transfer' as never)}
          icon="shuffle"
          small
          style={s.tabActionBtn}
        />
      </View>
      {transfers.length === 0 ? (
        <EmptyState
          icon="shuffle"
          title="No transfers yet"
          description="Move stock between your inventory locations."
          action={{ label: 'Start Transfer', onPress: () => router.push('/inventory-transfer' as never), icon: 'plus' }}
        />
      ) : (
        <FlatList
          data={transfers}
          keyExtractor={t => t.id}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={PURPLE} />}
          renderItem={({ item: t }) => (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => router.push(('/inventory-transfer?id=' + t.id) as never)}
            >
              <BrandthreadCard style={s.transferCard}>
                <View style={s.transferCardHeader}>
                  <Text style={s.transferNumber}>{t.transferNumber}</Text>
                  <View style={s.transferBadges}>
                    {t.hasDiscrepancy && (
                      <StatusBadge label="DISCREPANCY" variant="error" small />
                    )}
                    <StatusBadge
                      label={t.status.replace(/_/g, ' ').toUpperCase()}
                      variant={transferStatusVariant(t.status)}
                      small
                    />
                  </View>
                </View>
                <View style={s.transferRoute}>
                  <Text style={s.transferLocation}>{t.sourceLocationName}</Text>
                  <Feather name="arrow-right" size={ICON.xs} color={CYAN} style={s.transferArrow} />
                  <Text style={s.transferLocation}>{t.destinationLocationName}</Text>
                </View>
                <Text style={s.transferMeta}>
                  {t.items.length} item{t.items.length !== 1 ? 's' : ''} ·{' '}
                  {t.items.reduce((s, i) => s + i.quantitySent, 0)} units · Created {fmtDate(t.createdAt)}
                </Text>
                {t.expectedArrival && (
                  <Text style={s.transferMeta}>Expected: {fmtDate(t.expectedArrival)}</Text>
                )}
                {t.shippedAt && (
                  <Text style={s.transferMeta}>Shipped: {fmtDate(t.shippedAt)}</Text>
                )}
              </BrandthreadCard>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );

  // ─── TAB: INCOMING ──────────────────────────────────────────────────────────

  const renderIncoming = () => (
    <View style={{ flex: 1 }}>
      <View style={s.tabActionBar}>
        <PrimaryButton
          label="+ Add Incoming"
          onPress={() => router.push('/inventory-incoming' as never)}
          icon="package"
          small
          style={s.tabActionBtn}
        />
      </View>
      {incoming.length === 0 ? (
        <EmptyState
          icon="package"
          title="No incoming stock"
          description="Production and restock shipments will appear here."
          action={{ label: 'Add Incoming', onPress: () => router.push('/inventory-incoming' as never), icon: 'plus' }}
        />
      ) : (
        <FlatList
          data={incoming}
          keyExtractor={i => i.id}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={PURPLE} />}
          renderItem={({ item: inc }) => (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => router.push(('/inventory-incoming?id=' + inc.id) as never)}
            >
              <BrandthreadCard style={s.incomingCard}>
                <View style={s.incomingCardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.incomingCardName} numberOfLines={1}>{inc.productName}</Text>
                    <Text style={s.incomingCardVariant}>{inc.variantLabel} · {inc.quantity} units</Text>
                  </View>
                  <View style={s.incomingBadges}>
                    <StatusBadge
                      label={inc.source.replace(/_/g, ' ')}
                      variant={incomingSourceVariant(inc.source)}
                      small
                    />
                    <StatusBadge
                      label={inc.status.replace(/_/g, ' ')}
                      variant={incomingStatusVariant(inc.status)}
                      small
                    />
                  </View>
                </View>
                <Text style={s.incomingCardMeta}>
                  Expected: {fmtDate(inc.expectedDate)} · {inc.destinationLocationName}
                </Text>
                {inc.manufacturerName && (
                  <Text style={s.incomingCardMeta}>Manufacturer: {inc.manufacturerName}</Text>
                )}
              </BrandthreadCard>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );

  // ─── TAB: COUNTS ────────────────────────────────────────────────────────────

  const renderCounts = () => (
    <View style={{ flex: 1 }}>
      <View style={s.tabActionBar}>
        <PrimaryButton
          label="+ New Count"
          onPress={() => router.push('/inventory-count' as never)}
          icon="clipboard"
          small
          style={s.tabActionBtn}
        />
      </View>
      {counts.length === 0 ? (
        <EmptyState
          icon="clipboard"
          title="No inventory counts"
          description="Create a count to verify your physical inventory."
          action={{ label: 'Start Count', onPress: () => router.push('/inventory-count' as never), icon: 'plus' }}
        />
      ) : (
        <FlatList
          data={counts}
          keyExtractor={c => c.id}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={PURPLE} />}
          renderItem={({ item: count }) => (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => router.push(('/inventory-count?id=' + count.id) as never)}
            >
              <BrandthreadCard style={s.countCard}>
                <View style={s.countCardHeader}>
                  <Text style={s.countNumber}>{count.countNumber}</Text>
                  <View style={s.countBadges}>
                    <View style={s.countTypeChip}>
                      <Text style={s.countTypeText}>{count.type.replace(/_/g, ' ')}</Text>
                    </View>
                    <StatusBadge
                      label={count.status.replace(/_/g, ' ')}
                      variant={
                        count.status === 'completed' ? 'success' :
                        count.status === 'review_needed' ? 'warning' :
                        count.status === 'in_progress' ? 'info' : 'neutral'
                      }
                      small
                    />
                  </View>
                </View>
                <Text style={s.countMeta}>
                  {count.countedItems} of {count.totalItems} items counted · {count.discrepancyCount} discrepanc{count.discrepancyCount !== 1 ? 'ies' : 'y'}
                </Text>
                <Text style={s.countMeta}>Created {fmtDate(count.createdAt)}</Text>
                {count.completedAt && (
                  <Text style={s.countMeta}>Completed {fmtDate(count.completedAt)}</Text>
                )}
              </BrandthreadCard>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );

  // ─── TAB: HISTORY ───────────────────────────────────────────────────────────

  const renderHistory = () => {
    if (events.length === 0) {
      return (
        <EmptyState
          icon="clock"
          title="No history yet"
          description="Inventory events will appear here."
        />
      );
    }
    return (
      <FlatList
        data={events}
        keyExtractor={e => e.id}
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={PURPLE} />}
        renderItem={({ item: evt }) => {
          const dotColor = eventTypeColor(evt.type);
          const qChange = evt.quantityChanged;
          const changeColor = qChange >= 0 ? SUCCESS : RED;
          const changeStr = (qChange >= 0 ? '+' : '') + qChange;
          return (
            <View style={s.eventRow}>
              <View style={[s.eventDot, { backgroundColor: dotColor }]} />
              <View style={s.eventBody}>
                <View style={s.eventTopRow}>
                  <Text style={s.eventProduct} numberOfLines={1}>
                    {evt.productName} · {evt.variantLabel}
                  </Text>
                  <Text style={[s.eventChange, { color: changeColor }]}>{changeStr}</Text>
                </View>
                <Text style={s.eventType}>{eventTypeLabel(evt.type)}</Text>
                <Text style={s.eventMeta}>
                  {evt.quantityBefore} → {evt.quantityAfter} · {evt.reason}
                </Text>
                <Text style={s.eventSource}>{evt.source} · {fmtDate(evt.createdAt)}</Text>
                {evt.relatedOrderId && (
                  <Text style={s.eventRef}>Order: {evt.relatedOrderId}</Text>
                )}
                {evt.relatedTransferId && (
                  <Text style={s.eventRef}>Transfer: {evt.relatedTransferId}</Text>
                )}
              </View>
            </View>
          );
        }}
      />
    );
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (loading && !hasLoadedOnce) {
    return (
      <View style={s.loadingWrap}>
        <ActivityIndicator color={PURPLE} size="large" />
        <Text style={s.loadingText}>Loading inventory…</Text>
      </View>
    );
  }

  // First load failed outright and we have nothing cached to show — a full
  // error state with Retry, never an endless spinner.
  if (loadError && items.length === 0 && !overview) {
    return (
      <View style={s.loadingWrap}>
        <EmptyState
          icon="alert-circle"
          title="Couldn't load inventory"
          description="Check your connection and try again."
          action={{ label: 'Retry', onPress: handleRetryInitialLoad, icon: 'refresh-cw' }}
        />
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: 'transparent' }]}>
      {renderHeader()}
      {renderTabBar()}
      {loadError && (
        <TouchableOpacity style={s.retryBanner} onPress={handleRetryInitialLoad} activeOpacity={0.8}>
          <Feather name="alert-circle" size={14} color={RED} />
          <Text style={s.retryBannerText}>Couldn’t refresh inventory. Tap to try again.</Text>
        </TouchableOpacity>
      )}
      <View style={s.content}>
        {activeTab === 'overview'   && renderOverview()}
        {activeTab === 'products'   && renderProducts()}
        {activeTab === 'alerts'     && renderAlerts()}
        {activeTab === 'transfers'  && renderTransfers()}
        {activeTab === 'incoming'   && renderIncoming()}
        {activeTab === 'counts'     && renderCounts()}
        {activeTab === 'history'    && renderHistory()}
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const SP_MD = SP.md;
const SP_SM = SP.sm;

const s = StyleSheet.create({
  root:             { flex: 1 },
  loadingWrap:      { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', gap: SP.md },
  loadingText:      { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },

  retryBanner:      { flexDirection: 'row', alignItems: 'center', gap: SP.xs,
                      marginHorizontal: SP.md, marginTop: SP.sm, padding: SP.sm,
                      borderRadius: RADIUS.md, borderWidth: 1, borderColor: RED, backgroundColor: CARD },
  retryBannerText:  { fontSize: FS.xs, fontFamily: FONT.medium, color: RED, flex: 1 },

  // Header
  header:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                      paddingHorizontal: SP.md, paddingBottom: SP.sm, backgroundColor: BG },
  headerTitle:      { fontSize: FS.xxl, fontFamily: FONT.bold, color: FG, letterSpacing: -0.5 },
  headerActions:    { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  addBtn:           { borderRadius: RADIUS.md, overflow: 'hidden' },
  addBtnGrad:       { flexDirection: 'row', alignItems: 'center', gap: 5,
                      paddingHorizontal: SP.md, paddingVertical: SP.sm },
  addBtnText:       { fontSize: FS.sm, fontFamily: FONT.bold, color: '#fff' },

  // Tab bar
  tabBar:           { backgroundColor: SURFACE, flexGrow: 0, borderBottomWidth: 1, borderBottomColor: BORDER },
  tabBarContent:    { paddingHorizontal: SP.md, gap: SP.md },
  tab:              { paddingVertical: SP.sm + 2, position: 'relative', alignItems: 'center' },
  tabLabel:         { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  tabLabelActive:   { color: FG, fontFamily: FONT.semibold },
  tabUnderline:     { position: 'absolute', bottom: 0, left: 0, right: 0, height: 2,
                      backgroundColor: PURPLE, borderRadius: RADIUS.pill },
  tabBadge:         { position: 'absolute', top: 4, right: -10, backgroundColor: RED,
                      borderRadius: RADIUS.pill, minWidth: 16, height: 16,
                      alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  tabBadgeText:     { fontSize: FS.xs, fontFamily: FONT.bold, color: '#fff' },

  content:          { flex: 1 },
  tabContent:       { paddingHorizontal: SP.md, paddingTop: SP.md },
  listContent:      { paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: 120 },

  // Stat grid
  statGrid:         { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  statCell:         { width: '47.5%' },
  statCardInner:    { gap: 4, padding: SP.md },
  statValue:        { fontSize: FS.xl, fontFamily: FONT.bold, letterSpacing: -0.5 },
  statLabel:        { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },

  // Locations row
  locRow:           { marginTop: SP.md, flexDirection: 'row' },
  locChip:          { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: CYAN_DIM,
                      borderRadius: RADIUS.pill, paddingHorizontal: SP.md, paddingVertical: 7,
                      borderWidth: 1 },
  locChipText:      { fontSize: FS.sm, fontFamily: FONT.medium, color: CYAN },

  // Quick actions
  quickActions:     { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginTop: SP.md },
  quickAction:      { flex: 1, minWidth: '44%', flexDirection: 'row', alignItems: 'center',
                      gap: SP.sm, backgroundColor: CARD, borderRadius: RADIUS.md,
                      borderWidth: 1, padding: SP.sm + 2 },
  quickActionLabel: { fontSize: FS.xs, fontFamily: FONT.semibold },

  // Section blocks
  sectionBlock:     { marginTop: SP.lg },

  // Alert preview (overview)
  alertPreviewCard: { marginBottom: SP.sm, padding: SP.sm + 2 },
  alertPreviewRow:  { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  alertPreviewLeft: { flex: 1 },
  alertPreviewName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  alertPreviewVariant: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  alertPreviewQty:  { fontSize: FS.sm, fontFamily: FONT.bold, marginTop: 2 },
  alertPreviewBtn:  { minWidth: 80 },

  // Incoming preview (overview)
  incomingPreviewCard: { marginBottom: SP.sm, padding: SP.sm + 2 },
  incomingPreviewRow:  { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  incomingPreviewName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  incomingPreviewMeta: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  incomingPreviewDate: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginTop: 2 },

  // Products tab
  searchRow:        { padding: SP.md, paddingBottom: SP.sm },
  searchBar:        {},
  chipBar:          { flexGrow: 0 },
  chipBarContent:   { paddingHorizontal: SP.md, gap: SP.sm, paddingBottom: SP.sm },

  // Item card
  itemCardWrap:     { marginBottom: SP.sm },
  itemCard:         { gap: 0 },
  itemCardHeader:   { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: SP.sm },
  itemCardName:     { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  itemCardVariant:  { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  itemCardDivider:  { height: 1, backgroundColor: BORDER, marginVertical: SP.sm },
  itemCardStats:    { flexDirection: 'row', gap: SP.md },
  itemStat:         { flex: 1, alignItems: 'center' },
  itemStatLabel:    { fontSize: FS.xs, fontFamily: FONT.medium, color: SUBTLE, marginBottom: 2 },
  itemStatValue:    { fontSize: FS.sm, fontFamily: FONT.bold, color: FG },
  itemCardMeta:     { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginTop: SP.xs },
  itemCardActions:  { flexDirection: 'row', gap: SP.sm },
  itemActionBtn:    { flex: 1 },

  // Alerts tab
  alertCard:        { marginBottom: SP.sm },
  alertCardHeader:  { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, marginBottom: SP.sm },
  alertCardName:    { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  alertCardVariant: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  alertCardBody:    { gap: 4, marginBottom: SP.sm },
  alertQty:         { fontSize: FS.md, fontFamily: FONT.bold },
  alertMeta:        { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  alertSuggested:   { fontSize: FS.xs, fontFamily: FONT.medium, color: PURPLE_LIGHT },
  alertCardActions: { flexDirection: 'row', gap: SP.sm },
  alertBtn:         { flex: 1 },

  // Tab action bar
  tabActionBar:     { padding: SP.md, paddingBottom: SP.sm },
  tabActionBtn:     {},

  // Transfer card
  transferCard:     { marginBottom: SP.sm },
  transferCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.sm },
  transferNumber:   { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  transferBadges:   { flexDirection: 'row', gap: SP.xs },
  transferRoute:    { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.xs },
  transferLocation: { fontSize: FS.sm, fontFamily: FONT.medium, color: FG },
  transferArrow:    {},
  transferMeta:     { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },

  // Incoming card
  incomingCard:     { marginBottom: SP.sm },
  incomingCardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, marginBottom: SP.xs },
  incomingCardName: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  incomingCardVariant: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  incomingBadges:   { flexDirection: 'row', gap: SP.xs, flexWrap: 'wrap', justifyContent: 'flex-end' },
  incomingCardMeta: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },

  // Count card
  countCard:        { marginBottom: SP.sm },
  countCardHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.xs },
  countNumber:      { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  countBadges:      { flexDirection: 'row', gap: SP.xs, alignItems: 'center' },
  countTypeChip:    { backgroundColor: PURPLE_DIM, borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 3 },
  countTypeText:    { fontSize: FS.xs, fontFamily: FONT.medium, color: PURPLE_LIGHT },
  countMeta:        { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },

  // Event row
  eventRow:         { flexDirection: 'row', gap: SP.sm, paddingVertical: SP.sm,
                      borderBottomWidth: 1, borderBottomColor: BORDER },
  eventDot:         { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  eventBody:        { flex: 1, gap: 2 },
  eventTopRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eventProduct:     { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, flex: 1 },
  eventChange:      { fontSize: FS.sm, fontFamily: FONT.bold },
  eventType:        { fontSize: FS.xs, fontFamily: FONT.medium, color: PURPLE_LIGHT },
  eventMeta:        { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  eventSource:      { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  eventRef:         { fontSize: FS.xs, fontFamily: FONT.regular, color: CYAN },
});
