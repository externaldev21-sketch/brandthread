import React, { useCallback, useEffect, useState } from 'react';
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

import AIBrainFAB from '@/components/AIBrainFAB';
import SellerStudioRadialMenu from '@/components/SellerStudioRadialMenu';
import { useApi } from '@/hooks/useApi';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { skipTask, type SetupState, type SetupTask } from '@/lib/setupStore';
import { withSellerSetupOrigin } from '@/lib/setupNavigation';
import {
  BORDER,
  CARD,
  FG,
  FONT,
  FS,
  MUTED,
  RADIUS,
  SCREEN_BG,
  SP,
} from '@/lib/theme';

type TimeRange = 'live' | 'today' | 'yesterday' | 'week';

type HomeAnalytics = {
  range: string;
  totalCents: number;
  orderCount: number;
  visitorCount: number;
  toFulfill: number;
  toCapture: number;
  buckets: Array<{ bucket: string; totalCents: number; orderCount: number }>;
};

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
  const [range, setRange] = useState<TimeRange>('today');
  const [data, setData] = useState<HomeAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    api.analytics.home(range)
      .then((next) => {
        if (!active) return;
        setData(next);
      })
      .catch(() => {
        if (!active) return;
        setData(null);
        setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [api, range, reloadKey]);

  const nav = useCallback((route: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    router.push(route as never);
  }, [router]);

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

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: topInset + SP.sm }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <Text style={styles.screenTitle}>Home</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.rangeRow}
        >
          {RANGES.map((item) => {
            const selected = item.id === range;
            return (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.rangePill,
                  selected && { backgroundColor: theme.accentDim, borderColor: theme.accent },
                ]}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setRange(item.id);
                }}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.rangeText, selected && { color: theme.accentLight }]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.summary}>
          {loading ? (
            <ActivityIndicator size="small" color={theme.accent} />
          ) : error ? (
            <Pressable style={styles.errorState} onPress={() => setReloadKey((key) => key + 1)}>
              <Feather name="alert-circle" size={18} color={MUTED} />
              <Text style={styles.errorText}>Could not load dashboard. Tap to retry.</Text>
            </Pressable>
          ) : (
            <>
              <View style={styles.primaryStat}>
                <Text style={styles.statLabel}>Total sales</Text>
                <Text style={styles.salesValue}>{formatCents(data?.totalCents ?? 0)}</Text>
                <Text style={styles.orderCount}>
                  {data?.orderCount ?? 0} {(data?.orderCount ?? 0) === 1 ? 'order' : 'orders'}
                </Text>
              </View>
              <View style={styles.secondaryStat}>
                <Feather name="users" size={18} color={theme.accentLight} />
                <Text style={styles.visitorValue}>{data?.visitorCount ?? 0}</Text>
                <Text style={styles.visitorLabel}>{range === 'live' ? 'online visitors' : 'visitors'}</Text>
              </View>
            </>
          )}
        </View>

        <TouchableOpacity
          style={[styles.dashboardButton, { backgroundColor: theme.accent }]}
          activeOpacity={0.85}
          onPress={() => nav('/(tabs)/analytics')}
        >
          <Text style={[styles.dashboardButtonText, { color: theme.onAccent }]}>View dashboard</Text>
          <Feather name="arrow-right" size={17} color={theme.onAccent} />
        </TouchableOpacity>

        <View style={styles.chartCard}>
          <View style={styles.chartHeader}>
            <Text style={styles.sectionTitle}>Sales activity</Text>
            <Text style={styles.chartRange}>{RANGES.find((item) => item.id === range)?.label}</Text>
          </View>
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
                          height: maxBucket > 0 ? `${Math.max(5, ratio * 100)}%` : 0,
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
          {!loading && !error && maxBucket === 0 && (
            <Text style={styles.flatChartText}>No sales in this time range</Text>
          )}
        </View>

        <View style={styles.actionCard}>
          {(data?.toFulfill ?? 0) > 0 && (
            <TouchableOpacity style={styles.actionRow} onPress={() => nav('/(tabs)/orders')}>
              <View style={styles.actionCopy}>
                <Text style={styles.actionTitle}>
                  {data!.toFulfill} {data!.toFulfill === 1 ? 'order' : 'orders'} to fulfill
                </Text>
                <Text style={styles.actionSubtitle}>Review paid orders awaiting fulfillment</Text>
              </View>
              <Feather name="chevron-right" size={20} color={MUTED} />
            </TouchableOpacity>
          )}
          {(data?.toCapture ?? 0) > 0 && (
            <TouchableOpacity style={styles.actionRow} onPress={() => nav('/payments')}>
              <View style={styles.actionCopy}>
                <Text style={styles.actionTitle}>
                  {data!.toCapture} {data!.toCapture === 1 ? 'payment' : 'payments'} to capture
                </Text>
                <Text style={styles.actionSubtitle}>Review authorized payments</Text>
              </View>
              <Feather name="chevron-right" size={20} color={MUTED} />
            </TouchableOpacity>
          )}
          {!loading && !error && (data?.toFulfill ?? 0) === 0 && (data?.toCapture ?? 0) === 0 && (
            <View style={styles.emptyActions}>
              <Feather name="check-circle" size={18} color={MUTED} />
              <Text style={styles.emptyActionsText}>No orders or payments need attention</Text>
            </View>
          )}
        </View>

        {unfinishedTasks.length > 0 && (
          <View style={styles.setupSection}>
            <View style={styles.setupHeader}>
              <Text style={styles.sectionTitle}>Set up your business</Text>
              <Text style={styles.setupCount}>{unfinishedTasks.length} remaining</Text>
            </View>
            {unfinishedTasks.map((task) => (
              <TouchableOpacity
                key={task.id}
                style={styles.setupCard}
                activeOpacity={0.85}
                onPress={() => openTask(task)}
              >
                <View style={[styles.setupIcon, { backgroundColor: theme.accentDim }]}>
                  <Feather name={task.icon as keyof typeof Feather.glyphMap} size={20} color={theme.accentLight} />
                </View>
                <View style={styles.setupCopy}>
                  <Text style={styles.setupTitle}>{task.label}</Text>
                  <Text style={styles.setupDescription}>{task.description}</Text>
                </View>
                <Pressable
                  style={styles.optionsButton}
                  hitSlop={10}
                  onPress={(event) => {
                    event.stopPropagation();
                    showTaskOptions(task);
                  }}
                  accessibilityLabel={`Options for ${task.label}`}
                >
                  <Feather name="more-horizontal" size={20} color={MUTED} />
                </Pressable>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      <SellerStudioRadialMenu />
      <AIBrainFAB context={{ screen: 'home' as const }} bottomOffset={72} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SCREEN_BG },
  scroll: { paddingBottom: 160 },
  topBar: {
    minHeight: 58,
    paddingHorizontal: SP.md,
    justifyContent: 'center',
  },
  screenTitle: { color: FG, fontFamily: FONT.bold, fontSize: FS.xl },
  rangeRow: { paddingHorizontal: SP.md, gap: SP.xs, paddingBottom: SP.lg },
  rangePill: {
    minHeight: 38,
    paddingHorizontal: SP.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
  },
  rangeText: { color: MUTED, fontFamily: FONT.semibold, fontSize: FS.sm },
  summary: {
    minHeight: 126,
    marginHorizontal: SP.md,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingBottom: SP.lg,
  },
  primaryStat: { flex: 1 },
  statLabel: { color: MUTED, fontFamily: FONT.medium, fontSize: FS.sm },
  salesValue: { color: FG, fontFamily: FONT.bold, fontSize: 38, marginTop: SP.xs },
  orderCount: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, marginTop: SP.xs },
  secondaryStat: {
    minWidth: 112,
    borderLeftWidth: 1,
    borderLeftColor: BORDER,
    paddingLeft: SP.lg,
    alignItems: 'flex-start',
    gap: 3,
  },
  visitorValue: { color: FG, fontFamily: FONT.bold, fontSize: FS.xl },
  visitorLabel: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.xs },
  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SP.sm },
  errorText: { color: MUTED, fontFamily: FONT.medium, fontSize: FS.sm },
  dashboardButton: {
    margin: SP.md,
    minHeight: 48,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
  },
  dashboardButtonText: { fontFamily: FONT.bold, fontSize: FS.sm },
  chartCard: {
    marginHorizontal: SP.md,
    padding: SP.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
  },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { color: FG, fontFamily: FONT.bold, fontSize: FS.md },
  chartRange: { color: MUTED, fontFamily: FONT.medium, fontSize: FS.xs },
  chart: { height: 150, flexDirection: 'row', alignItems: 'flex-end', gap: SP.xs, marginTop: SP.lg },
  barColumn: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'flex-end', gap: SP.xs },
  barTrack: { flex: 1, width: '52%', justifyContent: 'flex-end', borderBottomWidth: 1, borderBottomColor: BORDER },
  bar: { width: '100%', borderTopLeftRadius: RADIUS.xs, borderTopRightRadius: RADIUS.xs },
  barLabel: { color: MUTED, fontFamily: FONT.regular, fontSize: 9 },
  flatChartText: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.xs, textAlign: 'center', marginTop: SP.sm },
  actionCard: {
    margin: SP.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
    overflow: 'hidden',
  },
  actionRow: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  actionCopy: { flex: 1 },
  actionTitle: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm },
  actionSubtitle: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 3 },
  emptyActions: { minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm },
  emptyActionsText: { color: MUTED, fontFamily: FONT.medium, fontSize: FS.sm },
  setupSection: { paddingHorizontal: SP.md, gap: SP.sm },
  setupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.xs },
  setupCount: { color: MUTED, fontFamily: FONT.medium, fontSize: FS.xs },
  setupCard: {
    minHeight: 98,
    padding: SP.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.md,
  },
  setupIcon: { width: 44, height: 44, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  setupCopy: { flex: 1 },
  setupTitle: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm },
  setupDescription: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.xs, lineHeight: 17, marginTop: 4 },
  optionsButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});