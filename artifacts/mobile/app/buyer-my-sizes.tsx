/**
 * My sizes — the buyer's saved sizes and optional body measurements.
 * Stored server-side (api.buyer.preferences) so size recommendations and the
 * onboarding survey read the same data. Tap a size to save it, tap it again
 * to clear. Measurements save when a field loses focus.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Chip, SegmentedControl } from '@/components/ui';
import { RetryRow } from '@/components/ui/RetryRow';
import { Toast } from '@/components/BrandthreadUI';
import { useColors } from '@/hooks/useColors';
import { useBuyerPreferences } from '@/hooks/useBuyerPreferences';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { haptics } from '@/lib/haptics';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import type { BuyerPreferencesPatch } from '@/lib/api';
import type { SizeCategory } from '@/lib/sizeRecommendation';

const CATEGORIES: { key: SizeCategory; label: string; options: string[] }[] = [
  { key: 'tops', label: 'Tops', options: ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'] },
  { key: 'bottoms', label: 'Bottoms', options: ['26', '28', '29', '30', '31', '32', '33', '34', '36', '38', '40'] },
  { key: 'outerwear', label: 'Outerwear', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
  { key: 'shoes', label: 'Shoes', options: ['6', '7', '8', '8.5', '9', '9.5', '10', '10.5', '11', '12', '13', '14'] },
];

type MKey = 'heightCm' | 'weightKg' | 'chestCm' | 'waistCm' | 'hipsCm';
const MEASUREMENTS: { key: MKey; label: string; kind: 'length' | 'weight' }[] = [
  { key: 'heightCm', label: 'Height', kind: 'length' },
  { key: 'weightKg', label: 'Weight', kind: 'weight' },
  { key: 'chestCm', label: 'Chest', kind: 'length' },
  { key: 'waistCm', label: 'Waist', kind: 'length' },
  { key: 'hipsCm', label: 'Hips', kind: 'length' },
];

const CM_PER_IN = 2.54;
const KG_PER_LB = 0.45359237;

type Unit = 'cm' | 'in';
function toDisplay(kind: 'length' | 'weight', metric: number | undefined, unit: Unit): string {
  if (metric === undefined) return '';
  const v = kind === 'length' ? (unit === 'in' ? metric / CM_PER_IN : metric) : (unit === 'in' ? metric / KG_PER_LB : metric);
  return String(Math.round(v * 10) / 10);
}
function toMetric(kind: 'length' | 'weight', text: string, unit: Unit): number | null | undefined {
  const t = text.trim().replace(',', '.');
  if (!t) return null;
  const n = parseFloat(t);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const metric = kind === 'length' ? (unit === 'in' ? n * CM_PER_IN : n) : (unit === 'in' ? n * KG_PER_LB : n);
  return Math.round(metric * 10) / 10;
}

export default function BuyerMySizes() {
  const palette = useColors();
  const s = makeStyles(palette);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabInset = useBuyerTabBarInset();
  const { preferences, status, update, retry } = useBuyerPreferences();
  const [unit, setUnit] = useState<Unit>('cm');
  const [drafts, setDrafts] = useState<Partial<Record<MKey, string>>>({});
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  function flash(message: string, variant: 'success' | 'error' = 'success') {
    setToast({ message, variant });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }

  async function save(patch: BuyerPreferencesPatch, okMessage: string) {
    try {
      await update(patch);
      flash(okMessage);
    } catch {
      flash("Couldn't save. Try again.", 'error');
    }
  }

  const sizes = preferences.sizes;
  const editable = status === 'loaded';

  function pickSize(key: SizeCategory, value: string) {
    haptics.selection();
    const next = sizes[key] === value ? null : value;
    void save({ sizes: { [key]: next } }, next ? 'Size saved' : 'Size removed');
  }

  function commitMeasurement(key: MKey, kind: 'length' | 'weight') {
    const text = drafts[key];
    if (text === undefined) return;
    const metric = toMetric(kind, text, unit);
    setDrafts((d) => { const { [key]: _omit, ...rest } = d; return rest; });
    if (metric === undefined) { flash('Enter a valid number', 'error'); return; }
    if (metric === (sizes.measurements?.[key] ?? null)) return;
    void save({ sizes: { measurements: { [key]: metric } } }, 'Measurements saved');
  }

  const unitLabel = (kind: 'length' | 'weight') => (kind === 'length' ? unit : unit === 'in' ? 'lb' : 'kg');

  return (
    <View style={s.page}>
      <ScreenHeader title="My sizes" hideDivider onBack={() => goBackOr(router)} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: Math.max(insets.bottom, tabInset) + 32 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {status === 'unavailable' && <RetryRow label="Couldn't load your sizes" onRetry={() => { void retry(); }} />}
        {status === 'signed-out' && <Text style={s.hint}>Sign in to save your sizes.</Text>}

        {CATEGORIES.map((cat) => (
          <View key={cat.key} style={s.section}>
            <View style={s.sectionHead}>
              <Text style={s.label}>{cat.label}</Text>
              <Text style={s.value}>{sizes[cat.key] ?? 'Not set'}</Text>
            </View>
            <View style={s.chips}>
              {cat.options.map((opt) => (
                <Chip
                  key={opt}
                  label={opt}
                  selected={sizes[cat.key] === opt}
                  disabled={!editable}
                  onPress={() => pickSize(cat.key, opt)}
                  accessibilityRole="radio"
                  accessibilityLabel={`${cat.label} size ${opt}`}
                />
              ))}
            </View>
          </View>
        ))}

        <View style={s.section}>
          <View style={s.sectionHead}>
            <Text style={s.label}>Measurements</Text>
            <View style={{ width: 110 }}>
              <SegmentedControl
                size="compact"
                options={[{ id: 'cm', label: 'cm' }, { id: 'in', label: 'in' }]}
                selectedId={unit}
                onChange={(id) => { setDrafts({}); setUnit(id as Unit); }}
              />
            </View>
          </View>
          {MEASUREMENTS.map((m, i) => (
            <View key={m.key} style={[s.mRow, i === MEASUREMENTS.length - 1 && { borderBottomWidth: 0 }]}>
              <Text style={s.mLabel}>{m.label}</Text>
              <TextInput
                style={s.input}
                value={drafts[m.key] ?? toDisplay(m.kind, sizes.measurements?.[m.key], unit)}
                onChangeText={(v) => setDrafts((d) => ({ ...d, [m.key]: v }))}
                onBlur={() => commitMeasurement(m.key, m.kind)}
                placeholder="Add"
                placeholderTextColor={palette.mutedForeground}
                keyboardType="decimal-pad"
                returnKeyType="done"
                editable={editable}
                accessibilityLabel={`${m.label} in ${unitLabel(m.kind)}`}
              />
              <Text style={s.mUnit}>{unitLabel(m.kind)}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
      <Toast message={toast?.message ?? ''} visible={!!toast} variant={toast?.variant ?? 'success'} />
    </View>
  );
}

const makeStyles = (palette: ReturnType<typeof useColors>) => StyleSheet.create({
  page: { flex: 1, backgroundColor: 'transparent' },
  hint: { ...TYPE_SCALE.footnote, color: palette.mutedForeground, marginBottom: SPACING.md },
  section: { paddingVertical: SPACING.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm },
  label: { ...TYPE_SCALE.body, fontFamily: FONT.semibold, color: palette.foreground },
  value: { ...TYPE_SCALE.footnote, color: palette.mutedForeground },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border },
  mLabel: { flex: 1, ...TYPE_SCALE.body, color: palette.foreground },
  input: { minWidth: 80, textAlign: 'right', ...TYPE_SCALE.body, color: palette.foreground, padding: 0 },
  mUnit: { width: 28, textAlign: 'right', ...TYPE_SCALE.footnote, color: palette.mutedForeground },
});
