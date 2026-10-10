/**
 * Goals — several targets per seller (revenue, orders, units, visits, new
 * followers) for this week / month / quarter / year, with real progress and a
 * pace projection. Mobbin reference: Rocket Money "Goals" list cards and
 * GoFundMe's goal card (progress + "Edit goal settings"), reskinned.
 * Data: GET/POST/PUT/DELETE /api/analytics/insights/goals.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { haptics } from '@/lib/haptics';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import { EmptyState, PrimaryButton, SecondaryButton } from '@/components/BrandthreadUI';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Card, ProgressBar, SectionTitle } from '@/components/analytics/AnalyticsKit';
import { InsightFrame, SegmentedPills } from '@/components/analytics/InsightFrame';
import { useSellerInsight } from '@/hooks/useSellerInsight';
import { confirmDestructiveActionSheet } from '@/lib/actionSheet';
import {
  GOAL_METRICS, GOAL_PERIODS, createGoal, deleteGoal, getGoals, goalLabel, previewMode, updateGoal,
  type Goal, type GoalMetric, type GoalPeriod,
} from '@/services/sellerInsightsService';

const STATUS_TEXT: Record<Goal['status'], string> = {
  achieved: 'Reached', on_track: 'On track', behind: 'Behind pace', not_started: 'Just started',
};
const PERIOD_TEXT: Record<GoalPeriod, string> = { week: 'this week', month: 'this month', quarter: 'this quarter', year: 'this year' };
const fmt = (n: number, m: GoalMetric) => (m === 'revenue' ? formatCents(n) : n.toLocaleString());

function GoalCard({ goal, onEdit }: { goal: Goal; onEdit: () => void }) {
  const colors = useColors();
  const s = React.useMemo(() => styles(colors), [colors]);
  const pct = Math.min(100, goal.progressPct);
  return (
    <TouchableOpacity onPress={() => onEdit()} accessibilityRole="button" accessibilityLabel={`Edit ${goalLabel(goal.metric)} goal`} activeOpacity={0.85}>
      <Card padded>
        <View style={s.rowBetween}>
          <Text style={s.title}>{goalLabel(goal.metric)} {PERIOD_TEXT[goal.period]}</Text>
          <View style={[s.statusChip, goal.status === 'achieved' && { borderColor: colors.primary }]}>
            <Text style={s.statusText}>{STATUS_TEXT[goal.status]}</Text>
          </View>
        </View>
        <Text style={s.big}>{fmt(goal.actual, goal.metric)}</Text>
        <Text style={s.meta}>of {fmt(goal.target, goal.metric)}  ·  {Math.round(goal.progressPct)}%</Text>
        <View style={{ marginVertical: SP.sm + 2 }}><ProgressBar pct={pct} height={8} /></View>
        <Text style={s.meta}>
          {goal.status === 'achieved'
            ? `${fmt(goal.actual - goal.target, goal.metric)} over target.`
            : goal.projected === null
              ? `${fmt(goal.remaining, goal.metric)} to go.`
              : `${fmt(goal.remaining, goal.metric)} to go · on pace for ${fmt(goal.projected, goal.metric)} · ${goal.daysLeft} day${goal.daysLeft === 1 ? '' : 's'} left`}
        </Text>
      </Card>
    </TouchableOpacity>
  );
}

export default function AnalyticsGoalsScreen() {
  const colors = useColors();
  const s = React.useMemo(() => styles(colors), [colors]);
  const { data: goals, loading, error, reload, setData } = useSellerInsight(() => getGoals(), []);
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  const [metric, setMetric] = useState<GoalMetric>('revenue');
  const [period, setPeriod] = useState<GoalPeriod>('month');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const open = (g: Goal | 'new') => {
    if (g === 'new') { setMetric('revenue'); setPeriod('month'); setText(''); }
    else { setMetric(g.metric); setPeriod(g.period); setText(String(g.metric === 'revenue' ? g.target / 100 : g.target)); }
    setEditing(g);
  };

  async function onSave() {
    const n = Number(text.replace(/[^0-9.]/g, ''));
    const target = metric === 'revenue' ? Math.round(n * 100) : Math.round(n);
    if (!Number.isFinite(n) || target <= 0) { Alert.alert('Enter a target', 'Use a number greater than zero.'); return; }
    if (previewMode()) { Alert.alert('Preview', 'Goals are saved for signed-in sellers.'); return; }
    setSaving(true);
    try {
      const next = editing === 'new' || !editing ? await createGoal({ metric, period, target }) : await updateGoal(editing.id, { metric, period, target });
      setData(next);
      setEditing(null);
    } catch { Alert.alert('Could not save', 'Check your connection and try again.'); }
    finally { setSaving(false); }
  }
  async function onDelete() {
    if (!editing || editing === 'new') return;
    const ok = await confirmDestructiveActionSheet({ title: 'Delete this goal?', confirmLabel: 'Delete' });
    if (!ok) return;
    if (previewMode()) { Alert.alert('Preview', 'Goals are saved for signed-in sellers.'); return; }
    setSaving(true);
    try { await deleteGoal(editing.id); setData((goals ?? []).filter(g => g.id !== editing.id)); setEditing(null); }
    catch { Alert.alert('Could not delete', 'Check your connection and try again.'); }
    finally { setSaving(false); }
  }

  const list = goals ?? [];
  return (
    <InsightFrame
      title="Goals" loading={loading && !goals} error={error && !goals} onRetry={reload} onRefresh={reload}
      actions={[{ icon: 'plus', accessibilityLabel: 'Add goal', onPress: () => open('new') }]}
    >
      {list.length === 0 ? (
        <EmptyState icon="target" title="No goals yet" description="Set a target for revenue, orders, units, visits or followers." action={{ label: 'Add goal', onPress: () => open('new') }} />
      ) : (
        <>
          <SectionTitle>Your goals</SectionTitle>
          {list.map(g => <GoalCard key={g.id} goal={g} onEdit={() => open(g)} />)}
          <SecondaryButton label="Add goal" icon="plus" onPress={() => open('new')} />
          <View style={{ height: SP.lg }} />
        </>
      )}

      <BottomSheet visible={editing !== null} onClose={() => setEditing(null)} testID="goal-editor">
        <View style={s.sheet}>
          <Text style={s.sheetTitle}>{editing === 'new' ? 'New goal' : 'Edit goal'}</Text>
          <Text style={s.fieldLabel}>Measure</Text>
          <View style={s.chips}>
            {GOAL_METRICS.map(m => {
              const active = m.key === metric;
              return (
                <TouchableOpacity key={m.key} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => { haptics.selection(); setMetric(m.key); }}
                  style={[s.chip, active && s.chipOn]}>
                  <Text style={[s.chipText, active && s.chipTextOn]}>{m.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={s.fieldLabel}>Period</Text>
          <SegmentedPills<GoalPeriod> options={GOAL_PERIODS.map(p => ({ key: p.key, label: p.label.replace('This ', '') }))} value={period} onChange={setPeriod} />
          <Text style={s.fieldLabel}>Target</Text>
          <View style={s.inputWrap}>
            {metric === 'revenue' && <Text style={s.inputPrefix}>$</Text>}
            <TextInput returnKeyType="done"
              value={text}
              onChangeText={setText}
              keyboardType="decimal-pad"
              placeholder={metric === 'revenue' ? '0.00' : '0'}
              placeholderTextColor={colors.mutedForeground}
              style={s.input}
              accessibilityLabel="Goal target"
            />
          </View>
          <PrimaryButton label={editing === 'new' ? 'Add goal' : 'Save'} onPress={onSave} loading={saving} disabled={saving || !text} />
          {editing !== null && editing !== 'new' && (
            <TouchableOpacity onPress={onDelete} disabled={saving} style={s.deleteBtn} accessibilityRole="button" accessibilityLabel="Delete goal">
              <Feather name="trash-2" size={14} color={colors.destructive} />
              <Text style={s.deleteText}>Delete goal</Text>
            </TouchableOpacity>
          )}
        </View>
      </BottomSheet>
    </InsightFrame>
  );
}

const styles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
  title: { flex: 1, fontSize: FS.sm, fontFamily: FONT.semibold, color: colors.foreground },
  statusChip: { borderRadius: RADIUS.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: SP.sm, paddingVertical: 3 },
  statusText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: colors.foreground },
  big: { fontSize: 28, fontFamily: FONT.bold, color: colors.foreground, letterSpacing: -0.5 },
  meta: { fontSize: FS.meta, fontFamily: FONT.regular, color: colors.mutedForeground, marginTop: 2 },
  sheet: { paddingHorizontal: SP.md, paddingBottom: SP.lg, paddingTop: SP.sm },
  sheetTitle: { fontSize: FS.md, fontFamily: FONT.bold, color: colors.foreground, marginBottom: SP.md },
  fieldLabel: { fontSize: FS.meta, fontFamily: FONT.medium, color: colors.mutedForeground, marginBottom: SP.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginBottom: SP.md },
  chip: { minHeight: 36, paddingHorizontal: SP.sm + 4, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: FS.sm, fontFamily: FONT.medium, color: colors.mutedForeground },
  chipTextOn: { color: colors.primaryForeground, fontFamily: FONT.semibold },
  inputWrap: { flexDirection: 'row', alignItems: 'center', minHeight: 52, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: SP.md, marginBottom: SP.md },
  inputPrefix: { fontSize: FS.md, fontFamily: FONT.semibold, color: colors.mutedForeground, marginRight: 4 },
  input: { flex: 1, minHeight: 50, fontSize: FS.md, fontFamily: FONT.regular, color: colors.foreground },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, marginTop: SP.sm },
  deleteText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: colors.destructive },
});
