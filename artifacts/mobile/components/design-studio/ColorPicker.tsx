/**
 * ColorPicker.tsx — floating color picker popover: disc/classic toggle, hex
 * input, recent colors, saved brand palettes. Eyedropper is exposed via
 * `onRequestEyedropper` — the host screen owns the actual pixel sampling
 * (native Skia surface read, or the SVG-fallback approximation), since that
 * requires touch coordination with the canvas itself, not just this popover.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, PanResponder } from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  BG, SURFACE, CARD_ELEVATED, BORDER, BORDER_SUBTLE, FG, MUTED, SUBTLE, FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import {
  hsvToHex, hexToHsv, isValidHex, discPointToHs, hsToDiscPoint, contrastingBW,
  BrandPalette,
} from '@/lib/colorModel';

export type ColorPickerMode = 'disc' | 'classic';

export interface ColorPickerProps {
  color: string; // current hex
  onChange: (hex: string) => void;
  recentColors: string[];
  palettes: BrandPalette[];
  onSaveToPalette: (paletteId: string, hex: string) => void;
  onRequestEyedropper: () => void;
  onClose: () => void;
}

const DISC_SIZE = 200;
const DISC_RADIUS = DISC_SIZE / 2;

export default function ColorPicker(props: ColorPickerProps) {
  const { color, onChange, recentColors, palettes, onSaveToPalette, onRequestEyedropper, onClose } = props;
  const [mode, setMode] = useState<ColorPickerMode>('disc');
  const [hexInput, setHexInput] = useState(color);
  const [hexError, setHexError] = useState(false);

  const hsv = useMemo(() => hexToHsv(color) ?? { h: 0, s: 0, v: 1 }, [color]);
  const [value, setValue] = useState(hsv.v);

  function commitHsv(h: number, s: number, v: number) {
    onChange(hsvToHex({ h, s, v }));
  }

  const discResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (e) => {
      const { locationX, locationY } = e.nativeEvent;
      const nx = (locationX - DISC_RADIUS) / DISC_RADIUS;
      const ny = (locationY - DISC_RADIUS) / DISC_RADIUS;
      const { h, s } = discPointToHs({ x: nx, y: ny });
      commitHsv(h, s, value);
    },
  }), [value, color]);

  const valueResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (_e, g) => {
      const next = Math.max(0, Math.min(1, value + g.dx / 140));
      setValue(next);
      commitHsv(hsv.h, hsv.s, next);
    },
  }), [value, hsv.h, hsv.s]);

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

  return (
    <View style={s.panel} testID="color-picker">
      <View style={s.header}>
        <View style={s.modeToggle}>
          <TouchableOpacity onPress={() => setMode('disc')} style={[s.modeBtn, mode === 'disc' && s.modeBtnActive]}>
            <Text style={[s.modeText, mode === 'disc' && s.modeTextActive]}>Disc</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMode('classic')} style={[s.modeBtn, mode === 'classic' && s.modeBtnActive]}>
            <Text style={[s.modeText, mode === 'classic' && s.modeTextActive]}>Classic</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', gap: SP.sm }}>
          <TouchableOpacity onPress={onRequestEyedropper} style={s.headerBtn} accessibilityLabel="Eyedropper" testID="color-eyedropper">
            <Feather name="crosshair" size={ICON.sm} color={FG} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={s.headerBtn} accessibilityLabel="Close color picker">
            <Feather name="x" size={ICON.sm} color={FG} />
          </TouchableOpacity>
        </View>
      </View>

      {mode === 'disc' ? (
        <View style={s.discWrap}>
          <View
            {...discResponder.panHandlers}
            style={[s.disc, { backgroundColor: `hsl(${hsv.h},100%,50%)` }]}
            testID="color-disc"
          >
            <View style={[s.discKnob, { left: knobX - 8, top: knobY - 8, backgroundColor: color, borderColor: knobColor }]} />
          </View>
        </View>
      ) : (
        <View style={s.classicWrap} testID="color-classic">
          {/* Classic mode: hue strip is approximated with 12 selectable swatches + saturation/value via same disc math fallback. */}
          <View style={s.hueStrip}>
            {Array.from({ length: 12 }, (_, i) => i * 30).map(h => (
              <TouchableOpacity key={h} onPress={() => commitHsv(h, hsv.s || 1, value)} style={[s.hueSwatch, { backgroundColor: `hsl(${h},100%,50%)` }]} />
            ))}
          </View>
        </View>
      )}

      <View {...valueResponder.panHandlers} style={s.valueTrack} testID="color-value-slider">
        <View style={[s.valueGradient, { backgroundColor: `hsl(${hsv.h},${hsv.s * 100}%,50%)` }]} />
        <View style={[s.valueThumb, { left: `${value * 100}%` }]} />
      </View>

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

      {palettes.map(p => (
        <View key={p.id} style={s.paletteBlock}>
          <View style={s.paletteHeader}>
            <Text style={s.paletteName}>{p.name}</Text>
            <TouchableOpacity onPress={() => onSaveToPalette(p.id, color)}>
              <Feather name="plus-circle" size={ICON.xs} color={SUBTLE} />
            </TouchableOpacity>
          </View>
          <View style={s.swatchRow}>
            {p.colors.map(c => (
              <TouchableOpacity key={c} onPress={() => onChange(c)} style={[s.swatch, { backgroundColor: c }]} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  panel: {
    width: 240, backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: BORDER, padding: SP.md, gap: SP.sm,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modeToggle: { flexDirection: 'row', backgroundColor: SURFACE, borderRadius: RADIUS.pill, padding: 2 },
  modeBtn: { paddingHorizontal: SP.sm, paddingVertical: 4, borderRadius: RADIUS.pill },
  modeBtnActive: { backgroundColor: FG },
  modeText: { fontFamily: FONT.medium, fontSize: FS.xs, color: MUTED, includeFontPadding: false },
  modeTextActive: { color: BG },
  headerBtn: { width: 28, height: 28, borderRadius: RADIUS.xs, alignItems: 'center', justifyContent: 'center', backgroundColor: SURFACE },
  discWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: SP.sm },
  disc: { width: DISC_SIZE, height: DISC_SIZE, borderRadius: DISC_SIZE / 2, overflow: 'visible' },
  discKnob: { position: 'absolute', width: 16, height: 16, borderRadius: 8, borderWidth: 2 },
  classicWrap: { paddingVertical: SP.sm },
  hueStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  hueSwatch: { width: 24, height: 24, borderRadius: RADIUS.xs },
  valueTrack: { height: 20, borderRadius: RADIUS.xs, overflow: 'visible', justifyContent: 'center' },
  valueGradient: { height: 10, borderRadius: 5 },
  valueThumb: { position: 'absolute', width: 4, height: 20, backgroundColor: FG, borderRadius: 2, marginLeft: -2 },
  hexRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
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
});
