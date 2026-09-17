/**
 * TextOverlayEditor — TikTok-style text overlay editor for Brandthread video posts.
 *
 * Interaction model:
 * - Full-screen dim over video preview
 * - "Done" at top-right to commit
 * - Centred text input over media (keyboard-safe)
 * - Bottom styling strip: alignment toggle | font selector | colour palette
 * - Multiple overlay support with drag-to-reposition (PanResponder)
 * - Tap existing overlay chip to reopen editor
 * - Long-press existing overlay chip to delete
 */
import React, {
  useState, useRef, useCallback, useEffect,
} from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Dimensions, Modal, PanResponder, Animated,
  Pressable, Platform, KeyboardAvoidingView, Keyboard,
  AccessibilityInfo,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { FONT, FS } from '@/lib/theme';
import type {
  TextOverlay, TextOverlayAlign, TextOverlayBgStyle, TextOverlayFontStyle,
} from '@/lib/videoEditing';

// ─── Design tokens (monochrome Brandthread identity) ─────────────────────────
const BG       = '#000000';
const FG       = '#F4F4FF';
const MUTED    = 'rgba(244,244,255,0.55)';
const BORDER   = 'rgba(255,255,255,0.12)';
const SELECTED = 'rgba(255,255,255,0.25)';

const { width: SW, height: SH } = Dimensions.get('window');

// ─── Palette — monochrome-first, TikTok-inspired colours ─────────────────────
const PALETTE = [
  '#ffffff', '#000000', '#ff3333', '#ff8800', '#ffcc00',
  '#33cc33', '#009966', '#00cccc', '#3399ff', '#0044ff',
  '#6633ff', '#cc33ff', '#ff33bb', '#ff99aa', '#ffee99',
  '#aaaaaa',
];

// ─── Font style labels (compact names matching TikTok reference) ──────────────
interface FontPreset { key: TextOverlayFontStyle; label: string; italic?: boolean; weight?: 'normal' | 'bold' }
const FONT_STYLES: FontPreset[] = [
  { key: 'classic',  label: 'Classic',  weight: 'bold' },
  { key: 'elegance', label: 'Elegance', italic: true },
  { key: 'retro',    label: 'Retro',    weight: 'bold', italic: true },
  { key: 'vintage',  label: 'Vintage',  italic: true },
  { key: 'postcard', label: 'Postcard', weight: 'bold' },
  { key: 'script',   label: 'Script',   italic: true },
  { key: 'technic',  label: 'Technic',  weight: 'bold' },
];

// ─── Props ────────────────────────────────────────────────────────────────────
interface TextOverlayEditorProps {
  /** Whether the editor sheet is open */
  visible: boolean;
  /** Overlay being edited (undefined = new) */
  editingOverlay?: TextOverlay;
  /** Called when user taps "Done" with the committed overlay */
  onDone: (overlay: TextOverlay) => void;
  /** Called when user taps "Cancel" / closes without committing */
  onCancel: () => void;
}

// ─── ID generator ─────────────────────────────────────────────────────────────
function genId(): string {
  return `ov_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Sub-component: colour swatch ─────────────────────────────────────────────
function ColorSwatch({ color, selected, onPress }: {
  color: string; selected: boolean; onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        es.swatch,
        { backgroundColor: color },
        selected && es.swatchSelected,
        color === '#ffffff' && es.swatchLight,
      ]}
      activeOpacity={0.8}
      accessibilityLabel={`Color ${color}`}
      accessibilityRole="button"
      testID={`color-swatch-${color.replace('#', '')}`}
    >
      {selected && (
        <Feather
          name="check"
          size={11}
          color={color === '#ffffff' || color === '#ffcc00' || color === '#ffee99' ? '#000' : '#fff'}
        />
      )}
    </TouchableOpacity>
  );
}

// ─── Main editor ──────────────────────────────────────────────────────────────
export function TextOverlayEditor({
  visible, editingOverlay, onDone, onCancel,
}: TextOverlayEditorProps) {
  const insets = useSafeAreaInsets();

  // Editor state
  const [text, setText]           = useState('');
  const [color, setColor]         = useState('#ffffff');
  const [fontStyle, setFontStyle] = useState<TextOverlayFontStyle>('classic');
  const [align, setAlign]         = useState<TextOverlayAlign>('center');
  const [bgStyle, setBgStyle]     = useState<TextOverlayBgStyle>('none');
  const [fontSize]                = useState(28); // fixed for now; pinch-to-resize could extend this

  const inputRef = useRef<TextInput>(null);

  // Reset / seed when overlay changes
  useEffect(() => {
    if (!visible) return;
    if (editingOverlay) {
      setText(editingOverlay.text);
      setColor(editingOverlay.color);
      setFontStyle(editingOverlay.fontStyle);
      setAlign(editingOverlay.align);
      setBgStyle(editingOverlay.bgStyle);
    } else {
      setText('');
      setColor('#ffffff');
      setFontStyle('classic');
      setAlign('center');
      setBgStyle('none');
    }
    // Auto-focus input after a short delay so keyboard appears
    setTimeout(() => inputRef.current?.focus(), 120);
  }, [visible, editingOverlay]);

  function handleDone() {
    const trimmed = text.trim();
    if (!trimmed) { onCancel(); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onDone({
      id: editingOverlay?.id ?? genId(),
      text: trimmed,
      x: editingOverlay?.x ?? 0.5,
      y: editingOverlay?.y ?? 0.4,
      color,
      fontStyle,
      align,
      bgStyle,
      fontSize,
    });
  }

  function cycleAlign() {
    Haptics.selectionAsync();
    const order: TextOverlayAlign[] = ['left', 'center', 'right'];
    const next = order[(order.indexOf(align) + 1) % order.length];
    setAlign(next);
  }

  function cycleBgStyle() {
    Haptics.selectionAsync();
    const order: TextOverlayBgStyle[] = ['none', 'semi', 'solid'];
    const next = order[(order.indexOf(bgStyle) + 1) % order.length];
    setBgStyle(next);
  }

  // Background box style for preview text
  const previewBg = bgStyle === 'solid'
    ? color === '#ffffff' ? '#000000' : '#ffffff'
    : bgStyle === 'semi'
      ? 'rgba(0,0,0,0.5)'
      : 'transparent';
  const previewTextColor = bgStyle === 'solid'
    ? (color === '#ffffff' ? '#000000' : color)
    : color;

  const alignIcon: Record<TextOverlayAlign, keyof typeof Feather.glyphMap> = {
    left: 'align-left',
    center: 'align-center',
    right: 'align-right',
  };
  const bgIcon: Record<TextOverlayBgStyle, keyof typeof Feather.glyphMap> = {
    none: 'type',
    semi: 'square',
    solid: 'sidebar',
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        style={StyleSheet.absoluteFill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* Semi-transparent dim overlay */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]}
          pointerEvents="none"
        />

        {/* Top bar: Done */}
        <View style={[es.topBar, { paddingTop: insets.top + 6 }]}>
          <View style={{ width: 60 }} />
          <TouchableOpacity
            onPress={handleDone}
            style={es.doneBtn}
            activeOpacity={0.8}
            accessibilityLabel="Done, add text overlay"
            accessibilityRole="button"
            testID="text-overlay-done"
          >
            <Text style={es.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>

        {/* Centred text input over video */}
        <View style={es.inputContainer} pointerEvents="box-none">
          <View
            style={[
              es.textPreviewBox,
              bgStyle !== 'none' && {
                backgroundColor: previewBg,
                borderRadius: 6,
                paddingHorizontal: 12,
                paddingVertical: 6,
              },
            ]}
          >
            <TextInput
              ref={inputRef}
              value={text}
              onChangeText={(t) => {
                if (t.length <= 200) setText(t);
              }}
              style={[
                es.textInput,
                {
                  color: previewTextColor,
                  textAlign: align,
                  fontWeight: FONT_STYLES.find(f => f.key === fontStyle)?.weight ?? 'normal',
                  fontStyle: FONT_STYLES.find(f => f.key === fontStyle)?.italic ? 'italic' : 'normal',
                  fontSize,
                },
              ]}
              multiline
              returnKeyType="done"
              blurOnSubmit={false}
              placeholderTextColor="rgba(255,255,255,0.45)"
              placeholder="Add text…"
              autoCapitalize="sentences"
              autoCorrect
              maxLength={200}
              selectionColor="rgba(255,255,255,0.8)"
              accessibilityLabel="Text overlay input"
              testID="text-overlay-input"
            />
          </View>
        </View>

        {/* Bottom styling strip */}
        <View style={[es.bottomStrip, { paddingBottom: insets.bottom + 4 }]}>
          {/* Row 1: align + bg-style icon | font style scroller */}
          <View style={es.controlRow}>
            {/* Alignment toggle */}
            <TouchableOpacity
              onPress={cycleAlign}
              style={es.iconBtn}
              activeOpacity={0.8}
              accessibilityLabel={`Text alignment: ${align}`}
              accessibilityRole="button"
              testID="text-overlay-align"
            >
              <Feather name={alignIcon[align]} size={22} color={FG} />
            </TouchableOpacity>

            {/* Background style toggle */}
            <TouchableOpacity
              onPress={cycleBgStyle}
              style={[es.iconBtn, bgStyle !== 'none' && es.iconBtnActive]}
              activeOpacity={0.8}
              accessibilityLabel={`Text background: ${bgStyle}`}
              accessibilityRole="button"
              testID="text-overlay-bgstyle"
            >
              <Feather name={bgIcon[bgStyle]} size={22} color={FG} />
            </TouchableOpacity>

            {/* Font style horizontal scroll */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={es.fontRow}
              keyboardShouldPersistTaps="handled"
              style={{ flex: 1 }}
            >
              {FONT_STYLES.map((fp) => {
                const active = fontStyle === fp.key;
                return (
                  <TouchableOpacity
                    key={fp.key}
                    onPress={() => { Haptics.selectionAsync(); setFontStyle(fp.key); }}
                    style={[es.fontChip, active && es.fontChipActive]}
                    activeOpacity={0.75}
                    accessibilityLabel={`Font style: ${fp.label}`}
                    accessibilityRole="button"
                    testID={`font-style-${fp.key}`}
                  >
                    <Text style={[
                      es.fontChipText,
                      active && es.fontChipTextActive,
                      fp.italic && { fontStyle: 'italic' },
                      fp.weight === 'bold' && { fontFamily: FONT.bold },
                    ]}>
                      {fp.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* Row 2: colour palette */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={es.paletteRow}
            keyboardShouldPersistTaps="handled"
          >
            {PALETTE.map((c) => (
              <ColorSwatch
                key={c}
                color={c}
                selected={color === c}
                onPress={() => { Haptics.selectionAsync(); setColor(c); }}
              />
            ))}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Draggable overlay chip (rendered on the video canvas) ──────────────────

interface OverlayChipProps {
  overlay: TextOverlay;
  /** Container dimensions (for clamping) */
  containerWidth: number;
  containerHeight: number;
  /** Called when user taps to reopen editor */
  onTap: () => void;
  /** Called when position changes (normalized) */
  onMove: (x: number, y: number) => void;
  /** Called when user long-presses to delete */
  onDelete: () => void;
}

export function OverlayChip({
  overlay, containerWidth, containerHeight, onTap, onMove, onDelete,
}: OverlayChipProps) {
  const CHIP_W = Math.min(SW * 0.75, 300);

  // Derive initial px position from normalized coords
  const initX = overlay.x * containerWidth - CHIP_W / 2;
  const initY = overlay.y * containerHeight;

  const pan = useRef(new Animated.ValueXY({ x: initX, y: initY })).current;
  const isDragging = useRef(false);
  const lastPx = useRef({ x: initX, y: initY });

  // Keep in sync when overlay prop changes (e.g. after edit)
  useEffect(() => {
    const nx = overlay.x * containerWidth - CHIP_W / 2;
    const ny = overlay.y * containerHeight;
    pan.setValue({ x: nx, y: ny });
    lastPx.current = { x: nx, y: ny };
  }, [overlay.x, overlay.y, containerWidth, containerHeight]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 4 || Math.abs(gs.dy) > 4,
      onPanResponderGrant: () => {
        isDragging.current = false;
        pan.setOffset({ x: lastPx.current.x, y: lastPx.current.y });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: (_, gs) => {
        isDragging.current = true;
        Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false })(_, gs);
      },
      onPanResponderRelease: (_, gs) => {
        pan.flattenOffset();
        // @ts-ignore — _value is internal but stable
        const rawX = (pan.x as any)._value as number;
        // @ts-ignore
        const rawY = (pan.y as any)._value as number;
        const clampedX = Math.max(0, Math.min(containerWidth - CHIP_W, rawX));
        const clampedY = Math.max(0, Math.min(containerHeight - 40, rawY));
        pan.setValue({ x: clampedX, y: clampedY });
        lastPx.current = { x: clampedX, y: clampedY };
        // Normalize and report
        const normX = (clampedX + CHIP_W / 2) / Math.max(1, containerWidth);
        const normY = clampedY / Math.max(1, containerHeight);
        if (isDragging.current) {
          onMove(Math.max(0, Math.min(1, normX)), Math.max(0, Math.min(1, normY)));
        } else {
          onTap();
        }
        isDragging.current = false;
      },
    })
  ).current;

  const bgStyle = overlay.bgStyle;
  const bgColor = bgStyle === 'solid'
    ? (overlay.color === '#ffffff' ? '#000000' : '#ffffff')
    : bgStyle === 'semi'
      ? 'rgba(0,0,0,0.5)'
      : 'transparent';
  const textColor = bgStyle === 'solid'
    ? (overlay.color === '#ffffff' ? '#000000' : overlay.color)
    : overlay.color;

  const fontPreset = FONT_STYLES.find(f => f.key === overlay.fontStyle);

  return (
    <Animated.View
      style={[
        oc.chip,
        { width: CHIP_W, transform: pan.getTranslateTransform() },
      ]}
      {...panResponder.panHandlers}
      accessible
      accessibilityLabel={`Text overlay: ${overlay.text}. Tap to edit, long press to delete.`}
      accessibilityRole="button"
      testID={`overlay-chip-${overlay.id}`}
    >
      <Pressable
        onPress={onTap}
        onLongPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onDelete();
        }}
        delayLongPress={500}
        style={[
          oc.inner,
          bgStyle !== 'none' && { backgroundColor: bgColor, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
        ]}
      >
        <Text
          style={[
            oc.text,
            {
              color: textColor,
              textAlign: overlay.align,
              fontSize: overlay.fontSize,
              fontWeight: fontPreset?.weight ?? 'normal',
              fontStyle: fontPreset?.italic ? 'italic' : 'normal',
            },
          ]}
          numberOfLines={5}
        >
          {overlay.text}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const es = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
    zIndex: 100,
  },
  doneBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  doneBtnText: {
    color: FG,
    fontSize: FS.base,
    fontFamily: FONT.semibold,
  },
  inputContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  textPreviewBox: {
    minWidth: 80,
    maxWidth: SW - 40,
  },
  textInput: {
    fontFamily: FONT.regular,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    minHeight: 48,
    textAlignVertical: 'center',
  },
  bottomStrip: {
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingBottom: 8,
    gap: 6,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  iconBtnActive: {
    backgroundColor: SELECTED,
  },
  fontRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  fontChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  fontChipActive: {
    borderColor: FG,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  fontChipText: {
    color: MUTED,
    fontSize: FS.xs,
    fontFamily: FONT.regular,
  },
  fontChipTextActive: {
    color: FG,
  },
  paletteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchSelected: {
    borderWidth: 2.5,
    borderColor: FG,
  },
  swatchLight: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
});

const oc = StyleSheet.create({
  chip: {
    position: 'absolute',
    zIndex: 50,
  },
  inner: {
    alignSelf: 'flex-start',
  },
  text: {
    fontFamily: FONT.regular,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});
