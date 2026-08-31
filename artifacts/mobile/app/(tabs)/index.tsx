import React, { useState, useEffect, useRef, useCallback } from 'react';
import AIBrainFAB from '@/components/AIBrainFAB';
import StripeConnectWarning from '@/components/StripeConnectWarning';
import { View, Text, ScrollView, StyleSheet, Animated, Modal, TextInput, FlatList, Alert, Pressable, Linking } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/hooks/useApi';
import { getSetupState, markSetupStarted, dismissWelcome, completionPercent, nextTask, nextBestAction, dismissTip, markFeatureOpened, type SetupState } from '@/lib/setupStore';
import { deriveHubStats, deriveInventoryStats, deriveOrderStats } from '@/lib/sellerDashboardStats';
import { AnimatedEntrance, BrandthreadScreen, BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton, IconButton, SearchBar, StatCard, QuickActionCard, SectionHeader, ProgressCard, NavigationCard, GuidedTip, NewFeatureBadge, LoadingSkeleton, EmptyState, StatusBadge, PressableScale } from '@/components/BrandthreadUI';
import { BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_SUBTLE, BORDER_ACTIVE, FG, MUTED, SUBTLE, SUCCESS, GREEN_BRIGHT, BLUE, ORANGE, RED, GOLD, FONT, FS, SP, RADIUS, COMP, ICON, ANIM, PURPLE, PURPLE_LIGHT, PURPLE_DIM } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { reportNetworkError } from '@/lib/networkNotice';
import { useRevenueCat } from '@/lib/revenueCat';
import { getBillingRecoveryTarget, isSubscriptionPaymentRecoveryRequired } from '@/lib/subscriptionRecovery';
import { initFromStorage, subscribe } from '@/lib/orderBadgeStore';
import { getSellerOrderBadgeCount, openSellerOrders } from '@/lib/sellerOrderBadge';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function orderStatusVariant(status: string): 'success' | 'info' | 'warning' | 'error' | 'neutral' | 'purple' {
  switch (status) {
    case 'shipped':
    case 'delivered': return 'success';
    case 'new': return 'info';
    case 'processing': return 'purple';
    case 'ready_to_ship': return 'warning';
    case 'refunded': return 'error';
    default: return 'neutral';
  }
}

function orderStatusLabel(status: string): string {
  switch (status) {
    case 'ready_to_ship': return 'Ready';
    case 'processing': return 'Processing';
    case 'new': return 'New';
    case 'shipped': return 'Shipped';
    case 'delivered': return 'Delivered';
    case 'refunded': return 'Refunded';
    default: return status;
  }
}

function timeAgo(dateStr: string): string {
  const parts = dateStr.split(' ');
  if (parts.length >= 2) {
    const month = parts[0];
    const day = parseInt(parts[1].replace(',', ''));
    const now = new Date();
    const orderDate = new Date(`${month} ${day}, ${now.getFullYear()}`);
    const diffMs = now.getTime() - orderDate.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return '1d ago';
    return `${diffDays}d ago`;
  }
  return dateStr;
}

type RevenueTrendPoint = { day: string; totalCents: number };

function getTrendSummary(points: RevenueTrendPoint[]): {
  direction: 'up' | 'down' | 'flat';
  label: string;
} | null {
  if (points.length < 2) return null;
  const windowSize = Math.floor(points.length / 2);
  const earlier = points.slice(0, windowSize).reduce((sum, point) => sum + point.totalCents, 0);
  const recent = points.slice(-windowSize).reduce((sum, point) => sum + point.totalCents, 0);

  if (earlier === 0) {
    return recent > 0
      ? { direction: 'up', label: 'Up from no earlier sales' }
      : { direction: 'flat', label: 'No movement yet' };
  }

  const change = ((recent - earlier) / earlier) * 100;
  if (Math.abs(change) < 0.5) return { direction: 'flat', label: 'Holding steady' };
  return {
    direction: change > 0 ? 'up' : 'down',
    label: `${change > 0 ? 'Up' : 'Down'} ${Math.abs(change).toFixed(0)}% vs earlier days`,
  };
}

function normalizeRevenueTrend(rows: unknown[]): RevenueTrendPoint[] {
  if (rows.length === 0) return [];
  const totalsByDay = new Map<string, number>();

  rows.forEach((row) => {
    if (!row || typeof row !== 'object') throw new Error('Invalid revenue trend response.');
    const candidate = row as { day?: unknown; date?: unknown; total_cents?: unknown };
    const day = typeof candidate.day === 'string'
      ? candidate.day
      : typeof candidate.date === 'string'
        ? candidate.date
        : '';
    const totalCents = candidate.total_cents;
    const date = new Date(day);
    if (!day || Number.isNaN(date.getTime()) || !Number.isSafeInteger(totalCents)) {
      throw new Error('Invalid revenue trend response.');
    }
    const key = date.toISOString().slice(0, 10);
    totalsByDay.set(key, (totalsByDay.get(key) ?? 0) + (totalCents as number));
  });

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - (6 - index));
    const key = date.toISOString().slice(0, 10);
    return { day: key, totalCents: totalsByDay.get(key) ?? 0 };
  });
}

function trendDateRange(points: RevenueTrendPoint[]): string {
  if (points.length === 0) return 'Last 7 days';
  const start = new Date(points[0].day);
  const end = new Date(points[points.length - 1].day);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Last 7 days';
  const format = (date: Date) => date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return `${format(start)} – ${format(end)}`;
}

function RevenueTrendChart({
  points,
  loading,
  error,
  accent,
  accentLight,
}: {
  points: RevenueTrendPoint[] | null;
  loading: boolean;
  error: boolean;
  accent: string;
  accentLight: string;
}) {
  const animation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    animation.setValue(0);
    if (points && points.length > 0) {
      Animated.timing(animation, {
        toValue: 1,
        duration: 700,
        useNativeDriver: false,
      }).start();
    }
    return () => animation.stopAnimation();
  }, [animation, points]);

  if (error) {
    return (
      <View style={s.revenueChartEmpty}>
        <Feather name="alert-circle" size={16} color={ORANGE} />
        <Text style={s.revenueChartEmptyText}>Revenue trend unavailable</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={s.revenueChart}>
        {Array.from({ length: 7 }).map((_, index) => (
          <View key={index} style={s.revenueBarColumn}>
            <View style={[s.revenueBarTrack, { height: 84 }]}>
              <View style={[s.revenueBar, { height: 28, backgroundColor: accent, opacity: 0.14 }]} />
            </View>
            <Text style={s.revenueDay}>—</Text>
          </View>
        ))}
      </View>
    );
  }

  if (!points || points.length === 0) {
    return (
      <View style={s.revenueChartEmpty}>
        <Feather name="bar-chart-2" size={16} color={SUBTLE} />
        <Text style={s.revenueChartEmptyText}>No sales in this period yet</Text>
      </View>
    );
  }

  const maxCents = Math.max(...points.map((point) => point.totalCents), 1);
  const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <View style={s.revenueChart}>
      {points.map((point, index) => {
        const date = new Date(point.day);
        const isToday = point.day.slice(0, 10) === today;
        const dayLabel = Number.isNaN(date.getTime()) ? '·' : (dayLabels[date.getUTCDay()] ?? '·');
        const targetHeight = point.totalCents === 0
          ? 0
          : Math.max(8, (point.totalCents / maxCents) * 84);
        return (
          <View key={`${point.day}-${index}`} style={s.revenueBarColumn}>
            <View style={s.revenueBarTrack}>
              <Animated.View
                style={[
                  s.revenueBar,
                  {
                    height: animation.interpolate({ inputRange: [0, 1], outputRange: [4, targetHeight] }),
                    minHeight: targetHeight === 0 ? 0 : 4,
                    backgroundColor: isToday ? accentLight : accent,
                    opacity: isToday ? 1 : 0.62,
                  },
                ]}
              />
            </View>
            <Text style={[s.revenueDay, isToday && { color: accentLight }]}>{dayLabel}</Text>
          </View>
        );
      })}
    </View>
  );
}

// ─── Command Menu items ────────────────────────────────────────────────────────

const COMMAND_ITEMS = [
  { label: 'Create product',    icon: 'package'      as const, route: '/(tabs)/products' },
  { label: 'Create design',     icon: 'pen-tool'     as const, route: '/(tabs)/studio'   },
  { label: 'Create post',       icon: 'video'        as const, route: '/create-post'     },
  { label: 'View orders',       icon: 'shopping-bag' as const, route: '/(tabs)/orders'   },
  { label: 'Manufacturer Hub',  icon: 'package'      as const, route: '/manufacturer-hub' },
  { label: 'Inventory',         icon: 'layers'       as const, route: '/inventory'        },
  { label: 'Store Builder',     icon: 'layout'       as const, route: '/store-builder'    },
  { label: 'Analytics',         icon: 'bar-chart-2'  as const, route: '/(tabs)/analytics' },
  { label: 'Settings',          icon: 'settings'     as const, route: '/settings'  },
];

// ─── Default setup state ──────────────────────────────────────────────────────

const DEFAULT_SETUP: SetupState = {
  started: false,
  dismissed: false,
  currentStep: null,
  tasks: [],
  dismissedTips: [],
  openedFeatures: [],
  lastUpdated: Date.now(),
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SellerHomeScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();

  const api = useApi();
  const { managementURL } = useRevenueCat();
  const [loading, setLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [setupState, setSetupState] = useState<SetupState>(DEFAULT_SETUP);
  // Real per-seller dashboard stats — null while loading or on error.
  // No fake/seed fallback: chips show '—' until real data arrives.
  const [dashStats, setDashStats] = useState<{
    revenueCents: number;
    orders: number;
    storefrontVisits: number;
    completedOrders: number;
  } | null>(null);
  const [dashStatsError, setDashStatsError] = useState(false);
  const [searchModal, setSearchModal] = useState(false);
  const [commandModal, setCommandModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [hubStats, setHubStats] = useState<{
    activeQuotes: number;
    samplesNeedingReview: number;
    activeProduction: number;
    unreadMessages: number;
  } | null>(null);
  const [orderStats, setOrderStats] = useState<{
    newOrders: number;
    toProcess: number;
    readyToShip: number;
  } | null>(null);
  const [unseenOrderCount, setUnseenOrderCount] = useState(() =>
    getSellerOrderBadgeCount(userId),
  );
  const [invStats, setInvStats] = useState<{
    lowStockCount: number;
    outOfStockCount: number;
    incomingCount: number;
    delayedCount: number;
  } | null>(null);
  // ── Dashboard visual upgrade state ────────────────────────────────────────
  const [recentOrders, setRecentOrders] = useState<any[] | null>(null);
  const [searchProducts, setSearchProducts] = useState<any[]>([]);
  const [searchOrders, setSearchOrders] = useState<any[]>([]);
  const [payoutInfo,   setPayoutInfo]   = useState<any | null>(null);
  const [salesTrend,   setSalesTrend]   = useState<Array<{ day: string; totalCents: number }> | null>(null);
  const [salesTrendError, setSalesTrendError] = useState(false);
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
  const [subscriptionProvider, setSubscriptionProvider] = useState<'stripe' | 'revenuecat' | 'none'>('none');
  const [billingPortalLoading, setBillingPortalLoading] = useState(false);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const dashboardScrollY = useRef(new Animated.Value(0)).current;

  // Keep the home orders row in sync with the Orders tab's per-seller badge.
  // Hydrating here also covers direct home-screen entry before the tab bar's
  // first poll has completed.
  useEffect(() => {
    if (!userId) {
      setUnseenOrderCount(0);
      return;
    }

    let active = true;
    const syncCount = () => {
      if (active) setUnseenOrderCount(getSellerOrderBadgeCount(userId));
    };

    syncCount();
    const unsubscribe = subscribe(syncCount);
    initFromStorage(userId).then(syncCount);

    return () => {
      active = false;
      unsubscribe();
    };
  }, [userId]);

  // ── Load setup state ──────────────────────────────────────────────────────
  const loadSetup = useCallback(async () => {
    const state = await getSetupState();
    setSetupState(state);
    setLoading(false);
    const pct = completionPercent(state);
    Animated.timing(progressAnim, {
      toValue: pct / 100,
      duration: ANIM.slow,
      useNativeDriver: false,
    }).start();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadSetup();
    }, 0);
    // Show skeleton for at least 500ms
    const minLoad = setTimeout(() => {}, 500);
    setStatsError(false);
    setDashStatsError(false);
    setSalesTrendError(false);
    setDashStats(null);
    setSalesTrend(null);
    // ── Real per-seller dashboard stats (revenue, orders, conversion rate) ──
    api.analytics.dashboard().then((data: any) => {
      const revenueCents = data?.revenue?.totalCents;
      const orders = data?.orders?.total;
      const storefrontVisits = data?.storefrontVisits;
      const completedOrders = data?.completedOrders;
      if (
        !Number.isSafeInteger(revenueCents)
        || !Number.isSafeInteger(orders)
        || !Number.isSafeInteger(storefrontVisits)
        || !Number.isSafeInteger(completedOrders)
      ) {
        throw new Error('Invalid dashboard analytics response.');
      }
      setDashStats({
        revenueCents,
        orders,
        storefrontVisits,
        completedOrders,
      });
      setDashStatsError(false);
    }).catch((error) => {
      // Leave dashStats as null — chips show '—' rather than a fabricated number
      setDashStats(null);
      setDashStatsError(true);
      setStatsError(true);
      reportNetworkError(error, () => setRetryKey(key => key + 1));
    });
    // Optional operational summaries use authenticated server data only.
    // A plan-gated/unavailable hub stays hidden rather than falling back to demo records.
    Promise.all([
      api.sellerHub.quoteRequests.list(),
      api.manufacturers.sampleOrders.list(),
      api.manufacturers.threads.list(),
    ]).then(([quotes, samples, threads]: any[]) => {
      setHubStats(deriveHubStats(
        Array.isArray(quotes) ? quotes : [],
        Array.isArray(samples) ? samples : [],
        Array.isArray(threads) ? threads : [],
      ));
    }).catch(() => setHubStats(null));
    api.inventory.list().then((rows: any) => {
      setInvStats(deriveInventoryStats(Array.isArray(rows) ? rows : []));
    }).catch((error) => {
      setInvStats(null);
      setStatsError(true);
      reportNetworkError(error, () => setRetryKey(key => key + 1));
    });
    // ── Dashboard visual upgrade: hero card + trend chart + real orders ──
    api.finance.balance().then((data: any) => {
      setPayoutInfo(data && typeof data === 'object' ? data : null);
    }).catch((error) => {
      setPayoutInfo(null);
      setStatsError(true);
      reportNetworkError(error, () => setRetryKey(key => key + 1));
    });
    api.orders.list().then((rows: any) => {
      const list = Array.isArray(rows) ? rows : [];
      setOrderStats(deriveOrderStats(list));
      setRecentOrders(list.slice(0, 3));
      setSearchOrders(list);
    }).catch((error) => {
      setOrderStats(null);
      setRecentOrders(null);
      setStatsError(true);
      reportNetworkError(error, () => setRetryKey(key => key + 1));
    });
    api.products.list().then((rows: any) => {
      setSearchProducts(Array.isArray(rows) ? rows : []);
    }).catch((error) => {
      setSearchProducts([]);
      setStatsError(true);
      reportNetworkError(error, () => setRetryKey(key => key + 1));
    });
    api.analytics.revenue('last7').then((data: any) => {
      if (!data || typeof data !== 'object' || !Array.isArray(data.daily)) {
        throw new Error('Invalid revenue analytics response.');
      }
      setSalesTrend(normalizeRevenueTrend(data.daily));
      setSalesTrendError(false);
    }).catch((error) => {
      setSalesTrend(null);
      setSalesTrendError(true);
      setStatsError(true);
      reportNetworkError(error, () => setRetryKey(key => key + 1));
    });
    return () => { clearTimeout(timer); clearTimeout(minLoad); };
  // The Clerk getToken function can be re-instantiated by the Expo web preview.
  // retryKey is the only intentional reload trigger for this page-wide fetch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey]);

  // Subscription status is checked whenever the seller returns to the home
  // screen so a renewal failure is visible without requiring a full reload.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      setSubscriptionStatus(null);
      setSubscriptionProvider('none');
      api.seller.subscription.status()
        .then((data) => {
          if (active) {
            setSubscriptionStatus(data?.status ?? null);
            setSubscriptionProvider(data?.effectiveProvider ?? 'none');
          }
        })
        .catch(() => {
          // Keep the current banner state when the status check is transiently unavailable.
        });
      return () => {
        active = false;
      };
    }, [api]),
  );

  // ── Derived values ────────────────────────────────────────────────────────
  const pct = completionPercent(setupState);
  const nextT = nextTask(setupState);
  const nba = nextBestAction(setupState);
  const showWelcome = !setupState.started && !setupState.dismissed;
  const showProgress = setupState.started && pct < 100;

  // ── Search results ────────────────────────────────────────────────────────
  const q = searchQuery.toLowerCase().trim();
  const productResults = q
    ? searchProducts.filter(p => String(p.name ?? '').toLowerCase().includes(q))
    : [];
  const orderResults = q
    ? searchOrders.filter(o =>
        String(o.orderNumber ?? '').toLowerCase().includes(q) ||
        String(o.customer?.name ?? o.customerName ?? '').toLowerCase().includes(q)
      )
    : [];

  // ── Handlers ──────────────────────────────────────────────────────────────
  function nav(route: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as never);
  }

  function handleOpenOrders() {
    openSellerOrders(userId, nav);
  }

  async function handleOpenBillingPortal() {
    if (billingPortalLoading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBillingPortalLoading(true);
    try {
      const target = getBillingRecoveryTarget(subscriptionProvider, managementURL);
      if (target === 'revenuecat') {
        await Linking.openURL(managementURL!);
        return;
      }
      if (target === 'subscription') {
        router.push('/subscription' as never);
        return;
      }
      const { url } = await api.seller.subscription.portal();
      await Linking.openURL(url);
    } catch (error: any) {
      Alert.alert(
        'Billing portal unavailable',
        error?.message ?? 'Could not open the billing portal. Please try again.',
      );
    } finally {
      setBillingPortalLoading(false);
    }
  }

  async function handleStartSetup() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const next = await markSetupStarted();
    setSetupState(next);
    Animated.timing(progressAnim, {
      toValue: completionPercent(next) / 100,
      duration: ANIM.slow,
      useNativeDriver: false,
    }).start();
  }

  async function handleDismissWelcome() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = await dismissWelcome();
    setSetupState(next);
  }

  function closeCommand() {
    setCommandModal(false);
  }

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: BG }}>
        <View style={[s.header, { paddingTop: insets.top + 8 }]}>
          <View style={{ gap: 4 }}>
            <LoadingSkeleton height={12} style={{ width: 100 }} />
            <LoadingSkeleton height={24} style={{ width: 160, marginTop: 4 }} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <LoadingSkeleton height={40} style={{ width: 40, borderRadius: RADIUS.sm }} />
            <LoadingSkeleton height={40} style={{ width: 40, borderRadius: RADIUS.sm }} />
          </View>
        </View>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: SP.md, gap: 12, paddingBottom: 160 }}
          showsVerticalScrollIndicator={false}
        >
          <LoadingSkeleton height={120} />
          <LoadingSkeleton height={80} />
          <LoadingSkeleton height={100} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <LoadingSkeleton height={90} style={{ flex: 1 }} />
            <LoadingSkeleton height={90} style={{ flex: 1 }} />
            <LoadingSkeleton height={90} style={{ flex: 1 }} />
            <LoadingSkeleton height={90} style={{ flex: 1 }} />
          </View>
        </ScrollView>
      </View>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: BG }}>

      {/* ── Fixed Header ─────────────────────────────────────────────────── */}
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <View>
          <Text style={s.greetSmall}>{greeting()}</Text>
          <Text style={s.brandName}>Brandthread</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <IconButton
            name="search"
            onPress={() => { setSearchQuery(''); setSearchModal(true); }}
          />
          <IconButton
            name="bell"
            badge
            onPress={() => Alert.alert('Notifications', 'No new notifications.')}
          />
        </View>
      </View>

      {/* The full balance hero scrolls naturally; this compact summary takes
          over beneath the app header once the hero leaves the viewport. */}
      <Animated.View
        pointerEvents="box-none"
        style={[
          s.compactBalanceWrap,
          {
            height: dashboardScrollY.interpolate({
              inputRange: [72, 132],
              outputRange: [0, 52],
              extrapolate: 'clamp',
            }),
            opacity: dashboardScrollY.interpolate({
              inputRange: [84, 126],
              outputRange: [0, 1],
              extrapolate: 'clamp',
            }),
          },
        ]}
      >
        <PressableScale
          style={[s.compactBalance, { borderColor: theme.accentDim }]}
          onPress={() => nav('/payouts')}
          accessibilityLabel={`Available balance ${payoutInfo?.available?.formatted ?? 'loading'}. Open payouts`}
        >
          <View style={[s.compactBalanceIcon, { backgroundColor: theme.accentDim }]}>
            <Feather name="credit-card" size={15} color={theme.accent} />
          </View>
          <Text style={s.compactBalanceLabel}>Available</Text>
          <Text style={s.compactBalanceValue}>
            {payoutInfo === null ? '· · ·' : (payoutInfo?.available?.formatted ?? '$0.00')}
          </Text>
          <Feather name="chevron-right" size={16} color={MUTED} />
        </PressableScale>
      </Animated.View>

      {/* ── Scrollable Content ───────────────────────────────────────────── */}
      <Animated.ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 160 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: dashboardScrollY } } }],
          { useNativeDriver: false },
        )}
      >

        {/* ── Revenue command center ─────────────────────────────────────── */}
        {(() => {
          const trend = salesTrend ? getTrendSummary(salesTrend) : null;
          const trendColor = trend?.direction === 'down' ? RED : trend?.direction === 'up' ? GREEN_BRIGHT : MUTED;
          return (
            <AnimatedEntrance style={{ paddingHorizontal: SP.md, paddingTop: SP.md, marginBottom: SP.md }}>
              <PressableScale
                style={s.revenueHero}
                onPress={() => nav('/(tabs)/analytics')}
                accessibilityRole="button"
                accessibilityLabel="Open revenue analytics"
              >
                <View style={s.revenueHeroHeader}>
                  <View style={s.revenueHeroEyebrow}>
                    <View style={[s.revenueLiveDot, { backgroundColor: dashStatsError ? ORANGE : GREEN_BRIGHT }]} />
                    <Text style={s.revenueEyebrowText}>BUSINESS PULSE</Text>
                  </View>
                  <View style={s.revenueAnalyticsLink}>
                    <Text style={[s.revenueAnalyticsText, { color: theme.accentLight }]}>Analytics</Text>
                    <Feather name="arrow-up-right" size={14} color={theme.accentLight} />
                  </View>
                </View>

                <View style={s.revenueHeadlineRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.revenueLabel}>Revenue</Text>
                    <Text style={s.revenueValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.64}>
                      {dashStats === null ? '—' : formatCents(dashStats.revenueCents)}
                    </Text>
                    <Text style={s.revenueContext}>
                      {dashStatsError ? 'Live revenue is unavailable' : dashStats === null ? 'Loading live revenue…' : 'All time'}
                    </Text>
                  </View>
                  {trend && (
                    <View style={[
                      s.revenueTrendPill,
                      {
                        borderColor: trend?.direction === 'flat' ? BORDER : `${trendColor}66`,
                        backgroundColor: trend?.direction === 'flat' ? 'rgba(255,255,255,0.06)' : `${trendColor}16`,
                      },
                    ]}>
                      <Feather
                        name={trend.direction === 'up' ? 'trending-up' : trend.direction === 'down' ? 'trending-down' : 'minus'}
                        size={15}
                        color={trendColor}
                      />
                      <Text style={[s.revenueTrendText, { color: trendColor }]}>{trend.label}</Text>
                    </View>
                  )}
                </View>

                <View style={s.revenueChartHeader}>
                  <Text style={s.revenueChartTitle}>Revenue trend</Text>
                  <Text style={s.revenueChartDate}>{trendDateRange(salesTrend ?? [])}</Text>
                </View>
                <RevenueTrendChart
                  points={salesTrend}
                  loading={salesTrend === null && !salesTrendError}
                  error={salesTrendError}
                  accent={theme.accent}
                  accentLight={theme.accentLight}
                />

                <View style={s.revenueMetricsRow}>
                  <View style={s.revenueMetric}>
                    <Text style={s.revenueMetricValue}>{dashStats === null ? '—' : String(dashStats.orders)}</Text>
                    <Text style={s.revenueMetricLabel}>Orders</Text>
                  </View>
                  <View style={s.revenueMetricDivider} />
                  <View style={s.revenueMetric}>
                    <Text style={s.revenueMetricValue}>{dashStats === null ? '—' : String(dashStats.storefrontVisits)}</Text>
                    <Text style={s.revenueMetricLabel}>Visitors</Text>
                  </View>
                  <View style={s.revenueMetricDivider} />
                  <View style={s.revenueMetric}>
                    <Text style={s.revenueMetricValue}>
                      {dashStats === null || dashStats.storefrontVisits === 0
                        ? '—'
                        : `${(dashStats.completedOrders / dashStats.storefrontVisits * 100).toFixed(1)}%`}
                    </Text>
                    <Text style={s.revenueMetricLabel}>Conversion</Text>
                  </View>
                </View>
              </PressableScale>
            </AnimatedEntrance>
          );
        })()}

        {/* ── Hero Card: Available Balance + Next Payout ───────────────── */}
        <AnimatedEntrance style={{ paddingHorizontal: SP.md, paddingTop: SP.md, marginBottom: SP.sm }}>
          <LinearGradient
            colors={theme.heroGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[s.heroCard, { shadowColor: theme.shadowColor }]}
          >
            <View style={s.heroTop}>
              <View>
                <Text style={s.heroLabel}>Available Balance</Text>
                <Text style={s.heroBalance}>
                  {payoutInfo === null
                    ? '· · ·'
                    : (payoutInfo?.available?.formatted ?? '$0.00')}
                </Text>
              </View>
              <PressableScale
                style={s.heroPayoutsBtn}
                onPress={() => nav('/payouts')}
              >
                <Text style={s.heroPayoutsBtnTxt}>Payouts</Text>
                <Feather name="arrow-right" size={11} color="rgba(255,255,255,0.75)" />
              </PressableScale>
            </View>
            <View style={s.heroBottom}>
              <Feather
                name={payoutInfo?.nextPayout ? 'clock' : 'info'}
                size={12}
                color="rgba(255,255,255,0.5)"
              />
              <Text style={s.heroNextTxt}>
                {payoutInfo === null
                  ? 'Loading…'
                  : payoutInfo?.nextPayout
                    ? (() => {
                        const arr = payoutInfo.nextPayout.estimatedArrival
                          ?? payoutInfo.nextPayout.estimated_arrival;
                        const dateStr = arr
                          ? new Date(arr * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          : 'auto-schedule';
                        return `Next payout ${payoutInfo.nextPayout.formatted} · ${dateStr}`;
                      })()
                    : payoutInfo?.connected
                      ? 'No pending payouts'
                      : 'Connect Stripe to enable payouts'}
              </Text>
            </View>
          </LinearGradient>
        </AnimatedEntrance>

        {/* ── Stripe Connect Warning Banner ────────────────────────────── */}
        <StripeConnectWarning />

        {/* ── Subscription payment failure ─────────────────────────────── */}
        {isSubscriptionPaymentRecoveryRequired(subscriptionStatus) && (
          <Pressable
            style={s.paymentFailureBanner}
            onPress={handleOpenBillingPortal}
            disabled={billingPortalLoading}
            accessibilityRole="button"
            accessibilityLabel="Payment failed. Update your card to keep your features."
            testID="seller-payment-failure-banner"
          >
            <View style={s.paymentFailureIcon}>
              <Feather name="credit-card" size={16} color={RED} />
            </View>
            <View style={s.paymentFailureCopy}>
              <Text style={s.paymentFailureTitle}>Payment failed</Text>
              <Text style={s.paymentFailureBody}>Payment failed — update your card to keep your features.</Text>
            </View>
            {billingPortalLoading ? (
              <Text style={s.paymentFailureAction}>Opening…</Text>
            ) : (
              <>
                <Text style={s.paymentFailureAction}>Update card</Text>
                <Feather name="chevron-right" size={16} color={RED} />
              </>
            )}
          </Pressable>
        )}

        {/* ── Stats Error Banner ────────────────────────────────────────── */}
        {statsError && (
          <PressableScale
            style={{ marginHorizontal: SP.md, marginBottom: SP.sm, flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: 'rgba(249,115,22,0.1)', borderRadius: RADIUS.md, padding: SP.sm, borderWidth: 1, borderColor: 'rgba(249,115,22,0.25)' }}
            onPress={() => { setRetryKey(key => key + 1); }}
          >
            <Feather name="alert-triangle" size={14} color={ORANGE} />
            <Text style={{ flex: 1, fontSize: FS.xs, fontFamily: FONT.regular, color: ORANGE }}>Some live data is unavailable — tap to retry</Text>
          </PressableScale>
        )}

        {/* ── Welcome Card ──────────────────────────────────────────────── */}
        {showWelcome && (
          <AnimatedEntrance delay={ANIM.fast} style={{ paddingHorizontal: SP.md, paddingTop: SP.md, marginBottom: SP.md }}>
            <GradientCard
              colors={[theme.accentDim, theme.secondaryDim]}
              glow
            >
              <Text style={s.welcomeTitle}>Your brand workspace is ready.</Text>
              <Text style={[s.welcomeSub, { marginTop: 6, marginBottom: SP.md }]}>
                Build your first drop, set up your storefront, and start selling.
              </Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <PrimaryButton
                  label="Start setup"
                  onPress={handleStartSetup}
                  small
                  style={{ flex: 1 }}
                />
                <SecondaryButton
                  label="Explore on my own"
                  onPress={handleDismissWelcome}
                  small
                  style={{ flex: 1 }}
                />
              </View>
            </GradientCard>
          </AnimatedEntrance>
        )}


        {/* ── Setup Checklist ──────────────────────────────────────────── */}
        {showProgress && (
          <View style={{ paddingHorizontal: SP.md, marginBottom: SP.md }}>
            <BrandthreadCard>
              {/* Header: title + "X of 9 complete" */}
              <View style={s.checklistHeader}>
                <Text style={s.checklistTitle}>Finish setting up your brand</Text>
                <Text style={s.checklistCount}>
                  {setupState.tasks.filter(t => t.completed).length} of {setupState.tasks.length} complete
                </Text>
              </View>
              {/* Slim animated progress bar */}
              <View style={s.progressTrack}>
                <Animated.View
                  style={[s.progressFill, {
                    width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                  }]}
                />
              </View>
              {/* Checklist rows */}
              <View style={{ marginTop: SP.sm }}>
                {setupState.tasks.map((task, idx) => (
                  <PressableScale
                    key={task.id}
                    style={[s.checkRow, idx < setupState.tasks.length - 1 && s.checkRowBorder]}
                    onPress={() => {
                      if (!task.completed) {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        nav(task.route);
                      }
                    }}
                  >
                    {/* Circle: empty = incomplete, green-filled = done */}
                    <View style={[s.checkCircle, task.completed && s.checkCircleDone]}>
                      {task.completed && <Feather name="check" size={11} color="#fff" />}
                    </View>
                    {/* Label — struck through when complete */}
                    <Text
                      style={[s.checkLabel, task.completed && s.checkLabelDone]}
                      numberOfLines={1}
                    >
                      {task.label}
                    </Text>
                    {/* Optional badge — only when not yet done */}
                    {task.optional && !task.completed && (
                      <View style={s.optionalBadge}>
                        <Text style={s.optionalText}>Optional</Text>
                      </View>
                    )}
                    {/* Chevron on incomplete rows */}
                    {!task.completed && (
                      <Feather name="chevron-right" size={15} color={MUTED} />
                    )}
                  </PressableScale>
                ))}
              </View>
            </BrandthreadCard>
          </View>
        )}

        {/* ── Zone B: Action Zone — Quick Actions (established sellers only) ── */}
        {!showWelcome && !showProgress && (
        <View style={{ paddingHorizontal: SP.md, marginBottom: SP.md }}>
          <SectionHeader title="Quick actions" style={{ paddingHorizontal: 0, marginBottom: SP.sm }} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <QuickActionCard
              label="Create Post"
              icon="video"
              accent={theme.accent}
              badge={!setupState.openedFeatures.includes('create-post')}
              onPress={() => {
                markFeatureOpened('create-post');
                nav('/create-post');
              }}
              style={{ width: '48.5%' }}
            />
            <QuickActionCard
              label="Add Product"
              icon="plus-circle"
              accent={theme.secondary}
              onPress={() => nav('/(tabs)/products')}
              style={{ width: '48.5%' }}
            />
            <QuickActionCard
              label="View Orders"
              icon="shopping-bag"
              accent={BLUE}
              onPress={() => nav('/(tabs)/orders')}
              style={{ width: '48.5%' }}
            />
            <QuickActionCard
              label="Studio"
              icon="zap"
              accent={ORANGE}
              onPress={() => nav('/(tabs)/studio')}
              style={{ width: '48.5%' }}
            />
          </View>
        </View>
        )}

        {/* ── Zone C: Recent Activity (unified — order + inventory + manufacturer) ── */}
        <View style={{ paddingHorizontal: SP.md, marginBottom: SP.md }}>
          <SectionHeader
            title="Recent activity"
            action={{ label: 'View all', onPress: () => nav('/(tabs)/orders') }}
            style={{ paddingHorizontal: 0 }}
          />
          <View style={{ gap: 8 }}>

            {/* Recent orders — real API data, up to 3 */}
            {recentOrders === null ? (
              <LoadingSkeleton height={68} />
            ) : recentOrders.length === 0 ? (
              <GradientCard
                colors={[theme.accentDim, theme.secondaryDim, theme.accentDim]}
                glow
                style={{ marginBottom: 0 }}
              >
                {/* Icon + headline */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm }}>
                  <View style={{
                    width: 40, height: 40, borderRadius: RADIUS.md,
                    backgroundColor: theme.accentDim,
                    borderWidth: 1, borderColor: theme.accent + '59',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Feather name="zap" size={ICON.md} color={theme.accentLight} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: FS.base, fontFamily: FONT.bold, color: FG, letterSpacing: -0.2 }}>
                      Ready for your first drop?
                    </Text>
                    <Text style={{ fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 }}>
                      A few quick moves to get shoppers to your store.
                    </Text>
                  </View>
                </View>
                {/* CTA buttons */}
                <PrimaryButton
                  label="Share Your Store"
                  icon="share-2"
                  small
                  onPress={() => nav('/share-store')}
                  style={{ marginBottom: 8 }}
                />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <SecondaryButton
                    label="Add Product"
                    icon="plus-circle"
                    small
                    onPress={() => nav('/(tabs)/products')}
                    style={{ flex: 1 }}
                  />
                  <SecondaryButton
                    label="Post a Drop"
                    icon="video"
                    small
                    onPress={() => nav('/create-post')}
                    style={{ flex: 1 }}
                  />
                </View>
              </GradientCard>
            ) : recentOrders.map((order: any) => {
              const customerName = order.customerName ?? order.customer?.name ?? order.buyerName ?? 'Unknown';
               const totalCents   = typeof order.totalCents   === 'number' ? order.totalCents
                                  : typeof order.total_cents  === 'number' ? order.total_cents : 0;
              const orderNum     = order.orderNumber ?? order.order_number
                                 ?? `#${String(order.id ?? '').slice(-6).toUpperCase()}`;
              const rawDate      = order.createdAt ?? order.created_at ?? '';
              const dateStr      = rawDate
                ? new Date(rawDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : '';
              return (
                <BrandthreadCard
                  key={order.id}
                  style={{ marginBottom: 0 }}
                  onPress={() => nav(`/order-detail?id=${order.id}`)}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm }}>
                    <View style={s.orderIconCircle}>
                      <Feather name="shopping-bag" size={ICON.sm} color={theme.accentLight} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={s.orderNumber}>{orderNum}</Text>
                        <StatusBadge
                          label={orderStatusLabel(order.status)}
                          variant={orderStatusVariant(order.status)}
                          small
                        />
                        <Text style={[s.orderTime, { marginLeft: 'auto' }]}>{dateStr}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                        <Text style={s.orderCustomer}>{customerName}</Text>
                        <Text style={s.orderTotal}>{formatCents(totalCents)}</Text>
                      </View>
                    </View>
                  </View>
                </BrandthreadCard>
              );
            })}

            {/* Unseen order alert — uses the same per-seller watermark as the
                Orders tab badge, so both touch-points show the same count. */}
            {unseenOrderCount > 0 && (
              <NavigationCard
                label={`${unseenOrderCount} new order${unseenOrderCount > 1 ? 's' : ''} — action needed`}
                icon="shopping-bag"
                accent={BLUE}
                description="Tap to review"
                badge={unseenOrderCount}
                onPress={handleOpenOrders}
              />
            )}
            {unseenOrderCount === 0 && orderStats && orderStats.newOrders === 0 && orderStats.readyToShip > 0 && (
              <NavigationCard
                label={`${orderStats.readyToShip} order${orderStats.readyToShip > 1 ? 's' : ''} ready to ship`}
                icon="truck"
                accent={SUCCESS}
                description="Mark as shipped"
                badge
                onPress={() => nav('/(tabs)/orders')}
              />
            )}

            {/* Inventory alert — out-of-stock takes priority over low-stock */}
            {invStats && invStats.outOfStockCount > 0 && (
              <NavigationCard
                label={`${invStats.outOfStockCount} item${invStats.outOfStockCount > 1 ? 's' : ''} out of stock`}
                icon="alert-circle"
                accent={RED}
                description="Restock now"
                badge
                onPress={() => nav('/inventory')}
              />
            )}
            {invStats && invStats.outOfStockCount === 0 && invStats.lowStockCount > 0 && (
              <NavigationCard
                label={`${invStats.lowStockCount} item${invStats.lowStockCount > 1 ? 's' : ''} running low`}
                icon="trending-down"
                accent={ORANGE}
                description="Review stock levels"
                onPress={() => nav('/inventory')}
              />
            )}

            {/* Manufacturer update — samples take priority over messages */}
            {hubStats && hubStats.samplesNeedingReview > 0 && (
              <NavigationCard
                label={`${hubStats.samplesNeedingReview} sample${hubStats.samplesNeedingReview > 1 ? 's' : ''} need review`}
                icon="package"
                accent={ORANGE}
                description="Open Manufacturer Hub"
                badge
                onPress={() => nav('/manufacturer-hub')}
              />
            )}
            {hubStats && hubStats.samplesNeedingReview === 0 && hubStats.unreadMessages > 0 && (
              <NavigationCard
                label={`${hubStats.unreadMessages} new manufacturer message${hubStats.unreadMessages > 1 ? 's' : ''}`}
                icon="message-circle"
                accent={theme.secondary}
                description="Tap to reply"
                badge
                onPress={() => nav('/manufacturer-hub')}
              />
            )}

          </View>
        </View>

        {/* ── Go to Command Menu trigger ────────────────────────────────── */}
        <PrimaryButton
          label="Go to →"
          icon="command"
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setCommandModal(true);
          }}
          style={{ marginHorizontal: SP.md, marginBottom: SP.lg }}
        />

      </Animated.ScrollView>

      {/* ── Command Menu Modal ────────────────────────────────────────────── */}
      <Modal
        visible={commandModal}
        animationType="slide"
        transparent
        onRequestClose={closeCommand}
      >
        <Pressable style={s.modalOverlay} onPress={closeCommand} />
        <View style={[s.bottomSheet, { paddingBottom: Math.max(insets.bottom, SP.lg) }]}>
          <View style={s.sheetHandle} />
          <Text style={s.commandTitle}>Go to</Text>
          <View style={s.commandGrid}>
            {COMMAND_ITEMS.map((item) => (
              <PressableScale
                key={item.label}
                style={s.commandItem}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  closeCommand();
                  setTimeout(() => nav(item.route), 100);
                }}
              >
                <View style={s.commandIconWrap}>
                  <Feather name={item.icon} size={ICON.md} color={theme.accentLight} />
                </View>
                <Text style={s.commandLabel} numberOfLines={2}>{item.label}</Text>
              </PressableScale>
            ))}
          </View>
        </View>
      </Modal>

      {/* ── Global Search Modal ───────────────────────────────────────────── */}
      <Modal
        visible={searchModal}
        animationType="fade"
        transparent={false}
        onRequestClose={() => setSearchModal(false)}
      >
        <View style={[s.searchScreen, { backgroundColor: BG }]}>
          <View style={[s.searchHeader, { paddingTop: insets.top + 8 }]}>
            <View style={{ flex: 1 }}>
              <SearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search products, orders…"
              />
            </View>
            <PressableScale
              onPress={() => setSearchModal(false)}
              style={s.searchClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={{ fontSize: FS.sm, fontFamily: FONT.medium, color: theme.accentLight }}>Cancel</Text>
            </PressableScale>
          </View>

          <ScrollView
            contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {!q ? (
              /* Empty state: show categories */
              <View style={{ gap: 8, marginTop: SP.md }}>
                <Text style={s.searchSectionTitle}>Browse</Text>
                <NavigationCard label="Products" icon="package" onPress={() => { setSearchModal(false); nav('/(tabs)/products'); }} accent={theme.secondary} />
                <NavigationCard label="Orders" icon="shopping-bag" onPress={() => { setSearchModal(false); nav('/(tabs)/orders'); }} accent={theme.accent} />
                <NavigationCard label="Studio" icon="zap" onPress={() => { setSearchModal(false); nav('/(tabs)/studio'); }} accent={ORANGE} />
                <NavigationCard label="Analytics" icon="bar-chart-2" onPress={() => { setSearchModal(false); nav('/(tabs)/analytics'); }} accent={BLUE} />
              </View>
            ) : (
              <View style={{ gap: SP.md, marginTop: SP.md }}>
                {productResults.length > 0 && (
                  <View style={{ gap: 8 }}>
                    <Text style={s.searchSectionTitle}>Products</Text>
                    {productResults.map((p) => (
                      <NavigationCard
                        key={p.id}
                        label={p.name}
                        icon="package"
                        description={`${p.status}${typeof p.priceCents === 'number' ? ` · ${formatCents(p.priceCents)}` : ''}`}
                        accent={theme.secondary}
                        onPress={() => { setSearchModal(false); nav('/(tabs)/products'); }}
                      />
                    ))}
                  </View>
                )}
                {orderResults.length > 0 && (
                  <View style={{ gap: 8 }}>
                    <Text style={s.searchSectionTitle}>Orders</Text>
                    {orderResults.map((o) => (
                      <NavigationCard
                        key={o.id}
                        label={o.orderNumber}
                        icon="shopping-bag"
                        description={`${o.customer.name} · ${formatCents(o.totalCents)}`}
                        accent={theme.accent}
                        onPress={() => { setSearchModal(false); nav('/(tabs)/orders'); }}
                      />
                    ))}
                  </View>
                )}
                {productResults.length === 0 && orderResults.length === 0 && (
                  <EmptyState
                    icon="search"
                    title="No results"
                    description={`Nothing matched "${searchQuery}". Try a different term.`}
                  />
                )}
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>
      <AIBrainFAB context={{ screen: 'home' as const }} bottomOffset={72} />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
    backgroundColor: BG,
  },
  greetSmall: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
    letterSpacing: 0.1,
  },
  brandName: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.4,
  },

  // Welcome card
  welcomeTitle: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.3,
  },
  welcomeSub: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
    lineHeight: 20,
  },

  // Next best action
  recommendedLabel: {
    fontSize: 10,
    fontFamily: FONT.bold,
    color: SUBTLE,
    letterSpacing: 0.8,
  },
  nbaLabel: {
    fontSize: FS.md,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.2,
  },

  // ── Setup checklist ───────────────────────────────────────────────────────
  checklistHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  checklistTitle: {
    fontSize: FS.base,
    fontFamily: FONT.bold,
    color: FG,
  },
  checklistCount: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: PURPLE_LIGHT,
  },
  // Slim progress bar (still animated via progressAnim ref)
  progressTrack: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 99,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: PURPLE,
    borderRadius: 99,
  },
  // Checklist rows
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
  },
  checkRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  checkCircleDone: {
    backgroundColor: SUCCESS,
    borderColor: SUCCESS,
  },
  checkLabel: {
    flex: 1,
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: FG,
  },
  checkLabelDone: {
    color: MUTED,
    textDecorationLine: 'line-through' as const,
  },
  optionalBadge: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  optionalText: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
  },

  // ── Revenue command center ───────────────────────────────────────────────
  revenueHero: {
    backgroundColor: CARD_ELEVATED,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: BORDER_ACTIVE,
    padding: SP.lg,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  revenueHeroHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SP.lg,
  },
  revenueHeroEyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  revenueLiveDot: {
    width: 7,
    height: 7,
    borderRadius: RADIUS.pill,
  },
  revenueEyebrowText: {
    fontSize: 10,
    fontFamily: FONT.bold,
    color: MUTED,
    letterSpacing: 1.2,
  },
  revenueAnalyticsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  revenueAnalyticsText: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
  },
  revenueHeadlineRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SP.sm,
    marginBottom: SP.lg,
  },
  revenueLabel: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: MUTED,
    marginBottom: 3,
  },
  revenueValue: {
    fontSize: 42,
    lineHeight: 48,
    fontFamily: FONT.extrabold,
    color: FG,
    letterSpacing: -1.5,
  },
  revenueContext: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: SUBTLE,
    marginTop: 2,
  },
  revenueTrendPill: {
    maxWidth: 132,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 4,
  },
  revenueTrendText: {
    flexShrink: 1,
    fontSize: 10,
    lineHeight: 13,
    fontFamily: FONT.semibold,
  },
  revenueChartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SP.sm,
  },
  revenueChartTitle: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: FG,
  },
  revenueChartDate: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  revenueChart: {
    height: 120,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: BORDER_SUBTLE,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    paddingHorizontal: SP.sm,
    paddingTop: SP.sm,
    paddingBottom: 10,
  },
  revenueBarColumn: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  revenueBarTrack: {
    height: 84,
    width: '58%',
    minWidth: 10,
    maxWidth: 22,
    justifyContent: 'flex-end',
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(255,255,255,0.04)',
    overflow: 'hidden',
  },
  revenueBar: {
    width: '100%',
    borderRadius: RADIUS.pill,
  },
  revenueDay: {
    fontSize: 9,
    fontFamily: FONT.bold,
    color: SUBTLE,
    textTransform: 'uppercase' as const,
  },
  revenueChartEmpty: {
    height: 120,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: BORDER_SUBTLE,
  },
  revenueChartEmptyText: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  revenueMetricsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: SP.lg,
  },
  revenueMetric: {
    flex: 1,
    gap: 3,
  },
  revenueMetricDivider: {
    width: 1,
    backgroundColor: BORDER,
    marginHorizontal: SP.sm,
  },
  revenueMetricValue: {
    fontSize: FS.lg,
    fontFamily: FONT.bold,
    color: FG,
  },
  revenueMetricLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
  },

  // Legacy compact stats tokens retained for existing consumers.
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: SP.md,
    marginBottom: SP.md,
    marginTop: SP.sm,
  },
  statChip: {
    flex: 1,
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: SP.sm,
    alignItems: 'center',
    gap: 2,
  },
  statChipWarn: {
    borderColor: 'rgba(249,115,22,0.4)',
  },
  paymentFailureBanner: {
    marginHorizontal: SP.md,
    marginBottom: SP.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderRadius: RADIUS.md,
    padding: SP.sm,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.45)',
  },
  paymentFailureIcon: {
    width: 30,
    height: 30,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239,68,68,0.16)',
  },
  paymentFailureCopy: {
    flex: 1,
    gap: 2,
  },
  paymentFailureTitle: {
    color: RED,
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
  },
  paymentFailureBody: {
    color: FG,
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    lineHeight: 16,
  },
  paymentFailureAction: {
    color: RED,
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
  },
  statChipVal: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    color: FG,
  },
  statChipLbl: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
  },

  // Recent orders
  orderIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: PURPLE_DIM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderNumber: {
    fontSize: FS.sm,
    fontFamily: FONT.bold,
    color: PURPLE_LIGHT,
  },
  orderTime: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: SUBTLE,
  },
  orderCustomer: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: FG,
  },
  orderTotal: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: FG,
  },

  // ── Hero card (gradient balance card) ───────────────────────────────────
  heroCard: {
    borderRadius: RADIUS.lg,
    padding: SP.lg,
    gap: 14,
    shadowOpacity: 0.45,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  heroLabel: {
    fontSize: 11,
    fontFamily: FONT.medium,
    color: 'rgba(255,255,255,0.65)',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  heroBalance: {
    fontSize: 34,
    fontFamily: FONT.bold,
    color: '#FFFFFF',
    letterSpacing: -1.2,
  },
  heroPayoutsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  heroPayoutsBtnTxt: {
    fontSize: 12,
    fontFamily: FONT.semibold,
    color: 'rgba(255,255,255,0.9)',
  },
  heroBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  heroNextTxt: {
    fontSize: 12,
    fontFamily: FONT.regular,
    color: 'rgba(255,255,255,0.6)',
    flex: 1,
  },
  compactBalanceWrap: {
    overflow: 'hidden',
    backgroundColor: BG,
    zIndex: 20,
  },
  compactBalance: {
    height: 44,
    marginHorizontal: SP.md,
    marginTop: 4,
    paddingHorizontal: SP.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    backgroundColor: CARD,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
  },
  compactBalanceIcon: {
    width: 30,
    height: 30,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactBalanceLabel: {
    flex: 1,
    color: MUTED,
    fontFamily: FONT.medium,
    fontSize: FS.xs,
  },
  compactBalanceValue: {
    color: FG,
    fontFamily: FONT.bold,
    fontSize: FS.md,
  },

  // ── 7-day trend chart ────────────────────────────────────────────────────
  trendHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  trendTitle: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: MUTED,
  },
  trendWeekTotal: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: PURPLE_LIGHT,
  },
  trendChart: {
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    paddingHorizontal: SP.sm,
    paddingBottom: 10,
    paddingTop: SP.md,
    height: 90,
  },
  trendBarWrap: {
    flex: 1,
    alignItems: 'center',
    gap: 7,
    justifyContent: 'flex-end',
  },
  trendBar: {
    width: '70%',
    borderRadius: 3,
    minHeight: 4,
  },
  trendDay: {
    fontSize: 9,
    fontFamily: FONT.semibold,
    color: SUBTLE,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
  },

  // Command modal
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: CARD,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SP.lg,
    paddingTop: SP.sm,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignSelf: 'center',
    marginBottom: SP.md,
  },
  commandTitle: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    color: PURPLE_LIGHT,
    marginBottom: SP.md,
  },
  commandGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: SP.md,
  },
  commandItem: {
    width: '30%',
    alignItems: 'center',
    gap: SP.sm,
    backgroundColor: CARD_ELEVATED,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: SP.md,
    paddingHorizontal: SP.sm,
  },
  commandIconWrap: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.sm,
    backgroundColor: PURPLE_DIM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commandLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
    textAlign: 'center',
  },

  // Search modal
  searchScreen: {
    flex: 1,
  },
  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
  },
  searchClose: {
    paddingHorizontal: SP.sm,
    paddingVertical: SP.sm,
  },
  searchSectionTitle: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: SUBTLE,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
});
