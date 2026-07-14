/**
 * Brandthread Design Studio — Main Canvas Editor
 * Route: /design-canvas?id=<projectId>
 */
import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, PanResponder,
  Alert, ScrollView, TextInput, Modal, Dimensions, Image,
} from 'react-native';
import Svg, { Path, Rect, Circle, G, Line, Text as SvgText } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import {
  BG, SURFACE, CARD, CARD_ELEVATED,
  BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE,
  PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM,
  SUCCESS,
  RED,
  FONT, FS, SP, RADIUS, ICON,
  GRAD_PRIMARY,
} from '@/lib/theme';
import {
  getProject, autosaveProject, addLayer, updateLayer,
  deleteLayer as svcDeleteLayer, reorderLayers,
  toggleLayerVisibility, toggleLayerLock,
  duplicateLayer as svcDuplicateLayer,
  createVersion, exportProject,
} from '@/services/designService';
import type {
  DesignProject, DesignLayer, DesignLayerData,
  DesignTextLayer, DesignImageLayer, DesignShapeLayer, DesignDrawingLayer,
  DrawPath, DesignTransform, DEFAULT_TRANSFORM,
} from '@/services/designTypes';

// ─── Tool type ────────────────────────────────────────────────────────────────
type ActiveTool = 'select' | 'add' | 'text' | 'image' | 'draw' | 'layers' | 'color';

const FONT_FAMILIES = ['System', 'serif', 'monospace', 'Inter_400Regular', 'Georgia'];

const DRAW_BRUSHES = [
  { name: 'Pencil',    widthMult: 0.7, opacityMult: 1.0 },
  { name: 'Marker',    widthMult: 2.0, opacityMult: 0.85 },
  { name: 'Pen',       widthMult: 1.0, opacityMult: 1.0 },
  { name: 'Airbrush',  widthMult: 3.5, opacityMult: 0.35 },
  { name: 'Eraser',    widthMult: 4.0, opacityMult: 1.0 },
];

const DEFAULT_PALETTE = [
  '#FFFFFF', '#000000', '#EF4444', '#F97316', '#EAB308',
  '#22C55E', '#0EA5E9', '#8B5CF6', '#EC4899', '#6B7280',
  '#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF', '#FF6FC8',
  '#C084FC', '#34D399', '#FBBF24', '#F472B6', '#A78BFA',
];

const GARMENT_COLORS = [
  '#000000','#FFFFFF','#1E3A5F','#6B7280','#EF4444',
  '#22C55E','#3B82F6','#EAB308','#F97316','#EC4899',
  '#8B5CF6','#F5E6C8',
];

let _uid = 0;
function uid(): string { return `uid_${Date.now()}_${++_uid}`; }

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function DesignCanvasScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const projectId = params.id ?? '';

  // ── Project state ──────────────────────────────────────────────────────────
  const [project, setProject] = useState<DesignProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [projectName, setProjectName] = useState('Untitled');
  const [editingName, setEditingName] = useState(false);
  const [layers, setLayers] = useState<DesignLayer[]>([]);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'unsaved' | 'saving'>('saved');

  // ── Undo/Redo ──────────────────────────────────────────────────────────────
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);

  function pushUndo(currentLayers: DesignLayer[]) {
    undoStack.current = [...undoStack.current.slice(-49), JSON.stringify(currentLayers)];
    redoStack.current = [];
  }

  function handleUndo() {
    if (undoStack.current.length === 0) return;
    const snap = undoStack.current[undoStack.current.length - 1];
    redoStack.current = [...redoStack.current, JSON.stringify(layers)];
    undoStack.current = undoStack.current.slice(0, -1);
    setLayers(JSON.parse(snap));
    setSaveStatus('unsaved');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function handleRedo() {
    if (redoStack.current.length === 0) return;
    const snap = redoStack.current[redoStack.current.length - 1];
    undoStack.current = [...undoStack.current, JSON.stringify(layers)];
    redoStack.current = redoStack.current.slice(0, -1);
    setLayers(JSON.parse(snap));
    setSaveStatus('unsaved');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  // ── Tool state ─────────────────────────────────────────────────────────────
  const [activeTool, setActiveTool] = useState<ActiveTool>('select');
  const [bottomSheet, setBottomSheet] = useState<ActiveTool | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);

  // ── Canvas geometry ────────────────────────────────────────────────────────
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(false);
  const [showGuides, setShowGuides] = useState(false);

  // ── Draw tool state ────────────────────────────────────────────────────────
  const [drawColor, setDrawColor] = useState('#FFFFFF');
  const [drawBrushIdx, setDrawBrushIdx] = useState(0);
  const [drawBrushSize, setDrawBrushSize] = useState(8);
  const [drawOpacity, setDrawOpacity] = useState(1.0);
  const [currentPath, setCurrentPath] = useState('');
  const drawPointsRef = useRef<string[]>([]);
  const drawColorRef = useRef(drawColor);
  const drawBrushIdxRef = useRef(drawBrushIdx);
  const drawBrushSizeRef = useRef(drawBrushSize);
  const drawOpacityRef = useRef(drawOpacity);
  const activeToolRef = useRef(activeTool);
  const activeLayerIdRef = useRef<string | null>(null);
  const layersRef = useRef(layers);

  drawColorRef.current = drawColor;
  drawBrushIdxRef.current = drawBrushIdx;
  drawBrushSizeRef.current = drawBrushSize;
  drawOpacityRef.current = drawOpacity;
  activeToolRef.current = activeTool;
  layersRef.current = layers;

  // ── Text tool state ────────────────────────────────────────────────────────
  const [textContent, setTextContent] = useState('');
  const [textFontFamily, setTextFontFamily] = useState('System');
  const [textFontSize, setTextFontSize] = useState(24);
  const [textBold, setTextBold] = useState(false);
  const [textItalic, setTextItalic] = useState(false);
  const [textUnderline, setTextUnderline] = useState(false);
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>('center');
  const [textColor, setTextColor] = useState('#FFFFFF');

  // ── Color picker state ─────────────────────────────────────────────────────
  const [pickerHex, setPickerHex] = useState('FFFFFF');

  // ─── Load project ──────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      if (!projectId) { setLoading(false); return; }
      const proj = await getProject(projectId);
      if (!proj) {
        Alert.alert('Not found', 'Project not found.', [{ text: 'OK', onPress: () => router.back() }]);
        return;
      }
      setProject(proj);
      setProjectName(proj.name);
      setLayers(proj.layers);
      setLoading(false);
    })();
  }, [projectId]);

  // ─── Autosave every 30s ────────────────────────────────────────────────────
  useEffect(() => {
    if (!project) return;
    const interval = setInterval(async () => {
      if (saveStatus === 'unsaved') {
        setSaveStatus('saving');
        await autosaveProject({ ...project, layers });
        setSaveStatus('saved');
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [project, layers, saveStatus]);

  // ─── PanResponder for draw tool ────────────────────────────────────────────
  const drawPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => activeToolRef.current === 'draw',
      onMoveShouldSetPanResponder: () => activeToolRef.current === 'draw',
      onPanResponderGrant: (e) => {
        const { locationX: x, locationY: y } = e.nativeEvent;
        drawPointsRef.current = [`M${x.toFixed(1)},${y.toFixed(1)}`];
        setCurrentPath(drawPointsRef.current.join(' '));
      },
      onPanResponderMove: (e) => {
        const { locationX: x, locationY: y } = e.nativeEvent;
        drawPointsRef.current.push(`L${x.toFixed(1)},${y.toFixed(1)}`);
        setCurrentPath(drawPointsRef.current.join(' '));
      },
      onPanResponderRelease: () => {
        if (drawPointsRef.current.length < 2) {
          drawPointsRef.current = []; setCurrentPath(''); return;
        }
        const brush = DRAW_BRUSHES[drawBrushIdxRef.current];
        const newPath: DrawPath = {
          d: drawPointsRef.current.join(' '),
          color: brush.name === 'Eraser' ? 'erase' : drawColorRef.current,
          width: drawBrushSizeRef.current * brush.widthMult,
          opacity: drawOpacityRef.current * brush.opacityMult,
          tool: brush.name,
        };
        const current = layersRef.current;
        pushUndo(current);

        // Find or create a drawing layer
        const existingDrawLayer = current.find(l => l.type === 'drawing' && !l.locked);
        if (existingDrawLayer) {
          const updatedData = existingDrawLayer.data as DesignDrawingLayer;
          const newLayers = current.map(l =>
            l.id === existingDrawLayer.id
              ? { ...l, data: { ...updatedData, paths: [...updatedData.paths, newPath] } }
              : l
          );
          setLayers(newLayers);
          activeLayerIdRef.current = existingDrawLayer.id;
        } else {
          const maxOrder = current.reduce((m, l) => Math.max(m, l.order), 0);
          const newLayer: DesignLayer = {
            id: uid(),
            name: 'Drawing',
            type: 'drawing',
            visible: true,
            locked: false,
            order: maxOrder + 1,
            transform: { x: 0, y: 0, width: canvasSize.w, height: canvasSize.h, rotation: 0, scaleX: 1, scaleY: 1 },
            data: { kind: 'drawing', paths: [newPath], brushType: brush.name } as DesignDrawingLayer,
            opacity: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          setLayers(prev => [...prev, newLayer]);
          activeLayerIdRef.current = newLayer.id;
        }
        drawPointsRef.current = [];
        setCurrentPath('');
        setSaveStatus('unsaved');
      },
    })
  ).current;

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function openTool(tool: ActiveTool) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveTool(tool);
    setBottomSheet(tool);
  }

  function closeSheet() { setBottomSheet(null); }

  function mutateLayer(updater: (prev: DesignLayer[]) => DesignLayer[]) {
    setLayers(prev => {
      pushUndo(prev);
      return updater(prev);
    });
    setSaveStatus('unsaved');
  }

  function handleAddText() {
    if (!textContent.trim()) return;
    const maxOrder = layers.reduce((m, l) => Math.max(m, l.order), 0);
    const newLayer: DesignLayer = {
      id: uid(),
      name: 'Text',
      type: 'text',
      visible: true,
      locked: false,
      order: maxOrder + 1,
      transform: { x: 50, y: 100, width: 280, height: 60, rotation: 0, scaleX: 1, scaleY: 1 },
      data: {
        kind: 'text',
        content: textContent,
        fontFamily: textFontFamily,
        fontSize: textFontSize,
        bold: textBold,
        italic: textItalic,
        underline: textUnderline,
        align: textAlign,
        color: textColor,
        letterSpacing: 0,
        lineHeight: 1.4,
      } as DesignTextLayer,
      opacity: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mutateLayer(prev => [...prev, newLayer]);
    setSelectedLayerId(newLayer.id);
    setTextContent('');
    closeSheet();
  }

  async function handleAddImage() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const maxOrder = layers.reduce((m, l) => Math.max(m, l.order), 0);
    const newLayer: DesignLayer = {
      id: uid(),
      name: 'Image',
      type: 'image',
      visible: true,
      locked: false,
      order: maxOrder + 1,
      transform: { x: 50, y: 50, width: 200, height: 200, rotation: 0, scaleX: 1, scaleY: 1 },
      data: { kind: 'image', uri: asset.uri, opacity: 1, fit: 'contain' } as DesignImageLayer,
      opacity: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mutateLayer(prev => [...prev, newLayer]);
    setSelectedLayerId(newLayer.id);
    closeSheet();
  }

  function handleAddShape(shape: 'rect' | 'circle' | 'triangle') {
    const maxOrder = layers.reduce((m, l) => Math.max(m, l.order), 0);
    const newLayer: DesignLayer = {
      id: uid(),
      name: shape.charAt(0).toUpperCase() + shape.slice(1),
      type: 'shape',
      visible: true,
      locked: false,
      order: maxOrder + 1,
      transform: { x: 80, y: 80, width: 120, height: 120, rotation: 0, scaleX: 1, scaleY: 1 },
      data: { kind: 'shape', shape, fill: PURPLE, stroke: 'transparent', strokeWidth: 0, cornerRadius: 8 } as DesignShapeLayer,
      opacity: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mutateLayer(prev => [...prev, newLayer]);
    setSelectedLayerId(newLayer.id);
    closeSheet();
  }

  function handleDeleteSelected() {
    if (!selectedLayerId) return;
    mutateLayer(prev => prev.filter(l => l.id !== selectedLayerId));
    setSelectedLayerId(null);
  }

  function handleDuplicateSelected() {
    if (!selectedLayerId) return;
    const src = layers.find(l => l.id === selectedLayerId);
    if (!src) return;
    const maxOrder = layers.reduce((m, l) => Math.max(m, l.order), 0);
    const dup: DesignLayer = {
      ...src,
      id: uid(),
      name: src.name + ' copy',
      order: maxOrder + 1,
      transform: { ...src.transform, x: src.transform.x + 20, y: src.transform.y + 20 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mutateLayer(prev => [...prev, dup]);
    setSelectedLayerId(dup.id);
  }

  function handleBringForward() {
    if (!selectedLayerId) return;
    mutateLayer(prev => {
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex(l => l.id === selectedLayerId);
      if (idx < sorted.length - 1) {
        const a = sorted[idx].order;
        const b = sorted[idx + 1].order;
        sorted[idx] = { ...sorted[idx], order: b };
        sorted[idx + 1] = { ...sorted[idx + 1], order: a };
      }
      return sorted;
    });
  }

  function handleSendBack() {
    if (!selectedLayerId) return;
    mutateLayer(prev => {
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex(l => l.id === selectedLayerId);
      if (idx > 0) {
        const a = sorted[idx].order;
        const b = sorted[idx - 1].order;
        sorted[idx] = { ...sorted[idx], order: b };
        sorted[idx - 1] = { ...sorted[idx - 1], order: a };
      }
      return sorted;
    });
  }

  async function handleManualSave() {
    if (!project) return;
    setSaveStatus('saving');
    await createVersion(project.id);
    await autosaveProject({ ...project, layers, status: 'saved' });
    setSaveStatus('saved');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  function handleMoreMenu() {
    Alert.alert('Options', '', [
      { text: 'Export', onPress: () => exportProject(project?.id ?? '', 'png').then(() => Alert.alert('Exported', 'Project exported successfully.')) },
      { text: 'Preview Mockup', onPress: () => Alert.alert('Preview', 'Mockup preview coming soon.') },
      { text: 'Version History', onPress: () => Alert.alert('Versions', `${project?.versions?.length ?? 0} versions saved.`) },
      { text: 'Project Settings', onPress: () => Alert.alert('Settings', 'Project settings coming soon.') },
      { text: 'Share', onPress: () => Alert.alert('Share', 'Share coming soon.') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function handleBack() {
    if (saveStatus === 'unsaved' && project) {
      await autosaveProject({ ...project, layers });
    }
    router.back();
  }

  // ─── Render layers on canvas ───────────────────────────────────────────────
  const sortedLayers = [...layers].sort((a, b) => a.order - b.order);
  const selectedLayer = layers.find(l => l.id === selectedLayerId);

  if (loading) {
    return (
      <View style={[ss.root, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: MUTED, fontFamily: FONT.regular, fontSize: FS.base }}>Loading…</Text>
      </View>
    );
  }

  return (
    <View style={ss.root}>
      {/* ── TOP BAR ── */}
      <View style={[ss.topBar, { paddingTop: insets.top + 4 }]}>
        <TouchableOpacity style={ss.topBtn} onPress={handleBack}>
          <Feather name="chevron-left" size={ICON.md} color={FG} />
        </TouchableOpacity>

        {editingName ? (
          <TextInput
            style={ss.nameInput}
            value={projectName}
            onChangeText={setProjectName}
            onBlur={() => { setEditingName(false); if (project) autosaveProject({ ...project, name: projectName, layers }); }}
            autoFocus
            selectTextOnFocus
          />
        ) : (
          <TouchableOpacity onPress={() => setEditingName(true)} style={{ flex: 1 }}>
            <Text style={ss.topTitle} numberOfLines={1}>{projectName || 'Untitled'}</Text>
          </TouchableOpacity>
        )}

        <View style={ss.topRight}>
          <TouchableOpacity style={ss.topBtn} onPress={handleUndo} disabled={undoStack.current.length === 0}>
            <Feather name="corner-up-left" size={ICON.sm} color={undoStack.current.length === 0 ? SUBTLE : FG} />
          </TouchableOpacity>
          <TouchableOpacity style={ss.topBtn} onPress={handleRedo} disabled={redoStack.current.length === 0}>
            <Feather name="corner-up-right" size={ICON.sm} color={redoStack.current.length === 0 ? SUBTLE : FG} />
          </TouchableOpacity>
          <TouchableOpacity style={[ss.topBtn, ss.saveBtn]} onPress={handleManualSave}>
            <Feather name="save" size={ICON.sm} color={saveStatus === 'saving' ? MUTED : PURPLE_LIGHT} />
          </TouchableOpacity>
          <TouchableOpacity style={ss.topBtn} onPress={handleMoreMenu}>
            <Feather name="more-horizontal" size={ICON.md} color={FG} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── SELECTION MINI TOOLBAR ── */}
      {selectedLayer && activeTool === 'select' && (
        <View style={ss.selectionBar}>
          <TouchableOpacity style={ss.selBtn} onPress={handleDeleteSelected}>
            <Feather name="trash-2" size={14} color={RED} />
            <Text style={[ss.selBtnText, { color: RED }]}>Delete</Text>
          </TouchableOpacity>
          <TouchableOpacity style={ss.selBtn} onPress={handleDuplicateSelected}>
            <Feather name="copy" size={14} color={FG} />
            <Text style={ss.selBtnText}>Duplicate</Text>
          </TouchableOpacity>
          <TouchableOpacity style={ss.selBtn} onPress={handleBringForward}>
            <Feather name="arrow-up" size={14} color={FG} />
            <Text style={ss.selBtnText}>Forward</Text>
          </TouchableOpacity>
          <TouchableOpacity style={ss.selBtn} onPress={handleSendBack}>
            <Feather name="arrow-down" size={14} color={FG} />
            <Text style={ss.selBtnText}>Back</Text>
          </TouchableOpacity>
          <TouchableOpacity style={ss.selBtn} onPress={() => mutateLayer(prev => prev.map(l => l.id === selectedLayerId ? { ...l, locked: !l.locked } : l))}>
            <Feather name={selectedLayer.locked ? 'lock' : 'unlock'} size={14} color={CYAN} />
            <Text style={[ss.selBtnText, { color: CYAN }]}>{selectedLayer.locked ? 'Unlock' : 'Lock'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── CANVAS AREA ── */}
      <View
        style={ss.canvasArea}
        onLayout={e => {
          const { width, height } = e.nativeEvent.layout;
          setCanvasSize({ w: width, h: height });
        }}
        {...drawPanResponder.panHandlers}
      >
        {/* Grid overlay */}
        {showGrid && canvasSize.w > 0 && (
          <Svg style={StyleSheet.absoluteFill} width={canvasSize.w} height={canvasSize.h} pointerEvents="none">
            {Array.from({ length: Math.floor(canvasSize.w / 40) + 1 }, (_, i) => (
              <Line key={`vg${i}`} x1={i * 40} y1={0} x2={i * 40} y2={canvasSize.h} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
            ))}
            {Array.from({ length: Math.floor(canvasSize.h / 40) + 1 }, (_, i) => (
              <Line key={`hg${i}`} x1={0} y1={i * 40} x2={canvasSize.w} y2={i * 40} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
            ))}
          </Svg>
        )}

        {/* Guides overlay */}
        {showGuides && canvasSize.w > 0 && (
          <Svg style={StyleSheet.absoluteFill} width={canvasSize.w} height={canvasSize.h} pointerEvents="none">
            <Rect
              x={canvasSize.w * 0.05}
              y={canvasSize.h * 0.05}
              width={canvasSize.w * 0.9}
              height={canvasSize.h * 0.9}
              fill="none"
              stroke="rgba(34,211,238,0.3)"
              strokeWidth={1}
              strokeDasharray="6,4"
            />
          </Svg>
        )}

        {/* Layers rendered on canvas */}
        <Svg style={StyleSheet.absoluteFill} width={canvasSize.w} height={canvasSize.h} pointerEvents="none">
          {sortedLayers.map(layer => {
            if (!layer.visible) return null;
            const t = layer.transform;
            if (layer.type === 'drawing') {
              const d = layer.data as DesignDrawingLayer;
              return (
                <G key={layer.id} opacity={layer.opacity}>
                  {d.paths.map((path, pi) => (
                    <Path
                      key={pi}
                      d={path.d}
                      stroke={path.color === 'erase' ? '#12121F' : path.color}
                      strokeWidth={path.width}
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={path.opacity}
                    />
                  ))}
                </G>
              );
            }
            if (layer.type === 'shape') {
              const d = layer.data as DesignShapeLayer;
              if (d.shape === 'circle') {
                return (
                  <Circle key={layer.id} cx={t.x + t.width / 2} cy={t.y + t.height / 2}
                    r={Math.min(t.width, t.height) / 2} fill={d.fill} stroke={d.stroke} strokeWidth={d.strokeWidth} opacity={layer.opacity} />
                );
              }
              return (
                <Rect key={layer.id} x={t.x} y={t.y} width={t.width} height={t.height}
                  rx={d.cornerRadius} fill={d.fill} stroke={d.stroke} strokeWidth={d.strokeWidth} opacity={layer.opacity} />
              );
            }
            if (layer.type === 'text') {
              const d = layer.data as DesignTextLayer;
              return (
                <SvgText key={layer.id} x={t.x + t.width / 2} y={t.y + d.fontSize}
                  fill={d.color} fontSize={d.fontSize} textAnchor="middle"
                  fontWeight={d.bold ? 'bold' : 'normal'} fontStyle={d.italic ? 'italic' : 'normal'}
                  opacity={layer.opacity}>
                  {d.content}
                </SvgText>
              );
            }
            return null;
          })}

          {/* Current draw stroke */}
          {currentPath !== '' && (
            <Path
              d={currentPath}
              stroke={DRAW_BRUSHES[drawBrushIdx].name === 'Eraser' ? '#12121F' : drawColor}
              strokeWidth={drawBrushSize * DRAW_BRUSHES[drawBrushIdx].widthMult}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={drawOpacity * DRAW_BRUSHES[drawBrushIdx].opacityMult}
            />
          )}

          {/* Selection handles */}
          {selectedLayer && activeTool === 'select' && (() => {
            const t = selectedLayer.transform;
            return (
              <G>
                <Rect x={t.x - 4} y={t.y - 4} width={t.width + 8} height={t.height + 8}
                  fill="none" stroke={PURPLE} strokeWidth={1.5} strokeDasharray="5,3" />
                {[[t.x - 4, t.y - 4], [t.x + t.width / 2, t.y - 4], [t.x + t.width + 4, t.y - 4],
                  [t.x - 4, t.y + t.height / 2], [t.x + t.width + 4, t.y + t.height / 2],
                  [t.x - 4, t.y + t.height + 4], [t.x + t.width / 2, t.y + t.height + 4], [t.x + t.width + 4, t.y + t.height + 4]]
                  .map(([hx, hy], hi) => (
                    <Rect key={hi} x={hx - 4} y={hy - 4} width={8} height={8} rx={2}
                      fill={CARD_ELEVATED} stroke={PURPLE} strokeWidth={1.5} />
                  ))}
              </G>
            );
          })()}
        </Svg>

        {/* Image layers rendered as React Native Image (on top of SVG) */}
        {sortedLayers.map(layer => {
          if (!layer.visible || layer.type !== 'image') return null;
          const d = layer.data as DesignImageLayer;
          const t = layer.transform;
          return (
            <TouchableOpacity
              key={layer.id}
              activeOpacity={0.9}
              onPress={() => { if (activeTool === 'select') setSelectedLayerId(layer.id); }}
              style={[ss.imageLayer, {
                left: t.x, top: t.y, width: t.width, height: t.height,
                opacity: layer.opacity * (d.opacity ?? 1),
                transform: [{ rotate: `${t.transform?.rotation ?? 0}deg` }],
              }]}
            >
              <Image source={{ uri: d.uri }} style={{ width: '100%', height: '100%' }} resizeMode={d.fit as any} />
            </TouchableOpacity>
          );
        })}

        {/* Overlay controls row */}
        <View style={ss.canvasOverlayRow}>
          <TouchableOpacity style={[ss.overlayBtn, showGrid && ss.overlayBtnActive]} onPress={() => setShowGrid(v => !v)}>
            <Feather name="grid" size={14} color={showGrid ? CYAN : MUTED} />
          </TouchableOpacity>
          <TouchableOpacity style={[ss.overlayBtn, showGuides && ss.overlayBtnActive]} onPress={() => setShowGuides(v => !v)}>
            <Feather name="maximize" size={14} color={showGuides ? CYAN : MUTED} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── BOTTOM TOOLBAR ── */}
      <View style={[ss.bottomBar, { paddingBottom: insets.bottom + 4 }]}>
        {(
          [
            { key: 'select', icon: 'mouse-pointer', label: 'Select' },
            { key: 'add',    icon: 'plus-square',   label: 'Add' },
            { key: 'text',   icon: 'type',           label: 'Text' },
            { key: 'image',  icon: 'image',          label: 'Image' },
            { key: 'draw',   icon: 'edit-2',         label: 'Draw' },
            { key: 'layers', icon: 'layers',         label: 'Layers' },
            { key: 'color',  icon: 'droplet',        label: 'Color' },
          ] as { key: ActiveTool; icon: string; label: string }[]
        ).map(({ key, icon, label }) => (
          <TouchableOpacity
            key={key}
            style={[ss.toolBtn, activeTool === key && ss.toolBtnActive]}
            onPress={() => openTool(key)}
            activeOpacity={0.75}
          >
            <Feather name={icon as any} size={ICON.md} color={activeTool === key ? PURPLE_LIGHT : MUTED} />
            <Text style={[ss.toolLabel, activeTool === key && { color: PURPLE_LIGHT }]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── BOTTOM SHEETS ── */}

      {/* ADD SHEET */}
      <Modal visible={bottomSheet === 'add'} transparent animationType="slide" onRequestClose={closeSheet}>
        <TouchableOpacity style={ss.modalOverlay} activeOpacity={1} onPress={closeSheet}>
          <View style={ss.sheet}>
            <SheetHandle />
            <Text style={ss.sheetTitle}>Add to Canvas</Text>
            <View style={ss.addGrid}>
              {[
                { label: 'Text',          icon: 'type',         onPress: () => { closeSheet(); setActiveTool('text'); setBottomSheet('text'); } },
                { label: 'Image',         icon: 'image',        onPress: () => { closeSheet(); handleAddImage(); } },
                { label: 'Rectangle',     icon: 'square',       onPress: () => handleAddShape('rect') },
                { label: 'Circle',        icon: 'circle',       onPress: () => handleAddShape('circle') },
                { label: 'Triangle',      icon: 'triangle',     onPress: () => handleAddShape('triangle') },
                { label: 'Logo',          icon: 'award',        onPress: () => Alert.alert('Coming Soon', 'Brand logo insert coming soon.') },
                { label: 'Sticker',       icon: 'smile',        onPress: () => Alert.alert('Coming Soon', 'Stickers coming soon.') },
                { label: 'Product Badge', icon: 'tag',          onPress: () => Alert.alert('Coming Soon', 'Product badge coming soon.') },
                { label: 'Price Label',   icon: 'dollar-sign',  onPress: () => Alert.alert('Coming Soon', 'Price label coming soon.') },
                { label: 'QR Code',       icon: 'maximize',     onPress: () => Alert.alert('Coming Soon', 'QR code coming soon.') },
                { label: 'Brand Asset',   icon: 'star',         onPress: () => { closeSheet(); router.push('/design-brand-assets'); } },
              ].map(item => (
                <TouchableOpacity key={item.label} style={ss.addItem} onPress={item.onPress} activeOpacity={0.8}>
                  <View style={ss.addItemIcon}>
                    <Feather name={item.icon as any} size={ICON.md} color={PURPLE_LIGHT} />
                  </View>
                  <Text style={ss.addItemLabel}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* TEXT SHEET */}
      <Modal visible={bottomSheet === 'text'} transparent animationType="slide" onRequestClose={closeSheet}>
        <TouchableOpacity style={ss.modalOverlay} activeOpacity={1} onPress={closeSheet}>
          <View style={[ss.sheet, { maxHeight: '85%' }]}>
            <SheetHandle />
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={ss.sheetTitle}>Text</Text>
              <TextInput
                style={ss.textInput}
                value={textContent}
                onChangeText={setTextContent}
                placeholder="Type something…"
                placeholderTextColor={SUBTLE}
                multiline
              />

              {/* Font family */}
              <Text style={ss.sheetLabel}>Font</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: SP.sm }}>
                {FONT_FAMILIES.map(ff => (
                  <TouchableOpacity key={ff} style={[ss.fontChip, textFontFamily === ff && ss.fontChipActive]}
                    onPress={() => setTextFontFamily(ff)}>
                    <Text style={[ss.fontChipText, textFontFamily === ff && { color: PURPLE_LIGHT }]}>{ff}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Font size */}
              <Text style={ss.sheetLabel}>Size: {textFontSize}pt</Text>
              <View style={ss.sliderRow}>
                <TouchableOpacity onPress={() => setTextFontSize(v => Math.max(8, v - 2))}>
                  <Feather name="minus" size={ICON.sm} color={FG} />
                </TouchableOpacity>
                <View style={ss.sliderTrack}>
                  <View style={[ss.sliderFill, { width: `${((textFontSize - 8) / 192) * 100}%` }]} />
                </View>
                <TouchableOpacity onPress={() => setTextFontSize(v => Math.min(200, v + 2))}>
                  <Feather name="plus" size={ICON.sm} color={FG} />
                </TouchableOpacity>
              </View>

              {/* Style toggles */}
              <View style={ss.toggleRow}>
                {[
                  { label: 'B', active: textBold, onPress: () => setTextBold(v => !v) },
                  { label: 'I', active: textItalic, onPress: () => setTextItalic(v => !v) },
                  { label: 'U', active: textUnderline, onPress: () => setTextUnderline(v => !v) },
                ].map(t => (
                  <TouchableOpacity key={t.label} style={[ss.toggleBtn, t.active && ss.toggleBtnActive]} onPress={t.onPress}>
                    <Text style={[ss.toggleBtnText, t.active && { color: PURPLE_LIGHT }]}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
                {(['left', 'center', 'right'] as const).map(a => (
                  <TouchableOpacity key={a} style={[ss.toggleBtn, textAlign === a && ss.toggleBtnActive]} onPress={() => setTextAlign(a)}>
                    <Feather name={`align-${a}` as any} size={14} color={textAlign === a ? PURPLE_LIGHT : MUTED} />
                  </TouchableOpacity>
                ))}
              </View>

              {/* Color */}
              <Text style={ss.sheetLabel}>Color</Text>
              <View style={ss.paletteRow}>
                {DEFAULT_PALETTE.slice(0, 10).map(c => (
                  <TouchableOpacity key={c} style={[ss.paletteDot, { backgroundColor: c }, textColor === c && ss.paletteDotActive]}
                    onPress={() => setTextColor(c)} />
                ))}
              </View>

              <TouchableOpacity style={ss.addBtn} onPress={handleAddText}>
                <Text style={ss.addBtnText}>Add to Canvas</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* IMAGE SHEET */}
      <Modal visible={bottomSheet === 'image'} transparent animationType="slide" onRequestClose={closeSheet}>
        <TouchableOpacity style={ss.modalOverlay} activeOpacity={1} onPress={closeSheet}>
          <View style={ss.sheet}>
            <SheetHandle />
            <Text style={ss.sheetTitle}>Image</Text>
            <TouchableOpacity style={ss.uploadBtn} onPress={handleAddImage}>
              <Feather name="upload" size={ICON.lg} color={PURPLE_LIGHT} />
              <Text style={ss.uploadBtnText}>Upload Image</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* DRAW SHEET */}
      <Modal visible={bottomSheet === 'draw'} transparent animationType="slide" onRequestClose={closeSheet}>
        <TouchableOpacity style={ss.modalOverlay} activeOpacity={1} onPress={closeSheet}>
          <View style={ss.sheet}>
            <SheetHandle />
            <Text style={ss.sheetTitle}>Draw</Text>

            {/* Brush types */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: SP.md }}>
              {DRAW_BRUSHES.map((b, i) => (
                <TouchableOpacity key={b.name} style={[ss.brushChip, drawBrushIdx === i && ss.brushChipActive]}
                  onPress={() => setDrawBrushIdx(i)}>
                  <Text style={[ss.brushChipText, drawBrushIdx === i && { color: PURPLE_LIGHT }]}>{b.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Brush size */}
            <Text style={ss.sheetLabel}>Brush Size: {drawBrushSize}px</Text>
            <View style={ss.sliderRow}>
              <TouchableOpacity onPress={() => setDrawBrushSize(v => Math.max(1, v - 1))}>
                <Feather name="minus" size={ICON.sm} color={FG} />
              </TouchableOpacity>
              <View style={ss.sliderTrack}>
                <View style={[ss.sliderFill, { width: `${((drawBrushSize - 1) / 79) * 100}%` }]} />
              </View>
              <TouchableOpacity onPress={() => setDrawBrushSize(v => Math.min(80, v + 1))}>
                <Feather name="plus" size={ICON.sm} color={FG} />
              </TouchableOpacity>
            </View>

            {/* Color */}
            <Text style={ss.sheetLabel}>Color</Text>
            <View style={ss.paletteRow}>
              {DEFAULT_PALETTE.slice(0, 10).map(c => (
                <TouchableOpacity key={c} style={[ss.paletteDot, { backgroundColor: c }, drawColor === c && ss.paletteDotActive]}
                  onPress={() => { setDrawColor(c); setPickerHex(c.replace('#', '')); }} />
              ))}
            </View>

            <TouchableOpacity style={ss.addBtn} onPress={closeSheet}>
              <Text style={ss.addBtnText}>Start Drawing</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* LAYERS SHEET */}
      <Modal visible={bottomSheet === 'layers'} transparent animationType="slide" onRequestClose={closeSheet}>
        <TouchableOpacity style={ss.modalOverlay} activeOpacity={1} onPress={closeSheet}>
          <View style={[ss.sheet, { maxHeight: '75%' }]}>
            <SheetHandle />
            <View style={ss.sheetHeaderRow}>
              <Text style={ss.sheetTitle}>Layers</Text>
              <TouchableOpacity style={ss.sheetAddBtn} onPress={() => {
                Alert.alert('Add Layer', 'Choose layer type', [
                  { text: 'Drawing Layer', onPress: () => { handleAddShape('rect'); } },
                  { text: 'Cancel', style: 'cancel' },
                ]);
              }}>
                <Feather name="plus" size={ICON.sm} color={PURPLE_LIGHT} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {[...layers].sort((a, b) => b.order - a.order).map(layer => (
                <View key={layer.id} style={[ss.layerRow, layer.id === selectedLayerId && ss.layerRowActive]}>
                  <TouchableOpacity onPress={() => { setSelectedLayerId(layer.id); closeSheet(); setActiveTool('select'); }} style={ss.layerMain}>
                    <View style={[ss.layerThumb, {
                      backgroundColor: layer.type === 'shape'
                        ? (layer.data as DesignShapeLayer).fill
                        : layer.type === 'text'
                        ? (layer.data as DesignTextLayer).color + '33'
                        : CARD_ELEVATED,
                    }]}>
                      <Feather
                        name={layer.type === 'text' ? 'type' : layer.type === 'image' ? 'image' : layer.type === 'drawing' ? 'edit-2' : 'square'}
                        size={14} color={MUTED}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[ss.layerName, layer.id === selectedLayerId && { color: PURPLE_LIGHT }]} numberOfLines={1}>{layer.name}</Text>
                      <Text style={ss.layerSub}>{layer.type}</Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => mutateLayer(prev => prev.map(l => l.id === layer.id ? { ...l, visible: !l.visible } : l))} style={ss.layerIconBtn}>
                    <Feather name={layer.visible ? 'eye' : 'eye-off'} size={14} color={layer.visible ? FG : SUBTLE} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => mutateLayer(prev => prev.map(l => l.id === layer.id ? { ...l, locked: !l.locked } : l))} style={ss.layerIconBtn}>
                    <Feather name={layer.locked ? 'lock' : 'unlock'} size={14} color={layer.locked ? CYAN : SUBTLE} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => mutateLayer(prev => prev.filter(l => l.id !== layer.id))} style={ss.layerIconBtn}>
                    <Feather name="trash-2" size={14} color={RED} />
                  </TouchableOpacity>
                </View>
              ))}
              {layers.length === 0 && (
                <Text style={{ color: SUBTLE, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', paddingVertical: SP.lg }}>
                  No layers yet. Use tools below to add content.
                </Text>
              )}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* COLOR SHEET */}
      <Modal visible={bottomSheet === 'color'} transparent animationType="slide" onRequestClose={closeSheet}>
        <TouchableOpacity style={ss.modalOverlay} activeOpacity={1} onPress={closeSheet}>
          <View style={ss.sheet}>
            <SheetHandle />
            <Text style={ss.sheetTitle}>Color Picker</Text>

            {/* Hex input */}
            <View style={ss.hexRow}>
              <Text style={ss.hexHash}>#</Text>
              <TextInput
                style={ss.hexInput}
                value={pickerHex}
                onChangeText={v => {
                  if (/^[0-9A-Fa-f]{0,6}$/.test(v)) {
                    setPickerHex(v.toUpperCase());
                    if (v.length === 6) setDrawColor('#' + v);
                  }
                }}
                maxLength={6}
                autoCapitalize="characters"
                placeholderTextColor={SUBTLE}
                placeholder="FFFFFF"
              />
              <View style={[ss.hexPreview, { backgroundColor: '#' + (pickerHex.length === 6 ? pickerHex : 'FFFFFF') }]} />
            </View>

            {/* Palette */}
            <Text style={ss.sheetLabel}>Palette</Text>
            <View style={ss.paletteGrid}>
              {DEFAULT_PALETTE.map(c => (
                <TouchableOpacity key={c} style={[ss.paletteDot, { backgroundColor: c }, drawColor === c && ss.paletteDotActive]}
                  onPress={() => { setDrawColor(c); setPickerHex(c.replace('#', '')); }} />
              ))}
            </View>

            {/* Brand colors placeholder */}
            <Text style={ss.sheetLabel}>Brand Colors</Text>
            <Text style={{ color: SUBTLE, fontFamily: FONT.regular, fontSize: FS.xs }}>
              Add brand colors in Brand Assets →
            </Text>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ─── Sheet handle helper ───────────────────────────────────────────────────────
function SheetHandle() {
  return (
    <View style={{ alignItems: 'center', paddingTop: SP.sm, paddingBottom: SP.xs }}>
      <View style={{ width: 36, height: 4, borderRadius: RADIUS.pill, backgroundColor: 'rgba(255,255,255,0.15)' }} />
    </View>
  );
}

const ss = StyleSheet.create({
  root:        { flex: 1, backgroundColor: BG },
  topBar:      { flexDirection: 'row', alignItems: 'center', backgroundColor: SURFACE, borderBottomWidth: 1, borderBottomColor: BORDER, paddingHorizontal: SP.sm, paddingBottom: SP.sm, gap: SP.xs },
  topBtn:      { width: 34, height: 34, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  saveBtn:     { backgroundColor: PURPLE_DIM },
  topTitle:    { flex: 1, fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  nameInput:   { flex: 1, fontSize: FS.base, fontFamily: FONT.semibold, color: FG, borderBottomWidth: 1, borderBottomColor: BORDER_ACTIVE },
  topRight:    { flexDirection: 'row', alignItems: 'center', gap: SP.xs },

  selectionBar:{ flexDirection: 'row', backgroundColor: CARD_ELEVATED, borderBottomWidth: 1, borderBottomColor: BORDER, paddingHorizontal: SP.sm, paddingVertical: 6, gap: 4 },
  selBtn:      { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.xs, backgroundColor: CARD },
  selBtnText:  { fontSize: FS.xs, fontFamily: FONT.medium, color: FG },

  canvasArea:  { flex: 1, backgroundColor: '#12121F', position: 'relative' },
  imageLayer:  { position: 'absolute' },
  canvasOverlayRow: { position: 'absolute', top: SP.sm, right: SP.sm, flexDirection: 'column', gap: SP.xs },
  overlayBtn:  { width: 30, height: 30, borderRadius: RADIUS.xs, backgroundColor: 'rgba(18,18,31,0.8)', borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  overlayBtnActive: { borderColor: CYAN, backgroundColor: CYAN_DIM },

  bottomBar:   { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: SURFACE, borderTopWidth: 1, borderTopColor: BORDER, paddingTop: SP.sm },
  toolBtn:     { alignItems: 'center', gap: 2, paddingHorizontal: SP.xs, paddingVertical: SP.xs, borderRadius: RADIUS.xs, minWidth: 42 },
  toolBtnActive: { backgroundColor: PURPLE_DIM },
  toolLabel:   { fontSize: 9, fontFamily: FONT.medium, color: MUTED },

  modalOverlay:{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet:       { backgroundColor: SURFACE, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, borderWidth: 1, borderColor: BORDER, padding: SP.md, maxHeight: '60%' },
  sheetTitle:  { fontSize: FS.md, fontFamily: FONT.bold, color: FG, marginBottom: SP.sm, marginTop: SP.xs },
  sheetLabel:  { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: SP.xs, marginTop: SP.sm },
  sheetHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.sm },
  sheetAddBtn: { width: 32, height: 32, borderRadius: RADIUS.sm, backgroundColor: PURPLE_DIM, alignItems: 'center', justifyContent: 'center' },

  addGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  addItem:     { width: '28%', alignItems: 'center', gap: SP.xs, padding: SP.sm, borderRadius: RADIUS.sm, backgroundColor: CARD },
  addItemIcon: { width: 40, height: 40, borderRadius: RADIUS.sm, backgroundColor: PURPLE_DIM, alignItems: 'center', justifyContent: 'center' },
  addItemLabel:{ fontSize: FS.xs, fontFamily: FONT.medium, color: FG, textAlign: 'center' },

  textInput:   { backgroundColor: CARD, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, padding: SP.sm, fontSize: FS.base, fontFamily: FONT.regular, color: FG, minHeight: 70, textAlignVertical: 'top', marginBottom: SP.sm },
  fontChip:    { paddingHorizontal: SP.sm, paddingVertical: 6, borderRadius: RADIUS.pill, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, marginRight: SP.xs },
  fontChipActive: { borderColor: BORDER_ACTIVE, backgroundColor: PURPLE_DIM },
  fontChipText:{ fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },

  sliderRow:   { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.xs },
  sliderTrack: { flex: 1, height: 4, backgroundColor: BORDER, borderRadius: RADIUS.pill, overflow: 'hidden' },
  sliderFill:  { height: '100%', backgroundColor: PURPLE, borderRadius: RADIUS.pill },

  toggleRow:   { flexDirection: 'row', gap: SP.xs, marginBottom: SP.sm },
  toggleBtn:   { width: 36, height: 36, borderRadius: RADIUS.xs, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  toggleBtnActive: { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE },
  toggleBtnText: { fontSize: FS.sm, fontFamily: FONT.bold, color: MUTED },

  paletteRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginBottom: SP.sm },
  paletteGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  paletteDot:  { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: 'transparent' },
  paletteDotActive: { borderColor: PURPLE_LIGHT, borderWidth: 2 },

  addBtn:      { backgroundColor: PURPLE, borderRadius: RADIUS.md, paddingVertical: SP.sm, alignItems: 'center', marginTop: SP.md },
  addBtnText:  { fontSize: FS.base, fontFamily: FONT.bold, color: '#FFFFFF' },

  uploadBtn:   { flexDirection: 'row', alignItems: 'center', gap: SP.md, backgroundColor: PURPLE_DIM, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER_ACTIVE, padding: SP.lg, justifyContent: 'center', marginVertical: SP.md },
  uploadBtnText: { fontSize: FS.base, fontFamily: FONT.semibold, color: PURPLE_LIGHT },

  brushChip:   { paddingHorizontal: SP.sm, paddingVertical: 7, borderRadius: RADIUS.pill, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, marginRight: SP.xs },
  brushChipActive: { borderColor: BORDER_ACTIVE, backgroundColor: PURPLE_DIM },
  brushChipText: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },

  hexRow:      { flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: CARD, borderRadius: RADIUS.sm, paddingHorizontal: SP.sm, paddingVertical: SP.sm, marginBottom: SP.sm },
  hexHash:     { fontSize: FS.md, fontFamily: FONT.semibold, color: MUTED },
  hexInput:    { flex: 1, fontSize: FS.md, fontFamily: FONT.bold, color: FG },
  hexPreview:  { width: 28, height: 28, borderRadius: 14 },

  layerRow:    { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.sm, paddingHorizontal: SP.xs, borderRadius: RADIUS.sm },
  layerRowActive: { backgroundColor: PURPLE_DIM },
  layerMain:   { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  layerThumb:  { width: 36, height: 36, borderRadius: RADIUS.xs, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER },
  layerName:   { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  layerSub:    { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  layerIconBtn:{ padding: 4 },
});
