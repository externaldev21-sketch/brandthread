import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tipTargetProps } from '@/components/first-run-tips/tipTargets';
import { ActivityIndicator, Alert, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useRouter, useFocusEffect } from 'expo-router';

import { useAuth } from '@clerk/expo';

import { haptics, haptic } from '@/lib/haptics';


import AsyncStorage from '@react-native-async-storage/async-storage';

import { useApi } from '@/hooks/useApi';

import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';

import { useAppTheme } from '@/contexts/AppThemeContext';

import { ApiError } from '@/lib/networkNotice';

import { useTeamRole } from '@/hooks/useTeamRole';

import { subscribeStoreContext } from '@/lib/api';

import { selectSellerHomeAnalytics, sellerHomeAnalyticsKey, type SellerHomeAnalyticsSnapshot } from '@/lib/sellerHomeAnalytics';

import { completeTask, markWalkthroughShown, markCelebrated, type SetupState, type SetupTask } from '@/lib/setupStore';
import { useLaunchChecklist } from '@/hooks/useLaunchChecklist';
import { LAUNCH_STEP_META, launchProgress } from '@/lib/launchChecklist';

import { withOrigin } from '@/lib/navigation/flowOrigin';

import { useStoreLink } from '@/hooks/useStoreLink';

import { navigateOrShareStore } from '@/lib/shareStoreSheet';

import { previewSellerBrandName } from '@/lib/previewIdentity';
import { Avatar } from '@/components/ui/Avatar';
import { middleTruncate } from '@/lib/middleTruncate';

import SetupWalkthroughSheet from '@/components/SetupWalkthroughSheet';
import SetupContinueBanner from '@/components/SetupContinueBanner';
import SetupCelebration from '@/components/SetupCelebration';
import LaunchChecklistCard from '@/components/LaunchChecklistCard';
import DashboardTopCard, { pickTopCard, type DashboardTopCardCandidate } from '@/components/dashboard/DashboardTopCard';
import MorningBriefCard from '@/components/dashboard/MorningBriefCard';
import MilestoneCard from '@/components/dashboard/MilestoneCard';
import { useMorningBrief } from '@/hooks/useMorningBrief';
import { useMilestone } from '@/hooks/useMilestone';
import { TOP_CARD_PRIORITY } from '@/lib/dashboardTopCard';
import { primaryActionRoute } from '@/lib/morningBrief';
import { hapticLight } from '@/lib/haptics';
import { ResponsiveContainer, SkeletonBlock, useBreakpoint } from '@/components/layout';

import ActivityBellButton from '@/components/ActivityBellButton';
import { PressableScale } from '@/components/BrandthreadUI';

import { bucketLabel, type SellerHomeTimeRange } from '@/lib/sellerHomeChartLabels';

import { isSellerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';

import { apiDashboardSource, previewDashboardSource, type DashboardFinanceBalance, type SellerDashboardSource } from '@/lib/sellerDashboardSource';

import { formatCents } from '@/lib/money';

import { formatCentsCompact, formatCompactCount } from '@/lib/compactFormat';

import { computeMetricChange } from '@/lib/sellerMetricChange';

import { deriveDashboardSecondary, isNewSeller, type DashboardActionCounts, type RecentOrderSummary, type TopProductSummary } from '@/lib/sellerDashboardStats';

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
import { FirstWeekCard, useFirstWeek } from '@/components/FirstWeekCard';

import { SellerDashboardAISuggestions } from '@/components/SellerDashboardAISuggestions';

import { ReadyToSellChecklist } from '@/components/ReadyToSellChecklist';

import { useReadyToSell } from '@/hooks/useReadyToSell';

import { BG, FG, FONT, FS, GRID_MAX_WIDTH, MUTED, RADIUS, SCREEN_BG, SP } from '@/lib/theme';

import { Icon } from '@/components/ui/Icon';

import { updateSellerTodayWidget } from '@/lib/nativeSystem';
import { SellerDashboardTodo, SHIP_NOW_ROUTE } from '@/components/SellerDashboardTodo';
import { SellerDashboardHomeRange } from '@/components/SellerDashboardHomeRange';
import { SellerDashboardQuickActions } from '@/components/SellerDashboardQuickActions';
import { SellerDashboardPayoutCard } from '@/components/SellerDashboardPayoutCard';
import { SellerDashboardActivityFeed } from '@/components/SellerDashboardActivityFeed';
import { SellerDashboardSectionTitle } from '@/components/SellerDashboardSectionTitle';
import { SellerOrderGlobe } from '@/components/SellerOrderGlobe';
import { useSellerLiveMap } from '@/hooks/useSellerLiveMap';
import {
  HOME_RANGE_COMPARISON,
  HOME_RANGE_EMPTY_MESSAGE,
  describeHomeDelta,
  groupBucketsByWeek,
  mergeDashboardActivity,
  type DashboardActivityItem,
  type SellerHomeDashboardRange,
} from '@/lib/sellerDashboardHome';


type MetricKey = 'sales' | 'orders' | 'visitors' | 'conversion' | 'aov';

// Stable reference for "no data yet" — `data?.buckets ?? []` would otherwise
// hand a brand-new array to two useMemo dependencies on every render,
// defeating their memoization (same bug class as app/boost.tsx's infinite
// render loop, though here it doesn't set state so it isn't infinite).
const EMPTY_BUCKETS: SellerHomeAnalyticsSnapshot['data']['buckets'] = [];

type FinanceBalance = DashboardFinanceBalance;

interface PersistedCashoutAttempt {
  idempotencyKey: string;
  amount: number;
  currency: string;
}

const PREVIEW_ANALYTICS_USER = 'preview-seller';

function cashoutAttemptStorageKey(userId: string): string {
  return `bt:seller-cashout-attempt:${userId}`;
}

// "yesterday", "previous 7 days", … — the Traffic sources panel's own
// "vs …" line reads the same comparison as the hero's delta.
const PERIOD_LABEL: Record<SellerHomeDashboardRange, string> = {
  today: HOME_RANGE_COMPARISON.today.replace(/^vs /, ''),
  '7d': HOME_RANGE_COMPARISON['7d'].replace(/^vs /, ''),
  '30d': HOME_RANGE_COMPARISON['30d'].replace(/^vs /, ''),
  '90d': HOME_RANGE_COMPARISON['90d'].replace(/^vs /, ''),
};

// Scope suffix for the Orders tile: it counts orders in the selected range,
// while "N orders to ship" below is every open order — without the scope the
// two numbers read as contradictory.
const ORDERS_TILE_SCOPE: Record<SellerDashboardRange | SellerHomeDashboardRange, string> = {
  today: 'today',
  week: 'this week',
  month: 'this month',
  year: 'this year',
  all: 'all time',
  '7d': 'in the last 7 days',
  '30d': 'in the last 30 days',
  '90d': 'in the last 90 days',
};

// Range-aware empty-chart copy — "No sales yet" alone reads the same for
// every range; naming the range itself (Shopify's own zero-state pattern)
// makes it clear which window is empty rather than implying the WHOLE store
// has never sold anything.
const EMPTY_CHART_MESSAGE: Record<SellerHomeDashboardRange, string> = HOME_RANGE_EMPTY_MESSAGE;

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
  // Full precision under $10k; compact ($12.4K) only above, so the hero never flips formats mid-day.
  if (metric === 'sales' || metric === 'aov') return Math.abs(value) < 1_000_000 ? formatCents(Math.round(value)) : formatCentsCompact(Math.round(value));
  if (metric === 'conversion') return `${value.toFixed(1)}%`;
  return formatCompactCount(Math.round(value));
}

function compactDelta(current: number, previous: number): { direction: 'up' | 'down' | 'flat'; label: string } {
  const change = computeMetricChange(current, previous);
  if (change.direction === 'flat') return { direction: 'flat', label: '' };
  if (change.percent == null) return { direction: change.direction, label: 'New' };
  // Unsigned: the tile draws the ↑/↓ arrow.
  return { direction: change.direction, label: `${Math.abs(change.percent)}%` };
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
  const { isSignedIn } = useAuth();
  const api = useApi();
  const { theme } = useAppTheme();
  const { currentRole, isLoadingRole } = useTeamRole();
  const { isTablet } = useBreakpoint();
  const sellerPreview = isSellerDevPreview();
  // One code path for every number below: the real API for a signed-in
  // seller, or the seeded demo store answering the same calls in the same
  // shapes for the signed-out preview (lib/sellerDashboardSource.ts).
  const previewMode = sellerPreview ? (isPreviewDemoMode() ? 'demo' : 'fresh') : null;
  const source: SellerDashboardSource = useMemo(
    () => (previewMode ? previewDashboardSource(previewMode) : apiDashboardSource(api)),
    [api, previewMode],
  );
  const analyticsUserId = sellerPreview ? userId ?? PREVIEW_ANALYTICS_USER : userId;
  // Scroll content must end ABOVE the floating bar — tab bar height + bottom
  // safe inset + 16 (shared helper, same rule app-wide).
  const tabBarMetrics = useTabBarMetrics(2); // seller bar: Studio + AI side circles
  const scrollResetRef = useScrollReset<ScrollView>();
  const firstWeek = useFirstWeek();

  // Opens on Today every launch (Dev) — nothing persisted across launches.
  const [range, setRange] = useState<SellerHomeDashboardRange>('today');
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
  const [activityItems, setActivityItems] = useState<DashboardActivityItem[]>([]);

  // The seller's own public store URL, shown next to the "Dashboard" title
  // and copied to the clipboard on tap — real even before the store is
  // published (Dev: "it's where the store will eventually live"). Uses the
  // one existing public-store-URL builder (lib/shareProfile.ts), not a new
  // one — same as app/meta-ads-setup.tsx's own storeUrl fetch.
  // One store link everywhere: brandthread.app/@username (lib/storeShare).
  const storeLink = useStoreLink();
  const storeUrl = storeLink.url;
  const [storeUrlCopied, setStoreUrlCopied] = useState(false);
  // Store name + logo for the header (Shopify home: avatar + store name, not
  // a generic "Dashboard" title). Same profile fetch as the URL above.
  const [storeIdentity, setStoreIdentity] = useState<{ name: string | null; logoUrl: string | null }>(() => ({
    name: previewSellerBrandName(),
    logoUrl: null,
  }));
  useEffect(() => {
    let cancelled = false;
    if (sellerPreview) return;
    api.seller.getProfile().then((profile) => {
      if (cancelled) return;
      const p = profile as typeof profile & { avatarPosterUrl?: string | null };
      setStoreIdentity({
        name: previewSellerBrandName() ?? (profile.brandName || profile.displayName || null),
        logoUrl: p.avatarPosterUrl || profile.profileImageUrl || null,
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [api, sellerPreview]);

  const handleCopyStoreUrl = useCallback(() => {
    if (!storeUrl) return;
    (async () => {
      if (Platform.OS === 'web') {
        await navigator?.clipboard?.writeText?.(storeUrl);
      } else {
        const Clipboard = await import('expo-clipboard');
        await Clipboard.setStringAsync(storeUrl);
      }
      if (isSignedIn && !sellerPreview) await api.firstWeek.storeShared().catch(() => {});
    })();
    setStoreUrlCopied(true);
    setTimeout(() => setStoreUrlCopied(false), 1200);
  }, [storeUrl, api, isSignedIn, sellerPreview]);

  useEffect(() => subscribeStoreContext(() => {
    // Drop the previous store's numbers immediately rather than leaving them
    // on screen until the refetch (triggered by storeContextTick below) resolves.
    // That includes the To do counts ("N orders to ship"), the activity feed
    // and the new-seller flag — if the refetch fails they would otherwise stay
    // on screen under the new store.
    setActionInputs(null);
    setActivityItems([]);
    setEverSoldCount(null);
    setSnapshot(null);
    setTopProducts(null);
    setRecentOrders(null);
    setStoreContextTick((t) => t + 1);
  }), []);

  const data = selectSellerHomeAnalytics(snapshot, analyticsUserId, range);
  const morningBrief = useMorningBrief(userId, storeContextTick);
  const milestone = useMilestone(userId, storeContextTick);

  // Home Screen "Today" widget (Shopify pattern): mirrors this seller's real
  // Today numbers whenever they load. Never fed from the preview/demo data.
  useEffect(() => {
    if (sellerPreview || range !== 'today' || !analyticsUserId || !snapshot) return;
    if (snapshot.key !== sellerHomeAnalyticsKey(analyticsUserId, 'today')) return;
    updateSellerTodayWidget({
      salesCents: snapshot.data.totalCents,
      ordersCount: snapshot.data.orderCount,
      // The same count as the dashboard's "Orders to ship" (Orders' own
      // Unfulfilled filter) once it has loaded, so the widget never disagrees.
      toShipCount: actionInputs?.toShip ?? snapshot.data.toFulfill,
    });
  }, [actionInputs?.toShip, analyticsUserId, range, sellerPreview, snapshot]);

  // Live map: realtime only while this screen is focused (socket closes on blur).
  const [screenFocused, setScreenFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setScreenFocused(true);
    return () => setScreenFocused(false);
  }, []));
  const liveMap = useSellerLiveMap({
    enabled: screenFocused && !!userId,
    preview: previewMode,
  });

  const [walkthroughVisible, setWalkthroughVisible] = useState(false);
  const [celebrationVisible, setCelebrationVisible] = useState(false);
  const autoOpenedRef = useRef(false);
  const wasCompleteRef = useRef<boolean | null>(null);
  // One progress source for every setup prompt here: the server launch
  // checklist (the same count More, Store setup and Launch your store show).
  const { checklist: launchChecklist, dismiss: dismissLaunchChecklist } = useLaunchChecklist();
  const progress = launchChecklist ? launchProgress(launchChecklist) : null;
  // Unknown until the checklist loads — nothing auto-opens or celebrates early.
  const setupComplete = progress?.complete ?? false;

  // Show the guided walkthrough automatically the first time a seller lands
  // on an incomplete dashboard (e.g. right after signup), then never again
  // uninvited — the "Continue setup" banner takes over from there.
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (!userId || !progress || setupComplete) return;
    if (setupState.walkthroughShown) return;
    autoOpenedRef.current = true;
    setWalkthroughVisible(true);
    void markWalkthroughShown(userId).then(onSetupStateChange);
  }, [onSetupStateChange, progress, setupComplete, setupState.walkthroughShown, userId]);

  // One-time celebration the moment every required step becomes complete.
  useEffect(() => {
    if (!progress) return;
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
  }, [onSetupStateChange, progress, setupComplete, setupState.celebrated, userId]);

  // ── Range-scoped analytics (hero + chart + stat grid) ────────────────────
  useEffect(() => {
    // Preview: analyticsUserId is the fixed preview id, and `source` answers
    // from the seeded demo store; everything after this is the same path.
    if (!analyticsUserId) {
      setLoading(false);
      return;
    }
    let active = true;
    const requestKey = sellerHomeAnalyticsKey(analyticsUserId, range);
    setLoading(true);

    source.analyticsHome(range as SellerHomeTimeRange)
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
  }, [analyticsUserId, range, retryTick, source, storeContextTick]);

  // ── Range-independent data (orders, inventory, hub, products) — fetched
  // once per seller/refresh, not re-fetched on every chart range switch. ────
  const loadSecondaryData = useCallback(async () => {
    if (!userId && !sellerPreview) {
      setActivityItems([]);
      setTopProducts([]);
      setRecentOrders([]);
      setEverSoldCount(0);
      setActionInputs({ unreadMessages: 0, lowStockCount: 0, returns: 0, toShip: 0 });
      return;
    }
    setSecondaryError(false);
    try {
      const [orders, productAnalytics, catalog, productStats, returns, conversations, quotes, samples, threads] = await Promise.all([
        source.orders(),
        source.productAnalytics(),
        source.products(),
        source.productStats(),
        source.returns(),
        source.conversations(),
        // Manufacturer hub tiles are optional: threads are Growth-only, and a
        // 403 there must not blank the orders and inventory tiles (BT-398).
        source.quoteRequests(),
        source.sampleOrders(),
        source.manufacturerThreads(),
      ]);
      const derived = deriveDashboardSecondary({
        orders,
        // Same normalizer + same filter Orders' "Unfulfilled" chip uses, over
        // this same fetched list — the tile and the screen can't disagree.
        toShip: filterOrders(orders.map(apiRowToOrder), 'unfulfilled').length,
        productAnalytics,
        catalog,
        // The Products tab's own Low Stock count (the row deep-links there).
        lowStockCount: productStats.lowStock,
        returns,
        conversations,
        quotes,
        samples,
        threads,
      });
      setEverSoldCount(derived.everSoldCount);
      setRecentOrders(derived.recentOrders);
      setActionInputs(derived.actionInputs);
      setTopProducts(derived.topProducts);

      // Recent activity: real orders (already fetched) plus real followers
      // and reviews. Either of those failing only drops its rows.
      const [followersResult, reviewsResult] = await Promise.allSettled([source.followers(), source.reviews()]);
      setActivityItems(mergeDashboardActivity({
        orders: orders.slice(0, 10),
        followers: followersResult.status === 'fulfilled' ? followersResult.value.slice(0, 10) : [],
        reviews: reviewsResult.status === 'fulfilled' ? reviewsResult.value.slice(0, 10) : [],
      }));
    } catch (error) {
      if (__DEV__) console.warn('[seller-dashboard] secondary data unavailable', error);
      setSecondaryError(true);
    }
  }, [sellerPreview, source, userId]);

  useEffect(() => { void loadSecondaryData(); }, [loadSecondaryData, retryTick, storeContextTick]);

  const loadFinanceBalance = useCallback(async () => {
    const generation = ++balanceGenerationRef.current;
    // Owner-only. The signed-out preview has no team role; its source answers
    // with the demo store's seeded balance (fresh: none).
    if (!sellerPreview && (!userId || isLoadingRole || currentRole !== 'owner')) {
      setFinanceBalance(null);
      setFinanceLoading(isLoadingRole);
      return;
    }
    setFinanceBalance(null);
    setFinanceLoading(true);
    try {
      const next = await source.financeBalance();
      if (balanceGenerationRef.current === generation) setFinanceBalance(next);
    } catch {
      if (balanceGenerationRef.current === generation) setFinanceBalance(null);
    } finally {
      if (balanceGenerationRef.current === generation) setFinanceLoading(false);
    }
  }, [currentRole, isLoadingRole, sellerPreview, source, userId]);

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
    router.push(route as never);
  }, [router]);

  // Pull to refresh reloads every number on screen, balances included (the
  // 30s poll leaves Stripe balances alone).
  const reloadThreadCash = threadCash.reload;
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setRetryTick((n) => n + 1);
    await Promise.all([loadSecondaryData(), loadFinanceBalance(), reloadThreadCash()]);
    setRefreshing(false);
  }, [loadFinanceBalance, loadSecondaryData, reloadThreadCash]);

  const requestCashOut = useCallback(() => {
    if (!isSignedIn) return;
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
                haptic('error');
                Alert.alert('Could not cash out', message);
              } finally {
                setCashingOut(false);
              }
            })();
          },
        },
      ],
    );
  }, [api, currentRole, financeBalance, isSignedIn, loadFinanceBalance, nav, userId]);

  const openTask = useCallback((task: SetupTask) => {
    // push (never replace) straight into the task's flow with an explicit
    // `from=dashboard`: the destination's Cancel/Back pops to this exact
    // dashboard scene (docs/NAVIGATION.md). replace() used to drop the
    // dashboard from the stack, so the exit had to re-route to a tabs index
    // and could land the seller on the wrong tab or the Studio menu.
    router.push(withOrigin(task.route, 'dashboard') as never);
  }, [router]);

  // Owner-only money sections. The signed-out web preview has no team role,
  // so its demo mode (and only demo mode — fresh never shows a balance)
  // stands in for an owner to show the Payouts section.
  const showOwnerMoney = currentRole === 'owner' || (sellerPreview && isPreviewDemoMode());
  const addProductTask = setupState.tasks.find((task) => task.id === 'first_product') ?? null;
  const newSeller = everSoldCount !== null && isNewSeller(everSoldCount);
  // Shopify's "Get ready to sell" until the first sale, then the sales hero.
  // If the checklist can't load, the previous setup card stays as the fallback.
  const readyToSell = useReadyToSell();
  const showReadyToSell = !firstWeek.visible && newSeller && readyToSell.data !== null && !readyToSell.data.hasSale;
  // ── The one top-card slot (milestones, morning brief, …). While it shows a
  // card, the bottom setup prompts wait, so only one promo is on screen. ──
  const topCard = pickTopCard<DashboardTopCardCandidate>([
    {
      key: 'milestone',
      priority: TOP_CARD_PRIORITY.milestone,
      visible: milestone.milestone !== null,
      render: () => milestone.milestone && (
        <MilestoneCard milestone={milestone.milestone} theme={theme} onDone={milestone.markSeen} />
      ),
    },
    {
      key: 'morning-brief',
      priority: TOP_CARD_PRIORITY.morningBrief,
      visible: morningBrief.visible,
      render: () => morningBrief.brief && (
        <MorningBriefCard
          brief={morningBrief.brief}
          theme={theme}
          onAction={() => {
            hapticLight();
            router.push(primaryActionRoute(morningBrief.brief!) as never);
          }}
          onDismiss={morningBrief.dismiss}
          onTurnOff={morningBrief.turnOff}
        />
      ),
    },
  ], { blocked: newSeller });

  const actionCounts: DashboardActionCounts | null = actionInputs ? {
    toShip: actionInputs.toShip,
    toAnswer: actionInputs.unreadMessages,
    lowStock: actionInputs.lowStockCount,
    returns: actionInputs.returns,
  } : null;

  // ── Metric aggregate + chart series for the currently focused metric ─────
  const buckets = data?.buckets ?? EMPTY_BUCKETS;
  // 90D: the API's daily buckets are drawn as 7-day points (exact sums) so
  // the line reads as a trend, not 90 daily spikes.
  const chartBuckets = useMemo(() => (range === '90d' ? groupBucketsByWeek(buckets) : buckets), [buckets, range]);
  const series = useMemo(() => metricSeries(metric, chartBuckets), [metric, chartBuckets]);
  const labels = useMemo(() => chartBuckets.map((b) => bucketLabel(b.bucket, range as SellerHomeTimeRange)), [chartBuckets, range]);

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
  // Shown as-is: count-up motion is reserved for the first-sale moment (less-AI
  // pass, item 82), so the hero number and its delta always agree on screen.
  const heroDisplay = Math.round(activeValue);
  const scrubLabel = scrubIndex !== null ? labels[scrubIndex] : null;

  // "+12% vs yesterday" — percent only, plain text + a small arrow icon.
  const deltaLine = data
    ? describeHomeDelta(metricAggregate.current, metricAggregate.previous, range, { isEmpty: isEmptyChart })
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
      label: key === 'orders' ? `${metricLabelText[key]} ${ORDERS_TILE_SCOPE[range]}` : metricLabelText[key],
      value: formatMetricValue(key, agg.current),
      deltaLabel: delta.label,
      deltaDirection: delta.direction,
    };
  }) : [];

  return (
    <View style={[styles.root, { backgroundColor: theme.background ?? SCREEN_BG }]}>
      {/* Keep the viewport full-height; reserve the floating bar and 24pt
          inside the scroll content so every section remains reachable. */}
      <ScrollView
        ref={scrollResetRef}
        testID="seller-dashboard-scroll"
        accessibilityLabel="Seller dashboard scroll"
        style={styles.scrollView}
        contentContainerStyle={[styles.scroll, { paddingTop: topInset + 12, paddingBottom: tabBarMetrics.occupiedHeight + 24 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} colors={[theme.accent]} />
        }
      >
        <ResponsiveContainer maxWidth={GRID_MAX_WIDTH}>
          {/* ── Top bar ─────────────────────────────────────────────────── */}
          <View style={styles.topBar}>
            <View testID="seller-dashboard-scroll-position" accessibilityLabel="Seller dashboard scroll position" accessible style={styles.titleRow}>
              <Avatar uri={storeIdentity.logoUrl} name={storeIdentity.name ?? 'Store'} size={40} />
              <View style={styles.titleCopy}>
                <Text style={[styles.screenTitle, { color: theme.text ?? FG }]} numberOfLines={1} testID="seller-dashboard-store-name">
                  {storeIdentity.name ?? 'Dashboard'}
                </Text>
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
                    <Icon name={storeUrlCopied ? 'check' : 'copy'} size={13} color={theme.muted} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
            {/* Share store — opens the one Share store sheet (components/store/ShareStoreSheet). */}
            <TouchableOpacity
              onPress={() => { haptics.light(); navigateOrShareStore('/share-store', nav); }}
              style={styles.topBarShare}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel="Share store"
              testID="seller-dashboard-share-store"
            >
              <Icon name="share" size={22} color={theme.text ?? FG} />
            </TouchableOpacity>
            {(!sellerPreview || isSignedIn) && <ActivityBellButton
              testID="seller-dashboard-activity"
              color={theme.text ?? FG}
              size={22}
              style={styles.topBarAction}
              badgeBorderColor={theme.background ?? BG}
            />}
          </View>

          {/* ── To do: only when something needs action ─────────────── */}
          {actionCounts && (
            <View style={styles.todoSection}>
              <SellerDashboardTodo
                counts={actionCounts}
                theme={theme}
                onNavigate={nav}
                onShipNow={() => router.push(SHIP_NOW_ROUTE as never)}
              />
            </View>
          )}
          <DashboardTopCard card={topCard} />
          {firstWeek.visible && firstWeek.state && (
            <View style={styles.section}>
              <FirstWeekCard state={firstWeek.state} onDismiss={firstWeek.dismiss} />
            </View>
          )}

          {!data && analyticsError ? (
            <View style={styles.errorBanner} testID="seller-dashboard-error">
              <Icon name="alert-circle" size={16} color={theme.error} />
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
              {(
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
                  // brand-new/zero-sales account. The range-aware empty
                  // message is shown once, in the chart itself; this blank
                  // line only holds the hero's height so nothing jumps.
                  <Text style={[styles.heroDelta, { color: theme.muted }]}>{' '}</Text>
                ) : deltaLine && scrubIndex === null ? (
                  <View
                    style={styles.heroDeltaRow}
                    testID="seller-dashboard-hero-delta"
                    accessible
                    accessibilityLabel={`${deltaLine.direction === 'up' ? 'Up ' : deltaLine.direction === 'down' ? 'Down ' : ''}${deltaLine.label}`}
                  >
                    {deltaLine.direction !== 'flat' && (
                      <Icon name={deltaLine.direction === 'up' ? 'arrow-up-right' : 'arrow-down-right'} size={14} color={theme.text} />
                    )}
                    <Text style={[styles.heroDelta, styles.heroDeltaText, { color: theme.text }]}>{deltaLine.label}</Text>
                  </View>
                ) : (
                  <Text style={[styles.heroDelta, { color: theme.muted }]}>{' '}</Text>
                )}
              </PressableScale>

              <SellerDashboardChart
                values={series}
                labels={labels}
                theme={theme}
                range={range}
                rangeControl={<SellerDashboardHomeRange range={range} onRangeChange={(next) => { setRange(next); setScrubIndex(null); }} />}
                onScrub={setScrubIndex}
                isEmpty={isEmptyChart}
                formatValue={(v) => formatMetricValue(metric, v)}
                emptyMessage={EMPTY_CHART_MESSAGE[range]}
                showNowMarker={range === 'today'}
              />
              </>
              )}

              {/* ── Stat tile grid ───────────────────────────────────────────
                  Shown for a brand-new store too: real zeros (Orders 0,
                  Visitors 0…) are the headline numbers sellers expect at the
                  top (Shopify home shows Sessions / Total sales / Orders at
                  0). Zero deltas render blank, never a fabricated trend. */}
              <View style={styles.section}>
                <SellerDashboardStatGrid tiles={tiles} activeKey={metric} onSelect={(key) => setMetric(key as MetricKey)} theme={theme} />
              </View>

              {/* ── Payouts: next payout, then balance / withdraw ───────── */}
              {showOwnerMoney && (
                <View style={styles.section} testID="seller-dashboard-payouts">
                  <SellerDashboardSectionTitle title="Payouts" theme={theme} />
                  <SellerDashboardPayoutCard
                    estimate={financeBalance?.nextPayoutEstimate}
                    schedule={financeBalance?.payoutSchedule}
                    theme={theme}
                    onOpen={() => nav('/payouts')}
                  />
                </View>
              )}
              {showOwnerMoney && (
                <View style={[styles.balanceRow, { borderColor: theme.borderSubtle }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.balanceLabel, { color: theme.muted }]}>Available balance</Text>
                    <Text style={[styles.balanceValue, { color: theme.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                      {/* A failed load shows a dash, never a made-up $0.00. */}
                      {financeLoading ? '···' : financeBalance?.available.formatted ?? '—'}
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
              {showOwnerMoney && (
                <TouchableOpacity
                  style={[styles.threadCashRow, { borderColor: theme.borderSubtle }]}
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
                    {threadCash.loading ? '···' : threadCash.balanceCents == null ? '—' : formatCents(threadCash.balanceCents)}
                  </Text>
                  <Icon name="chevron-right" size={16} color={theme.subtle} />
                </TouchableOpacity>
              )}

              {/* ── Action needed / top products / recent orders, or the new-seller setup card ── */}
              <View style={isTablet ? styles.tabletRow : undefined}>
                {firstWeek.visible ? null : newSeller ? (
                  <View style={[isTablet && styles.tabletRowItem, styles.section]}>
                    <SellerDashboardSetupCard
                      theme={theme}
                      hasSetupChecklist={Boolean(addProductTask)}
                      onAddProduct={() => nav(withOrigin('/add-product', 'dashboard'))}
                      onOpenSetup={() => (addProductTask ? openTask(addProductTask) : nav(withOrigin('/add-product', 'dashboard')))}
                      onImport={() => nav('/shopify-import')}
                    />
                  </View>
                ) : null}

                {!newSeller && secondaryError && (
                  <View style={[isTablet && styles.tabletRowItem, styles.errorBanner]}>
                    <Icon name="alert-circle" size={16} color={theme.error} />
                    <Text style={[styles.errorText, { color: theme.error }]}>Some dashboard data couldn’t load.</Text>
                    <TouchableOpacity onPress={() => setRetryTick((n) => n + 1)} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }} accessibilityRole="button" accessibilityLabel="Retry loading dashboard data">
                      <Text style={[styles.retryText, { color: theme.accent }]}>Retry</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {/* AI suggestions from the seller's own data; renders nothing
                  when AI Settings turns them off or there are none. */}
              <SellerDashboardAISuggestions theme={theme} refreshKey={retryTick + storeContextTick} style={styles.section} />

              {(newSeller || (topProducts?.length ?? 0) > 0) && (
                <View style={styles.section}>
                  <SellerDashboardTopProducts
                    emptyMessage="Your best sellers show up here after your first sale."
                    products={topProducts ?? []}
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
                <View {...tipTargetProps('seller-dashboard:traffic')} collapsable={false} style={styles.section}>
                  <SellerDashboardTrafficSources
                    totalVisits={data.visitorCount}
                    previousVisits={data.previous?.visitorCount ?? 0}
                    periodLabel={PERIOD_LABEL[range]}
                    trafficSources={data.trafficSources}
                    theme={theme}
                    onSeeAll={() => nav('/(tabs)/analytics')}
                    onOpenSource={() => nav('/(tabs)/analytics')}
                    onShareStore={() => nav('/share-store')}
                  />
                </View>
              )}

              {/* ── Recent activity: orders, followers, reviews ─────────── */}
              {activityItems.length > 0 && (
                <View style={styles.section}>
                  <SellerDashboardActivityFeed items={activityItems} theme={theme} onNavigate={nav} />
                </View>
              )}
              {(newSeller || (recentOrders?.length ?? 0) > 0) && (
                <View style={styles.section}>
                  <SellerDashboardRecentOrders
                    emptyMessage="No orders yet. New orders show up here first."
                    orders={recentOrders ?? []}
                    onOpenOrder={(id) => nav(`/order-detail?id=${id}`)}
                    onSeeAll={() => nav('/(tabs)/orders')}
                  />
                </View>
              )}
              {showReadyToSell && readyToSell.data ? (
                <View style={styles.section}>
                  <ReadyToSellChecklist
                    data={readyToSell.data}
                    hasPlan={readyToSell.hasPlan}
                    progress={progress}
                    onOpen={(route) => nav(route === '/add-product' ? withOrigin(route, 'dashboard') : route)}
                    testID="seller-dashboard-ready-to-sell"
                  />
                </View>
              ) : null}
              <View style={styles.section}>
                <SellerDashboardQuickActions theme={theme} onNavigate={nav} />
              </View>
              <View style={styles.section}>
                <SellerOrderGlobe
                  data={liveMap.data}
                  ping={liveMap.ping}
                  theme={theme}
                  active={screenFocused}
                  onOpenOrder={(id) => nav(`/order-detail?id=${encodeURIComponent(id)}`)}
                />
              </View>
            </>
          )}

          {/* ── One setup prompt at a time: Get ready to sell for a new
              seller, else the Launch checklist card, and once that card is
              dismissed the slim "Continue setup" banner (opens the guided
              walkthrough). All three show the same server count. ─────────── */}
          {!topCard && !showReadyToSell && !firstWeek.visible && launchChecklist && !launchChecklist.dismissed && (
            <LaunchChecklistCard checklist={launchChecklist} dismiss={() => { void dismissLaunchChecklist(); }} />
          )}
          {!topCard && !showReadyToSell && !firstWeek.visible && progress && !setupComplete && launchChecklist?.dismissed && (
            <View style={styles.section}>
              <SetupContinueBanner
                done={progress.done}
                total={progress.total}
                nextLabel={progress.next ? LAUNCH_STEP_META[progress.next].title : null}
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
        checklist={launchChecklist}
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
  readyToSell: { marginTop: SP.sm },
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
  topBarShare: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  // flex: 1 so the store-url row below has room to shrink/truncate instead
  // of pushing the fixed-size activity bell off the right edge; the
  // ActivityBellButton itself keeps its own fixed width, unaffected.
  titleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginRight: SP.sm },
  // Store name over its public URL, next to the store avatar.
  titleCopy: { flex: 1, minWidth: 0 },
  screenTitle: { fontFamily: FONT.bold, fontSize: FS.lg, letterSpacing: -0.4 },
  // The seller's public store URL, on its own line under the store name, never
  // wrapping — flexShrink lets IT truncate (middle-ellipsis) before the row
  // itself would ever wrap. No background/border — a plain silver link, per
  // Dev's "no toast, no wording" instinct for this whole affordance.
  storeUrlRow: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', maxWidth: '100%' },
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
  heroDeltaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  heroDeltaText: { marginTop: 0 },
  // "To do" sits right under the header, above the hero.
  todoSection: { marginTop: SP.md, marginBottom: SP.md },

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
    paddingBottom: SP.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  balanceLabel: { fontFamily: FONT.semibold, fontSize: FS.xs, },
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
