/**
 * Brandthread Design Studio — Main Canvas Editor
 * Route: /design-canvas?id=<projectId>
 *
 * Architecture:
 * - ONE logical coordinate space: DrawPath.d strings and layer transforms are always
 *   in project canvas coordinates (e.g. 1080×1080). Display scales logical→display
 *   via dispScaleX/Y; export uses scale=1 with explicit viewBox at logical dims.
 * - Eraser uses react-native-svg <Mask> (NOT ClipPath): white rect + black eraser
 *   strokes per drawing-layer group. Ink paths reference mask via mask="url(#id)".
 * - Transform handles: absolutely-positioned Pressable overlays on the canvas View.
 *   Each Pressable calls startHandle(kind) before the pan responder processes movement.
 * - Generation-aware autosave: dirtyGen increments on every mutation; save captures
 *   gen; marks saved only when gen still matches, else immediately re-queues.
 * - Platform-safe image copy: native uses File.copy(); web retains picker URI as-is.
 * - PNG write: File.write(base64, { encoding: EncodingType.Base64 }) — explicit encoding.
 * - Crop: stored in project.canvas.cropRect (persisted); applied to export via
 *   ImageManipulator.manipulateAsync with actual crop dimensions.
 */

import React, {
  useRef, useState, useCallback, useEffect, useMemo,
} from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, PanResponder, Pressable,
  Alert, ScrollView, TextInput, Modal, Dimensions, Share,
  Platform, AppState, AppStateStatus, Image as RNImage, GestureResponderEvent,
} from 'react-native';
import Svg, {
  Path, Rect, Circle, G, Line, Text as SvgText,
  Image as SvgImage, Defs, Mask as SvgMask, Filter, FeColorMatrix,
} from 'react-native-svg';
import { File, Paths, EncodingType } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Sharing from 'expo-sharing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { saveImageToMediaLibrary } from '@/lib/mediaLibraryAdapter';
import { makeDurableUri } from '@/lib/imageUri';
import { validateBtJson } from '@/lib/btLayerValidator';
import {
  validateMimeExtPair, validateMagicBytes, validateJsonByteLength,
  JSON_IMPORT_MAX_BYTES,
  ALLOWED_IMAGE_MIMES,
} from '@/lib/fileValidator';
import {
  BG, SURFACE, CARD, CARD_ELEVATED,
  BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE,
  RED,
  PURPLE_LIGHT,
  FONT, FS, SP, RADIUS, ICON,
  OVERLAY,
} from '@/lib/theme';
import {
  SelectionRegion, SelectionMode, LogicalPoint,
  automaticSelection, marchingAntsOffset, lassoPathD, rectFromPoints, polygonBounds,
  ANTS_DASH_PATTERN,
} from '@/lib/selectionModel';
import {
  TransformMode, ExtHandleKind,
  computeHandlePositions, applyFreeformHandle, applyUniformHandle,
  transformToQuad, deriveAffineFromQuad, defaultWarpMesh, deriveAffineFromWarpMesh,
  DistortQuad, WarpMeshPoint,
} from '@/lib/transformModel';
import {
  CurvesAdjustment, CurveChannel, LiquifyPushStroke,
  defaultCurvesAdjustment, curveToTableValues,
  computeHistogramFromColors, HISTOGRAM_UNAVAILABLE,
  netLiquifyDisplacement, DesignLayerAdjustments,
} from '@/lib/adjustmentsModel';
import {
  buildLayerTransform, curvesToColorMatrixString, isIdentityCurves,
} from '@/lib/layerRenderer';
import {
  DesignPreferences, QuickMenuAction, PressurePoint, DesignTimerState,
  defaultPreferences, samplePressureCurve, formatDuration,
  timerResume, timerPause, currentSessionSeconds,
  QUICK_MENU_ALL_ACTIONS, QUICK_MENU_SLOT_COUNT,
} from '@/lib/preferencesModel';
import {
  getProject, createProject, autosaveProject, updateProject,
  createVersion, duplicateProject, syncVerifiedDesignAsset,
  getBrandAssets,
} from '@/services/designService';
import {
  resolveMasterDescriptor, MasterDescriptor, MasterExportAsset,
  ExportDimensionError, ExportVerificationError,
  DEFAULT_MASTER_FORMAT, MASTER_JPEG_QUALITY, MIN_JPEG_QUALITY,
  clampJpegQuality, pngLabel, jpegLabel,
  verifyExportDimensionsWeb, verifyExportDimensionsNative,
} from '@/lib/designExportPolicy';
import type {
  DesignProject, DesignLayer, DesignCanvas,
  DesignTextLayer, DesignImageLayer, DesignShapeLayer, DesignDrawingLayer,
  DrawPath, BlendModeKind,
} from '@/services/designTypes';
import { SheetRise } from '@/components/motion/SheetRise';

// ─── Constants ────────────────────────────────────────────────────────────────

const FONT_FAMILIES = ['System', 'serif', 'monospace', 'Inter_400Regular', 'Georgia'];

interface BrushDef {
  name: string;
  category: string;
  widthMult: number;
  opacityMult: number;
  linecap: 'round' | 'square' | 'butt';
}

const BRUSH_LIBRARY: BrushDef[] = [
  { name: 'HB Pencil',  category: 'Sketching', widthMult: 0.6,  opacityMult: 0.85, linecap: 'round' },
  { name: '6B Pencil',  category: 'Sketching', widthMult: 1.2,  opacityMult: 0.75, linecap: 'round' },
  { name: 'Technical',  category: 'Sketching', widthMult: 0.4,  opacityMult: 1.0,  linecap: 'round' },
  { name: 'Studio Pen', category: 'Inking',    widthMult: 1.0,  opacityMult: 1.0,  linecap: 'round' },
  { name: 'Dry Ink',    category: 'Inking',    widthMult: 1.4,  opacityMult: 0.9,  linecap: 'square' },
  { name: 'Syrup',      category: 'Inking',    widthMult: 2.5,  opacityMult: 0.95, linecap: 'round' },
  { name: 'Flat Brush', category: 'Painting',  widthMult: 3.0,  opacityMult: 0.7,  linecap: 'square' },
  { name: 'Soft Brush', category: 'Painting',  widthMult: 4.0,  opacityMult: 0.4,  linecap: 'round' },
  { name: 'Old Brush',  category: 'Painting',  widthMult: 2.0,  opacityMult: 0.6,  linecap: 'butt'   },
  { name: 'Soft Air',   category: 'Airbrushing', widthMult: 5.0, opacityMult: 0.25, linecap: 'round' },
  { name: 'Hard Air',   category: 'Airbrushing', widthMult: 3.5, opacityMult: 0.45, linecap: 'round' },
  { name: 'Marker',     category: 'Marker',    widthMult: 2.8,  opacityMult: 0.88, linecap: 'square' },
  { name: 'Neon',       category: 'Marker',    widthMult: 3.2,  opacityMult: 0.7,  linecap: 'round' },
];

const BRUSH_CATEGORIES = [...new Set(BRUSH_LIBRARY.map(b => b.category))];

const SMUDGE_BRUSH: BrushDef = {
  name: 'Smudge', category: 'Smudge', widthMult: 3.0, opacityMult: 0.3, linecap: 'round',
};
const ERASER_BRUSH: BrushDef = {
  name: 'Eraser', category: 'Eraser', widthMult: 3.0, opacityMult: 1.0, linecap: 'round',
};

// react-native-svg supported blend modes
const BLEND_MODES: BlendModeKind[] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'];
const RN_SVG_BLEND_MODES = new Set<string>(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten']);

// ─── Document picker constants ────────────────────────────────────────────────

/**
 * MIME types accepted by Insert File.
 *
 * SVG is intentionally excluded from the image list:
 *   - react-native-svg can render SVG path data we generate ourselves
 *   - but arbitrary external SVG files may reference external URIs, scripts,
 *     foreignObject, or SMIL animations — none of which are safe to execute
 *     inside the canvas without a full sanitisation pass we do not have.
 *   - We keep SVG off the allowed list until a sanitiser ships.
 *
 * application/json covers Brandthread canvas project exports.
 */
// Accept all allowlisted image MIMEs + JSON for the document picker.
// Computed from ALLOWED_IMAGE_MIMES at runtime after import is resolved.
const DOCUMENT_PICKER_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/json'];


const DEFAULT_PALETTE = [
  '#FFFFFF', '#000000', '#EF4444', '#F97316', '#EAB308',
  '#22C55E', '#0EA5E9', '#0F766E', '#EC4899', '#6B7280',
  '#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF', '#FF6FC8',
  '#0C4A6E', '#34D399', '#FBBF24', '#F472B6', '#1E1E2E',
];

let _uid = 0;
function uid(): string { return `uid_${Date.now()}_${++_uid}`; }

type ActiveTopTool = 'brush' | 'smudge' | 'eraser' | 'select' | 'transform' | 'adjustments' | 'crop' | 'none';
type ActiveSheet =
  | 'brushLib' | 'color' | 'layers' | 'wrench' | 'text' | 'export' | 'canvasInfo'
  | 'layerOptions' | 'canvasResize' | 'selection' | 'transformTool' | 'adjustments' | null;

// Wrench tab type — now includes 'prefs' as sixth tab
type WrenchTab = 'add' | 'canvas' | 'guides' | 'share' | 'prefs';

// Transform handle kind (legacy 4-corner system, kept for compat)
type HandleKind =
  | 'move'
  | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br'
  | 'rotate';

// Handle size constant (display px) for hit-testing overlay
const HS = 22; // tap target — larger than visual for 44pt finger usability

// Selection mode
type SelectionSubMode = SelectionMode;

// Transform sub-mode
type TransformSubMode = TransformMode;

// ─── Extended DesignCanvas with optional cropRect + editor extensions ─────────
interface DesignCanvasWithCrop extends DesignCanvas {
  cropRect?: { x: number; y: number; w: number; h: number } | null;
  // Guide settings persisted with project
  guideSettings?: GuideSettings;
  // Flip transforms persisted with project
  canvasFlipX?: boolean;
  canvasFlipY?: boolean;
  // Animation: frame snapshots (layer JSON per frame)
  animFrames?: string[];
  animCurrentFrame?: number;
  // Reference image URI
  referenceImageUri?: string;
  // Preferences (brush cursor, quick menu, pressure curve, timer)
  preferences?: DesignPreferences;
}

// Guide settings
interface GuideSettings {
  gridEnabled: boolean;
  gridSize: number; // display px per cell
  gridOpacity: number; // 0–1
  symVertical: boolean;
  symHorizontal: boolean;
  symQuadrant: boolean;
}

const DEFAULT_GUIDE_SETTINGS: GuideSettings = {
  gridEnabled: false,
  gridSize: 40,
  gridOpacity: 0.35,
  symVertical: false,
  symHorizontal: false,
  symQuadrant: false,
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function DesignCanvasScreen() {
  const { theme } = useAppTheme();
  const {
    accent: PURPLE,
    accentDim: PURPLE_DIM,
    accentLight: PURPLE_LIGHT,
    secondary: CYAN,
  } = theme;

  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; addAssetId?: string }>();
  const projectId = params.id ?? '';
  const addAssetId = params.addAssetId ?? '';

  // ── Project state ──────────────────────────────────────────────────────────
  const [project, setProject]         = useState<DesignProject | null>(null);
  const [loading, setLoading]         = useState(true);
  const [projectName, setProjectName] = useState('Untitled');
  const [editingName, setEditingName] = useState(false);
  const projectNameRef = useRef(projectName);
  projectNameRef.current = projectName;
  const [layers, setLayers]           = useState<DesignLayer[]>([]);
  const [saveStatus, setSaveStatus]   = useState<'saved' | 'unsaved' | 'saving'>('saved');

  // Generation-aware autosave: every mutation increments dirtyGen
  const dirtyGenRef   = useRef(0);
  const savedGenRef   = useRef(0);
  const intervalId    = useRef<ReturnType<typeof setInterval> | null>(null);

  // Serialized save coordinator — the tail of the active promise chain.
  // Any call to coordinatedSave() chains after the current write so concurrent
  // callers always wait for the active write and then continue until the latest
  // dirty generation is persisted.  No caller returns while a write is running.
  const saveChainRef  = useRef<Promise<void>>(Promise.resolve());

  // Stable refs to avoid stale closures in autosave
  const projectRef    = useRef(project);
  const layersRef     = useRef(layers);
  const saveStatusRef = useRef(saveStatus);
  projectRef.current    = project;
  layersRef.current     = layers;
  saveStatusRef.current = saveStatus;

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
    markDirty();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function handleRedo() {
    if (redoStack.current.length === 0) return;
    const snap = redoStack.current[redoStack.current.length - 1];
    undoStack.current = [...undoStack.current, JSON.stringify(layers)];
    redoStack.current = redoStack.current.slice(0, -1);
    setLayers(JSON.parse(snap));
    markDirty();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  // ── Tool state ─────────────────────────────────────────────────────────────
  const [activeTopTool, setActiveTopTool]         = useState<ActiveTopTool>('brush');
  const [activeSheet, setActiveSheet]             = useState<ActiveSheet>(null);
  const [selectedLayerId, setSelectedLayerId]     = useState<string | null>(null);
  const [layerOptionsTarget, setLayerOptionsTarget] = useState<string | null>(null);

  const activeTopToolRef    = useRef(activeTopTool);
  const selectedLayerIdRef  = useRef(selectedLayerId);
  activeTopToolRef.current  = activeTopTool;
  selectedLayerIdRef.current = selectedLayerId;

  // ── Wrench tab state ───────────────────────────────────────────────────────
  const [wrenchTab, setWrenchTab] = useState<WrenchTab>('add');

  // ── In-editor clipboard ────────────────────────────────────────────────────
  const [clipboard, setClipboard] = useState<DesignLayer[] | null>(null);

  // ── Selection tool state ────────────────────────────────────────────────────
  const [selectionMode, setSelectionMode] = useState<SelectionSubMode>('automatic');
  const [selectionRegion, setSelectionRegion] = useState<SelectionRegion | null>(null);
  const [selectionFeather, setSelectionFeather] = useState(0);
  // Lasso recording
  const lassoPointsRef = useRef<LogicalPoint[]>([]);
  // Drag start for rectangle/ellipse
  const selectionDragStart = useRef<LogicalPoint | null>(null);
  // Marching-ants animation tick (ms)
  const [antsTick, setAntsTick] = useState(0);
  const antsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const selectionRegionRef = useRef(selectionRegion);
  selectionRegionRef.current = selectionRegion;

  // ── Transform tool state ────────────────────────────────────────────────────
  const [transformMode, setTransformMode] = useState<TransformSubMode>('freeform');
  const [transformSnapEnabled, setTransformSnapEnabled] = useState(false);
  // Distort quad (four corner control points)
  const [distortQuad, setDistortQuad] = useState<DistortQuad | null>(null);
  const distortQuadRef = useRef(distortQuad);
  distortQuadRef.current = distortQuad;
  // Warp mesh
  const [warpMesh, setWarpMesh] = useState<WarpMeshPoint[] | null>(null);
  const warpMeshRef = useRef(warpMesh);
  warpMeshRef.current = warpMesh;
  // Extended 8-handle drag state
  const extHandleDragRef = useRef<{
    layerId: string;
    kind: ExtHandleKind;
    startX: number; startY: number;
    origTransform: import('../services/designTypes').DesignTransform;
    origQuad: DistortQuad | null;
    origMesh: WarpMeshPoint[] | null;
  } | null>(null);
  const pendingExtHandleRef = useRef<ExtHandleKind>('move');

  // ── Adjustments tool state ──────────────────────────────────────────────────
  const [adjustmentsSubMode, setAdjustmentsSubMode] = useState<'curves' | 'liquify'>('curves');
  const [adjustmentsCurveChannel, setAdjustmentsCurveChannel] = useState<CurveChannel>('gamma');
  // Liquify brush settings
  const [liquifySize, setLiquifySize] = useState(40);
  const [liquifyPressure, setLiquifyPressure] = useState(0.5);
  const [liquifyDistortion, setLiquifyDistortion] = useState(0.5);
  const [liquifyMomentum, setLiquifyMomentum] = useState(0.3);
  // Live liquify stroke recording
  const liquifyStrokeRef = useRef<{ x: number; y: number }[]>([]);

  // ── Preferences state ───────────────────────────────────────────────────────
  const [prefs, setPrefs] = useState<DesignPreferences>(defaultPreferences());
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  // QuickMenu visibility
  const [quickMenuVisible, setQuickMenuVisible] = useState(false);
  // QuickMenu edit mode (in Preferences tab)
  const [quickMenuEditSlot, setQuickMenuEditSlot] = useState<number | null>(null);
  // Timer state — live updating
  const [timerDisplay, setTimerDisplay] = useState({ session: '0s', total: '0s' });
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const projectLoadedRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // ── Canvas flip state (logical persisted transforms) ──────────────────────
  const [canvasFlipX, setCanvasFlipX] = useState(false);
  const [canvasFlipY, setCanvasFlipY] = useState(false);
  const canvasFlipXRef = useRef(canvasFlipX);
  const canvasFlipYRef = useRef(canvasFlipY);
  canvasFlipXRef.current = canvasFlipX;
  canvasFlipYRef.current = canvasFlipY;

  // ── Guide settings ─────────────────────────────────────────────────────────
  const [guideSettings, setGuideSettings] = useState<GuideSettings>(DEFAULT_GUIDE_SETTINGS);
  const guideSettingsRef = useRef(guideSettings);
  guideSettingsRef.current = guideSettings;

  // ── Animation / onion-skin state ──────────────────────────────────────────
  const [animEnabled, setAnimEnabled]           = useState(false);
  const [animCurrentFrame, setAnimCurrentFrame] = useState(0);
  const [animFrames, setAnimFrames]             = useState<string[]>([]); // JSON snapshots
  const animEnabledRef      = useRef(animEnabled);
  const animCurrentFrameRef = useRef(animCurrentFrame);
  const animFramesRef       = useRef(animFrames);
  animEnabledRef.current      = animEnabled;
  animCurrentFrameRef.current = animCurrentFrame;
  animFramesRef.current       = animFrames;

  // ── Reference image window state ──────────────────────────────────────────
  const [referenceUri, setReferenceUri]           = useState<string | null>(null);
  const [referenceVisible, setReferenceVisible]   = useState(false);
  const [refPosition, setRefPosition]             = useState({ x: 20, y: 120 });
  const [refSize, setRefSize]                     = useState({ w: 160, h: 160 });
  const refDragRef = useRef<{ startPageX: number; startPageY: number; origX: number; origY: number } | null>(null);
  const refUriRef  = useRef(referenceUri);
  refUriRef.current = referenceUri;

  // ── Canvas geometry ────────────────────────────────────────────────────────
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [showGrid, setShowGrid]     = useState(false);
  const [showGuides, setShowGuides] = useState(false);

  // Crop state in logical canvas coords — persisted in project.canvas.cropRect
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const cropRectRef = useRef(cropRect);
  cropRectRef.current = cropRect;

  const canvasSizeRef    = useRef(canvasSize);
  const dispScaleXRef    = useRef(1);
  const dispScaleYRef    = useRef(1);
  canvasSizeRef.current  = canvasSize;

  // ── Brush state ────────────────────────────────────────────────────────────
  const [brushIdx, setBrushIdx]         = useState(3);
  const [brushSize, setBrushSize]       = useState(10);
  const [brushOpacity, setBrushOpacity] = useState(1.0);
  const [drawColor, setDrawColor]       = useState('#FFFFFF');
  const [prevColor, setPrevColor]       = useState('#000000');
  const [eraserSize, setEraserSize]     = useState(24);
  const [smudgeSize, setSmudgeSize]     = useState(20);

  const [sizeSliderDragging, setSizeSliderDragging] = useState(false);
  const sizeSliderHeightRef = useRef(200);
  const sizeSliderYRef      = useRef(0);

  const brushIdxRef     = useRef(brushIdx);
  const brushSizeRef    = useRef(brushSize);
  const brushOpacityRef = useRef(brushOpacity);
  const drawColorRef    = useRef(drawColor);
  const eraserSizeRef   = useRef(eraserSize);
  const smudgeSizeRef   = useRef(smudgeSize);

  brushIdxRef.current     = brushIdx;
  brushSizeRef.current    = brushSize;
  brushOpacityRef.current = brushOpacity;
  drawColorRef.current    = drawColor;
  eraserSizeRef.current   = eraserSize;
  smudgeSizeRef.current   = smudgeSize;

  // ── Draw state ─────────────────────────────────────────────────────────────
  const [currentPath, setCurrentPath]             = useState('');
  const [currentIsErase, setCurrentIsErase]       = useState(false);
  const [currentEraseWidth, setCurrentEraseWidth] = useState(24);
  const drawPointsRef = useRef<string[]>([]);
  // Pressure tracking: last native force value for pressure-curve mapping
  const lastStrokeForceRef = useRef<number | undefined>(undefined);
  // Brush cursor position (display px), null when not actively drawing
  const [brushCursorPos, setBrushCursorPos] = useState<{ x: number; y: number } | null>(null);

  // Export SVG ref
  const exportSvgRef = useRef<Svg>(null);
  const [exporting, setExporting] = useState(false);

  // ── Text editing ───────────────────────────────────────────────────────────
  const [editingTextLayerId, setEditingTextLayerId] = useState<string | null>(null);
  const [editingTextValue, setEditingTextValue]     = useState('');

  // ── Color picker ───────────────────────────────────────────────────────────
  const [pickerHex, setPickerHex]           = useState('FFFFFF');
  const [pickerTab, setPickerTab]           = useState<'disc' | 'palette' | 'value'>('palette');
  const [hueDiscAngle, setHueDiscAngle]     = useState(0);
  const [discBrightness, setDiscBrightness] = useState(1.0);

  // ── Layer options ──────────────────────────────────────────────────────────
  const [layerEditOpacity, setLayerEditOpacity] = useState(1.0);
  const [layerEditBlend, setLayerEditBlend]     = useState<BlendModeKind>('normal');

  // ── Canvas Resize sheet state ──────────────────────────────────────────────
  const [resizeW, setResizeW] = useState('1080');
  const [resizeH, setResizeH] = useState('1080');

  // ── Transform handle dragging ──────────────────────────────────────────────
  // kind is set by startHandle() before transformPanResponder.onPanResponderGrant
  const handleDragRef = useRef<{
    layerId: string;
    kind: HandleKind;
    startX: number; startY: number;     // display px at drag start
    origX: number; origY: number;       // logical
    origW: number; origH: number;       // logical
    origRot: number;
    cx: number; cy: number;             // display px centre at drag start
  } | null>(null);

  // kind is staged here by Pressable.onPressIn before pan responder fires
  const pendingHandleKindRef = useRef<HandleKind>('move');

  // ─── Load project ──────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const proj = projectId
        ? await getProject(projectId)
        : await createProject('canvas', 'Untitled Artwork', {});
      if (!proj) {
        Alert.alert('Not found', 'Project not found.', [{ text: 'OK', onPress: () => router.back() }]);
        return;
      }
      setProject(proj);
      setProjectName(proj.name);
      let initialLayers = proj.layers;
      // Handle ?addAssetId= from design-brand-assets.tsx "Add to Project":
      // insert the chosen brand asset as a new image layer, the same way
      // handleAddImage() adds a picked photo.
      if (addAssetId) {
        try {
          const assets = await getBrandAssets();
          const asset = assets.find(a => a.id === addAssetId);
          if (asset?.uri) {
            const lw = proj.canvas.width  || 1080;
            const lh = proj.canvas.height || 1080;
            const maxOrder = initialLayers.reduce((m, l) => Math.max(m, l.order), 0);
            const tw = Math.round(lw * 0.6);
            const assetLayer: DesignLayer = {
              id: uid(), name: asset.name || 'Asset', type: 'image',
              visible: true, locked: false, order: maxOrder + 1,
              transform: {
                x: Math.round((lw - tw) / 2), y: 60,
                width: tw, height: tw, rotation: 0, scaleX: 1, scaleY: 1,
              },
              data: { kind: 'image', uri: asset.uri, opacity: 1, fit: 'contain', blendMode: 'normal' } as DesignImageLayer,
              opacity: 1,
              createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            };
            initialLayers = [...initialLayers, assetLayer];
          }
        } catch {
          // Non-fatal: project still opens without the asset pre-added.
        }
      }
      setLayers(initialLayers);
      setResizeW(String(proj.canvas?.width ?? 1080));
      setResizeH(String(proj.canvas?.height ?? 1080));
      // Restore persisted crop from canvas
      const c = proj.canvas as DesignCanvasWithCrop;
      if (c?.cropRect) setCropRect(c.cropRect);
      if (c?.guideSettings) setGuideSettings(c.guideSettings);
      if (c?.canvasFlipX) setCanvasFlipX(c.canvasFlipX);
      if (c?.canvasFlipY) setCanvasFlipY(c.canvasFlipY);
      if (c?.animFrames) setAnimFrames(c.animFrames);
      if (c?.animCurrentFrame != null) setAnimCurrentFrame(c.animCurrentFrame);
      if (c?.referenceImageUri) setReferenceUri(c.referenceImageUri);
      const restored = c?.preferences ?? defaultPreferences();
      const timerBase: DesignTimerState = {
        totalSeconds:    restored.timer?.totalSeconds    ?? 0,
        sessionAccumSec: restored.timer?.sessionAccumSec ?? 0,
        sessionStartMs:  null,
      };
      const restoredTimer = appStateRef.current === 'active'
        ? timerResume(timerBase)
        : timerBase;
      const restoredWithTimer: DesignPreferences = { ...restored, timer: restoredTimer };
      prefsRef.current = restoredWithTimer;
      setPrefs(restoredWithTimer);
      projectLoadedRef.current = true;
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = setInterval(() => {
        const p = prefsRef.current;
        const livePortion = p.timer.sessionStartMs !== null
          ? (Date.now() - p.timer.sessionStartMs) / 1000 : 0;
        const sessS = p.timer.sessionAccumSec + livePortion;
        const totalS = p.timer.totalSeconds + livePortion;
        setTimerDisplay({ session: formatDuration(sessS), total: formatDuration(totalS) });
      }, 10_000);
      setLoading(false);
    })();
  }, [projectId]);

  // ─── Dirty generation tracking ─────────────────────────────────────────────
  function markDirty() {
    dirtyGenRef.current += 1;
    setSaveStatus('unsaved');
  }

  // ─── Centralized save primitive ────────────────────────────────────────────
  /**
   * persistCurrentState — the ONE place that writes project data to storage.
   *
   * Captures all refs atomically at call time (gen, layers, canvas ext).
   * After the write resolves, marks saved only if gen is unchanged — otherwise
   * stays 'unsaved' so the coordinator loop retries. Storage failures throw so
   * user-triggered callers cannot continue with stale state.
   */
  const persistCurrentState = useCallback(async (): Promise<void> => {
    const proj = projectRef.current;
    if (!proj) return;

    const capturedGen    = dirtyGenRef.current;
    const capturedLayers = layersRef.current;
    const canvasWithExt: DesignCanvasWithCrop = {
      ...proj.canvas,
      cropRect:          cropRectRef.current,
      guideSettings:     guideSettingsRef.current,
      canvasFlipX:       canvasFlipXRef.current,
      canvasFlipY:       canvasFlipYRef.current,
      animFrames:        animFramesRef.current,
      animCurrentFrame:  animCurrentFrameRef.current,
      referenceImageUri: refUriRef.current ?? undefined,
      preferences:       prefsRef.current,
    };

    try {
      await autosaveProject({
        ...proj,
        name:   projectNameRef.current,
        canvas: canvasWithExt as DesignCanvas,
        layers: capturedLayers,
      });
      if (dirtyGenRef.current === capturedGen) {
        savedGenRef.current = capturedGen;
        setSaveStatus('saved');
      } else {
        setSaveStatus('unsaved');
      }
    } catch (error) {
      setSaveStatus('unsaved');
      throw error;
    }
  }, []); // stable — all values read from refs

  // ─── Serialized save coordinator ───────────────────────────────────────────
  /**
   * coordinatedSave — chains onto the active save promise so concurrent callers
   * always wait for the in-flight write and continue until the latest dirty
   * generation is fully persisted.  No caller may return while a write is running.
   *
   * Usage: await coordinatedSave()  — in handleBack, handleSaveCopy,
   *        handleManualSave, doAutosave, AppState flush.
   */
  const coordinatedSave = useCallback((): Promise<void> => {
    // writeUntilClean — write loop that runs directly (not chained) so it
    // can recurse without deadlocking on the chain-tail promise.
    const writeUntilClean = async (): Promise<void> => {
      if (!projectRef.current) return;
      if (dirtyGenRef.current === savedGenRef.current) return;
      setSaveStatus('saving');
      const genBefore = dirtyGenRef.current;
      await persistCurrentState();
      // If a mutation raced in-flight, retry immediately.
      if (dirtyGenRef.current !== genBefore && dirtyGenRef.current !== savedGenRef.current) {
        return writeUntilClean();
      }
    };

    // Chain onto the tail so concurrent callers wait for the active write.
    const next = saveChainRef.current.then(writeUntilClean, writeUntilClean);
    // Update the tail so the next caller chains after this one.
    saveChainRef.current = next.then(() => undefined, () => undefined);
    return next;
  }, [persistCurrentState]);

  // ─── Timer helpers ─────────────────────────────────────────────────────────
  const updateTimerDisplay = useCallback(() => {
    const p = prefsRef.current;
    // currentSessionSeconds = sessionAccumSec + live elapsed (since last resume)
    const sessS = currentSessionSeconds(p.timer);
    // totalSeconds already accumulates past-session totals (added on each timerPause).
    // For the live running display, add only the live portion beyond last accum.
    const livePortion = p.timer.sessionStartMs !== null
      ? (Date.now() - p.timer.sessionStartMs) / 1000
      : 0;
    // Total = persisted totalSeconds (past sessions + prior pauses) + live now
    const totalS = p.timer.totalSeconds + livePortion;
    setTimerDisplay({
      session: formatDuration(sessS),
      total:   formatDuration(totalS),
    });
  }, []);

  // Timer startup is owned by project restoration so a temporary default timer
  // can never run while the project is loading or the app is backgrounded.
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      projectLoadedRef.current = false;
      const paused = { ...prefsRef.current, timer: timerPause(prefsRef.current.timer) };
      prefsRef.current = paused;
    };
  }, []);

  // Single AppState owner: pause timer + flush save on background/inactive,
  // resume on active. Operates synchronously on refs so it is not affected by
  // React batch timing or stale closures.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      appStateRef.current = nextState;
      if (!projectLoadedRef.current) return;
      if (nextState === 'background' || nextState === 'inactive') {
        // 1. Pause timer synchronously via ref (not inside setState callback)
        //    so the persisted totalSeconds is captured before the write starts.
        const paused = { ...prefsRef.current, timer: timerPause(prefsRef.current.timer) };
        prefsRef.current = paused;
        setPrefs(paused);

        // 2. Bump dirty gen directly (markDirty calls setSaveStatus which
        //    is fine but the gen increment is what matters for the write).
        dirtyGenRef.current += 1;
        setSaveStatus('unsaved');

        // 3. Trigger coordinated save directly — don't go through doAutosave
        //    which checks saveStatusRef and may skip the write.
        coordinatedSave().catch(() => {
          // Background saves are best-effort; leave unsaved state for next open.
        });

        // Update display immediately with final paused values
        updateTimerDisplay();
      } else if (nextState === 'active') {
        // Resume only if paused (sessionStartMs === null)
        if (prefsRef.current.timer.sessionStartMs === null) {
          const resumed = { ...prefsRef.current, timer: timerResume(prefsRef.current.timer) };
          prefsRef.current = resumed;
          setPrefs(resumed);
        }
      }
    });
    return () => sub.remove();
  }, [coordinatedSave, updateTimerDisplay]);

  // ─── Marching-ants animation ────────────────────────────────────────────────
  useEffect(() => {
    if (selectionRegion !== null) {
      antsTimerRef.current = setInterval(() => {
        setAntsTick(t => t + 1);
      }, 80);
    } else {
      if (antsTimerRef.current) clearInterval(antsTimerRef.current);
    }
    return () => { if (antsTimerRef.current) clearInterval(antsTimerRef.current); };
  }, [selectionRegion]);

  // ─── Autosave interval ─────────────────────────────────────────────────────
  const doAutosave = useCallback(async () => {
    if (!projectRef.current) return;
    if (saveStatusRef.current === 'saved') return;
    try {
      await coordinatedSave();
    } catch {
      // Keep the dirty state for the next interval or explicit user retry.
      setSaveStatus('unsaved');
    }
  }, [coordinatedSave]);

  useEffect(() => {
    intervalId.current = setInterval(doAutosave, 30_000);
    return () => { if (intervalId.current) clearInterval(intervalId.current); };
  }, [doAutosave]);

  // (Background flush is handled inside the timer AppState effect above —
  //  a single owner avoids duplicate saves and ordering races.)

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function mutateLayer(updater: (prev: DesignLayer[]) => DesignLayer[]) {
    setLayers(prev => {
      pushUndo(prev);
      return updater(prev);
    });
    markDirty();
  }

  function openSheet(sheet: ActiveSheet) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveSheet(sheet);
  }

  function closeSheet() { setActiveSheet(null); }

  function selectTool(tool: ActiveTopTool) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveTopTool(tool);
    // Preserve selectedLayerId for select/transform/adjustments — the user
    // should be able to switch between these tools without losing their layer.
    // Only clear selection when switching to a pure drawing/utility tool.
    if (tool === 'brush' || tool === 'smudge' || tool === 'eraser' || tool === 'crop' || tool === 'none') {
      setSelectedLayerId(null);
    }
    // For transform: initialise quad/mesh from current selected layer if not set.
    if (tool === 'transform') {
      const sel = selectedLayerIdRef.current;
      if (sel) {
        const layer = layersRef.current.find(l => l.id === sel);
        if (layer) {
          if (!distortQuadRef.current) setDistortQuad(transformToQuad(layer.transform));
          if (!warpMeshRef.current) setWarpMesh(defaultWarpMesh(layer.transform));
        }
      }
    }
  }

  function resolveActiveBrush(): BrushDef {
    if (activeTopToolRef.current === 'eraser') return ERASER_BRUSH;
    if (activeTopToolRef.current === 'smudge') return SMUDGE_BRUSH;
    return BRUSH_LIBRARY[brushIdxRef.current] ?? BRUSH_LIBRARY[3];
  }

  function resolveActiveSize(): number {
    if (activeTopToolRef.current === 'eraser') return eraserSizeRef.current;
    if (activeTopToolRef.current === 'smudge') return smudgeSizeRef.current;
    return brushSizeRef.current;
  }

  // Resolve active drawing layer for stroke append
  function resolveActiveDrawingLayerId(current: DesignLayer[]): string | null {
    const sel = selectedLayerIdRef.current;
    if (sel) {
      const l = current.find(x => x.id === sel);
      if (l && l.type === 'drawing' && !l.locked) return sel;
    }
    const first = current.find(l => l.type === 'drawing' && !l.locked);
    return first?.id ?? null;
  }

  // ─── Canvas-level QuickMenu long-press responder ──────────────────────────
  // This PanResponder NEVER captures the responder (returns false from both
  // onStartShouldSetPanResponder and onMoveShouldSetPanResponder) so it does
  // not interfere with draw/select/transform child responders. It only watches
  // touch start via onPanResponderGrant and tracks movement to cancel.
  //
  // It works regardless of activeTopTool: brush, eraser, smudge, select,
  // transform, and adjustments all get long-press QuickMenu support.
  const quickMenuLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quickMenuVisibleRef = useRef(false);
  quickMenuVisibleRef.current = quickMenuVisible;
  // Track touch start position to cancel on movement
  const quickMenuTouchStartRef = useRef<{ px: number; py: number } | null>(null);
  const QUICK_MENU_MOVE_THRESHOLD = 8; // px; cancel if finger moves more than this
  const QUICK_MENU_DELAY_MS = 600;

  function cancelQuickMenuLongPress() {
    if (quickMenuLongPressTimerRef.current) {
      clearTimeout(quickMenuLongPressTimerRef.current);
      quickMenuLongPressTimerRef.current = null;
    }
    quickMenuTouchStartRef.current = null;
  }

  function handleCanvasTouchStart(e: GestureResponderEvent) {
    const touch = e.nativeEvent.touches[0] ?? e.nativeEvent.changedTouches[0];
    if (!touch) return;
    cancelQuickMenuLongPress();
    quickMenuTouchStartRef.current = { px: touch.pageX, py: touch.pageY };
    quickMenuLongPressTimerRef.current = setTimeout(() => {
      const slots = prefsRef.current.quickMenuSlots;
      if (slots.some(s => s !== 'none') && !quickMenuVisibleRef.current) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        setQuickMenuVisible(true);
      }
      quickMenuLongPressTimerRef.current = null;
    }, QUICK_MENU_DELAY_MS);
  }

  function handleCanvasTouchMove(e: GestureResponderEvent) {
    const start = quickMenuTouchStartRef.current;
    const touch = e.nativeEvent.touches[0] ?? e.nativeEvent.changedTouches[0];
    if (!start || !touch || !quickMenuLongPressTimerRef.current) return;
    const dx = touch.pageX - start.px;
    const dy = touch.pageY - start.py;
    if (Math.sqrt(dx * dx + dy * dy) > QUICK_MENU_MOVE_THRESHOLD) {
      cancelQuickMenuLongPress();
    }
  }

  // ─── Drawing PanResponder ──────────────────────────────────────────────────
  // All points stored in LOGICAL coordinates: divide locationX/Y by dispScale.
  const drawPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () =>
        ['brush', 'smudge', 'eraser'].includes(activeTopToolRef.current),
      onMoveShouldSetPanResponder: () =>
        ['brush', 'smudge', 'eraser'].includes(activeTopToolRef.current),

      onPanResponderGrant: (e) => {
        // Map display coords → logical coords
        const sx = dispScaleXRef.current || 1;
        const sy = dispScaleYRef.current || 1;
        const lx = (e.nativeEvent.locationX / sx).toFixed(2);
        const ly = (e.nativeEvent.locationY / sy).toFixed(2);
        const isErase = activeTopToolRef.current === 'eraser';
        // Read native force for pressure-sensitive stroke width
        const force = (e.nativeEvent as any).force as number | undefined;
        lastStrokeForceRef.current = force;
        drawPointsRef.current = [`M${lx},${ly}`];
        setCurrentPath(drawPointsRef.current.join(' '));
        setCurrentIsErase(isErase);
        setCurrentEraseWidth(eraserSizeRef.current * ERASER_BRUSH.widthMult);
        // Update brush cursor position
        setBrushCursorPos({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY });
      },

      onPanResponderMove: (e) => {
        const sx = dispScaleXRef.current || 1;
        const sy = dispScaleYRef.current || 1;
        const lx = (e.nativeEvent.locationX / sx).toFixed(2);
        const ly = (e.nativeEvent.locationY / sy).toFixed(2);
        const force = (e.nativeEvent as any).force as number | undefined;
        if (force !== undefined) lastStrokeForceRef.current = force;
        drawPointsRef.current.push(`L${lx},${ly}`);
        setCurrentPath(drawPointsRef.current.join(' '));
        // Update brush cursor position
        setBrushCursorPos({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY });
      },

      onPanResponderRelease: () => {
        setBrushCursorPos(null);
        if (drawPointsRef.current.length < 2) {
          drawPointsRef.current = []; setCurrentPath(''); return;
        }
        const brush  = resolveActiveBrush();
        const baseSize = resolveActiveSize();     // logical stroke width
        // Apply pressure curve to get pressure-adjusted size
        const pressureMultiplier = samplePressureCurve(
          prefsRef.current.pressureCurve,
          lastStrokeForceRef.current,
        );
        const size = baseSize * pressureMultiplier;
        const isErase  = brush.name === 'Eraser';
        const isSmudge = brush.name === 'Smudge';

        const newPath: DrawPath = {
          d:       drawPointsRef.current.join(' '),   // logical coords
          color:   isErase ? 'erase' : isSmudge ? 'smudge' : drawColorRef.current,
          width:   size * brush.widthMult,             // logical width, pressure-adjusted
          opacity: brushOpacityRef.current * brush.opacityMult,
          tool:    brush.name,
        };

        const current = layersRef.current;
        pushUndo(current);

        const targetId = resolveActiveDrawingLayerId(current);

        if (targetId) {
          const target = current.find(l => l.id === targetId)!;
          const d = target.data as DesignDrawingLayer;
          setLayers(current.map(l =>
            l.id === targetId
              ? { ...l, data: { ...d, paths: [...d.paths, newPath] } }
              : l,
          ));
          selectedLayerIdRef.current = targetId;
          setSelectedLayerId(targetId);
        } else {
          // No writable drawing layer — create one sized to logical canvas
          const lw = projectRef.current?.canvas.width  || canvasSizeRef.current.w || 1080;
          const lh = projectRef.current?.canvas.height || canvasSizeRef.current.h || 1080;
          const maxOrder = current.reduce((m, l) => Math.max(m, l.order), 0);
          const newLayer: DesignLayer = {
            id: uid(), name: 'Drawing', type: 'drawing',
            visible: true, locked: false, order: maxOrder + 1,
            transform: { x: 0, y: 0, width: lw, height: lh, rotation: 0, scaleX: 1, scaleY: 1 },
            data: { kind: 'drawing', paths: [newPath], brushType: brush.name } as DesignDrawingLayer,
            opacity: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          setLayers(prev => [...prev, newLayer]);
          setSelectedLayerId(newLayer.id);
        }

        drawPointsRef.current = [];
        setCurrentPath('');
        markDirty();
      },
    })
  ).current;

  // ─── startHandle — called by Pressable overlays before pan responder fires ──
  // This sets the kind so transformPanResponder.onPanResponderGrant picks it up.
  function startHandle(kind: HandleKind, pageX: number, pageY: number) {
    const selId = selectedLayerIdRef.current;
    if (!selId) return;
    const layer = layersRef.current.find(l => l.id === selId);
    if (!layer || layer.locked) return;
    const t = layer.transform;
    const sx = dispScaleXRef.current || 1;
    const sy = dispScaleYRef.current || 1;
    handleDragRef.current = {
      layerId: selId, kind,
      startX: pageX, startY: pageY,
      origX: t.x, origY: t.y,
      origW: t.width, origH: t.height,
      origRot: t.rotation ?? 0,
      // Centre in display coords for rotate angle computation
      cx: (t.x + t.width  / 2) * sx,
      cy: (t.y + t.height / 2) * sy,
    };
  }

  // ─── Transform PanResponder (move + resize + rotate selected layer) ─────────
  // All deltas converted from display to logical before storing in transform.
  const transformPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => activeTopToolRef.current === 'select',
      onMoveShouldSetPanResponder:  () => activeTopToolRef.current === 'select',

      onPanResponderGrant: (e) => {
        // If a handle Pressable already populated handleDragRef, use it.
        // Otherwise fall back to 'move' for body drags.
        if (!handleDragRef.current) {
          const selId = selectedLayerIdRef.current;
          if (!selId) return;
          const layer = layersRef.current.find(l => l.id === selId);
          if (!layer || layer.locked) return;
          const t = layer.transform;
          const sx = dispScaleXRef.current || 1;
          const sy = dispScaleYRef.current || 1;
          handleDragRef.current = {
            layerId: selId, kind: 'move',
            startX: e.nativeEvent.pageX, startY: e.nativeEvent.pageY,
            origX: t.x, origY: t.y, origW: t.width, origH: t.height,
            origRot: t.rotation ?? 0,
            cx: (t.x + t.width  / 2) * sx,
            cy: (t.y + t.height / 2) * sy,
          };
        }
      },

      onPanResponderMove: (e) => {
        const drag = handleDragRef.current;
        if (!drag) return;
        const sx = dispScaleXRef.current || 1;
        const sy = dispScaleYRef.current || 1;
        // Display deltas → logical deltas
        const ddx = e.nativeEvent.pageX - drag.startX;
        const ddy = e.nativeEvent.pageY - drag.startY;
        const dx = ddx / sx;
        const dy = ddy / sy;

        setLayers(prev => prev.map(l => {
          if (l.id !== drag.layerId) return l;
          const t = l.transform;
          const MIN = 32;

          if (drag.kind === 'move') {
            return { ...l, transform: { ...t, x: drag.origX + dx, y: drag.origY + dy } };
          }

          if (drag.kind === 'rotate') {
            // Compute angle from display-space centre to current touch
            const a0 = Math.atan2(drag.startY - drag.cy, drag.startX - drag.cx);
            const a1 = Math.atan2(e.nativeEvent.pageY - drag.cy, e.nativeEvent.pageX - drag.cx);
            const delta = (a1 - a0) * (180 / Math.PI);
            return { ...l, transform: { ...t, rotation: drag.origRot + delta } };
          }

          if (drag.kind === 'resize-br') {
            return { ...l, transform: { ...t,
              width:  Math.max(MIN, drag.origW + dx),
              height: Math.max(MIN, drag.origH + dy),
            }};
          }
          if (drag.kind === 'resize-tr') {
            const newH = Math.max(MIN, drag.origH - dy);
            return { ...l, transform: { ...t,
              y: drag.origY + drag.origH - newH,
              width:  Math.max(MIN, drag.origW + dx),
              height: newH,
            }};
          }
          if (drag.kind === 'resize-bl') {
            const newW = Math.max(MIN, drag.origW - dx);
            return { ...l, transform: { ...t,
              x: drag.origX + drag.origW - newW,
              width:  newW,
              height: Math.max(MIN, drag.origH + dy),
            }};
          }
          if (drag.kind === 'resize-tl') {
            const newW = Math.max(MIN, drag.origW - dx);
            const newH = Math.max(MIN, drag.origH - dy);
            return { ...l, transform: { ...t,
              x: drag.origX + drag.origW - newW,
              y: drag.origY + drag.origH - newH,
              width: newW, height: newH,
            }};
          }
          return l;
        }));
      },

      onPanResponderRelease: () => {
        if (handleDragRef.current) {
          handleDragRef.current = null;
          markDirty();
        }
      },
    })
  ).current;

  // ─── Selection PanResponder ─────────────────────────────────────────────────
  const selectionPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => activeTopToolRef.current === 'select' ||
        activeTopToolRef.current === 'adjustments',
      onMoveShouldSetPanResponder: () => activeTopToolRef.current === 'select' ||
        activeTopToolRef.current === 'adjustments',

      onPanResponderGrant: (e) => {
        const tool = activeTopToolRef.current;
        const sx = dispScaleXRef.current || 1;
        const sy = dispScaleYRef.current || 1;
        const lx = e.nativeEvent.locationX / sx;
        const ly = e.nativeEvent.locationY / sy;

        if (tool === 'adjustments') {
          // Liquify push stroke recording
          liquifyStrokeRef.current = [{ x: lx, y: ly }];
          return;
        }

        const mode = selectionModeRef.current;
        if (mode === 'automatic') {
          // Immediate hit-test on grant
          const region = automaticSelection(
            { x: lx, y: ly },
            layersRef.current,
            selectionFeatherRef.current,
          );
          setSelectionRegion(region);
          if (region?.layerId) {
            setSelectedLayerId(region.layerId);
          }
        } else if (mode === 'rectangle' || mode === 'ellipse') {
          selectionDragStart.current = { x: lx, y: ly };
          setSelectionRegion(null);
        } else if (mode === 'freehand') {
          lassoPointsRef.current = [{ x: lx, y: ly }];
          setSelectionRegion(null);
        }
      },

      onPanResponderMove: (e) => {
        const tool = activeTopToolRef.current;
        const sx = dispScaleXRef.current || 1;
        const sy = dispScaleYRef.current || 1;
        const lx = e.nativeEvent.locationX / sx;
        const ly = e.nativeEvent.locationY / sy;

        if (tool === 'adjustments') {
          liquifyStrokeRef.current.push({ x: lx, y: ly });
          return;
        }

        const mode = selectionModeRef.current;
        if ((mode === 'rectangle' || mode === 'ellipse') && selectionDragStart.current) {
          const rect = rectFromPoints(selectionDragStart.current, { x: lx, y: ly });
          setSelectionRegion({ kind: mode, rect, feather: selectionFeatherRef.current });
        } else if (mode === 'freehand') {
          lassoPointsRef.current.push({ x: lx, y: ly });
          setSelectionRegion({
            kind: 'freehand',
            points: [...lassoPointsRef.current],
            closed: false,
            feather: selectionFeatherRef.current,
          });
        }
      },

      onPanResponderRelease: (e) => {
        const tool = activeTopToolRef.current;
        const sx = dispScaleXRef.current || 1;
        const sy = dispScaleYRef.current || 1;
        const lx = e.nativeEvent.locationX / sx;
        const ly = e.nativeEvent.locationY / sy;

        if (tool === 'adjustments') {
          // Commit liquify push stroke to selected layer
          const selId = selectedLayerIdRef.current;
          if (selId && liquifyStrokeRef.current.length >= 2) {
            const stroke: LiquifyPushStroke = {
              points:     liquifyStrokeRef.current,
              size:       liquifySizeRef.current,
              pressure:   liquifyPressureRef.current,
              distortion: liquifyDistortionRef.current,
              momentum:   liquifyMomentumRef.current,
            };
            mutateLayer(prev => prev.map(l => {
              if (l.id !== selId) return l;
              const existing = (l.adjustments?.liquify?.strokes ?? []);
              const newStrokes = [...existing, stroke];
              const { dx, dy } = netLiquifyDisplacement(newStrokes);
              return {
                ...l,
                transform: { ...l.transform, liquifyDx: dx, liquifyDy: dy },
                adjustments: {
                  ...l.adjustments,
                  liquify: { strokes: newStrokes },
                },
              };
            }));
          }
          liquifyStrokeRef.current = [];
          return;
        }

        const mode = selectionModeRef.current;
        if (mode === 'freehand' && lassoPointsRef.current.length >= 3) {
          setSelectionRegion({
            kind: 'freehand',
            points: [...lassoPointsRef.current],
            closed: true,
            feather: selectionFeatherRef.current,
          });
          lassoPointsRef.current = [];
        } else if (mode === 'rectangle' || mode === 'ellipse') {
          selectionDragStart.current = null;
        }
      },
    })
  ).current;

  // Stable refs for selectionPanResponder closures
  const selectionModeRef    = useRef(selectionMode);
  const selectionFeatherRef = useRef(selectionFeather);
  const liquifySizeRef      = useRef(liquifySize);
  const liquifyPressureRef  = useRef(liquifyPressure);
  const liquifyDistortionRef = useRef(liquifyDistortion);
  const liquifyMomentumRef  = useRef(liquifyMomentum);
  selectionModeRef.current     = selectionMode;
  selectionFeatherRef.current  = selectionFeather;
  liquifySizeRef.current       = liquifySize;
  liquifyPressureRef.current   = liquifyPressure;
  liquifyDistortionRef.current = liquifyDistortion;
  liquifyMomentumRef.current   = liquifyMomentum;

  // ─── Extended transform PanResponder (8 handles + distort/warp) ─────────────
  const extTransformPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => activeTopToolRef.current === 'transform',
      onMoveShouldSetPanResponder:  () => activeTopToolRef.current === 'transform',

      onPanResponderGrant: (e) => {
        const selId = selectedLayerIdRef.current;
        if (!selId) return;
        const layer = layersRef.current.find(l => l.id === selId);
        if (!layer || layer.locked) return;
        const kind = pendingExtHandleRef.current;
        extHandleDragRef.current = {
          layerId: selId,
          kind,
          startX: e.nativeEvent.pageX,
          startY: e.nativeEvent.pageY,
          origTransform: { ...layer.transform },
          origQuad: distortQuadRef.current ? { ...distortQuadRef.current } : null,
          origMesh: warpMeshRef.current ? [...warpMeshRef.current] : null,
        };
      },

      onPanResponderMove: (e) => {
        const drag = extHandleDragRef.current;
        if (!drag) return;
        const sx = dispScaleXRef.current || 1;
        const sy = dispScaleYRef.current || 1;
        const ddx = (e.nativeEvent.pageX - drag.startX) / sx;
        const ddy = (e.nativeEvent.pageY - drag.startY) / sy;
        const mode = transformModeRef.current;

        setLayers(prev => prev.map(l => {
          if (l.id !== drag.layerId) return l;
          const orig = drag.origTransform;

          if (mode === 'freeform') {
            const newT = applyFreeformHandle(orig, drag.kind, ddx, ddy, transformSnapEnabledRef.current);
            return { ...l, transform: { ...newT, affineSvgMatrix: undefined } };
          }
          if (mode === 'uniform') {
            const newT = applyUniformHandle(orig, drag.kind, ddx, ddy, transformSnapEnabledRef.current);
            return { ...l, transform: { ...newT, affineSvgMatrix: undefined } };
          }
          if (mode === 'distort') {
            const quad = drag.origQuad ?? transformToQuad(orig);
            const newQuad = applyDistortHandle(quad, drag.kind, ddx, ddy);
            setDistortQuad(newQuad);
            distortQuadRef.current = newQuad;
            const matrix = deriveAffineFromQuad(orig, newQuad);
            return {
              ...l,
              transform: {
                ...orig,
                affineSvgMatrix: matrix,
                distortQuad: JSON.stringify(newQuad),
              },
            };
          }
          if (mode === 'warp') {
            const mesh = drag.origMesh ?? defaultWarpMesh(orig);
            const newMesh = applyWarpHandle(mesh, drag.kind, ddx, ddy);
            setWarpMesh(newMesh);
            warpMeshRef.current = newMesh;
            const matrix = deriveAffineFromWarpMesh(orig, newMesh);
            return {
              ...l,
              transform: {
                ...orig,
                affineSvgMatrix: matrix,
                warpMesh: JSON.stringify(newMesh),
              },
            };
          }
          return l;
        }));
      },

      onPanResponderRelease: () => {
        if (extHandleDragRef.current) {
          extHandleDragRef.current = null;
          markDirty();
        }
        // Always reset handle to 'move' so next gesture starts fresh
        pendingExtHandleRef.current = 'move';
      },

      onPanResponderTerminate: () => {
        extHandleDragRef.current = null;
        // Reset handle on responder steal
        pendingExtHandleRef.current = 'move';
      },
    })
  ).current;

  const transformModeRef      = useRef(transformMode);
  const transformSnapEnabledRef = useRef(transformSnapEnabled);
  transformModeRef.current      = transformMode;
  transformSnapEnabledRef.current = transformSnapEnabled;

  // Distort: move one corner of the quad by (ddx, ddy) logical units.
  function applyDistortHandle(q: DistortQuad, kind: ExtHandleKind, ddx: number, ddy: number): DistortQuad {
    const nq = { ...q, tl: { ...q.tl }, tr: { ...q.tr }, bl: { ...q.bl }, br: { ...q.br } };
    if (kind === 'tl') {
      nq.tl = { x: q.tl.x + ddx, y: q.tl.y + ddy };
    } else if (kind === 'tr') {
      nq.tr = { x: q.tr.x + ddx, y: q.tr.y + ddy };
    } else if (kind === 'bl') {
      nq.bl = { x: q.bl.x + ddx, y: q.bl.y + ddy };
    } else if (kind === 'br') {
      nq.br = { x: q.br.x + ddx, y: q.br.y + ddy };
    } else if (kind === 'tc') {
      // Top edge: move both top corners equally (vertical drag mainly)
      nq.tl = { x: q.tl.x + ddx, y: q.tl.y + ddy };
      nq.tr = { x: q.tr.x + ddx, y: q.tr.y + ddy };
    } else if (kind === 'bc') {
      // Bottom edge: move both bottom corners equally
      nq.bl = { x: q.bl.x + ddx, y: q.bl.y + ddy };
      nq.br = { x: q.br.x + ddx, y: q.br.y + ddy };
    } else if (kind === 'ml') {
      // Left edge: move both left corners equally
      nq.tl = { x: q.tl.x + ddx, y: q.tl.y + ddy };
      nq.bl = { x: q.bl.x + ddx, y: q.bl.y + ddy };
    } else if (kind === 'mr') {
      // Right edge: move both right corners equally
      nq.tr = { x: q.tr.x + ddx, y: q.tr.y + ddy };
      nq.br = { x: q.br.x + ddx, y: q.br.y + ddy };
    } else if (kind === 'move') {
      nq.tl = { x: q.tl.x + ddx, y: q.tl.y + ddy };
      nq.tr = { x: q.tr.x + ddx, y: q.tr.y + ddy };
      nq.bl = { x: q.bl.x + ddx, y: q.bl.y + ddy };
      nq.br = { x: q.br.x + ddx, y: q.br.y + ddy };
    }
    return nq;
  }

  // Warp: move a mesh control point by (ddx, ddy)
  function applyWarpHandle(mesh: WarpMeshPoint[], kind: ExtHandleKind, ddx: number, ddy: number): WarpMeshPoint[] {
    // Map handle kind to row/col
    const map: Partial<Record<ExtHandleKind, [number, number]>> = {
      tl: [0, 0], tc: [0, 1], tr: [0, 2],
      ml: [1, 0],             mr: [1, 2],
      bl: [2, 0], bc: [2, 1], br: [2, 2],
    };
    const rc = map[kind];
    if (!rc) {
      // move: translate all
      return mesh.map(p => ({ ...p, x: p.x + ddx, y: p.y + ddy }));
    }
    const [row, col] = rc;
    return mesh.map(p => p.row === row && p.col === col
      ? { ...p, x: p.x + ddx, y: p.y + ddy }
      : p,
    );
  }

  // ─── Left size slider PanResponder ─────────────────────────────────────────
  const sizePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,
      onPanResponderGrant: (e) => {
        setSizeSliderDragging(true);
        sizeSliderYRef.current = e.nativeEvent.pageY;
      },
      onPanResponderMove: (e) => {
        const dy = sizeSliderYRef.current - e.nativeEvent.pageY;
        const pct = Math.max(0, Math.min(1, dy / sizeSliderHeightRef.current + 0.5));
        const tool = activeTopToolRef.current;
        if (tool === 'eraser')       setEraserSize(Math.max(2, Math.round(pct * 80)));
        else if (tool === 'smudge')  setSmudgeSize(Math.max(2, Math.round(pct * 80)));
        else                         setBrushSize(Math.max(1, Math.round(pct * 80)));
        sizeSliderYRef.current = e.nativeEvent.pageY;
      },
      onPanResponderRelease: () => setSizeSliderDragging(false),
    })
  ).current;

  // ─── Layer actions ─────────────────────────────────────────────────────────
  function handleAddDrawingLayer() {
    const lw = project?.canvas.width  || canvasSize.w || 1080;
    const lh = project?.canvas.height || canvasSize.h || 1080;
    const maxOrder = layers.reduce((m, l) => Math.max(m, l.order), 0);
    const newLayer: DesignLayer = {
      id: uid(), name: 'Layer', type: 'drawing',
      visible: true, locked: false, order: maxOrder + 1,
      transform: { x: 0, y: 0, width: lw, height: lh, rotation: 0, scaleX: 1, scaleY: 1 },
      data: { kind: 'drawing', paths: [] } as DesignDrawingLayer,
      opacity: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mutateLayer(prev => [...prev, newLayer]);
    setSelectedLayerId(newLayer.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }

  function handleDeleteLayer(id: string) {
    Alert.alert('Delete Layer', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        mutateLayer(prev => prev.filter(l => l.id !== id));
        if (selectedLayerId === id) setSelectedLayerId(null);
        closeSheet();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }},
    ]);
  }

  function handleDuplicateLayer(id: string) {
    const src = layers.find(l => l.id === id);
    if (!src) return;
    const maxOrder = layers.reduce((m, l) => Math.max(m, l.order), 0);
    const dup: DesignLayer = {
      ...src, id: uid(), name: src.name + ' copy', order: maxOrder + 1,
      transform: { ...src.transform, x: src.transform.x + 16, y: src.transform.y + 16 },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    mutateLayer(prev => [...prev, dup]);
    setSelectedLayerId(dup.id);
    closeSheet();
  }

  function handleMergeLayers() {
    const drawingLayers = layers.filter(l => l.type === 'drawing');
    if (drawingLayers.length < 2) { Alert.alert('Merge', 'Need at least 2 drawing layers.'); return; }
    const allPaths = drawingLayers.flatMap(l => (l.data as DesignDrawingLayer).paths);
    const maxOrder = drawingLayers.reduce((m, l) => Math.max(m, l.order), 0);
    const merged: DesignLayer = {
      ...drawingLayers[0], id: uid(), name: 'Merged', order: maxOrder,
      data: { kind: 'drawing', paths: allPaths } as DesignDrawingLayer,
      updatedAt: new Date().toISOString(),
    };
    mutateLayer(prev => [...prev.filter(l => l.type !== 'drawing'), merged]);
    setSelectedLayerId(merged.id);
    closeSheet();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  function handleMoveLayerUp(id: string) {
    mutateLayer(prev => {
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex(l => l.id === id);
      if (idx < sorted.length - 1) [sorted[idx].order, sorted[idx + 1].order] = [sorted[idx + 1].order, sorted[idx].order];
      return sorted;
    });
  }

  function handleMoveLayerDown(id: string) {
    mutateLayer(prev => {
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex(l => l.id === id);
      if (idx > 0) [sorted[idx].order, sorted[idx - 1].order] = [sorted[idx - 1].order, sorted[idx].order];
      return sorted;
    });
  }

  // ─── Text layer actions ────────────────────────────────────────────────────
  function handleAddText(
    content: string, fontSize: number, color: string,
    bold: boolean, italic: boolean, align: 'left'|'center'|'right', fontFamily: string,
  ) {
    if (!content.trim()) return;
    const maxOrder = layers.reduce((m, l) => Math.max(m, l.order), 0);
    // Place text in logical canvas coordinates
    const lw = project?.canvas.width || 1080;
    const newLayer: DesignLayer = {
      id: uid(), name: 'Text', type: 'text',
      visible: true, locked: false, order: maxOrder + 1,
      transform: { x: 50, y: 120, width: Math.min(lw - 100, 400), height: 80, rotation: 0, scaleX: 1, scaleY: 1 },
      data: { kind: 'text', content, fontFamily, fontSize, bold, italic, underline: false, align, color, letterSpacing: 0, lineHeight: 1.4 } as DesignTextLayer,
      opacity: 1,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    mutateLayer(prev => [...prev, newLayer]);
    setSelectedLayerId(newLayer.id);
    closeSheet();
  }

  // ─── Image copy — platform-safe ────────────────────────────────────────────
  async function persistPickerImage(pickerUri: string): Promise<string> {
    return makeDurableUri(pickerUri);
  }

  async function handleAddImage() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset   = result.assets[0];
      const localUri = await persistPickerImage(asset.uri);
      const lw = project?.canvas.width  || 1080;
      const lh = project?.canvas.height || 1080;
      const maxOrder = layers.reduce((m, l) => Math.max(m, l.order), 0);
      // Default image size in logical coords: 60% canvas width
      const tw = Math.round(lw * 0.6);
      const th = asset.height && asset.width ? Math.round((tw / asset.width) * asset.height) : tw;
      const newLayer: DesignLayer = {
        id: uid(), name: 'Photo', type: 'image',
        visible: true, locked: false, order: maxOrder + 1,
        transform: {
          x: Math.round((lw - tw) / 2), y: 60,
          width: tw, height: th, rotation: 0, scaleX: 1, scaleY: 1,
        },
        data: { kind: 'image', uri: localUri, opacity: 1, fit: 'contain', blendMode: 'normal' } as DesignImageLayer,
        opacity: 1,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      mutateLayer(prev => [...prev, newLayer]);
      setSelectedLayerId(newLayer.id);
      closeSheet();
    } catch {
      Alert.alert('Error', 'Could not access photo library.');
    }
  }

  // ─── Canvas Resize / Crop ──────────────────────────────────────────────────
  function handleApplyResize() {
    const newW = Number(resizeW.trim());
    const newH = Number(resizeH.trim());
    if (!Number.isSafeInteger(newW) || !Number.isSafeInteger(newH) ||
        newW < 8 || newH < 8 || newW > 16384 || newH > 16384) {
      Alert.alert(
        'Invalid size',
        'Width and height must be whole pixels between 8 and 16384. The canvas will not be silently downscaled.',
      );
      return;
    }
    if (!project) return;
    const oldW = project.canvas.width  || canvasSize.w || 1080;
    const oldH = project.canvas.height || canvasSize.h || 1080;
    const sx = newW / oldW;
    const sy = newH / oldH;
    // Scale all layer transforms proportionally (they're in logical coords)
    mutateLayer(prev => prev.map(l => ({
      ...l,
      transform: {
        ...l.transform,
        x:      l.transform.x      * sx,
        y:      l.transform.y      * sy,
        width:  l.transform.width  * sx,
        height: l.transform.height * sy,
      },
    })));
    // Also scale crop rect if active
    if (cropRect) {
      setCropRect(cr => {
        if (!cr) return cr;
        const x = Math.max(0, Math.min(newW - 1, Math.round(cr.x * sx)));
        const y = Math.max(0, Math.min(newH - 1, Math.round(cr.y * sy)));
        const right = Math.max(x + 1, Math.min(newW, Math.round((cr.x + cr.w) * sx)));
        const bottom = Math.max(y + 1, Math.min(newH, Math.round((cr.y + cr.h) * sy)));
        return { x, y, w: right - x, h: bottom - y };
      });
    }
    setProject(p => p ? { ...p, canvas: { ...p.canvas, width: newW, height: newH } } : p);
    markDirty();
    closeSheet();
    Alert.alert('Canvas resized', `${newW} × ${newH} px — layer positions scaled proportionally.`);
  }

  function handleSetCrop() {
    const lw = project?.canvas.width  || canvasSize.w || 1080;
    const lh = project?.canvas.height || canvasSize.h || 1080;
    // Default crop: 80% safe-area centred on logical canvas
    const margin = 0.1;
    const x = Math.round(lw * margin);
    const y = Math.round(lh * margin);
    const newCrop = {
      x,
      y,
      w: lw - (2 * x),
      h: lh - (2 * y),
    };
    setCropRect(newCrop);
    markDirty();
    Alert.alert(
      'Crop guides set',
      `${newCrop.w}×${newCrop.h}px crop will be applied to PNG export and shown as red guides on canvas.`,
    );
    closeSheet();
  }

  function handleClearCrop() {
    setCropRect(null);
    markDirty();
    Alert.alert('Crop cleared', 'Export will use the full canvas dimensions.');
  }

  // ─── Flip transforms ──────────────────────────────────────────────────────
  /**
   * applyFlipX / applyFlipY — ONE representation model.
   *
   * The ONLY thing these functions do is:
   *   1. Relocate bounds (new_x = canvasW - x - width) so selection handles
   *      and hit-testing land in the mirrored position.
   *   2. Toggle transform.flipX / flipY so the compositor and renderLayerInSvg
   *      both apply translate(cx,0) scale(-1,1) translate(-cx,0) once.
   *
   * They do NOT rewrite drawing path coordinates.  The SVG mirror transform
   * wraps the entire layer group — ink paths AND the eraser <Mask> — so the
   * mask mirrors with the ink without any data mutation.  This gives one
   * representation (the flag) shared by preview, export, compositor, gallery
   * thumbnail, undo/redo, and save/load.
   *
   * A second flip is the exact inverse: bounds and flag both revert.
   */
  function applyFlipX() {
    const lw = project?.canvas.width || canvasSizeRef.current.w || 1080;
    mutateLayer(prev => prev.map(l => {
      const t = l.transform;
      return { ...l, transform: { ...t, x: lw - t.x - t.width, flipX: !t.flipX } };
    }));
    setCanvasFlipX(v => !v);
    markDirty();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }

  function applyFlipY() {
    const lh = project?.canvas.height || canvasSizeRef.current.h || 1080;
    mutateLayer(prev => prev.map(l => {
      const t = l.transform;
      return { ...l, transform: { ...t, y: lh - t.y - t.height, flipY: !t.flipY } };
    }));
    setCanvasFlipY(v => !v);
    markDirty();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }

  // ─── Animation / Onion-Skin ───────────────────────────────────────────────
  function animAddFrame() {
    const snap = JSON.stringify(layersRef.current);
    setAnimFrames(prev => {
      const next = [...prev, snap];
      animFramesRef.current = next;
      return next;
    });
    setAnimCurrentFrame(prev => {
      const f = animFrames.length; // index of new frame
      animCurrentFrameRef.current = f;
      return f;
    });
    markDirty();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function animGoToFrame(idx: number) {
    const frames = animFramesRef.current;
    if (idx < 0 || idx >= frames.length) return;
    const snap = frames[idx];
    try {
      const parsed: DesignLayer[] = JSON.parse(snap);
      pushUndo(layersRef.current);
      setLayers(parsed);
      setAnimCurrentFrame(idx);
      animCurrentFrameRef.current = idx;
      markDirty();
    } catch { /* invalid snapshot */ }
  }

  // ─── Adjustments: curves mutations ───────────────────────────────────────
  function updateLayerCurves(layerId: string, curves: CurvesAdjustment) {
    // Persist curves adjustment only — opacity is not modified.
    // The feColorMatrix filter in renderLayerInSvg/compositor applies the real
    // per-channel colour effect, so no opacity shortcut is needed or wanted.
    mutateLayer(prev => prev.map(l => {
      if (l.id !== layerId) return l;
      return {
        ...l,
        adjustments: { ...l.adjustments, curves },
      };
    }));
    markDirty();
  }

  function resetLayerAdjustments(layerId: string) {
    mutateLayer(prev => prev.map(l => {
      if (l.id !== layerId) return l;
      return { ...l, opacity: 1, adjustments: undefined };
    }));
  }

  // ─── QuickMenu action dispatch ────────────────────────────────────────────
  function dispatchQuickAction(action: QuickMenuAction) {
    setQuickMenuVisible(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    switch (action) {
      case 'undo':             handleUndo(); break;
      case 'redo':             handleRedo(); break;
      case 'brush':            selectTool('brush'); break;
      case 'eraser':           selectTool('eraser'); break;
      case 'smudge':           selectTool('smudge'); break;
      case 'select':           selectTool('select'); break;
      case 'transform':        selectTool('transform'); break;
      case 'add_layer':        handleAddDrawingLayer(); break;
      case 'delete_layer':     if (selectedLayerId) handleDeleteLayer(selectedLayerId); break;
      case 'duplicate_layer':  if (selectedLayerId) handleDuplicateLayer(selectedLayerId); break;
      case 'copy':             handleCopyLayer(); break;
      case 'paste':            handlePaste(); break;
      case 'cut':              handleCut(); break;
      case 'flip_x':           applyFlipX(); break;
      case 'flip_y':           applyFlipY(); break;
      case 'color_picker':     openSheet('color'); break;
      case 'adjustments':      selectTool('adjustments'); openSheet('adjustments'); break;
      default: break;
    }
  }

  // ─── Cut / Copy / Paste for selected layers ───────────────────────────────
  function handleCut() {
    const selId = selectedLayerId;
    if (!selId) { Alert.alert('Nothing selected', 'Select a layer first.'); return; }
    const layer = layers.find(l => l.id === selId);
    if (!layer) return;
    setClipboard([layer]);
    mutateLayer(prev => prev.filter(l => l.id !== selId));
    setSelectedLayerId(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }

  function handleCopyLayer() {
    const selId = selectedLayerId;
    if (!selId) { Alert.alert('Nothing selected', 'Select a layer first.'); return; }
    const layer = layers.find(l => l.id === selId);
    if (!layer) return;
    setClipboard([{ ...layer }]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function handleCopyCanvas() {
    // Snapshot all current layers as clipboard (does NOT mutate original)
    const snap = JSON.parse(JSON.stringify(layers)) as DesignLayer[];
    setClipboard(snap);
    Alert.alert('Canvas copied', 'Paste to create a copy of the current composition.');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function handlePaste() {
    if (!clipboard || clipboard.length === 0) {
      Alert.alert('Nothing to paste', 'Copy or cut a layer first.');
      return;
    }
    const maxOrder = layers.reduce((m, l) => Math.max(m, l.order), 0);
    const pasted = clipboard.map((l, i) => ({
      ...l,
      id: uid(),
      order: maxOrder + i + 1,
      transform: { ...l.transform, x: l.transform.x + 16, y: l.transform.y + 16 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    mutateLayer(prev => [...prev, ...pasted]);
    if (pasted.length === 1) setSelectedLayerId(pasted[0].id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }

  // ─── Insert File via DocumentPicker ──────────────────────────────────────
  async function handleInsertFile() {
    let result: DocumentPicker.DocumentPickerResult;
    try {
      result = await DocumentPicker.getDocumentAsync({
        type: DOCUMENT_PICKER_TYPES,
        copyToCacheDirectory: true,
        multiple: false,
      });
    } catch {
      Alert.alert('Picker error', 'Could not open the document picker. Try again.');
      return;
    }

    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    const mime  = asset.mimeType ?? '';
    const uri   = asset.uri;

    // ── Step 1: Strict MIME + extension pair check ───────────────────────────
    const pairResult = validateMimeExtPair(mime || null, asset.name);
    if (!pairResult.ok) {
      Alert.alert('Unsupported file', pairResult.reason);
      return;
    }

    // ── JSON import ─────────────────────────────────────────────────────────
    if (mime === 'application/json' || asset.name.toLowerCase().endsWith('.json')) {
      try {
        const fileObj = new File(uri);
        const raw     = await fileObj.text();

        // Step 2: Actual byte-length gate — guards against missing/false metadata.
        const sizeResult = validateJsonByteLength(raw);
        if (!sizeResult.ok) {
          Alert.alert('File too large', sizeResult.reason);
          return;
        }

        // Step 3: Strict JSON + schema validation — no unsafe casts.
        const jsonResult = validateBtJson(raw);
        if (!jsonResult.ok) {
          Alert.alert('Cannot import', jsonResult.reason);
          return;
        }

        const validatedLayers: DesignLayer[] = (jsonResult as { ok: true; layers: DesignLayer[] }).layers;
        const maxOrder = layersRef.current.reduce((m, l) => Math.max(m, l.order), 0);
        const incoming = validatedLayers.map((l: DesignLayer, i: number) => ({
          ...l,
          order: maxOrder + i + 1,
        }));

        pushUndo(layersRef.current);
        mutateLayer(prev => [...prev, ...incoming]);
        markDirty();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
          'Imported',
          `${incoming.length} layer${incoming.length === 1 ? '' : 's'} added from "${asset.name}".`,
        );
      } catch (e) {
        Alert.alert('Import error', "That file couldn't be opened. Try a PNG, JPG or Brandthread file.");
      }
      return;
    }

    // ── Image import ─────────────────────────────────────────────────────────
    // MIME+ext pair already validated above.  Now inspect magic bytes before
    // calling makeDurableUri — we never persist unvalidated file content.
    try {
      const fileObj   = new File(uri);
      const buf       = await fileObj.arrayBuffer();
      const bytes     = new Uint8Array(buf, 0, Math.min(buf.byteLength, 16));
      const magicResult = validateMagicBytes(bytes, mime);
      if (!magicResult.ok) {
        Alert.alert('Rejected', magicResult.reason);
        return;
      }

      const durableUri = await makeDurableUri(uri, asset.name.split('.').pop() ?? 'png');
      const lw = project?.canvas.width  || 1080;
      const lh = project?.canvas.height || 1080;
      const maxOrder = layersRef.current.reduce((m, l) => Math.max(m, l.order), 0);
      const tw = Math.round(lw * 0.8);
      const newLayer: DesignLayer = {
        id: uid(),
        name: asset.name || 'Imported image',
        type: 'image',
        visible: true,
        locked: false,
        order: maxOrder + 1,
        transform: {
          x: Math.round((lw - tw) / 2),
          y: Math.round(lh * 0.1),
          width: tw,
          height: tw,
          rotation: 0, scaleX: 1, scaleY: 1,
        },
        data: { kind: 'image', uri: durableUri, opacity: 1, fit: 'contain', blendMode: 'normal' } as DesignImageLayer,
        opacity: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      mutateLayer(prev => [...prev, newLayer]);
      setSelectedLayerId(newLayer.id);
      markDirty();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (e) {
      Alert.alert('Import error', "That file couldn't be opened. Try a PNG, JPG or Brandthread file.");
    }
  }

  // ─── Reference image ──────────────────────────────────────────────────────
  async function handlePickReferenceImage() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const uri = await makeDurableUri(result.assets[0].uri);
      setReferenceUri(uri);
      refUriRef.current = uri;
      setReferenceVisible(true);
      markDirty();
    } catch {
      Alert.alert('Error', 'Could not load reference image.');
    }
  }

  // Reference pan responder for dragging the reference window
  const referencePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        refDragRef.current = {
          startPageX: e.nativeEvent.pageX,
          startPageY: e.nativeEvent.pageY,
          origX: refPosition.x,
          origY: refPosition.y,
        };
      },
      onPanResponderMove: (e) => {
        if (!refDragRef.current) return;
        const dx = e.nativeEvent.pageX - refDragRef.current.startPageX;
        const dy = e.nativeEvent.pageY - refDragRef.current.startPageY;
        setRefPosition({
          x: Math.max(0, refDragRef.current.origX + dx),
          y: Math.max(0, refDragRef.current.origY + dy),
        });
      },
      onPanResponderRelease: () => { refDragRef.current = null; },
    })
  ).current;

  // ─── Save a copy (duplicate project) ──────────────────────────────────────
  async function handleSaveCopy() {
    if (!project) return;
    try {
      // Flush latest gen first — duplicateProject reads from the persisted project.
      await coordinatedSave();
      const copy = await duplicateProject(project.id);
      Alert.alert('Saved', `"${copy.name}" saved to your gallery.`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('Error', 'Could not save a copy.');
    }
  }

  // ─── Brandthread flow actions ─────────────────────────────────────────────

  /**
   * triggerWebDownload — programmatically download a data URL in the browser.
   * Reuses the same anchor-click pattern as handleExport.
   */
  function triggerWebDownload(dataUrl: string, filename: string) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function handleUseAsProductPhoto() {
    if (!project) return;
    closeSheet();
    setExporting(true);
    try {
      // Full-resolution PNG — never display fallback
      const desc   = buildMasterDescriptor();
      const base64 = await captureFullResolutionPngBase64(desc);
      const slug   = (projectName || 'design').replace(/\s+/g, '_');

      if (Platform.OS === 'web') {
        const dataUrl = `data:image/png;base64,${base64}`;
        await verifyExportDimensionsWeb(dataUrl, desc);
        const asset: MasterExportAsset = {
          uri: dataUrl, mimeType: 'image/png',
          width: desc.width, height: desc.height, format: 'png', lossless: true,
        };
        triggerWebDownload(asset.uri, `${slug}_product.png`);
        void syncVerifiedDesignAsset(project.id, asset, 'master').catch(() => {});
        Alert.alert(
          'Design downloaded',
          `Your full-resolution PNG (${desc.width}×${desc.height}) has been downloaded. ` +
          'Upload it as the product photo in your Seller dashboard.',
          [{ text: 'OK' }],
        );
        return;
      }

      // Native: write PNG, verify, save to Camera Roll
      const localUri = await writePngToDocument(base64, '_product');
      await verifyExportDimensionsNative(localUri, desc, RNImage.getSize.bind(RNImage));
      const asset: MasterExportAsset = {
        uri: localUri, mimeType: 'image/png',
        width: desc.width, height: desc.height, format: 'png', lossless: true,
      };
      await saveImageToMediaLibrary(asset.uri);
      void syncVerifiedDesignAsset(project.id, asset, 'master').catch(() => {});
      Alert.alert(
        'Saved to Camera Roll',
        `Full-resolution PNG (${desc.width}×${desc.height}) saved. ` +
        'Open "Add Product" in the Seller tab and select it as your product photo.',
        [{ text: 'OK' }],
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error('[design-canvas] export failed', err);
      Alert.alert('Export failed', "Couldn't save your design. Try again.");
    } finally {
      setExporting(false);
    }
  }

  async function handleUseInPost() {
    if (!project) return;
    closeSheet();
    setExporting(true);
    try {
      // Full-resolution PNG — never display fallback
      const desc   = buildMasterDescriptor();
      const base64 = await captureFullResolutionPngBase64(desc);
      const slug   = (projectName || 'design').replace(/\s+/g, '_');

      if (Platform.OS === 'web') {
        const dataUrl = `data:image/png;base64,${base64}`;
        await verifyExportDimensionsWeb(dataUrl, desc);
        const asset: MasterExportAsset = {
          uri: dataUrl, mimeType: 'image/png',
          width: desc.width, height: desc.height, format: 'png', lossless: true,
        };
        triggerWebDownload(asset.uri, `${slug}_post.png`);
        void syncVerifiedDesignAsset(project.id, asset, 'master').catch(() => {});
        Alert.alert(
          'Design downloaded',
          `Full-resolution PNG (${desc.width}×${desc.height}) downloaded. ` +
          'Attach it when composing your Thread post.',
          [{ text: 'OK' }],
        );
        return;
      }

      // Native: write PNG, verify, save to Camera Roll
      const localUri = await writePngToDocument(base64, '_post');
      await verifyExportDimensionsNative(localUri, desc, RNImage.getSize.bind(RNImage));
      const asset: MasterExportAsset = {
        uri: localUri, mimeType: 'image/png',
        width: desc.width, height: desc.height, format: 'png', lossless: true,
      };
      await saveImageToMediaLibrary(asset.uri);
      void syncVerifiedDesignAsset(project.id, asset, 'master').catch(() => {});
      Alert.alert(
        'Saved to Camera Roll',
        `Full-resolution PNG (${desc.width}×${desc.height}) saved. ` +
        'Open the Thread composer and select it to create a post.',
        [{ text: 'OK' }],
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error('[design-canvas] export failed', err);
      Alert.alert('Export failed', "Couldn't save your design. Try again.");
    } finally {
      setExporting(false);
    }
  }

  // ─── Save/export ───────────────────────────────────────────────────────────

  /**
   * handleManualSave — persists the current state first (via coordinatedSave so
   * any in-flight write completes), then creates a version from what was actually
   * persisted.  If a mutation races before/during version creation the project
   * remains dirty and the next autosave picks it up; we never falsely mark clean.
   */
  async function handleManualSave() {
    if (!project) return;
    try {
      // 1. Ensure latest gen is on disk before we snapshot.
      await coordinatedSave();
      // 2. Create version from the persisted snapshot.
      await createVersion(project.id);
      // 3. If a mutation raced while createVersion was running, stay dirty.
      //    The next autosave / user press will persist the new edits.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setSaveStatus('unsaved');
      Alert.alert(
        'Could not save',
        'Your latest edits are still on this screen. Try saving again before leaving.',
      );
    }
  }

  async function handleBack() {
    try {
      // Normal route navigation does not trigger AppState backgrounding. Roll
      // the active timer into persisted totals before the save coordinator
      // decides whether there is anything dirty to write.
      if (prefsRef.current.timer.sessionStartMs !== null) {
        const paused = { ...prefsRef.current, timer: timerPause(prefsRef.current.timer) };
        prefsRef.current = paused;
        setPrefs(paused);
        dirtyGenRef.current += 1;
        setSaveStatus('unsaved');
      }
      await coordinatedSave();
      router.back();
    } catch {
      setSaveStatus('unsaved');
      Alert.alert(
        'Save failed',
        'Your latest edits have not been saved. Try again before leaving the canvas.',
      );
    }
  }

  /**
   * captureFullResolutionPngBase64 — capture the off-screen export SVG at
   * EXACT logical dimensions described by `desc`, returning a raw base64 PNG string.
   *
   * CONTRACT:
   *   - `desc` MUST have been produced by `resolveMasterDescriptor` (already validated).
   *   - The width/height passed to `toDataURL` are ALWAYS `desc.width` / `desc.height`.
   *   - NEVER uses `canvasSize` (display pixels). If `project` is not loaded yet,
   *     the call rejects rather than silently falling back to screen size.
   *   - No quality option — PNG is always lossless.
   */
  function captureFullResolutionPngBase64(desc: MasterDescriptor): Promise<string> {
    return new Promise((resolve, reject) => {
      const svg = exportSvgRef.current;
      if (!svg || typeof svg.toDataURL !== 'function') {
        reject(new Error('Canvas is not ready. Draw something first, then try again.'));
        return;
      }
      svg.toDataURL((b64: string) => {
        if (!b64 || b64.length === 0) {
          reject(new Error('Capture returned empty data — the canvas may be blank.'));
          return;
        }
        resolve(b64);
      }, { width: desc.width, height: desc.height });
    });
  }

  /**
   * buildMasterDescriptor — resolve and validate export dimensions for the
   * currently-loaded project.  Throws ExportDimensionError if dimensions are
   * invalid or if no project is loaded (which would force a display-canvas fallback).
   */
  function buildMasterDescriptor(): MasterDescriptor {
    if (!project) {
      throw new ExportDimensionError(
        'No project loaded — cannot resolve master dimensions. ' +
        'Wait for the project to finish loading before exporting.',
      );
    }
    return resolveMasterDescriptor(
      project.canvas.width,
      project.canvas.height,
      cropRectRef.current,
    );
  }

  /**
   * Write base64 PNG to app-owned persistent document storage.
   * Uses explicit EncodingType.Base64 so decoded bytes are written correctly.
   */
  async function writePngToDocument(base64: string, suffix = ''): Promise<string> {
    const slug = (projectName || 'design').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const filename = `${slug}_${Date.now()}${suffix}.png`;
    const file = new File(Paths.document, filename);
    file.write(base64, { encoding: EncodingType.Base64 });
    return file.uri;
  }

  /**
   * webExportDataUrl — encode a PNG base64 string to the requested format on web.
   *
   * For PNG: returns the data URL as-is (no re-encode, no quality loss).
   * For JPEG: re-encodes at MASTER_JPEG_QUALITY (clamped to ≥ MIN_JPEG_QUALITY).
   *
   * `desc` is used only for verification after JPEG encode; PNG is not re-encoded.
   */
  async function webExportDataUrl(
    base64: string,
    format: 'png' | 'jpeg',
    desc: MasterDescriptor,
  ): Promise<string> {
    const pngDataUrl = `data:image/png;base64,${base64}`;
    if (format === 'png') {
      // Verify PNG dimensions before returning (does not alter bytes)
      await verifyExportDimensionsWeb(pngDataUrl, desc);
      return pngDataUrl;
    }
    // JPEG: re-encode at the policy quality floor
    const quality = clampJpegQuality(MASTER_JPEG_QUALITY);
    return new Promise((resolve, reject) => {
      const image = new window.Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('JPEG encoding is unavailable in this browser.'));
          return;
        }
        context.drawImage(image, 0, 0);
        const jpegDataUrl = canvas.toDataURL('image/jpeg', quality);
        // Verify JPEG dimensions
        verifyExportDimensionsWeb(jpegDataUrl, desc)
          .then(() => resolve(jpegDataUrl))
          .catch(reject);
      };
      image.onerror = () => reject(new Error('Could not prepare the canvas for JPEG export.'));
      image.src = pngDataUrl;
    });
  }

  async function handleExport(format: 'png' | 'jpeg') {
    if (exporting || !project) return;
    const exportingProjectId = project.id;
    closeSheet();
    await new Promise<void>(r => setTimeout(r, 220));
    setExporting(true);
    try {
      // 1. Resolve and validate exact output dimensions from project (never display).
      const desc = buildMasterDescriptor();

      // 2. Capture at exact logical dimensions.
      const base64 = await captureFullResolutionPngBase64(desc);

      // 3. Build the MasterExportAsset descriptor for downstream.
      let asset: MasterExportAsset;

      if (Platform.OS === 'web') {
        // Encode (verifies dimensions internally)
        const dataUrl = await webExportDataUrl(base64, format, desc);
        asset = {
          uri: dataUrl,
          mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
          width: desc.width,
          height: desc.height,
          format,
          lossless: format === 'png',
          quality: format === 'jpeg' ? clampJpegQuality(MASTER_JPEG_QUALITY) : undefined,
        };
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `${(projectName || 'design').replace(/\s+/g, '_')}.${format === 'jpeg' ? 'jpg' : 'png'}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        void syncVerifiedDesignAsset(exportingProjectId, asset, 'master').catch(() => {});
        return;
      }

      // Native: write PNG (no actions array = no resize/crop/downsample)
      let localUri = await writePngToDocument(base64);
      let mimeType: 'image/png' | 'image/jpeg' = 'image/png';

      if (format === 'jpeg') {
        // PNG → JPEG re-encode: empty actions array guarantees no resize.
        const quality = clampJpegQuality(MASTER_JPEG_QUALITY);
        const jpegResult = await ImageManipulator.manipulateAsync(
          localUri,
          [],  // ← MUST be empty: absolutely no resize/crop/downsample
          { compress: quality, format: ImageManipulator.SaveFormat.JPEG },
        );
        try { new File(localUri).delete(); } catch { /* best-effort */ }
        localUri = jpegResult.uri;
        mimeType = 'image/jpeg';
        // Verify JPEG dimensions (no re-encode in getSize)
        await verifyExportDimensionsNative(localUri, desc, RNImage.getSize.bind(RNImage));
      } else {
        // Verify PNG dimensions
        await verifyExportDimensionsNative(localUri, desc, RNImage.getSize.bind(RNImage));
      }

      asset = {
        uri: localUri,
        mimeType,
        width: desc.width,
        height: desc.height,
        format,
        lossless: format === 'png',
        quality: format === 'jpeg' ? clampJpegQuality(MASTER_JPEG_QUALITY) : undefined,
      };

      const uti = format === 'jpeg' ? 'public.jpeg' : 'public.png';
      const mediaSaveResult = await saveImageToMediaLibrary(asset.uri);

      if (mediaSaveResult !== 'saved') {
        const sharingAvailable = await Sharing.isAvailableAsync();
        if (sharingAvailable) {
          await Sharing.shareAsync(asset.uri, { mimeType: asset.mimeType, dialogTitle: `Export ${projectName}`, UTI: uti });
        } else {
          Alert.alert('Permission required', 'Allow media-library access in Settings to save the export.');
        }
        return;
      }

      const sharingAvailable = await Sharing.isAvailableAsync();
      if (sharingAvailable) {
        await Sharing.shareAsync(asset.uri, { mimeType: asset.mimeType, dialogTitle: `Share ${projectName}`, UTI: uti });
      } else {
        const suffix = desc.hasCrop ? ' (cropped)' : '';
        Alert.alert('Saved to Camera Roll', `"${projectName}" saved as ${format.toUpperCase()}${suffix}.`, [{ text: 'OK' }]);
      }

      await syncVerifiedDesignAsset(exportingProjectId, asset, 'master').catch(() => {});
      try { new File(asset.uri).delete(); } catch { /* best-effort */ }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: unknown) {
      console.error('[design-canvas] export failed', err);
      Alert.alert('Export failed', "Couldn't save your design. Try again.", [{ text: 'OK' }]);
    } finally {
      setExporting(false);
    }
  }

  async function handleShare() {
    closeSheet();
    if (exporting) return;
    await new Promise<void>(r => setTimeout(r, 220));
    setExporting(true);
    try {
      // Resolve exact dimensions — never display fallback
      const desc = buildMasterDescriptor();
      const base64 = await captureFullResolutionPngBase64(desc);

      if (Platform.OS === 'web') {
        const dataUrl = `data:image/png;base64,${base64}`;
        // Verify PNG dimensions on web
        await verifyExportDimensionsWeb(dataUrl, desc);
        const asset: MasterExportAsset = {
          uri: dataUrl,
          mimeType: 'image/png',
          width: desc.width,
          height: desc.height,
          format: 'png',
          lossless: true,
        };
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `${(projectName || 'design').replace(/\s+/g, '_')}_share.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        void syncVerifiedDesignAsset(project!.id, asset, 'master').catch(() => {});
        return;
      }

      const localUri = await writePngToDocument(base64, '_share');
      // Verify PNG dimensions on native
      await verifyExportDimensionsNative(localUri, desc, RNImage.getSize.bind(RNImage));

      const asset: MasterExportAsset = {
        uri: localUri,
        mimeType: 'image/png',
        width: desc.width,
        height: desc.height,
        format: 'png',
        lossless: true,
      };

      const available = await Sharing.isAvailableAsync();
      if (!available) { Alert.alert('Sharing unavailable', 'System share sheet is not available.'); return; }
      await Sharing.shareAsync(asset.uri, { mimeType: 'image/png', dialogTitle: `Share ${projectName}`, UTI: 'public.png' });
      await syncVerifiedDesignAsset(project!.id, asset, 'master').catch(() => {});
      try { new File(asset.uri).delete(); } catch { /* best-effort */ }
    } catch (err: unknown) {
      console.error('[design-canvas] share failed', err);
      Alert.alert('Share failed', "Couldn't open sharing. Try again.", [{ text: 'OK' }]);
    } finally {
      setExporting(false);
    }
  }

  // ─── Color helpers ─────────────────────────────────────────────────────────
  function hueToHex(hue: number, saturation = 1, value = discBrightness): string {
    const h = hue / 60; const i = Math.floor(h); const f = h - i;
    const p = value * (1 - saturation), q = value * (1 - saturation * f), t = value * (1 - saturation * (1 - f));
    let r = 0, g = 0, b = 0;
    switch (i % 6) {
      case 0: r = value; g = t; b = p; break;
      case 1: r = q; g = value; b = p; break;
      case 2: r = p; g = value; b = t; break;
      case 3: r = p; g = q; b = value; break;
      case 4: r = t; g = p; b = value; break;
      case 5: r = value; g = p; b = q; break;
    }
    const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function applyColor(hex: string) {
    setPrevColor(drawColor); setDrawColor(hex);
    setPickerHex(hex.replace('#', '').toUpperCase());
  }

  // ─── Sorted layers ─────────────────────────────────────────────────────────
  const sortedLayers = useMemo(() =>
    [...layers].sort((a, b) => a.order - b.order), [layers]);

  const selectedLayer = useMemo(() =>
    layers.find(l => l.id === selectedLayerId) ?? null, [layers, selectedLayerId]);

  const layerOptionsLayer = useMemo(() =>
    layers.find(l => l.id === layerOptionsTarget) ?? null, [layers, layerOptionsTarget]);

  const activeBrush = BRUSH_LIBRARY[brushIdx] ?? BRUSH_LIBRARY[3];
  const activeSize  = activeTopTool === 'eraser' ? eraserSize : activeTopTool === 'smudge' ? smudgeSize : brushSize;

  // Logical → display scale
  const logicalW = project?.canvas.width  || canvasSize.w || 1080;
  const logicalH = project?.canvas.height || canvasSize.h || 1080;
  const exportX = cropRect?.x ?? 0;
  const exportY = cropRect?.y ?? 0;
  const exportW = cropRect?.w ?? logicalW;
  const exportH = cropRect?.h ?? logicalH;
  const dispScaleX = canvasSize.w > 0 ? canvasSize.w / logicalW : 1;
  const dispScaleY = canvasSize.h > 0 ? canvasSize.h / logicalH : 1;
  dispScaleXRef.current = dispScaleX;
  dispScaleYRef.current = dispScaleY;

  /**
   * Render a layer group inside an SVG.
   *
   * xScale/yScale = dispScaleX/Y for the on-screen compositor (converts logical → display px).
   * xScale/yScale = 1.0 for the export SVG (renders at logical dimensions, viewBox matches).
   *
   * ERASER: Uses SVG <Mask> (not ClipPath):
   *   - White filled rect covers full canvas → ink shows through
   *   - Black-stroked eraser paths punch holes (black = transparent in luminance mask)
   *   - Ink path group references mask via mask="url(#maskId)"
   * Stroke widths are stored in logical units; scaled by xScale/yScale for display.
   */
  function renderLayerInSvg(
    layer: DesignLayer,
    xScale: number,
    yScale: number,
    bgHex: string,
    isExport: boolean,
  ): React.ReactNode {
    if (!layer.visible) return null;
    const t = layer.transform;

    // ── Shared transform: affine→liquify→rotation→flip (same logic as compositor) ──
    const transformAttr = buildLayerTransform(t, xScale, yScale);

    // ── Curves filter: feColorMatrix applied to all layer types ──
    const curvesAdj = layer.adjustments?.curves;
    const hasRealCurves = curvesAdj && !isIdentityCurves(curvesAdj);
    const filterId = hasRealCurves ? `cf_${layer.id.replace(/[^a-zA-Z0-9]/g, '_')}` : null;
    const matrixValues = hasRealCurves ? curvesToColorMatrixString(curvesAdj!) : null;
    // filterRef: typed as string (non-nullable) so it can be spread safely
    const filterRef: string | undefined = filterId ? `url(#${filterId})` : undefined;

    const blendModeForLayer = (bm: BlendModeKind | undefined): string | undefined =>
      bm && RN_SVG_BLEND_MODES.has(bm) && bm !== 'normal' ? bm : undefined;

    // ── Smudge overlay colour: use theme MUTED at low opacity, not hardcoded rgba ──
    const SMUDGE_STROKE = FG;
    const SMUDGE_OPACITY = 0.08;

    if (layer.type === 'drawing') {
      const d = layer.data as DesignDrawingLayer;
      const inkPaths   = d.paths.filter(p => p.color !== 'erase');
      const erasePaths = d.paths.filter(p => p.color === 'erase');
      const hasErase   = erasePaths.length > 0;
      const maskId     = `emask_${layer.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const scaledStroke = (w: number) => w * Math.min(xScale, yScale);

      const renderedInkPaths = d.paths.map((p, pi) => {
        if (p.color === 'erase') return null;
        if (p.color === 'smudge') return (
          <Path key={pi} d={p.d} stroke={SMUDGE_STROKE} strokeWidth={scaledStroke(p.width)}
            fill="none" strokeLinecap="round" strokeLinejoin="round"
            opacity={SMUDGE_OPACITY} />
        );
        return (
          <Path key={pi} d={p.d} stroke={p.color} strokeWidth={scaledStroke(p.width)}
            fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={p.opacity} />
        );
      });

      const LARGE = 99999;
      const innerContent = !hasErase ? (
        <G transform={transformAttr} filter={filterRef}>{renderedInkPaths}</G>
      ) : (
        <G transform={transformAttr} filter={filterRef}>
          <Defs>
            <SvgMask id={maskId} x={0} y={0} width="100%" height="100%">
              <Rect x={-LARGE / 2} y={-LARGE / 2} width={LARGE} height={LARGE} fill="white" />
              {erasePaths.map((p, pi) => (
                <Path key={`e${pi}`} d={p.d} stroke="black" strokeWidth={scaledStroke(p.width)}
                  strokeLinecap="round" strokeLinejoin="round" fill="none" />
              ))}
            </SvgMask>
          </Defs>
          <G mask={`url(#${maskId})`}>{renderedInkPaths}</G>
        </G>
      );

      return (
        <G key={layer.id} opacity={layer.opacity}>
          {hasRealCurves && !isExport && (
            <Defs>
              <Filter id={filterId!} x="0%" y="0%" width="100%" height="100%">
                <FeColorMatrix type="matrix" values={matrixValues!} />
              </Filter>
            </Defs>
          )}
          {hasRealCurves && isExport && (
            <Defs>
              <Filter id={filterId!} x="0%" y="0%" width="100%" height="100%">
                <FeColorMatrix type="matrix" values={matrixValues!} />
              </Filter>
            </Defs>
          )}
          {innerContent}
        </G>
      );
    }

    if (layer.type === 'image') {
      const d  = layer.data as DesignImageLayer;
      const bm = blendModeForLayer(d.blendMode as BlendModeKind | undefined);
      return (
        <G key={layer.id} opacity={layer.opacity * (d.opacity ?? 1)}>
          {hasRealCurves && (
            <Defs>
              <Filter id={filterId!} x="0%" y="0%" width="100%" height="100%">
                <FeColorMatrix type="matrix" values={matrixValues!} />
              </Filter>
            </Defs>
          )}
          <G transform={transformAttr} filter={filterRef} {...(bm ? { style: { mixBlendMode: bm } } : {})}>
            <SvgImage
              x={t.x * xScale} y={t.y * yScale}
              width={t.width * xScale} height={t.height * yScale}
              href={d.uri}
              preserveAspectRatio={d.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'}
            />
          </G>
        </G>
      );
    }

    if (layer.type === 'shape') {
      const d      = layer.data as DesignShapeLayer;
      const fill   = d.fill ?? d.fillColor ?? PURPLE;
      const stroke = d.stroke ?? d.strokeColor ?? 'transparent';
      const sw     = (d.strokeWidth ?? 0) * Math.min(xScale, yScale);
      if (d.shape === 'circle') {
        return (
          <G key={layer.id} opacity={layer.opacity}>
            {hasRealCurves && (
              <Defs>
                <Filter id={filterId!} x="0%" y="0%" width="100%" height="100%">
                  <FeColorMatrix type="matrix" values={matrixValues!} />
                </Filter>
              </Defs>
            )}
            <Circle
              cx={(t.x + t.width  / 2) * xScale} cy={(t.y + t.height / 2) * yScale}
              r={Math.min(t.width, t.height) / 2 * Math.min(xScale, yScale)}
              fill={fill} stroke={stroke} strokeWidth={sw}
              transform={transformAttr} filter={filterRef}
            />
          </G>
        );
      }
      return (
        <G key={layer.id} opacity={layer.opacity}>
          {hasRealCurves && (
            <Defs>
              <Filter id={filterId!} x="0%" y="0%" width="100%" height="100%">
                <FeColorMatrix type="matrix" values={matrixValues!} />
              </Filter>
            </Defs>
          )}
          <Rect
            x={t.x * xScale} y={t.y * yScale}
            width={t.width * xScale} height={t.height * yScale}
            rx={d.cornerRadius ?? 0}
            fill={fill} stroke={stroke} strokeWidth={sw}
            transform={transformAttr} filter={filterRef}
          />
        </G>
      );
    }

    if (layer.type === 'text') {
      const d = layer.data as DesignTextLayer;
      return (
        <G key={layer.id} opacity={layer.opacity}>
          {hasRealCurves && (
            <Defs>
              <Filter id={filterId!} x="0%" y="0%" width="100%" height="100%">
                <FeColorMatrix type="matrix" values={matrixValues!} />
              </Filter>
            </Defs>
          )}
          <SvgText
            x={(t.x + t.width / 2) * xScale} y={(t.y + (d.fontSize ?? 24)) * yScale}
            fill={d.color ?? d.textColor ?? FG}
            fontSize={(d.fontSize ?? 24) * Math.min(xScale, yScale)}
            textAnchor="middle"
            fontWeight={d.bold ? 'bold' : 'normal'}
            fontStyle={d.italic ? 'italic' : 'normal'}
            transform={transformAttr} filter={filterRef}
          >
            {d.content ?? d.text ?? ''}
          </SvgText>
        </G>
      );
    }

    return null;
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.root, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: MUTED, fontFamily: FONT.regular, fontSize: FS.base }}>Loading…</Text>
      </View>
    );
  }

  const bgHex = project?.canvas?.backgroundHex ?? BG;

  // ─── Selection handle positions (display px) ───────────────────────────────
  // Computed here so we can use them both in the SVG overlay and the Pressable overlays
  let handlePositions: { hx: number; hy: number; kind: HandleKind }[] = [];
  if (selectedLayer && activeTopTool === 'select') {
    const t  = selectedLayer.transform;
    const x  = t.x * dispScaleX;
    const y  = t.y * dispScaleY;
    const w  = t.width  * dispScaleX;
    const h  = t.height * dispScaleY;
    handlePositions = [
      { hx: x,         hy: y,         kind: 'resize-tl' },
      { hx: x + w,     hy: y,         kind: 'resize-tr' },
      { hx: x,         hy: y + h,     kind: 'resize-bl' },
      { hx: x + w,     hy: y + h,     kind: 'resize-br' },
      { hx: x + w / 2, hy: y - 24,    kind: 'rotate'    },
    ];
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>

      {/* ── TOP BAR ── */}
      <View style={[styles.topBar, { paddingTop: insets.top + 2 }]}>
        <View style={styles.topGroup}>
          <TouchableOpacity style={styles.topBtn} onPress={handleBack} testID="btn-back">
            <Feather name="chevron-left" size={ICON.md} color={FG} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.topBtn, activeSheet === 'wrench' && styles.topBtnActive]}
            onPress={() => openSheet('wrench')}
          >
            <Feather name="settings" size={ICON.sm} color={activeSheet === 'wrench' ? PURPLE_LIGHT : FG} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={() => setEditingName(true)} style={styles.topCenter}>
          {editingName ? (
            <TextInput
              style={styles.nameInput}
              value={projectName}
              onChangeText={setProjectName}
              onBlur={() => {
                setEditingName(false);
                // Name change: update ref, mark dirty; coordinator will persist.
                projectNameRef.current = projectName;
                if (projectRef.current) markDirty();
              }}
              autoFocus selectTextOnFocus
            />
          ) : (
            <Text style={styles.topTitle} numberOfLines={1}>{projectName || 'Untitled'}</Text>
          )}
        </TouchableOpacity>

        <View style={styles.topGroup}>
          <TouchableOpacity
            style={[styles.topBtn, undoStack.current.length === 0 && styles.topBtnDisabled]}
            onPress={handleUndo} testID="btn-undo"
          >
            <Feather name="corner-up-left" size={ICON.sm} color={undoStack.current.length === 0 ? SUBTLE : FG} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.topBtn, redoStack.current.length === 0 && styles.topBtnDisabled]}
            onPress={handleRedo} testID="btn-redo"
          >
            <Feather name="corner-up-right" size={ICON.sm} color={redoStack.current.length === 0 ? SUBTLE : FG} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.topBtn} onPress={handleManualSave} testID="btn-save">
            <Feather name="save" size={ICON.sm}
              color={saveStatus === 'unsaved' ? PURPLE_LIGHT : MUTED} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.topBtn} onPress={() => openSheet('export')}>
            <Feather name="share" size={ICON.sm} color={FG} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── TOOL ROW ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.toolRow}
        contentContainerStyle={styles.toolRowContent}
      >
        <TouchableOpacity
          style={[styles.toolChip, activeTopTool === 'brush' && styles.toolChipActive]}
          onPress={() => { selectTool('brush'); openSheet('brushLib'); }}
          onLongPress={() => openSheet('brushLib')}
          testID="btn-brush"
        >
          <Feather name="edit-2" size={ICON.sm} color={activeTopTool === 'brush' ? PURPLE_LIGHT : MUTED} />
          <Text style={[styles.toolChipLabel, activeTopTool === 'brush' && { color: PURPLE_LIGHT }]}>Brush</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.toolChip, activeTopTool === 'smudge' && styles.toolChipActive]}
          onPress={() => selectTool(activeTopTool === 'smudge' ? 'brush' : 'smudge')}
          testID="btn-smudge"
        >
          <Feather name="droplet" size={ICON.sm} color={activeTopTool === 'smudge' ? PURPLE_LIGHT : MUTED} />
          <Text style={[styles.toolChipLabel, activeTopTool === 'smudge' && { color: PURPLE_LIGHT }]}>Smudge</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.toolChip, activeTopTool === 'eraser' && styles.toolChipActive]}
          onPress={() => selectTool(activeTopTool === 'eraser' ? 'brush' : 'eraser')}
          testID="btn-eraser"
        >
          <Feather name="circle" size={ICON.sm} color={activeTopTool === 'eraser' ? PURPLE_LIGHT : MUTED} />
          <Text style={[styles.toolChipLabel, activeTopTool === 'eraser' && { color: PURPLE_LIGHT }]}>Eraser</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.toolChip, activeTopTool === 'select' && styles.toolChipActive]}
          onPress={() => selectTool(activeTopTool === 'select' ? 'brush' : 'select')}
          testID="btn-select"
        >
          <Feather name="move" size={ICON.sm} color={activeTopTool === 'select' ? PURPLE_LIGHT : MUTED} />
          <Text style={[styles.toolChipLabel, activeTopTool === 'select' && { color: PURPLE_LIGHT }]}>Select</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.toolChip, activeTopTool === 'transform' && styles.toolChipActive]}
          onPress={() => {
            const next = activeTopTool === 'transform' ? 'brush' : 'transform';
            selectTool(next as ActiveTopTool);
            if (next === 'transform' && selectedLayer) {
              setDistortQuad(null);
              setWarpMesh(null);
              setTransformMode('freeform');
            }
          }}
          testID="btn-transform"
        >
          <Feather name="maximize-2" size={ICON.sm} color={activeTopTool === 'transform' ? PURPLE_LIGHT : MUTED} />
          <Text style={[styles.toolChipLabel, activeTopTool === 'transform' && { color: PURPLE_LIGHT }]}>Transform</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.toolChip, activeTopTool === 'adjustments' && styles.toolChipActive]}
          onPress={() => {
            const next = activeTopTool === 'adjustments' ? 'brush' : 'adjustments';
            selectTool(next as ActiveTopTool);
            if (next === 'adjustments') openSheet('adjustments');
          }}
          testID="btn-adjustments"
        >
          <Feather name="sliders" size={ICON.sm} color={activeTopTool === 'adjustments' ? PURPLE_LIGHT : MUTED} />
          <Text style={[styles.toolChipLabel, activeTopTool === 'adjustments' && { color: PURPLE_LIGHT }]}>Adjust</Text>
        </TouchableOpacity>

        <View style={styles.toolDivider} />

        <TouchableOpacity
          style={[styles.toolChip, activeSheet === 'layers' && styles.toolChipActive]}
          onPress={() => activeSheet === 'layers' ? closeSheet() : openSheet('layers')}
          testID="btn-layers"
        >
          <Feather name="layers" size={ICON.sm} color={activeSheet === 'layers' ? PURPLE_LIGHT : MUTED} />
          <Text style={[styles.toolChipLabel, activeSheet === 'layers' && { color: PURPLE_LIGHT }]}>Layers</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.colorSwatch}
          onPress={() => activeSheet === 'color' ? closeSheet() : openSheet('color')}
          testID="btn-color"
        >
          <View style={[styles.colorSwatchInner, { backgroundColor: drawColor }]} />
        </TouchableOpacity>
      </ScrollView>

      {/* ── CANVAS AREA ── */}
      <View style={styles.canvasOuter}>

        {/* Left: size slider */}
        <View
          style={styles.sizeSlider}
          onLayout={e => { sizeSliderHeightRef.current = e.nativeEvent.layout.height; }}
          {...sizePanResponder.panHandlers}
        >
          <View style={[
            styles.sizeDisc,
            {
              width:  Math.max(8, Math.min(56, activeSize * 1.4)),
              height: Math.max(8, Math.min(56, activeSize * 1.4)),
              borderRadius: 999,
              backgroundColor: activeTopTool === 'eraser' ? CARD_ELEVATED : drawColor,
              borderColor: activeTopTool === 'eraser' ? FG : 'transparent',
              borderWidth: activeTopTool === 'eraser' ? 1.5 : 0,
            },
          ]} />
          <View style={styles.sizeTrack}>
            <View style={[styles.sizeFill, { height: `${(activeSize / 80) * 100}%` }]} />
          </View>
          {sizeSliderDragging && (
            <View style={styles.sizeBubble}>
              <Text style={styles.sizeBubbleText}>{activeSize}</Text>
            </View>
          )}
        </View>

        {/* Canvas-level touch listeners observe QuickMenu long-press while the
            active tool PanResponder retains gesture ownership. */}
        <View
          style={styles.canvas}
          onLayout={e => {
            const { width, height } = e.nativeEvent.layout;
            setCanvasSize({ w: width, h: height });
          }}
          onTouchStart={handleCanvasTouchStart}
          onTouchMove={handleCanvasTouchMove}
          onTouchEnd={cancelQuickMenuLongPress}
          onTouchCancel={cancelQuickMenuLongPress}
          {...(
            activeTopTool === 'select'      ? selectionPanResponder.panHandlers :
            activeTopTool === 'transform'   ? extTransformPanResponder.panHandlers :
            activeTopTool === 'adjustments' ? selectionPanResponder.panHandlers :
            drawPanResponder.panHandlers
          )}
        >
          {/* Grid — uses guideSettings.gridEnabled; legacy showGrid also supported */}
          {(showGrid || guideSettings.gridEnabled) && canvasSize.w > 0 && (() => {
            const gs   = guideSettings.gridSize;
            const op   = guideSettings.gridOpacity;
            // Use theme BORDER color with opacity applied via SVG opacity prop
            return (
              <Svg style={StyleSheet.absoluteFill} width={canvasSize.w} height={canvasSize.h} pointerEvents="none">
                <G opacity={showGrid ? 0.5 : op}>
                  {Array.from({ length: Math.floor(canvasSize.w / gs) + 1 }, (_, i) => (
                    <Line key={`vg${i}`} x1={i * gs} y1={0} x2={i * gs} y2={canvasSize.h} stroke={FG} strokeWidth={0.5} />
                  ))}
                  {Array.from({ length: Math.floor(canvasSize.h / gs) + 1 }, (_, i) => (
                    <Line key={`hg${i}`} x1={0} y1={i * gs} x2={canvasSize.w} y2={i * gs} stroke={FG} strokeWidth={0.5} />
                  ))}
                </G>
              </Svg>
            );
          })()}

          {/* Symmetry guides — vertical, horizontal, quadrant; excluded from export */}
          {(guideSettings.symVertical || guideSettings.symHorizontal || guideSettings.symQuadrant) && canvasSize.w > 0 && (
            <Svg style={StyleSheet.absoluteFill} width={canvasSize.w} height={canvasSize.h} pointerEvents="none">
              {(guideSettings.symVertical || guideSettings.symQuadrant) && (
                <Line
                  x1={canvasSize.w / 2} y1={0} x2={canvasSize.w / 2} y2={canvasSize.h}
                  stroke={MUTED} strokeWidth={1} strokeDasharray="8,4" opacity={0.7}
                />
              )}
              {(guideSettings.symHorizontal || guideSettings.symQuadrant) && (
                <Line
                  x1={0} y1={canvasSize.h / 2} x2={canvasSize.w} y2={canvasSize.h / 2}
                  stroke={MUTED} strokeWidth={1} strokeDasharray="8,4" opacity={0.7}
                />
              )}
            </Svg>
          )}

          {/* Legacy drawing guide (showGuides) */}
          {showGuides && canvasSize.w > 0 && (
            <Svg style={StyleSheet.absoluteFill} width={canvasSize.w} height={canvasSize.h} pointerEvents="none">
              <Rect
                x={canvasSize.w * 0.05} y={canvasSize.h * 0.05}
                width={canvasSize.w * 0.9} height={canvasSize.h * 0.9}
                fill="none" stroke={BORDER_ACTIVE} strokeWidth={1} strokeDasharray="6,4"
              />
            </Svg>
          )}

          {/* ── UNIFIED COMPOSITOR: all layers in z-order, display scale ── */}
          {canvasSize.w > 0 && (
            <Svg
              style={StyleSheet.absoluteFill}
              width={canvasSize.w}
              height={canvasSize.h}
              pointerEvents="none"
            >
              {/* Canvas background */}
              <Rect x={0} y={0} width={canvasSize.w} height={canvasSize.h} fill={bgHex} />

              {/* Layer paths and live strokes are stored in logical coordinates. */}
              <G transform={`scale(${dispScaleX} ${dispScaleY})`}>
                {sortedLayers.map(layer =>
                  renderLayerInSvg(layer, 1, 1, bgHex, false)
                )}

                {currentPath !== '' && (
                  currentIsErase ? (
                    <Path
                      d={currentPath}
                      stroke={BORDER_ACTIVE}
                      strokeWidth={currentEraseWidth}
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray="4,4"
                      opacity={0.6}
                    />
                  ) : (
                    <Path
                      d={currentPath}
                      stroke={activeTopTool === 'smudge' ? FG : drawColor}
                      strokeWidth={activeSize * activeBrush.widthMult}
                      fill="none"
                      strokeLinecap={activeBrush.linecap}
                      strokeLinejoin="round"
                      opacity={brushOpacity * activeBrush.opacityMult}
                    />
                  )
                )}
              </G>

              {/* Onion-skin: previous frame at reduced opacity (excluded from export) */}
              {animEnabled && animCurrentFrame > 0 && animFrames[animCurrentFrame - 1] && (() => {
                try {
                  const prevLayers: DesignLayer[] = JSON.parse(animFrames[animCurrentFrame - 1]);
                  const prevSorted = [...prevLayers].sort((a, b) => a.order - b.order);
                  return (
                    <G opacity={0.25}>
                      {prevSorted.map(l => renderLayerInSvg(l, 1, 1, bgHex, false))}
                    </G>
                  );
                } catch { return null; }
              })()}

              {/* Crop guides overlay (red dashed rect, logical → display) */}
              {cropRect && (
                <Rect
                  x={cropRect.x * dispScaleX} y={cropRect.y * dispScaleY}
                  width={cropRect.w * dispScaleX} height={cropRect.h * dispScaleY}
                  fill="none" stroke={RED} strokeWidth={1.5} strokeDasharray="6,3"
                />
              )}

              {/* ── SELECTION REGION — marching ants (display only, excluded from export) */}
              {selectionRegion && (() => {
                const antsOffset = marchingAntsOffset(antsTick * 80);
                const [dash, gap] = ANTS_DASH_PATTERN;
                if (selectionRegion.kind === 'freehand') {
                  const pathD = lassoPathD(selectionRegion.points, dispScaleX, dispScaleY, selectionRegion.closed);
                  return pathD ? (
                    <Path d={pathD} fill="none" stroke={BORDER_ACTIVE}
                      strokeWidth={1.5} strokeDasharray={`${dash},${gap}`}
                      strokeDashoffset={-antsOffset} opacity={0.85}
                    />
                  ) : null;
                }
                const r = selectionRegion.rect;
                const rx = r.x * dispScaleX, ry = r.y * dispScaleY;
                const rw = r.w * dispScaleX, rh = r.h * dispScaleY;
                if (selectionRegion.kind === 'ellipse') {
                  return (
                    <Circle cx={rx + rw / 2} cy={ry + rh / 2} r={Math.min(rw, rh) / 2}
                      fill="none" stroke={BORDER_ACTIVE}
                      strokeWidth={1.5} strokeDasharray={`${dash},${gap}`}
                      strokeDashoffset={-antsOffset} opacity={0.85}
                    />
                  );
                }
                return (
                  <Rect x={rx} y={ry} width={rw} height={rh}
                    fill={FG} fillOpacity={0.04} stroke={BORDER_ACTIVE}
                    strokeWidth={1.5} strokeDasharray={`${dash},${gap}`}
                    strokeDashoffset={-antsOffset} opacity={0.85}
                  />
                );
              })()}

              {/* Selection bounding box (legacy select tool — when no region active) */}
              {selectedLayer && activeTopTool === 'select' && !selectionRegion && (() => {
                const t   = selectedLayer.transform;
                const x   = t.x * dispScaleX;
                const y   = t.y * dispScaleY;
                const w   = t.width  * dispScaleX;
                const h   = t.height * dispScaleY;
                const cx2 = x + w / 2;
                const rot = t.rotation ?? 0;
                const xform = rot !== 0
                  ? `rotate(${rot.toFixed(2)},${(x + w / 2).toFixed(1)},${(y + h / 2).toFixed(1)})`
                  : undefined;
                const VS = 9;
                return (
                  <G key="sel-overlay" transform={xform}>
                    <Rect
                      x={x - 4} y={y - 4} width={w + 8} height={h + 8}
                      fill="none" stroke={PURPLE_LIGHT} strokeWidth={1.5} strokeDasharray="5,3"
                    />
                    <Line x1={cx2} y1={y - 4} x2={cx2} y2={y - 22}
                      stroke={PURPLE_LIGHT} strokeWidth={1.5} />
                    {/* Resize/rotate handles are intentionally not drawn here: the
                        pan responder that would make them draggable only lives on the
                        Transform tool. Use the Transform tool to resize or rotate. */}
                  </G>
                );
              })()}

              {/* ── TRANSFORM TOOL 8-handle overlay ── */}
              {selectedLayer && activeTopTool === 'transform' && (() => {
                const handles = computeHandlePositions(selectedLayer.transform);
                const VS = 10;
                const t = selectedLayer.transform;
                const rot = t.rotation ?? 0;
                const cx = (t.x + t.width  / 2) * dispScaleX;
                const cy = (t.y + t.height / 2) * dispScaleY;
                const xform = rot !== 0
                  ? `rotate(${rot.toFixed(2)},${cx.toFixed(1)},${cy.toFixed(1)})`
                  : undefined;
                return (
                  <G key="transform-overlay" transform={xform}>
                    <Rect
                      x={t.x * dispScaleX - 4} y={t.y * dispScaleY - 4}
                      width={t.width * dispScaleX + 8} height={t.height * dispScaleY + 8}
                      fill="none" stroke={PURPLE_LIGHT} strokeWidth={1}
                      strokeDasharray="4,3" opacity={0.7}
                    />
                    {handles.map(h => {
                      const hxD = h.lx * dispScaleX;
                      const hyD = h.ly * dispScaleY;
                      return (
                        <Rect
                          key={h.kind}
                          x={hxD - VS / 2} y={hyD - VS / 2}
                          width={VS} height={VS}
                          rx={2}
                          fill={CARD_ELEVATED} stroke={PURPLE_LIGHT} strokeWidth={1.5}
                        />
                      );
                    })}
                    {/* Warp mesh grid lines */}
                    {transformMode === 'warp' && warpMesh && warpMesh.map((p, pi) => (
                      <Circle key={`wp${pi}`}
                        cx={p.x * dispScaleX} cy={p.y * dispScaleY}
                        r={5} fill={CARD_ELEVATED} stroke={PURPLE_LIGHT} strokeWidth={1.5}
                      />
                    ))}
                    {/* Distort quad corners */}
                    {transformMode === 'distort' && distortQuad && (
                      [distortQuad.tl, distortQuad.tr, distortQuad.bl, distortQuad.br].map((pt, pi) => (
                        <Circle key={`dp${pi}`}
                          cx={pt.x * dispScaleX} cy={pt.y * dispScaleY}
                          r={6} fill={RED} stroke={BORDER_ACTIVE} strokeWidth={1.5}
                        />
                      ))
                    )}
                  </G>
                );
              })()}

              {/* ── BRUSH CURSOR (display-only, excluded from export) ── */}
              {prefs.brushCursor !== 'none' &&
               (activeTopTool === 'brush' || activeTopTool === 'eraser' || activeTopTool === 'smudge') &&
               brushCursorPos && (() => {
                 // Pressure-adjusted radius: samplePressureCurve × activeSize × brush.widthMult / 2
                 const pressureMult = samplePressureCurve(prefs.pressureCurve, lastStrokeForceRef.current);
                 const brush = resolveActiveBrush();
                 const radiusPx = (activeSize * brush.widthMult * pressureMult) / 2;
                 const cx = brushCursorPos.x;
                 const cy = brushCursorPos.y;

                 if (prefs.brushCursor === 'crosshair') {
                   const CS = Math.max(8, radiusPx);
                   return (
                     <G key="brush-cursor" opacity={0.6}>
                       <Line x1={cx - CS} y1={cy} x2={cx + CS} y2={cy}
                         stroke={FG} strokeWidth={1} />
                       <Line x1={cx} y1={cy - CS} x2={cx} y2={cy + CS}
                         stroke={FG} strokeWidth={1} />
                     </G>
                   );
                 }
                 return (
                   <Circle key="brush-cursor"
                     cx={cx} cy={cy} r={Math.max(2, radiusPx)}
                     fill="none" stroke={FG} strokeWidth={1} opacity={0.55}
                   />
                 );
               })()}

            </Svg>
          )}

          {/* ── EXTENDED TRANSFORM HANDLE PRESSABLE OVERLAYS (8 handles) ── */}
          {selectedLayer && activeTopTool === 'transform' && (() => {
            const handles = computeHandlePositions(selectedLayer.transform);
            return handles.map(h => (
              <Pressable
                key={h.kind}
                style={[
                  styles.handlePressable,
                  {
                    left:   h.lx * dispScaleX - HS / 2,
                    top:    h.ly * dispScaleY - HS / 2,
                    width:  HS,
                    height: HS,
                  },
                ]}
                onPressIn={() => { pendingExtHandleRef.current = h.kind; }}
              />
            ));
          })()}

          {/* Select mode intentionally has no handle Pressables: transformPanResponder
              (the responder that would make them draggable) is only attached for the
              Transform tool, so drawing interactive-looking handles here would be fake
              UI. Resize/rotate lives on the Transform tool. */}

          {/* ── EXPORT SVG (off-screen, logical dimensions, for toDataURL) ──
              Uses logical dimensions and scale=1.
              viewBox matches canvas so export output is exact logical size.
          */}
          {canvasSize.w > 0 && (
            <Svg
              ref={exportSvgRef}
              style={[StyleSheet.absoluteFill, { opacity: 0 }]}
              width={exportW}
              height={exportH}
              viewBox={`${exportX} ${exportY} ${exportW} ${exportH}`}
              pointerEvents="none"
            >
              <Rect x={0} y={0} width={logicalW} height={logicalH} fill={bgHex} />
              {/* Garment guide/template layers (layer.isTemplate) are a non-exportable
                  placement aid and are always excluded from the flattened export. */}
              {sortedLayers.filter(layer => !layer.isTemplate).map(layer =>
                renderLayerInSvg(layer, 1, 1, bgHex, true)
              )}
            </Svg>
          )}

          {/* Inline text editing overlay */}
          {editingTextLayerId && (() => {
            const layer = layers.find(l => l.id === editingTextLayerId);
            if (!layer) return null;
            const t = layer.transform;
            const d = layer.data as DesignTextLayer;
            return (
              <TextInput
                style={[
                  styles.inlineTextInput,
                  {
                    left: t.x * dispScaleX, top: t.y * dispScaleY,
                    width: t.width * dispScaleX,
                    fontSize: (d.fontSize ?? 24) * Math.min(dispScaleX, dispScaleY),
                    color: d.color ?? d.textColor ?? FG,
                    fontWeight: d.bold ? 'bold' : 'normal',
                    fontStyle: d.italic ? 'italic' : 'normal',
                    textAlign: d.align ?? d.alignment ?? 'center',
                    fontFamily: d.fontFamily ?? FONT.regular,
                  },
                ]}
                value={editingTextValue}
                onChangeText={v => {
                  setEditingTextValue(v);
                  mutateLayer(prev => prev.map(l =>
                    l.id === editingTextLayerId
                      ? { ...l, data: { ...(l.data as DesignTextLayer), content: v } }
                      : l,
                  ));
                }}
                onBlur={() => setEditingTextLayerId(null)}
                multiline autoFocus
              />
            );
          })()}

          {/* Reference image floating window */}
          {referenceVisible && referenceUri && (
            <View
              style={[
                styles.referenceWindow,
                { left: refPosition.x, top: refPosition.y, width: refSize.w, height: refSize.h },
              ]}
            >
              {/* Drag handle bar */}
              <View style={styles.refDragBar} {...referencePanResponder.panHandlers}>
                <Text style={styles.refDragLabel}>Reference</Text>
                <TouchableOpacity onPress={() => setReferenceVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Feather name="x" size={12} color={MUTED} />
                </TouchableOpacity>
              </View>
              <RNImage
                source={{ uri: referenceUri }}
                style={{ width: refSize.w, height: refSize.h - 22 }}
                resizeMode="contain"
              />
            </View>
          )}

          {/* Canvas overlay controls */}
          <View style={styles.canvasOverlay}>
            <TouchableOpacity
              style={[styles.overlayBtn, showGrid && styles.overlayBtnActive]}
              onPress={() => setShowGrid(v => !v)}
            >
              <Feather name="grid" size={12} color={showGrid ? FG : MUTED} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.overlayBtn, showGuides && styles.overlayBtnActive]}
              onPress={() => setShowGuides(v => !v)}
            >
              <Feather name="maximize" size={12} color={showGuides ? FG : MUTED} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.overlayBtn} onPress={() => openSheet('canvasInfo')}>
              <Feather name="info" size={12} color={MUTED} />
            </TouchableOpacity>
          </View>

          {/* Animation frame controls — shown when animEnabled */}
          {animEnabled && (
            <View style={styles.animBar}>
              <TouchableOpacity
                style={styles.animBtn}
                onPress={() => animGoToFrame(animCurrentFrame - 1)}
                disabled={animCurrentFrame === 0}
              >
                <Feather name="chevron-left" size={14} color={animCurrentFrame === 0 ? SUBTLE : FG} />
              </TouchableOpacity>
              <Text style={styles.animFrameLabel}>
                Frame {animCurrentFrame + 1}/{Math.max(1, animFrames.length)}
              </Text>
              <TouchableOpacity
                style={styles.animBtn}
                onPress={() => animGoToFrame(animCurrentFrame + 1)}
                disabled={animCurrentFrame >= animFrames.length - 1}
              >
                <Feather name="chevron-right" size={14} color={animCurrentFrame >= animFrames.length - 1 ? SUBTLE : FG} />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.animBtn, { marginLeft: SP.xs }]} onPress={animAddFrame}>
                <Feather name="plus" size={14} color={FG} />
                <Text style={styles.animAddLabel}>Frame</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── SELECTION MODE BAR ── */}
          {activeTopTool === 'select' && (
            <View style={styles.subModeBar} testID="selection-mode-bar">
              {(['automatic', 'freehand', 'rectangle', 'ellipse'] as SelectionSubMode[]).map(mode => (
                <TouchableOpacity
                  key={mode}
                  style={[styles.subModeChip, selectionMode === mode && styles.subModeChipActive]}
                  onPress={() => { setSelectionMode(mode); setSelectionRegion(null); }}
                  testID={`sel-mode-${mode}`}
                >
                  <Text style={[styles.subModeLabel, selectionMode === mode && styles.subModeLabelActive]}>
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.subModeChip}
                onPress={() => openSheet('selection')}
              >
                <Feather name="settings" size={12} color={MUTED} />
                <Text style={styles.subModeLabel}>Settings</Text>
              </TouchableOpacity>
              {selectionRegion && (
                <TouchableOpacity
                  style={[styles.subModeChip, { marginLeft: SP.sm }]}
                  onPress={() => setSelectionRegion(null)}
                  testID="selection-clear"
                >
                  <Feather name="x" size={12} color={MUTED} />
                  <Text style={styles.subModeLabel}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* ── TRANSFORM MODE BAR ── */}
          {activeTopTool === 'transform' && (
            <View style={styles.subModeBar} testID="transform-mode-bar">
              {(['freeform', 'uniform', 'distort', 'warp'] as TransformSubMode[]).map(mode => (
                <TouchableOpacity
                  key={mode}
                  style={[styles.subModeChip, transformMode === mode && styles.subModeChipActive]}
                  onPress={() => {
                    setTransformMode(mode);
                    if (mode === 'distort' && selectedLayer && !distortQuad) {
                      setDistortQuad(transformToQuad(selectedLayer.transform));
                    }
                    if (mode === 'warp' && selectedLayer && !warpMesh) {
                      setWarpMesh(defaultWarpMesh(selectedLayer.transform));
                    }
                  }}
                  testID={`transform-mode-${mode}`}
                >
                  <Text style={[styles.subModeLabel, transformMode === mode && styles.subModeLabelActive]}>
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.subModeChip}
                onPress={() => openSheet('transformTool')}
              >
                <Feather name="settings" size={12} color={MUTED} />
                <Text style={styles.subModeLabel}>Settings</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── ADJUSTMENTS MODE BAR ── */}
          {activeTopTool === 'adjustments' && (
            <View style={styles.subModeBar} testID="adjustments-mode-bar">
              <TouchableOpacity
                style={[styles.subModeChip, adjustmentsSubMode === 'curves' && styles.subModeChipActive]}
                onPress={() => { setAdjustmentsSubMode('curves'); openSheet('adjustments'); }}
                testID="adj-mode-curves"
              >
                <Text style={[styles.subModeLabel, adjustmentsSubMode === 'curves' && styles.subModeLabelActive]}>Curves</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.subModeChip, adjustmentsSubMode === 'liquify' && styles.subModeChipActive]}
                onPress={() => { setAdjustmentsSubMode('liquify'); closeSheet(); }}
                testID="adj-mode-liquify"
              >
                <Text style={[styles.subModeLabel, adjustmentsSubMode === 'liquify' && styles.subModeLabelActive]}>Liquify</Text>
              </TouchableOpacity>
              {selectedLayer && (
                <TouchableOpacity
                  style={[styles.subModeChip, { marginLeft: SP.sm }]}
                  onPress={() => { if (selectedLayer) resetLayerAdjustments(selectedLayer.id); }}
                >
                  <Feather name="refresh-cw" size={12} color={MUTED} />
                  <Text style={styles.subModeLabel}>Reset</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Add text/photo buttons */}
          <View style={styles.canvasAddBar}>
            <TouchableOpacity
              style={styles.canvasAddBtn}
              onPress={() => openSheet('text')} testID="btn-add-text"
            >
              <Feather name="type" size={ICON.xs} color={FG} />
              <Text style={styles.canvasAddLabel}>Text</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.canvasAddBtn}
              onPress={handleAddImage} testID="btn-add-image"
            >
              <Feather name="image" size={ICON.xs} color={FG} />
              <Text style={styles.canvasAddLabel}>Photo</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* ── SELECTION BAR ── */}
      {selectedLayer && activeTopTool === 'select' && (
        <View style={styles.selBar}>
          {selectedLayer.type === 'text' && (
            <TouchableOpacity style={styles.selBtn} onPress={() => {
              setEditingTextLayerId(selectedLayer.id);
              setEditingTextValue((selectedLayer.data as DesignTextLayer).content ?? (selectedLayer.data as DesignTextLayer).text ?? '');
            }}>
              <Feather name="edit-3" size={12} color={FG} />
              <Text style={styles.selBtnText}>Edit</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.selBtn} onPress={() => handleDuplicateLayer(selectedLayerId!)}>
            <Feather name="copy" size={12} color={FG} />
            <Text style={styles.selBtnText}>Duplicate</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.selBtn} onPress={() => handleMoveLayerUp(selectedLayerId!)}>
            <Feather name="arrow-up" size={12} color={FG} />
            <Text style={styles.selBtnText}>Forward</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.selBtn} onPress={() => handleMoveLayerDown(selectedLayerId!)}>
            <Feather name="arrow-down" size={12} color={FG} />
            <Text style={styles.selBtnText}>Back</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.selBtn} onPress={() => selectedLayerId && handleDeleteLayer(selectedLayerId)}>
            <Feather name="trash-2" size={12} color={RED} />
            <Text style={[styles.selBtnText, { color: RED }]}>Delete</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.selBtn} onPress={() => {
            if (selectedLayerId) {
              setLayerOptionsTarget(selectedLayerId);
              const layer = layers.find(l => l.id === selectedLayerId);
              if (layer) {
                setLayerEditOpacity(layer.opacity);
                const bm = (layer.data as DesignImageLayer).blendMode ?? 'normal';
                setLayerEditBlend(bm as BlendModeKind);
              }
              openSheet('layerOptions');
            }
          }}>
            <Feather name="sliders" size={12} color={FG} />
            <Text style={styles.selBtnText}>Options</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={{ height: insets.bottom, backgroundColor: SURFACE }} />

      {/* ════════════════════════════════════════════════════════════════════════
          BOTTOM SHEETS
         ════════════════════════════════════════════════════════════════════════ */}

      {/* ── WRENCH / ACTIONS — full tabbed bottom sheet ── */}
      <WrenchActionsSheet
        visible={activeSheet === 'wrench'}
        onClose={closeSheet}
        wrenchTab={wrenchTab}
        setWrenchTab={setWrenchTab}
        selectedLayerId={selectedLayerId}
        // ADD tab
        onInsertPhoto={() => { closeSheet(); handleAddImage(); }}
        onTakePhoto={async () => {
          closeSheet();
          try {
            const perm = await ImagePicker.requestCameraPermissionsAsync();
            if (!perm.granted) { Alert.alert('Permission required', 'Camera access is needed.'); return; }
            const result = await ImagePicker.launchCameraAsync({ quality: 0.9 });
            if (result.canceled || !result.assets?.[0]) return;
            const uri = await makeDurableUri(result.assets[0].uri);
            const lw = project?.canvas.width  || 1080;
            const lh = project?.canvas.height || 1080;
            const maxOrder = layers.reduce((m, l) => Math.max(m, l.order), 0);
            const tw = Math.round(lw * 0.6);
            const th = result.assets[0].height && result.assets[0].width
              ? Math.round((tw / result.assets[0].width) * result.assets[0].height)
              : tw;
            const newLayer: DesignLayer = {
              id: uid(), name: 'Camera Photo', type: 'image',
              visible: true, locked: false, order: maxOrder + 1,
              transform: { x: Math.round((lw - tw) / 2), y: 60, width: tw, height: th, rotation: 0, scaleX: 1, scaleY: 1 },
              data: { kind: 'image', uri, opacity: 1, fit: 'contain', blendMode: 'normal' } as DesignImageLayer,
              opacity: 1,
              createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            };
            mutateLayer(prev => [...prev, newLayer]);
            setSelectedLayerId(newLayer.id);
          } catch { Alert.alert('Error', 'Could not take photo.'); }
        }}
        onInsertFile={() => { closeSheet(); setTimeout(() => handleInsertFile(), 100); }}
        onAddText={() => { closeSheet(); openSheet('text'); }}
        onCut={handleCut}
        onCopy={handleCopyLayer}
        onCopyCanvas={handleCopyCanvas}
        onPaste={handlePaste}
        hasClipboard={!!clipboard && clipboard.length > 0}
        // CANVAS tab
        onCropResize={() => { closeSheet(); openSheet('canvasResize'); }}
        animEnabled={animEnabled}
        onToggleAnimAssist={() => {
          setAnimEnabled(v => {
            if (!v) {
              // Enable: snapshot current frame if no frames yet
              if (animFramesRef.current.length === 0) {
                const snap = JSON.stringify(layersRef.current);
                setAnimFrames([snap]);
                animFramesRef.current = [snap];
                setAnimCurrentFrame(0);
              }
            }
            markDirty();
            return !v;
          });
        }}
        onFlipHorizontal={applyFlipX}
        onFlipVertical={applyFlipY}
        onCanvasInfo={() => { closeSheet(); openSheet('canvasInfo'); }}
        referenceVisible={referenceVisible}
        onToggleReference={() => {
          if (!referenceUri) {
            handlePickReferenceImage();
          } else {
            setReferenceVisible(v => !v);
          }
        }}
        onChooseReference={handlePickReferenceImage}
        onDismissReference={() => { setReferenceVisible(false); setReferenceUri(null); refUriRef.current = null; markDirty(); }}
        hasReference={!!referenceUri}
        // GUIDES tab
        guideSettings={guideSettings}
        onGuideSettingsChange={(gs) => { setGuideSettings(gs); guideSettingsRef.current = gs; markDirty(); }}
        // SHARE tab
        onExportPng={() => { closeSheet(); setTimeout(() => handleExport('png'), 220); }}
        onExportJpeg={() => { closeSheet(); setTimeout(() => handleExport('jpeg'), 220); }}
        onShare={() => { closeSheet(); setTimeout(() => handleShare(), 220); }}
        onSaveCopy={handleSaveCopy}
        onUseAsProductPhoto={handleUseAsProductPhoto}
        onUseInPost={handleUseInPost}
        exporting={exporting}
        // Canvas info values passed for display
        logicalW={logicalW}
        logicalH={logicalH}
        layerCount={layers.length}
        cropRect={cropRect}
        masterDescriptor={project ? (() => {
          try { return resolveMasterDescriptor(project.canvas.width, project.canvas.height, cropRect); }
          catch { return null; }
        })() : null}
        saveStatus={saveStatus}
        // PREFS tab
        prefs={prefs}
        onPrefsChange={(p) => { setPrefs(p); prefsRef.current = p; markDirty(); }}
        timerDisplay={timerDisplay}
        quickMenuEditSlot={quickMenuEditSlot}
        onQuickMenuEditSlot={setQuickMenuEditSlot}
      />

      {/* ── BRUSH LIBRARY ── */}
      <Modal visible={activeSheet === 'brushLib'} transparent animationType="fade" onRequestClose={closeSheet}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeSheet}>
          <SheetRise style={[styles.sheet, { maxHeight: '72%' }]}>
            <SheetHandle />
            <View style={styles.sheetHeaderRow}>
              <Text style={styles.sheetTitle}>
                {activeTopTool === 'eraser' ? 'Eraser' : activeTopTool === 'smudge' ? 'Smudge' : 'Brush Library'}
              </Text>
              <TouchableOpacity onPress={closeSheet}>
                <Text style={{ color: PURPLE_LIGHT, fontFamily: FONT.medium, fontSize: FS.sm }}>Done</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.brushSliders}>
              <View style={styles.sliderRow}>
                <Text style={styles.sliderLabel}>Size</Text>
                <TouchableOpacity onPress={() => {
                  if (activeTopTool === 'eraser') setEraserSize(v => Math.max(2, v - 2));
                  else setBrushSize(v => Math.max(1, v - 2));
                }}>
                  <Feather name="minus" size={14} color={MUTED} />
                </TouchableOpacity>
                <View style={styles.sliderTrack}>
                  <View style={[styles.sliderFill, { width: `${(activeSize / 80) * 100}%` }]} />
                </View>
                <TouchableOpacity onPress={() => {
                  if (activeTopTool === 'eraser') setEraserSize(v => Math.min(80, v + 2));
                  else setBrushSize(v => Math.min(80, v + 2));
                }}>
                  <Feather name="plus" size={14} color={MUTED} />
                </TouchableOpacity>
                <Text style={styles.sliderValue}>{activeSize}</Text>
              </View>
              {activeTopTool === 'brush' && (
                <View style={styles.sliderRow}>
                  <Text style={styles.sliderLabel}>Opacity</Text>
                  <TouchableOpacity onPress={() => setBrushOpacity(v => Math.max(0.05, +(v - 0.05).toFixed(2)))}>
                    <Feather name="minus" size={14} color={MUTED} />
                  </TouchableOpacity>
                  <View style={styles.sliderTrack}>
                    <View style={[styles.sliderFill, { width: `${brushOpacity * 100}%` }]} />
                  </View>
                  <TouchableOpacity onPress={() => setBrushOpacity(v => Math.min(1, +(v + 0.05).toFixed(2)))}>
                    <Feather name="plus" size={14} color={MUTED} />
                  </TouchableOpacity>
                  <Text style={styles.sliderValue}>{Math.round(brushOpacity * 100)}%</Text>
                </View>
              )}
            </View>

            {activeTopTool === 'brush' && (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScrollView}>
                  {BRUSH_CATEGORIES.map(cat => (
                    <TouchableOpacity
                      key={cat}
                      style={[styles.catChip, BRUSH_LIBRARY[brushIdx]?.category === cat && styles.catChipActive]}
                      onPress={() => {
                        const idx = BRUSH_LIBRARY.findIndex(b => b.category === cat);
                        if (idx >= 0) setBrushIdx(idx);
                      }}
                    >
                      <Text style={[styles.catChipText, BRUSH_LIBRARY[brushIdx]?.category === cat && { color: PURPLE_LIGHT }]}>
                        {cat}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <ScrollView showsVerticalScrollIndicator={false} style={styles.brushList}>
                  {BRUSH_LIBRARY.map((b, i) => (
                    <TouchableOpacity
                      key={b.name}
                      style={[styles.brushRow, brushIdx === i && styles.brushRowActive]}
                      onPress={() => { setBrushIdx(i); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                    >
                      <View style={styles.brushStrokePreview}>
                        <Svg width={80} height={24}>
                          <Path
                            d="M8,16 Q20,4 40,12 Q60,20 72,8"
                            stroke={drawColor} strokeWidth={Math.min(10, b.widthMult * 3)}
                            fill="none" strokeLinecap={b.linecap} strokeLinejoin="round"
                            opacity={b.opacityMult}
                          />
                        </Svg>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.brushName, brushIdx === i && { color: PURPLE_LIGHT }]}>{b.name}</Text>
                        <Text style={styles.brushCategory}>{b.category}</Text>
                      </View>
                      {brushIdx === i && <Feather name="check" size={14} color={PURPLE_LIGHT} />}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}
          </SheetRise>
        </TouchableOpacity>
      </Modal>

      {/* ── COLOR PICKER ── */}
      <Modal visible={activeSheet === 'color'} transparent animationType="fade" onRequestClose={closeSheet}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeSheet}>
          <SheetRise style={[styles.sheet, { maxHeight: '70%' }]}>
            <SheetHandle />
            <View style={styles.sheetHeaderRow}>
              <Text style={styles.sheetTitle}>Color</Text>
              <TouchableOpacity onPress={closeSheet}>
                <Text style={{ color: PURPLE_LIGHT, fontFamily: FONT.medium, fontSize: FS.sm }}>Done</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.colorSwatchRow}>
              <View style={styles.colorSwatchGroup}>
                <View style={[styles.colorSwatchBig, { backgroundColor: drawColor }]} />
                <Text style={styles.colorSwatchLabel}>Current</Text>
              </View>
              <TouchableOpacity onPress={() => applyColor(prevColor)} style={styles.colorSwatchGroup}>
                <View style={[styles.colorSwatchBig, { backgroundColor: prevColor, opacity: 0.7 }]} />
                <Text style={styles.colorSwatchLabel}>Previous</Text>
              </TouchableOpacity>
              <View style={{ flex: 1 }} />
              <View style={styles.hexRow}>
                <Text style={styles.hexHash}>#</Text>
                <TextInput
                  style={styles.hexInput}
                  value={pickerHex}
                  onChangeText={v => {
                    const clean = v.replace(/[^0-9A-Fa-f]/g, '').toUpperCase().slice(0, 6);
                    setPickerHex(clean);
                    if (clean.length === 6) applyColor('#' + clean);
                  }}
                  maxLength={6} autoCapitalize="characters"
                  placeholder="FFFFFF" placeholderTextColor={SUBTLE}
                />
              </View>
            </View>

            <View style={styles.pickerTabRow}>
              {(['disc', 'palette', 'value'] as const).map(tab => (
                <TouchableOpacity
                  key={tab}
                  style={[styles.pickerTab, pickerTab === tab && styles.pickerTabActive]}
                  onPress={() => setPickerTab(tab)}
                >
                  <Text style={[styles.pickerTabText, pickerTab === tab && { color: PURPLE_LIGHT }]}>
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {pickerTab === 'disc' && (
              <View style={styles.hueDiscContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hueRingRow}>
                  {Array.from({ length: 36 }, (_, i) => {
                    const hue = i * 10;
                    const hex = hueToHex(hue);
                    return (
                      <TouchableOpacity key={i} style={[styles.hueCell, { backgroundColor: hex }]} onPress={() => applyColor(hex)} />
                    );
                  })}
                </ScrollView>
                <View style={[styles.sliderRow, { marginTop: SP.sm }]}>
                  <Text style={styles.sliderLabel}>Brightness</Text>
                  <TouchableOpacity onPress={() => {
                    const nb = Math.max(0.05, +(discBrightness - 0.05).toFixed(2));
                    setDiscBrightness(nb); applyColor(hueToHex(hueDiscAngle, 1, nb));
                  }}>
                    <Feather name="minus" size={14} color={MUTED} />
                  </TouchableOpacity>
                  <View style={styles.sliderTrack}>
                    <View style={[styles.sliderFill, { width: `${discBrightness * 100}%` }]} />
                  </View>
                  <TouchableOpacity onPress={() => {
                    const nb = Math.min(1, +(discBrightness + 0.05).toFixed(2));
                    setDiscBrightness(nb); applyColor(hueToHex(hueDiscAngle, 1, nb));
                  }}>
                    <Feather name="plus" size={14} color={MUTED} />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {pickerTab === 'palette' && (
              <View style={styles.paletteGrid}>
                {DEFAULT_PALETTE.map(c => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.paletteDot, { backgroundColor: c }, drawColor === c && styles.paletteDotActive]}
                    onPress={() => applyColor(c)}
                  />
                ))}
              </View>
            )}

            {pickerTab === 'value' && (
              <View style={{ gap: SP.xs }}>
                {['R', 'G', 'B'].map((ch, ci) => {
                  const hex6 = pickerHex.length === 6 ? pickerHex : 'FFFFFF';
                  const val  = parseInt(hex6.slice(ci * 2, ci * 2 + 2), 16);
                  return (
                    <View key={ch} style={styles.sliderRow}>
                      <Text style={[styles.sliderLabel, { width: 16 }]}>{ch}</Text>
                      <TouchableOpacity onPress={() => {
                        const h6 = pickerHex.length === 6 ? pickerHex : 'FFFFFF';
                        const vals = [parseInt(h6.slice(0,2),16), parseInt(h6.slice(2,4),16), parseInt(h6.slice(4,6),16)];
                        vals[ci] = Math.max(0, vals[ci] - 8);
                        applyColor('#' + vals.map(v => v.toString(16).padStart(2,'0')).join('').toUpperCase());
                      }}>
                        <Feather name="minus" size={14} color={MUTED} />
                      </TouchableOpacity>
                      <View style={styles.sliderTrack}>
                        <View style={[styles.sliderFill, { width: `${(val / 255) * 100}%` }]} />
                      </View>
                      <TouchableOpacity onPress={() => {
                        const h6 = pickerHex.length === 6 ? pickerHex : 'FFFFFF';
                        const vals = [parseInt(h6.slice(0,2),16), parseInt(h6.slice(2,4),16), parseInt(h6.slice(4,6),16)];
                        vals[ci] = Math.min(255, vals[ci] + 8);
                        applyColor('#' + vals.map(v => v.toString(16).padStart(2,'0')).join('').toUpperCase());
                      }}>
                        <Feather name="plus" size={14} color={MUTED} />
                      </TouchableOpacity>
                      <Text style={styles.sliderValue}>{val}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </SheetRise>
        </TouchableOpacity>
      </Modal>

      {/* ── LAYER MANAGER ── */}
      <Modal visible={activeSheet === 'layers'} transparent animationType="fade" onRequestClose={closeSheet}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeSheet}>
          <SheetRise style={[styles.sheet, { maxHeight: '70%' }]}>
            <SheetHandle />
            <View style={styles.sheetHeaderRow}>
              <Text style={styles.sheetTitle}>Layers</Text>
              <TouchableOpacity style={styles.sheetIconBtn} onPress={handleAddDrawingLayer}>
                <Feather name="plus" size={ICON.sm} color={PURPLE_LIGHT} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {sortedLayers.length === 0 && (
                <Text style={styles.emptyText}>No layers yet. Start drawing or add text.</Text>
              )}
              {[...sortedLayers].reverse().map(layer => (
                <View key={layer.id} style={[styles.layerRow, layer.id === selectedLayerId && styles.layerRowActive]}>
                  <TouchableOpacity
                    style={styles.layerThumb}
                    onPress={() => { setSelectedLayerId(layer.id); setActiveTopTool('select'); closeSheet(); }}
                  >
                    <View style={[styles.layerThumbInner, { backgroundColor: layer.type === 'shape' ? ((layer.data as DesignShapeLayer).fill ?? CARD_ELEVATED) : CARD_ELEVATED }]}>
                      <Feather
                        name={layer.type === 'text' ? 'type' : layer.type === 'image' ? 'image' : layer.type === 'drawing' ? 'edit-2' : 'square'}
                        size={12} color={MUTED}
                      />
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.layerInfo}
                    onPress={() => { setSelectedLayerId(layer.id); setActiveTopTool('select'); closeSheet(); }}
                  >
                    <Text style={[styles.layerName, layer.id === selectedLayerId && { color: PURPLE_LIGHT }]} numberOfLines={1}>
                      {layer.name}
                    </Text>
                    <Text style={styles.layerSub}>
                      {layer.type} · {Math.round(layer.opacity * 100)}%
                      {layer.id === selectedLayerId && ' · active'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.layerActionBtn}
                    onPress={() => mutateLayer(prev => prev.map(l => l.id === layer.id ? { ...l, visible: !l.visible } : l))}
                  >
                    <Feather name={layer.visible ? 'eye' : 'eye-off'} size={14} color={layer.visible ? FG : SUBTLE} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.layerActionBtn}
                    onPress={() => mutateLayer(prev => prev.map(l => l.id === layer.id ? { ...l, locked: !l.locked } : l))}
                  >
                    <Feather name={layer.locked ? 'lock' : 'unlock'} size={14} color={layer.locked ? PURPLE_LIGHT : SUBTLE} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.layerActionBtn}
                    onPress={() => {
                      setLayerOptionsTarget(layer.id);
                      setLayerEditOpacity(layer.opacity);
                      const bm = (layer.data as DesignImageLayer).blendMode ?? 'normal';
                      setLayerEditBlend(bm as BlendModeKind);
                      closeSheet(); openSheet('layerOptions');
                    }}
                  >
                    <Feather name="more-vertical" size={14} color={MUTED} />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          </SheetRise>
        </TouchableOpacity>
      </Modal>

      {/* ── LAYER OPTIONS ── */}
      <Modal visible={activeSheet === 'layerOptions'} transparent animationType="fade" onRequestClose={closeSheet}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeSheet}>
          <SheetRise style={styles.sheet}>
            <SheetHandle />
            <View style={styles.sheetHeaderRow}>
              <Text style={styles.sheetTitle}>{layerOptionsLayer?.name ?? 'Layer'}</Text>
              <TouchableOpacity onPress={closeSheet}>
                <Text style={{ color: PURPLE_LIGHT, fontFamily: FONT.medium, fontSize: FS.sm }}>Done</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sheetLabel}>Opacity: {Math.round(layerEditOpacity * 100)}%</Text>
            <View style={styles.sliderRow}>
              <TouchableOpacity onPress={() => {
                const v = Math.max(0, +(layerEditOpacity - 0.05).toFixed(2));
                setLayerEditOpacity(v);
                if (layerOptionsTarget) mutateLayer(prev => prev.map(l => l.id === layerOptionsTarget ? { ...l, opacity: v } : l));
              }}>
                <Feather name="minus" size={ICON.sm} color={MUTED} />
              </TouchableOpacity>
              <View style={styles.sliderTrack}>
                <View style={[styles.sliderFill, { width: `${layerEditOpacity * 100}%` }]} />
              </View>
              <TouchableOpacity onPress={() => {
                const v = Math.min(1, +(layerEditOpacity + 0.05).toFixed(2));
                setLayerEditOpacity(v);
                if (layerOptionsTarget) mutateLayer(prev => prev.map(l => l.id === layerOptionsTarget ? { ...l, opacity: v } : l));
              }}>
                <Feather name="plus" size={ICON.sm} color={MUTED} />
              </TouchableOpacity>
            </View>

            {/* Blend mode — only for image layers */}
            {layerOptionsLayer?.type === 'image' && (
              <>
                <Text style={styles.sheetLabel}>Blend Mode</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: SP.sm }}>
                  {BLEND_MODES.map(bm => (
                    <TouchableOpacity
                      key={bm}
                      style={[styles.blendChip, layerEditBlend === bm && styles.blendChipActive]}
                      onPress={() => {
                        setLayerEditBlend(bm);
                        if (layerOptionsTarget) {
                          mutateLayer(prev => prev.map(l => l.id === layerOptionsTarget
                            ? { ...l, data: { ...(l.data as DesignImageLayer), blendMode: bm } }
                            : l,
                          ));
                        }
                      }}
                    >
                      <Text style={[styles.blendChipText, layerEditBlend === bm && { color: PURPLE_LIGHT }]}>
                        {bm.charAt(0).toUpperCase() + bm.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}

            <View style={styles.layerActionsRow}>
              <TouchableOpacity style={styles.layerActionPill} onPress={() => { if (layerOptionsTarget) handleDuplicateLayer(layerOptionsTarget); }}>
                <Feather name="copy" size={ICON.xs} color={FG} />
                <Text style={styles.layerActionPillText}>Duplicate</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.layerActionPill} onPress={() => { if (layerOptionsTarget) handleMoveLayerUp(layerOptionsTarget); }}>
                <Feather name="arrow-up" size={ICON.xs} color={FG} />
                <Text style={styles.layerActionPillText}>Move Up</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.layerActionPill} onPress={() => { if (layerOptionsTarget) handleMoveLayerDown(layerOptionsTarget); }}>
                <Feather name="arrow-down" size={ICON.xs} color={FG} />
                <Text style={styles.layerActionPillText}>Move Down</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.layerActionPill, { borderColor: RED }]}
                onPress={() => { if (layerOptionsTarget) handleDeleteLayer(layerOptionsTarget); }}
              >
                <Feather name="trash-2" size={ICON.xs} color={RED} />
                <Text style={[styles.layerActionPillText, { color: RED }]}>Delete</Text>
              </TouchableOpacity>
            </View>
          </SheetRise>
        </TouchableOpacity>
      </Modal>

      {/* ── TEXT SHEET ── */}
      <TextSheet
        visible={activeSheet === 'text'}
        onClose={closeSheet}
        onAdd={handleAddText}
        drawColor={drawColor}
        PURPLE_DIM={PURPLE_DIM}
        PURPLE_LIGHT={PURPLE_LIGHT}
      />

      {/* ── CANVAS RESIZE / CROP SHEET ── */}
      <Modal visible={activeSheet === 'canvasResize'} transparent animationType="fade" onRequestClose={closeSheet}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeSheet}>
          <SheetRise style={styles.sheet}>
            <SheetHandle />
            <Text style={styles.sheetTitle}>Canvas Size & Crop</Text>

            <Text style={styles.sheetLabel}>Logical Dimensions (px)</Text>
            <View style={styles.dimensionRow}>
              <View style={styles.dimensionField}>
                <Text style={styles.dimensionLabel}>Width</Text>
                <TextInput
                  style={styles.dimensionInput}
                  value={resizeW}
                  onChangeText={setResizeW}
                  keyboardType="numeric"
                  placeholder="1080"
                  placeholderTextColor={SUBTLE}
                />
              </View>
              <Text style={[styles.dimensionLabel, { paddingTop: SP.lg }]}>×</Text>
              <View style={styles.dimensionField}>
                <Text style={styles.dimensionLabel}>Height</Text>
                <TextInput
                  style={styles.dimensionInput}
                  value={resizeH}
                  onChangeText={setResizeH}
                  keyboardType="numeric"
                  placeholder="1080"
                  placeholderTextColor={SUBTLE}
                />
              </View>
            </View>
            <Text style={[styles.exportSub, { marginBottom: SP.sm }]}>
              Layer positions are rescaled proportionally. Range: 8–16384px per axis; dimensions are never silently reduced.
            </Text>

            <TouchableOpacity style={styles.addBtn} onPress={handleApplyResize}>
              <Text style={styles.addBtnText}>Apply Resize</Text>
            </TouchableOpacity>

            <View style={{ height: SP.md }} />
            <Text style={styles.sheetLabel}>Crop Guides</Text>
            {cropRect ? (
              <Text style={[styles.exportSub, { marginBottom: SP.sm }]}>
                Active crop: {Math.round(cropRect.w)}×{Math.round(cropRect.h)}px at ({Math.round(cropRect.x)},{Math.round(cropRect.y)}).
                Shown in red on canvas. PNG export will be cropped to this region.
              </Text>
            ) : (
              <Text style={[styles.exportSub, { marginBottom: SP.sm }]}>
                No crop set. Tap Set Crop to apply a default 80% centred crop to PNG export.
              </Text>
            )}
            <View style={styles.dimensionRow}>
              <TouchableOpacity
                style={[styles.addBtn, { flex: 1 }]}
                onPress={handleSetCrop}
              >
                <Text style={styles.addBtnText}>{cropRect ? 'Reset Crop' : 'Set Crop'}</Text>
              </TouchableOpacity>
              {cropRect && (
                <TouchableOpacity
                  style={[styles.addBtn, { flex: 1, backgroundColor: RED, marginLeft: SP.sm }]}
                  onPress={handleClearCrop}
                >
                  <Text style={[styles.addBtnText, { color: FG }]}>Clear Crop</Text>
                </TouchableOpacity>
              )}
            </View>
          </SheetRise>
        </TouchableOpacity>
      </Modal>

      {/* ── EXPORT SHEET ── */}
      <Modal visible={activeSheet === 'export'} transparent animationType="fade" onRequestClose={closeSheet}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeSheet}>
          <SheetRise style={styles.sheet}>
            <SheetHandle />
            <View style={styles.sheetHeaderRow}>
              <Text style={styles.sheetTitle}>Export</Text>
              {exporting && (
                <Text style={{ color: MUTED, fontFamily: FONT.regular, fontSize: FS.xs }}>Capturing…</Text>
              )}
            </View>
            {(() => {
              const desc = project ? (() => {
                try { return resolveMasterDescriptor(project.canvas.width, project.canvas.height, cropRect); }
                catch { return null; }
              })() : null;
              const w = desc?.width ?? logicalW;
              const h = desc?.height ?? logicalH;
              const hasCrop = desc?.hasCrop ?? !!cropRect;
              const items = [
                {
                  label: 'Save as PNG',
                  sub: `PNG — Lossless · ${w} × ${h}${hasCrop ? ' (cropped)' : ''} · saves to Camera Roll`,
                  icon: 'download' as const, disabled: exporting,
                  action: () => handleExport('png'),
                },
                {
                  label: 'Save as JPEG',
                  sub: `JPEG — High quality (${Math.round(MASTER_JPEG_QUALITY * 100)}%) · ${w} × ${h} · compressed for sharing`,
                  icon: 'image' as const, disabled: exporting,
                  action: () => handleExport('jpeg'),
                },
                {
                  label: 'Share Image',
                  sub: 'PNG — Lossless · open system share sheet',
                  icon: 'share' as const, disabled: exporting,
                  action: handleShare,
                },
                {
                  label: 'Mockup Preview',
                  sub: 'See design on garment',
                  icon: 'eye' as const, disabled: false,
                  action: () => { closeSheet(); router.push((`/design-mockup-preview?projectId=${project?.id ?? ''}`) as never); },
                },
              ];
              return items.map(item => (
                <TouchableOpacity
                  key={item.label}
                  style={[styles.exportRow, item.disabled && styles.exportRowDisabled]}
                  onPress={item.action}
                  disabled={item.disabled && !['JPEG — unavailable'].includes(item.label)}
                  activeOpacity={item.disabled ? 1 : 0.7}
                >
                  <View style={[styles.exportIcon, item.disabled && { opacity: 0.4 }]}>
                    <Feather name={item.icon} size={ICON.sm} color={PURPLE_LIGHT} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.exportLabel, item.disabled && { opacity: 0.4 }]}>{item.label}</Text>
                    <Text style={styles.exportSub}>{item.sub}</Text>
                  </View>
                  {!item.disabled && <Feather name="chevron-right" size={ICON.sm} color={SUBTLE} />}
                </TouchableOpacity>
              ));
            })()}
          </SheetRise>
        </TouchableOpacity>
      </Modal>

      {/* ── CANVAS INFO ── */}
      <Modal visible={activeSheet === 'canvasInfo'} transparent animationType="fade" onRequestClose={closeSheet}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeSheet}>
          <SheetRise style={styles.sheet}>
            <SheetHandle />
            <Text style={styles.sheetTitle}>Canvas Info</Text>
            {[
              { label: 'Project Name', value: projectName },
              { label: 'Logical Size',  value: `${logicalW} × ${logicalH} px` },
              { label: 'Display Size',  value: `${Math.round(canvasSize.w)} × ${Math.round(canvasSize.h)} px` },
              { label: 'Scale',         value: `${dispScaleX.toFixed(3)} × ${dispScaleY.toFixed(3)}` },
              { label: 'Layer Count',   value: `${layers.length}` },
              { label: 'Status',        value: project?.status ?? 'draft' },
              { label: 'Saved',         value: saveStatus === 'saved' ? 'Just now' : saveStatus === 'saving' ? 'Saving…' : 'Unsaved changes' },
              { label: 'Background',    value: bgHex },
              { label: 'Crop',          value: cropRect ? `${Math.round(cropRect.w)}×${Math.round(cropRect.h)} @ (${Math.round(cropRect.x)},${Math.round(cropRect.y)}) — export will be cropped` : 'None' },
            { label: 'Est. Size',     value: (() => { const bytes = JSON.stringify(layers).length; return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes/1024).toFixed(1)} KB` : `${(bytes/1048576).toFixed(2)} MB`; })() },
            ].map(row => (
              <View key={row.label} style={styles.infoRow}>
                <Text style={styles.infoLabel}>{row.label}</Text>
                <Text style={styles.infoValue}>{row.value}</Text>
              </View>
            ))}
            <TouchableOpacity style={styles.addBtn} onPress={closeSheet}>
              <Text style={styles.addBtnText}>Close</Text>
            </TouchableOpacity>
          </SheetRise>
        </TouchableOpacity>
      </Modal>

      {/* ── QUICK MENU OVERLAY ── */}
      <Modal
        visible={quickMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setQuickMenuVisible(false)}
        testID="quick-menu-modal"
      >
        <TouchableOpacity
          style={[styles.modalOverlay, { justifyContent: 'center', alignItems: 'center' }]}
          activeOpacity={1}
          onPress={() => setQuickMenuVisible(false)}
        >
          <View style={{
            backgroundColor: CARD_ELEVATED,
            borderRadius: RADIUS.md,
            borderWidth: 1,
            borderColor: BORDER,
            padding: SP.md,
            width: 280,
            gap: SP.xs,
          }}>
            <Text style={{ fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, marginBottom: SP.xs }}>
              Quick Menu
            </Text>
            {prefs.quickMenuSlots.map((slot, i) => {
              if (slot === 'none') return null;
              const action = QUICK_MENU_ALL_ACTIONS.find(a => a.key === slot);
              if (!action) return null;
              return (
                <TouchableOpacity
                  key={i}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
                    paddingVertical: SP.sm, paddingHorizontal: SP.sm,
                    borderRadius: RADIUS.sm, backgroundColor: SURFACE,
                    borderWidth: 1, borderColor: BORDER,
                    minHeight: 44,
                  }}
                  onPress={() => dispatchQuickAction(slot)}
                  testID={`qm-dispatch-${slot}`}
                >
                  <Feather name="zap" size={ICON.sm} color={FG} />
                  <Text style={{ fontSize: FS.sm, fontFamily: FONT.medium, color: FG }}>
                    {action.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={{ alignSelf: 'flex-end', marginTop: SP.xs }}
              onPress={() => setQuickMenuVisible(false)}
            >
              <Text style={{ fontSize: FS.xs, color: MUTED, fontFamily: FONT.medium }}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── SELECTION SETTINGS MODAL ── */}
      <Modal visible={activeSheet === 'selection'} transparent animationType="fade" onRequestClose={closeSheet}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeSheet}>
          <SheetRise style={styles.sheet}>
            <SheetHandle />
            <View style={styles.sheetHeaderRow}>
              <Text style={styles.sheetTitle}>Selection Settings</Text>
              <TouchableOpacity onPress={closeSheet}>
                <Text style={{ color: PURPLE_LIGHT, fontFamily: FONT.medium, fontSize: FS.sm }}>Done</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.sliderRow}>
              <Text style={styles.sliderLabel}>Feather</Text>
              <TouchableOpacity onPress={() => setSelectionFeather(v => Math.max(0, v - 2))}>
                <Feather name="minus" size={14} color={MUTED} />
              </TouchableOpacity>
              <View style={styles.sliderTrack}>
                <View style={[styles.sliderFill, { width: `${Math.min(100, selectionFeather * 5)}%` }]} />
              </View>
              <TouchableOpacity onPress={() => setSelectionFeather(v => Math.min(20, v + 2))}>
                <Feather name="plus" size={14} color={MUTED} />
              </TouchableOpacity>
              <Text style={styles.sliderValue}>{selectionFeather}px</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: SP.sm, marginTop: SP.sm }}>
              <TouchableOpacity style={styles.fontChip} onPress={() => {
                if (selectionRegion) {
                  setSelectionRegion({ ...selectionRegion, feather: selectionFeather });
                }
              }}>
                <Text style={styles.fontChipText}>Apply Feather</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.fontChip} onPress={() => setSelectionRegion(null)}>
                <Feather name="x" size={12} color={MUTED} />
                <Text style={styles.fontChipText}>Clear</Text>
              </TouchableOpacity>
            </View>
          </SheetRise>
        </TouchableOpacity>
      </Modal>

      {/* ── TRANSFORM SETTINGS MODAL ── */}
      <Modal visible={activeSheet === 'transformTool'} transparent animationType="fade" onRequestClose={closeSheet}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeSheet}>
          <SheetRise style={styles.sheet}>
            <SheetHandle />
            <View style={styles.sheetHeaderRow}>
              <Text style={styles.sheetTitle}>Transform Settings</Text>
              <TouchableOpacity onPress={closeSheet}>
                <Text style={{ color: PURPLE_LIGHT, fontFamily: FONT.medium, fontSize: FS.sm }}>Done</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.sm }}>
              <Text style={styles.sliderLabel}>Snap to Grid</Text>
              <TouchableOpacity
                style={[styles.togglePill, transformSnapEnabled && styles.togglePillActive]}
                onPress={() => setTransformSnapEnabled(v => !v)}
                testID="transform-snap-toggle"
              >
                {transformSnapEnabled && <Feather name="check" size={12} color={FG} />}
                <Text style={[styles.togglePillText, transformSnapEnabled && styles.togglePillTextActive]}>
                  {transformSnapEnabled ? 'On' : 'Off'}
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: FS.xs, color: MUTED, fontFamily: FONT.regular, marginBottom: SP.sm }}>
              Snaps to 8-unit grid. Distort/Warp modes use {transformMode === 'warp' ? 'vector affine warp' : 'affine decomposition'} approximation.
            </Text>
            <TouchableOpacity
              style={styles.fontChip}
              onPress={() => {
                if (selectedLayer) {
                  setDistortQuad(transformToQuad(selectedLayer.transform));
                  setWarpMesh(defaultWarpMesh(selectedLayer.transform));
                  mutateLayer(prev => prev.map(l =>
                    l.id === selectedLayer.id
                      ? { ...l, transform: { ...l.transform, affineSvgMatrix: undefined, distortQuad: undefined, warpMesh: undefined } }
                      : l,
                  ));
                  markDirty();
                }
                closeSheet();
              }}
            >
              <Feather name="refresh-cw" size={12} color={MUTED} />
              <Text style={styles.fontChipText}>Reset Transform</Text>
            </TouchableOpacity>
          </SheetRise>
        </TouchableOpacity>
      </Modal>

      {/* ── ADJUSTMENTS (CURVES) PANEL ── */}
      <Modal visible={activeSheet === 'adjustments'} transparent animationType="fade" onRequestClose={closeSheet}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeSheet}>
          <SheetRise style={[styles.sheet, { maxHeight: '70%' }]}>
            <SheetHandle />
            <View style={styles.sheetHeaderRow}>
              <Text style={styles.sheetTitle}>Curves</Text>
              <TouchableOpacity onPress={closeSheet}>
                <Text style={{ color: PURPLE_LIGHT, fontFamily: FONT.medium, fontSize: FS.sm }}>Done</Text>
              </TouchableOpacity>
            </View>
            {!selectedLayer ? (
              <Text style={{ fontSize: FS.sm, color: MUTED, fontFamily: FONT.regular, marginBottom: SP.md }}>
                Select a layer to edit its curves.
              </Text>
            ) : (
              <>
                {/* Channel tabs */}
                <View style={{ flexDirection: 'row', gap: SP.xs, marginBottom: SP.sm }}>
                  {(['gamma', 'red', 'green', 'blue'] as CurveChannel[]).map(ch => (
                    <TouchableOpacity
                      key={ch}
                      style={[styles.fontChip, adjustmentsCurveChannel === ch && styles.fontChipActive]}
                      onPress={() => setAdjustmentsCurveChannel(ch)}
                      testID={`curve-channel-${ch}`}
                    >
                      <Text style={[styles.fontChipText, adjustmentsCurveChannel === ch && { color: PURPLE_LIGHT }]}>
                        {ch.charAt(0).toUpperCase() + ch.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Histogram preview from layer colors */}
                {(() => {
                  // Histogram from actual accessible layer colors only.
                  // Drawing layers: extract stroke hex colors.
                  // Image/shape/text layers: pixel data is inaccessible → return UNAVAILABLE.
                  const layerColors: string[] =
                    selectedLayer?.type === 'drawing' && selectedLayer.data && 'paths' in selectedLayer.data
                      ? (selectedLayer.data as DesignDrawingLayer).paths
                          .filter(p => p.color !== 'erase' && p.color !== 'smudge' && p.color.startsWith('#'))
                          .map(p => p.color)
                      : [];

                  const hist = layerColors.length > 0
                    ? computeHistogramFromColors(layerColors)
                    : HISTOGRAM_UNAVAILABLE; // inaccessible — do NOT substitute fake data

                  if (!hist) {
                    return (
                      <View style={{ height: 40, marginBottom: SP.sm, backgroundColor: SURFACE, borderRadius: RADIUS.sm, padding: SP.xs, justifyContent: 'center', alignItems: 'center' }}>
                        <Text style={{ fontSize: FS.xs, color: MUTED, fontFamily: FONT.regular }}>
                          Histogram unavailable (raster layer)
                        </Text>
                      </View>
                    );
                  }

                  const channel = adjustmentsCurveChannel === 'gamma' ? hist.luma : hist[adjustmentsCurveChannel as 'red' | 'green' | 'blue'];
                  const maxVal = Math.max(1, ...channel);
                  return (
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 40, gap: 1, marginBottom: SP.sm, backgroundColor: SURFACE, borderRadius: RADIUS.sm, padding: SP.xs }}>
                      {channel.map((v, i) => (
                        <View key={i} style={{
                          flex: 1,
                          height: Math.max(2, (v / maxVal) * 36),
                          backgroundColor: FG,
                          opacity: 0.4,
                          borderRadius: 1,
                        }} />
                      ))}
                    </View>
                  );
                })()}

                {/* Curve control-points: show tableValues string as visual approximation */}
                {(() => {
                  const adj = selectedLayer.adjustments?.curves ?? defaultCurvesAdjustment();
                  const curve = adj[adjustmentsCurveChannel];
                  const tableVals = curveToTableValues(curve.points);
                  return (
                    <View style={{ marginBottom: SP.sm }}>
                      <Text style={{ fontSize: FS.xs, color: MUTED, fontFamily: FONT.regular }}>
                        Output: {tableVals}
                      </Text>
                      {/* Visual approximation bars */}
                      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 48, gap: 2, marginTop: SP.xs, backgroundColor: SURFACE, borderRadius: RADIUS.sm, padding: SP.xs }}>
                        {tableVals.split(' ').map((v, i) => (
                          <View key={i} style={{
                            flex: 1,
                            height: Math.max(2, parseFloat(v) * 44),
                            backgroundColor: adjustmentsCurveChannel === 'red' ? RED :
                              adjustmentsCurveChannel === 'green' ? FG :
                              adjustmentsCurveChannel === 'blue' ? MUTED : PURPLE_LIGHT,
                            borderRadius: 1, opacity: 0.8,
                          }} />
                        ))}
                      </View>
                      {/* Nudge midpoint */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.sm }}>
                        <Text style={{ fontSize: FS.xs, color: MUTED }}>Midpoint</Text>
                        <TouchableOpacity style={styles.animBtn} onPress={() => {
                          const pts = curve.points.map(p =>
                            Math.abs(p.t - 0.5) < 0.15 ? { ...p, v: Math.max(0, p.v - 0.1) } : p,
                          );
                          const newAdj = { ...adj, [adjustmentsCurveChannel]: { ...curve, points: pts } };
                          if (selectedLayer) updateLayerCurves(selectedLayer.id, newAdj);
                        }}>
                          <Feather name="minus" size={ICON.sm} color={MUTED} />
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.animBtn} onPress={() => {
                          // Add midpoint control point if not present
                          const hasMid = curve.points.some(p => Math.abs(p.t - 0.5) < 0.1);
                          let pts = [...curve.points];
                          if (!hasMid) pts = [...pts, { t: 0.5, v: 0.5 }].sort((a, b) => a.t - b.t);
                          const bumped = pts.map(p =>
                            Math.abs(p.t - 0.5) < 0.15 ? { ...p, v: Math.min(1, p.v + 0.1) } : p,
                          );
                          const newAdj = { ...adj, [adjustmentsCurveChannel]: { ...curve, points: bumped } };
                          if (selectedLayer) updateLayerCurves(selectedLayer.id, newAdj);
                        }}>
                          <Feather name="plus" size={ICON.sm} color={MUTED} />
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.fontChip} onPress={() => {
                          const newAdj = { ...adj, [adjustmentsCurveChannel]: { channel: adjustmentsCurveChannel, points: [{ t: 0, v: 0 }, { t: 1, v: 1 }] } };
                          if (selectedLayer) updateLayerCurves(selectedLayer.id, newAdj);
                        }}>
                          <Feather name="refresh-cw" size={12} color={MUTED} />
                          <Text style={styles.fontChipText}>Reset</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })()}
              </>
            )}
          </SheetRise>
        </TouchableOpacity>
      </Modal>

    </View>
  );
}

// ─── WrenchActionsSheet ───────────────────────────────────────────────────────

interface WrenchActionsSheetProps {
  visible: boolean;
  onClose: () => void;
  wrenchTab: WrenchTab;
  setWrenchTab: (t: WrenchTab) => void;
  selectedLayerId: string | null;
  // ADD
  onInsertPhoto: () => void;
  onInsertFile: () => void;
  onTakePhoto: () => void;
  onAddText: () => void;
  onCut: () => void;
  onCopy: () => void;
  onCopyCanvas: () => void;
  onPaste: () => void;
  hasClipboard: boolean;
  // CANVAS
  onCropResize: () => void;
  animEnabled: boolean;
  onToggleAnimAssist: () => void;
  onFlipHorizontal: () => void;
  onFlipVertical: () => void;
  onCanvasInfo: () => void;
  referenceVisible: boolean;
  onToggleReference: () => void;
  onChooseReference: () => void;
  onDismissReference: () => void;
  hasReference: boolean;
  // GUIDES
  guideSettings: GuideSettings;
  onGuideSettingsChange: (gs: GuideSettings) => void;
  // SHARE
  onExportPng: () => void;
  onExportJpeg: () => void;
  onShare: () => void;
  onSaveCopy: () => void;
  onUseAsProductPhoto: () => void;
  onUseInPost: () => void;
  exporting: boolean;
  logicalW: number;
  logicalH: number;
  layerCount: number;
  cropRect: { x: number; y: number; w: number; h: number } | null;
  /** Pre-resolved master descriptor — used to render exact dimension labels in the Share UI. */
  masterDescriptor: MasterDescriptor | null;
  saveStatus: 'saved' | 'unsaved' | 'saving';
  // PREFS
  prefs: DesignPreferences;
  onPrefsChange: (p: DesignPreferences) => void;
  timerDisplay: { session: string; total: string };
  quickMenuEditSlot: number | null;
  onQuickMenuEditSlot: (slot: number | null) => void;
}

const WRENCH_TABS: { key: WrenchTab; label: string }[] = [
  { key: 'add',    label: 'Add' },
  { key: 'canvas', label: 'Canvas' },
  { key: 'guides', label: 'Guides' },
  { key: 'share',  label: 'Share' },
  { key: 'prefs',  label: 'Prefs' },
];

function WrenchActionsSheet({
  visible, onClose, wrenchTab, setWrenchTab, selectedLayerId,
  onInsertPhoto, onInsertFile, onTakePhoto, onAddText,
  onCut, onCopy, onCopyCanvas, onPaste, hasClipboard,
  onCropResize, animEnabled, onToggleAnimAssist,
  onFlipHorizontal, onFlipVertical, onCanvasInfo,
  referenceVisible, onToggleReference, onChooseReference, onDismissReference, hasReference,
  guideSettings, onGuideSettingsChange,
  onExportPng, onExportJpeg, onShare, onSaveCopy,
  onUseAsProductPhoto, onUseInPost, exporting,
  logicalW, logicalH, layerCount, cropRect, masterDescriptor, saveStatus,
  prefs, onPrefsChange, timerDisplay, quickMenuEditSlot, onQuickMenuEditSlot,
}: WrenchActionsSheetProps) {
  const insets = useSafeAreaInsets();
  const hasSelection = !!selectedLayerId;

  function ActionCell({
    icon, label, sub, onPress, disabled = false, active = false,
  }: {
    icon: React.ComponentProps<typeof Feather>['name'];
    label: string;
    sub?: string;
    onPress: () => void;
    disabled?: boolean;
    active?: boolean;
  }) {
    return (
      <TouchableOpacity
        style={[styles.actionCell, disabled && styles.actionCellDisabled, active && styles.actionCellActive]}
        onPress={disabled ? undefined : onPress}
        activeOpacity={disabled ? 1 : 0.7}
        disabled={disabled}
        accessibilityLabel={label}
        accessibilityRole="button"
      >
        <Feather name={icon} size={ICON.md} color={active ? FG : disabled ? SUBTLE : MUTED} />
        <Text style={styles.actionCellLabel}>{label}</Text>
        {sub ? <Text style={styles.actionCellSub}>{sub}</Text> : null}
      </TouchableOpacity>
    );
  }

  function TogglePill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
    return (
      <TouchableOpacity
        style={[styles.togglePill, active && styles.togglePillActive]}
        onPress={onPress}
        activeOpacity={0.7}
      >
        {active && <Feather name="check" size={12} color={FG} />}
        <Text style={[styles.togglePillText, active && styles.togglePillTextActive]}>{label}</Text>
      </TouchableOpacity>
    );
  }

  function StepControl({
    label, value, onDec, onInc, format,
  }: {
    label: string; value: number;
    onDec: () => void; onInc: () => void;
    format?: (v: number) => string;
  }) {
    return (
      <View style={styles.guideRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.guideLabel}>{label}</Text>
          <Text style={styles.guideSub}>{format ? format(value) : String(value)}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm }}>
          <TouchableOpacity style={styles.animBtn} onPress={onDec}>
            <Feather name="minus" size={ICON.sm} color={MUTED} />
          </TouchableOpacity>
          <Text style={{ fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, minWidth: 36, textAlign: 'center' }}>
            {format ? format(value) : String(value)}
          </Text>
          <TouchableOpacity style={styles.animBtn} onPress={onInc}>
            <Feather name="plus" size={ICON.sm} color={MUTED} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose} />
      <SheetRise style={[styles.wrenchSheet, { paddingBottom: insets.bottom + SP.md }]}>
        <SheetHandle />

        {/* Tab row */}
        <View style={styles.wrenchTabsRow}>
          {WRENCH_TABS.map(t => (
            <TouchableOpacity
              key={t.key}
              style={[styles.wrenchTabBtn, wrenchTab === t.key && styles.wrenchTabBtnActive]}
              onPress={() => { setWrenchTab(t.key); Haptics.selectionAsync(); }}
              accessibilityRole="tab"
              accessibilityState={{ selected: wrenchTab === t.key }}
            >
              <Text style={[styles.wrenchTabLabel, wrenchTab === t.key && styles.wrenchTabLabelActive]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* ── ADD TAB ── */}
          {wrenchTab === 'add' && (
            <View style={styles.actionGrid}>
              <ActionCell icon="image" label="Insert a photo" onPress={onInsertPhoto} />
              <ActionCell
                icon="file"
                label="Insert a file"
                sub="Images or Brandthread JSON"
                onPress={onInsertFile}
              />
              <ActionCell icon="camera" label="Take a photo" onPress={onTakePhoto} />
              <ActionCell icon="type" label="Add Text" onPress={onAddText} />
              <ActionCell
                icon="scissors"
                label="Cut"
                sub={hasSelection ? undefined : 'Select a layer first'}
                onPress={onCut}
                disabled={!hasSelection}
              />
              <ActionCell
                icon="copy"
                label="Copy"
                sub={hasSelection ? undefined : 'Select a layer first'}
                onPress={onCopy}
                disabled={!hasSelection}
              />
              <ActionCell
                icon="layers"
                label="Copy canvas"
                sub="Duplicates full composition"
                onPress={onCopyCanvas}
              />
              <ActionCell
                icon="clipboard"
                label="Paste"
                sub={hasClipboard ? undefined : 'Nothing in clipboard'}
                onPress={onPaste}
                disabled={!hasClipboard}
              />
            </View>
          )}

          {/* ── CANVAS TAB ── */}
          {wrenchTab === 'canvas' && (
            <View style={styles.actionGrid}>
              <ActionCell icon="crop" label="Crop & Resize" onPress={onCropResize} />
              <ActionCell
                icon="film"
                label="Animation Assist"
                sub={animEnabled ? 'On — onion-skin active' : 'Off'}
                onPress={onToggleAnimAssist}
                active={animEnabled}
              />
              <ActionCell icon="refresh-cw" label="Flip horizontal" onPress={onFlipHorizontal} />
              <ActionCell icon="repeat" label="Flip vertical" onPress={onFlipVertical} />
              <ActionCell icon="info" label="Canvas info" onPress={onCanvasInfo} />
              <ActionCell
                icon={referenceVisible ? 'eye' : 'eye-off'}
                label={hasReference ? 'Toggle Reference' : 'Add Reference'}
                sub={hasReference ? (referenceVisible ? 'Tap to hide' : 'Tap to show') : 'Choose a reference image'}
                onPress={onToggleReference}
                active={referenceVisible}
              />
              {hasReference && (
                <ActionCell
                  icon="upload"
                  label="Replace Reference"
                  sub="Choose a different image"
                  onPress={onChooseReference}
                />
              )}
              {hasReference && (
                <ActionCell
                  icon="trash-2"
                  label="Dismiss Reference"
                  sub="Remove reference image"
                  onPress={onDismissReference}
                />
              )}
            </View>
          )}

          {/* ── GUIDES TAB ── */}
          {wrenchTab === 'guides' && (
            <View style={{ paddingHorizontal: SP.md, paddingTop: SP.sm }}>
              {/* Grid toggle */}
              <View style={styles.guideRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.guideLabel}>Grid</Text>
                  <Text style={styles.guideSub}>Show grid over artwork (not exported)</Text>
                </View>
                <TogglePill label={guideSettings.gridEnabled ? 'On' : 'Off'} active={guideSettings.gridEnabled}
                  onPress={() => onGuideSettingsChange({ ...guideSettings, gridEnabled: !guideSettings.gridEnabled })} />
              </View>

              {/* Grid size — stepped control */}
              <StepControl
                label="Grid size"
                value={guideSettings.gridSize}
                onDec={() => onGuideSettingsChange({ ...guideSettings, gridSize: Math.max(10, guideSettings.gridSize - 10) })}
                onInc={() => onGuideSettingsChange({ ...guideSettings, gridSize: Math.min(200, guideSettings.gridSize + 10) })}
                format={v => `${v} pt`}
              />

              {/* Grid opacity — stepped control */}
              <StepControl
                label="Grid opacity"
                value={Math.round(guideSettings.gridOpacity * 100)}
                onDec={() => onGuideSettingsChange({ ...guideSettings, gridOpacity: Math.max(0.05, +(guideSettings.gridOpacity - 0.05).toFixed(2)) })}
                onInc={() => onGuideSettingsChange({ ...guideSettings, gridOpacity: Math.min(1, +(guideSettings.gridOpacity + 0.05).toFixed(2)) })}
                format={v => `${v}%`}
              />

              {/* Symmetry guides */}
              <Text style={[styles.wrenchTabLabel, { marginTop: SP.md, marginBottom: SP.sm, textTransform: 'uppercase', letterSpacing: 0.5 }]}>
                Symmetry Guides
              </Text>
              <View style={styles.guideRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.guideLabel}>Vertical</Text>
                  <Text style={styles.guideSub}>Mirror left/right axis</Text>
                </View>
                <TogglePill label={guideSettings.symVertical ? 'On' : 'Off'} active={guideSettings.symVertical}
                  onPress={() => onGuideSettingsChange({ ...guideSettings, symVertical: !guideSettings.symVertical })} />
              </View>
              <View style={styles.guideRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.guideLabel}>Horizontal</Text>
                  <Text style={styles.guideSub}>Mirror top/bottom axis</Text>
                </View>
                <TogglePill label={guideSettings.symHorizontal ? 'On' : 'Off'} active={guideSettings.symHorizontal}
                  onPress={() => onGuideSettingsChange({ ...guideSettings, symHorizontal: !guideSettings.symHorizontal })} />
              </View>
              <View style={styles.guideRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.guideLabel}>Quadrant</Text>
                  <Text style={styles.guideSub}>Both vertical + horizontal</Text>
                </View>
                <TogglePill label={guideSettings.symQuadrant ? 'On' : 'Off'} active={guideSettings.symQuadrant}
                  onPress={() => onGuideSettingsChange({ ...guideSettings, symQuadrant: !guideSettings.symQuadrant })} />
              </View>
            </View>
          )}

          {/* ── SHARE TAB ── */}
          {wrenchTab === 'share' && (
            <View style={{ paddingHorizontal: SP.xs }}>
              {(() => {
                // Compute labels from policy descriptor for exact dimension display.
                // Falls back to logicalW/H when descriptor is not yet ready (loading).
                const desc = masterDescriptor ?? {
                  width: cropRect?.w ? Math.round(cropRect.w) : logicalW,
                  height: cropRect?.h ? Math.round(cropRect.h) : logicalH,
                  cropX: cropRect?.x ?? 0,
                  cropY: cropRect?.y ?? 0,
                  hasCrop: cropRect != null,
                };
                return [
                  {
                    label: 'Export PNG',
                    sub: pngLabel(desc) + ' · saves to Camera Roll',
                    icon: 'download' as const,
                    onPress: onExportPng,
                    disabled: exporting,
                  },
                  {
                    label: 'Export JPEG',
                    sub: jpegLabel(desc) + ' · compressed for sharing',
                    icon: 'image' as const,
                    onPress: onExportJpeg,
                    disabled: exporting,
                  },
                  {
                    label: 'Share / Save',
                    sub: `PNG — Lossless · ${desc.width} × ${desc.height} · open system share sheet`,
                    icon: 'share-2' as const,
                    onPress: onShare,
                    disabled: exporting,
                  },
                  {
                    label: 'Save a copy',
                    sub: 'Duplicate editable project to gallery (source layers preserved)',
                    icon: 'copy' as const,
                    onPress: onSaveCopy,
                    disabled: false,
                  },
                  {
                    label: 'Use as product photo',
                    sub: `PNG — Lossless · ${desc.width} × ${desc.height} · save for product listing`,
                    icon: 'shopping-bag' as const,
                    onPress: onUseAsProductPhoto,
                    disabled: exporting,
                  },
                  {
                    label: 'Use in a post',
                    sub: `PNG — Lossless · ${desc.width} × ${desc.height} · save for Thread composer`,
                    icon: 'send' as const,
                    onPress: onUseInPost,
                    disabled: exporting,
                  },
                ];
              })().map(item => (
                <TouchableOpacity
                  key={item.label}
                  style={[styles.exportRow, item.disabled && styles.exportRowDisabled]}
                  onPress={item.disabled ? undefined : item.onPress}
                  disabled={item.disabled}
                  activeOpacity={item.disabled ? 1 : 0.7}
                >
                  <View style={[styles.exportIcon, item.disabled && { opacity: 0.4 }]}>
                    <Feather name={item.icon} size={ICON.sm} color={FG} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.exportLabel, item.disabled && { opacity: 0.4 }]}>{item.label}</Text>
                    <Text style={styles.exportSub}>{item.sub}</Text>
                  </View>
                  {!item.disabled && <Feather name="chevron-right" size={ICON.sm} color={SUBTLE} />}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* ── PREFS TAB ── */}
          {wrenchTab === 'prefs' && (
            <View style={{ padding: SP.md, gap: SP.md }}>

              {/* Timer */}
              <View style={styles.guideSectionHeader}>
                <Text style={styles.guideSectionTitle}>Design Timer</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: SP.md, marginBottom: SP.xs }}>
                <View style={{ flex: 1, backgroundColor: SURFACE, borderRadius: RADIUS.md, padding: SP.sm, alignItems: 'center' }}>
                  <Text style={{ fontSize: FS.xs, color: MUTED, fontFamily: FONT.regular }}>Session</Text>
                  <Text style={{ fontSize: FS.lg, color: FG, fontFamily: FONT.semibold, marginTop: 2 }}>{timerDisplay.session}</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: SURFACE, borderRadius: RADIUS.md, padding: SP.sm, alignItems: 'center' }}>
                  <Text style={{ fontSize: FS.xs, color: MUTED, fontFamily: FONT.regular }}>Total</Text>
                  <Text style={{ fontSize: FS.lg, color: FG, fontFamily: FONT.semibold, marginTop: 2 }}>{timerDisplay.total}</Text>
                </View>
              </View>

              {/* Brush Cursor */}
              <View style={styles.guideSectionHeader}>
                <Text style={styles.guideSectionTitle}>Brush Cursor</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: SP.sm }}>
                {(['none', 'circle', 'crosshair'] as const).map(mode => (
                  <TouchableOpacity
                    key={mode}
                    style={[
                      styles.fontChip,
                      prefs.brushCursor === mode && styles.fontChipActive,
                    ]}
                    onPress={() => onPrefsChange({ ...prefs, brushCursor: mode })}
                    testID={`pref-cursor-${mode}`}
                  >
                    <Text style={[styles.fontChipText, prefs.brushCursor === mode && { color: PURPLE_LIGHT }]}>
                      {mode.charAt(0).toUpperCase() + mode.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Pressure Curve */}
              <View style={styles.guideSectionHeader}>
                <Text style={styles.guideSectionTitle}>Pressure Curve</Text>
              </View>
              <Text style={{ fontSize: FS.xs, color: MUTED, fontFamily: FONT.regular, marginBottom: SP.xs }}>
                Maps raw stylus force (x) → effective brush size multiplier (y).
              </Text>
              {/* Simple textual representation of control points */}
              {prefs.pressureCurve.map((pt, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: SP.sm, alignItems: 'center', marginBottom: SP.xs }}>
                  <Text style={{ fontSize: FS.xs, color: MUTED, width: 60 }}>Force {Math.round(pt.force * 100)}%</Text>
                  <View style={{ flex: 1, height: 4, backgroundColor: BORDER, borderRadius: 2 }}>
                    <View style={{ width: `${pt.size * 100}%`, height: 4, backgroundColor: PURPLE_LIGHT, borderRadius: 2 }} />
                  </View>
                  <Text style={{ fontSize: FS.xs, color: FG, width: 36, textAlign: 'right' }}>{Math.round(pt.size * 100)}%</Text>
                  {i > 0 && i < prefs.pressureCurve.length - 1 && (
                    <TouchableOpacity
                      onPress={() => {
                        const pts = prefs.pressureCurve.filter((_, j) => j !== i);
                        onPrefsChange({ ...prefs, pressureCurve: pts });
                      }}
                    >
                      <Feather name="x" size={12} color={MUTED} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              <TouchableOpacity
                style={[styles.fontChip, { alignSelf: 'flex-start' }]}
                onPress={() => {
                  // Add midpoint between last two points
                  const pts = prefs.pressureCurve;
                  const newF = pts.length >= 2
                    ? (pts[pts.length - 2].force + pts[pts.length - 1].force) / 2
                    : 0.5;
                  const newS = 0.5;
                  const sorted = [...pts, { force: newF, size: newS }].sort((a, b) => a.force - b.force);
                  onPrefsChange({ ...prefs, pressureCurve: sorted });
                }}
              >
                <Feather name="plus" size={12} color={MUTED} />
                <Text style={styles.fontChipText}>Add Point</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.fontChip, { alignSelf: 'flex-start', marginTop: SP.xs }]}
                onPress={() => onPrefsChange({ ...prefs, pressureCurve: [{ force: 0, size: 0.2 }, { force: 1, size: 1 }] })}
              >
                <Feather name="refresh-cw" size={12} color={MUTED} />
                <Text style={styles.fontChipText}>Reset</Text>
              </TouchableOpacity>

              {/* QuickMenu */}
              <View style={styles.guideSectionHeader}>
                <Text style={styles.guideSectionTitle}>Quick Menu Slots</Text>
              </View>
              <Text style={{ fontSize: FS.xs, color: MUTED, fontFamily: FONT.regular, marginBottom: SP.xs }}>
                Long-press the canvas to open the Quick Menu. Assign up to {QUICK_MENU_SLOT_COUNT} actions.
              </Text>
              {prefs.quickMenuSlots.map((slot, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.xs }}>
                  <Text style={{ fontSize: FS.xs, color: MUTED, width: 24 }}>#{i + 1}</Text>
                  <TouchableOpacity
                    style={[styles.fontChip, { flex: 1, justifyContent: 'space-between' }, quickMenuEditSlot === i && styles.fontChipActive]}
                    onPress={() => onQuickMenuEditSlot(quickMenuEditSlot === i ? null : i)}
                    testID={`qm-slot-${i}`}
                  >
                    <Text style={[styles.fontChipText, quickMenuEditSlot === i && { color: PURPLE_LIGHT }]}>
                      {QUICK_MENU_ALL_ACTIONS.find(a => a.key === slot)?.label ?? slot}
                    </Text>
                    <Feather name="chevron-down" size={12} color={MUTED} />
                  </TouchableOpacity>
                </View>
              ))}
              {quickMenuEditSlot !== null && (
                <View style={{ backgroundColor: SURFACE, borderRadius: RADIUS.md, padding: SP.sm, marginBottom: SP.sm }}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP.xs, maxWidth: 600 }}>
                      {QUICK_MENU_ALL_ACTIONS.map(a => (
                        <TouchableOpacity
                          key={a.key}
                          style={[styles.fontChip, prefs.quickMenuSlots[quickMenuEditSlot] === a.key && styles.fontChipActive]}
                          onPress={() => {
                            const slots = [...prefs.quickMenuSlots];
                            slots[quickMenuEditSlot!] = a.key;
                            onPrefsChange({ ...prefs, quickMenuSlots: slots });
                            onQuickMenuEditSlot(null);
                          }}
                          testID={`qm-action-${a.key}`}
                        >
                          <Text style={styles.fontChipText}>{a.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              )}

            </View>
          )}

        </ScrollView>
      </SheetRise>
    </Modal>
  );
}

// ─── Text Sheet ───────────────────────────────────────────────────────────────

interface TextSheetProps {
  visible: boolean;
  onClose: () => void;
  onAdd: (content: string, fontSize: number, color: string, bold: boolean, italic: boolean, align: 'left'|'center'|'right', fontFamily: string) => void;
  drawColor: string;
  PURPLE_DIM: string;
  PURPLE_LIGHT: string;
}

function TextSheet({ visible, onClose, onAdd, drawColor, PURPLE_DIM, PURPLE_LIGHT }: TextSheetProps) {
  const [content, setContent]       = useState('');
  const [fontSize, setFontSize]     = useState(28);
  const [color, setColor]           = useState(drawColor);
  const [bold, setBold]             = useState(false);
  const [italic, setItalic]         = useState(false);
  const [align, setAlign]           = useState<'left'|'center'|'right'>('center');
  const [fontFamily, setFontFamily] = useState('System');

  useEffect(() => { if (visible) setColor(drawColor); }, [visible, drawColor]);

  function submit() {
    if (!content.trim()) return;
    onAdd(content.trim(), fontSize, color, bold, italic, align, fontFamily);
    setContent('');
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <SheetRise style={[styles.sheet, { maxHeight: '85%' }]}>
          <SheetHandle />
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={styles.sheetHeaderRow}>
              <Text style={styles.sheetTitle}>Add Text</Text>
              <TouchableOpacity onPress={onClose}>
                <Text style={{ color: PURPLE_LIGHT, fontFamily: FONT.medium, fontSize: FS.sm }}>Cancel</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={[styles.textInput, { fontWeight: bold ? 'bold' : 'normal', fontStyle: italic ? 'italic' : 'normal', textAlign: align, color, fontSize }]}
              value={content}
              onChangeText={setContent}
              placeholder="Type something…"
              placeholderTextColor={SUBTLE}
              multiline autoFocus
            />

            <Text style={styles.sheetLabel}>Font</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: SP.sm }}>
              {FONT_FAMILIES.map(ff => (
                <TouchableOpacity
                  key={ff}
                  style={[styles.fontChip, fontFamily === ff && styles.fontChipActive]}
                  onPress={() => setFontFamily(ff)}
                >
                  <Text style={[styles.fontChipText, fontFamily === ff && { color: PURPLE_LIGHT }]}>{ff}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.sheetLabel}>Size: {fontSize}pt</Text>
            <View style={styles.sliderRow}>
              <TouchableOpacity onPress={() => setFontSize(v => Math.max(8, v - 2))}>
                <Feather name="minus" size={14} color={MUTED} />
              </TouchableOpacity>
              <View style={styles.sliderTrack}>
                <View style={[styles.sliderFill, { width: `${((fontSize - 8) / 192) * 100}%` }]} />
              </View>
              <TouchableOpacity onPress={() => setFontSize(v => Math.min(200, v + 2))}>
                <Feather name="plus" size={14} color={MUTED} />
              </TouchableOpacity>
              <Text style={styles.sliderValue}>{fontSize}</Text>
            </View>

            <View style={styles.toggleRow}>
              {([
                { label: 'B', active: bold,   onPress: () => setBold(v => !v) },
                { label: 'I', active: italic, onPress: () => setItalic(v => !v) },
              ] as { label: string; active: boolean; onPress: () => void }[]).map(t => (
                <TouchableOpacity key={t.label} style={[styles.toggleBtn, t.active && styles.toggleBtnActive]} onPress={t.onPress}>
                  <Text style={[styles.toggleBtnText, t.active && { color: PURPLE_LIGHT }]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
              {(['left', 'center', 'right'] as const).map(a => (
                <TouchableOpacity key={a} style={[styles.toggleBtn, align === a && styles.toggleBtnActive]} onPress={() => setAlign(a)}>
                  <Feather name={`align-${a}` as any} size={13} color={align === a ? PURPLE_LIGHT : MUTED} />
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sheetLabel}>Color</Text>
            <View style={styles.paletteGrid}>
              {DEFAULT_PALETTE.slice(0, 14).map(c => (
                <TouchableOpacity
                  key={c}
                  style={[styles.paletteDot, { backgroundColor: c }, color === c && styles.paletteDotActive]}
                  onPress={() => setColor(c)}
                />
              ))}
            </View>

            <TouchableOpacity style={styles.addBtn} onPress={submit}>
              <Text style={styles.addBtnText}>Add to Canvas</Text>
            </TouchableOpacity>
          </ScrollView>
        </SheetRise>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── SheetHandle ──────────────────────────────────────────────────────────────

function SheetHandle() {
  return (
    <View style={{ alignItems: 'center', paddingTop: SP.sm, paddingBottom: SP.xs }}>
      <View style={{ width: 36, height: 4, borderRadius: RADIUS.pill, backgroundColor: BORDER_ACTIVE }} />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const { width: SW } = Dimensions.get('window');

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  topBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: SURFACE,
    borderBottomWidth: 1, borderBottomColor: BORDER,
    paddingHorizontal: SP.xs, paddingBottom: SP.xs, gap: SP.xs,
  },
  topGroup:    { flexDirection: 'row', alignItems: 'center', gap: 2 },
  topCenter:   { flex: 1, alignItems: 'center', paddingHorizontal: SP.xs },
  topBtn:      { width: 36, height: 36, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  topBtnActive:   { backgroundColor: CARD_ELEVATED },
  topBtnDisabled: { opacity: 0.35 },
  topTitle:    { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, textAlign: 'center' },
  nameInput:   { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, borderBottomWidth: 1, borderBottomColor: BORDER_ACTIVE, textAlign: 'center', minWidth: 80 },

  toolRow: {
    flexGrow: 0,
    backgroundColor: SURFACE,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  toolRowContent: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SP.sm, paddingVertical: 6, gap: 4,
  },
  toolChip:      { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: SP.sm, paddingVertical: 7, borderRadius: RADIUS.sm },
  toolChipActive:{ backgroundColor: CARD_ELEVATED },
  toolChipLabel: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  toolDivider:   { width: 1, height: 20, backgroundColor: BORDER, marginHorizontal: 4 },

  colorSwatch:      { width: 30, height: 30, borderRadius: RADIUS.sm, borderWidth: 1.5, borderColor: BORDER, padding: 3, marginLeft: 4 },
  colorSwatchInner: { flex: 1, borderRadius: RADIUS.xs },

  canvasOuter: { flex: 1, flexDirection: 'row' },

  sizeSlider: {
    width: 44, alignItems: 'center', justifyContent: 'center',
    paddingVertical: SP.lg, gap: SP.sm,
    backgroundColor: CARD,
    borderRightWidth: 1, borderRightColor: BORDER,
  },
  sizeDisc:  { marginBottom: 8 },
  sizeTrack: { width: 4, flex: 1, backgroundColor: BORDER, borderRadius: RADIUS.pill, overflow: 'hidden', justifyContent: 'flex-end' },
  sizeFill:  { width: '100%', backgroundColor: FG, borderRadius: RADIUS.pill },
  sizeBubble:{ position: 'absolute', right: 50, top: '50%', backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.sm, paddingHorizontal: SP.sm, paddingVertical: 4, borderWidth: 1, borderColor: BORDER },
  sizeBubbleText: { color: FG, fontFamily: FONT.bold, fontSize: FS.sm },

  canvas:         { flex: 1, backgroundColor: BG, position: 'relative' },
  inlineTextInput:{ position: 'absolute', backgroundColor: 'transparent', fontFamily: FONT.regular, padding: 4, minHeight: 40 },
  canvasOverlay:  { position: 'absolute', top: SP.sm, right: SP.sm, flexDirection: 'column', gap: SP.xs },
  overlayBtn:     { width: 28, height: 28, borderRadius: RADIUS.xs, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  overlayBtnActive: { borderColor: BORDER_ACTIVE },
  canvasAddBar:   { position: 'absolute', bottom: SP.md, right: SP.md, flexDirection: 'column', gap: SP.xs },
  canvasAddBtn:   { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.sm, paddingHorizontal: SP.sm, paddingVertical: 7 },
  canvasAddLabel: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },

  // Transform handle Pressable overlays — positioned absolutely on canvas View
  // pointerEvents is NOT none; they must receive touch for startHandle() to fire.
  handlePressable: {
    position: 'absolute',
    zIndex: 10,
    // Transparent background so it's invisible but touchable
    backgroundColor: 'transparent',
  },

  selBar:    { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: SURFACE, borderTopWidth: 1, borderTopColor: BORDER, paddingHorizontal: SP.sm, paddingVertical: 6, gap: 4 },
  selBtn:    { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: SP.sm, paddingVertical: 6, borderRadius: RADIUS.xs, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  selBtnText:{ fontSize: FS.xs, fontFamily: FONT.medium, color: FG },

  // Sub-mode bars (selection / transform / adjustments) shown below canvas
  subModeBar:        { flexDirection: 'row', backgroundColor: SURFACE, borderTopWidth: 1, borderTopColor: BORDER, paddingHorizontal: SP.sm, paddingVertical: 6, gap: 4, flexWrap: 'wrap' },
  subModeChip:       { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: SP.sm, paddingVertical: 6, borderRadius: RADIUS.xs, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, minHeight: 32 },
  subModeChipActive: { borderColor: BORDER_ACTIVE, backgroundColor: CARD_ELEVATED },
  subModeLabel:      { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  subModeLabelActive:{ color: FG },

  wrenchMenu: {
    position: 'absolute', left: SP.sm,
    backgroundColor: CARD_ELEVATED,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
    minWidth: 200, maxWidth: 240, paddingVertical: SP.xs,
    shadowColor: BG, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.5, shadowRadius: 16, elevation: 12,
  },
  wrenchItem:     { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: 11, paddingHorizontal: SP.md },
  wrenchItemText: { fontSize: FS.sm, fontFamily: FONT.medium, color: FG },

  modalOverlay: { flex: 1, backgroundColor: OVERLAY, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: SURFACE,
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: SP.md, paddingBottom: SP.lg,
  },
  sheetTitle:     { fontSize: FS.md, fontFamily: FONT.bold, color: FG, marginBottom: SP.sm, marginTop: SP.xs },
  sheetLabel:     { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: SP.xs, marginTop: SP.sm },
  sheetHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.xs },
  sheetIconBtn:   { width: 32, height: 32, borderRadius: RADIUS.sm, backgroundColor: CARD_ELEVATED, alignItems: 'center', justifyContent: 'center' },

  brushSliders:   { gap: SP.xs, marginBottom: SP.sm },
  catScrollView:  { marginBottom: SP.sm },
  catChip:        { paddingHorizontal: SP.sm, paddingVertical: 6, borderRadius: RADIUS.pill, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, marginRight: SP.xs },
  catChipActive:  { borderColor: BORDER_ACTIVE },
  catChipText:    { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  brushList:      { maxHeight: 200 },
  brushRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: SP.sm, paddingHorizontal: SP.xs, borderRadius: RADIUS.sm, gap: SP.sm },
  brushRowActive: { backgroundColor: CARD_ELEVATED },
  brushStrokePreview: { width: 84, height: 28, backgroundColor: CARD, borderRadius: RADIUS.xs, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  brushName:      { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  brushCategory:  { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },

  colorSwatchRow:   { flexDirection: 'row', alignItems: 'flex-end', gap: SP.sm, marginBottom: SP.sm },
  colorSwatchGroup: { alignItems: 'center', gap: 4 },
  colorSwatchBig:   { width: 36, height: 36, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER },
  colorSwatchLabel: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  hexRow:    { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: CARD, borderRadius: RADIUS.xs, paddingHorizontal: SP.sm, paddingVertical: 6 },
  hexHash:   { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
  hexInput:  { width: 70, fontSize: FS.sm, fontFamily: FONT.bold, color: FG },
  pickerTabRow:   { flexDirection: 'row', gap: SP.xs, marginBottom: SP.sm },
  pickerTab:      { paddingHorizontal: SP.sm, paddingVertical: 6, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: BORDER },
  pickerTabActive:{ borderColor: BORDER_ACTIVE, backgroundColor: CARD_ELEVATED },
  pickerTabText:  { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  hueDiscContainer: { gap: SP.xs },
  hueRingRow:     { gap: 4, paddingBottom: 4 },
  hueCell:        { width: 28, height: 28, borderRadius: RADIUS.xs },
  paletteGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginBottom: SP.sm },
  paletteDot:     { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: 'transparent' },
  paletteDotActive: { borderColor: BORDER_ACTIVE, borderWidth: 2 },

  sliderRow:  { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  sliderLabel:{ fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, minWidth: 40 },
  sliderTrack:{ flex: 1, height: 4, backgroundColor: BORDER, borderRadius: RADIUS.pill, overflow: 'hidden' },
  sliderFill: { height: '100%', backgroundColor: FG, borderRadius: RADIUS.pill },
  sliderValue:{ fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, minWidth: 28, textAlign: 'right' },

  layerRow:       { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.sm, paddingHorizontal: SP.xs, borderRadius: RADIUS.sm },
  layerRowActive: { backgroundColor: CARD_ELEVATED },
  layerThumb:     {},
  layerThumbInner:{ width: 36, height: 36, borderRadius: RADIUS.xs, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER },
  layerInfo:      { flex: 1 },
  layerName:      { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  layerSub:       { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  layerActionBtn: { padding: 6 },

  layerActionsRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: SP.xs, marginTop: SP.md },
  layerActionPill:    { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SP.sm, paddingVertical: 8, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD },
  layerActionPillText:{ fontSize: FS.xs, fontFamily: FONT.medium, color: FG },
  blendChip:          { paddingHorizontal: SP.sm, paddingVertical: 6, borderRadius: RADIUS.pill, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, marginRight: SP.xs },
  blendChipActive:    { borderColor: BORDER_ACTIVE },
  blendChipText:      { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },

  textInput: {
    backgroundColor: CARD, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: SP.sm, paddingVertical: SP.sm, fontFamily: FONT.regular,
    minHeight: 80, textAlignVertical: 'top', marginBottom: SP.sm,
  },
  fontChip:       { paddingHorizontal: SP.sm, paddingVertical: 6, borderRadius: RADIUS.pill, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, marginRight: SP.xs },
  fontChipActive: { borderColor: BORDER_ACTIVE },
  fontChipText:   { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  toggleRow:      { flexDirection: 'row', gap: SP.xs, marginBottom: SP.sm },
  toggleBtn:      { width: 36, height: 36, borderRadius: RADIUS.xs, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  toggleBtnActive:{ backgroundColor: CARD_ELEVATED, borderColor: BORDER_ACTIVE },
  toggleBtnText:  { fontSize: FS.sm, fontFamily: FONT.bold, color: MUTED },

  addBtn:     { backgroundColor: FG, borderRadius: RADIUS.md, paddingVertical: SP.sm, alignItems: 'center', marginTop: SP.md },
  addBtnText: { fontSize: FS.base, fontFamily: FONT.bold, color: BG },

  exportRow:         { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER },
  exportRowDisabled: { opacity: 0.55 },
  exportIcon:        { width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: CARD_ELEVATED, alignItems: 'center', justifyContent: 'center' },
  exportLabel:       { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  exportSub:         { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },

  infoRow:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BORDER },
  infoLabel: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  infoValue: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },

  dimensionRow:  { flexDirection: 'row', alignItems: 'flex-end', gap: SP.sm },
  dimensionField:{ flex: 1 },
  dimensionLabel:{ fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, marginBottom: 4 },
  dimensionInput:{
    backgroundColor: CARD, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: SP.sm, paddingVertical: 10,
    fontSize: FS.base, fontFamily: FONT.semibold, color: FG,
  },

  emptyText: { color: SUBTLE, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', paddingVertical: SP.lg },

  // ── Reference window ────────────────────────────────────────────────────────
  referenceWindow: {
    position: 'absolute', zIndex: 20,
    backgroundColor: CARD_ELEVATED,
    borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER,
    overflow: 'hidden',
  },
  refDragBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.sm, paddingVertical: 4,
    backgroundColor: CARD_ELEVATED,
    height: 22,
  },
  refDragLabel: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },

  // ── Animation bar ───────────────────────────────────────────────────────────
  animBar: {
    position: 'absolute', bottom: SP.md + 36, left: SP.md,
    flexDirection: 'row', alignItems: 'center', gap: SP.xs,
    backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.sm,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: SP.sm, paddingVertical: 7,
  },
  animBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, padding: 4, minWidth: 28, minHeight: 28, justifyContent: 'center' },
  animFrameLabel: { fontSize: FS.xs, fontFamily: FONT.semibold, color: FG, minWidth: 80, textAlign: 'center' },
  animAddLabel: { fontSize: FS.xs, fontFamily: FONT.medium, color: FG },

  // ── Wrench sheet tabs ───────────────────────────────────────────────────────
  wrenchSheet: {
    backgroundColor: SURFACE,
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    borderWidth: 1, borderColor: BORDER,
    paddingBottom: SP.lg, maxHeight: '80%',
  },
  wrenchTabsRow: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER,
    paddingHorizontal: SP.xs,
  },
  wrenchTabBtn: {
    flex: 1, paddingVertical: SP.sm, alignItems: 'center', borderBottomWidth: 2,
    borderBottomColor: 'transparent', minHeight: 44,
  },
  wrenchTabBtnActive: { borderBottomColor: FG },
  wrenchTabLabel: { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED },
  wrenchTabLabelActive: { color: FG },

  // 2-column action grid
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: SP.md, gap: SP.sm },
  actionCell: {
    width: (SW - SP.md * 2 - SP.sm) / 2,
    backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: SP.md, gap: SP.xs, minHeight: 80,
  },
  actionCellDisabled: { opacity: 0.45 },
  actionCellActive: { borderColor: BORDER_ACTIVE, backgroundColor: CARD_ELEVATED },
  actionCellLabel: { fontSize: FS.xs, fontFamily: FONT.semibold, color: FG, textAlign: 'center' },
  actionCellSub: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', paddingHorizontal: 4 },

  // Guide controls
  guideRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BORDER },
  guideLabel: { fontSize: FS.sm, fontFamily: FONT.medium, color: FG },
  guideSub: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  togglePill: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, paddingHorizontal: SP.sm, paddingVertical: 6, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD, minHeight: 36 },
  togglePillActive: { borderColor: BORDER_ACTIVE, backgroundColor: CARD_ELEVATED },
  togglePillText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED },
  togglePillTextActive: { color: FG },

  // Video placeholder
  videoPlaceholder: { margin: SP.md, backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, padding: SP.lg, alignItems: 'center', gap: SP.sm },
  videoPlaceholderTitle: { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  videoPlaceholderSub: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center' },

  // Preferences / guide section dividers
  guideSectionHeader: { paddingTop: SP.sm, paddingBottom: SP.xs, borderBottomWidth: 1, borderBottomColor: BORDER, marginBottom: SP.xs },
  guideSectionTitle:  { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
});
