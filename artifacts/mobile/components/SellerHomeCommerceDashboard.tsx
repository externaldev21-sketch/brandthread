import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useApi } from '@/hooks/useApi';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { ApiError } from '@/lib/networkNotice';
import { useTeamRole } from '@/hooks/useTeamRole';
import { subscribeStoreContext } from '@/lib/api';
import {
  selectSellerHomeAnalytics,
  sellerHomeAnalyticsKey,
  type SellerHomeAnalyticsSnapshot,
} from '@/lib/sellerHomeAnalytics';
import {
  completeTask, isSetupComplete, completionPercent, nextTask,
  markWalkthroughShown, markCelebrated,
  type SetupState, type SetupTask,
} from '@/lib/setupStore';
import { withSellerSetupOrigin } from '@/lib/setupNavigation';
import { buildCanonicalProfileUrl } from '@/lib/shareProfile';
import { middleTruncate } from '@/lib/middleTruncate';
import SetupWalkthroughSheet from '@/components/SetupWalkthroughSheet';
import SetupContinueBanner from '@/components/SetupContinueBanner';
import SetupCelebration from '@/components/SetupCelebration';
import { ResponsiveContainer, SkeletonBlock, useBreakpoint } from '@/components/layout';
import ActivityBellButton from '@/components/ActivityBellButton';
import { PressableScale } from '@/components/BrandthreadUI';
import { bucketLabel, type SellerHomeTimeRange } from '@/lib/sellerHomeChartLabels';
import { isSellerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';
import { buildPreviewSellerAnalytics } from '@/lib/previewSellerChartData';
import { formatCents } from '@/lib/money';
import { formatCentsCompact, formatCompactCount } from '@/lib/compactFormat';
import { computeMetricChange } from '@/lib/sellerMetricChange';
import { useCountUp } from '@/lib/useCountUp';
import {
  countOrderReturns,
  deriveHubStats,
  deriveInventoryStats,
  describeDashboardDelta,
  isNewSeller,
  mergeTopProductImages,
  normalizeRecentOrder,
  type DashboardActionCounts,
  type RecentOrderSummary,
  type TopProductSummary,
} from '@/lib/sellerDashboardStats';
// Reused (not reimplemented) so the "orders to ship" tile can never drift
// from what the Orders screen itself counts as unfulfilled — see item 31 /
// docs/qa/full-crawl-report.md #7: this tile used to read a separately
// server-computed `toFulfill` figure (status IN pending/processing AND
// paid), while Orders' own "Unfulfilled" filter/count uses a different rule
// (order status only, via `FULFILLMENT_MAP`), so the two disagreed.
import { apiRowToOrder } from '@/app/(tabs)/orders';
import { filterOrders } from '@/services/orderService';
import { useSellerThreadCashBalance } from '@/hooks/useSellerThreadCash';
import { THREAD_CASH_GREEN_MID, ThreadCashBillIcon } from '@/components/thread-cash/ThreadCashBill';
import { DASHBOARD_RANGES, SellerDashboardChart, type SellerDashboardRange } from '@/components/SellerDashboardChart';
import { SellerDashboardStatGrid, type SellerDashboardStatTileData } from '@/components/SellerDashboardStatGrid';
import { SellerDashboardActionNeeded } from '@/components/SellerDashboardActionNeeded';
import { useScrollReset } from '@/hooks/useScrollReset';
import { SellerDashboardTopProducts } from '@/components/SellerDashboardTopProducts';
import { SellerDashboardTrafficSources } from '@/components/SellerDashboardTrafficSources';
import { SellerDashboardRecentOrders } from '@/components/SellerDashboardRecentOrders';
import { SellerDashboardSetupCard } from '@/components/SellerDashboardSetupCard';
import {
  BG,
  FG,
  FONT,
  FS,
  GRID_MAX_WIDTH,
  MUTED,
  RADIUS,
  SCREEN_BG,
  SP,
} from '@/lib/theme';

type MetricKey = 'sales' | 'orders' | 'visitors' | 'conversion' | 'aov';

// Stable reference for "no data yet" — `data?.buckets ?? []` would otherwise
// hand a brand-new array to two useMemo dependencies on every render,
// defeating their memoization (same bug class as app/boost.tsx's infinite
// render loop, though here it doesn't set state so it isn't infinite).
const EMPTY_BUCKETS: SellerHomeAnalyticsSnapshot['data']['buckets'] = [];

interface FinanceBalance {
  available: { amount: number; currency: string; formatted: string };
  pending: { amount: number; currency: string; formatted: string };
  connected: boolean;
  payoutsEnabled?: boolean;
  bankConnected?: boolean;
  processingCashout?: {
    idempotencyKey: string;
    amount: number;
    currency: string;
    formatted: string;
  } | null;
}

interface PersistedCashoutAttempt {
  idempotencyKey: string;
  amount: number;
  currency: string;
}

function cashoutAttemptStorageKey(userId: string): string {
  return `bt:seller-cashout-attempt:${userId}`;
}

const PERIOD_LABEL: Record<SellerDashboardRange, string> = {
  today: 'yesterday',
  week: 'last week',
  month: 'last month',
  year: 'last year',
  all: '',
};

// Range-aware empty-chart copy — "No sales yet" alone reads the same for
// every range; naming the range itself (Shopify's own zero-state pattern)
// makes it clear which window is empty rather than implying the WHOLE store
// has never sold anything.
const EMPTY_CHART_MESSAGE: Record<SellerDashboardRange, string> = {
  today: 'No sales yet today',
  week: 'No sales yet this week',
  month: 'No sales yet this month',
  year: 'No sales yet this year',
  all: 'No sales yet',
};

// Live updates while the Dashboard is visible: there's no push/socket
// channel for new orders or Thread Cash events (see lib/live/* — that's Live
// -stream viewer presence, a different concern), so this polls at a short
// interval instead, matching the app's own established focus-poll pattern
// (see app/seller-inbox.tsx's 30s conversation poll). useFocusEffect's
// cleanup stops the interval the moment the screen loses focus — including
// when the user switches tabs or backgrounds the app onto another tab.
const LIVE_POLL_INTERVAL_MS = 30_000;

function metricSeries(
  metric: MetricKey,
  buckets: Array<{ totalCents: number; orderCount: number; visitorCount: number }>,
): number[] {
  switch (metric) {
    case 'sales': return buckets.map((b) => b.totalCents);
    case 'orders': return buckets.map((b) => b.orderCount);
    case 'visitors': return buckets.map((b) => b.visitorCount);
    case 'conversion': return buckets.map((b) => (b.visitorCount > 0 ? (b.orderCount / b.visitorCount) * 100 : 0));
    case 'aov': return buckets.map((b) => (b.orderCount > 0 ? Math.round(b.totalCents / b.orderCount) : 0));
    default: return [];
  }
}

function formatMetricValue(metric: MetricKey, value: number): string {
  if (metric === 'sales' || metric === 'aov') return formatCentsCompact(Math.round(value));
  if (metric === 'conversion') return `${value.toFixed(1)}%`;
  return formatCompactCount(Math.round(value));
}

function compactDelta(current: number, previous: number): { direction: 'up' | 'down' | 'flat'; label: string } {
  const change = computeMetricChange(current, previous);
  if (change.direction === 'flat') return { direction: 'flat', label: '—' };
  if (change.percent == null) return { direction: change.direction, label: 'New' };
  const sign = change.percent > 0 ? '+' : '';
  return { direction: change.direction, label: `${sign}${change.percent}%` };
}

export default function SellerHomeCommerceDashboard({
  topInset,
  userId,
  setupState,
  onSetupStateChange,
}: {
  topInset: number;
  userId: string | null | undefined;
  setupState: SetupState;
  onSetupStateChange: (next: SetupState) => void;
}) {
  const router = useRouter();
  const api = useApi();
  const { theme } = useAppTheme();
  const { currentRole, isLoadingRole } = useTeamRole();
  const { isTablet } = useBreakpoint();
  const tabBarMetrics = useTabBarMetrics(2); // seller bar: Studio + AI side circles
  const scrollResetRef = useScrollReset<ScrollView>();

  const [range, setRange] = useState<SellerDashboardRange>('week');
  const [metric, setMetric] = useState<MetricKey>('sales');
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<SellerHomeAnalyticsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  // Bumped whenever the seller switches between their own store and a joined
  // store so the analytics/orders/products sections refetch instead of
  // continuing to show the previous store's numbers (only the finance
  // balance below used to react to this).
  const [storeContextTick, setStoreContextTick] = useState(0);

  const [financeBalance, setFinanceBalance] = useState<FinanceBalance | null>(null);
  const [financeLoading, setFinanceLoading] = useState(true);
  const [cashingOut, setCashingOut] = useState(false);
  const balanceGenerationRef = useRef(0);
  const threadCash = useSellerThreadCashBalance();
  const payoutAttemptKeyRef = useRef<string | null>(null);

  const [topProducts, setTopProducts] = useState<TopProductSummary[] | null>(null);
  const [recentOrders, setRecentOrders] = useState<RecentOrderSummary[] | null>(null);
  const [everSoldCount, setEverSoldCount] = useState<number | null>(null);
  const [actionInputs, setActionInputs] = useState<{ unreadMessages: number; lowStockCount: number; returns: number; toShip: number } | null>(null);
  const [secondaryError, setSecondaryError] = useState(false);

  // The seller's own public store URL, shown next to the "Dashboard" title
  // and copied to the clipboard on tap — real even before the store is
  // published (Dev: "it's where the store will eventually live"). Uses the
  // one existing public-store-URL builder (lib/shareProfile.ts), not a new
  // one — same as app/meta-ads-setup.tsx's own storeUrl fetch.
  const [storeUrl, setStoreUrl] = useState<string | null>(null);
  const [storeUrlCopied, setStoreUrlCopied] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api.seller.getProfile().then((profile) => {
      if (cancelled) return;
      setStoreUrl(buildCanonicalProfileUrl(profile.username));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [api]);

  const handleCopyStoreUrl = useCallback(() => {
    if (!storeUrl) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    (async () => {
      if (Platform.OS === 'web') {
        await navigator?.clipboard?.writeText?.(storeUrl);
      } else {
        const Clipboard = await import('expo-clipboard');
        await Clipboard.setStringAsync(storeUrl);
      }
    })();
    setStoreUrlCopied(true);
    setTimeout(() => setStoreUrlCopied(false), 1200);
  }, [storeUrl]);

  useEffect(() => subscribeStoreContext(() => {
    // Drop the previous store's numbers immediately rather than leaving them
    // on screen until the refetch (triggered by storeContextTick below) resolves.
    setSnapshot(null);
    setTopProducts(null);
    setRecentOrders(null);
    setStoreContextTick((t) => t + 1);
  }), []);

  const data = selectSellerHomeAnalytics(snapshot, userId, range);

  const [walkthroughVisible, setWalkthroughVisible] = useState(false);
  const [celebrationVisible, setCelebrationVisible] = useState(false);
  const autoOpenedRef = useRef(false);
  const wasCompleteRef = useRef<boolean | null>(null);
  const setupComplete = isSetupComplete(setupState);
  const setupPercent = completionPercent(setupState);

  // Show the guided walkthrough automatically the first time a seller lands
  // on an incomplete dashboard (e.g. right after signup), then never again
  // uninvited — the "Continue setup" banner takes over from there.
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (!userId || setupComplete) return;
    if (setupState.walkthroughShown) return;
    autoOpenedRef.current = true;
    setWalkthroughVisible(true);
    void markWalkthroughShown(userId).then(onSetupStateChange);
  }, [onSetupStateChange, setupComplete, setupState.walkthroughShown, userId]);

  // One-time celebration the moment every required step becomes complete.
  useEffect(() => {
    if (wasCompleteRef.current === null) {
      wasCompleteRef.current = setupComplete;
      if (setupComplete && !setupState.celebrated && userId) {
        setCelebrationVisible(true);
        void markCelebrated(userId).then(onSetupStateChange);
      }
      return;
    }
    if (setupComplete && !wasCompleteRef.current && !setupState.celebrated && userId) {
      setCelebrationVisible(true);
      void markCelebrated(userId).then(onSetupStateChange);
    }
    wasCompleteRef.current = setupComplete;
  }, [onSetupStateChange, setupComplete, setupState.celebrated, userId]);

  // ── Range-scoped analytics (hero + chart + stat grid) ────────────────────
  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    let active = true;
    const requestKey = sellerHomeAnalyticsKey(userId, range);
    setLoading(true);

    // The dev web seller preview (?bt_preview=seller) has no real backend to
    // call — previously this fell through to api.analytics.home() against an
    // unreachable/placeholder host, which is exactly what produced the
    // reported bug (every range showing the same stale bucket data, "Year"
    // relabeling the current month 8x instead of 12 distinct trailing
    // months). Generate deterministic local chart data instead: a flat $0
    // baseline in fresh mode (a brand-new seller, never fake activity), or a
    // realistic, range-varying curve in demo mode (isPreviewDemoMode() —
    // explicit ?demo=1 opt-in). See lib/previewSellerChartData.ts and
    // lib/devPreview.ts.
    if (isSellerDevPreview()) {
      const next = buildPreviewSellerAnalytics(range, isPreviewDemoMode() ? 'demo' : 'fresh');
      setAnalyticsError(false);
      setSnapshot({ key: requestKey, data: next });
      setLoading(false);
      return () => { active = false; };
    }

    api.analytics.home(range as SellerHomeTimeRange)
      .then((next) => {
        if (!active) return;
        setAnalyticsError(false);
        setSnapshot({ key: requestKey, data: next });
      })
      .catch((requestError) => {
        if (!active) return;
        if (__DEV__) console.warn('[seller-dashboard] analytics unavailable', requestError);
        // Never fabricate a zero state — keep any stale snapshot and surface a real error banner instead.
        setAnalyticsError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [api, range, userId, retryTick, storeContextTick]);

  // ── Range-independent data (orders, inventory, hub, products) — fetched
  // once per seller/refresh, not re-fetched on every chart range switch. ────
  const loadSecondaryData = useCallback(async () => {
    if (!userId) {
      setTopProducts([]);
      setRecentOrders([]);
      setEverSoldCount(0);
      setActionInputs({ unreadMessages: 0, lowStockCount: 0, returns: 0, toShip: 0 });
      return;
    }
    setSecondaryError(false);
    try {
      const [ordersRaw, inventoryRaw, [quotes, samples, threads], productAnalytics, catalog] = await Promise.all([
        api.orders.list() as Promise<any[]>,
        api.inventory.list() as Promise<any[]>,
        Promise.all([
          api.sellerHub.quoteRequests.list(),
          api.manufacturers.sampleOrders.list(),
          api.manufacturers.threads.list(),
        ]) as Promise<[any[], any[], any[]]>,
        api.analytics.products() as Promise<any[]>,
        api.products.list() as Promise<any[]>,
      ]);

      const orders = Array.isArray(ordersRaw) ? ordersRaw : [];
      const inventory = Array.isArray(inventoryRaw) ? inventoryRaw : [];
      const hub = deriveHubStats(
        Array.isArray(quotes) ? quotes : [],
        Array.isArray(samples) ? samples : [],
        Array.isArray(threads) ? threads : [],
      );
      const inv = deriveInventoryStats(inventory);

      setEverSoldCount(orders.length);
      setRecentOrders(orders.slice(0, 5).map(normalizeRecentOrder));
      // Same normalizer + same filter Orders' "Unfulfilled" chip uses, over
      // this same fetched list — the tile and the screen can't disagree.
      const toShip = filterOrders(orders.map(apiRowToOrder), 'unfulfilled').length;
      setActionInputs({
        unreadMessages: hub.unreadMessages,
        lowStockCount: inv.lowStockCount,
        returns: countOrderReturns(orders),
        toShip,
      });

      const top = Array.isArray(productAnalytics)
        ? productAnalytics
          .filter((p) => Number(p?.revenueCents ?? 0) > 0)
          .map((p) => ({
            productId: String(p.productId),
            name: String(p.name ?? 'Untitled product'),
            unitsSold: Number(p.unitsSold ?? 0),
            revenueCents: Number(p.revenueCents ?? 0),
          }))
        : [];
      setTopProducts(mergeTopProductImages(top, Array.isArray(catalog) ? catalog : []));
    } catch (error) {
      if (__DEV__) console.warn('[seller-dashboard] secondary data unavailable', error);
      setSecondaryError(true);
    }
  }, [api, userId]);

  useEffect(() => { void loadSecondaryData(); }, [loadSecondaryData, retryTick, storeContextTick]);

  const loadFinanceBalance = useCallback(async () => {
    const generation = ++balanceGenerationRef.current;
    if (!userId || isLoadingRole || currentRole !== 'owner') {
      setFinanceBalance(null);
      setFinanceLoading(isLoadingRole);
      return;
    }
    setFinanceBalance(null);
    setFinanceLoading(true);
    try {
      const next = await api.finance.balance() as FinanceBalance;
      if (balanceGenerationRef.current === generation) setFinanceBalance(next);
    } catch {
      if (balanceGenerationRef.current === generation) setFinanceBalance(null);
    } finally {
      if (balanceGenerationRef.current === generation) setFinanceLoading(false);
    }
  }, [api, currentRole, isLoadingRole, userId]);

  useEffect(() => { void loadFinanceBalance(); }, [loadFinanceBalance]);

  // Auto-check "Set up payments" the moment real payout data confirms Stripe
  // Connect is live — real data, not a manual tap, drives this step.
  useEffect(() => {
    if (!userId || !financeBalance?.connected) return;
    const task = setupState.tasks.find((t) => t.id === 'connect_payments');
    if (!task || task.completed) return;
    void completeTask('connect_payments', userId).then(onSetupStateChange);
  }, [financeBalance?.connected, onSetupStateChange, setupState.tasks, userId]);

  useEffect(() => subscribeStoreContext(() => {
    balanceGenerationRef.current += 1;
    payoutAttemptKeyRef.current = null;
    setFinanceBalance(null);
    void loadFinanceBalance();
  }), [loadFinanceBalance]);

  useEffect(() => { payoutAttemptKeyRef.current = null; }, [userId]);

  // ── Live updates: refresh on regaining focus, then poll while visible ────
  // `retryTick` already drives both the range-scoped analytics fetch and
  // loadSecondaryData (orders/inventory/hub/products) below — bumping it is
  // the same real refetch pull-to-refresh already triggers, just on a timer
  // instead of a gesture.
  const hasFocusedOnceRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (hasFocusedOnceRef.current) {
        // Not the very first mount — the seller is RETURNING to this screen
        // (tab switch back, popped from another screen), so refresh
        // immediately rather than waiting for the next poll tick.
        setRetryTick((n) => n + 1);
      }
      hasFocusedOnceRef.current = true;

      const interval = setInterval(() => setRetryTick((n) => n + 1), LIVE_POLL_INTERVAL_MS);
      return () => clearInterval(interval);
    }, []),
  );

  const nav = useCallback((route: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    router.push(route as never);
  }, [router]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setRetryTick((n) => n + 1);
    await loadSecondaryData();
    setRefreshing(false);
  }, [loadSecondaryData]);

  const requestCashOut = useCallback(() => {
    if (currentRole !== 'owner') {
      Alert.alert('Owner access required', 'Only the store owner can cash out earnings.');
      return;
    }
    if (
      !financeBalance?.connected
      || financeBalance.payoutsEnabled !== true
      || financeBalance.bankConnected !== true
    ) {
      Alert.alert(
        'Finish bank setup',
        'Connect and verify your bank account before cashing out.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open payouts', onPress: () => nav('/payouts') },
        ],
      );
      return;
    }
    const processingCashout = financeBalance.processingCashout;
    const amount = processingCashout?.amount ?? financeBalance.available.amount;
    const currency = processingCashout?.currency ?? financeBalance.available.currency;
    const formattedAmount = processingCashout?.formatted ?? financeBalance.available.formatted;
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      Alert.alert('No available balance', 'Money still processing will move from Pending Balance to Available Balance when it can be paid out.');
      return;
    }

    Alert.alert(
      `${processingCashout ? 'Finish cash out' : 'Cash out'} ${formattedAmount}?`,
      processingCashout
        ? 'This safely retries the same bank payout. It will not create a second cash out.'
        : 'This will send your full available balance to your connected bank account. Bank processing times may apply.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Cash out',
          onPress: () => {
            void (async () => {
              if (!userId) return;
              const storageKey = cashoutAttemptStorageKey(userId);
              let idempotencyKey = processingCashout?.idempotencyKey ?? payoutAttemptKeyRef.current;
              try {
                if (!idempotencyKey) {
                  const storedValue = await AsyncStorage.getItem(storageKey);
                  if (storedValue) {
                    const stored = JSON.parse(storedValue) as PersistedCashoutAttempt;
                    if (
                      stored.amount === amount
                      && stored.currency === currency
                      && /^[A-Za-z0-9_-]{16,128}$/.test(stored.idempotencyKey)
                    ) {
                      idempotencyKey = stored.idempotencyKey;
                    }
                  }
                }
                idempotencyKey ??= `cashout_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
                await AsyncStorage.setItem(storageKey, JSON.stringify({
                  idempotencyKey,
                  amount,
                  currency,
                } satisfies PersistedCashoutAttempt));
              } catch {
                Alert.alert(
                  'Could not cash out',
                  'This device could not save a safe retry record. Free up storage and try again.',
                );
                return;
              }
              payoutAttemptKeyRef.current = idempotencyKey;
              setCashingOut(true);
              try {
                const payout = await api.finance.payout({
                  idempotencyKey,
                  amount,
                  currency,
                });
                payoutAttemptKeyRef.current = null;
                await AsyncStorage.removeItem(storageKey).catch(() => {});
                await loadFinanceBalance();
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                Alert.alert(
                  'Cash out requested',
                  `${payout.formatted ?? financeBalance.available.formatted} is being sent to your bank account.`,
                );
              } catch (error) {
                if (
                  error instanceof ApiError
                  && error.status < 500
                  && error.code !== 'PAYOUT_REVIEW_REQUIRED'
                ) {
                  payoutAttemptKeyRef.current = null;
                  await AsyncStorage.removeItem(storageKey).catch(() => {});
                }
                const message = error instanceof ApiError && error.code === 'FUNDS_RESERVED_FOR_LABELS'
                  ? 'Part of this balance is reserved for shipping labels. Your available balance has been refreshed.'
                  : error instanceof ApiError && error.code === 'BALANCE_CHANGED'
                    ? 'Your available balance changed. Review the refreshed amount before confirming again.'
                  : error instanceof ApiError && error.code === 'PAYOUTS_NOT_ENABLED'
                    ? 'Finish verifying your connected bank account before cashing out.'
                    : error instanceof ApiError && error.code === 'PAYOUT_REVIEW_REQUIRED'
                      ? 'This payout needs review before it can continue. Do not start another cash out for the same funds.'
                    : 'The cash-out request could not be confirmed. Try again to safely retry the same request.';
                await loadFinanceBalance();
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
                Alert.alert('Could not cash out', message);
              } finally {
                setCashingOut(false);
              }
            })();
          },
        },
      ],
    );
  }, [api, currentRole, financeBalance, loadFinanceBalance, nav, userId]);

  const openTask = useCallback((task: SetupTask) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // replace (not push): a setup task destination returns to the dashboard
    // itself (see SELLER_HOME_ROUTE in each destination screen), so pushing
    // would leave a dead, unreachable dashboard scene underneath it.
    router.replace(withSellerSetupOrigin(task.route) as never);
  }, [router]);

  const addProductTask = setupState.tasks.find((task) => task.id === 'first_product') ?? null;
  const newSeller = everSoldCount !== null && isNewSeller(everSoldCount);
  const actionCounts: DashboardActionCounts | null = actionInputs ? {
    toShip: actionInputs.toShip,
    toAnswer: actionInputs.unreadMessages,
    lowStock: actionInputs.lowStockCount,
    returns: actionInputs.returns,
  } : null;

  // ── Metric aggregate + chart series for the currently focused metric ─────
  const buckets = data?.buckets ?? EMPTY_BUCKETS;
  const series = useMemo(() => metricSeries(metric, buckets), [metric, buckets]);
  const labels = useMemo(() => buckets.map((b) => bucketLabel(b.bucket, range as SellerHomeTimeRange)), [buckets, range]);

  const metricAggregate = useMemo(() => {
    if (!data) return { current: 0, previous: 0 };
    // A response with no `previous` bucket (a brand-new store, or a partial
    // payload) must not crash the dashboard — treat it as a zeroed prior period.
    const previous = data.previous ?? { totalCents: 0, netCents: 0, orderCount: 0, visitorCount: 0 };
    switch (metric) {
      case 'sales': return { current: data.totalCents, previous: previous.totalCents };
      case 'orders': return { current: data.orderCount, previous: previous.orderCount };
      case 'visitors': return { current: data.visitorCount, previous: previous.visitorCount };
      case 'conversion': return {
        current: data.visitorCount > 0 ? (data.orderCount / data.visitorCount) * 100 : 0,
        previous: previous.visitorCount > 0 ? (previous.orderCount / previous.visitorCount) * 100 : 0,
      };
      case 'aov': return {
        current: data.orderCount > 0 ? Math.round(data.totalCents / data.orderCount) : 0,
        previous: previous.orderCount > 0 ? Math.round(previous.totalCents / previous.orderCount) : 0,
      };
      default: return { current: 0, previous: 0 };
    }
  }, [data, metric]);

  const isEmptyChart = newSeller || buckets.every((b) => b.totalCents === 0 && b.orderCount === 0 && b.visitorCount === 0);
  const activeValue = scrubIndex !== null && series[scrubIndex] != null ? series[scrubIndex] : metricAggregate.current;
  const heroDisplay = useCountUp(Math.round(activeValue), scrubIndex === null);
  // The delta line is computed instantly from metricAggregate (no animation),
  // but the hero number above it counts up over ~650ms — showing the delta
  // before the count-up settles would briefly (or, if requestAnimationFrame
  // stalls, not-so-briefly) show a total and a delta that don't agree. Only
  // reveal the delta once the displayed hero number has actually caught up.
  const heroSettled = heroDisplay === Math.round(activeValue);
  const scrubLabel = scrubIndex !== null ? labels[scrubIndex] : null;

  const periodLabel = PERIOD_LABEL[range];
  const deltaFormatter = metric === 'sales' || metric === 'aov' ? formatCents
    : metric === 'conversion' ? (n: number) => `${n.toFixed(1)}%`
    : (n: number) => formatCompactCount(Math.round(n));
  const deltaLine = data && range !== 'all' && periodLabel
    ? describeDashboardDelta(metricAggregate.current, metricAggregate.previous, deltaFormatter, periodLabel)
    : null;

  const metricLabelText: Record<MetricKey, string> = {
    sales: 'Total sales', orders: 'Orders', visitors: 'Visitors', conversion: 'Conversion rate', aov: 'Avg order value',
  };

  const tiles: SellerDashboardStatTileData[] = data ? (['orders', 'visitors', 'conversion', 'aov'] as MetricKey[]).map((key) => {
    const tilesPrevious = data.previous ?? { totalCents: 0, netCents: 0, orderCount: 0, visitorCount: 0 };
    const agg = key === 'orders' ? { current: data.orderCount, previous: tilesPrevious.orderCount }
      : key === 'visitors' ? { current: data.visitorCount, previous: tilesPrevious.visitorCount }
      : key === 'conversion' ? {
        current: data.visitorCount > 0 ? (data.orderCount / data.visitorCount) * 100 : 0,
        previous: tilesPrevious.visitorCount > 0 ? (tilesPrevious.orderCount / tilesPrevious.visitorCount) * 100 : 0,
      }
      : {
        current: data.orderCount > 0 ? Math.round(data.totalCents / data.orderCount) : 0,
        previous: tilesPrevious.orderCount > 0 ? Math.round(tilesPrevious.totalCents / tilesPrevious.orderCount) : 0,
      };
    const delta = compactDelta(agg.current, agg.previous);
    return {
      key,
      label: metricLabelText[key],
      value: formatMetricValue(key, agg.current),
      deltaLabel: delta.label,
      deltaDirection: delta.direction,
    };
  }) : [];

  return (
    <View style={[styles.root, { backgroundColor: theme.background ?? SCREEN_BG }]}>
      <ScrollView
        ref={scrollResetRef}
        testID="seller-dashboard-scroll"
        accessibilityLabel="Seller dashboard scroll"
        style={styles.scrollView}
        contentContainerStyle={[styles.scroll, { paddingTop: topInset + 12, paddingBottom: tabBarMetrics.occupiedHeight + SP.md }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} colors={[theme.accent]} />
        }
      >
        <ResponsiveContainer maxWidth={GRID_MAX_WIDTH}>
          {/* ── Top bar ─────────────────────────────────────────────────── */}
          <View style={styles.topBar}>
            <View testID="seller-dashboard-scroll-position" accessibilityLabel="Seller dashboard scroll position" accessible style={styles.titleRow}>
              <Text style={[styles.screenTitle, { color: theme.text ?? FG }]}>Dashboard</Text>
              {storeUrl && (
                <TouchableOpacity
                  onPress={handleCopyStoreUrl}
                  style={styles.storeUrlRow}
                  hitSlop={{ top: 10, bottom: 10, left: 4, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel="Copy store link"
                  testID="seller-dashboard-store-url"
                >
                  <Text style={[styles.storeUrlText, { color: theme.muted }]} numberOfLines={1} ellipsizeMode="middle">
                    {middleTruncate(storeUrl.replace(/^https?:\/\//, ''))}
                  </Text>
                  <Feather name={storeUrlCopied ? 'check' : 'copy'} size={13} color={theme.muted} />
                </TouchableOpacity>
              )}
            </View>
            <ActivityBellButton
              testID="seller-dashboard-activity"
              color={theme.text ?? FG}
              size={22}
              style={styles.topBarAction}
              badgeBorderColor={theme.background ?? BG}
            />
          </View>

          {!data && analyticsError ? (
            <View style={styles.errorBanner} testID="seller-dashboard-error">
              <Feather name="alert-circle" size={16} color={theme.error} />
              <Text style={[styles.errorText, { color: theme.error }]}>Couldn’t load your dashboard.</Text>
              <TouchableOpacity onPress={() => setRetryTick((n) => n + 1)} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }} accessibilityRole="button" accessibilityLabel="Retry loading the dashboard">
                <Text style={[styles.retryText, { color: theme.accent }]}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : !data ? (
            <View style={styles.heroSkeleton}>
              <SkeletonBlock width={180} height={16} radius={RADIUS.sm} />
              <SkeletonBlock width={240} height={48} radius={RADIUS.md} style={{ marginTop: SP.sm }} />
              <SkeletonBlock width="100%" height={168} radius={RADIUS.md} style={{ marginTop: SP.lg }} />
            </View>
          ) : (
            <>
              {/* ── Hero + scrubbable chart ────────────────────────────── */}
              <PressableScale onPress={() => setMetric('sales')} style={styles.heroWrap} accessibilityRole="button" accessibilityLabel="Show Total sales in the chart">
                <Text style={[styles.heroLabel, { color: theme.muted }]}>
                  {scrubLabel ?? metricLabelText[metric]}
                </Text>
                <Text
                  style={[styles.heroValue, { color: theme.text }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.5}
                  testID="seller-dashboard-hero-value"
                >
                  {formatMetricValue(metric, heroDisplay)}
                </Text>
                {isEmptyChart && scrubIndex === null ? (
                  // Never a fabricated "+31.1%"-style comparison for a
                  // brand-new/zero-sales account — matches Shopify's own
                  // zero-state chart ("$0.00 —", no percent).
                  <Text style={[styles.heroDelta, { color: theme.muted }]}>{EMPTY_CHART_MESSAGE[range]}</Text>
                ) : deltaLine && scrubIndex === null && heroSettled ? (
                  <Text
                    style={[
                      styles.heroDelta,
                      { color: deltaLine.direction === 'flat' ? theme.muted : theme.text },
                    ]}
                  >
                    {deltaLine.direction === 'up' ? '↑ ' : deltaLine.direction === 'down' ? '↓ ' : ''}
                    {deltaLine.label}
                  </Text>
                ) : (
                  <Text style={[styles.heroDelta, { color: theme.muted }]}>
                    {range === 'all' ? 'All-time' : ' '}
                  </Text>
                )}
              </PressableScale>

              <SellerDashboardChart
                values={series}
                labels={labels}
                theme={theme}
                range={range}
                onRangeChange={(next) => { setRange(next); setScrubIndex(null); }}
                onScrub={setScrubIndex}
                isEmpty={isEmptyChart}
                formatValue={(v) => formatMetricValue(metric, v)}
                emptyMessage={EMPTY_CHART_MESSAGE[range]}
                showNowMarker={range === 'today'}
              />

              {/* ── Stat tile grid ───────────────────────────────────────── */}
              {!newSeller && (
                <View style={styles.section}>
                  <SellerDashboardStatGrid tiles={tiles} activeKey={metric} onSelect={(key) => setMetric(key as MetricKey)} theme={theme} />
                </View>
              )}

              {/* ── Balance / withdraw ───────────────────────────────────── */}
              {currentRole === 'owner' && (
                <View style={[styles.section, styles.balanceRow, { borderColor: theme.borderSubtle }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.balanceLabel, { color: theme.muted }]}>Available balance</Text>
                    <Text style={[styles.balanceValue, { color: theme.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                      {financeLoading ? '···' : financeBalance?.available.formatted ?? '$0.00'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    testID="seller-dashboard-cash-out"
                    style={[styles.withdrawButton, { backgroundColor: theme.accent }, (financeLoading || cashingOut) && styles.withdrawButtonDisabled]}
                    activeOpacity={0.82}
                    disabled={financeLoading || cashingOut}
                    onPress={requestCashOut}
                    accessibilityRole="button"
                    accessibilityLabel="Withdraw available balance"
                  >
                    {cashingOut ? <ActivityIndicator size="small" color={theme.onAccent} /> : (
                      <Text style={[styles.withdrawButtonText, { color: theme.onAccent }]}>Withdraw</Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}

              {/* ── Thread Cash — small row, links to the Payouts card/cash-out ── */}
              {currentRole === 'owner' && (
                <TouchableOpacity
                  style={[styles.section, styles.threadCashRow, { borderColor: theme.borderSubtle }]}
                  activeOpacity={0.8}
                  onPress={() => nav('/payouts')}
                  accessibilityRole="button"
                  accessibilityLabel="Thread Cash balance, open Payouts"
                  testID="seller-dashboard-thread-cash-row"
                >
                  <ThreadCashBillIcon size={16} />
                  <Text style={[styles.threadCashLabel, { color: theme.muted }]}>Thread Cash</Text>
                  <View style={{ flex: 1 }} />
                  <Text style={[styles.threadCashValue, { color: THREAD_CASH_GREEN_MID }]}>
                    {threadCash.loading ? '···' : formatCents(threadCash.balanceCents ?? 0)}
                  </Text>
                  <Feather name="chevron-right" size={16} color={theme.subtle} />
                </TouchableOpacity>
              )}

              {/* ── Action needed / top products / recent orders, or the new-seller setup card ── */}
              <View style={isTablet ? styles.tabletRow : undefined}>
                {newSeller ? (
                  <View style={[isTablet && styles.tabletRowItem, styles.section]}>
                    <SellerDashboardSetupCard
                      theme={theme}
                      hasSetupChecklist={Boolean(addProductTask)}
                      onAddProduct={() => nav(withSellerSetupOrigin('/add-product'))}
                      onOpenSetup={() => (addProductTask ? openTask(addProductTask) : nav(withSellerSetupOrigin('/add-product')))}
                    />
                  </View>
                ) : actionCounts ? (
                  <View style={[isTablet && styles.tabletRowItem, styles.section]}>
                    <SellerDashboardActionNeeded counts={actionCounts} theme={theme} onNavigate={nav} />
                  </View>
                ) : null}

                {!newSeller && secondaryError && (
                  <View style={[isTablet && styles.tabletRowItem, styles.errorBanner]}>
                    <Feather name="alert-circle" size={16} color={theme.error} />
                    <Text style={[styles.errorText, { color: theme.error }]}>Some dashboard data couldn’t load.</Text>
                    <TouchableOpacity onPress={() => setRetryTick((n) => n + 1)} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }} accessibilityRole="button" accessibilityLabel="Retry loading dashboard data">
                      <Text style={[styles.retryText, { color: theme.accent }]}>Retry</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {!newSeller && topProducts && topProducts.length > 0 && (
                <View style={styles.section}>
                  <SellerDashboardTopProducts
                    products={topProducts}
                    theme={theme}
                    onOpenProduct={() => nav('/(tabs)/products')}
                    onSeeAll={() => nav('/(tabs)/products')}
                  />
                </View>
              )}

              {/* Shown even for a brand-new seller — traffic can exist before
                  the first sale, and the panel already has a real "No store
                  visits yet" zero state below (never hidden behind the
                  sales-only newSeller setup card). */}
              {data && (
                <View style={styles.section}>
                  <SellerDashboardTrafficSources
                    totalVisits={data.visitorCount}
                    previousVisits={data.previous?.visitorCount ?? 0}
                    periodLabel={range !== 'all' ? PERIOD_LABEL[range] : null}
                    trafficSources={data.trafficSources}
                    theme={theme}
                    onSeeAll={() => nav('/analytics-store')}
                    onOpenSource={() => nav('/analytics-store')}
                    onShareStore={() => nav('/share-store')}
                  />
                </View>
              )}

              {!newSeller && recentOrders && recentOrders.length > 0 && (
                <View style={styles.section}>
                  <SellerDashboardRecentOrders
                    orders={recentOrders}
                    onOpenOrder={(id) => nav(`/order-detail?id=${id}`)}
                    onSeeAll={() => nav('/(tabs)/orders')}
                  />
                </View>
              )}
            </>
          )}

          {/* ── Setup checklist: "Continue setup" banner opens the guided
              walkthrough sheet, which owns the full task list — no separate
              inline checklist duplicated here. ──────────────────────────── */}
          {!setupComplete && setupState.walkthroughShown && (
            <View style={styles.section}>
              <SetupContinueBanner
                percent={setupPercent}
                nextLabel={nextTask(setupState)?.label ?? null}
                onPress={() => setWalkthroughVisible(true)}
              />
            </View>
          )}
        </ResponsiveContainer>
        <View testID="seller-dashboard-scroll-end" accessibilityLabel="Seller dashboard scroll end" style={styles.scrollEndMarker} />
      </ScrollView>

      <SetupWalkthroughSheet
        visible={walkthroughVisible}
        onClose={() => setWalkthroughVisible(false)}
        userId={userId}
        setupState={setupState}
        onSetupStateChange={onSetupStateChange}
      />
      <SetupCelebration
        visible={celebrationVisible}
        onDismiss={() => setCelebrationVisible(false)}
      />
    </View>
  );
}

// Re-exported so the range pills stay in one place for anything that needs
// the canonical dashboard range list (e.g. tests).
export { DASHBOARD_RANGES };

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SCREEN_BG },
  // flex: 1 on the ScrollView itself is required on iOS so the layout engine
  // gives it a bounded height and allows inner content to scroll correctly.
  scrollView: { flex: 1 },
  scroll: { flexGrow: 1 },
  scrollEndMarker: { height: 1 },

  // Matches the shared root-page Header's exact title/row treatment (Discover
  // is the reference) — this title has to stay inside the scrolling content
  // rather than move into a fixed <Header>, per the native device contract
  // in tests/seller-dashboard-native-contract.test.ts that swipes the
  // ScrollView and checks this exact testID marker's position moves.
  topBar: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topBarAction: { width: 44, height: 44, marginRight: -SP.sm },
  // flex: 1 so the store-url row below has room to shrink/truncate instead
  // of pushing the fixed-size activity bell off the right edge; the
  // ActivityBellButton itself keeps its own fixed width, unaffected.
  titleRow: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: SP.sm, marginRight: SP.sm },
  screenTitle: { fontFamily: FONT.bold, fontSize: FS.lg, letterSpacing: -0.4 },
  // The seller's public store URL, baseline-aligned with the title, never
  // wrapping — flexShrink lets IT truncate (middle-ellipsis) before the row
  // itself would ever wrap. No background/border — a plain silver link, per
  // Dev's "no toast, no wording" instinct for this whole affordance.
  storeUrlRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  storeUrlText: { flexShrink: 1, fontFamily: FONT.regular, fontSize: 13 },

  heroSkeleton: { paddingTop: SP.md },

  heroWrap: { paddingTop: SP.sm, paddingBottom: SP.sm, alignItems: 'flex-start' },
  heroLabel: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  heroValue: {
    fontFamily: FONT.bold,
    fontSize: FS.h1,
    letterSpacing: -1.2,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
    width: '100%',
  },
  heroDelta: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    marginTop: 4,
  },

  section: { marginTop: SP.xl },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    marginTop: SP.md,
    padding: SP.sm,
  },
  errorText: { fontSize: 13, lineHeight: 18, fontFamily: FONT.medium, flex: 1 },
  retryText: { fontSize: 13, fontFamily: FONT.bold },

  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.md,
    paddingTop: SP.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  balanceLabel: { fontFamily: FONT.semibold, fontSize: FS.xs, textTransform: 'uppercase', letterSpacing: 0.6 },
  balanceValue: { fontFamily: FONT.bold, fontSize: FS.lg, marginTop: 2, fontVariant: ['tabular-nums'] },
  withdrawButton: {
    minHeight: 44,
    paddingHorizontal: SP.md,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  withdrawButtonDisabled: { opacity: 0.5 },
  withdrawButtonText: { fontFamily: FONT.bold, fontSize: FS.sm },

  threadCashRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    minHeight: 44,
    paddingTop: SP.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  threadCashLabel: { fontFamily: FONT.medium, fontSize: FS.sm },
  threadCashValue: { fontFamily: FONT.bold, fontSize: FS.sm, fontVariant: ['tabular-nums'] },

  tabletRow: { flexDirection: 'row', gap: SP.lg, alignItems: 'flex-start' },
  tabletRowItem: { flex: 1, minWidth: 0 },

  sectionHeaderRow: { marginBottom: SP.sm },
  sectionHeaderLabel: {
    color: MUTED,
    fontFamily: FONT.bold,
    fontSize: FS.xs,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  setupList: { borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden' },
  setupCard: {
    minHeight: 80,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
  },
  setupIcon: { width: 40, height: 40, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  setupCopy: { flex: 1, minWidth: 0 },
  setupTitle: { fontFamily: FONT.semibold, fontSize: FS.sm, letterSpacing: -0.1 },
  setupDescription: { fontFamily: FONT.regular, fontSize: FS.xs, lineHeight: 17, marginTop: 3 },
  optionsButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
