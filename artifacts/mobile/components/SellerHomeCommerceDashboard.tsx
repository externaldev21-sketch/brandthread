import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useApi } from '@/hooks/useApi';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { ApiError } from '@/lib/networkNotice';
import { useTeamRole } from '@/hooks/useTeamRole';
import { subscribeStoreContext } from '@/lib/api';
import {
  selectSellerHomeAnalytics,
  sellerHomeAnalyticsKey,
  type SellerHomeAnalyticsSnapshot,
} from '@/lib/sellerHomeAnalytics';
import { skipTask, type SetupState, type SetupTask } from '@/lib/setupStore';
import { withSellerSetupOrigin } from '@/lib/setupNavigation';
import { KpiRowSkeleton, ResponsiveContainer, useBreakpoint } from '@/components/layout';
import ActivityBellButton from '@/components/ActivityBellButton';
import {
  BG,
  BORDER,
  BORDER_SUBTLE,
  CARD_ELEVATED_GLASS,
  FG,
  FONT,
  FS,
  GRID_MAX_WIDTH,
  MUTED,
  RADIUS,
  SCREEN_BG,
  SELLER_DASHBOARD_GLASS,
  SKELETON_GLASS,
  SP,
  SUBTLE,
  SUCCESS,
  SUCCESS_DIM,
} from '@/lib/theme';

type TimeRange = 'live' | 'today' | 'yesterday' | 'week';

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

const RANGES: Array<{ id: TimeRange; label: string }> = [
  { id: 'live', label: 'Live' },
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'This week' },
];

function bucketLabel(value: string, range: TimeRange): string {
  const date = new Date(value);
  if (range === 'week') {
    return date.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2);
  }
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: range === 'live' ? '2-digit' : undefined,
  });
}

// ─── Skeleton shimmer row ────────────────────────────────────────────────────
function SkeletonBlock({ width, height, style }: { width?: number | string; height: number; style?: object }) {
  return (
    <View
      style={[
        {
          width: width ?? '100%',
          height,
          borderRadius: RADIUS.sm,
          backgroundColor: SKELETON_GLASS,
        },
        style,
      ]}
    />
  );
}

// ─── Chart skeleton bars ─────────────────────────────────────────────────────
function ChartSkeleton({ count = 10 }: { count?: number }) {
  const heights = [45, 62, 30, 75, 52, 88, 38, 66, 44, 55];
  return (
    <View style={styles.chart}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.barColumn}>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.bar,
                {
                  height: `${heights[i % heights.length]}%`,
                  backgroundColor: SKELETON_GLASS,
                },
              ]}
            />
          </View>
          <SkeletonBlock width={14} height={8} />
        </View>
      ))}
    </View>
  );
}

// ─── Empty chart state ────────────────────────────────────────────────────────
function ChartEmptyState({ range }: { range: TimeRange }) {
  const rangeLabel = RANGES.find((r) => r.id === range)?.label ?? range;
  const ghost = [18, 28, 14, 35, 22, 42, 16, 30, 20, 26];
  return (
    <View style={styles.chartEmptyWrap}>
      {/* Ghost bars — visually suggest the chart shape without implying real data */}
      <View style={[styles.chart, styles.chartGhost]}>
        {ghost.map((h, i) => (
          <View key={i} style={styles.barColumn}>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.bar,
                  {
                    height: `${h}%`,
                    backgroundColor: BORDER_SUBTLE,
                  },
                ]}
              />
            </View>
            <View style={{ width: 14, height: 8, borderRadius: 3, backgroundColor: BORDER_SUBTLE }} />
          </View>
        ))}
      </View>
      {/* Overlay label */}
      <View style={styles.chartEmptyOverlay} pointerEvents="none">
        <Feather name="bar-chart-2" size={20} color={SUBTLE} />
        <Text style={styles.chartEmptyTitle}>No sales {rangeLabel === 'Live' ? 'right now' : `for ${rangeLabel.toLowerCase()}`}</Text>
        <Text style={styles.chartEmptySubtitle}>Sales will appear here as orders come in</Text>
      </View>
    </View>
  );
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
  const palette = theme as typeof theme & Record<string, string>;
  const { currentRole, isLoadingRole } = useTeamRole();
  const { isTablet } = useBreakpoint();
  const [range, setRange] = useState<TimeRange>('today');
  const [snapshot, setSnapshot] = useState<SellerHomeAnalyticsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState(false);
  const [financeBalance, setFinanceBalance] = useState<FinanceBalance | null>(null);
  const [financeLoading, setFinanceLoading] = useState(true);
  const [cashingOut, setCashingOut] = useState(false);
  const balanceGenerationRef = useRef(0);
  const payoutAttemptKeyRef = useRef<string | null>(null);
  const data = selectSellerHomeAnalytics(snapshot, userId, range);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    let active = true;
    const requestKey = sellerHomeAnalyticsKey(userId, range);
    setLoading(true);
    api.analytics.home(range)
      .then((next) => {
        if (!active) return;
        setAnalyticsError(false);
        setSnapshot({ key: requestKey, data: next });
      })
      .catch((requestError) => {
        if (!active) return;
        if (__DEV__) {
          console.warn('[seller-dashboard] analytics unavailable', requestError);
        }
        // Never fabricate a zero state — keep any stale snapshot and surface a real error banner instead.
        setAnalyticsError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [api, range, userId]);

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
      if (balanceGenerationRef.current === generation) {
        setFinanceBalance(next);
      }
    } catch {
      if (balanceGenerationRef.current === generation) {
        setFinanceBalance(null);
      }
    } finally {
      if (balanceGenerationRef.current === generation) {
        setFinanceLoading(false);
      }
    }
  }, [api, currentRole, isLoadingRole, userId]);

  useEffect(() => {
    void loadFinanceBalance();
  }, [loadFinanceBalance]);

  useEffect(() => subscribeStoreContext(() => {
    balanceGenerationRef.current += 1;
    payoutAttemptKeyRef.current = null;
    setFinanceBalance(null);
    void loadFinanceBalance();
  }), [loadFinanceBalance]);

  useEffect(() => {
    payoutAttemptKeyRef.current = null;
  }, [userId]);

  const nav = useCallback((route: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    router.push(route as never);
  }, [router]);

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
    router.push(withSellerSetupOrigin(task.route) as never);
  }, [router]);

  const dismissTask = useCallback(async (task: SetupTask) => {
    const next = await skipTask(task.id, userId);
    onSetupStateChange(next);
  }, [onSetupStateChange, userId]);

  const showTaskOptions = useCallback((task: SetupTask) => {
    Alert.alert(task.label, undefined, [
      { text: 'Open', onPress: () => openTask(task) },
      { text: 'Dismiss', style: 'destructive', onPress: () => void dismissTask(task) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [dismissTask, openTask]);

  const unfinishedTasks = setupState.tasks.filter((task) => !task.completed && !task.skipped);
  const maxBucket = Math.max(0, ...(data?.buckets.map((bucket) => bucket.totalCents) ?? []));
  const hasActivity = data?.buckets.some((bucket) => bucket.totalCents > 0) ?? false;
  const toFulfill = data?.toFulfill ?? 0;
  const toCapture = data?.toCapture ?? 0;
  const totalSales = data?.totalCents ?? 0;
  const orderCount = data?.orderCount ?? 0;
  const visitorCount = data?.visitorCount ?? 0;

  return (
    <View style={[styles.root, { backgroundColor: palette.background ?? palette.surface ?? BG }]}>
      <ScrollView
        testID="seller-dashboard-scroll"
        accessibilityLabel="Seller dashboard scroll"
        style={styles.scrollView}
        contentContainerStyle={[styles.scroll, { paddingTop: topInset + SP.sm }]}
        showsVerticalScrollIndicator={false}
        alwaysBounceVertical
        scrollEnabled
        nestedScrollEnabled
        directionalLockEnabled={false}
        contentInsetAdjustmentBehavior="never"
        removeClippedSubviews={false}
        keyboardShouldPersistTaps="handled"
      >
        <ResponsiveContainer maxWidth={GRID_MAX_WIDTH}>
        {/* ── Top bar ──────────────────────────────────────────────────── */}
        <View style={styles.topBar}>
          <View
            testID="seller-dashboard-scroll-position"
            accessibilityLabel="Seller dashboard scroll position"
            accessible
          >
            <Text style={[styles.screenTitle, { color: palette.foreground ?? FG }]}>Dashboard</Text>
          </View>
          <ActivityBellButton
            testID="seller-dashboard-activity"
            color={palette.foreground ?? FG}
            size={22}
            style={styles.topBarAction}
            badgeBorderColor={palette.background ?? palette.surface ?? BG}
          />
        </View>

        {/* ── Time range pills ─────────────────────────────────────────── */}
        <ScrollView
          horizontal
          nestedScrollEnabled
          directionalLockEnabled
          showsHorizontalScrollIndicator={false}
          style={styles.rangeScroll}
          contentContainerStyle={styles.rangeRow}
        >
          {RANGES.map((item) => {
            const selected = item.id === range;
            return (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.rangePill,
                  { backgroundColor: palette.glass ?? palette.surface ?? SELLER_DASHBOARD_GLASS, borderColor: palette.border ?? BORDER },
                  selected && { backgroundColor: theme.accentDim, borderColor: theme.accent },
                ]}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setRange(item.id);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Show ${item.label} sales`}
                accessibilityState={{ selected }}
              >
                <Text style={[styles.rangeText, { color: selected ? theme.accentLight : (palette.muted ?? MUTED) }]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* ── Summary stats (KPI tile row) ──────────────────────────────── */}
        <View style={[styles.statsCard, { backgroundColor: palette.glass ?? palette.surface ?? SELLER_DASHBOARD_GLASS, borderColor: palette.border ?? BORDER }]}>
          {analyticsError && (
            <View
              style={[styles.errorBanner, { backgroundColor: palette.cardElevated ?? palette.card ?? CARD_ELEVATED_GLASS, borderColor: theme.error }]}
              accessibilityRole="alert"
            >
              <Feather name="alert-circle" size={14} color={theme.error} />
              <Text style={[styles.errorBannerText, { color: theme.error }]}>
                {data ? 'Couldn’t refresh your sales. Pull to refresh.' : 'Couldn’t load your sales. Pull to refresh.'}
              </Text>
            </View>
          )}
          {!data && !analyticsError ? (
            <View style={{ padding: SP.sm }}>
              <KpiRowSkeleton count={4} />
            </View>
          ) : (
            <View style={styles.statGrid}>
              <View style={[styles.statTile, isTablet && styles.statTileTablet, { backgroundColor: palette.cardElevated ?? palette.card ?? CARD_ELEVATED_GLASS, borderColor: palette.borderSubtle ?? BORDER_SUBTLE }]}>
                <Text style={styles.statLabel}>Total sales</Text>
                <Text
                  style={styles.statValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.65}
                >
                  {data ? formatCents(totalSales) : '—'}
                </Text>
              </View>
              <View style={[styles.statTile, isTablet && styles.statTileTablet]}>
                <Text style={styles.statLabel}>Orders</Text>
                <Text
                  style={styles.statValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.65}
                >
                  {data ? orderCount : '—'}
                </Text>
              </View>
              <View style={[styles.statTile, isTablet && styles.statTileTablet]}>
                <Text style={styles.statLabel}>{range === 'live' ? 'Online now' : 'Visitors'}</Text>
                <Text
                  style={styles.statValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.65}
                >
                  {data ? visitorCount : '—'}
                </Text>
              </View>
              <View style={[styles.statTile, isTablet && styles.statTileTablet]}>
                <Text style={styles.statLabel}>Available</Text>
                <Text
                  style={styles.statValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.65}
                >
                  {financeLoading ? '—' : financeBalance?.available.formatted ?? '$0.00'}
                </Text>
              </View>
            </View>
          )}

          <View style={styles.balanceSummary}>
            <View style={styles.balanceLine}>
              <Text style={styles.balanceLabel}>Pending Balance</Text>
              <Text style={styles.balanceValue}>
                {financeLoading ? '—' : financeBalance?.pending.formatted ?? '$0.00'}
              </Text>
            </View>
          </View>

          {/* Cash-out CTA — flush to bottom of stats card */}
          {data && !loading && (
            <TouchableOpacity
              testID="seller-dashboard-cash-out"
              style={[
                styles.dashboardButton,
                { backgroundColor: FG },
                (financeLoading || cashingOut) && styles.dashboardButtonDisabled,
              ]}
              activeOpacity={0.82}
              disabled={financeLoading || cashingOut}
              onPress={requestCashOut}
              accessibilityRole="button"
              accessibilityLabel="Withdraw available balance"
              accessibilityState={{ disabled: financeLoading || cashingOut }}
            >
              {cashingOut ? (
                <ActivityIndicator size="small" color={BG} />
              ) : (
                <Text style={[styles.dashboardButtonIcon, { color: BG }]}>$</Text>
              )}
              <Text style={[styles.dashboardButtonText, { color: BG }]}>
                {cashingOut ? 'Withdrawing…' : 'Withdraw'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Sales activity chart + needs-attention: side-by-side on iPad ── */}
        <View style={isTablet ? styles.tabletRow : undefined}>
        <View style={[isTablet && styles.tabletRowItem, styles.chartCard, { backgroundColor: palette.glass ?? palette.surface ?? SELLER_DASHBOARD_GLASS, borderColor: palette.border ?? BORDER }]}>
          <View style={styles.chartHeader}>
            <Text style={styles.sectionTitle}>Sales activity</Text>
            <View style={styles.chartBadge}>
              <Text style={styles.chartRange}>
                {RANGES.find((item) => item.id === range)?.label}
              </Text>
            </View>
          </View>

          {!data && analyticsError ? (
            <View style={styles.emptyActions}>
              <Feather name="alert-circle" size={16} color={theme.error} />
              <Text style={[styles.emptyActionsText, { color: theme.error }]}>Couldn{'’'}t load activity</Text>
            </View>
          ) : !data ? (
            <ChartSkeleton />
          ) : !hasActivity || maxBucket === 0 ? (
            <ChartEmptyState range={range} />
          ) : (
            <View style={styles.chart}>
              {(data?.buckets ?? []).map((bucket) => {
                const ratio = maxBucket > 0 ? bucket.totalCents / maxBucket : 0;
                return (
                  <View key={bucket.bucket} style={styles.barColumn}>
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.bar,
                          {
                            height: maxBucket > 0 ? `${Math.max(4, ratio * 100)}%` : 0,
                            backgroundColor: theme.accent,
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.barLabel}>{bucketLabel(bucket.bucket, range)}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* ── Action items (fulfill / capture) ─────────────────────────── */}
        {data && !loading && (
          <View style={[isTablet && styles.tabletRowItem, styles.actionSection]}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeaderLabel}>Needs attention</Text>
            </View>

            <View style={styles.actionCard}>
              {toFulfill > 0 && (
                <TouchableOpacity
                  style={[styles.actionRow, toCapture > 0 && styles.actionRowBordered]}
                  onPress={() => nav('/(tabs)/orders')}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${toFulfill} ${toFulfill === 1 ? 'order' : 'orders'} to fulfill`}
                >
                  <View style={styles.actionIconWrap}>
                    <Feather name="package" size={16} color={FG} />
                  </View>
                  <View style={styles.actionCopy}>
                    <Text style={styles.actionTitle}>
                      {toFulfill} {toFulfill === 1 ? 'order' : 'orders'} to fulfill
                    </Text>
                    <Text style={styles.actionSubtitle}>Paid orders awaiting shipment</Text>
                  </View>
                  <View style={styles.actionBadge}>
                    <Text style={styles.actionBadgeText}>{toFulfill > 9 ? '9+' : toFulfill}</Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={SUBTLE} />
                </TouchableOpacity>
              )}

              {toCapture > 0 && (
                <TouchableOpacity
                  style={styles.actionRow}
                  onPress={() => nav('/payments')}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${toCapture} ${toCapture === 1 ? 'payment' : 'payments'} to capture`}
                >
                  <View style={styles.actionIconWrap}>
                    <Feather name="credit-card" size={16} color={FG} />
                  </View>
                  <View style={styles.actionCopy}>
                    <Text style={styles.actionTitle}>
                      {toCapture} {toCapture === 1 ? 'payment' : 'payments'} to capture
                    </Text>
                    <Text style={styles.actionSubtitle}>Authorized payments pending capture</Text>
                  </View>
                  <View style={styles.actionBadge}>
                    <Text style={styles.actionBadgeText}>{toCapture > 9 ? '9+' : toCapture}</Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={SUBTLE} />
                </TouchableOpacity>
              )}

              {toFulfill === 0 && toCapture === 0 && (
                <View style={styles.emptyActions}>
                  <View style={[styles.emptyActionsIcon, { backgroundColor: SUCCESS_DIM }]}>
                    <Feather name="check" size={16} color="#41C72A" />
                  </View>
                  <Text style={styles.emptyActionsText}>All caught up</Text>
                </View>
              )}
            </View>
          </View>
        )}
        </View>

        {/* ── Setup checklist ───────────────────────────────────────────── */}
        {unfinishedTasks.length > 0 && (
          <View style={styles.setupSection}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeaderLabel}>Set up your business</Text>
              <View style={styles.setupCountBadge}>
                <Text style={styles.setupCountText}>{unfinishedTasks.length}</Text>
              </View>
            </View>

            <View style={styles.setupList}>
              {unfinishedTasks.map((task, index) => (
                <TouchableOpacity
                  key={task.id}
                  style={[
                    [styles.setupCard, { backgroundColor: palette.card ?? palette.surface ?? CARD_ELEVATED_GLASS, borderColor: palette.borderSubtle ?? BORDER_SUBTLE }],
                    index < unfinishedTasks.length - 1 && styles.setupCardBordered,
                  ]}
                  activeOpacity={0.75}
                  onPress={() => openTask(task)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open setup task: ${task.label}`}
                >
                  <View style={[styles.setupIcon, { backgroundColor: theme.accentDim }]}>
                    <Feather
                      name={task.icon as keyof typeof Feather.glyphMap}
                      size={18}
                      color={theme.accentLight}
                    />
                  </View>
                  <View style={styles.setupCopy}>
                    <Text style={styles.setupTitle}>{task.label}</Text>
                    <Text style={styles.setupDescription} numberOfLines={2}>
                      {task.description}
                    </Text>
                  </View>
                  <Pressable
                    style={styles.optionsButton}
                    hitSlop={10}
                    onPress={(event) => {
                      event.stopPropagation();
                      showTaskOptions(task);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Options for ${task.label}`}
                  >
                    <Feather name="more-horizontal" size={18} color={MUTED} />
                  </Pressable>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
        </ResponsiveContainer>
        <View
          testID="seller-dashboard-scroll-end"
          accessibilityLabel="Seller dashboard scroll end"
          style={styles.scrollEndMarker}
        />
      </ScrollView>

    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SCREEN_BG },
  // flex: 1 on the ScrollView itself is required on iOS so the layout engine
  // gives it a bounded height and allows inner content to scroll correctly.
  scrollView: { flex: 1 },
  scroll: { flexGrow: 1, paddingBottom: 160 },
  scrollEndMarker: { height: 1 },

  // ── Top bar
  topBar: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingBottom: SP.xs,
  },
  topBarAction: {
    width: 44,
    height: 44,
    marginRight: -SP.sm,
  },
  screenTitle: {
    color: FG,
    fontFamily: FONT.bold,
    fontSize: FS.xl,
    letterSpacing: -0.4,
  },

  // ── Range pills
  // flexGrow: 0 stops this horizontal ScrollView from stretching vertically to
  // fill its flex parent on wide/web viewports (iPad web was rendering the
  // pill row at ~390px tall).
  rangeScroll: {
    flexGrow: 0,
  },
  rangeRow: {
    gap: SP.xs,
    paddingVertical: SP.sm,
    alignItems: 'center',
  },
  rangePill: {
     minHeight: 44,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SELLER_DASHBOARD_GLASS,
  },
  rangeText: { color: MUTED, fontFamily: FONT.semibold, fontSize: FS.sm },

  // ── Stats card
  statsCard: {
    marginTop: SP.xs,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SELLER_DASHBOARD_GLASS,
    overflow: 'hidden',
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.sm,
    padding: SP.sm,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    marginHorizontal: SP.sm,
    marginTop: SP.sm,
    padding: SP.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  errorBannerText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    flex: 1,
  },
  statTile: {
    width: '48%',
    minHeight: 82,
    justifyContent: 'space-between',
    padding: SP.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER_SUBTLE,
    backgroundColor: CARD_ELEVATED_GLASS,
  },
  statTileTablet: {
    width: '23.5%',
  },
  statLabel: {
    color: MUTED,
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    letterSpacing: 0.2,
  },
  statValue: {
    color: FG,
    fontFamily: FONT.bold,
    fontSize: FS.xxl,
    letterSpacing: -0.5,
    marginTop: SP.sm,
    width: '100%',
  },

  balanceSummary: {
    paddingHorizontal: SP.md,
    paddingTop: SP.xs,
    paddingBottom: SP.md,
    gap: SP.sm,
  },
  balanceLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SP.md,
  },
  balanceLabel: {
    color: MUTED,
    fontFamily: FONT.medium,
    fontSize: FS.sm,
  },
  balanceValue: {
    color: FG,
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
  },

  // ── Cash-out button
  dashboardButton: {
    marginHorizontal: SP.md,
    marginBottom: SP.md,
    minHeight: 44,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.xs,
  },
  dashboardButtonDisabled: { opacity: 0.55 },
  dashboardButtonText: { fontFamily: FONT.bold, fontSize: FS.sm },
  dashboardButtonIcon: { fontFamily: FONT.bold, fontSize: FS.sm, lineHeight: FS.sm },

  // ── Chart card
  chartCard: {
    marginTop: SP.sm,
    padding: SP.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SELLER_DASHBOARD_GLASS,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SP.md,
  },
  sectionTitle: {
    color: FG,
    fontFamily: FONT.bold,
    fontSize: FS.md,
    letterSpacing: -0.2,
  },
  chartBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.pill,
    backgroundColor: SKELETON_GLASS,
    borderWidth: 1,
    borderColor: BORDER,
  },
  chartRange: { color: MUTED, fontFamily: FONT.medium, fontSize: FS.xs },
  chart: {
    height: 144,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SP.xs,
  },
  barColumn: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: SP.xs,
  },
  barTrack: {
    flex: 1,
    width: '56%',
    justifyContent: 'flex-end',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  bar: {
    width: '100%',
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  barLabel: { color: SUBTLE, fontFamily: FONT.regular, fontSize: FS.xs },

  // ── Chart empty state
  chartEmptyWrap: {
    height: 144,
    position: 'relative',
  },
  chartGhost: {
    opacity: 1,
  },
  chartEmptyOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: CARD_ELEVATED_GLASS,
    borderRadius: RADIUS.sm,
  },
  chartEmptyTitle: {
    color: MUTED,
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    textAlign: 'center',
  },
  chartEmptySubtitle: {
    color: SUBTLE,
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    textAlign: 'center',
  },

  // ── Action items section
  actionSection: {
    marginTop: SP.sm,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    marginBottom: SP.sm,
    paddingHorizontal: 2,
  },
  sectionHeaderLabel: {
    color: MUTED,
    fontFamily: FONT.bold,
    fontSize: FS.xs,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    flex: 1,
  },
  actionCard: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SELLER_DASHBOARD_GLASS,
    overflow: 'hidden',
  },
  actionRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    gap: SP.sm,
  },
  actionRowBordered: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  actionIconWrap: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.sm,
    backgroundColor: SKELETON_GLASS,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  actionCopy: { flex: 1, minWidth: 0 },
  actionTitle: {
    color: FG,
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    letterSpacing: -0.1,
  },
  actionSubtitle: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
  actionBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: SELLER_DASHBOARD_GLASS,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    flexShrink: 0,
  },
  actionBadgeText: {
    color: FG,
    fontFamily: FONT.bold,
    fontSize: 11,
  },
  emptyActions: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
  },
  emptyActionsIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyActionsText: {
    color: MUTED,
    fontFamily: FONT.medium,
    fontSize: FS.sm,
  },

  // ── Setup section
  setupSection: {
    marginTop: SP.sm,
  },
  tabletRow: {
    flexDirection: 'row',
    gap: SP.sm,
    alignItems: 'flex-start',
  },
  tabletRowItem: {
    flex: 1,
    minWidth: 0,
  },
  setupCountBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: SELLER_DASHBOARD_GLASS,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  setupCountText: {
    color: MUTED,
    fontFamily: FONT.bold,
    fontSize: 11,
  },
  setupList: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SELLER_DASHBOARD_GLASS,
    overflow: 'hidden',
  },
  setupCard: {
    minHeight: 80,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
  },
  setupCardBordered: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER_SUBTLE,
  },
  setupIcon: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  setupCopy: { flex: 1, minWidth: 0 },
  setupTitle: {
    color: FG,
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    letterSpacing: -0.1,
  },
  setupDescription: {
    color: MUTED,
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    lineHeight: 17,
    marginTop: 3,
  },
  optionsButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
