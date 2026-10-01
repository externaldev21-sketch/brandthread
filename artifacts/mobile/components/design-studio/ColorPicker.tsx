/**
 * ColorPicker.tsx — Procreate's own full-height "Colours" sheet (not a small
 * floating popover): Disc / Classic / Harmony / Value / Palettes tabs, an
 * Eyedropper + Previous colour row, and a persistent palette strip. Eyedropper
 * is exposed via `onRequestEyedropper` — the host screen owns the actual
 * pixel sampling (native Skia surface read, or the SVG-fallback
 * approximation), since that requires touch coordination with the canvas
 * itself, not just this sheet.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, PanResponder, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  BG, SURFACE, CARD_ELEVATED, BORDER, BORDER_SUBTLE, FG, MUTED, SUBTLE, FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import {
  hsvToHex, hexToHsv, isValidHex, discPointToHs, hsToDiscPoint, contrastingBW,
  computeHarmonyHues, HARMONY_RULES, HARMONY_RULE_LABELS, HarmonyRule,
  BrandPalette,
} from '@/lib/colorModel';

export type ColorPickerTab = 'disc' | 'classic' | 'harmony' | 'value' | 'palettes';
const TABS: { key: ColorPickerTab; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: 'disc', label: 'Disc', icon: 'circle' },
  { key: 'classic', label: 'Classic', icon: 'square' },
  { key: 'harmony', label: 'Harmony', icon: 'share-2' },
  { key: 'value', label: 'Value', icon: 'sliders' },
  { key: 'palettes', label: 'Palettes', icon: 'grid' },
];

export interface ColorPickerProps {
  color: string; // current hex
  previousColor?: string | null;
  onChange: (hex: string) => void;
  recentColors: string[];
  palettes: BrandPalette[];
  onSaveToPalette: (paletteId: string, hex: string) => void;
  onNewPalette: () => void;
  onRenamePalette: (paletteId: string, name: string) => void;
  onDeletePalette: (paletteId: string) => void;
  onSetDefaultPalette: (paletteId: string) => void;
  onRequestEyedropper: () => void;
  onClose: () => void;
}

const DISC_SIZE = 220;
const DISC_RADIUS = DISC_SIZE / 2;
const SQUARE_SIZE = 220;

export default function ColorPicker(props: ColorPickerProps) {
  const {
    color, previousColor, onChange, recentColors, palettes, onSaveToPalette,
    onNewPalette, onRenamePalette, onDeletePalette, onSetDefaultPalette,
    onRequestEyedropper, onClose,
  } = props;
  const [tab, setTab] = useState<ColorPickerTab>('disc');
  const [hexInput, setHexInput] = useState(color);
  const [hexError, setHexError] = useState(false);
  const [harmonyRule, setHarmonyRule] = useState<HarmonyRule>('complementary');
  const [editingPaletteId, setEditingPaletteId] = useState<string | null>(null);
  const [editingPaletteName, setEditingPaletteName] = useState('');

  const hsv = useMemo(() => hexToHsv(color) ?? { h: 0, s: 0, v: 1 }, [color]);
  const rgb = useMemo(() => {
    // Derive RGB straight from hex for the Value tab's R/G/B sliders —
    // avoids a second hsv->rgb round trip drifting from the displayed hex.
    const n = color.replace('#', '');
    const full = n.length === 3 ? n.split('').map(c => c + c).join('') : n;
    return {
      r: parseInt(full.slice(0, 2), 16) || 0,
      g: parseInt(full.slice(2, 4), 16) || 0,
      b: parseInt(full.slice(4, 6), 16) || 0,
    };
  }, [color]);

  function commitHsv(h: number, s: number, v: number) {
    onChange(hsvToHex({ h, s, v }));
  }
  function commitRgb(r: number, g: number, b: number) {
    const clamp = (x: number) => Math.max(0, Math.min(255, Math.round(x)));
    const hex = `#${[r, g, b].map(x => clamp(x).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
    onChange(hex);
  }

  const discResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (e) => {
      const { locationX, locationY } = e.nativeEvent;
      const nx = (locationX - DISC_RADIUS) / DISC_RADIUS;
      const ny = (locationY - DISC_RADIUS) / DISC_RADIUS;
      const { h, s } = discPointToHs({ x: nx, y: ny });
      commitHsv(h, s, hsv.v);
    },
  }), [hsv.v, color]);

  const squareResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (e) => {
      const { locationX, locationY } = e.nativeEvent;
      const s = Math.max(0, Math.min(1, locationX / SQUARE_SIZE));
      const v = Math.max(0, Math.min(1, 1 - locationY / SQUARE_SIZE));
      commitHsv(hsv.h, s, v);
    },
  }), [hsv.h, color]);

  function makeDragResponder(onMove: (pct: number) => void) {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (e) => {
        const pct = Math.max(0, Math.min(1, e.nativeEvent.locationX / 200));
        onMove(pct);
      },
    });
  }

  const hueSliderResponder = useMemo(() => makeDragResponder(pct => commitHsv(pct * 360, hsv.s, hsv.v)), [hsv.s, hsv.v, color]);
  const satSliderResponder = useMemo(() => makeDragResponder(pct => commitHsv(hsv.h, pct, hsv.v)), [hsv.h, hsv.v, color]);
  const valSliderResponder = useMemo(() => makeDragResponder(pct => commitHsv(hsv.h, hsv.s, pct)), [hsv.h, hsv.s, color]);
  const rSliderResponder   = useMemo(() => makeDragResponder(pct => commitRgb(pct * 255, rgb.g, rgb.b)), [rgb.g, rgb.b, color]);
  const gSliderResponder   = useMemo(() => makeDragResponder(pct => commitRgb(rgb.r, pct * 255, rgb.b)), [rgb.r, rgb.b, color]);
  const bSliderResponder   = useMemo(() => makeDragResponder(pct => commitRgb(rgb.r, rgb.g, pct * 255)), [rgb.r, rgb.g, color]);
  const harmonyDiscResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (e) => {
      const { locationX, locationY } = e.nativeEvent;
      const nx = (locationX - DISC_RADIUS) / DISC_RADIUS;
      const ny = (locationY - DISC_RADIUS) / DISC_RADIUS;
      const { h, s } = discPointToHs({ x: nx, y: ny });
      commitHsv(h, s, hsv.v);
    },
  }), [hsv.v, color]);

  function submitHex() {
    if (isValidHex(hexInput)) {
      onChange(hexInput.startsWith('#') ? hexInput : `#${hexInput}`);
      setHexError(false);
    } else {
      setHexError(true);
    }
  }

  const knob = hsToDiscPoint(hsv.h, hsv.s);
  const knobX = DISC_RADIUS + knob.x * DISC_RADIUS;
  const knobY = DISC_RADIUS + knob.y * DISC_RADIUS;
  const knobColor = contrastingBW(color);
  const defaultPalette = palettes.find(p => p.isDefault) ?? palettes[0] ?? null;
  const harmonyHues = computeHarmonyHues(hsv.h, harmonyRule);

  return (
    <View style={s.panel} testID="color-picker">
      <View style={s.header}>
        <Text style={s.title}>Colours</Text>
        <TouchableOpacity onPress={onClose} testID="color-done">
          <Text style={s.doneLabel}>Done</Text>
        </TouchableOpacity>
      </View>

      <View style={s.actionsRow}>
        <TouchableOpacity onPress={onRequestEyedropper} testID="color-eyedropper">
          <Text style={s.actionLabel}>Eyedropper</Text>
        </TouchableOpacity>
        {!!previousColor && (
          <TouchableOpacity
            style={s.previousColorBtn}
            onPress={() => onChange(previousColor)}
            testID="color-previous"
          >
            <View style={[s.previousSwatch, { backgroundColor: previousColor }]} />
            <Text style={s.actionLabel}>Previous colour</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={s.body} contentContainerStyle={s.bodyContent}>
        {tab === 'disc' && (
          <View style={s.discWrap}>
            <View
              {...discResponder.panHandlers}
              style={[s.disc, { backgroundColor: `hsl(${hsv.h},100%,50%)` }]}
              testID="color-disc"
            >
              <View style={[s.discKnob, { left: knobX - 8, top: knobY - 8, backgroundColor: color, borderColor: knobColor }]} />
            </View>
            <Text style={s.sliderLabel}>Value: {Math.round(hsv.v * 100)}%</Text>
            <View {...valSliderResponder.panHandlers} style={s.track} testID="color-value-slider">
              <View style={[s.trackGradient, { backgroundColor: `hsl(${hsv.h},${hsv.s * 100}%,50%)` }]} />
              <View style={[s.trackThumb, { left: `${hsv.v * 100}%` }]} />
            </View>
          </View>
        )}

        {tab === 'classic' && (
          <View style={s.classicWrap} testID="color-classic">
            <View
              {...squareResponder.panHandlers}
              style={[s.square, { backgroundColor: `hsl(${hsv.h},100%,50%)` }]}
              testID="color-sv-square"
            >
              {/* White->transparent (saturation) and transparent->black (value)
                  gradients approximated with two overlapping washes, since RN
                  has no native 2-stop-corner gradient without an extra lib —
                  the knob position still drives the real s/v math above. */}
              <View style={s.squareSatWash} pointerEvents="none" />
              <View style={s.squareValWash} pointerEvents="none" />
              <View
                style={[
                  s.squareKnob,
                  { left: hsv.s * SQUARE_SIZE - 8, top: (1 - hsv.v) * SQUARE_SIZE - 8, backgroundColor: color, borderColor: knobColor },
                ]}
              />
            </View>
            <Text style={s.sliderLabel}>Hue: {Math.round(hsv.h)}°</Text>
            <View {...hueSliderResponder.panHandlers} style={s.track} testID="color-hue-slider">
              <View style={[s.trackGradient, { backgroundColor: 'transparent' }]}>
                <View style={s.hueGradientRow}>
                  {Array.from({ length: 12 }, (_, i) => i * 30).map(h => (
                    <View key={h} style={[s.hueGradientSeg, { backgroundColor: `hsl(${h},100%,50%)` }]} />
                  ))}
                </View>
              </View>
              <View style={[s.trackThumb, { left: `${(hsv.h / 360) * 100}%` }]} />
            </View>
          </View>
        )}

        {tab === 'harmony' && (
          <View style={s.harmonyWrap} testID="color-harmony">
            <Text style={s.sliderLabel}>{HARMONY_RULE_LABELS[harmonyRule]}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: SP.sm }}>
              {HARMONY_RULES.map(rule => (
                <TouchableOpacity
                  key={rule}
                  style={[s.harmonyChip, harmonyRule === rule && s.harmonyChipActive]}
                  onPress={() => setHarmonyRule(rule)}
                  testID={`harmony-rule-${rule}`}
                >
                  <Text style={[s.harmonyChipText, harmonyRule === rule && { color: BG }]}>{HARMONY_RULE_LABELS[rule]}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={s.discWrap}>
              <View
                {...harmonyDiscResponder.panHandlers}
                style={[s.disc, { backgroundColor: `hsl(${hsv.h},100%,50%)` }]}
                testID="color-harmony-disc"
              >
                <View style={[s.discKnob, { left: knobX - 8, top: knobY - 8, backgroundColor: color, borderColor: knobColor }]} />
                {harmonyHues.map((h, i) => {
                  const hp = hsToDiscPoint(h, hsv.s);
                  const hx = DISC_RADIUS + hp.x * DISC_RADIUS;
                  const hy = DISC_RADIUS + hp.y * DISC_RADIUS;
                  const hHex = hsvToHex({ h, s: hsv.s, v: hsv.v });
                  return (
                    <TouchableOpacity
                      key={i}
                      onPress={() => onChange(hHex)}
                      style={[s.harmonyKnob, { left: hx - 10, top: hy - 10, backgroundColor: hHex }]}
                      testID={`color-harmony-swatch-${i}`}
                    />
                  );
                })}
              </View>
            </View>
          </View>
        )}

        {tab === 'value' && (
          <View style={s.valueTabWrap} testID="color-value-tab">
            <Text style={s.channelGroupLabel}>HSB</Text>
            {[
              { key: 'h', label: 'H', val: Math.round(hsv.h), max: 360, responder: hueSliderResponder, pct: hsv.h / 360 },
              { key: 's', label: 'S', val: Math.round(hsv.s * 100), max: 100, responder: satSliderResponder, pct: hsv.s },
              { key: 'v', label: 'B', val: Math.round(hsv.v * 100), max: 100, responder: valSliderResponder, pct: hsv.v },
            ].map(c => (
              <View key={c.key} style={s.channelRow} testID={`color-channel-${c.key}`}>
                <Text style={s.channelLetter}>{c.label}</Text>
                <View {...c.responder.panHandlers} style={s.channelTrack}>
                  <View style={[s.trackThumb, { left: `${c.pct * 100}%` }]} />
                </View>
                <Text style={s.channelValue}>{c.val}{c.key === 'h' ? '°' : '%'}</Text>
              </View>
            ))}

            <Text style={[s.channelGroupLabel, { marginTop: SP.md }]}>RGB</Text>
            {[
              { key: 'r', label: 'R', val: rgb.r, responder: rSliderResponder, pct: rgb.r / 255 },
              { key: 'g', label: 'G', val: rgb.g, responder: gSliderResponder, pct: rgb.g / 255 },
              { key: 'b', label: 'B', val: rgb.b, responder: bSliderResponder, pct: rgb.b / 255 },
            ].map(c => (
              <View key={c.key} style={s.channelRow} testID={`color-channel-${c.key}`}>
                <Text style={s.channelLetter}>{c.label}</Text>
                <View {...c.responder.panHandlers} style={s.channelTrack}>
                  <View style={[s.trackThumb, { left: `${c.pct * 100}%` }]} />
                </View>
                <Text style={s.channelValue}>{c.val}</Text>
              </View>
            ))}
          </View>
        )}

        {tab === 'palettes' && (
          <View style={s.palettesTabWrap} testID="color-palettes-tab">
            <TouchableOpacity onPress={onNewPalette} testID="color-new-palette">
              <Text style={s.actionLabel}>New palette</Text>
            </TouchableOpacity>
            {palettes.map(p => (
              <View key={p.id} style={s.paletteBlockFull}>
                <View style={s.paletteHeader}>
                  {editingPaletteId === p.id ? (
                    <TextInput
                      value={editingPaletteName}
                      onChangeText={setEditingPaletteName}
                      onBlur={() => { onRenamePalette(p.id, editingPaletteName.trim() || p.name); setEditingPaletteId(null); }}
                      onSubmitEditing={() => { onRenamePalette(p.id, editingPaletteName.trim() || p.name); setEditingPaletteId(null); }}
                      autoFocus
                      style={s.paletteNameInput}
                      testID={`palette-rename-input-${p.id}`}
                    />
                  ) : (
                    <TouchableOpacity onLongPress={() => { setEditingPaletteId(p.id); setEditingPaletteName(p.name); }}>
                      <Text style={s.paletteName}>{p.name}</Text>
                    </TouchableOpacity>
                  )}
                  <View style={{ flexDirection: 'row', gap: SP.sm, alignItems: 'center' }}>
                    <TouchableOpacity onPress={() => onSetDefaultPalette(p.id)} testID={`palette-set-default-${p.id}`}>
                      <Text style={[s.defaultLabel, p.isDefault && s.defaultLabelActive]}>
                        {p.isDefault ? 'Default' : 'Set Default'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => onSaveToPalette(p.id, color)} testID={`palette-add-current-${p.id}`}>
                      <Feather name="plus-circle" size={ICON.xs} color={SUBTLE} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => onDeletePalette(p.id)} testID={`palette-delete-${p.id}`}>
                      <Feather name="trash-2" size={ICON.xs} color={SUBTLE} />
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={s.swatchRow}>
                  {p.colors.map(c => (
                    <TouchableOpacity key={c} onPress={() => onChange(c)} style={[s.swatch, { backgroundColor: c }]} />
                  ))}
                  {p.colors.length === 0 && <Text style={s.emptyPaletteText}>Tap + to add the current colour</Text>}
                </View>
              </View>
            ))}
            {palettes.length === 0 && <Text style={s.emptyPaletteText}>No palettes yet — tap "New palette" to start one.</Text>}
          </View>
        )}

        <View style={s.hexRow}>
          <View style={[s.swatchPreview, { backgroundColor: color }]} />
          <TextInput
            value={hexInput}
            onChangeText={t => { setHexInput(t); setHexError(false); }}
            onSubmitEditing={submitHex}
            onBlur={submitHex}
            autoCapitalize="characters"
            style={[s.hexInput, hexError && s.hexInputError]}
            testID="color-hex-input"
          />
        </View>

        {recentColors.length > 0 && (
          <View style={s.swatchRow}>
            {recentColors.slice(0, 10).map(c => (
              <TouchableOpacity key={c} onPress={() => onChange(c)} style={[s.swatch, { backgroundColor: c }]} />
            ))}
          </View>
        )}

        {tab !== 'palettes' && defaultPalette && (
          <View style={s.paletteBlock}>
            <Text style={s.paletteName}>{defaultPalette.name}</Text>
            <View style={s.swatchRow}>
              {defaultPalette.colors.map(c => (
                <TouchableOpacity key={c} onPress={() => onChange(c)} style={[s.swatch, { backgroundColor: c }]} />
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      <View style={s.tabBar} testID="color-tab-bar">
        {TABS.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[s.tabBtn, tab === t.key && s.tabBtnActive]}
            onPress={() => setTab(t.key)}
            testID={`color-tab-${t.key}`}
          >
            <Feather name={t.icon} size={ICON.sm} color={tab === t.key ? FG : MUTED} />
            <Text style={[s.tabLabel, tab === t.key && s.tabLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  panel: {
    width: '100%', height: '82%', backgroundColor: CARD_ELEVATED,
    borderBottomLeftRadius: RADIUS.lg, borderBottomRightRadius: RADIUS.lg,
    borderWidth: 1, borderColor: BORDER, borderTopWidth: 0, overflow: 'hidden',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.lg, paddingTop: SP.lg, paddingBottom: SP.sm,
  },
  title: { fontFamily: FONT.bold, fontSize: 28, color: FG, includeFontPadding: false },
  doneLabel: { fontFamily: FONT.semibold, fontSize: FS.md, color: FG, includeFontPadding: false },
  actionsRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.lg, paddingHorizontal: SP.lg, paddingBottom: SP.md,
    borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE,
  },
  actionLabel: { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED, includeFontPadding: false },
  previousColorBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  previousSwatch: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: BORDER },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: SP.lg, paddingBottom: SP.lg, paddingTop: SP.md, gap: SP.sm },

  discWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: SP.sm, gap: SP.sm },
  disc: { width: DISC_SIZE, height: DISC_SIZE, borderRadius: DISC_SIZE / 2, overflow: 'visible' },
  discKnob: { position: 'absolute', width: 16, height: 16, borderRadius: 8, borderWidth: 2 },
  harmonyKnob: { position: 'absolute', width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: FG },

  classicWrap: { alignItems: 'center', gap: SP.sm },
  square: { width: SQUARE_SIZE, height: SQUARE_SIZE, borderRadius: RADIUS.sm, overflow: 'hidden' },
  squareSatWash: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(255,255,255,0.0)' },
  squareValWash: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.0)' },
  squareKnob: { position: 'absolute', width: 16, height: 16, borderRadius: 8, borderWidth: 2 },

  harmonyWrap: { gap: SP.sm },
  harmonyChip: {
    paddingHorizontal: SP.md, paddingVertical: 6, borderRadius: RADIUS.pill, marginRight: SP.xs,
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER_SUBTLE,
  },
  harmonyChipActive: { backgroundColor: FG, borderColor: FG },
  harmonyChipText: { fontFamily: FONT.medium, fontSize: FS.xs, color: MUTED, includeFontPadding: false },

  sliderLabel: { fontFamily: FONT.semibold, fontSize: FS.xs, color: MUTED, includeFontPadding: false, textTransform: 'uppercase', letterSpacing: 0.5 },
  track: { width: 200, alignSelf: 'center', height: 20, borderRadius: RADIUS.xs, overflow: 'visible', justifyContent: 'center' },
  trackGradient: { height: 10, borderRadius: 5, overflow: 'hidden' },
  trackThumb: { position: 'absolute', width: 4, height: 20, backgroundColor: FG, borderRadius: 2, marginLeft: -2 },
  hueGradientRow: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden' },
  hueGradientSeg: { flex: 1 },

  valueTabWrap: { gap: SP.sm },
  channelGroupLabel: { fontFamily: FONT.semibold, fontSize: FS.xs, color: SUBTLE, includeFontPadding: false, textTransform: 'uppercase', letterSpacing: 0.5 },
  channelRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  channelLetter: { fontFamily: FONT.semibold, fontSize: FS.sm, color: MUTED, width: 16, includeFontPadding: false },
  channelTrack: { flex: 1, height: 20, borderRadius: RADIUS.xs, backgroundColor: SURFACE, justifyContent: 'center' },
  channelValue: { fontFamily: FONT.medium, fontSize: FS.sm, color: FG, width: 44, textAlign: 'right', includeFontPadding: false },

  palettesTabWrap: { gap: SP.md },
  paletteBlockFull: { gap: 6, borderTopWidth: 1, borderTopColor: BORDER_SUBTLE, paddingTop: SP.sm },
  paletteNameInput: {
    fontFamily: FONT.medium, fontSize: FS.sm, color: FG, includeFontPadding: false,
    borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE, paddingVertical: 2, minWidth: 120,
  },
  defaultLabel: { fontFamily: FONT.medium, fontSize: 10, color: SUBTLE, includeFontPadding: false },
  defaultLabelActive: { color: FG },
  emptyPaletteText: { fontFamily: FONT.regular, fontSize: FS.xs, color: SUBTLE, includeFontPadding: false },

  hexRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.sm },
  swatchPreview: { width: 28, height: 28, borderRadius: RADIUS.xs, borderWidth: 1, borderColor: BORDER },
  hexInput: {
    flex: 1, fontFamily: FONT.medium, fontSize: FS.sm, color: FG, includeFontPadding: false,
    backgroundColor: SURFACE, borderRadius: RADIUS.xs, paddingHorizontal: SP.sm, paddingVertical: 6,
    borderWidth: 1, borderColor: BORDER_SUBTLE,
  },
  hexInputError: { borderColor: '#F87171' },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  swatch: { width: 22, height: 22, borderRadius: RADIUS.xs, borderWidth: 1, borderColor: BORDER },
  paletteBlock: { gap: 6, borderTopWidth: 1, borderTopColor: BORDER_SUBTLE, paddingTop: SP.sm },
  paletteHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  paletteName: { fontFamily: FONT.medium, fontSize: FS.xs, color: MUTED, includeFontPadding: false },

  tabBar: {
    flexDirection: 'row', borderTopWidth: 1, borderTopColor: BORDER_SUBTLE,
    paddingVertical: SP.sm, paddingBottom: SP.md,
  },
  tabBtn: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 4 },
  tabBtnActive: {},
  tabLabel: { fontFamily: FONT.medium, fontSize: 10, color: MUTED, includeFontPadding: false },
  tabLabelActive: { color: FG },
});
