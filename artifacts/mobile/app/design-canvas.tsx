/**
 * Brandthread Studio — Phase 1 Design Canvas
 * Full toolbar · floating controls · layers panel · color picker · tool panel
 */
import React, { useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, PanResponder,
  Alert, ScrollView, LayoutChangeEvent, TextInput, Modal,
  Platform, Animated, Dimensions,
} from 'react-native';
import Svg, { Path, Circle, Rect, Line, G } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';

// ─── Theme ────────────────────────────────────────────────────────────────────
const BG        = '#0D0E0D';
const SURFACE   = '#131713';
const SURFACE2  = '#1A1E1A';
const BORDER    = '#232523';
const FG        = '#EAF2ED';
const MUTED     = '#6B7A6D';
const GREEN     = '#39FF88';
const GREEN_DIM = '#0D2B1A';
const PURPLE    = '#7C3AED';
const ACCENT    = GREEN;

// ─── Types ───────────────────────────────────────────────────────────────────
type Tool = 'brush' | 'eraser' | 'shapes' | 'text' | 'select' | 'fill';

interface Stroke {
  id: string;
  d: string;
  color: string;
  width: number;
  opacity: number;
  layerId: string;
  tool: Tool;
}

interface LayerData {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  strokes: Stroke[];
}

// ─── Default palette ─────────────────────────────────────────────────────────
const DEFAULT_PALETTE = [
  '#FFFFFF', '#0D0E0D', '#EF4444', '#F97316', '#EAB308',
  '#22C55E', '#0EA5E9', '#8B5CF6', '#EC4899', '#6B7280',
  '#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF', '#FF6FC8',
  '#C084FC', '#34D399', '#FBBF24', '#F472B6', '#A78BFA',
];

// ─── Brush presets ────────────────────────────────────────────────────────────
const BRUSHES = [
  { name: 'Studio Ink',     icon: 'edit-3',   widthMult: 1.0, opacityMult: 1.0 },
  { name: 'Felt Marker',    icon: 'pen-tool', widthMult: 1.6, opacityMult: 0.85 },
  { name: 'Airbrush',       icon: 'wind',     widthMult: 2.5, opacityMult: 0.45 },
  { name: 'Sketch',         icon: 'edit',     widthMult: 0.7, opacityMult: 0.75 },
  { name: 'Fabric Stitch',  icon: 'gitlab',   widthMult: 0.5, opacityMult: 1.0  },
  { name: 'Screen Print',   icon: 'layers',   widthMult: 2.0, opacityMult: 0.95 },
];

let _id = 0;
function uid() { return `id_${++_id}`; }

// ─────────────────────────────────────────────────────────────────────────────
export default function DesignCanvasScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ label?: string; dims?: string; ratio?: string }>();
  const title = params.label ?? 'Untitled';
  const ratio = params.ratio ? parseFloat(params.ratio) : undefined;
  const isFullBleed = !ratio || params.label === 'Screen Size';

  // ── Canvas dimensions ──────────────────────────────────────────────────────
  const [wrapSize, setWrapSize] = useState<{ w: number; h: number } | null>(null);
  function onWrapLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) setWrapSize({ w: width, h: height });
  }
  let canvasW: number | undefined, canvasH: number | undefined;
  if (wrapSize) {
    if (isFullBleed) { canvasW = wrapSize.w; canvasH = wrapSize.h; }
    else if (ratio! >= 1) { canvasW = Math.min(wrapSize.w, wrapSize.h * ratio!); canvasH = canvasW / ratio!; }
    else { canvasH = Math.min(wrapSize.h, wrapSize.w / ratio!); canvasW = canvasH * ratio!; }
  }

  // ── Tool & brush state ─────────────────────────────────────────────────────
  const [tool, setTool]               = useState<Tool>('brush');
  const [color, setColor]             = useState('#FFFFFF');
  const [brushSize, setBrushSize]     = useState(8);
  const [opacity, setOpacity]         = useState(100);
  const [brushIdx, setBrushIdx]       = useState(0);

  // ── Layers ─────────────────────────────────────────────────────────────────
  const [layers, setLayers] = useState<LayerData[]>([
    { id: uid(), name: 'Layer 1', visible: true, locked: false, opacity: 100, strokes: [] },
  ]);
  const [activeLayerId, setActiveLayerId] = useState(layers[0].id);

  // ── History ────────────────────────────────────────────────────────────────
  const [history,   setHistory]   = useState<LayerData[][]>([]);
  const [redoStack, setRedoStack] = useState<LayerData[][]>([]);

  function pushHistory(prev: LayerData[]) {
    setHistory((h) => [...h.slice(-49), prev]);
    setRedoStack([]);
  }

  function undo() {
    setHistory((h) => {
      if (h.length === 0) return h;
      const snap = h[h.length - 1];
      setRedoStack((r) => [...r, layers]);
      setLayers(snap);
      return h.slice(0, -1);
    });
    haptic('light');
  }

  function redo() {
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const snap = r[r.length - 1];
      setHistory((h) => [...h, layers]);
      setLayers(snap);
      return r.slice(0, -1);
    });
    haptic('light');
  }

  // ── Drawing state ──────────────────────────────────────────────────────────
  const [currentD, setCurrentD] = useState('');
  const pointsRef  = useRef<string[]>([]);
  const activeColorRef  = useRef(color);
  const brushSizeRef    = useRef(brushSize);
  const opacityRef      = useRef(opacity);
  const toolRef         = useRef(tool);
  const activeLayerRef  = useRef(activeLayerId);
  const brushIdxRef     = useRef(brushIdx);
  activeColorRef.current  = color;
  brushSizeRef.current    = brushSize;
  opacityRef.current      = opacity;
  toolRef.current         = tool;
  activeLayerRef.current  = activeLayerId;
  brushIdxRef.current     = brushIdx;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        if (toolRef.current === 'select' || toolRef.current === 'fill') return;
        const { locationX: x, locationY: y } = e.nativeEvent;
        pointsRef.current = [`M${x.toFixed(1)},${y.toFixed(1)}`];
        setCurrentD(pointsRef.current.join(' '));
      },
      onPanResponderMove: (e) => {
        if (toolRef.current === 'select' || toolRef.current === 'fill') return;
        const { locationX: x, locationY: y } = e.nativeEvent;
        pointsRef.current.push(`L${x.toFixed(1)},${y.toFixed(1)}`);
        setCurrentD(pointsRef.current.join(' '));
      },
      onPanResponderRelease: () => {
        if (toolRef.current === 'select' || toolRef.current === 'fill') return;
        if (pointsRef.current.length < 2) { pointsRef.current = []; setCurrentD(''); return; }
        const brush = BRUSHES[brushIdxRef.current];
        const newStroke: Stroke = {
          id: uid(),
          d: pointsRef.current.join(' '),
          color: toolRef.current === 'eraser' ? '#CANVAS_ERASE#' : activeColorRef.current,
          width: brushSizeRef.current * brush.widthMult,
          opacity: opacityRef.current / 100 * brush.opacityMult,
          layerId: activeLayerRef.current,
          tool: toolRef.current,
        };
        setLayers((prev) => {
          pushHistory(prev);
          return prev.map((l) =>
            l.id === activeLayerRef.current
              ? { ...l, strokes: [...l.strokes, newStroke] }
              : l
          );
        });
        pointsRef.current = [];
        setCurrentD('');
      },
    }),
  ).current;

  // ── Panels ─────────────────────────────────────────────────────────────────
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showLayers,      setShowLayers]      = useState(false);
  const [showBrushPanel,  setShowBrushPanel]  = useState(false);
  const [showTools,       setShowTools]       = useState(false);
  const [showTextInput,   setShowTextInput]   = useState(false);
  const [textValue,       setTextValue]       = useState('');

  function closeAllPanels() {
    setShowColorPicker(false);
    setShowLayers(false);
    setShowBrushPanel(false);
    setShowTools(false);
  }

  function haptic(style: 'light' | 'medium' = 'medium') {
    Haptics.impactAsync(style === 'light' ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium);
  }

  // ── Layer helpers ──────────────────────────────────────────────────────────
  function addLayer() {
    haptic();
    const l: LayerData = { id: uid(), name: `Layer ${layers.length + 1}`, visible: true, locked: false, opacity: 100, strokes: [] };
    pushHistory(layers);
    setLayers((prev) => [l, ...prev]);
    setActiveLayerId(l.id);
  }

  function toggleLayerVisible(id: string) {
    haptic('light');
    setLayers((prev) => prev.map((l) => l.id === id ? { ...l, visible: !l.visible } : l));
  }

  function deleteLayer(id: string) {
    if (layers.length === 1) { Alert.alert('Cannot delete', 'At least one layer is required.'); return; }
    haptic();
    pushHistory(layers);
    const next = layers.filter((l) => l.id !== id);
    setLayers(next);
    if (activeLayerId === id) setActiveLayerId(next[0].id);
  }

  function duplicateLayer(id: string) {
    haptic();
    const src = layers.find((l) => l.id === id);
    if (!src) return;
    pushHistory(layers);
    const dup: LayerData = { ...src, id: uid(), name: src.name + ' copy', strokes: src.strokes.map((s) => ({ ...s, id: uid(), layerId: uid() })) };
    const idx = layers.findIndex((l) => l.id === id);
    const next = [...layers];
    next.splice(idx, 0, dup);
    setLayers(next);
    setActiveLayerId(dup.id);
  }

  function clearCanvas() {
    Alert.alert('Clear canvas', 'Erase everything?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => {
        pushHistory(layers);
        setLayers((prev) => prev.map((l) => l.id === activeLayerId ? { ...l, strokes: [] } : l));
      }},
    ]);
  }

  function saveProject() {
    haptic();
    Alert.alert('Saved', `"${title}" saved to your gallery.`, [{ text: 'OK', onPress: () => router.back() }]);
  }

  const allStrokes = layers.flatMap((l) => l.visible ? l.strokes : []);
  const canDraw = !layers.find((l) => l.id === activeLayerId)?.locked;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.root, { backgroundColor: BG }]}>
      {/* ── TOP TOOLBAR ── */}
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        {/* Left: back + undo/redo */}
        <View style={styles.topLeft}>
          <TouchableOpacity style={styles.topBtn} onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="chevron-left" size={20} color={FG} />
          </TouchableOpacity>
          <Text style={styles.topTitle} numberOfLines={1}>{title}</Text>
        </View>

        {/* Right: undo · redo · actions */}
        <View style={styles.topRight}>
          <TouchableOpacity style={styles.topBtn} onPress={undo} disabled={history.length === 0} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
            <Feather name="corner-up-left" size={17} color={history.length === 0 ? MUTED : FG} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.topBtn} onPress={redo} disabled={redoStack.length === 0} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
            <Feather name="corner-up-right" size={17} color={redoStack.length === 0 ? MUTED : FG} />
          </TouchableOpacity>
          <View style={styles.topDivider} />
          {/* Brush picker */}
          <TouchableOpacity
            style={[styles.topBtn, showBrushPanel && styles.topBtnActive]}
            onPress={() => { haptic('light'); closeAllPanels(); setShowBrushPanel((v) => !v); }}>
            <Feather name="edit-3" size={17} color={showBrushPanel ? ACCENT : FG} />
          </TouchableOpacity>
          {/* Layers */}
          <TouchableOpacity
            style={[styles.topBtn, showLayers && styles.topBtnActive]}
            onPress={() => { haptic('light'); closeAllPanels(); setShowLayers((v) => !v); }}>
            <Feather name="layers" size={17} color={showLayers ? ACCENT : FG} />
          </TouchableOpacity>
          {/* Color swatch */}
          <TouchableOpacity
            style={[styles.colorSwatch, { backgroundColor: color }, showColorPicker && styles.colorSwatchActive]}
            onPress={() => { haptic('light'); closeAllPanels(); setShowColorPicker((v) => !v); }}>
            {tool === 'eraser' && <View style={styles.eraserX}><Feather name="x" size={10} color={BG} /></View>}
          </TouchableOpacity>
        </View>
      </View>

      {/* ── BRUSH PANEL ─────────────────────────────────────────────────── */}
      {showBrushPanel && (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Brushes</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 4 }}>
            {BRUSHES.map((b, i) => (
              <TouchableOpacity
                key={b.name}
                style={[styles.brushChip, brushIdx === i && styles.brushChipActive]}
                onPress={() => { haptic('light'); setBrushIdx(i); setTool('brush'); setShowBrushPanel(false); }}
              >
                <Feather name={b.icon as any} size={14} color={brushIdx === i ? ACCENT : FG} />
                <Text style={[styles.brushChipText, brushIdx === i && { color: ACCENT }]}>{b.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* ── LAYERS PANEL ────────────────────────────────────────────────── */}
      {showLayers && (
        <View style={styles.panel}>
          <View style={styles.panelHead}>
            <Text style={styles.panelTitle}>Layers</Text>
            <TouchableOpacity style={styles.panelAddBtn} onPress={addLayer}>
              <Feather name="plus" size={16} color={ACCENT} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false}>
            {layers.map((l) => (
              <View key={l.id} style={[styles.layerRow, l.id === activeLayerId && styles.layerRowActive]}>
                <TouchableOpacity onPress={() => setActiveLayerId(l.id)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  {/* Thumb preview */}
                  <View style={styles.layerThumb}>
                    <Feather name="image" size={14} color={MUTED} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.layerName, l.id === activeLayerId && { color: ACCENT }]} numberOfLines={1}>{l.name}</Text>
                    <Text style={styles.layerSub}>{l.strokes.length} stroke{l.strokes.length !== 1 ? 's' : ''}</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => toggleLayerVisible(l.id)} style={styles.layerIconBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Feather name={l.visible ? 'eye' : 'eye-off'} size={15} color={l.visible ? FG : MUTED} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => duplicateLayer(l.id)} style={styles.layerIconBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Feather name="copy" size={14} color={MUTED} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => deleteLayer(l.id)} style={styles.layerIconBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Feather name="trash-2" size={14} color="#EF4444" />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* ── COLOR PICKER PANEL ──────────────────────────────────────────── */}
      {showColorPicker && (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Color</Text>
          {/* Palette grid */}
          <View style={styles.paletteGrid}>
            {DEFAULT_PALETTE.map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.paletteSwatch, { backgroundColor: c }, color === c && styles.paletteSwatchActive]}
                onPress={() => { haptic('light'); setColor(c); setTool('brush'); }}
              />
            ))}
          </View>
          {/* Hex input */}
          <View style={styles.hexRow}>
            <Text style={styles.hexLabel}>#</Text>
            <TextInput
              style={styles.hexInput}
              value={color.replace('#', '')}
              onChangeText={(v) => { if (/^[0-9A-Fa-f]{0,6}$/.test(v)) setColor('#' + v); }}
              maxLength={6}
              autoCapitalize="characters"
              placeholderTextColor={MUTED}
              placeholder="FFFFFF"
            />
            <View style={[styles.hexPreview, { backgroundColor: color }]} />
          </View>
          {/* Quick swaps */}
          <View style={styles.hexQuickRow}>
            <TouchableOpacity style={[styles.hexQuick, { backgroundColor: '#FFFFFF' }]} onPress={() => { haptic('light'); setColor('#FFFFFF'); }} />
            <TouchableOpacity style={[styles.hexQuick, { backgroundColor: '#0D0E0D' }]} onPress={() => { haptic('light'); setColor('#0D0E0D'); }} />
            <TouchableOpacity style={[styles.hexQuick, { backgroundColor: GREEN }]}     onPress={() => { haptic('light'); setColor(GREEN); }} />
            <TouchableOpacity style={[styles.hexQuick, { backgroundColor: '#EF4444' }]} onPress={() => { haptic('light'); setColor('#EF4444'); }} />
            <TouchableOpacity style={[styles.hexQuick, { backgroundColor: '#8B5CF6' }]} onPress={() => { haptic('light'); setColor('#8B5CF6'); }} />
            <TouchableOpacity style={[styles.hexQuick, { backgroundColor: '#F97316' }]} onPress={() => { haptic('light'); setColor('#F97316'); }} />
          </View>
        </View>
      )}

      {/* ── CANVAS AREA ─────────────────────────────────────────────────── */}
      <View style={styles.canvasArea} onLayout={onWrapLayout}>
        {canvasW != null && canvasH != null ? (
          <View
            style={[styles.canvas, { width: canvasW, height: canvasH }]}
            {...(canDraw ? panResponder.panHandlers : {})}
          >
            <Svg style={StyleSheet.absoluteFill} width={canvasW} height={canvasH}>
              {allStrokes.map((s) =>
                s.color === '#CANVAS_ERASE#' ? (
                  <Path
                    key={s.id}
                    d={s.d}
                    stroke="#FFFFFF"
                    strokeWidth={s.width}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={s.opacity}
                  />
                ) : (
                  <Path
                    key={s.id}
                    d={s.d}
                    stroke={s.color}
                    strokeWidth={s.width}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={s.opacity}
                  />
                )
              )}
              {currentD !== '' && (
                <Path
                  d={currentD}
                  stroke={tool === 'eraser' ? '#FFFFFF' : color}
                  strokeWidth={brushSize * BRUSHES[brushIdx].widthMult}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={opacity / 100 * BRUSHES[brushIdx].opacityMult}
                />
              )}
            </Svg>
            {!canDraw && (
              <View style={styles.lockedOverlay}>
                <Feather name="lock" size={28} color={MUTED} />
                <Text style={styles.lockedText}>Layer locked</Text>
              </View>
            )}
          </View>
        ) : null}

        {/* ── Floating LEFT controls: brush size + opacity ── */}
        <View style={[styles.floatLeft, { top: 0, bottom: 0 }]}>
          <FloatSlider
            label="Size"
            value={brushSize}
            min={1}
            max={80}
            onChange={setBrushSize}
            color={ACCENT}
          />
          <View style={{ height: 16 }} />
          <FloatSlider
            label="Opac"
            value={opacity}
            min={1}
            max={100}
            onChange={setOpacity}
            color={FG}
          />
        </View>
      </View>

      {/* ── BOTTOM TOOLBAR ──────────────────────────────────────────────── */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 8 }]}>
        {/* Tool row */}
        <View style={styles.toolRow}>
          <ToolBtn icon="edit-3"  label="Draw"   active={tool === 'brush'}   onPress={() => { haptic('light'); setTool('brush');   closeAllPanels(); }} />
          <ToolBtn icon="x-circle" label="Erase" active={tool === 'eraser'}  onPress={() => { haptic('light'); setTool('eraser');  closeAllPanels(); }} />
          <ToolBtn icon="droplet"  label="Fill"  active={tool === 'fill'}    onPress={() => { haptic('light'); setTool('fill');    closeAllPanels(); }} />
          <ToolBtn icon="type"     label="Text"  active={tool === 'text'}    onPress={() => { haptic('light'); setTool('text');    closeAllPanels(); setTextValue(''); setShowTextInput(true); }} />
          <ToolBtn icon="square"   label="Shapes" active={tool === 'shapes'} onPress={() => { haptic('light'); setTool('shapes'); closeAllPanels(); }} />
          <ToolBtn icon="move"     label="Select" active={tool === 'select'} onPress={() => { haptic('light'); setTool('select'); closeAllPanels(); }} />
        </View>

        {/* Actions row */}
        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.actionBtn} onPress={clearCanvas} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="trash-2" size={16} color={MUTED} />
            <Text style={styles.actionLabel}>Clear</Text>
          </TouchableOpacity>
          <Text style={styles.canvasInfo}>
            {BRUSHES[brushIdx].name} · {brushSize}px · {opacity}%
          </Text>
          <TouchableOpacity style={styles.saveBtn} onPress={saveProject} activeOpacity={0.85}>
            <Feather name="download" size={14} color={BG} />
            <Text style={styles.saveBtnText}>Save</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── TEXT TOOL MODAL ──────────────────────────────────────────────── */}
      <Modal visible={showTextInput} transparent animationType="slide" onRequestClose={() => setShowTextInput(false)}>
        <View style={styles.textModalOverlay}>
          <View style={styles.textModalCard}>
            <Text style={styles.textModalTitle}>Add Text</Text>
            <TextInput
              style={[styles.textModalInput, { color: color }]}
              value={textValue}
              onChangeText={setTextValue}
              placeholder="Type something…"
              placeholderTextColor={MUTED}
              autoFocus
              multiline
            />
            {/* Color row */}
            <View style={styles.textColorRow}>
              {['#FFFFFF','#000000','#FF6B6B','#FFD93D','#6BCB77','#4D96FF','#FF6FC8','#C084FC'].map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.textColorDot, { backgroundColor: c }, color === c && styles.textColorDotActive]}
                  onPress={() => setColor(c)}
                />
              ))}
            </View>
            <View style={styles.textModalActions}>
              <TouchableOpacity style={styles.textModalCancel} onPress={() => setShowTextInput(false)} activeOpacity={0.8}>
                <Text style={styles.textModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.textModalDone, { backgroundColor: ACCENT }]}
                onPress={() => {
                  if (!textValue.trim()) { setShowTextInput(false); return; }
                  haptic();
                  const newStroke: Stroke = {
                    id: uid(),
                    d: `TEXT:${textValue.trim()}`,
                    color: color,
                    width: brushSize,
                    opacity: opacity / 100,
                    layerId: activeLayerId,
                    tool: 'text',
                  };
                  pushHistory(layers);
                  setLayers((prev) => prev.map((l) =>
                    l.id === activeLayerId ? { ...l, strokes: [...l.strokes, newStroke] } : l
                  ));
                  setShowTextInput(false);
                  setTextValue('');
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.textModalDoneText}>Place Text</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Floating vertical slider ─────────────────────────────────────────────────
function FloatSlider({ label, value, min, max, onChange, color }: {
  label: string; value: number; min: number; max: number;
  onChange: (v: number) => void; color: string;
}) {
  const HEIGHT = 120;
  const pct = (value - min) / (max - min);

  const panRef = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,
      onPanResponderGrant: (e) => handleY(e.nativeEvent.locationY),
      onPanResponderMove: (e)  => handleY(e.nativeEvent.locationY),
    })
  ).current;

  function handleY(y: number) {
    const clamped = Math.max(0, Math.min(HEIGHT, y));
    const newPct  = 1 - clamped / HEIGHT;
    const newVal  = Math.round(min + newPct * (max - min));
    onChange(Math.max(min, Math.min(max, newVal)));
  }

  return (
    <View style={sliderStyles.wrap} {...panRef.panHandlers}>
      <View style={[sliderStyles.track, { height: HEIGHT }]}>
        <View style={[sliderStyles.fill, { height: HEIGHT * pct, backgroundColor: color }]} />
        <View style={[sliderStyles.thumb, { bottom: HEIGHT * pct - 6, backgroundColor: color }]} />
      </View>
      <Text style={sliderStyles.label}>{label}</Text>
      <Text style={[sliderStyles.val, { color }]}>{value}</Text>
    </View>
  );
}

const sliderStyles = StyleSheet.create({
  wrap:  { alignItems: 'center', gap: 4 },
  track: { width: 6, borderRadius: 3, backgroundColor: '#1A1E1A', justifyContent: 'flex-end', overflow: 'visible' },
  fill:  { width: 6, borderRadius: 3 },
  thumb: { position: 'absolute', left: -3, width: 12, height: 12, borderRadius: 6 },
  label: { fontSize: 9, fontFamily: 'Inter_500Medium', color: '#6B7A6D', textTransform: 'uppercase', letterSpacing: 0.3 },
  val:   { fontSize: 10, fontFamily: 'Inter_700Bold' },
});

// ─── Tool button ──────────────────────────────────────────────────────────────
function ToolBtn({ icon, label, active, onPress }: { icon: string; label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[tbStyles.btn, active && tbStyles.btnActive]} onPress={onPress} activeOpacity={0.75}>
      <Feather name={icon as any} size={18} color={active ? ACCENT : FG} />
      <Text style={[tbStyles.label, active && { color: ACCENT }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const tbStyles = StyleSheet.create({
  btn:       { alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 6, borderRadius: 10, minWidth: 46 },
  btnActive: { backgroundColor: GREEN_DIM },
  label:     { fontSize: 9, fontFamily: 'Inter_500Medium', color: FG, letterSpacing: 0.2 },
});

// ─── Main styles ──────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },

  // Top bar
  topBar:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 10, backgroundColor: SURFACE, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 8 },
  topLeft:  { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  topBtn:   { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  topBtnActive: { backgroundColor: GREEN_DIM },
  topTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: FG, flex: 1 },
  topDivider: { width: 1, height: 20, backgroundColor: BORDER, marginHorizontal: 2 },
  colorSwatch: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  colorSwatchActive: { borderColor: ACCENT },
  eraserX: { position: 'absolute' },

  // Panels
  panel:     { backgroundColor: SURFACE, borderBottomWidth: 1, borderBottomColor: BORDER, paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  panelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  panelTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5 },
  panelAddBtn: { width: 28, height: 28, borderRadius: 8, backgroundColor: GREEN_DIM, alignItems: 'center', justifyContent: 'center' },

  // Brush chips
  brushChip:       { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: SURFACE2, borderWidth: 1, borderColor: BORDER },
  brushChipActive: { borderColor: ACCENT, backgroundColor: GREEN_DIM },
  brushChipText:   { fontSize: 12, fontFamily: 'Inter_500Medium', color: FG },

  // Layers
  layerRow:       { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 10 },
  layerRowActive: { backgroundColor: GREEN_DIM },
  layerThumb:     { width: 36, height: 36, borderRadius: 6, backgroundColor: SURFACE2, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  layerName:      { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: FG },
  layerSub:       { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },
  layerIconBtn:   { padding: 4 },

  // Color picker
  paletteGrid:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  paletteSwatch:      { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: 'transparent' },
  paletteSwatchActive:{ borderColor: ACCENT, transform: [{ scale: 1.15 }] },
  hexRow:             { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: SURFACE2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  hexLabel:           { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: MUTED },
  hexInput:           { flex: 1, fontSize: 14, fontFamily: 'Inter_700Bold', color: FG },
  hexPreview:         { width: 24, height: 24, borderRadius: 12 },
  hexQuickRow:        { flexDirection: 'row', gap: 10 },
  hexQuick:           { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: BORDER },

  // Canvas
  canvasArea:   { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1A1C1A' },
  canvas:       { backgroundColor: '#FFFFFF', overflow: 'hidden' },
  lockedOverlay:{ ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)', gap: 8 },
  lockedText:   { fontSize: 13, fontFamily: 'Inter_500Medium', color: MUTED },

  // Floating left
  floatLeft:    { position: 'absolute', left: 8, justifyContent: 'center', gap: 4, paddingVertical: 12 },

  // Bottom bar
  bottomBar:   { backgroundColor: SURFACE, borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 8, paddingHorizontal: 8, gap: 6 },
  toolRow:     { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  actionsRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  actionBtn:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED },
  canvasInfo:  { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center', flex: 1 },
  saveBtn:     { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: ACCENT, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  saveBtnText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: BG },

  // Text modal
  textModalOverlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  textModalCard:       { backgroundColor: SURFACE, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: BORDER, padding: 20, gap: 14 },
  textModalTitle:      { fontSize: 16, fontFamily: 'Inter_700Bold', color: FG },
  textModalInput:      { backgroundColor: '#0D0E0D', borderRadius: 12, borderWidth: 1, borderColor: BORDER, padding: 14, fontSize: 16, fontFamily: 'Inter_400Regular', minHeight: 80, textAlignVertical: 'top' },
  textColorRow:        { flexDirection: 'row', gap: 10 },
  textColorDot:        { width: 28, height: 28, borderRadius: 14 },
  textColorDotActive:  { borderWidth: 2.5, borderColor: ACCENT },
  textModalActions:    { flexDirection: 'row', gap: 10 },
  textModalCancel:     { flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: BORDER, alignItems: 'center' },
  textModalCancelText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: MUTED },
  textModalDone:       { flex: 2, paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  textModalDoneText:   { fontSize: 14, fontFamily: 'Inter_700Bold', color: BG },
});
