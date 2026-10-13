/**
 * AdjustmentsMenu.tsx — Procreate's Adjustments sheet structure
 * (Mobbin-verified): a 2×2 category grid → a list of that category's tools
 * → the tool's own panel. These are the presentational pieces; the host
 * screen (design-canvas.tsx) owns navigation state, layer state and the
 * actual filter application.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BG, CARD, CARD_ELEVATED, BORDER, BORDER_SUBTLE, FG, MUTED, SUBTLE, FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import {
  ADJ_CATEGORIES, ADJ_TOOL_LABELS, EFFECT_SLIDERS, GRADIENT_MAP_PRESETS,
  readEffectValue, writeEffectValue, writeGradientMapStops,
  type AdjCategory, type AdjTool, type SliderSpec,
} from '@/lib/adjustmentsCatalog';
import type { EffectsAdjustment } from '@/lib/adjustmentsModel';

// ─── Level 1: category grid ────────────────────────────────────────────────────

export function AdjCategoryGrid({ onPick }: { onPick: (c: AdjCategory) => void }) {
  return (
    <View style={s.grid} testID="adj-category-grid">
      {ADJ_CATEGORIES.map(c => (
        <TouchableOpacity
          key={c.key}
          style={s.cell}
          onPress={() => onPick(c.key)}
          testID={`adj-cat-${c.key}`}
          accessibilityRole="button"
          accessibilityLabel={c.label}
        >
          <Feather name={c.icon as any} size={ICON.md} color={FG} />
          <Text style={s.cellLabel} numberOfLines={2}>{c.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Level 2: tool list ───────────────────────────────────────────────────────

export function AdjToolList({ category, onPick }: { category: AdjCategory; onPick: (t: AdjTool) => void }) {
  const def = ADJ_CATEGORIES.find(c => c.key === category)!;
  return (
    <View style={s.list} testID={`adj-tool-list-${category}`}>
      {def.tools.map(t => (
        <TouchableOpacity
          key={t}
          style={s.row}
          onPress={() => onPick(t)}
          testID={`adj-tool-${t}`}
          accessibilityRole="button"
        >
          <Text style={s.rowLabel}>{ADJ_TOOL_LABELS[t]}</Text>
          <Feather name="chevron-right" size={ICON.sm} color={SUBTLE} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Level 3: a stepped slider row (same control the HSB panel uses) ──────────

export function AdjSliderRow({
  spec, value, onChange, testIDBase,
}: { spec: SliderSpec; value: number; onChange: (v: number) => void; testIDBase: string }) {
  const pct = ((value - spec.min) / (spec.max - spec.min)) * 100;
  const dec = () => onChange(Math.max(spec.min, +(value - spec.step).toFixed(3)));
  const inc = () => onChange(Math.min(spec.max, +(value + spec.step).toFixed(3)));
  return (
    <View style={s.sliderRow}>
      <Text style={s.sliderLabel} numberOfLines={1}>{spec.label}</Text>
      <TouchableOpacity style={s.stepBtn} onPress={dec} testID={`${testIDBase}-dec`} accessibilityLabel={`Decrease ${spec.label}`}>
        <Feather name="minus" size={14} color={MUTED} />
      </TouchableOpacity>
      <View style={s.track}><View style={[s.fill, { width: `${Math.max(0, Math.min(100, pct))}%` }]} /></View>
      <TouchableOpacity style={s.stepBtn} onPress={inc} testID={`${testIDBase}-inc`} accessibilityLabel={`Increase ${spec.label}`}>
        <Feather name="plus" size={14} color={MUTED} />
      </TouchableOpacity>
      <Text style={s.sliderValue} testID={`${testIDBase}-value`}>{spec.format(value)}</Text>
    </View>
  );
}

// ─── Level 3: generic effect panel ────────────────────────────────────────────

export function AdjEffectPanel({
  tool, effects, layerOpacity, onChangeEffects, onChangeOpacity, onReset,
}: {
  tool: AdjTool;
  effects: EffectsAdjustment | undefined;
  layerOpacity: number;
  onChangeEffects: (next: EffectsAdjustment) => void;
  onChangeOpacity: (v: number) => void;
  onReset: () => void;
}) {
  const sliders = EFFECT_SLIDERS[tool] ?? [];
  return (
    <View style={{ gap: SP.md }} testID={`adj-panel-${tool}`}>
      {tool === 'colorBalance' && (
        <Text style={s.note}>Global balance. Procreate's Shadows / Midtones / Highlights split isn't implemented yet.</Text>
      )}
      {tool === 'gradientMap' && (
        <View style={s.presetRow} testID="adj-gradient-presets">
          {GRADIENT_MAP_PRESETS.map(p => {
            const active = effects?.gradientMap?.from === p.from && effects?.gradientMap?.to === p.to;
            return (
              <TouchableOpacity
                key={p.label}
                style={[s.preset, active && s.presetActive]}
                onPress={() => onChangeEffects(writeGradientMapStops(effects, p.from, p.to))}
                testID={`adj-gradient-preset-${p.label.toLowerCase()}`}
                accessibilityLabel={`${p.label} gradient`}
              >
                <View style={[s.presetSwatch, { backgroundColor: p.from }]} />
                <View style={[s.presetSwatch, { backgroundColor: p.to }]} />
                <Text style={[s.presetLabel, active && { color: FG }]}>{p.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      {sliders.map(spec => (
        <AdjSliderRow
          key={spec.key}
          spec={spec}
          value={tool === 'opacity' ? layerOpacity : readEffectValue(effects, tool, spec.key)}
          onChange={v => tool === 'opacity' ? onChangeOpacity(v) : onChangeEffects(writeEffectValue(effects, tool, spec.key, v))}
          testIDBase={`adj-${tool}-${spec.key}`}
        />
      ))}
      <TouchableOpacity style={s.resetBtn} onPress={onReset} testID={`adj-${tool}-reset`}>
        <Feather name="refresh-cw" size={12} color={MUTED} />
        <Text style={s.resetLabel}>Reset</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, paddingVertical: SP.xs },
  cell: {
    width: '48%', minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    paddingHorizontal: SP.md, paddingVertical: SP.sm,
    backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
  },
  cellLabel: { flex: 1, fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, includeFontPadding: false },

  list: { backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE,
  },
  rowLabel: { fontSize: FS.sm, fontFamily: FONT.medium, color: FG, includeFontPadding: false },

  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  sliderLabel: { width: 108, fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, includeFontPadding: false },
  stepBtn: { width: 28, height: 28, borderRadius: RADIUS.xs, alignItems: 'center', justifyContent: 'center', backgroundColor: CARD_ELEVATED, borderWidth: 1, borderColor: BORDER_SUBTLE },
  track: { flex: 1, height: 4, backgroundColor: BORDER, borderRadius: RADIUS.pill, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: FG, borderRadius: RADIUS.pill },
  sliderValue: { minWidth: 52, textAlign: 'right', fontSize: FS.xs, fontFamily: FONT.medium, color: FG, includeFontPadding: false },

  note: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, includeFontPadding: false },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  preset: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: SP.sm, paddingVertical: 6, borderRadius: RADIUS.pill, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER_SUBTLE },
  presetActive: { borderColor: FG, backgroundColor: BG },
  presetSwatch: { width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: BORDER },
  presetLabel: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, includeFontPadding: false },
  resetBtn: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: SP.sm, paddingVertical: 6, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: BORDER_SUBTLE },
  resetLabel: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, includeFontPadding: false },
});
