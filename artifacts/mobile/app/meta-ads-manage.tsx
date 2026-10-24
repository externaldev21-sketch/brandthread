/**
 * Brandthread — Manage Meta ad campaigns
 * Route: /meta-ads-manage
 *
 * Not connected → EmptyState routing to /meta-ads-connect.
 * Connected → campaign list with status, insights, and per-campaign
 * pause/resume, edit budget, duplicate actions.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { formatCents } from '@/lib/money';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
  ActivityIndicator, RefreshControl, TextInput, Platform,
} from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { Sheet } from '@/components/ui/BottomSheet';
import { hapticSuccess } from '@/lib/haptics';
import { Button } from '@/components/ui/Button';
import { useRouter } from 'expo-router';

import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/hooks/useApi';
import {
  BrandthreadScreen, BrandthreadCard, EmptyState,
  StatusBadge, IconButton, PrimaryButton,
} from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ErrorState } from '@/components/ui/ErrorState';
import { RetryRow } from '@/components/ui/RetryRow';
import { friendlyError } from '@/lib/friendlyError';
import { metaCampaignStatusVariant, metaCampaignStatusLabel, formatBudgetCents, META_OBJECTIVE_OPTIONS } from '@/services/metaAdsService';
import type { MetaCampaign, MetaCampaignInsights } from '@/lib/api';
import { radius } from '@/constants/radii';
import { formatMoney } from '@/lib/format';

type Row = MetaCampaign & { insights?: MetaCampaignInsights };

const objectiveLabel = (o: string) => META_OBJECTIVE_OPTIONS.find((x) => x.objective === o)?.label ?? o;

export default function MetaAdsManageScreen() {
  const router = useRouter();
  const api = useApi();
  const { theme } = useAppTheme();
  const colors = useColors();

  const [checking, setChecking] = useState(true);
  const [connected, setConnected] = useState(false);
  // The connection check itself failed (network / 5xx) — distinct from a
  // successful "not connected" answer, which is the only case offering Connect.
  const [checkError, setCheckError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Which action is in flight, so only that button shows a spinner.
  const [busyAction, setBusyAction] = useState<'toggle' | 'duplicate' | 'refresh' | 'budget' | null>(null);
  const [editingBudget, setEditingBudget] = useState<Row | null>(null);
  const [budgetInput, setBudgetInput] = useState('');

  const loadCampaigns = useCallback(async () => {
    setError(null);
    try {
      const { campaigns } = await api.metaAds.list();
      setRows(campaigns);
    } catch (err) {
      // Rows from the last good load stay in place; the render picks the
      // full error state only when there is nothing to show.
      setError(friendlyError(err, "Couldn't load your campaigns."));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const checkConnection = useCallback(async () => {
    setChecking(true);
    setCheckError(null);
    try {
      const conn = await api.metaAds.connection();
      const isConnected = !!conn.connected && conn.status === 'connected';
      setConnected(isConnected);
      if (isConnected) { setLoading(true); await loadCampaigns(); setLoading(false); }
    } catch (err) {
      setCheckError(friendlyError(err, "Couldn't check your Meta connection."));
    } finally {
      setChecking(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  useEffect(() => {
    void checkConnection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    await loadCampaigns();
    setRefreshing(false);
  }

  async function handlePauseResume(row: Row) {
    setBusyId(row.id);
    setBusyAction('toggle');
    try {
      const { campaign } = row.status === 'active' ? await api.metaAds.pause(row.id) : await api.metaAds.resume(row.id);
      setRows((prev) => prev?.map((r) => (r.id === row.id ? { ...r, ...campaign } : r)) ?? prev);
    } catch {
      Alert.alert(`Couldn't ${row.status === 'active' ? 'pause' : 'resume'} campaign`, 'Try again.');
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  }

  async function handleDuplicate(row: Row) {
    setBusyId(row.id);
    setBusyAction('duplicate');
    try {
      const { campaign } = await api.metaAds.duplicate(row.id);
      setRows((prev) => (prev ? [campaign, ...prev] : prev));
    } catch {
      Alert.alert("Couldn't duplicate campaign", 'Try again.');
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  }

  async function handleRefreshInsights(row: Row) {
    setBusyId(row.id);
    setBusyAction('refresh');
    try {
      const { insights } = await api.metaAds.refreshInsights(row.id);
      setRows((prev) => prev?.map((r) => (r.id === row.id ? { ...r, insights } : r)) ?? prev);
    } catch {
      Alert.alert("Couldn't refresh insights", 'Try again later.');
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  }

  function openBudgetEditor(row: Row) {
    setEditingBudget(row);
    setBudgetInput(String(Math.round(row.budgetCents / 100)));
  }

  async function saveBudget() {
    if (!editingBudget) return;
    const dollars = Number(budgetInput);
    if (!Number.isFinite(dollars) || dollars < 5) {
      Alert.alert('Invalid budget', 'Enter a whole-dollar budget of at least $5.');
      return;
    }
    const id = editingBudget.id;
    setBusyId(id);
    setBusyAction('budget');
    try {
      const { campaign } = await api.metaAds.updateCampaign(id, { budgetCents: Math.round(dollars * 100) });
      setRows((prev) => prev?.map((r) => (r.id === id ? { ...r, ...campaign } : r)) ?? prev);
      hapticSuccess();
      setEditingBudget(null);
    } catch {
      Alert.alert("Couldn't update budget", 'Try again.');
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  }

  if (checking) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScreenHeader title="Meta Ads" onBack={() => goBackOr(router)} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.accentLight} size="large" />
        </View>
      </View>
    );
  }

  if (checkError) {
    return (
      <BrandthreadScreen noSafeTop>
        <ScreenHeader title="Meta Ads" onBack={() => goBackOr(router)} />
        <ErrorState message={checkError} onRetry={() => { void checkConnection(); }} style={{ marginTop: SP.xl }} />
      </BrandthreadScreen>
    );
  }

  if (!connected) {
    return (
      <BrandthreadScreen noSafeTop>
        <ScreenHeader title="Meta Ads" onBack={() => goBackOr(router)} />
        <EmptyState
          icon="link"
          title="Connect Meta to run ads"
          description="Connect your Facebook & Instagram account to start running ads through Brandthread."
          action={{ label: 'Connect Meta', onPress: () => router.push('/meta-ads-connect') }}
          style={{ marginTop: SP.xl }}
        />
      </BrandthreadScreen>
    );
  }

  return (
    <BrandthreadScreen noSafeTop>
      <ScreenHeader
        title="Meta Ads"
        onBack={() => goBackOr(router)}
        rightElement={<IconButton name="plus" accessibilityLabel="New campaign" onPress={() => router.push('/meta-ads-setup')} />}
      />
      <ScrollView
        contentContainerStyle={{ padding: SP.md, paddingBottom: SP.lg, gap: SP.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accentLight} />}
      >
        {loading && (
          <ActivityIndicator color={theme.accentLight} style={{ marginTop: SP.xl }} />
        )}

        {/* Full error only when nothing has loaded yet; a failed refresh keeps
            the last good cards and shows a compact retry above them. */}
        {!loading && error && !(rows && rows.length > 0) && (
          <EmptyState icon="alert-circle" title="Couldn't load campaigns" description={error} action={{ label: 'Retry', onPress: loadCampaigns }} />
        )}

        {!loading && error && rows && rows.length > 0 && (
          <RetryRow label="Couldn't refresh campaigns" onRetry={() => { void onRefresh(); }} />
        )}

        {!loading && !error && rows && rows.length === 0 && (
          <EmptyState
            icon="zap"
            title="No campaigns yet"
            description="Build your first Meta ad in a couple of minutes."
            action={{ label: 'New campaign', onPress: () => router.push('/meta-ads-setup') }}
          />
        )}

        {!loading && rows?.map((row) => (
          <CampaignCard
            key={row.id}
            row={row}
            busy={busyId === row.id}
            busyAction={busyId === row.id ? busyAction : null}
            colors={colors}
            theme={theme}
            onPauseResume={() => handlePauseResume(row)}
            onDuplicate={() => handleDuplicate(row)}
            onRefreshInsights={() => handleRefreshInsights(row)}
            onEditBudget={() => openBudgetEditor(row)}
            onFixAndRelaunch={() => router.push(`/meta-ads-setup?id=${encodeURIComponent(row.id)}`)}
          />
        ))}
      </ScrollView>

      <Sheet
        visible={!!editingBudget}
        onClose={() => setEditingBudget(null)}
        title="Edit budget"
        testID="meta-budget-sheet"
        primaryAction={{ label: 'Save budget', onPress: () => { void saveBudget(); }, loading: !!editingBudget && busyId === editingBudget.id }}
      >
            <View style={[s.budgetInputRow, { borderColor: colors.border, backgroundColor: colors.elevated }]}>
              <Text style={[s.modalTitle, { color: colors.mutedForeground }]}>$</Text>
              <TextInput returnKeyType="done"
                value={budgetInput}
                onChangeText={setBudgetInput}
                keyboardType="number-pad"
                style={[s.budgetInput, { color: colors.foreground }]}
                placeholder="20"
                placeholderTextColor={colors.subtle}
                accessibilityLabel="Budget in dollars"
              />
            </View>
      </Sheet>
    </BrandthreadScreen>
  );
}

function CampaignCard({
  row, busy, busyAction, colors, theme, onPauseResume, onDuplicate, onRefreshInsights, onEditBudget, onFixAndRelaunch,
}: {
  row: Row; busy: boolean; busyAction: string | null; colors: ReturnType<typeof useColors>; theme: ReturnType<typeof useAppTheme>['theme'];
  onPauseResume: () => void; onDuplicate: () => void; onRefreshInsights: () => void;
  onEditBudget: () => void; onFixAndRelaunch: () => void;
}) {
  const i = row.insights;
  const money = (c?: number) => formatMoney(c ?? 0);
  return (
    <BrandthreadCard>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: SP.sm }}>
        <View style={{ flex: 1 }}>
          <Text style={[s.rowTitle, { color: colors.foreground }]} numberOfLines={1}>{row.headline || 'Untitled campaign'}</Text>
          <Text style={[s.rowSub, { color: colors.mutedForeground }]}>
            {formatBudgetCents(row.budgetCents)}{row.budgetType === 'daily' ? '/day' : ' total'} · {objectiveLabel(row.objective)}
          </Text>
        </View>
        <StatusBadge label={metaCampaignStatusLabel(row.status)} variant={metaCampaignStatusVariant(row.status)} small />
      </View>

      {row.status === 'rejected' && row.rejectionReason && (
        <View style={[s.rejectBox, { backgroundColor: colors.destructive + '14', borderColor: colors.destructive }]}>
          <Icon name="alert-triangle" size={14} color={colors.destructive} />
          <Text style={[s.rowSub, { color: colors.destructive, flex: 1 }]}>{row.rejectionReason}</Text>
        </View>
      )}

      {i && (
        <View style={s.statRow}>
          <Stat label="Spend" value={money(i.spendCents)} colors={colors} />
          <Stat label="Reach" value={i.reach.toLocaleString()} colors={colors} />
          <Stat label="Clicks" value={i.clicks.toLocaleString()} colors={colors} />
          <Stat label="CTR" value={`${(i.ctr * 100).toFixed(2)}%`} colors={colors} />
          <Stat label="CPC" value={money(i.cpcCents)} colors={colors} />
          <Stat label="Purchases" value={i.purchases.toLocaleString()} colors={colors} />
          <Stat label="ROAS" value={`${i.roas.toFixed(2)}x`} colors={colors} />
        </View>
      )}

      <View style={s.actionsRow}>
        {row.status === 'rejected' ? (
          <ActionBtn label="Fix & relaunch" icon="edit-2" onPress={onFixAndRelaunch} colors={colors} theme={theme} />
        ) : (
          <>
            {(row.status === 'active' || row.status === 'paused') && (
              <ActionBtn label={row.status === 'active' ? 'Pause' : 'Resume'} icon={row.status === 'active' ? 'pause' : 'play'} onPress={onPauseResume} busy={busy} spinning={busyAction === 'toggle'} colors={colors} theme={theme} />
            )}
            <ActionBtn label="Edit budget" icon="dollar-sign" onPress={onEditBudget} busy={busy} spinning={busyAction === 'budget'} colors={colors} theme={theme} />
            <ActionBtn label="Duplicate" icon="copy" onPress={onDuplicate} busy={busy} spinning={busyAction === 'duplicate'} colors={colors} theme={theme} />
            {row.status === 'active' && (
              <ActionBtn label="Refresh" icon="refresh-cw" onPress={onRefreshInsights} busy={busy} spinning={busyAction === 'refresh'} colors={colors} theme={theme} />
            )}
          </>
        )}
      </View>
    </BrandthreadCard>
  );
}

function Stat({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={s.stat}>
      <Text style={[s.statValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[s.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

function ActionBtn({ label, icon, onPress, busy, spinning, colors, theme }: any) {
  return (
    <TouchableOpacity
      style={[s.actionBtn, { backgroundColor: colors.elevated, borderColor: colors.border }]}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {spinning ? <ActivityIndicator size="small" color={theme.accentLight} /> : <Icon name={icon} size={13} color={colors.foreground} />}
      <Text style={[s.actionBtnText, { color: colors.foreground }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  modalTitle: { fontSize: FS.lg, fontFamily: FONT.bold },
  rowTitle:   { fontSize: FS.base, fontFamily: FONT.bold },
  rowSub:     { fontSize: FS.meta, fontFamily: FONT.regular, marginTop: 2 },
  rejectBox:  { flexDirection: 'row', gap: SP.sm, alignItems: 'flex-start', borderRadius: RADIUS.sm, borderWidth: 1, padding: SP.sm, marginTop: SP.sm },
  statRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: SP.md, marginTop: SP.sm },
  stat:       { minWidth: 72 },
  statValue:  { fontSize: FS.sm, fontFamily: FONT.bold, fontVariant: ['tabular-nums'] },
  statLabel:  { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 1 },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginTop: SP.md },
  actionBtn:  { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  actionBtnText: { fontSize: FS.xs, fontFamily: FONT.semibold },
  currency: { fontSize: FS.lg, fontFamily: FONT.bold },
  budgetInputRow: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: SP.md, minHeight: 48 },
  budgetInput: { flex: 1, fontSize: FS.lg, fontFamily: FONT.bold, paddingVertical: SP.sm },
});
