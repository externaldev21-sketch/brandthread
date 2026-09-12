import React, { useState, useEffect, useRef, useCallback } from 'react';
import AIBrainFAB from '@/components/AIBrainFAB';
import StripeConnectWarning from '@/components/StripeConnectWarning';
import { View, Text, ScrollView, StyleSheet, Animated, Modal, TextInput, FlatList, Alert, Pressable, TouchableOpacity, Linking, StyleProp, ViewStyle } from 'react-native';
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
import { SellerDashboardKPIGrid } from '@/components/SellerDashboardKPIGrid';
import { BG, SCREEN_BG, SURFACE, CARD, CARD_ELEVATED, CARD_GLASS, CARD_ELEVATED_GLASS, BORDER, BORDER_SUBTLE, BORDER_ACTIVE, FG, MUTED, SUBTLE, SUCCESS, GREEN_BRIGHT, BLUE, ORANGE, RED, GOLD, FONT, FS, SP, RADIUS, COMP, ICON, ANIM, PURPLE, PURPLE_LIGHT, PURPLE_DIM } from '@/lib/theme';
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

type RevenueTrendPoint = { day: string; totalCents: number };

function getTrendSummary(points: RevenueTrendPoint[]): { direction: 'up' | 'down' | 'flat'; label: string; } | null {
  if (points.length < 2) return null;
  const windowSize = Math.floor(points.length / 2);
  const earlier = points.slice(0, windowSize).reduce((sum, point) => sum + point.totalCents, 0);
  const recent = points.slice(-windowSize).reduce((sum, point) => sum + point.totalCents, 0);

  if (earlier === 0) {
    return recent > 0 ? { direction: 'up', label: 'Up from no earlier sales' } : { direction: 'flat', label: 'No movement yet' };
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
    const day = typeof candidate.day === 'string' ? candidate.day : typeof candidate.date === 'string' ? candidate.date : '';
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

// ─── Local Components ─────────────────────────────────────────────────────────

function UnifiedCard({ children, style, onPress, glow = false }: { children: React.ReactNode, style?: StyleProp<ViewStyle>, onPress?: () => void, glow?: boolean }) {
  const { theme } = useAppTheme();
  const cardStyle = [
    s.unifiedCard,
    glow && { shadowColor: theme.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 16, elevation: 8 },
    style
  ];
  return onPress ? <PressableScale onPress={onPress} style={cardStyle}>{children}</PressableScale> : <View style={cardStyle}>{children}</View>;
}

function ListGroup({ children, style }: { children: React.ReactNode, style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.listGroup, style]}>
      {children}
    </View>
  );
}

function ListItem({ icon, title, subtitle, value, onPress, isLast, iconColor = FG, rightElement, badge }: any) {
  const content = (
    <View style={s.listItem}>
       <View style={[s.listIconWrap, { backgroundColor: iconColor + '1A' }]}>
         <Feather name={icon} size={16} color={iconColor} />
       </View>
       <View style={s.listBody}>
         <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
           <Text style={[s.listTitle, subtitle && { marginBottom: 2 }]} numberOfLines={1}>{title}</Text>
           {badge !== undefined && badge > 0 && (
              <View style={{ backgroundColor: RED, borderRadius: 10, paddingHorizontal: 5, paddingVertical: 1 }}>
                <Text style={{ fontSize: 10, fontFamily: FONT.bold, color: '#FFF' }}>{badge > 9 ? '9+' : badge}</Text>
              </View>
           )}
         </View>
         {subtitle && <Text style={s.listSubtitle} numberOfLines={1}>{subtitle}</Text>}
       </View>
       <View style={s.listRight}>
         {value && <Text style={s.listValue}>{value}</Text>}
         {rightElement}
         {onPress && <Feather name="chevron-right" size={16} color={SUBTLE} />}
       </View>
    </View>
  );

  if (onPress) {
    return (
      <>
        <PressableScale onPress={onPress}>{content}</PressableScale>
        {!isLast && <View style={s.listDivider} />}
      </>
    );
  }

  return (
    <>
      {content}
      {!isLast && <View style={s.listDivider} />}
    </>
  );
}

function RevenueTrendChart({ points, loading, error, accent }: { points: RevenueTrendPoint[] | null; loading: boolean; error: boolean; accent: string; }) {
  const animation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    animation.setValue(0);
    if (points && points.length > 0) {
      Animated.timing(animation, { toValue: 1, duration: ANIM.slow, useNativeDriver: false }).start();
    }
    return () => animation.stopAnimation();
  }, [animation, points]);

  if (error) return <View style={s.chartEmpty}><Feather name="alert-circle" size={14} color={ORANGE} /><Text style={s.chartEmptyText}>Trend unavailable</Text></View>;

  if (loading) {
    return (
      <View style={s.chartContainer}>
        {Array.from({ length: 7 }).map((_, i) => (
          <View key={i} style={s.chartBarWrap}>
            <View style={[s.chartBar, { height: '30%', backgroundColor: SUBTLE, opacity: 0.2 }]} />
          </View>
        ))}
      </View>
    );
  }

  if (!points || points.length === 0) return <View style={s.chartEmpty}><Feather name="bar-chart-2" size={14} color={SUBTLE} /><Text style={s.chartEmptyText}>No sales yet</Text></View>;

  const maxCents = Math.max(...points.map((p) => p.totalCents), 1);
  const today = new Date().toISOString().slice(0, 10);
  const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <View style={s.chartContainer}>
      {points.map((point, index) => {
        const isToday = point.day.slice(0, 10) === today;
        const date = new Date(point.day);
        const dayLabel = Number.isNaN(date.getTime()) ? '·' : (dayLabels[date.getUTCDay()] ?? '·');
        const targetHeightPct = point.totalCents === 0 ? 8 : (point.totalCents / maxCents) * 100;
        return (
          <View key={`${point.day}-${index}`} style={s.chartBarWrap}>
            <View style={s.chartBarTrack}>
              <Animated.View
                style={[
                  s.chartBar,
                  {
                    height: animation.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', `${Math.max(8, targetHeightPct)}%`]
                    }),
                    backgroundColor: isToday ? accent : FG,
                    opacity: isToday ? 1 : 0.25,
                  },
                ]}
              />
            </View>
            <Text style={[s.chartDay, isToday && { color: accent }]}>{dayLabel}</Text>
          </View>
        );
      })}
    </View>
  );
}

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

  const [dashStats, setDashStats] = useState<{ revenueCents: number; orders: number; storefrontVisits: number; completedOrders: number; } | null>(null);
  const [dashStatsError, setDashStatsError] = useState(false);
  const [searchModal, setSearchModal] = useState(false);
  const [commandModal, setCommandModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [hubStats, setHubStats] = useState<{ activeQuotes: number; samplesNeedingReview: number; activeProduction: number; unreadMessages: number; } | null>(null);
  const [orderStats, setOrderStats] = useState<{ newOrders: number; toProcess: number; readyToShip: number; } | null>(null);
  const [unseenOrderCount, setUnseenOrderCount] = useState(() => getSellerOrderBadgeCount(userId));
  const [invStats, setInvStats] = useState<{ lowStockCount: number; outOfStockCount: number; incomingCount: number; delayedCount: number; } | null>(null);

  const [recentOrders, setRecentOrders] = useState<any[] | null>(null);
  const [searchProducts, setSearchProducts] = useState<any[]>([]);
  const [searchOrders, setSearchOrders] = useState<any[]>([]);
  const [payoutInfo,   setPayoutInfo]   = useState<any | null>(null);
  const [salesTrend,   setSalesTrend]   = useState<Array<{ day: string; totalCents: number }> | null>(null);
  const [salesTrendError, setSalesTrendError] = useState(false);
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
  const [subscriptionProvider, setSubscriptionProvider] = useState<'stripe' | 'revenuecat' | 'none'>('none');
  const [billingPortalLoading, setBillingPortalLoading] = useState(false);

  const dashboardScrollY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!userId) {
      setUnseenOrderCount(0);
      return;
    }
    let active = true;
    const syncCount = () => { if (active) setUnseenOrderCount(getSellerOrderBadgeCount(userId)); };
    syncCount();
    const unsubscribe = subscribe(syncCount);
    initFromStorage(userId).then(syncCount);
    return () => { active = false; unsubscribe(); };
  }, [userId]);

  const loadSetup = useCallback(async () => {
    const state = await getSetupState();
    setSetupState(state);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { loadSetup(); }, 0);
    const minLoad = setTimeout(() => {}, 500);
    setStatsError(false);
    setDashStatsError(false);
    setSalesTrendError(false);
    setDashStats(null);
    setSalesTrend(null);

    api.analytics.dashboard().then((data: any) => {
      const revenueCents = data?.revenue?.totalCents;
      const orders = data?.orders?.total;
      const storefrontVisits = data?.storefrontVisits;
      const completedOrders = data?.completedOrders;
      if (!Number.isSafeInteger(revenueCents) || !Number.isSafeInteger(orders) || !Number.isSafeInteger(storefrontVisits) || !Number.isSafeInteger(completedOrders)) {
        throw new Error('Invalid dashboard analytics response.');
      }
      setDashStats({ revenueCents, orders, storefrontVisits, completedOrders });
      setDashStatsError(false);
    }).catch((error) => {
      setDashStats(null);
      setDashStatsError(true);
      setStatsError(true);
      reportNetworkError(error, () => setRetryKey(key => key + 1));
    });

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
      if (!data || typeof data !== 'object' || !Array.isArray(data.daily)) throw new Error('Invalid revenue analytics response.');
      setSalesTrend(normalizeRevenueTrend(data.daily));
      setSalesTrendError(false);
    }).catch((error) => {
      setSalesTrend(null);
      setSalesTrendError(true);
      setStatsError(true);
      reportNetworkError(error, () => setRetryKey(key => key + 1));
    });

    return () => { clearTimeout(timer); clearTimeout(minLoad); };
  }, [retryKey]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setSubscriptionStatus(null);
      setSubscriptionProvider('none');
      api.seller.subscription.status().then((data) => {
        if (active) {
          setSubscriptionStatus(data?.status ?? null);
          setSubscriptionProvider(data?.effectiveProvider ?? 'none');
        }
      }).catch(() => {});
      return () => { active = false; };
    }, [api]),
  );

  const pct = completionPercent(setupState);
  const showWelcome = !setupState.started && !setupState.dismissed;
  const showProgress = setupState.started && pct < 100;
  const q = searchQuery.toLowerCase().trim();

  const productResults = q ? searchProducts.filter(p => String(p.name ?? '').toLowerCase().includes(q)) : [];
  const orderResults = q ? searchOrders.filter(o => String(o.orderNumber ?? '').toLowerCase().includes(q) || String(o.customer?.name ?? o.customerName ?? '').toLowerCase().includes(q)) : [];

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
      if (target === 'revenuecat') { await Linking.openURL(managementURL!); return; }
      if (target === 'subscription') { router.push('/subscription' as never); return; }
      const { url } = await api.seller.subscription.portal();
      await Linking.openURL(url);
    } catch (error: any) {
      Alert.alert('Billing portal unavailable', error?.message ?? 'Could not open the billing portal. Please try again.');
    } finally {
      setBillingPortalLoading(false);
    }
  }

  async function handleStartSetup() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const next = await markSetupStarted();
    setSetupState(next);
  }

  async function handleDismissWelcome() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = await dismissWelcome();
    setSetupState(next);
  }

  // ─── Alerts Construction ───────────────────────────────────────────────────
  const alerts = [];
  if (isSubscriptionPaymentRecoveryRequired(subscriptionStatus)) {
    alerts.push({
      id: 'sub-fail',
      icon: 'credit-card',
      color: RED,
      title: 'Payment failed',
      subtitle: 'Update your card to keep your features.',
      rightElement: <Text style={{ color: RED, fontSize: 13, fontFamily: FONT.bold }}>Update</Text>,
      onPress: handleOpenBillingPortal,
      loading: billingPortalLoading,
    });
  }
  if (statsError) {
    alerts.push({
      id: 'stats-error',
      icon: 'alert-triangle',
      color: ORANGE,
      title: 'Live data unavailable',
      subtitle: 'Tap to retry connection',
      onPress: () => setRetryKey(k => k + 1),
    });
  }
  if (unseenOrderCount > 0) {
    alerts.push({
      id: 'unseen-orders',
      icon: 'shopping-bag',
      color: BLUE,
      title: `${unseenOrderCount} new order${unseenOrderCount > 1 ? 's' : ''}`,
      subtitle: 'Action needed — tap to review',
      onPress: handleOpenOrders,
    });
  } else if (orderStats && orderStats.newOrders === 0 && orderStats.readyToShip > 0) {
    alerts.push({
      id: 'ready-orders',
      icon: 'truck',
      color: SUCCESS,
      title: `${orderStats.readyToShip} order${orderStats.readyToShip > 1 ? 's' : ''} ready to ship`,
      subtitle: 'Mark as shipped',
      onPress: () => nav('/(tabs)/orders'),
    });
  }

  if (invStats && invStats.outOfStockCount > 0) {
    alerts.push({
      id: 'inv-out',
      icon: 'alert-circle',
      color: RED,
      title: `${invStats.outOfStockCount} item${invStats.outOfStockCount > 1 ? 's' : ''} out of stock`,
      subtitle: 'Restock now',
      onPress: () => nav('/inventory'),
    });
  } else if (invStats && invStats.lowStockCount > 0) {
    alerts.push({
      id: 'inv-low',
      icon: 'trending-down',
      color: ORANGE,
      title: `${invStats.lowStockCount} item${invStats.lowStockCount > 1 ? 's' : ''} running low`,
      subtitle: 'Review stock levels',
      onPress: () => nav('/inventory'),
    });
  }

  if (hubStats && hubStats.samplesNeedingReview > 0) {
    alerts.push({
      id: 'hub-samples',
      icon: 'package',
      color: ORANGE,
      title: `${hubStats.samplesNeedingReview} sample${hubStats.samplesNeedingReview > 1 ? 's' : ''} need review`,
      subtitle: 'Manufacturer update',
      onPress: () => nav('/manufacturer-hub'),
    });
  } else if (hubStats && hubStats.unreadMessages > 0) {
    alerts.push({
      id: 'hub-msgs',
      icon: 'message-circle',
      color: BLUE,
      title: `${hubStats.unreadMessages} new message${hubStats.unreadMessages > 1 ? 's' : ''}`,
      subtitle: 'Manufacturer update',
      onPress: () => nav('/manufacturer-hub'),
    });
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: SCREEN_BG }}>
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
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: SP.md, gap: SP.xl, paddingBottom: 160 }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            <LoadingSkeleton height={94} style={{ width: '48%', borderRadius: RADIUS.lg }} />
            <LoadingSkeleton height={94} style={{ width: '48%', borderRadius: RADIUS.lg }} />
            <LoadingSkeleton height={94} style={{ width: '48%', borderRadius: RADIUS.lg }} />
            <LoadingSkeleton height={94} style={{ width: '48%', borderRadius: RADIUS.lg }} />
          </View>
          <LoadingSkeleton height={130} style={{ borderRadius: RADIUS.lg }} />
          <LoadingSkeleton height={200} style={{ borderRadius: RADIUS.lg }} />
        </ScrollView>
      </View>
    );
  }

  const trend = salesTrend ? getTrendSummary(salesTrend) : null;
  const trendColor = trend?.direction === 'down' ? RED : trend?.direction === 'up' ? GREEN_BRIGHT : MUTED;

  return (
    <View style={{ flex: 1, backgroundColor: SCREEN_BG }}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <View>
          <Text style={s.greetSmall}>{greeting()}</Text>
          <Text style={s.brandName}>Brandthread</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <IconButton name="search" onPress={() => { setSearchQuery(''); setSearchModal(true); }} />
          <IconButton name="bell" badge={unseenOrderCount > 0} badgeCount={unseenOrderCount} onPress={() => Alert.alert('Notifications', 'No new notifications.')} />
        </View>
      </View>

      <Animated.View
        pointerEvents="box-none"
        style={[
          s.compactBalanceWrap,
          {
            height: dashboardScrollY.interpolate({ inputRange: [72, 132], outputRange: [0, 52], extrapolate: 'clamp' }),
            opacity: dashboardScrollY.interpolate({ inputRange: [84, 126], outputRange: [0, 1], extrapolate: 'clamp' }),
          },
        ]}
      >
        <PressableScale style={[s.compactBalance, { borderColor: theme.accentDim }]} onPress={() => nav('/payouts')} accessibilityLabel="Open payouts">
          <View style={[s.compactBalanceIcon, { backgroundColor: theme.accentDim }]}>
            <Feather name="credit-card" size={15} color={theme.accent} />
          </View>
          <Text style={s.compactBalanceLabel}>Available</Text>
          <Text style={s.compactBalanceValue}>{payoutInfo === null ? '· · ·' : (payoutInfo?.available?.formatted ?? '$0.00')}</Text>
          <Feather name="chevron-right" size={16} color={MUTED} />
        </PressableScale>
      </Animated.View>

      <Animated.ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 160 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: dashboardScrollY } } }], { useNativeDriver: false })}
      >
        <StripeConnectWarning />

        <AnimatedEntrance delay={0} style={s.pageSection}>
          <View style={s.sectionHeaderRow}>
            <Text style={s.sectionHeaderTitle}>Overview</Text>
            <TouchableOpacity onPress={() => nav('/(tabs)/analytics')}>
               <Text style={s.sectionHeaderAction}>Analytics</Text>
            </TouchableOpacity>
          </View>

          <SellerDashboardKPIGrid cards={[
            {
              label: 'Net Revenue',
              value: dashStats === null ? '—' : formatCents(dashStats.revenueCents),
              trend,
              trendColor,
              onPress: () => nav('/(tabs)/analytics'),
            },
            {
              label: 'Orders',
              value: dashStats === null ? '—' : String(dashStats.orders),
              onPress: () => nav('/(tabs)/orders'),
            },
            {
              label: 'Visitors',
              value: dashStats === null ? '—' : String(dashStats.storefrontVisits),
            },
            {
              label: 'Conversion',
              value: dashStats === null || dashStats.storefrontVisits === 0 ? '—' : `${(dashStats.completedOrders / dashStats.storefrontVisits * 100).toFixed(1)}%`,
            },
          ]} />

          <UnifiedCard onPress={() => nav('/(tabs)/analytics')} style={{ padding: SP.sm, paddingBottom: 12 }}>
             <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 6, marginBottom: SP.sm, alignItems: 'center' }}>
                <Text style={s.metricLabel}>Revenue Trend</Text>
                <Text style={{ fontSize: 11, fontFamily: FONT.medium, color: MUTED }}>Last 7 days</Text>
             </View>
             <RevenueTrendChart points={salesTrend} loading={salesTrend === null && !salesTrendError} error={salesTrendError} accent={theme.accentLight} />
          </UnifiedCard>
        </AnimatedEntrance>

        {alerts.length > 0 && (
          <AnimatedEntrance delay={50} style={s.pageSection}>
             <View style={s.sectionHeaderRow}>
               <Text style={s.sectionHeaderTitle}>Needs Attention</Text>
             </View>
             <ListGroup>
               {alerts.map((a, i) => (
                 <ListItem
                   key={a.id}
                   icon={a.icon}
                   iconColor={a.color}
                   title={a.title}
                   subtitle={a.subtitle}
                   onPress={a.loading ? undefined : a.onPress}
                   rightElement={a.rightElement}
                   isLast={i === alerts.length - 1}
                 />
               ))}
             </ListGroup>
          </AnimatedEntrance>
        )}

        {showWelcome && (
          <AnimatedEntrance delay={100} style={s.pageSection}>
            <UnifiedCard glow>
              <Text style={{ fontSize: FS.lg, fontFamily: FONT.bold, color: FG, letterSpacing: -0.2 }}>Your brand workspace is ready.</Text>
              <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginTop: 6, marginBottom: SP.md }}>
                Build your first drop, set up your storefront, and start selling.
              </Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <PrimaryButton label="Start setup" onPress={handleStartSetup} small style={{ flex: 1 }} />
                <SecondaryButton label="Explore on my own" onPress={handleDismissWelcome} small style={{ flex: 1 }} />
              </View>
            </UnifiedCard>
          </AnimatedEntrance>
        )}

        {showProgress && (
          <AnimatedEntrance delay={100} style={s.pageSection}>
             <View style={s.sectionHeaderRow}>
               <Text style={s.sectionHeaderTitle}>Finish Setup</Text>
               <Text style={s.sectionHeaderAction}>{setupState.tasks.filter(t => t.completed).length} of {setupState.tasks.length} done</Text>
             </View>
             <ListGroup>
               {setupState.tasks.map((task, i) => (
                 <ListItem
                   key={task.id}
                   icon={task.completed ? "check-circle" : "circle"}
                   iconColor={task.completed ? SUCCESS : MUTED}
                   title={task.label}
                   onPress={task.completed ? undefined : () => nav(task.route)}
                   rightElement={task.optional && !task.completed ? (
                     <View style={{ backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                        <Text style={{ fontSize: 10, fontFamily: FONT.medium, color: MUTED }}>Optional</Text>
                     </View>
                   ) : null}
                   isLast={i === setupState.tasks.length - 1}
                 />
               ))}
             </ListGroup>
          </AnimatedEntrance>
        )}

        {!showWelcome && !showProgress && (
          <AnimatedEntrance delay={100} style={s.pageSection}>
             <View style={s.sectionHeaderRow}>
               <Text style={s.sectionHeaderTitle}>Operations</Text>
               <TouchableOpacity onPress={() => setCommandModal(true)}>
                 <Text style={s.sectionHeaderAction}>Shortcuts</Text>
               </TouchableOpacity>
             </View>
             <ListGroup>
                <ListItem
                  icon="shopping-bag"
                  iconColor={BLUE}
                  title="Orders"
                  subtitle={orderStats ? `${orderStats.newOrders} new, ${orderStats.toProcess} to process` : 'Loading...'}
                  onPress={() => nav('/(tabs)/orders')}
                  badge={unseenOrderCount}
                />
                <ListItem
                  icon="message-circle"
                  iconColor={theme.accentLight}
                  title="Customers"
                  subtitle={hubStats ? `${hubStats.unreadMessages} unread, ${hubStats.activeQuotes} quotes` : 'Loading...'}
                  onPress={() => nav('/seller-inbox')}
                />
                <ListItem
                  icon="credit-card"
                  iconColor={SUCCESS}
                  title="Payouts"
                  subtitle={payoutInfo?.available?.formatted ?? '—'}
                  onPress={() => nav('/payouts')}
                />
                <ListItem
                  icon="shield"
                  iconColor={GREEN_BRIGHT}
                  title="Account health"
                  subtitle={`${pct}% ready`}
                  onPress={() => nav('/seller-settings')}
                  isLast
                />
             </ListGroup>
          </AnimatedEntrance>
        )}

        {!showWelcome && !showProgress && (
          <AnimatedEntrance delay={150} style={s.pageSection}>
             <View style={s.sectionHeaderRow}>
               <Text style={s.sectionHeaderTitle}>Quick Actions</Text>
             </View>
             <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                <QuickActionCard label="Create Post" icon="video" accent={theme.accent} badge={!setupState.openedFeatures.includes('create-post')} onPress={() => { markFeatureOpened('create-post'); nav('/create-post'); }} style={{ width: '48%' }} />
                <QuickActionCard label="Add Product" icon="plus-circle" accent={theme.secondary} onPress={() => nav('/(tabs)/products')} style={{ width: '48%' }} />
                <QuickActionCard label="View Orders" icon="shopping-bag" accent={BLUE} onPress={() => nav('/(tabs)/orders')} style={{ width: '48%' }} />
                <QuickActionCard label="Studio" icon="zap" accent={ORANGE} onPress={() => nav('/(tabs)/studio')} style={{ width: '48%' }} />
             </View>
          </AnimatedEntrance>
        )}

        <AnimatedEntrance delay={200} style={s.pageSection}>
           <View style={s.sectionHeaderRow}>
             <Text style={s.sectionHeaderTitle}>Recent Orders</Text>
             <TouchableOpacity onPress={() => nav('/(tabs)/orders')}>
               <Text style={s.sectionHeaderAction}>View all</Text>
             </TouchableOpacity>
           </View>

           {recentOrders === null ? (
              <LoadingSkeleton height={140} style={{ borderRadius: RADIUS.lg }} />
           ) : recentOrders.length === 0 ? (
              <UnifiedCard glow style={{ padding: SP.lg }}>
                 <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
                    <View style={[s.listIconWrap, { backgroundColor: theme.accentDim }]}>
                       <Feather name="zap" size={16} color={theme.accentLight} />
                    </View>
                    <View style={{ flex: 1 }}>
                       <Text style={{ fontSize: FS.md, fontFamily: FONT.bold, color: FG, letterSpacing: -0.2 }}>Ready for your first drop?</Text>
                       <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginTop: 4 }}>A few quick moves to get shoppers to your store.</Text>
                    </View>
                 </View>
                 <PrimaryButton label="Share Your Store" icon="share-2" small onPress={() => nav('/share-store')} style={{ marginBottom: 8 }} />
                 <View style={{ flexDirection: 'row', gap: 8 }}>
                    <SecondaryButton label="Add Product" icon="plus-circle" small onPress={() => nav('/(tabs)/products')} style={{ flex: 1 }} />
                    <SecondaryButton label="Post a Drop" icon="video" small onPress={() => nav('/create-post')} style={{ flex: 1 }} />
                 </View>
              </UnifiedCard>
           ) : (
              <ListGroup>
                 {recentOrders.map((order, i) => {
                    const customerName = order.customerName ?? order.customer?.name ?? order.buyerName ?? 'Unknown';
                    const totalCents   = typeof order.totalCents   === 'number' ? order.totalCents : typeof order.total_cents  === 'number' ? order.total_cents : 0;
                    const orderNum     = order.orderNumber ?? order.order_number ?? `#${String(order.id ?? '').slice(-6).toUpperCase()}`;

                    return (
                      <ListItem
                        key={order.id}
                        icon="shopping-bag"
                        iconColor={FG}
                        title={customerName}
                        subtitle={orderNum}
                        value={formatCents(totalCents)}
                        rightElement={<StatusBadge label={orderStatusLabel(order.status)} variant={orderStatusVariant(order.status)} small />}
                        onPress={() => nav(`/order-detail?id=${order.id}`)}
                        isLast={i === recentOrders.length - 1}
                      />
                    );
                 })}
              </ListGroup>
           )}
        </AnimatedEntrance>

      </Animated.ScrollView>

      <AIBrainFAB context={{ screen: 'home' as const }} bottomOffset={72} />

      <Modal visible={commandModal} animationType="slide" transparent>
        <View style={s.modalOverlay}>
          <Pressable style={s.modalOverlay} onPress={() => setCommandModal(false)} />
          <View style={[s.bottomSheet, { paddingBottom: Math.max(insets.bottom, SP.lg) }]}>
            <View style={s.sheetHandle} />
            <Text style={s.commandTitle}>Create & manage</Text>
            <View style={s.commandGrid}>
              {COMMAND_ITEMS.map((item) => (
                <PressableScale
                  key={item.label}
                  style={s.commandItem}
                  onPress={() => { setCommandModal(false); setTimeout(() => nav(item.route), 150); }}
                >
                  <View style={s.commandIconWrap}>
                    <Feather name={item.icon} size={18} color={theme.accentLight} />
                  </View>
                  <Text style={s.commandLabel}>{item.label}</Text>
                </PressableScale>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={searchModal} animationType="slide" transparent>
        <View style={[s.searchScreen, { paddingTop: insets.top, backgroundColor: BG }]}>
          <View style={s.searchHeader}>
            <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search orders or products…" style={{ flex: 1 }} />
            <PressableScale onPress={() => setSearchModal(false)} style={s.searchClose}>
              <Text style={{ fontSize: FS.base, fontFamily: FONT.medium, color: MUTED }}>Cancel</Text>
            </PressableScale>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: SP.md, paddingBottom: 120 }}>
            {searchQuery.length > 0 ? (
              <>
                {orderResults.length > 0 && (
                  <View style={{ marginBottom: SP.lg }}>
                    <Text style={s.searchSectionTitle}>Orders</Text>
                    {orderResults.map(o => (
                      <PressableScale key={o.id} onPress={() => { setSearchModal(false); nav(`/order-detail?id=${o.id}`); }} style={{ paddingVertical: SP.sm, borderBottomWidth: 1, borderColor: BORDER }}>
                        <Text style={{ fontSize: FS.base, fontFamily: FONT.medium, color: FG }}>{o.orderNumber} — {o.customer?.name ?? o.customerName}</Text>
                        <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginTop: 2 }}>{formatCents(o.total_cents ?? o.totalCents ?? 0)} • {orderStatusLabel(o.status)}</Text>
                      </PressableScale>
                    ))}
                  </View>
                )}
                {productResults.length > 0 && (
                  <View style={{ marginBottom: SP.lg }}>
                    <Text style={s.searchSectionTitle}>Products</Text>
                    {productResults.map(p => (
                      <PressableScale key={p.id} onPress={() => { setSearchModal(false); nav(`/(tabs)/products`); }} style={{ paddingVertical: SP.sm, borderBottomWidth: 1, borderColor: BORDER }}>
                        <Text style={{ fontSize: FS.base, fontFamily: FONT.medium, color: FG }}>{p.name}</Text>
                        <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginTop: 2 }}>{formatCents(p.price_cents ?? p.priceCents ?? 0)}</Text>
                      </PressableScale>
                    ))}
                  </View>
                )}
                {orderResults.length === 0 && productResults.length === 0 && (
                  <Text style={{ fontSize: FS.base, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', marginTop: SP.xl }}>No results found for "{searchQuery}"</Text>
                )}
              </>
            ) : (
              <View style={{ alignItems: 'center', marginTop: SP.xl }}>
                <Feather name="search" size={32} color={MUTED} style={{ marginBottom: SP.sm }} />
                <Text style={{ fontSize: FS.base, fontFamily: FONT.medium, color: FG, textAlign: 'center' }}>Search your store</Text>
                <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', marginTop: 4 }}>Find orders by number or customer name, and products by title.</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
    backgroundColor: SCREEN_BG,
    zIndex: 10,
  },
  greetSmall: {
    fontSize: 12,
    fontFamily: FONT.medium,
    color: MUTED,
    letterSpacing: 0.5,
  },
  brandName: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.3,
  },
  compactBalanceWrap: {
    overflow: 'hidden',
    backgroundColor: SCREEN_BG,
    zIndex: 20,
  },
  compactBalance: {
    height: 44,
    marginHorizontal: SP.md,
    marginTop: 4,
    paddingHorizontal: SP.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    backgroundColor: CARD_GLASS,
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

  // ─── Unified System ────────────────────────────────────────────────────────
  pageSection: {
    paddingHorizontal: SP.md,
    marginBottom: SP.xl,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: SP.sm,
    paddingHorizontal: 4,
  },
  sectionHeaderTitle: {
    fontSize: 13,
    fontFamily: FONT.bold,
    color: MUTED,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  sectionHeaderAction: {
    fontSize: 13,
    fontFamily: FONT.medium,
    color: SUBTLE,
  },
  unifiedCard: {
    backgroundColor: CARD_GLASS,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER_SUBTLE,
  },
  listGroup: {
    backgroundColor: CARD_GLASS,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER_SUBTLE,
    overflow: 'hidden',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SP.md,
    gap: SP.sm,
  },
  listIconWrap: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listBody: {
    flex: 1,
    justifyContent: 'center',
  },
  listTitle: {
    fontSize: 15,
    fontFamily: FONT.semibold,
    color: FG,
    letterSpacing: -0.2,
  },
  listSubtitle: {
    fontSize: 13,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  listRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 8,
  },
  listValue: {
    fontSize: 15,
    fontFamily: FONT.semibold,
    color: FG,
  },
  listDivider: {
    position: 'absolute',
    bottom: 0,
    left: SP.md + 34 + SP.sm,
    right: 0,
    height: 1,
    backgroundColor: BORDER_SUBTLE,
  },

  // ─── Business Pulse ────────────────────────────────────────────────────────
  metricLabel: {
    fontSize: 13,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  metricValue: {
    fontSize: 26,
    fontFamily: FONT.extrabold,
    color: FG,
    letterSpacing: -0.8,
    marginTop: 2,
  },
  trendPillInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  trendPillText: {
    fontSize: 11,
    fontFamily: FONT.bold,
  },

  chartContainer: {
    height: 90,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    paddingTop: 8,
  },
  chartBarWrap: {
    width: 24,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  chartBarTrack: {
    width: 6,
    height: 60,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
  },
  chartBar: {
    width: '100%',
    borderRadius: RADIUS.pill,
  },
  chartDay: {
    fontSize: 9,
    fontFamily: FONT.bold,
    color: SUBTLE,
    textTransform: 'uppercase' as const,
  },
  chartEmpty: {
    height: 90,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  chartEmptyText: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
  },

  // ─── Modals ────────────────────────────────────────────────────────────────
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: CARD_GLASS,
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
    backgroundColor: CARD_ELEVATED_GLASS,
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
