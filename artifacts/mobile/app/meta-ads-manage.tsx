/**
 * Brandthread — Manage Meta ad campaigns
 * Route: /meta-ads-manage
 *
 * Not connected → EmptyState routing to /meta-ads-connect.
 * Connected → campaign list with status, insights, and per-campaign
 * pause/resume, edit budget, duplicate actions.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
  ActivityIndicator, RefreshControl, Modal, TextInput, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { useRouter } from 'expo-router';

import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/hooks/useApi';
import {
  BrandthreadScreen, BrandthreadHeader, BrandthreadCard, EmptyState,
  StatusBadge, IconButton, PrimaryButton,
} from '@/components/BrandthreadUI';
import { metaCampaignStatusVariant, metaCampaignStatusLabel, formatBudgetCents } from '@/services/metaAdsService';
import type { MetaCampaign, MetaCampaignInsights } from '@/lib/api';

type Row = MetaCampaign & { insights?: MetaCampaignInsights };

export default function MetaAdsManageScreen() {
  const router = useRouter();
  const api = useApi();
  const { theme } = useAppTheme();
  const colors = useColors();

  const [checking, setChecking] = useState(true);
  const [connected, setConnected] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingBudget, setEditingBudget] = useState<Row | null>(null);
  const [budgetInput, setBudgetInput] = useState('');

  const loadCampaigns = useCallback(async () => {
    setError(null);
    try {
      const { campaigns } = await api.metaAds.list();
      setRows(campaigns);
    } catch {
      setError('Could not load your campaigns.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  useEffect(() => {
    (async () => {
      try {
        const conn = await api.metaAds.connection();
        const isConnected = !!conn.connected && conn.status === 'connected';
        setConnected(isConnected);
        if (isConnected) { setLoading(true); await loadCampaigns(); setLoading(false); }
      } catch {
        setConnected(false);
      } finally {
        setChecking(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    await loadCampaigns();
    setRefreshing(false);
  }

  async function handlePauseResume(row: Row) {
    setBusyId(row.id);
    try {
      const { campaign } = row.status === 'active' ? await api.metaAds.pause(row.id) : await api.metaAds.resume(row.id);
      setRows((prev) => prev?.map((r) => (r.id === row.id ? { ...r, ...campaign } : r)) ?? prev);
    } catch {
      Alert.alert('Error', `Could not ${row.status === 'active' ? 'pause' : 'resume'} this campaign. Please try again.`);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDuplicate(row: Row) {
    setBusyId(row.id);
    try {
      const { campaign } = await api.metaAds.duplicate(row.id);
      setRows((prev) => (prev ? [campaign, ...prev] : prev));
    } catch {
      Alert.alert('Error', 'Could not duplicate this campaign. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleRefreshInsights(row: Row) {
    setBusyId(row.id);
    try {
      const { insights } = await api.metaAds.refreshInsights(row.id);
      setRows((prev) => prev?.map((r) => (r.id === row.id ? { ...r, insights } : r)) ?? prev);
    } catch {
      Alert.alert('Error', 'Could not refresh insights right now.');
    } finally {
      setBusyId(null);
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
    try {
      const { campaign } = await api.metaAds.updateCampaign(id, { budgetCents: Math.round(dollars * 100) });
      setRows((prev) => prev?.map((r) => (r.id === id ? { ...r, ...campaign } : r)) ?? prev);
      setEditingBudget(null);
    } catch {
      Alert.alert('Error', 'Could not update the budget. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  if (checking) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accentLight} size="large" />
      </View>
    );
  }

  if (!connected) {
    return (
      <BrandthreadScreen>
        <BrandthreadHeader title="Meta Ads" onBack={() => router.back()} />
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
    <BrandthreadScreen>
      <BrandthreadHeader
        title="Meta Ads"
        onBack={() => router.back()}
        rightElement={<IconButton name="plus" accessibilityLabel="New campaign" onPress={() => router.push('/meta-ads-setup')} />}
      />
      <ScrollView
        contentContainerStyle={{ padding: SP.md, gap: SP.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accentLight} />}
      >
        {loading && (
          <ActivityIndicator color={theme.accentLight} style={{ marginTop: SP.xl }} />
        )}

        {!loading && error && (
          <EmptyState icon="alert-circle" title="Something went wrong" description={error} action={{ label: 'Retry', onPress: loadCampaigns }} />
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

      <Modal visible={!!editingBudget} transparent animationType="fade" onRequestClose={() => setEditingBudget(null)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[s.modalTitle, { color: colors.foreground }]}>Edit budget</Text>
            <View style={[s.budgetInputRow, { borderColor: colors.border, backgroundColor: colors.elevated }]}>
              <Text style={[s.modalTitle, { color: colors.mutedForeground }]}>$</Text>
              <TextInput
                value={budgetInput}
                onChangeText={setBudgetInput}
                keyboardType="number-pad"
                style={[s.budgetInput, { color: colors.foreground }]}
                placeholder="20"
                placeholderTextColor={colors.subtle}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: SP.sm, marginTop: SP.md }}>
              <Button label="Cancel" variant="secondary" style={s.modalBtn} onPress={() => setEditingBudget(null)} />
              <Button label="Save" variant="primary" style={s.modalBtn} loading={busyId === editingBudget?.id} onPress={saveBudget} />
            </View>
          </View>
        </View>
      </Modal>
    </BrandthreadScreen>
  );
}

function CampaignCard({
  row, busy, colors, theme, onPauseResume, onDuplicate, onRefreshInsights, onEditBudget, onFixAndRelaunch,
}: {
  row: Row; busy: boolean; colors: ReturnType<typeof useColors>; theme: ReturnType<typeof useAppTheme>['theme'];
  onPauseResume: () => void; onDuplicate: () => void; onRefreshInsights: () => void;
  onEditBudget: () => void; onFixAndRelaunch: () => void;
}) {
  const i = row.insights;
  const money = (c?: number) => `$${((c ?? 0) / 100).toFixed(2)}`;
  return (
    <BrandthreadCard>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: SP.sm }}>
        <View style={{ flex: 1 }}>
          <Text style={[s.rowTitle, { color: colors.foreground }]} numberOfLines={1}>{row.headline || 'Untitled campaign'}</Text>
          <Text style={[s.rowSub, { color: colors.mutedForeground }]}>
            {formatBudgetCents(row.budgetCents)}{row.budgetType === 'daily' ? '/day' : ' total'} · {row.objective}
          </Text>
        </View>
        <StatusBadge label={metaCampaignStatusLabel(row.status)} variant={metaCampaignStatusVariant(row.status)} small />
      </View>

      {row.status === 'rejected' && row.rejectionReason && (
        <View style={[s.rejectBox, { backgroundColor: colors.destructive + '14', borderColor: colors.destructive }]}>
          <Feather name="alert-triangle" size={14} color={colors.destructive} />
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
          <Stat label="ROAS" value={i.roas.toFixed(2)} colors={colors} />
        </View>
      )}

      <View style={s.actionsRow}>
        {row.status === 'rejected' ? (
          <ActionBtn label="Fix & relaunch" icon="edit-2" onPress={onFixAndRelaunch} colors={colors} theme={theme} />
        ) : (
          <>
            {(row.status === 'active' || row.status === 'paused') && (
              <ActionBtn label={row.status === 'active' ? 'Pause' : 'Resume'} icon={row.status === 'active' ? 'pause' : 'play'} onPress={onPauseResume} busy={busy} colors={colors} theme={theme} />
            )}
            <ActionBtn label="Edit budget" icon="dollar-sign" onPress={onEditBudget} busy={busy} colors={colors} theme={theme} />
            <ActionBtn label="Duplicate" icon="copy" onPress={onDuplicate} busy={busy} colors={colors} theme={theme} />
            {row.status === 'active' && (
              <ActionBtn label="Refresh" icon="refresh-cw" onPress={onRefreshInsights} busy={busy} colors={colors} theme={theme} />
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

function ActionBtn({ label, icon, onPress, busy, colors, theme }: any) {
  return (
    <TouchableOpacity
      style={[s.actionBtn, { backgroundColor: colors.elevated, borderColor: colors.border }]}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {busy ? <ActivityIndicator size="small" color={theme.accentLight} /> : <Feather name={icon} size={13} color={colors.foreground} />}
      <Text style={[s.actionBtnText, { color: colors.foreground }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  rowTitle:   { fontSize: FS.base, fontFamily: FONT.bold },
  rowSub:     { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  rejectBox:  { flexDirection: 'row', gap: SP.sm, alignItems: 'flex-start', borderRadius: RADIUS.sm, borderWidth: 1, padding: SP.sm, marginTop: SP.sm },
  statRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: SP.md, marginTop: SP.sm },
  stat:       { minWidth: 72 },
  statValue:  { fontSize: FS.sm, fontFamily: FONT.bold },
  statLabel:  { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 1 },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginTop: SP.md },
  actionBtn:  { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADIUS.pill, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  actionBtnText: { fontSize: FS.xs, fontFamily: FONT.semibold },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: SP.lg },
  modalCard:  { width: '100%', maxWidth: 360, borderRadius: RADIUS.lg, borderWidth: 1, padding: SP.lg },
  modalTitle: { fontSize: FS.lg, fontFamily: FONT.bold },
  budgetInputRow: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: SP.md, marginTop: SP.md, minHeight: 48 },
  budgetInput: { flex: 1, fontSize: FS.lg, fontFamily: FONT.bold, paddingVertical: SP.sm },
  modalBtn:   { flex: 1 },
});
