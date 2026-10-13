/**
 * Select mode for the Variants & stock screen (app/product-variants.tsx).
 *
 * Copies Shopify admin iOS's variant bulk edit: a checkbox list
 * ("Black · $24.99 · 100 available"), quick selects for All / None / one
 * option value, a bottom bar with the selected count and the bulk actions,
 * and a Cancel / title / Save sheet that applies one value to every selected
 * variant. Saving goes through the existing bulk endpoint in one call.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { FilterChip, FormInput, PressableScale } from '@/components/BrandthreadUI';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { hapticSelection } from '@/lib/haptics';
import type { BulkField, QuickSelect } from '@/lib/variantSelection';

type Colors = ReturnType<typeof useColors>;

// ─── Quick selects ───────────────────────────────────────────────────────────

export function VariantQuickSelects({ quick, isOn, onAll, onNone, onToggle, allOn, noneOn }: {
  quick: QuickSelect[];
  isOn: (q: QuickSelect) => boolean;
  allOn: boolean;
  noneOn: boolean;
  onAll: () => void;
  onNone: () => void;
  onToggle: (q: QuickSelect) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={qs.row} keyboardShouldPersistTaps="handled">
      <FilterChip label="All" active={allOn} onPress={onAll} />
      <FilterChip label="None" active={noneOn} onPress={onNone} />
      {quick.map((q) => <FilterChip key={q.key} label={q.label} active={isOn(q)} onPress={() => onToggle(q)} />)}
    </ScrollView>
  );
}

const qs = StyleSheet.create({
  row: { gap: SP.sm, paddingHorizontal: SP.md, paddingBottom: SP.sm },
});

// ─── Selectable row ──────────────────────────────────────────────────────────

export function VariantSelectRow({ label, detail, checked, onPress }: {
  label: string; detail: React.ReactNode; checked: boolean; onPress: () => void;
}) {
  const colors = useColors();
  const st = makeRowStyles(colors);
  return (
    <PressableScale
      style={st.row} noMinHeight activeScale={0.99}
      onPress={() => { hapticSelection(); onPress(); }}
      accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label}
    >
      <View style={[st.box, checked && st.boxOn]}>
        {checked && <Feather name="check" size={14} color={colors.background} />}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.name} numberOfLines={1}>{label}</Text>
        <Text style={st.detail} numberOfLines={1}>{detail}</Text>
      </View>
    </PressableScale>
  );
}

const makeRowStyles = (c: Colors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm + 4, minHeight: 56, paddingVertical: SP.sm + 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  box: { width: 22, height: 22, borderRadius: RADIUS.xs, borderWidth: 1.5, borderColor: c.mutedForeground, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: c.foreground, borderColor: c.foreground },
  name: { fontFamily: FONT.semibold, fontSize: FS.base, color: c.foreground },
  detail: { fontFamily: FONT.regular, fontSize: FS.sm, color: c.mutedForeground, lineHeight: 18 },
});

// ─── Bottom action bar ───────────────────────────────────────────────────────

const ACTIONS: Array<{ field: BulkField; label: string }> = [
  { field: 'price', label: 'Edit price' },
  { field: 'stock', label: 'Edit stock' },
  { field: 'compareAt', label: 'Edit compare-at' },
];

/** Height of the bar, so content and toasts can sit clear of it. */
export const VARIANT_BULK_BAR_HEIGHT = 100;

export function VariantBulkBar({ count, bottom, onEdit }: { count: number; bottom: number; onEdit: (field: BulkField) => void }) {
  const colors = useColors();
  const st = makeBarStyles(colors);
  const disabled = count === 0;
  return (
    <View style={[st.wrap, { bottom }]} pointerEvents="box-none">
      <View style={st.bar}>
        <Text style={st.count} accessibilityLiveRegion="polite">{count} selected</Text>
        <View style={st.actions}>
          {ACTIONS.map((a) => (
            <PressableScale
              key={a.field} style={[st.action, disabled && { opacity: 0.4 }]} disabled={disabled} noMinHeight
              onPress={() => onEdit(a.field)} accessibilityRole="button" accessibilityLabel={a.label}
            >
              <Text style={st.actionText} numberOfLines={1}>{a.label}</Text>
            </PressableScale>
          ))}
        </View>
      </View>
    </View>
  );
}

const makeBarStyles = (c: Colors) => StyleSheet.create({
  wrap: { position: 'absolute', left: SP.md, right: SP.md },
  bar: { backgroundColor: c.foreground, borderRadius: RADIUS.lg, padding: SP.sm + 4, gap: SP.sm },
  count: { fontFamily: FONT.semibold, fontSize: FS.base, color: c.background, paddingHorizontal: 4 },
  actions: { flexDirection: 'row', gap: SP.sm },
  action: { flex: 1, minHeight: 44, borderRadius: RADIUS.md, backgroundColor: c.background, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  actionText: { fontFamily: FONT.semibold, fontSize: FS.sm, color: c.foreground },
});

// ─── Edit sheet ──────────────────────────────────────────────────────────────

const SHEET_COPY: Record<BulkField, { title: string; label: string; placeholder: string }> = {
  price: { title: 'Edit price', label: 'Price', placeholder: '0.00' },
  stock: { title: 'Edit stock', label: 'Available', placeholder: '0' },
  compareAt: { title: 'Edit compare-at price', label: 'Compare-at price', placeholder: '0.00' },
};

export function VariantBulkEditSheet({ field, count, initial, canClear, saving, error, onCancel, onSave, onClear }: {
  field: BulkField | null;
  count: number;
  initial: string;
  canClear: boolean;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (text: string) => void;
  onClear: () => void;
}) {
  const colors = useColors();
  const st = makeSheetStyles(colors);
  const [text, setText] = useState(initial);
  useEffect(() => { if (field) setText(initial); }, [field, initial]);
  const copy = SHEET_COPY[field ?? 'price'];
  const money = field !== 'stock';
  const canSave = !saving && text.trim() !== '';

  return (
    <BottomSheet visible={field !== null} onClose={saving ? () => undefined : onCancel} testID="variant-bulk-edit">
      <View style={st.sheet}>
        <View style={st.head}>
          <PressableScale style={st.headBtn} noMinHeight onPress={onCancel} disabled={saving} accessibilityRole="button" accessibilityLabel="Cancel">
            <Text style={st.headBtnText}>Cancel</Text>
          </PressableScale>
          <Text style={st.title} numberOfLines={1}>{copy.title}</Text>
          <PressableScale
            style={[st.headBtn, st.saveBtn, !canSave && { opacity: 0.4 }]} noMinHeight disabled={!canSave}
            onPress={() => onSave(text)} accessibilityRole="button" accessibilityLabel="Save"
          >
            <Text style={[st.headBtnText, st.saveText]}>{saving ? 'Saving…' : 'Save'}</Text>
          </PressableScale>
        </View>
        <FormInput
          label={`${copy.label} for ${count} variant${count === 1 ? '' : 's'}`}
          value={text}
          onChange={(t) => setText(money ? t.replace(/[^0-9.,$]/g, '') : t.replace(/[^0-9]/g, ''))}
          placeholder={copy.placeholder}
          keyboardType={money ? 'decimal-pad' : 'numeric'}
          returnKeyType="done"
          onSubmitEditing={() => { if (canSave) onSave(text); }}
          error={error}
        />
        {field === 'compareAt' && canClear && (
          <PressableScale style={st.clear} noMinHeight onPress={onClear} disabled={saving} accessibilityRole="button" accessibilityLabel="Remove compare-at price">
            <Text style={st.clearText}>Remove compare-at price</Text>
          </PressableScale>
        )}
      </View>
    </BottomSheet>
  );
}

const makeSheetStyles = (c: Colors) => StyleSheet.create({
  sheet: { paddingHorizontal: SP.md, paddingBottom: SP.lg, gap: SP.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.sm },
  headBtn: { minHeight: 36, minWidth: 72, paddingHorizontal: SP.md, borderRadius: RADIUS.pill, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' },
  headBtnText: { fontFamily: FONT.semibold, fontSize: FS.sm, color: c.foreground },
  saveBtn: { backgroundColor: c.foreground },
  saveText: { color: c.background },
  title: { flex: 1, textAlign: 'center', fontFamily: FONT.semibold, fontSize: FS.md, color: c.foreground },
  clear: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  clearText: { fontFamily: FONT.semibold, fontSize: FS.base, color: c.destructive },
});
