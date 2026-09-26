/**
 * Brandthread Design Studio — Gallery & Canvas Management
 *
 * Visual reference: Procreate Pocket iOS gallery screenshots (structure only, not branding).
 *
 * Gallery:
 *  - Large bold left-aligned "Design Studio" title directly below safe-area inset.
 *  - Compact action row flush below title: "Select  Import  Photo" (FG color, no dividers)
 *    with a bare "+" pushed to the far right at the same baseline.
 *  - Three-column artwork grid. Thumbnails fill each cell with no card chrome.
 *    Name + "W × H px" dims text left-aligned beneath each thumbnail.
 *  - No dashboard chrome, banners, or button-pill rows on the gallery surface.
 *
 * Recovery modal (Procreate screenshots 1 & 2 as structural reference):
 *  - Full-screen, opaque BG. "Cancel" top-right in muted text.
 *  - Prompt phase: large rounded-rect icon box, bold app name, descriptor text,
 *    two full-width dark-fill buttons (Recover / Not Now).
 *  - Running/Done phase: large bold centered title, muted subtitle, large filled
 *    success circle with checkmark (done) or ActivityIndicator (running).
 *  - Error phase: triangle icon + retry / dismiss.
 *
 * All service contracts, recovery semantics, and account/store scoping preserved.
 */

import React, { useState, useCallback, useRef } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Alert, ActivityIndicator, FlatList, Modal, TextInput,
  Dimensions, Pressable, Linking, } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';

import {
  BG, SURFACE, CARD, CARD_ELEVATED,
  BORDER, BORDER_SUBTLE, BORDER_ACTIVE,
  FG, MUTED, SUBTLE,
  RED, SUCCESS,
  FONT, FS, SP, RADIUS, ICON, COMP, OVERLAY,
} from '@/lib/theme';
import {
  getProjects, softDeleteProject, duplicateProject,
  updateProject, createProject, getDeletedProjects,
  restoreDeletedProject, deleteProject, purgeDeletedProjects,
  getSyncedDesignAssets,
  getRecoverableLegacyProjectCount, recoverLegacyDesignProjects,
} from '@/services/designService';
import {
  DesignProject,
  SELLER_CANVAS_PRESETS, SellerCanvasPreset,
} from '@/services/designTypes';
import DesignLayerCompositor from '@/components/DesignLayerCompositor';
import { makeDurableUri } from '@/lib/imageUri';
import { validateBtJson } from '@/lib/btLayerValidator';
import { validateJsonByteLength } from '@/lib/fileValidator';
import { SheetRise } from '@/components/motion/SheetRise';
import { GridSkeleton } from '@/components/layout';

// ─── Constants ────────────────────────────────────────────────────────────────

// ─── Grid geometry ─────────────────────────────────────────────────────────────
// 3 columns, flush horizontal padding of 16px each side, 8px inter-column gaps.
// DesignLayerCompositor accepts a square displaySize; we pass CELL_SIZE and let
// the compositor handle any aspect-ratio letterboxing internally.
const GRID_COLUMNS = 3;
const GRID_GAP     = SP.sm;                          // 8px between columns
const GRID_H_PAD   = SP.md;                          // 16px left/right page margin
const SCREEN_W     = Dimensions.get('window').width;
const CELL_SIZE    = Math.floor(
  (SCREEN_W - GRID_H_PAD * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS,
);
// Aspect: ~1.4 portrait ratio (like phone screen art). Matches the tall thumbnails
// visible in screenshot 0.
const THUMB_H      = Math.round(CELL_SIZE * 1.4);

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _uid = 0;
function uid(): string { return `uid_${Date.now()}_${++_uid}`; }

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// "1847 × 4000px" — uses narrow multiplication sign (U+00D7) matching the reference
function dimsLabel(p: DesignProject): string {
  return `${p.canvas.width} \u00D7 ${p.canvas.height}px`;
}

const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

// ─── Recovery Modal ───────────────────────────────────────────────────────────
// Full-screen, slides up. Matches screenshots 1 and 2 in structure:
//   • Cancel top-right (muted)
//   • Prompt: icon box, title, descriptor text, two dark-fill buttons
//   • Running/Done: large title centred at ~40% height, subtitle, large circle mark
//   • Error: triangle mark, retry / dismiss

type RecoveryPhase = 'prompt' | 'running' | 'done' | 'error';

interface RecoveryModalProps {
  visible: boolean;
  count: number;
  onClose: () => void;
  onRecovered: () => void;
}

function RecoveryModal({ visible, count, onClose, onRecovered }: RecoveryModalProps) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<RecoveryPhase>('prompt');
  const [errorMsg, setErrorMsg] = useState('');

  // Reset to prompt whenever the modal opens
  const prevVisRef = useRef(false);
  if (prevVisRef.current !== visible) {
    prevVisRef.current = visible;
    if (visible) { setPhase('prompt'); setErrorMsg(''); }
  }

  async function startRecovery() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPhase('running');
    try {
      await recoverLegacyDesignProjects();
      setPhase('done');
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Recovery failed. Your original projects were not changed.');
      setPhase('error');
    }
  }

  function handleDone() {
    onRecovered();   // re-fetches gallery
    onClose();
  }

  // Web inset: 67px status bar + 34px home bar
  const topPad    = insets.top;
  const bottomPad = insets.bottom;

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="slide"
      onRequestClose={onClose}
      testID="recovery-modal"
    >
      <View style={[rm.screen, { paddingTop: topPad, paddingBottom: bottomPad }]}>

        {/* Cancel — top-right, muted (matches iOS style in ref screenshots) */}
        <View style={rm.topBar}>
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            onPress={onClose}
            hitSlop={HIT}
            style={rm.cancelTouchable}
            accessibilityLabel="Cancel recovery"
            accessibilityRole="button"
            testID="recovery-cancel"
          >
            <Text style={rm.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>

        {/* ── Prompt phase ───────────────────────────────────────────────── */}
        {phase === 'prompt' && (
          <View style={rm.promptBody}>
            {/* Brandthread icon block — white rounded-rect, like screenshot 1 icon box */}
            <View style={rm.iconBlock}>
              <View style={rm.iconInner}>
                <Feather name="layers" size={44} color={BG} />
              </View>
            </View>

            <Text style={rm.promptTitle}>Design Studio</Text>

            <Text style={rm.promptDesc}>
              {count} design{count === 1 ? '' : 's'} saved on this device before account sync.{'\n'}
              Recover only if they belong to the selected store.
            </Text>

            <View style={rm.promptActions}>
              <TouchableOpacity
                style={rm.darkBtn}
                onPress={startRecovery}
                activeOpacity={0.75}
                accessibilityLabel="Recover projects from this device"
                accessibilityRole="button"
                testID="recovery-start"
              >
                <Text style={rm.darkBtnLabel}>Recover Projects</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={rm.darkBtn}
                onPress={onClose}
                activeOpacity={0.75}
                accessibilityLabel="Not now, dismiss recovery"
                accessibilityRole="button"
                testID="recovery-not-now"
              >
                <Text style={rm.darkBtnLabel}>Not Now</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Running phase ───────────────────────────────────────────────── */}
        {phase === 'running' && (
          <View style={rm.progressBody}>
            <Text style={rm.progressTitle}>Project Recovery</Text>
            <Text style={rm.progressSub}>Scanning for device designs</Text>
            <View style={rm.circleMark}>
              <ActivityIndicator size="large" color={FG} />
            </View>
          </View>
        )}

        {/* ── Done phase ─────────────────────────────────────────────────── */}
        {phase === 'done' && (
          <View style={rm.progressBody}>
            <Text style={rm.progressTitle}>Recovery Complete</Text>
            <Text style={rm.progressSub}>Projects added to your Design Studio</Text>
            {/* Large success circle with checkmark — matches screenshot 2 */}
            <View style={[rm.circleMark, rm.circleBlue]}>
              <Feather name="check" size={36} color={BG} />
            </View>
            <TouchableOpacity
              style={[rm.darkBtn, rm.doneBtn]}
              onPress={handleDone}
              activeOpacity={0.75}
              accessibilityLabel="Done, return to gallery"
              accessibilityRole="button"
              testID="recovery-done"
            >
              <Text style={rm.darkBtnLabel}>Done</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Error phase ─────────────────────────────────────────────────── */}
        {phase === 'error' && (
          <View style={rm.progressBody}>
            <Text style={rm.progressTitle}>Recovery Failed</Text>
            <Text style={rm.progressSub}>
              {errorMsg || 'Your original projects were not changed.'}
            </Text>
            <View style={rm.circleMark}>
              <Feather name="alert-triangle" size={32} color={MUTED} />
            </View>
            <View style={[rm.promptActions, { marginTop: SP.xl }]}>
              <TouchableOpacity
                style={rm.darkBtn}
                onPress={() => { setPhase('prompt'); setErrorMsg(''); }}
                activeOpacity={0.75}
                accessibilityLabel="Try recovery again"
                accessibilityRole="button"
                testID="recovery-retry"
              >
                <Text style={rm.darkBtnLabel}>Try Again</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={rm.darkBtn}
                onPress={onClose}
                activeOpacity={0.75}
                accessibilityLabel="Dismiss recovery error"
                accessibilityRole="button"
                testID="recovery-dismiss"
              >
                <Text style={rm.darkBtnLabel}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const rm = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  // Cancel bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.lg,
    minHeight: COMP.buttonHSm,
    paddingTop: SP.xs,
  },
  cancelTouchable: {
    minHeight: COMP.buttonHSm,
    justifyContent: 'center',
    paddingLeft: SP.sm,
  },
  cancelText: {
    fontFamily: FONT.regular,
    fontSize: FS.base,
    color: MUTED,
  },

  // Prompt layout
  promptBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP.xl,
    paddingBottom: SP.xxl,
  },
  iconBlock: { marginBottom: SP.lg },
  iconInner: {
    width: 120,
    height: 120,
    borderRadius: RADIUS.xl,
    backgroundColor: FG,            // white block (Brandthread FG)
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptTitle: {
    fontFamily: FONT.bold,
    fontSize: FS.h2,
    color: FG,
    textAlign: 'center',
    marginBottom: SP.md,
  },
  promptDesc: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 300,
    marginBottom: SP.xl,
  },
  promptActions: {
    width: '100%',
    gap: SP.sm,
  },

  // Dark-fill action button (matches the "Restore Example Artworks" / "Start Gallery Recovery"
  // buttons in screenshot 1 — dark rounded-rect, centered white text)
  darkBtn: {
    height: COMP.buttonH,
    borderRadius: RADIUS.md,
    backgroundColor: CARD_ELEVATED,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  darkBtnLabel: {
    fontFamily: FONT.regular,
    fontSize: FS.base,
    color: FG,
  },

  // Progress / result layout — content centred at ~40% from top (not dead-center)
  progressBody: {
    flex: 1,
    alignItems: 'center',
    // Bias upward: use paddingBottom to shift centroid up
    paddingBottom: '30%',
    justifyContent: 'center',
    paddingHorizontal: SP.xl,
  },
  progressTitle: {
    fontFamily: FONT.bold,
    fontSize: FS.h2,
    color: FG,
    textAlign: 'center',
  },
  progressSub: {
    fontFamily: FONT.regular,
    fontSize: FS.base,
    color: MUTED,
    textAlign: 'center',
    marginTop: SP.xs,
    marginBottom: SP.xl,
    maxWidth: 280,
  },
  // Large circle mark — grey by default, success color when complete
  circleMark: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: CARD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleBlue: {
    backgroundColor: SUCCESS,
  },
  doneBtn: {
    marginTop: SP.xl,
    width: '100%',
  },
});

// ─── New Canvas Sheet ─────────────────────────────────────────────────────────

type NewCanvasTab = 'presets' | 'custom' | 'clipboard';
type ColorProfile = 'sRGB' | 'P3';
type SizeUnit = 'px' | 'in';

const SCREEN_QUICK_CHOICES = [
  { label: 'Screen',  width: 1170, height: 2532, desc: 'iPhone 14 Pro' },
  { label: 'Tablet',  width: 2048, height: 2732, desc: 'iPad Pro 12.9"' },
  { label: 'Desktop', width: 2560, height: 1600, desc: '13" MacBook' },
];
const DPI_OPTIONS = [72, 150, 300];

interface NewCanvasSheetProps {
  visible: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}

function NewCanvasSheet({ visible, onClose, onCreated }: NewCanvasSheetProps) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<NewCanvasTab>('presets');
  const [customW, setCustomW] = useState('1080');
  const [customH, setCustomH] = useState('1080');
  const [unit, setUnit] = useState<SizeUnit>('px');
  const [colorProfile, setColorProfile] = useState<ColorProfile>('sRGB');
  const [dpi, setDpi] = useState(72);
  const [customTitle, setCustomTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [clipState, setClipState] = useState<
    'idle' | 'checking' | 'has_image' | 'has_text' | 'empty' | 'unsupported'
  >('idle');

  const checkClipRef = useRef<(() => Promise<void>) | null>(null);
  checkClipRef.current = async () => {
    setClipState('checking');
    try {
      if (await Clipboard.hasImageAsync()) { setClipState('has_image'); return; }
      const txt = await Clipboard.getStringAsync();
      if (txt?.trim().startsWith('{')) {
        try {
          const p = JSON.parse(txt.trim());
          if (p?.id && p?.canvas && p?.layers) { setClipState('has_text'); return; }
        } catch { /* ignore */ }
      }
      setClipState('empty');
    } catch {
      setClipState('unsupported');
    }
  };

  function switchTab(t: NewCanvasTab) {
    Haptics.selectionAsync();
    setTab(t);
    if (t === 'clipboard') checkClipRef.current?.();
  }

  function toPx(val: string): number {
    const n = parseFloat(val) || 0;
    return unit === 'in' ? n * dpi : n;
  }

  async function createFromPreset(preset: SellerCanvasPreset) {
    if (creating) return;
    setCreating(true);
    try {
      const proj = await createProject('canvas', preset.label, {
        width: preset.width, height: preset.height,
        backgroundHex: preset.transparentBg ? 'transparent' : '#000000',
      });
      onClose(); onCreated(proj.id);
    } catch { Alert.alert('Error', 'Could not create canvas.'); }
    finally { setCreating(false); }
  }

  async function createCustom() {
    const w = toPx(customW), h = toPx(customH);
    if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 8 || h < 8 || w > 16384 || h > 16384) {
      Alert.alert('Invalid size', 'Width and height must be whole pixels between 8 and 16384.');
      return;
    }
    if (creating) return;
    setCreating(true);
    try {
      const proj = await createProject('canvas', customTitle.trim() || `${w} \u00D7 ${h}`, { width: w, height: h, backgroundHex: '#000000' });
      onClose(); onCreated(proj.id);
    } catch { Alert.alert('Error', 'Could not create canvas.'); }
    finally { setCreating(false); }
  }

  async function createFromClipboardImage() {
    if (creating) return;
    setCreating(true);
    try {
      const img = await Clipboard.getImageAsync({ format: 'png' });
      if (!img?.data) { Alert.alert('No image', 'Could not read image from clipboard.'); return; }
      const dataUri = `data:image/png;base64,${img.data}`;
      const w = img.size?.width || 1080, h = img.size?.height || 1080;
      const proj = await createProject('canvas', 'From Clipboard', { width: w, height: h, backgroundHex: '#000000' });
      const now = new Date().toISOString();
      await updateProject(proj.id, {
        layers: [{
          id: uid(), name: 'Clipboard Image', type: 'image',
          visible: true, locked: false, order: 0, opacity: 1,
          transform: { x: 0, y: 0, width: w, height: h, rotation: 0, scaleX: 1, scaleY: 1 },
          data: { kind: 'image' as const, uri: dataUri, opacity: 1, fit: 'contain', blendMode: 'normal' },
          createdAt: now, updatedAt: now,
        }],
      });
      onClose(); onCreated(proj.id);
    } catch { Alert.alert('Error', 'Could not create from clipboard image.'); }
    finally { setCreating(false); }
  }

  async function importClipboardJSON() {
    if (creating) return;
    setCreating(true);
    try {
      const txt = await Clipboard.getStringAsync();
      if (!txt) throw new Error('Empty clipboard');
      const sizeResult = validateJsonByteLength(txt);
      if (!sizeResult.ok) throw new Error(sizeResult.reason);
      const validation = validateBtJson(txt);
      if (!validation.ok) throw new Error(validation.reason);
      const parsed = JSON.parse(txt.trim());
      if (!parsed.canvas || typeof parsed.canvas !== 'object') throw new Error('Invalid project JSON');
      const width = Number(parsed.canvas.width), height = Number(parsed.canvas.height);
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 16384 || height > 16384)
        throw new Error('Invalid canvas dimensions');
      const now = new Date().toISOString();
      const proj = await createProject('canvas', `${parsed.name || 'Imported'} (imported)`, {
        width, height,
        backgroundHex: typeof parsed.canvas.backgroundHex === 'string' ? parsed.canvas.backgroundHex : '#000000',
      });
      await updateProject(proj.id, { layers: validation.layers, createdAt: now, updatedAt: now });
      onClose(); onCreated(proj.id);
    } catch { Alert.alert('Error', 'Clipboard does not contain a valid Brandthread project.'); }
    finally { setCreating(false); }
  }

  const TABS: { key: NewCanvasTab; label: string }[] = [
    { key: 'presets', label: 'Size' },
    { key: 'custom', label: 'Custom' },
    { key: 'clipboard', label: 'Clipboard' },
  ];

  const sheetBottom = insets.bottom;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} testID="new-canvas-sheet">
      <Pressable style={sh.overlay} onPress={onClose} accessibilityLabel="Close new canvas sheet" />
      <SheetRise style={[sh.sheet, { paddingBottom: sheetBottom + SP.lg }]}>
        <View style={sh.handle} />
        <View style={sh.header}>
          <TouchableOpacity
            onPress={onClose} hitSlop={HIT} style={sh.cancelBtn}
            accessibilityLabel="Cancel new canvas" accessibilityRole="button" testID="new-canvas-cancel"
          >
            <Text style={sh.cancelTxt}>Cancel</Text>
          </TouchableOpacity>
          <Text style={sh.title}>New Canvas</Text>
          <View style={{ width: 60 }} />
        </View>

        <View style={sh.tabRow}>
          {TABS.map(t => (
            <TouchableOpacity
              key={t.key}
              style={[sh.tabBtn, tab === t.key && sh.tabBtnActive]}
              onPress={() => switchTab(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === t.key }}
              accessibilityLabel={`${t.label} tab`}
              testID={`new-canvas-tab-${t.key}`}
            >
              <Text style={[sh.tabLbl, tab === t.key && sh.tabLblActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <FlatList
          data={[null]}
          keyExtractor={() => 'c'}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={sh.tabContent}
          renderItem={() => (
            <View>
              {/* ── Presets ── */}
              {tab === 'presets' && (
                <>
                  <Text style={sh.sectionHd}>Screen sizes</Text>
                  {SCREEN_QUICK_CHOICES.map(qc => (
                    <TouchableOpacity
                      key={qc.label} style={sh.presetRow}
                      onPress={() => createFromPreset({ id: qc.label.toLowerCase(), label: qc.label, description: qc.desc, width: qc.width, height: qc.height, dpi: 72, colorProfile: 'sRGB' })}
                      activeOpacity={0.75}
                      accessibilityLabel={`Create ${qc.label} canvas, ${qc.width} by ${qc.height}`}
                      accessibilityRole="button"
                      testID={`preset-${qc.label.toLowerCase()}`}
                    >
                      <View style={sh.presetIcon}><Feather name="monitor" size={ICON.md} color={MUTED} /></View>
                      <View style={sh.presetInfo}>
                        <Text style={sh.presetLbl}>{qc.label}</Text>
                        <Text style={sh.presetDim}>{qc.width} \u00D7 {qc.height} — {qc.desc}</Text>
                      </View>
                      {creating ? <ActivityIndicator size="small" color={MUTED} /> : <Feather name="chevron-right" size={ICON.sm} color={SUBTLE} />}
                    </TouchableOpacity>
                  ))}
                  <Text style={[sh.sectionHd, { marginTop: SP.lg }]}>Seller presets</Text>
                  {SELLER_CANVAS_PRESETS.map(preset => (
                    <TouchableOpacity
                      key={preset.id} style={sh.presetRow}
                      onPress={() => createFromPreset(preset)}
                      activeOpacity={0.75}
                      accessibilityLabel={`Create ${preset.label} canvas`}
                      accessibilityRole="button"
                      testID={`preset-${preset.id}`}
                    >
                      <View style={[sh.presetIcon, { backgroundColor: CARD_ELEVATED }]}>
                        <Feather
                          name={preset.id === 'logo_sticker' ? 'star' : preset.id === 'tshirt_print' ? 'layers' : preset.id.startsWith('ig') ? 'instagram' : 'image'}
                          size={ICON.md} color={FG}
                        />
                      </View>
                      <View style={sh.presetInfo}>
                        <Text style={sh.presetLbl}>{preset.label}</Text>
                        <Text style={sh.presetDim}>{preset.description}</Text>
                      </View>
                      {creating ? <ActivityIndicator size="small" color={MUTED} /> : <Feather name="chevron-right" size={ICON.sm} color={SUBTLE} />}
                    </TouchableOpacity>
                  ))}
                </>
              )}

              {/* ── Custom ── */}
              {tab === 'custom' && (
                <>
                  <Text style={sh.sectionHd}>Canvas title</Text>
                  <TextInput
                    style={sh.input} placeholder="e.g. Summer Drop Banner" placeholderTextColor={MUTED}
                    value={customTitle} onChangeText={setCustomTitle}
                    accessibilityLabel="Canvas title" testID="custom-title-input"
                  />
                  <Text style={[sh.sectionHd, { marginTop: SP.md }]}>Unit</Text>
                  <View style={sh.segRow}>
                    {(['px', 'in'] as SizeUnit[]).map(u => (
                      <TouchableOpacity key={u} style={[sh.segBtn, unit === u && sh.segBtnOn]} onPress={() => setUnit(u)}
                        accessibilityRole="radio" accessibilityState={{ checked: unit === u }} accessibilityLabel={u === 'px' ? 'Pixels' : 'Inches'}>
                        <Text style={[sh.segLbl, unit === u && sh.segLblOn]}>{u}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={[sh.sectionHd, { marginTop: SP.md }]}>Dimensions</Text>
                  <View style={sh.dimRow}>
                    <View style={sh.dimField}>
                      <Text style={sh.dimLbl}>Width</Text>
                      <TextInput style={sh.dimInput} keyboardType="numeric" value={customW} onChangeText={setCustomW} selectTextOnFocus
                        accessibilityLabel="Canvas width" testID="custom-width-input" />
                    </View>
                    <Text style={sh.dimX}>\u00D7</Text>
                    <View style={sh.dimField}>
                      <Text style={sh.dimLbl}>Height</Text>
                      <TextInput style={sh.dimInput} keyboardType="numeric" value={customH} onChangeText={setCustomH} selectTextOnFocus
                        accessibilityLabel="Canvas height" testID="custom-height-input" />
                    </View>
                  </View>
                  {unit === 'in' && (
                    <>
                      <Text style={[sh.sectionHd, { marginTop: SP.md }]}>Resolution (DPI)</Text>
                      <View style={sh.segRow}>
                        {DPI_OPTIONS.map(d => (
                          <TouchableOpacity key={d} style={[sh.segBtn, dpi === d && sh.segBtnOn]} onPress={() => setDpi(d)}
                            accessibilityRole="radio" accessibilityState={{ checked: dpi === d }} accessibilityLabel={`${d} DPI`}>
                            <Text style={[sh.segLbl, dpi === d && sh.segLblOn]}>{d}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </>
                  )}
                  <Text style={[sh.sectionHd, { marginTop: SP.md }]}>Color profile</Text>
                  <View style={sh.segRow}>
                    {(['sRGB', 'P3'] as ColorProfile[]).map(cp => (
                      <TouchableOpacity key={cp} style={[sh.segBtn, colorProfile === cp && sh.segBtnOn]} onPress={() => setColorProfile(cp)}
                        accessibilityRole="radio" accessibilityState={{ checked: colorProfile === cp }} accessibilityLabel={cp}>
                        <Text style={[sh.segLbl, colorProfile === cp && sh.segLblOn]}>{cp}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={sh.dimPreview}>
                    <Text style={sh.dimPreviewTxt}>
                      {toPx(customW)} \u00D7 {toPx(customH)} px{unit === 'in' ? `  (${customW || 0} \u00D7 ${customH || 0} in @ ${dpi} dpi)` : ''}
                    </Text>
                  </View>
                  <TouchableOpacity style={[sh.createBtn, creating && { opacity: 0.5 }]} onPress={createCustom} activeOpacity={0.8} disabled={creating}
                    accessibilityLabel="Create custom canvas" accessibilityRole="button" testID="custom-create-btn">
                    {creating ? <ActivityIndicator size="small" color={BG} /> : <Text style={sh.createBtnLbl}>Create Canvas</Text>}
                  </TouchableOpacity>
                </>
              )}

              {/* ── Clipboard ── */}
              {tab === 'clipboard' && (
                <>
                  {clipState === 'checking' && (
                    <View style={sh.clipCenter}>
                      <ActivityIndicator color={FG} size="large" />
                      <Text style={[sh.clipMsg, { marginTop: SP.md }]}>Checking clipboard</Text>
                    </View>
                  )}
                  {clipState === 'has_image' && (
                    <>
                      <View style={sh.clipRow}>
                        <Feather name="image" size={ICON.lg} color={FG} />
                        <View style={{ flex: 1 }}>
                          <Text style={sh.clipTitle}>Image found</Text>
                          <Text style={sh.clipSub}>A new canvas will be created with it as the base layer.</Text>
                        </View>
                      </View>
                      <TouchableOpacity style={[sh.createBtn, creating && { opacity: 0.5 }]} onPress={createFromClipboardImage} disabled={creating} activeOpacity={0.8}
                        accessibilityLabel="Create canvas from clipboard image" accessibilityRole="button" testID="clip-create-image">
                        {creating ? <ActivityIndicator size="small" color={BG} /> : <Text style={sh.createBtnLbl}>Create from Image</Text>}
                      </TouchableOpacity>
                    </>
                  )}
                  {clipState === 'has_text' && (
                    <>
                      <View style={sh.clipRow}>
                        <Feather name="file-text" size={ICON.lg} color={FG} />
                        <View style={{ flex: 1 }}>
                          <Text style={sh.clipTitle}>Brandthread project found</Text>
                          <Text style={sh.clipSub}>Clipboard contains a Brandthread project JSON.</Text>
                        </View>
                      </View>
                      <TouchableOpacity style={[sh.createBtn, creating && { opacity: 0.5 }]} onPress={importClipboardJSON} disabled={creating} activeOpacity={0.8}
                        accessibilityLabel="Import project from clipboard" accessibilityRole="button" testID="clip-import-json">
                        {creating ? <ActivityIndicator size="small" color={BG} /> : <Text style={sh.createBtnLbl}>Import Project</Text>}
                      </TouchableOpacity>
                    </>
                  )}
                  {clipState === 'empty' && (
                    <View style={sh.clipCenter}>
                      <Feather name="clipboard" size={ICON.xxl} color={SUBTLE} />
                      <Text style={[sh.clipMsg, { marginTop: SP.md }]}>Clipboard is empty</Text>
                      <Text style={[sh.clipSub, { textAlign: 'center', marginTop: SP.xs }]}>
                        Copy an image or a Brandthread project JSON, then return here.
                      </Text>
                    </View>
                  )}
                  {clipState === 'unsupported' && (
                    <View style={sh.clipCenter}>
                      <Feather name="alert-circle" size={ICON.xxl} color={MUTED} />
                      <Text style={[sh.clipMsg, { marginTop: SP.md }]}>Clipboard access unavailable</Text>
                      <Text style={[sh.clipSub, { textAlign: 'center', marginTop: SP.xs }]}>
                        Use Photo import or choose a preset instead.
                      </Text>
                    </View>
                  )}
                  {clipState === 'idle' && (
                    <TouchableOpacity style={sh.createBtn} onPress={() => checkClipRef.current?.()}
                      accessibilityLabel="Check clipboard for image or project" accessibilityRole="button" testID="clip-check-btn">
                      <Text style={sh.createBtnLbl}>Check Clipboard</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          )}
        />
      </SheetRise>
    </Modal>
  );
}

// Sheet styles (prefixed sh)
const sh = StyleSheet.create({
  overlay:  { ...StyleSheet.absoluteFill, backgroundColor: OVERLAY },
  sheet:    { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '90%', backgroundColor: SURFACE, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, borderTopWidth: 1, borderColor: BORDER },
  handle:   { width: 36, height: 4, borderRadius: 2, backgroundColor: BORDER_ACTIVE, alignSelf: 'center', marginTop: SP.sm, marginBottom: SP.xs, opacity: 0.3 },
  header:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.lg, paddingBottom: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE },
  cancelBtn: { minWidth: 60, minHeight: COMP.iconBtn, justifyContent: 'center' },
  cancelTxt: { fontFamily: FONT.regular, fontSize: FS.base, color: MUTED },
  title:    { flex: 1, textAlign: 'center', fontFamily: FONT.semibold, fontSize: FS.base, color: FG },
  tabRow:   { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE, marginHorizontal: SP.lg },
  tabBtn:   { flex: 1, alignItems: 'center', paddingVertical: SP.sm, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActive: { borderBottomColor: FG },
  tabLbl:   { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED },
  tabLblActive: { color: FG },
  tabContent: { paddingHorizontal: SP.lg, paddingTop: SP.md, paddingBottom: SP.xxl },
  sectionHd: { fontFamily: FONT.semibold, fontSize: FS.xs, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: SP.sm },
  presetRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingVertical: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE, minHeight: COMP.buttonHSm },
  presetIcon: { width: 40, height: 40, borderRadius: RADIUS.sm, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' },
  presetInfo: { flex: 1 },
  presetLbl: { fontFamily: FONT.medium, fontSize: FS.base, color: FG },
  presetDim: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, marginTop: 2 },
  input:     { height: COMP.inputH, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, paddingHorizontal: SP.md, fontFamily: FONT.regular, fontSize: FS.base, color: FG, backgroundColor: CARD },
  segRow:    { flexDirection: 'row', gap: SP.xs },
  segBtn:    { flex: 1, height: 40, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', backgroundColor: CARD },
  segBtnOn:  { borderColor: FG, backgroundColor: FG },
  segLbl:    { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED },
  segLblOn:  { color: BG },
  dimRow:    { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  dimField:  { flex: 1 },
  dimLbl:    { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, marginBottom: SP.xs },
  dimInput:  { height: COMP.buttonHSm, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, paddingHorizontal: SP.md, fontFamily: FONT.regular, fontSize: FS.base, color: FG, backgroundColor: CARD, textAlign: 'center' },
  dimX:      { fontFamily: FONT.regular, fontSize: FS.base, color: MUTED, marginTop: SP.lg },
  dimPreview: { backgroundColor: CARD, borderRadius: RADIUS.md, padding: SP.sm, marginVertical: SP.md, alignItems: 'center' },
  dimPreviewTxt: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED },
  createBtn: { height: COMP.buttonH, borderRadius: RADIUS.md, backgroundColor: FG, alignItems: 'center', justifyContent: 'center', marginTop: SP.sm },
  createBtnLbl: { fontFamily: FONT.semibold, fontSize: FS.base, color: BG },
  clipCenter: { alignItems: 'center', paddingVertical: SP.xxl },
  clipRow:   { flexDirection: 'row', gap: SP.md, alignItems: 'flex-start', backgroundColor: CARD, borderRadius: RADIUS.lg, padding: SP.md, marginBottom: SP.md },
  clipTitle: { fontFamily: FONT.semibold, fontSize: FS.base, color: FG, marginBottom: SP.xs },
  clipMsg:   { fontFamily: FONT.semibold, fontSize: FS.base, color: FG },
  clipSub:   { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, lineHeight: 20 },
});

// ─── Rename Sheet ─────────────────────────────────────────────────────────────

interface RenameSheetProps {
  visible: boolean;
  project: DesignProject | null;
  onClose: () => void;
  onRenamed: () => void;
}

function RenameSheet({ visible, project, onClose, onRenamed }: RenameSheetProps) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const prevVisRef = useRef(false);
  if (prevVisRef.current !== visible) {
    prevVisRef.current = visible;
    if (visible && project) {
      setName(project.name);
      setTimeout(() => inputRef.current?.focus(), 220);
    }
  }

  async function save() {
    if (!project || !name.trim()) return;
    setSaving(true);
    try {
      await updateProject(project.id, { name: name.trim() });
      onRenamed();
      onClose();
    } catch {
      Alert.alert('Error', 'Could not rename project.');
    } finally {
      setSaving(false);
    }
  }

  const sheetBottom = insets.bottom;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} testID="rename-sheet">
      <Pressable style={sh.overlay} onPress={onClose} accessibilityLabel="Dismiss rename" />
      <View style={[rn.sheet, { paddingBottom: sheetBottom + SP.lg }]}>
        <View style={sh.handle} />
        {project && (
          <View style={rn.thumbWrap}>
            <DesignLayerCompositor project={project} displaySize={120} borderRadius={RADIUS.md} />
          </View>
        )}
        <TextInput
          ref={inputRef}
          style={rn.input}
          value={name}
          onChangeText={setName}
          selectTextOnFocus
          returnKeyType="done"
          onSubmitEditing={save}
          placeholder="Project name"
          placeholderTextColor={MUTED}
          accessibilityLabel="Project name"
          testID="rename-input"
        />
        <Text style={rn.dims}>{project ? dimsLabel(project) : ''}</Text>
        <TouchableOpacity
          style={[sh.createBtn, saving && { opacity: 0.5 }]}
          onPress={save} disabled={saving} activeOpacity={0.8}
          accessibilityLabel="Save project name" accessibilityRole="button" testID="rename-save"
        >
          {saving ? <ActivityIndicator size="small" color={BG} /> : <Text style={sh.createBtnLbl}>Done</Text>}
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const rn = StyleSheet.create({
  sheet:    { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: SURFACE, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, borderTopWidth: 1, borderColor: BORDER, paddingHorizontal: SP.lg },
  thumbWrap: { alignItems: 'center', paddingTop: SP.lg, paddingBottom: SP.md },
  input:    { height: COMP.inputH, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER_ACTIVE, paddingHorizontal: SP.md, fontFamily: FONT.semibold, fontSize: FS.md, color: FG, backgroundColor: CARD, textAlign: 'center', marginBottom: SP.xs },
  dims:     { fontFamily: FONT.regular, fontSize: FS.xs, color: SUBTLE, textAlign: 'center', marginBottom: SP.md },
});

// ─── Artwork Preview Modal ────────────────────────────────────────────────────

interface PreviewModalProps {
  visible: boolean;
  project: DesignProject | null;
  onClose: () => void;
  onEdit: () => void;
}

function ArtworkPreviewModal({ visible, project, onClose, onEdit }: PreviewModalProps) {
  const insets = useSafeAreaInsets();
  const [masterLoading, setMasterLoading] = useState(false);
  if (!project) return null;
  const previewSize = Math.min(SCREEN_W - SP.xl * 2, 420);
  const topInset = insets.top;
  const botInset = insets.bottom;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} testID="preview-modal">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: BG }]}>
        <TouchableOpacity
          style={[pv.closeBtn, { top: topInset + SP.sm }]}
          onPress={onClose} hitSlop={HIT}
          accessibilityLabel="Close preview" accessibilityRole="button" testID="preview-close"
        >
          <Feather name="x" size={ICON.lg} color={FG} />
        </TouchableOpacity>

        <View style={pv.artWrap}>
          <DesignLayerCompositor project={project} displaySize={previewSize} borderRadius={RADIUS.md} />
        </View>

        <View style={pv.info}>
          <Text style={pv.name}>{project.name}</Text>
          <Text style={pv.dims}>{dimsLabel(project)} — edited {timeAgo(project.updatedAt)}</Text>
        </View>

        <View style={[pv.actions, { paddingBottom: botInset + SP.lg }]}>
          <TouchableOpacity
            style={[pv.btn, { backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER }]}
            disabled={masterLoading}
            onPress={async () => {
              setMasterLoading(true);
              try {
                const master = (await getSyncedDesignAssets(project.id)).find(a => a.kind === 'master');
                if (!master) { Alert.alert('No cloud master yet', 'Export this project once to save a full-quality master.'); return; }
                await Linking.openURL(master.downloadUrl);
              } catch { Alert.alert('Could not open master', 'Check your connection and try again.'); }
              finally { setMasterLoading(false); }
            }}
            activeOpacity={0.8}
            accessibilityLabel="Download cloud master" accessibilityRole="button" testID="preview-cloud-master"
          >
            {masterLoading ? <ActivityIndicator color={FG} /> : <Feather name="download" size={ICON.md} color={FG} />}
            <Text style={[pv.btnLbl, { color: FG }]}>Cloud Master</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[pv.btn, { marginTop: SP.sm }]}
            onPress={onEdit} activeOpacity={0.8}
            accessibilityLabel="Open canvas editor" accessibilityRole="button" testID="preview-open-canvas"
          >
            <Feather name="edit-2" size={ICON.md} color={BG} />
            <Text style={pv.btnLbl}>Open Canvas</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const pv = StyleSheet.create({
  closeBtn: { position: 'absolute', right: SP.md, zIndex: 10, width: COMP.iconBtn, height: COMP.iconBtn, alignItems: 'center', justifyContent: 'center' },
  artWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl },
  info:     { paddingHorizontal: SP.lg, paddingVertical: SP.md, gap: SP.xs },
  name:     { fontFamily: FONT.bold, fontSize: FS.xl, color: FG },
  dims:     { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED },
  actions:  { paddingHorizontal: SP.lg },
  btn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, height: COMP.buttonH, borderRadius: RADIUS.md, backgroundColor: FG },
  btnLbl:   { fontFamily: FONT.semibold, fontSize: FS.base, color: BG },
});

// ─── Recently Deleted ─────────────────────────────────────────────────────────

interface DeletedSectionProps {
  expanded: boolean;
  onToggle: () => void;
  onDataChanged: () => void;
  refreshToken: number;
}

function RecentlyDeletedSection({ expanded, onToggle, onDataChanged, refreshToken }: DeletedSectionProps) {
  const [deleted, setDeleted] = useState<DesignProject[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!expanded) return;
    setLoading(true);
    try { setDeleted(await getDeletedProjects()); }
    finally { setLoading(false); }
  }, [expanded, refreshToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadRef = useRef(load);
  loadRef.current = load;
  React.useEffect(() => { loadRef.current(); }, [load]);

  async function handleRestore(p: DesignProject) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try { await restoreDeletedProject(p.id); setDeleted(prev => prev.filter(x => x.id !== p.id)); onDataChanged(); }
    catch { Alert.alert('Error', 'Could not restore project.'); }
  }

  async function handlePermanentDelete(p: DesignProject) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Alert.alert('Delete permanently?', `"${p.name}" will be removed forever.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete Forever', style: 'destructive', onPress: async () => { await deleteProject(p.id); setDeleted(prev => prev.filter(x => x.id !== p.id)); } },
    ]);
  }

  async function handlePurgeAll() {
    Alert.alert('Delete all?', 'All items in Recently Deleted will be permanently removed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete All', style: 'destructive', onPress: async () => { await purgeDeletedProjects(); setDeleted([]); } },
    ]);
  }

  return (
    <View style={dl.section}>
      <TouchableOpacity
        style={dl.header} onPress={onToggle} activeOpacity={0.7}
        accessibilityLabel={expanded ? 'Collapse recently deleted' : 'Expand recently deleted'}
        accessibilityRole="button" testID="deleted-toggle"
      >
        <Feather name="trash-2" size={ICON.sm} color={MUTED} />
        <Text style={dl.headerLbl}>Recently Deleted</Text>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={ICON.sm} color={SUBTLE} />
      </TouchableOpacity>

      {expanded && (
        <>
          {loading && <ActivityIndicator color={MUTED} style={{ marginVertical: SP.md }} />}
          {!loading && deleted.length === 0 && <Text style={dl.empty}>No recently deleted projects.</Text>}
          {!loading && deleted.length > 0 && (
            <>
              {deleted.map(p => (
                <View key={p.id} style={dl.item}>
                  <DesignLayerCompositor project={p} displaySize={52} borderRadius={RADIUS.xs} />
                  <View style={dl.itemInfo}>
                    <Text style={dl.itemName} numberOfLines={1}>{p.name}</Text>
                    <Text style={dl.itemTime}>Deleted {timeAgo(p.deletedAt!)}</Text>
                  </View>
                  <TouchableOpacity
                    style={dl.restoreBtn} onPress={() => handleRestore(p)} hitSlop={HIT}
                    accessibilityLabel={`Restore ${p.name}`} accessibilityRole="button" testID={`restore-${p.id}`}
                  >
                    <Text style={dl.restoreLbl}>Restore</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={dl.deleteBtn} onPress={() => handlePermanentDelete(p)} hitSlop={HIT}
                    accessibilityLabel={`Permanently delete ${p.name}`} accessibilityRole="button" testID={`perm-delete-${p.id}`}
                  >
                    <Feather name="x" size={ICON.sm} color={RED} />
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity
                style={dl.purgeBtn} onPress={handlePurgeAll}
                accessibilityLabel="Delete all recently deleted projects" accessibilityRole="button" testID="purge-all"
              >
                <Text style={dl.purgeLbl}>Delete All</Text>
              </TouchableOpacity>
            </>
          )}
        </>
      )}
    </View>
  );
}

const dl = StyleSheet.create({
  section:    { marginHorizontal: GRID_H_PAD, marginTop: SP.xl, marginBottom: SP.md, borderTopWidth: 1, borderTopColor: BORDER_SUBTLE, paddingTop: SP.md },
  header:     { flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: COMP.buttonHSm },
  headerLbl:  { flex: 1, fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED },
  empty:      { fontFamily: FONT.regular, fontSize: FS.sm, color: SUBTLE, paddingVertical: SP.md },
  item:       { flexDirection: 'row', alignItems: 'center', paddingVertical: SP.sm, gap: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE },
  itemInfo:   { flex: 1 },
  itemName:   { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED },
  itemTime:   { fontFamily: FONT.regular, fontSize: FS.xs, color: SUBTLE, marginTop: 2 },
  restoreBtn: { minHeight: COMP.buttonHSm, justifyContent: 'center', paddingHorizontal: SP.sm },
  restoreLbl: { fontFamily: FONT.medium, fontSize: FS.sm, color: SUCCESS },
  deleteBtn:  { minHeight: COMP.buttonHSm, width: COMP.buttonHSm, alignItems: 'center', justifyContent: 'center' },
  purgeBtn:   { marginTop: SP.sm, alignItems: 'center', paddingVertical: SP.sm, minHeight: COMP.buttonHSm, justifyContent: 'center' },
  purgeLbl:   { fontFamily: FONT.medium, fontSize: FS.sm, color: RED },
});

// ─── Grid Item ────────────────────────────────────────────────────────────────
// Thumbnail fills cell edge-to-edge (no card padding). Name + dims text below,
// left-aligned, matching screenshot 0 exactly.

interface GridItemProps {
  project: DesignProject;
  selected: boolean;
  selectionMode: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onNamePress: () => void;
}

function GridItem({ project, selected, selectionMode, onPress, onLongPress, onNamePress }: GridItemProps) {
  return (
    <TouchableOpacity
      style={[g.cell, selected && g.cellSelected]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      activeOpacity={0.80}
      accessibilityLabel={`${project.name}, ${dimsLabel(project)}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      testID={`grid-item-${project.id}`}
    >
      {/* Selection checkbox — top-right over the thumbnail */}
      {selectionMode && (
        <View style={[g.checkbox, selected && g.checkboxOn]}>
          {selected && <Feather name="check" size={10} color={BG} />}
        </View>
      )}

      {/* Thumbnail — fills cell width, portrait-ratio height, rounded corners */}
      <View style={g.thumb}>
        <DesignLayerCompositor
          project={project}
          displaySize={CELL_SIZE}
          borderRadius={RADIUS.sm}
        />
      </View>

      {/* Name + dims — tapping opens rename sheet when not in selection mode */}
      <TouchableOpacity
        style={g.meta}
        onPress={selectionMode ? onPress : onNamePress}
        hitSlop={HIT}
        accessibilityLabel={`Rename ${project.name}`}
        accessibilityRole="button"
        testID={`grid-meta-${project.id}`}
      >
        <Text style={g.name} numberOfLines={1}>{project.name}</Text>
        <Text style={g.dims}>{dimsLabel(project)}</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const g = StyleSheet.create({
  cell:        { width: CELL_SIZE, position: 'relative' },
  cellSelected: { opacity: 0.70 },
  thumb:       {
    width: CELL_SIZE,
    height: THUMB_H,
    borderRadius: RADIUS.sm,
    overflow: 'hidden',
    backgroundColor: CARD,   // visible while compositor renders
  },
  meta:        { paddingTop: 5, paddingBottom: SP.xs, paddingHorizontal: 2 },
  name:        { fontFamily: FONT.medium, fontSize: FS.xs, color: FG, lineHeight: 16 },
  dims:        { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, lineHeight: 15, marginTop: 1 },
  checkbox:    {
    position: 'absolute', top: SP.xs, right: SP.xs, zIndex: 10,
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 1.5, borderColor: FG,
    backgroundColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn:  { backgroundColor: FG },
});

// ─── Selection Toolbar ────────────────────────────────────────────────────────

interface SelectionToolbarProps {
  count: number;
  canRename: boolean;
  onRename: () => void;
  onDuplicate: () => void;
  onSoftDelete: () => void;
  onCancel: () => void;
}

function SelectionToolbar({ count, canRename, onRename, onDuplicate, onSoftDelete, onCancel }: SelectionToolbarProps) {
  const insets = useSafeAreaInsets();
  const botPad = insets.bottom;
  return (
    <View style={[tb.bar, { paddingBottom: botPad + SP.sm }]} testID="selection-toolbar">
      <Text style={tb.count}>{count} selected</Text>
      <View style={tb.actions}>
        {canRename && (
          <TouchableOpacity style={tb.btn} onPress={onRename} hitSlop={HIT}
            accessibilityLabel="Rename selected" accessibilityRole="button" testID="sel-rename">
            <Feather name="edit-2" size={ICON.sm} color={FG} />
            <Text style={tb.btnLbl}>Rename</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={tb.btn} onPress={onDuplicate} hitSlop={HIT}
          accessibilityLabel="Duplicate selected" accessibilityRole="button" testID="sel-duplicate">
          <Feather name="copy" size={ICON.sm} color={FG} />
          <Text style={tb.btnLbl}>Duplicate</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[tb.btn, { opacity: count > 0 ? 1 : 0.4 }]}
          onPress={onSoftDelete} hitSlop={HIT}
          accessibilityLabel="Delete selected" accessibilityRole="button" testID="sel-delete">
          <Feather name="trash-2" size={ICON.sm} color={RED} />
          <Text style={[tb.btnLbl, { color: RED }]}>Delete</Text>
        </TouchableOpacity>
        <TouchableOpacity style={tb.btn} onPress={onCancel} hitSlop={HIT}
          accessibilityLabel="Cancel selection" accessibilityRole="button" testID="sel-cancel">
          <Text style={tb.btnLbl}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const tb = StyleSheet.create({
  bar:     { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: CARD_ELEVATED, borderTopWidth: 1, borderTopColor: BORDER, paddingTop: SP.sm, paddingHorizontal: SP.lg },
  count:   { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG, textAlign: 'center', marginBottom: SP.xs },
  actions: { flexDirection: 'row', justifyContent: 'space-around' },
  btn:     { alignItems: 'center', gap: SP.xs, minHeight: COMP.iconBtn, justifyContent: 'center', paddingHorizontal: SP.sm },
  btnLbl:  { fontFamily: FONT.regular, fontSize: FS.xs, color: FG },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function DesignGalleryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [projects, setProjects]               = useState<DesignProject[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [recoverableCount, setRecoverableCount] = useState(0);
  const [selectionMode, setSelectionMode]     = useState(false);
  const [selectedIds, setSelectedIds]         = useState<Set<string>>(new Set());
  const [deletedExpanded, setDeletedExpanded] = useState(false);
  const [deletedToken, setDeletedToken]       = useState(0);

  const [newCanvasVisible, setNewCanvasVisible] = useState(false);
  const [renameProject, setRenameProject]       = useState<DesignProject | null>(null);
  const [previewProject, setPreviewProject]     = useState<DesignProject | null>(null);
  const [recoveryVisible, setRecoveryVisible]   = useState(false);

  // Safe area — web gets hardcoded insets per SKILL.md
  const topInset = insets.top;
  const botInset = insets.bottom;

  // ── Data load ──────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [nextProjects, legacyCount] = await Promise.all([
        getProjects(),
        getRecoverableLegacyProjectCount(),
      ]);
      setProjects(nextProjects);
      setRecoverableCount(legacyCount);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
      if (deletedExpanded) setDeletedToken(t => t + 1);
      return () => {};
    }, [loadData, deletedExpanded]),
  );

  // ── Selection ──────────────────────────────────────────────────────────────

  function enterSelection(id?: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectionMode(true);
    if (id) setSelectedIds(new Set([id]));
    else setSelectedIds(new Set());
  }

  function cancelSelection() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleGridPress(project: DesignProject) {
    if (selectionMode) toggleSelect(project.id);
    else setPreviewProject(project);
  }

  function handleGridLongPress(project: DesignProject) {
    if (!selectionMode) enterSelection(project.id);
    else toggleSelect(project.id);
  }

  // ── Bulk actions ───────────────────────────────────────────────────────────

  async function bulkDuplicate() {
    for (const id of selectedIds) await duplicateProject(id);
    cancelSelection();
    loadData();
  }

  async function bulkSoftDelete() {
    if (selectedIds.size === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    for (const id of selectedIds) await softDeleteProject(id);
    cancelSelection();
    loadData();
    setDeletedToken(t => t + 1);
  }

  function handleRenameSelected() {
    if (selectedIds.size !== 1) return;
    const [id] = [...selectedIds];
    const project = projects.find(p => p.id === id);
    if (project) { setRenameProject(project); cancelSelection(); }
  }

  // ── Photo import ───────────────────────────────────────────────────────────

  async function handlePhotoImport() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false, quality: 1,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      let durable: string;
      try { durable = await makeDurableUri(asset.uri); }
      catch (e: unknown) { Alert.alert('Import failed', e instanceof Error ? e.message : String(e)); return; }
      const w = asset.width || 1080, h = asset.height || 1080;
      const proj = await createProject('canvas', 'Photo Canvas', { width: w, height: h, backgroundHex: '#000000' });
      const now = new Date().toISOString();
      await updateProject(proj.id, {
        layers: [{
          id: uid(), name: 'Photo', type: 'image',
          visible: true, locked: false, order: 0, opacity: 1,
          transform: { x: 0, y: 0, width: w, height: h, rotation: 0, scaleX: 1, scaleY: 1 },
          data: { kind: 'image' as const, uri: durable, opacity: 1, fit: 'contain', blendMode: 'normal' },
          createdAt: now, updatedAt: now,
        }],
      });
      router.push(`/design-canvas?id=${proj.id}`);
    } catch { Alert.alert('Error', 'Could not import photo.'); }
  }

  // ── Import (image or clipboard JSON) ──────────────────────────────────────

  function handleImport() {
    Alert.alert(
      'Import',
      'Import an image to start a new canvas, or paste a Brandthread project JSON from clipboard.',
      [
        {
          text: 'Import Image',
          onPress: async () => {
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: false, quality: 1,
            });
            if (result.canceled || !result.assets?.[0]) return;
            const asset = result.assets[0];
            let durable: string;
            try { durable = await makeDurableUri(asset.uri); }
            catch (e: unknown) { Alert.alert('Import failed', e instanceof Error ? e.message : String(e)); return; }
            const w = asset.width || 1080, h = asset.height || 1080;
            const proj = await createProject('canvas', 'Imported Image', { width: w, height: h, backgroundHex: '#000000' });
            const now = new Date().toISOString();
            await updateProject(proj.id, {
              layers: [{
                id: uid(), name: 'Image', type: 'image',
                visible: true, locked: false, order: 0, opacity: 1,
                transform: { x: 0, y: 0, width: w, height: h, rotation: 0, scaleX: 1, scaleY: 1 },
                data: { kind: 'image' as const, uri: durable, opacity: 1, fit: 'contain', blendMode: 'normal' },
                createdAt: now, updatedAt: now,
              }],
            });
            router.push(`/design-canvas?id=${proj.id}`);
          },
        },
        { text: 'Import from Clipboard', onPress: () => setNewCanvasVisible(true) },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={s.screen} testID="design-gallery-screen">

      {/*
       * ── Gallery header ──────────────────────────────────────────────────
       *
       * Layout (screenshot 0):
       *   [insets.top gap]
       *   [large bold title "Design Studio"  ]
       *   [Select  Import  Photo          [+]]   ← same row, spaced right
       *
       * Tight vertical rhythm: title → actions without extra padding between them.
       * Horizontal alignment: both flush to GRID_H_PAD.
       */}
      <View style={[s.header, { paddingTop: topInset }]}>
        {/* Back arrow — taps goBackOr(router) when history exists, else goes to seller dashboard */}
        <TouchableOpacity
          onPress={() => {
            if (router.canGoBack()) {
              goBackOr(router);
            } else {
              router.replace('/(tabs)/' as never);
            }
          }}
          hitSlop={HIT}
          style={s.backBtn}
          accessibilityLabel="Back"
          accessibilityRole="button"
          testID="design-gallery-back"
        >
          <Text style={s.backArrow}>←</Text>
        </TouchableOpacity>

        <Text
          style={s.title}
          accessibilityRole="header"
          testID="gallery-title"
        >
          Design Studio
        </Text>

        <View style={s.actionRow}>
          {selectionMode ? (
            /* In selection mode the only header action is Cancel */
            <TouchableOpacity
              onPress={cancelSelection} hitSlop={HIT}
              accessibilityLabel="Cancel selection" accessibilityRole="button" testID="header-cancel-select"
            >
              <Text style={s.actionBtn}>Cancel</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                onPress={() => enterSelection()} hitSlop={HIT}
                accessibilityLabel="Enter selection mode" accessibilityRole="button" testID="header-select"
              >
                <Text style={s.actionBtn}>Select</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleImport} hitSlop={HIT}
                accessibilityLabel="Import image or project" accessibilityRole="button" testID="header-import"
              >
                <Text style={s.actionBtn}>Import</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handlePhotoImport} hitSlop={HIT}
                accessibilityLabel="Import from photo library" accessibilityRole="button" testID="header-photo"
              >
                <Text style={s.actionBtn}>Photo</Text>
              </TouchableOpacity>
            </>
          )}

          {/* Spacer */}
          <View style={{ flex: 1 }} />

          {/* Plus — bare icon, top-right, same baseline as action text */}
          {!selectionMode && (
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setNewCanvasVisible(true);
              }}
              hitSlop={HIT}
              style={s.plusBtn}
              accessibilityLabel="New canvas" accessibilityRole="button" testID="header-new-canvas"
            >
              <Feather name="plus" size={ICON.xl} color={FG} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Recovery entry point — only shown when recoverable projects exist */}
      {!selectionMode && recoverableCount > 0 && (
        <TouchableOpacity
          style={s.recoveryRow}
          onPress={() => setRecoveryVisible(true)}
          activeOpacity={0.75}
          accessibilityLabel={`Recover ${recoverableCount} design${recoverableCount !== 1 ? 's' : ''} from this device`}
          accessibilityRole="button"
          testID="recovery-entry"
        >
          <Feather name="refresh-cw" size={ICON.sm} color={MUTED} />
          <Text style={s.recoveryRowText}>
            {recoverableCount} design{recoverableCount !== 1 ? 's' : ''} available to recover
          </Text>
          <Feather name="chevron-right" size={ICON.sm} color={SUBTLE} />
        </TouchableOpacity>
      )}

      {/* ── Project grid ── */}
      {loading ? (
        <View style={{ paddingHorizontal: GRID_H_PAD, paddingTop: SP.md }} testID="gallery-loading">
          <GridSkeleton columns={GRID_COLUMNS} cardWidth={CELL_SIZE} rows={2} gap={GRID_GAP} />
        </View>
      ) : (
        <FlatList
          data={projects}
          keyExtractor={p => p.id}
          numColumns={GRID_COLUMNS}
          columnWrapperStyle={s.gridRow}
          contentContainerStyle={[s.gridContent, { paddingBottom: botInset + 120 }]}
          showsVerticalScrollIndicator={false}
          testID="gallery-grid"
          ListEmptyComponent={
            <View style={s.emptyBox} testID="gallery-empty">
              <Feather name="edit-3" size={ICON.xxl} color={SUBTLE} />
              <Text style={s.emptyTitle}>No artworks yet</Text>
              <Text style={s.emptyDesc}>Tap + to create your first design.</Text>
            </View>
          }
          ListFooterComponent={
            <RecentlyDeletedSection
              expanded={deletedExpanded}
              onToggle={() => setDeletedExpanded(v => {
                const next = !v;
                if (next) setDeletedToken(t => t + 1);
                return next;
              })}
              onDataChanged={loadData}
              refreshToken={deletedToken}
            />
          }
          renderItem={({ item }) => (
            <GridItem
              project={item}
              selected={selectedIds.has(item.id)}
              selectionMode={selectionMode}
              onPress={() => handleGridPress(item)}
              onLongPress={() => handleGridLongPress(item)}
              onNamePress={() => setRenameProject(item)}
            />
          )}
        />
      )}

      {/* Selection toolbar — floats above bottom */}
      {selectionMode && (
        <SelectionToolbar
          count={selectedIds.size}
          canRename={selectedIds.size === 1}
          onRename={handleRenameSelected}
          onDuplicate={bulkDuplicate}
          onSoftDelete={bulkSoftDelete}
          onCancel={cancelSelection}
        />
      )}

      {/* ── Modals / sheets ── */}
      <NewCanvasSheet
        visible={newCanvasVisible}
        onClose={() => setNewCanvasVisible(false)}
        onCreated={id => router.push(`/design-canvas?id=${id}`)}
      />

      <RenameSheet
        visible={renameProject !== null}
        project={renameProject}
        onClose={() => setRenameProject(null)}
        onRenamed={loadData}
      />

      <ArtworkPreviewModal
        visible={previewProject !== null}
        project={previewProject}
        onClose={() => setPreviewProject(null)}
        onEdit={() => {
          const id = previewProject?.id;
          setPreviewProject(null);
          if (id) router.push(`/design-canvas?id=${id}`);
        }}
      />

      <RecoveryModal
        visible={recoveryVisible}
        count={recoverableCount}
        onClose={() => setRecoveryVisible(false)}
        onRecovered={loadData}
      />
    </View>
  );
}

// ─── Gallery styles ───────────────────────────────────────────────────────────

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  // Header block — left-aligned, flush to grid horizontal padding
  header: {
    paddingHorizontal: GRID_H_PAD,
    paddingBottom: SP.sm,
  },

  // Back arrow — sits above the title, minimum 44×44 touch target
  backBtn: {
    width: COMP.iconBtn,
    height: COMP.iconBtn,
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginLeft: -SP.xs,   // align icon visually with title text
    marginBottom: SP.xs,
  },
  backArrow: {
    color: FG,
    fontFamily: FONT.medium,
    fontSize: 28,
    lineHeight: 32,
  },

  // Large bold left-aligned title (screenshot 0: ~34pt, bold, white)
  title: {
    fontFamily: FONT.bold,
    fontSize: FS.h2,         // 30pt — closest to the reference without being h1
    color: FG,
    letterSpacing: -0.5,
    marginBottom: SP.xs,     // 4px gap before action row
  },

  // Action row: text buttons flush left, + icon pushed right
  // No dividers between buttons — plain FG text with 16px gaps
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.md,              // 16px between action buttons (Select / Import / Photo)
    paddingBottom: SP.xs,
  },
  actionBtn: {
    fontFamily: FONT.regular,
    fontSize: FS.base,       // 15pt — matches action text in screenshot 0
    color: FG,               // full white, not MUTED — matching reference
    paddingVertical: SP.xs,  // 4px tap height padding
  },
  plusBtn: {
    // Same height as action text row; bare icon aligned to right edge
    alignItems: 'center',
    justifyContent: 'center',
    width: COMP.iconBtn,
    height: COMP.iconBtn,
  },

  // Recovery entry — compact single-line row, minimal chrome
  recoveryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    marginHorizontal: GRID_H_PAD,
    marginBottom: SP.sm,
    paddingVertical: SP.xs,
  },
  recoveryRowText: {
    flex: 1,
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
  },

  // Grid
  gridContent: {
    paddingHorizontal: GRID_H_PAD,
    paddingTop: SP.sm,
  },
  gridRow: {
    gap: GRID_GAP,
    marginBottom: GRID_GAP,
    justifyContent: 'flex-start',
  },

  // Loading
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Empty state
  emptyBox:   { alignItems: 'center', paddingTop: 80, gap: SP.sm },
  emptyTitle: { fontFamily: FONT.semibold, fontSize: FS.md, color: FG },
  emptyDesc:  { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, textAlign: 'center', maxWidth: 240 },
});
