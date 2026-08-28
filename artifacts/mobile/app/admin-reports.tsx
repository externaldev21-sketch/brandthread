/**
 * Admin Reports — review user-submitted reports across the platform.
 * Accessible from seller-settings → More → Review Reports.
 *
 * Displays all pending/reviewed/actioned reports and lets a moderator
 * update the status of each one. Backed by the existing:
 *   GET  /api/reports              — list all reports (requires auth)
 *   PATCH /api/reports/:id/status  — update status
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Alert, Modal,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/hooks/useApi';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE,
  SUCCESS, SUCCESS_DIM,
  ORANGE, ORANGE_DIM,
  RED, RED_DIM,
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { fmtRelative } from '@/lib/format';

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportStatus = 'pending' | 'reviewed' | 'actioned' | 'dismissed';

interface Report {
  id: string;
  reporterId: string;
  targetType: string;
  targetId: string;
  targetLabel: string | null;
  reason: string;
  description: string | null;
  status: ReportStatus;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<ReportStatus, string> = {
  pending: 'Pending',
  reviewed: 'Reviewed',
  actioned: 'Actioned',
  dismissed: 'Dismissed',
};

const TARGET_ICON: Record<string, keyof typeof Feather.glyphMap> = {
  post:     'image',
  product:  'shopping-bag',
  profile:  'user',
  story:    'play-circle',
  message:  'message-circle',
  seller:   'store' as any,
};

function StatusPill({ status }: { status: ReportStatus }) {
  const colors = useColors();
  const statusColors: Record<ReportStatus, { bg: string; fg: string }> = {
    pending: { bg: ORANGE_DIM, fg: ORANGE },
    reviewed: { bg: colors.accent, fg: colors.accentForeground },
    actioned: { bg: SUCCESS_DIM, fg: SUCCESS },
    dismissed: { bg: SUBTLE + '60', fg: MUTED },
  };
  const c = statusColors[status] ?? statusColors.pending;
  return (
    <View style={[pill.root, { backgroundColor: c.bg }]}>
      <Text style={[pill.text, { color: c.fg }]}>{STATUS_LABELS[status]}</Text>
    </View>
  );
}
const pill = StyleSheet.create({
  root: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  text: { fontSize: 11, fontFamily: FONT.semibold, letterSpacing: 0.3 },
});

// ─── Status picker modal ──────────────────────────────────────────────────────

const NEXT_STATUSES: ReportStatus[] = ['pending', 'reviewed', 'actioned', 'dismissed'];

function StatusModal({
  visible, reportId, current, onClose, onSave,
}: {
  visible: boolean; reportId: string; current: ReportStatus;
  onClose: () => void; onSave: (id: string, status: ReportStatus) => void;
}) {
  const colors = useColors();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={mod.overlay} activeOpacity={1} onPress={onClose}>
        <View style={mod.sheet}>
          <Text style={mod.title}>Update Status</Text>
          {NEXT_STATUSES.map(s => (
            <TouchableOpacity
              key={s}
              style={[mod.option, s === current && { backgroundColor: colors.accent }]}
              activeOpacity={0.8}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSave(reportId, s); }}
            >
              <Text style={[mod.optionText, s === current && { color: colors.accentForeground }]}>
                {STATUS_LABELS[s]}
              </Text>
              {s === current && <Feather name="check" size={16} color={colors.accentForeground} />}
            </TouchableOpacity>
          ))}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}
const mod = StyleSheet.create({
  overlay:         { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet:           { backgroundColor: CARD, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: SP.lg, paddingBottom: SP.xl + 20 },
  title:           { fontSize: FS.base, fontFamily: FONT.bold, color: FG, marginBottom: SP.md },
  option:          { paddingVertical: 14, paddingHorizontal: SP.sm, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  optionText:      { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
});

// ─── Filter tab bar ───────────────────────────────────────────────────────────

type Filter = 'all' | ReportStatus;

function TabBar({ active, onChange, counts }: {
  active: Filter; onChange: (f: Filter) => void;
  counts: Record<Filter, number>;
}) {
  const colors = useColors();
  const tabs: Filter[] = ['all', 'pending', 'reviewed', 'actioned', 'dismissed'];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingBottom: 12 }}
    >
      {tabs.map(t => {
        const isActive = t === active;
        return (
          <TouchableOpacity
            key={t}
            style={[tabs_.pill, isActive && { backgroundColor: colors.accent, borderColor: colors.accent }]}
            onPress={() => { Haptics.selectionAsync(); onChange(t); }}
            activeOpacity={0.75}
          >
            <Text style={[tabs_.text, isActive && { color: colors.accentForeground, fontFamily: FONT.semibold }]}>
              {t === 'all' ? 'All' : STATUS_LABELS[t as ReportStatus]}
              {counts[t] > 0 ? ` (${counts[t]})` : ''}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}
const tabs_ = StyleSheet.create({
  pill:       { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  text:       { fontSize: 13, fontFamily: FONT.medium, color: MUTED },
});

// ─── Report card ──────────────────────────────────────────────────────────────

function ReportCard({ report, onStatusPress }: {
  report: Report; onStatusPress: (r: Report) => void;
}) {
  const icon = TARGET_ICON[report.targetType] ?? 'flag';
  return (
    <View style={card.root}>
      <View style={card.header}>
        <View style={[card.icon, { backgroundColor: RED_DIM }]}>
          <Feather name={icon} size={15} color={RED} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={card.target} numberOfLines={1}>
            {report.targetType.charAt(0).toUpperCase() + report.targetType.slice(1)}
            {report.targetLabel ? ` · ${report.targetLabel}` : ''}
          </Text>
          <Text style={card.time}>{fmtRelative(report.createdAt)}</Text>
        </View>
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onStatusPress(report); }}
          activeOpacity={0.75}
        >
          <StatusPill status={report.status} />
        </TouchableOpacity>
      </View>

      <Text style={card.reason}>{report.reason.replace(/_/g, ' ')}</Text>
      {report.description ? (
        <Text style={card.desc} numberOfLines={3}>{report.description}</Text>
      ) : null}
    </View>
  );
}
const card = StyleSheet.create({
  root:   { backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, padding: 14, marginBottom: 10 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  icon:   { width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  target: { fontSize: 13, fontFamily: FONT.semibold, color: FG, flex: 1 },
  time:   { fontSize: 11, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  reason: { fontSize: 12, fontFamily: FONT.medium, color: ORANGE, textTransform: 'capitalize', marginBottom: 4 },
  desc:   { fontSize: 12, fontFamily: FONT.regular, color: MUTED, lineHeight: 17 },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AdminReportsScreen() {
  const colors = useColors();
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const api     = useApi();

  const [reports,    setReports]    = useState<Report[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter,     setFilter]     = useState<Filter>('pending');
  const [modal,      setModal]      = useState<Report | null>(null);
  const [saving,     setSaving]     = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const rows = await (api as any).reports.list() as Report[];
      setReports(rows ?? []);
    } catch (err: any) {
      if (!isRefresh) Alert.alert('Error', err?.message ?? 'Could not load reports');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [api]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleStatusSave(id: string, status: ReportStatus) {
    setModal(null);
    setSaving(true);
    try {
      await (api as any).reports.updateStatus(id, status);
      setReports(prev => prev.map(r => r.id === id ? { ...r, status } : r));
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not update status');
    } finally {
      setSaving(false);
    }
  }

  const visible = filter === 'all'
    ? reports
    : reports.filter(r => r.status === filter);

  const counts: Record<Filter, number> = {
    all:       reports.length,
    pending:   reports.filter(r => r.status === 'pending').length,
    reviewed:  reports.filter(r => r.status === 'reviewed').length,
    actioned:  reports.filter(r => r.status === 'actioned').length,
    dismissed: reports.filter(r => r.status === 'dismissed').length,
  };

  return (
    <View style={[s.root, { backgroundColor: BG }]}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
          <Feather name="arrow-left" size={20} color={FG} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Review Reports</Text>
          <Text style={s.sub}>{counts.pending} pending</Text>
        </View>
        {saving && <ActivityIndicator color={colors.primary} size="small" />}
      </View>

      {/* Filter tabs */}
      <TabBar active={filter} onChange={setFilter} counts={counts} />

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : visible.length === 0 ? (
        <View style={s.center}>
          <Feather name="check-circle" size={40} color={MUTED} />
          <Text style={s.emptyText}>
            {filter === 'pending' ? 'No pending reports' : `No ${filter} reports`}
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />
          }
        >
          {visible.map(r => (
            <ReportCard key={r.id} report={r} onStatusPress={setModal} />
          ))}
        </ScrollView>
      )}

      {modal && (
        <StatusModal
          visible
          reportId={modal.id}
          current={modal.status}
          onClose={() => setModal(null)}
          onSave={handleStatusSave}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:      { flex: 1 },
  header:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 12 },
  backBtn:   { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title:     { fontSize: 20, fontFamily: FONT.bold, color: FG, letterSpacing: -0.4 },
  sub:       { fontSize: 12, fontFamily: FONT.regular, color: MUTED, marginTop: 1 },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 14, fontFamily: FONT.regular, color: MUTED },
});
