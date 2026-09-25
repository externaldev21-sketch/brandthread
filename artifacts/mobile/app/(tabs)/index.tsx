import React, { useState, useEffect, useRef, useCallback } from 'react';
import SellerHomeCommerceDashboard from '@/components/SellerHomeCommerceDashboard';
import StripeConnectWarning from '@/components/StripeConnectWarning';
import { View, Text, ScrollView, StyleSheet, Animated, Modal, TextInput, FlatList, Alert, Pressable, TouchableOpacity, Linking, StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/hooks/useApi';
import { getSetupState, markSetupStarted, dismissWelcome, completionPercent, nextTask, nextBestAction, dismissTip, markFeatureOpened, completedRequiredTaskCount, requiredTaskCount, isSetupComplete, type SetupState } from '@/lib/setupStore';
import { deriveHubStats, deriveInventoryStats, deriveOrderStats } from '@/lib/sellerDashboardStats';
import { AnimatedEntrance, BrandthreadScreen, BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton, IconButton, SearchBar, StatCard, SectionHeader, ProgressCard, NavigationCard, NewFeatureBadge, LoadingSkeleton, EmptyState, StatusBadge, PressableScale } from '@/components/BrandthreadUI';
import { SellerDashboardKPIGrid } from '@/components/SellerDashboardKPIGrid';
import { SellerQuickActionsGrid } from '@/components/SellerQuickActionsGrid';
import { FONT, FS, SP, RADIUS, COMP, ICON, ANIM } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { useRevenueCat } from '@/lib/revenueCat';
import { getBillingRecoveryTarget, isSubscriptionPaymentRecoveryRequired } from '@/lib/subscriptionRecovery';
import { initFromStorage, subscribe } from '@/lib/orderBadgeStore';
import { getSellerOrderBadgeCount, openSellerOrders } from '@/lib/sellerOrderBadge';
import { withSellerSetupOrigin } from '@/lib/setupNavigation';

// ─── Helpers ──────────────────────────────────────────────────────────────────
import { SellerDashboardActionRow, SellerDashboardListGroup, SellerDashboardListItem, SellerDashboardSectionHeader, SellerDashboardTrendHeader } from '@/components/SellerDashboardSections';
import { SheetRise } from '@/components/motion/SheetRise';

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
  const s = React.useMemo(() => createStyles(theme), [theme]);
  const cardStyle = [
    s.unifiedCard,
    glow && { shadowColor: theme.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 16, elevation: 8 },
    style
  ];
  return onPress ? <PressableScale onPress={onPress} style={cardStyle}>{children}</PressableScale> : <View style={cardStyle}>{children}</View>;
}

const ListGroup = SellerDashboardListGroup;

function DashboardUnavailableState({
  title,
  message,
  onRetry,
  compact = false,
}: {
  title: string;
  message: string;
  onRetry: () => void;
  compact?: boolean;
}) {
  const { theme } = useAppTheme();
  const s = React.useMemo(() => createStyles(theme), [theme]);
  return (
    <View
      style={[s.unavailableCard, compact && s.unavailableCardCompact]}
      accessibilityRole="alert"
      testID="seller-dashboard-unavailable"
    >
      <View style={[s.unavailableIcon, { backgroundColor: theme.accentDim, borderColor: theme.accent + '2E' }]}>
        <Feather name="cloud" size={18} color={theme.accentLight} />
      </View>
      <View style={s.unavailableCopy}>
        <Text style={s.unavailableTitle}>{title}</Text>
        <Text style={s.unavailableMessage}>{message}</Text>
      </View>
      <SecondaryButton
        label="Retry"
        icon="refresh-cw"
        small
        onPress={onRetry}
        style={compact ? s.unavailableButtonCompact : s.unavailableButton}
      />
    </View>
  );
}

function RevenueTrendChart({
  points,
  loading,
  error,
  accent,
}: {
  points: RevenueTrendPoint[] | null;
  loading: boolean;
  error: boolean;
  accent: string;
}) {
  const { theme } = useAppTheme();
  const s = React.useMemo(() => createStyles(theme), [theme]);
  const { subtle: SUBTLE, text: FG } = theme;
  const animation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    animation.setValue(0);
    if (points && points.length > 0) {
      Animated.timing(animation, { toValue: 1, duration: ANIM.slow, useNativeDriver: false }).start();
    }
    return () => animation.stopAnimation();
  }, [animation, points]);

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

  const hasNoData = error || !points || points.length === 0;
  const chartPoints = hasNoData
    ? Array.from({ length: 7 }, (_, index) => {
        const day = new Date();
        day.setUTCDate(day.getUTCDate() - (6 - index));
        return { day: day.toISOString(), totalCents: 0 };
      })
    : points;
  const maxCents = Math.max(...chartPoints.map((p) => p.totalCents), 1);
  const today = new Date().toISOString().slice(0, 10);
  const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <View style={s.chartContainer}>
      {hasNoData && <Text style={s.chartNoDataLabel}>No revenue data yet</Text>}
      {chartPoints.map((point, index) => {
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
                    height: hasNoData ? '4%' : animation.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', `${Math.max(8, targetHeightPct)}%`],
                    }),
                    backgroundColor: isToday ? accent : FG,
                    opacity: hasNoData ? 0.12 : isToday ? 1 : 0.25,
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
  { label: 'Create design',     icon: 'pen-tool'     as const, route: '/design'          },
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
  walkthroughShown: false,
  celebrated: false,
  lastUpdated: Date.now(),
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SellerHomeScreen() {
  const { theme } = useAppTheme();
  const s = React.useMemo(() => createStyles(theme), [theme]);
  const { background: BG, surface: SCREEN_BG, text: FG, muted: MUTED, subtle: SUBTLE, border: BORDER, success: SUCCESS, accentLight: GREEN_BRIGHT, accent: BLUE, warning: ORANGE, error: RED } = theme;
  const palette = theme as typeof theme & Record<string, string>;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();

  const api = useApi();
  const { managementURL } = useRevenueCat();
  const [loading, setLoading] = useState(true);
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
  const [ordersError, setOrdersError] = useState(false);
  const [searchProducts, setSearchProducts] = useState<any[]>([]);
  const [searchOrders, setSearchOrders] = useState<any[]>([]);
  const [payoutInfo,   setPayoutInfo]   = useState<any | null>(null);
  const [salesTrend,   setSalesTrend]   = useState<Array<{ day: string; totalCents: number }> | null>(null);
  const [salesTrendError, setSalesTrendError] = useState(false);
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
  const [subscriptionProvider, setSubscriptionProvider] = useState<'stripe' | 'revenuecat' | 'none'>('none');
  const [trialBanner, setTrialBanner] = useState<{
    visible: boolean; day: number | null; daysRemaining: number; trialEndsAt: string; message: string; cta: string;
  } | null>(null);
  const [billingPortalLoading, setBillingPortalLoading] = useState(false);

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
    let onboardingComplete = false;
    try {
      const profile = await api.auth.me();
      onboardingComplete = profile.accountType === 'seller' && profile.onboardingComplete === true;
    } catch {
      // The local checklist remains available if profile refresh is offline.
    }
    const state = await getSetupState(userId, { onboardingComplete });
    setSetupState(state);
    setLoading(false);
  }, [api, userId]);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      setDashStats(null);
      setSalesTrend(null);
      setRecentOrders([]);
      return;
    }
    const timer = setTimeout(() => { void loadSetup(); }, 0);
    const minLoad = setTimeout(() => {}, 500);
    setDashStatsError(false);
    setSalesTrendError(false);
    setOrdersError(false);
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
    });

    api.finance.balance().then((data: any) => {
      setPayoutInfo(data && typeof data === 'object' ? data : null);
    }).catch((error) => {
      setPayoutInfo(null);
    });

    api.orders.list().then((rows: any) => {
      const list = Array.isArray(rows) ? rows : [];
      setOrderStats(deriveOrderStats(list));
      setRecentOrders(list.slice(0, 3));
      setSearchOrders(list);
      setOrdersError(false);
    }).catch((error) => {
      setOrderStats(null);
      setRecentOrders(null);
      setOrdersError(true);
    });

    api.products.list().then((rows: any) => {
      setSearchProducts(Array.isArray(rows) ? rows : []);
    }).catch((error) => {
      setSearchProducts([]);
    });

    api.analytics.revenue('last7').then((data: any) => {
      if (!data || typeof data !== 'object' || !Array.isArray(data.daily)) throw new Error('Invalid revenue analytics response.');
      setSalesTrend(normalizeRevenueTrend(data.daily));
      setSalesTrendError(false);
    }).catch((error) => {
      setSalesTrend(null);
      setSalesTrendError(true);
    });

    return () => { clearTimeout(timer); clearTimeout(minLoad); };
  }, [loadSetup, retryKey]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setSubscriptionStatus(null);
      setSubscriptionProvider('none');
      setTrialBanner(null);
      api.seller.subscription.status().then((data) => {
        if (active) {
          setSubscriptionStatus(data?.status ?? null);
          setSubscriptionProvider(data?.effectiveProvider ?? 'none');
          setTrialBanner(data?.trialBanner ?? null);
        }
      }).catch(() => {});
      return () => { active = false; };
    }, [api]),
  );

  const pct = completionPercent(setupState);
  const showWelcome = !setupState.started && !setupState.dismissed;
  const showProgress = setupState.started && !isSetupComplete(setupState);
  const q = searchQuery.toLowerCase().trim();

  const productResults = q ? searchProducts.filter(p => String(p.name ?? '').toLowerCase().includes(q)) : [];
  const orderResults = q ? searchOrders.filter(o => String(o.orderNumber ?? '').toLowerCase().includes(q) || String(o.customer?.name ?? o.customerName ?? '').toLowerCase().includes(q)) : [];

  function nav(route: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as never);
  }

  function openSetupTask(task: SetupState['tasks'][number]) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.replace(withSellerSetupOrigin(task.route) as never);
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

  async function dismissTrialBanner() {
    const current = trialBanner;
    if (!current) return;
    setTrialBanner(null);
    try {
      await api.seller.subscription.dismissTrialBanner(current.trialEndsAt);
    } catch {
      // Restore it if the server could not persist the dismissal.
      setTrialBanner(current);
    }
  }

  async function handleStartSetup() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const next = await markSetupStarted(userId);
    setSetupState(next);
  }

  async function handleDismissWelcome() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = await dismissWelcome(userId);
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
      <View style={{ flex: 1, backgroundColor: palette.background ?? palette.surface ?? SCREEN_BG }}>
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
  const dashboardLayout = 'commerce' as 'commerce' | 'legacy';

  return dashboardLayout === 'commerce' ? (
    <SellerHomeCommerceDashboard
      topInset={insets.top}
      userId={userId}
      setupState={setupState}
      onSetupStateChange={setSetupState}
    />
  ) : (
    <View style={{ flex: 1, backgroundColor: palette.background ?? palette.surface ?? SCREEN_BG }}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <View>
          <Text style={s.greetSmall}>{greeting()}</Text>
          <Text style={s.brandName}>Brandthread</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
            <IconButton name="search" accessibilityLabel="Search store" onPress={() => { setSearchQuery(''); setSearchModal(true); }} />
            <IconButton name="bell" accessibilityLabel="Open notifications" badge={unseenOrderCount > 0} badgeCount={unseenOrderCount} onPress={() => Alert.alert('Notifications', 'No new notifications.')} />
        </View>
      </View>

      <Animated.ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 160 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <StripeConnectWarning />

        {trialBanner?.visible && (
          <AnimatedEntrance delay={0} style={s.pageSection}>
            <View
              style={[s.trialBanner, { borderColor: theme.accent + '66', backgroundColor: theme.accentDim }]}
              accessibilityRole="alert"
              testID="seller-trial-banner"
            >
              <View style={[s.trialBannerIcon, { backgroundColor: theme.accent + '24' }]}>
                <Feather name="clock" size={19} color={theme.accentLight} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.trialBannerTitle}>Your trial ends soon</Text>
                <Text style={s.trialBannerBody}>
                  {trialBanner.message}
                  {trialBanner.daysRemaining > 1 ? ` ${trialBanner.daysRemaining} days left.` : ''}
                </Text>
                <PressableScale
                  onPress={() => nav('/subscription')}
                  style={[s.trialBannerCta, { backgroundColor: theme.accent }]}
                  accessibilityRole="button"
                >
                  <Text style={[s.trialBannerCtaText, { color: theme.onAccent }]}>Manage subscription</Text>
                  <Feather name="arrow-right" size={14} color={theme.onAccent} />
                </PressableScale>
              </View>
              <Pressable onPress={dismissTrialBanner} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss trial reminder">
                <Feather name="x" size={16} color={MUTED} />
              </Pressable>
            </View>
          </AnimatedEntrance>
        )}

        <AnimatedEntrance delay={0} style={s.pageSection}>
          <SellerDashboardSectionHeader title="Overview" action="Analytics" onAction={() => nav('/(tabs)/analytics')} />

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
             <SellerDashboardTrendHeader />
             <RevenueTrendChart
               points={salesTrend}
               loading={salesTrend === null && !salesTrendError}
               error={salesTrendError}
               accent={theme.accentLight}
             />
          </UnifiedCard>
        </AnimatedEntrance>

        {alerts.length > 0 && (
          <AnimatedEntrance delay={50} style={s.pageSection}>
             <SellerDashboardSectionHeader title="Needs Attention" />
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
              <Text style={s.welcomeTitle} maxFontSizeMultiplier={2}>Your brand workspace is ready.</Text>
              <Text style={s.welcomeBody} maxFontSizeMultiplier={2}>
                Build your first drop, set up your storefront, and start selling.
              </Text>
              <SellerDashboardActionRow
                testID="seller-dashboard-welcome-actions"
                actions={[
                  { label: 'Start setup', variant: 'primary', onPress: handleStartSetup },
                  { label: 'Explore on my own', variant: 'secondary', onPress: handleDismissWelcome },
                ]}
              />
            </UnifiedCard>
          </AnimatedEntrance>
        )}

        {showProgress && (
          <AnimatedEntrance delay={100} style={s.pageSection}>
             <SellerDashboardSectionHeader
               title="Finish Setup"
                action={`${completedRequiredTaskCount(setupState)} of ${requiredTaskCount(setupState)} required`}
             />
              <UnifiedCard style={s.setupProgressCard}>
                <View style={s.setupProgressHeader}>
                  <View>
                    <Text style={s.setupProgressTitle}>Setup progress</Text>
                    <Text style={s.setupProgressSubtitle}>
                      {completedRequiredTaskCount(setupState)} of {requiredTaskCount(setupState)} required tasks complete
                    </Text>
                  </View>
                  <Text style={s.setupProgressPercent}>{pct}%</Text>
                </View>
                <View
                  accessibilityRole="progressbar"
                  accessibilityLabel={`Setup progress: ${pct}%`}
                  style={s.setupProgressTrack}
                >
                  <View style={[s.setupProgressFill, { width: `${pct}%`, backgroundColor: theme.accent }]} />
                </View>
              </UnifiedCard>
             <ListGroup>
               {setupState.tasks.map((task, i) => (
                 <ListItem
                   key={task.id}
                   icon={task.completed ? "check-circle" : "circle"}
                   iconColor={task.completed ? SUCCESS : MUTED}
                   title={task.label}
                    onPress={task.completed ? undefined : () => openSetupTask(task)}
                   rightElement={task.optional && !task.completed ? (
                     <View style={{ backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                        <Text style={{ fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED }}>Optional</Text>
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
             <SellerDashboardSectionHeader title="Operations" action="Shortcuts" onAction={() => setCommandModal(true)} />
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
             <SellerDashboardSectionHeader title="Quick Actions" />
             <SellerQuickActionsGrid actions={[
               { label: 'Create Post', icon: 'video', accent: theme.accent, badge: !setupState.openedFeatures.includes('create-post'), onPress: () => { markFeatureOpened('create-post', userId); nav('/create-post'); } },
               { label: 'Add Product', icon: 'plus-circle', accent: theme.secondary, onPress: () => nav('/(tabs)/products') },
               { label: 'View Orders', icon: 'shopping-bag', accent: BLUE, onPress: () => nav('/(tabs)/orders') },
               { label: 'Design Studio', icon: 'zap', accent: ORANGE, onPress: () => nav('/design') },
             ]} />
          </AnimatedEntrance>
        )}

        <AnimatedEntrance delay={200} style={s.pageSection}>
           <SellerDashboardSectionHeader title="Recent Orders" action="View all" onAction={() => nav('/(tabs)/orders')} />

           {recentOrders === null ? (
              <LoadingSkeleton height={140} style={{ borderRadius: RADIUS.lg }} />
           ) : recentOrders.length === 0 ? (
              <UnifiedCard glow style={{ padding: SP.lg }}>
                 <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
                    <View style={[s.listIconWrap, { backgroundColor: theme.accentDim }]}>
                       <Feather name="zap" size={16} color={theme.accentLight} />
                    </View>
                    <View style={{ flex: 1 }}>
                       <Text style={s.emptyOrdersTitle} maxFontSizeMultiplier={2}>Ready for your first drop?</Text>
                       <Text style={s.emptyOrdersBody} maxFontSizeMultiplier={2}>A few quick moves to get shoppers to your store.</Text>
                    </View>
                 </View>
                 <PrimaryButton label="Share Your Store" icon="share-2" small onPress={() => nav('/share-store')} style={{ marginBottom: 8 }} />
                  <SellerDashboardActionRow
                    testID="seller-dashboard-empty-order-actions"
                    actions={[
                      { label: 'Add Product', icon: 'plus-circle', variant: 'secondary', onPress: () => nav('/(tabs)/products') },
                      { label: 'Post a Drop', icon: 'video', variant: 'secondary', onPress: () => nav('/create-post') },
                    ]}
                  />
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


      <Modal visible={commandModal} animationType="fade" transparent>
        <View style={s.modalOverlay}>
          <Pressable style={s.modalOverlay} onPress={() => setCommandModal(false)} accessibilityRole="button" accessibilityLabel="Close create and manage menu" />
          <SheetRise style={[s.bottomSheet, { paddingBottom: Math.max(insets.bottom, SP.lg) }]}>
            <View style={s.sheetHandle} />
            <Text style={s.commandTitle}>Create & manage</Text>
            <View style={s.commandGrid}>
              {COMMAND_ITEMS.map((item) => (
                <PressableScale
                  key={item.label}
                  style={s.commandItem}
                  onPress={() => { setCommandModal(false); setTimeout(() => nav(item.route), 150); }}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                >
                  <View style={s.commandIconWrap}>
                    <Feather name={item.icon} size={18} color={theme.accentLight} />
                  </View>
                  <Text style={s.commandLabel}>{item.label}</Text>
                </PressableScale>
              ))}
            </View>
          </SheetRise>
        </View>
      </Modal>

      <Modal visible={searchModal} animationType="slide" transparent>
        <View style={[s.searchScreen, { paddingTop: insets.top, backgroundColor: BG }]}>
          <View style={s.searchHeader}>
            <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search orders or products…" style={{ flex: 1 }} />
            <PressableScale onPress={() => setSearchModal(false)} style={s.searchClose} accessibilityRole="button" accessibilityLabel="Close store search">
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
                      <PressableScale key={o.id} onPress={() => { setSearchModal(false); nav(`/order-detail?id=${o.id}`); }} style={{ paddingVertical: SP.sm, borderBottomWidth: 1, borderColor: BORDER }} accessibilityRole="button" accessibilityLabel={`Open order ${o.orderNumber}`}>
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
                      <PressableScale key={p.id} onPress={() => { setSearchModal(false); nav(`/(tabs)/products`); }} style={{ paddingVertical: SP.sm, borderBottomWidth: 1, borderColor: BORDER }} accessibilityRole="button" accessibilityLabel={`Open product ${p.name}`}>
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

const createStyles = (theme: any) => {
  const SCREEN_BG = theme.background, BG = theme.surface, CARD = theme.card, CARD_ELEVATED = theme.cardElevated;
  const SELLER_DASHBOARD_GLASS = theme.cardGlass, SELLER_DASHBOARD_GLASS_ELEVATED = theme.cardElevatedGlass;
  const BORDER = theme.border, BORDER_SUBTLE = theme.borderSubtle, BORDER_ACTIVE = theme.accent;
  const FG = theme.text, MUTED = theme.muted, SUBTLE = theme.subtle;
  const SUCCESS = theme.success, GREEN_BRIGHT = theme.success, BLUE = theme.accentLight, ORANGE = theme.warning, RED = theme.error;
  const PURPLE = theme.accent, PURPLE_LIGHT = theme.accentLight, PURPLE_DIM = theme.accentDim;
  return StyleSheet.create({
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
    backgroundColor: SELLER_DASHBOARD_GLASS,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER_SUBTLE,
  },
  listGroup: {
    backgroundColor: SELLER_DASHBOARD_GLASS,
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
  welcomeTitle: {
    fontSize: FS.lg,
    lineHeight: 26,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.2,
  },
  welcomeBody: {
    fontSize: FS.sm,
    lineHeight: 20,
    fontFamily: FONT.regular,
    color: MUTED,
    marginTop: 6,
    marginBottom: SP.md,
  },
  setupProgressCard: {
    padding: SP.md,
    marginBottom: SP.sm,
  },
  setupProgressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SP.md,
    marginBottom: SP.sm,
  },
  setupProgressTitle: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: FG,
  },
  setupProgressSubtitle: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
    marginTop: 3,
  },
  setupProgressPercent: {
    fontSize: FS.lg,
    fontFamily: FONT.bold,
    color: FG,
  },
  setupProgressTrack: {
    height: 8,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  setupProgressFill: {
    height: '100%',
    borderRadius: RADIUS.pill,
  },
  emptyOrdersTitle: {
    fontSize: FS.md,
    lineHeight: 22,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.2,
  },
  emptyOrdersBody: {
    fontSize: FS.sm,
    lineHeight: 20,
    fontFamily: FONT.regular,
    color: MUTED,
    marginTop: 4,
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
     fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: SUBTLE,
    textTransform: 'uppercase' as const,
  },
  chartNoDataLabel: {
    position: 'absolute',
    top: 4,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: SUBTLE,
  },
  unavailableCard: {
    minHeight: 132,
    padding: SP.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: SELLER_DASHBOARD_GLASS,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 3,
  },
  unavailableCardCompact: {
    minHeight: 100,
    paddingVertical: 12,
  },
  unavailableIcon: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unavailableCopy: {
    flex: 1,
    minWidth: 0,
  },
  unavailableTitle: {
    color: FG,
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    lineHeight: 18,
  },
  unavailableMessage: {
    color: MUTED,
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    lineHeight: 16,
    marginTop: 3,
  },
  unavailableButton: {
    minWidth: 92,
  },
  unavailableButtonCompact: {
    minWidth: 84,
  },
  trialBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginHorizontal: SP.md,
    marginBottom: SP.md,
    padding: SP.md,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
  },
  trialBannerIcon: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trialBannerTitle: {
    color: FG,
    fontFamily: FONT.semibold,
    fontSize: FS.base,
  },
  trialBannerBody: {
    color: MUTED,
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    lineHeight: 17,
    marginTop: 3,
  },
  trialBannerCta: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: RADIUS.sm,
  },
  trialBannerCtaText: {
    fontFamily: FONT.semibold,
    fontSize: FS.xs,
  },

  // ─── Modals ────────────────────────────────────────────────────────────────
  modalOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: SELLER_DASHBOARD_GLASS_ELEVATED,
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
    backgroundColor: SELLER_DASHBOARD_GLASS_ELEVATED,
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
};

const ListItem = SellerDashboardListItem;
