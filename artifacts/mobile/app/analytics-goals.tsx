/**
 * Goals — a monthly revenue or orders target with progress and pace projection.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import { PrimaryButton, SecondaryButton } from '@/components/BrandthreadUI';
import { Card, ProgressBar, SectionTitle } from '@/components/analytics/AnalyticsKit';
import { InsightFrame, SegmentedPills } from '@/components/analytics/InsightFrame';
import { useSellerInsight } from '@/hooks/useSellerInsight';
import { clearGoal, getGoal, saveGoal, type GoalMetric, type GoalProgress } from '@/services/sellerInsightsService';

const STATUS_TEXT: Record<GoalProgress['status'], string> = {
  achieved: 'Goal reached', on_track: 'On track', behind: 'Behind pace', not_started: 'Month just started',
};

export default function AnalyticsGoalsScreen() {
  const colors = useColors();
  const s = React.useMemo(() => styles(colors), [colors]);
  const { data: goal, loading, error, reload, setData } = useSellerInsight(() => getGoal(), []);
  const [editing, setEditing] = useState(false);
  const [metric, setMetric] = useState<GoalMetric>('revenue');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (goal) {
      setMetric(goal.metric);
      setText(String(goal.metric === 'revenue' ? goal.target / 100 : goal.target));
    }
  }, [goal]);

  const fmt = (n: number, m: GoalMetric) => (m === 'revenue' ? formatCents(n) : n.toLocaleString());

  async function onSave() {
    const n = Number(text.replace(/[^0-9.]/g, ''));
    const target = metric === 'revenue' ? Math.round(n * 100) : Math.round(n);
    if (!Number.isFinite(n) || target <= 0) { Alert.alert('Enter a target', 'Use a number greater than zero.'); return; }
    setSaving(true);
    try {
      setData(await saveGoal(metric, target));
      setEditing(false);
    } catch { Alert.alert('Could not save', 'Check your connection and try again.'); }
    finally { setSaving(false); }
  }
  async function onClear() {
    setSaving(true);
    try { await clearGoal(); setData(null); setText(''); setEditing(false); }
    catch { Alert.alert('Could not clear', 'Check your connection and try again.'); }
    finally { setSaving(false); }
  }

  const showForm = editing || !goal;
  return (
    <InsightFrame title="Goals" loading={loading && !goal} error={error && !goal} onRetry={reload} onRefresh={reload}>
      {!showForm && goal && (
        <>
          <SectionTitle>{goal.metric === 'revenue' ? 'Monthly revenue' : 'Monthly orders'}</SectionTitle>
          <Card padded>
            <Text style={s.big}>{fmt(goal.actual, goal.metric)}</Text>
            <Text style={s.meta}>of {fmt(goal.target, goal.metric)}  ·  {goal.progressPct}%</Text>
            <View style={{ marginVertical: SP.md }}><ProgressBar pct={goal.progressPct} height={10} /></View>
            <Text style={s.value}>{STATUS_TEXT[goal.status]}</Text>
            {goal.projected !== null && goal.status !== 'achieved' && (
              <Text style={s.meta}>At this pace you will reach {fmt(goal.projected, goal.metric)} ({goal.projectedPct}% of target).</Text>
            )}
            {goal.status !== 'achieved' && <Text style={s.meta}>{fmt(goal.remaining, goal.metric)} to go.</Text>}
          </Card>
          <PrimaryButton label="Edit goal" onPress={() => setEditing(true)} />
          <View style={{ height: SP.sm }} />
          <SecondaryButton label="Clear goal" onPress={onClear} disabled={saving} />
        </>
      )}
      {showForm && (
        <>
          <SectionTitle>Monthly target</SectionTitle>
          <SegmentedPills<GoalMetric>
            options={[{ key: 'revenue', label: 'Revenue' }, { key: 'orders', label: 'Orders' }]}
            value={metric}
            onChange={setMetric}
          />
          <TextInput
            value={text}
            onChangeText={setText}
            keyboardType="decimal-pad"
            placeholder={metric === 'revenue' ? 'Revenue target in dollars' : 'Number of orders'}
            placeholderTextColor={colors.mutedForeground}
            style={s.input}
            accessibilityLabel="Monthly target"
          />
          <PrimaryButton label="Save goal" onPress={onSave} loading={saving} disabled={saving || !text} />
          {goal && (<><View style={{ height: SP.sm }} /><SecondaryButton label="Cancel" onPress={() => setEditing(false)} /></>)}
        </>
      )}
    </InsightFrame>
  );
}

const styles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  big: { fontSize: 28, fontFamily: FONT.bold, color: colors.foreground },
  value: { fontSize: FS.sm, fontFamily: FONT.semibold, color: colors.foreground },
  meta: { fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground, marginTop: 4 },
  input: {
    minHeight: 48, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
    paddingHorizontal: SP.md, fontSize: FS.base, fontFamily: FONT.regular, color: colors.foreground, marginBottom: SP.md,
  },
});
