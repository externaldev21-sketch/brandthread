/**
 * Brandthread Design Studio — Gallery & Canvas Management
 *
 * Procreate Pocket is used as a structural reference only (not colors).
 * All colors come from @/lib/theme Brandthread tokens.
 *
 * Fix notes:
 *  - useFocusEffect (expo-router) reloads active projects every time this
 *    screen regains focus after creating/editing a canvas.
 *  - ProjectThumbnail delegates to DesignLayerCompositor which uses exactly
 *    the same layer-rendering semantics as the canvas editor (order, visibility,
 *    transforms, opacity, eraser mask, image, text, shape, blend modes).
 *  - Photo/Import on web converts blob: URLs to bounded base64 data URLs via
 *    makeDurableUri() before persisting. Native copies into Paths.document.
 *  - RecentlyDeletedSection re-fetches when expanded or when a
 *    restoration/deletion occurs (via refreshToken prop).
 */

import React, {
  useState, useCallback, useRef,
} from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Alert, ActivityIndicator, FlatList, Modal, TextInput,
  Dimensions, Pressable,
  Linking,
} from 'react-native';
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
  RED,
  SUCCESS,
  FONT, FS, SP, RADIUS, ICON, COMP, OVERLAY,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
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

// ─── helpers ──────────────────────────────────────────────────────────────────

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

function dimsLabel(p: DesignProject): string {
  return `${p.canvas.width} x ${p.canvas.height}`;
}

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
  const [clipboardState, setClipboardState] = useState<
    'idle' | 'checking' | 'has_image' | 'has_text' | 'empty' | 'unsupported'
  >('idle');

  // Reset clipboard state whenever sheet opens to clipboard tab
  const prevTabRef = useRef<NewCanvasTab>('presets');
  if (prevTabRef.current !== tab) {
    prevTabRef.current = tab;
    if (tab === 'clipboard' && visible) {
      // async kick-off without being in render body — schedule via ref
    }
  }

  // Clipboard tab: check on tab switch or sheet open
  const checkClipboardRef = useRef<(() => Promise<void>) | null>(null);
  checkClipboardRef.current = async () => {
    setClipboardState('checking');
    try {
      const hasImg = await Clipboard.hasImageAsync();
      if (hasImg) { setClipboardState('has_image'); return; }
      const txt = await Clipboard.getStringAsync();
      if (txt && txt.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(txt.trim());
          if (parsed && parsed.id && parsed.canvas && parsed.layers) {
            setClipboardState('has_text');
            return;
          }
        } catch { /* not valid JSON */ }
      }
      setClipboardState('empty');
    } catch {
      setClipboardState('unsupported');
    }
  };

  function switchTab(t: NewCanvasTab) {
    Haptics.selectionAsync();
    setTab(t);
    if (t === 'clipboard') {
      checkClipboardRef.current?.();
    }
  }

  function toPixels(val: string): number {
    const n = parseFloat(val) || 0;
    return unit === 'in' ? n * dpi : n;
  }

  async function createFromPreset(preset: SellerCanvasPreset) {
    if (creating) return;
    setCreating(true);
    try {
      const project = await createProject('canvas', preset.label, {
        width: preset.width,
        height: preset.height,
        backgroundHex: preset.transparentBg ? 'transparent' : '#000000',
      });
      onClose();
      onCreated(project.id);
    } catch {
      Alert.alert('Error', 'Could not create canvas.');
    } finally {
      setCreating(false);
    }
  }

  async function createCustom() {
    const w = toPixels(customW);
    const h = toPixels(customH);
    if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) ||
        w < 8 || h < 8 || w > 16384 || h > 16384) {
      Alert.alert('Invalid size', 'Width and height must resolve to whole pixels between 8 and 16384.');
      return;
    }
    if (creating) return;
    setCreating(true);
    try {
      const name = customTitle.trim() || `${w} x ${h}`;
      const project = await createProject('canvas', name, {
        width: w, height: h, backgroundHex: '#000000',
      });
      onClose();
      onCreated(project.id);
    } catch {
      Alert.alert('Error', 'Could not create canvas.');
    } finally {
      setCreating(false);
    }
  }

  async function createFromClipboardImage() {
    if (creating) return;
    setCreating(true);
    try {
      const img = await Clipboard.getImageAsync({ format: 'png' });
      if (!img?.data) { Alert.alert('No image', 'Could not read image from clipboard.'); return; }
      const dataUri = `data:image/png;base64,${img.data}`;
      const w = img.size?.width  || 1080;
      const h = img.size?.height || 1080;
      const project = await createProject('canvas', 'From Clipboard', {
        width: w, height: h, backgroundHex: '#000000',
      });
      const now = new Date().toISOString();
      await updateProject(project.id, {
        layers: [{
          id: uid(), name: 'Clipboard Image', type: 'image',
          visible: true, locked: false, order: 0, opacity: 1,
          transform: { x: 0, y: 0, width: w, height: h, rotation: 0, scaleX: 1, scaleY: 1 },
          data: { kind: 'image' as const, uri: dataUri, opacity: 1, fit: 'contain', blendMode: 'normal' },
          createdAt: now, updatedAt: now,
        }],
      });
      onClose();
      onCreated(project.id);
    } catch {
      Alert.alert('Error', 'Could not create from clipboard image.');
    } finally {
      setCreating(false);
    }
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
      const width = Number(parsed.canvas.width);
      const height = Number(parsed.canvas.height);
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
          width < 1 || height < 1 || width > 16384 || height > 16384) {
        throw new Error('Invalid canvas dimensions');
      }
      const now = new Date().toISOString();
      const project = await createProject(
        'canvas',
        `${parsed.name || 'Imported'} (imported)`,
        {
          width,
          height,
          backgroundHex: typeof parsed.canvas.backgroundHex === 'string'
            ? parsed.canvas.backgroundHex
            : '#000000',
        },
      );
      await updateProject(project.id, {
        layers: validation.layers,
        createdAt: now,
        updatedAt: now,
      });
      onClose();
      onCreated(project.id);
    } catch {
      Alert.alert('Error', 'Clipboard does not contain a valid Brandthread project.');
    } finally {
      setCreating(false);
    }
  }

  const TAB_LABELS: { key: NewCanvasTab; label: string }[] = [
    { key: 'presets',   label: 'Size'      },
    { key: 'custom',    label: 'Custom'    },
    { key: 'clipboard', label: 'Clipboard' },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.sheetOverlay} onPress={onClose} />
      <View style={[s.sheet, { paddingBottom: insets.bottom + SP.lg }]}>
        <View style={s.sheetHandle} />

        <View style={s.sheetHeader}>
          <TouchableOpacity onPress={onClose} hitSlop={HIT} style={s.sheetCloseBtn}>
            <Text style={s.sheetCancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={s.sheetTitle}>New Canvas</Text>
          <View style={{ width: 60 }} />
        </View>

        <View style={s.tabRow}>
          {TAB_LABELS.map(t => (
            <TouchableOpacity
              key={t.key}
              style={[s.tabBtn, tab === t.key && { borderBottomColor: FG, borderBottomWidth: 2 }]}
              onPress={() => switchTab(t.key)}
            >
              <Text style={[s.tabLabel, tab === t.key && { color: FG }]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <FlatList
          data={[null]}
          keyExtractor={() => 'content'}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: SP.lg, paddingTop: SP.md, paddingBottom: SP.xxl }}
          renderItem={() => (
            <View>
              {/* ── Presets tab ── */}
              {tab === 'presets' && (
                <>
                  <Text style={s.sectionTitle}>Screen sizes</Text>
                  {SCREEN_QUICK_CHOICES.map(qc => (
                    <TouchableOpacity
                      key={qc.label}
                      style={s.presetRow}
                      onPress={() => createFromPreset({
                        id: qc.label.toLowerCase(),
                        label: qc.label,
                        description: qc.desc,
                        width: qc.width,
                        height: qc.height,
                        dpi: 72,
                        colorProfile: 'sRGB',
                      })}
                      activeOpacity={0.75}
                    >
                      <View style={s.presetIcon}>
                        <Feather name="monitor" size={ICON.md} color={MUTED} />
                      </View>
                      <View style={s.presetInfo}>
                        <Text style={s.presetLabel}>{qc.label}</Text>
                        <Text style={s.presetDims}>{qc.width} x {qc.height} — {qc.desc}</Text>
                      </View>
                      {creating
                        ? <ActivityIndicator size="small" color={MUTED} />
                        : <Feather name="chevron-right" size={ICON.sm} color={SUBTLE} />
                      }
                    </TouchableOpacity>
                  ))}

                  <Text style={[s.sectionTitle, { marginTop: SP.lg }]}>Seller presets</Text>
                  {SELLER_CANVAS_PRESETS.map(preset => (
                    <TouchableOpacity
                      key={preset.id}
                      style={s.presetRow}
                      onPress={() => createFromPreset(preset)}
                      activeOpacity={0.75}
                    >
                      <View style={[s.presetIcon, { backgroundColor: CARD_ELEVATED }]}>
                        <Feather
                          name={
                            preset.id === 'logo_sticker' ? 'star' :
                            preset.id === 'tshirt_print' ? 'layers' :
                            preset.id.startsWith('ig') ? 'instagram' : 'image'
                          }
                          size={ICON.md}
                          color={FG}
                        />
                      </View>
                      <View style={s.presetInfo}>
                        <Text style={s.presetLabel}>{preset.label}</Text>
                        <Text style={s.presetDims}>{preset.description}</Text>
                      </View>
                      {creating
                        ? <ActivityIndicator size="small" color={MUTED} />
                        : <Feather name="chevron-right" size={ICON.sm} color={SUBTLE} />
                      }
                    </TouchableOpacity>
                  ))}
                </>
              )}

              {/* ── Custom tab ── */}
              {tab === 'custom' && (
                <>
                  <Text style={s.sectionTitle}>Canvas title</Text>
                  <TextInput
                    style={s.input}
                    placeholder="e.g. Summer Drop Banner"
                    placeholderTextColor={MUTED}
                    value={customTitle}
                    onChangeText={setCustomTitle}
                  />

                  <Text style={[s.sectionTitle, { marginTop: SP.md }]}>Unit</Text>
                  <View style={s.segRow}>
                    {(['px', 'in'] as SizeUnit[]).map(u => (
                      <TouchableOpacity
                        key={u}
                        style={[s.segBtn, unit === u && s.segBtnActive]}
                        onPress={() => setUnit(u)}
                      >
                        <Text style={[s.segLabel, unit === u && s.segLabelActive]}>{u}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={[s.sectionTitle, { marginTop: SP.md }]}>Dimensions</Text>
                  <View style={s.dimRow}>
                    <View style={s.dimField}>
                      <Text style={s.dimLabel}>Width</Text>
                      <TextInput
                        style={s.dimInput}
                        keyboardType="numeric"
                        value={customW}
                        onChangeText={setCustomW}
                        selectTextOnFocus
                      />
                    </View>
                    <Text style={s.dimX}>x</Text>
                    <View style={s.dimField}>
                      <Text style={s.dimLabel}>Height</Text>
                      <TextInput
                        style={s.dimInput}
                        keyboardType="numeric"
                        value={customH}
                        onChangeText={setCustomH}
                        selectTextOnFocus
                      />
                    </View>
                  </View>

                  {unit === 'in' && (
                    <>
                      <Text style={[s.sectionTitle, { marginTop: SP.md }]}>Resolution (DPI)</Text>
                      <View style={s.segRow}>
                        {DPI_OPTIONS.map(d => (
                          <TouchableOpacity
                            key={d}
                            style={[s.segBtn, dpi === d && s.segBtnActive]}
                            onPress={() => setDpi(d)}
                          >
                            <Text style={[s.segLabel, dpi === d && s.segLabelActive]}>{d}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </>
                  )}

                  <Text style={[s.sectionTitle, { marginTop: SP.md }]}>Color profile</Text>
                  <View style={s.segRow}>
                    {(['sRGB', 'P3'] as ColorProfile[]).map(cp => (
                      <TouchableOpacity
                        key={cp}
                        style={[s.segBtn, colorProfile === cp && s.segBtnActive]}
                        onPress={() => setColorProfile(cp)}
                      >
                        <Text style={[s.segLabel, colorProfile === cp && s.segLabelActive]}>{cp}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <View style={s.dimPreview}>
                    <Text style={s.dimPreviewText}>
                      {toPixels(customW)} x {toPixels(customH)} px
                      {unit === 'in'
                        ? `  (${customW || 0} x ${customH || 0} in @ ${dpi} dpi)`
                        : ''}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={[s.createBtn, creating && { opacity: 0.6 }]}
                    onPress={createCustom}
                    activeOpacity={0.8}
                    disabled={creating}
                  >
                    {creating
                      ? <ActivityIndicator size="small" color={BG} />
                      : <Text style={s.createBtnLabel}>Create Canvas</Text>
                    }
                  </TouchableOpacity>
                </>
              )}

              {/* ── Clipboard tab ── */}
              {tab === 'clipboard' && (
                <>
                  {clipboardState === 'checking' && (
                    <View style={s.clipCenter}>
                      <ActivityIndicator color={FG} size="large" />
                      <Text style={[s.clipMsg, { marginTop: SP.md }]}>Checking clipboard…</Text>
                    </View>
                  )}

                  {clipboardState === 'has_image' && (
                    <>
                      <View style={s.clipRow}>
                        <Feather name="image" size={ICON.lg} color={FG} />
                        <View style={{ flex: 1 }}>
                          <Text style={s.clipTitle}>Image found</Text>
                          <Text style={s.clipSub}>
                            Clipboard contains an image. A new canvas will be created with it as the base layer.
                          </Text>
                        </View>
                      </View>
                      <TouchableOpacity
                        style={[s.createBtn, creating && { opacity: 0.6 }]}
                        onPress={createFromClipboardImage}
                        disabled={creating}
                        activeOpacity={0.8}
                      >
                        {creating
                          ? <ActivityIndicator size="small" color={BG} />
                          : <Text style={s.createBtnLabel}>Create from Image</Text>
                        }
                      </TouchableOpacity>
                    </>
                  )}

                  {clipboardState === 'has_text' && (
                    <>
                      <View style={s.clipRow}>
                        <Feather name="file-text" size={ICON.lg} color={FG} />
                        <View style={{ flex: 1 }}>
                          <Text style={s.clipTitle}>Brandthread project found</Text>
                          <Text style={s.clipSub}>
                            Clipboard contains a Brandthread project JSON. Import it as a new project.
                          </Text>
                        </View>
                      </View>
                      <TouchableOpacity
                        style={[s.createBtn, creating && { opacity: 0.6 }]}
                        onPress={importClipboardJSON}
                        disabled={creating}
                        activeOpacity={0.8}
                      >
                        {creating
                          ? <ActivityIndicator size="small" color={BG} />
                          : <Text style={s.createBtnLabel}>Import Project</Text>
                        }
                      </TouchableOpacity>
                    </>
                  )}

                  {clipboardState === 'empty' && (
                    <View style={s.clipCenter}>
                      <Feather name="clipboard" size={ICON.xxl} color={SUBTLE} />
                      <Text style={[s.clipMsg, { marginTop: SP.md }]}>Clipboard is empty</Text>
                      <Text style={[s.clipSub, { textAlign: 'center', marginTop: SP.xs }]}>
                        Copy an image or a Brandthread project JSON, then return here.
                      </Text>
                    </View>
                  )}

                  {clipboardState === 'unsupported' && (
                    <View style={s.clipCenter}>
                      <Feather name="alert-circle" size={ICON.xxl} color={MUTED} />
                      <Text style={[s.clipMsg, { marginTop: SP.md }]}>Clipboard access unavailable</Text>
                      <Text style={[s.clipSub, { textAlign: 'center', marginTop: SP.xs }]}>
                        Clipboard reading is not supported in the current environment. Use Photo import or choose a preset instead.
                      </Text>
                    </View>
                  )}

                  {clipboardState === 'idle' && (
                    <TouchableOpacity style={s.createBtn} onPress={() => checkClipboardRef.current?.()}>
                      <Text style={s.createBtnLabel}>Check Clipboard</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          )}
        />
      </View>
    </Modal>
  );
}

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

  // Track visibility changes without useEffect to avoid import — use a ref guard
  const prevVisibleRef = useRef(false);
  if (prevVisibleRef.current !== visible) {
    prevVisibleRef.current = visible;
    if (visible && project) {
      setName(project.name);
      // Focus after modal animation
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

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.sheetOverlay} onPress={onClose} />
      <View style={[s.renameSheet, { paddingBottom: insets.bottom + SP.lg }]}>
        <View style={s.sheetHandle} />

        {project && (
          <View style={s.renameThumbWrap}>
            <DesignLayerCompositor project={project} displaySize={120} borderRadius={RADIUS.md} />
          </View>
        )}

        <TextInput
          ref={inputRef}
          style={s.renameInput}
          value={name}
          onChangeText={setName}
          selectTextOnFocus
          returnKeyType="done"
          onSubmitEditing={save}
          placeholder="Project name"
          placeholderTextColor={MUTED}
        />

        <Text style={s.renameDims}>{project ? dimsLabel(project) : ''}</Text>

        <TouchableOpacity
          style={[s.createBtn, saving && { opacity: 0.6 }]}
          onPress={save}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator size="small" color={BG} />
            : <Text style={s.createBtnLabel}>Done</Text>
          }
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

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
  const previewSize = Math.min(Dimensions.get('window').width - SP.xl * 2, 420);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: BG }]}>
        <TouchableOpacity
          style={[s.previewClose, { top: insets.top + SP.sm }]}
          onPress={onClose}
          hitSlop={HIT}
        >
          <Feather name="x" size={ICON.lg} color={FG} />
        </TouchableOpacity>

        <View style={s.previewArtWrap}>
          <DesignLayerCompositor
            project={project}
            displaySize={previewSize}
            borderRadius={RADIUS.md}
          />
        </View>

        <View style={s.previewInfo}>
          <Text style={s.previewName}>{project.name}</Text>
          <Text style={s.previewDims}>{dimsLabel(project)} — edited {timeAgo(project.updatedAt)}</Text>
        </View>

        <View style={[s.previewActions, { paddingBottom: insets.bottom + SP.lg }]}>
          <TouchableOpacity
            style={[s.previewEditBtn, { backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER }]}
            disabled={masterLoading}
            onPress={async () => {
              setMasterLoading(true);
              try {
                const master = (await getSyncedDesignAssets(project.id))
                  .find(asset => asset.kind === 'master');
                if (!master) {
                  Alert.alert('No cloud master yet', 'Export this project once to save a full-quality master.');
                  return;
                }
                await Linking.openURL(master.downloadUrl);
              } catch {
                Alert.alert('Could not open master', 'Check your connection and try again.');
              } finally {
                setMasterLoading(false);
              }
            }}
            activeOpacity={0.8}
          >
            {masterLoading
              ? <ActivityIndicator color={FG} />
              : <Feather name="download" size={ICON.md} color={FG} />}
            <Text style={[s.previewEditLabel, { color: FG }]}>Cloud Master</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.previewEditBtn} onPress={onEdit} activeOpacity={0.8}>
            <Feather name="edit-2" size={ICON.md} color={BG} />
            <Text style={s.previewEditLabel}>Open Canvas</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Recently Deleted section ─────────────────────────────────────────────────

interface DeletedSectionProps {
  expanded: boolean;
  onToggle: () => void;
  onDataChanged: () => void;
  /** Increment to trigger a re-fetch of deleted projects. */
  refreshToken: number;
}

function RecentlyDeletedSection({
  expanded, onToggle, onDataChanged, refreshToken,
}: DeletedSectionProps) {
  const [deleted, setDeleted] = useState<DesignProject[]>([]);
  const [loading, setLoading] = useState(false);

  // Reload whenever expanded becomes true OR refreshToken changes while expanded
  const load = useCallback(async () => {
    if (!expanded) return;
    setLoading(true);
    try {
      setDeleted(await getDeletedProjects());
    } finally {
      setLoading(false);
    }
  }, [expanded, refreshToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Trigger load on dependency change
  const loadRef = useRef(load);
  loadRef.current = load;
  // Using a ref-based effect pattern to avoid importing useEffect from react
  // (it's already in scope via React namespace) — call directly
  React.useEffect(() => { loadRef.current(); }, [load]);

  async function handleRestore(project: DesignProject) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await restoreDeletedProject(project.id);
      setDeleted(prev => prev.filter(p => p.id !== project.id));
      onDataChanged();
    } catch {
      Alert.alert('Error', 'Could not restore project.');
    }
  }

  async function handlePermanentDelete(project: DesignProject) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Alert.alert(
      'Delete permanently?',
      `"${project.name}" will be removed forever and cannot be recovered.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Forever', style: 'destructive',
          onPress: async () => {
            await deleteProject(project.id);
            setDeleted(prev => prev.filter(p => p.id !== project.id));
          },
        },
      ],
    );
  }

  async function handlePurgeAll() {
    Alert.alert(
      'Delete all?',
      'All items in Recently Deleted will be permanently removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All', style: 'destructive',
          onPress: async () => {
            await purgeDeletedProjects();
            setDeleted([]);
          },
        },
      ],
    );
  }

  return (
    <View style={s.deletedSection}>
      <TouchableOpacity style={s.deletedHeader} onPress={onToggle} activeOpacity={0.7}>
        <Feather name="trash-2" size={ICON.sm} color={MUTED} />
        <Text style={s.deletedHeaderLabel}>Recently Deleted</Text>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={ICON.sm} color={SUBTLE} />
      </TouchableOpacity>

      {expanded && (
        <>
          {loading && <ActivityIndicator color={MUTED} style={{ marginVertical: SP.md }} />}

          {!loading && deleted.length === 0 && (
            <Text style={s.deletedEmpty}>No recently deleted projects.</Text>
          )}

          {!loading && deleted.length > 0 && (
            <>
              {deleted.map(p => (
                <View key={p.id} style={s.deletedItem}>
                  <DesignLayerCompositor project={p} displaySize={52} borderRadius={RADIUS.xs} />
                  <View style={s.deletedItemInfo}>
                    <Text style={s.deletedItemName} numberOfLines={1}>{p.name}</Text>
                    <Text style={s.deletedItemTime}>Deleted {timeAgo(p.deletedAt!)}</Text>
                  </View>
                  <TouchableOpacity
                    style={s.deletedRestoreBtn}
                    onPress={() => handleRestore(p)}
                    hitSlop={HIT}
                  >
                    <Text style={s.deletedRestoreLabel}>Restore</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.deletedDeleteBtn}
                    onPress={() => handlePermanentDelete(p)}
                    hitSlop={HIT}
                  >
                    <Feather name="x" size={ICON.sm} color={RED} />
                  </TouchableOpacity>
                </View>
              ))}

              <TouchableOpacity style={s.purgeBtn} onPress={handlePurgeAll}>
                <Text style={s.purgeBtnLabel}>Delete All</Text>
              </TouchableOpacity>
            </>
          )}
        </>
      )}
    </View>
  );
}

// ─── Project Grid Item ────────────────────────────────────────────────────────

const GRID_COLUMNS = 2;
const GRID_GAP = SP.sm;
const SCREEN_W = Dimensions.get('window').width;
const CELL_SIZE = Math.floor((SCREEN_W - SP.lg * 2 - GRID_GAP) / GRID_COLUMNS);
const THUMB_SIZE = CELL_SIZE - SP.md * 2;

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
      style={[
        s.gridItem,
        { width: CELL_SIZE },
        selected && { borderColor: FG, borderWidth: 2 },
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      activeOpacity={0.82}
    >
      {selectionMode && (
        <View style={[s.gridCheckbox, selected && { backgroundColor: FG }]}>
          {selected && <Feather name="check" size={12} color={BG} />}
        </View>
      )}

      <View style={s.gridThumbWrap}>
        <DesignLayerCompositor project={project} displaySize={THUMB_SIZE} borderRadius={RADIUS.xs} />
      </View>

      <TouchableOpacity
        style={s.gridNameRow}
        onPress={selectionMode ? onPress : onNamePress}
        hitSlop={HIT}
      >
        <Text style={s.gridName} numberOfLines={1}>{project.name}</Text>
        <Text style={s.gridDims}>{dimsLabel(project)}</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ─── Multi-select toolbar ─────────────────────────────────────────────────────

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
  return (
    <View style={[s.selToolbar, { paddingBottom: insets.bottom + SP.sm }]}>
      <Text style={s.selCount}>{count} selected</Text>
      <View style={s.selActions}>
        {canRename && (
          <TouchableOpacity style={s.selBtn} onPress={onRename} hitSlop={HIT}>
            <Feather name="edit-2" size={ICON.sm} color={FG} />
            <Text style={s.selBtnLabel}>Rename</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={s.selBtn} onPress={onDuplicate} hitSlop={HIT}>
          <Feather name="copy" size={ICON.sm} color={FG} />
          <Text style={s.selBtnLabel}>Duplicate</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.selBtn, { opacity: count > 0 ? 1 : 0.4 }]}
          onPress={onSoftDelete}
          hitSlop={HIT}
        >
          <Feather name="trash-2" size={ICON.sm} color={RED} />
          <Text style={[s.selBtnLabel, { color: RED }]}>Delete</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.selBtn} onPress={onCancel} hitSlop={HIT}>
          <Text style={s.selBtnLabel}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── HIT SLOP ────────────────────────────────────────────────────────────────

const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function DesignGalleryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [recoverableLegacyCount, setRecoverableLegacyCount] = useState(0);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deletedExpanded, setDeletedExpanded] = useState(false);
  // Incrementing this refreshes RecentlyDeletedSection after restore/delete
  const [deletedRefreshToken, setDeletedRefreshToken] = useState(0);

  const [newCanvasVisible, setNewCanvasVisible] = useState(false);
  const [renameProject, setRenameProject] = useState<DesignProject | null>(null);
  const [previewProject, setPreviewProject] = useState<DesignProject | null>(null);

  // ── Focus-aware data load ─────────────────────────────────────────────────
  // Reloads every time the screen regains focus (e.g. returning from canvas editor).
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [nextProjects, legacyCount] = await Promise.all([
        getProjects(),
        getRecoverableLegacyProjectCount(),
      ]);
      setProjects(nextProjects);
      setRecoverableLegacyCount(legacyCount);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
      // Optionally also refresh deleted section if it's expanded
      if (deletedExpanded) {
        setDeletedRefreshToken(t => t + 1);
      }
      return () => { /* no cleanup needed */ };
    }, [loadData, deletedExpanded]),
  );

  // ── Selection helpers ──────────────────────────────────────────────────────

  function enterSelection(projectId?: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectionMode(true);
    if (projectId) setSelectedIds(new Set([projectId]));
  }

  function cancelSelection() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleGridPress(project: DesignProject) {
    if (selectionMode) {
      toggleSelect(project.id);
    } else {
      setPreviewProject(project);
    }
  }

  function handleGridLongPress(project: DesignProject) {
    if (!selectionMode) enterSelection(project.id);
  }

  // ── Bulk actions ──────────────────────────────────────────────────────────

  async function bulkDuplicate() {
    for (const id of selectedIds) {
      await duplicateProject(id);
    }
    cancelSelection();
    loadData();
  }

  async function bulkSoftDelete() {
    if (selectedIds.size === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    for (const id of selectedIds) {
      await softDeleteProject(id);
    }
    cancelSelection();
    loadData();
    // Refresh Recently Deleted if expanded
    setDeletedRefreshToken(t => t + 1);
  }

  function handleRenameSelected() {
    if (selectedIds.size !== 1) return;
    const [id] = [...selectedIds];
    const project = projects.find(p => p.id === id);
    if (project) {
      setRenameProject(project);
      cancelSelection();
    }
  }

  // ── Photo import ──────────────────────────────────────────────────────────

  async function handlePhotoImport() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      let durable: string;
      try {
        durable = await makeDurableUri(asset.uri);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        Alert.alert('Import failed', msg);
        return;
      }
      const w = asset.width || 1080;
      const h = asset.height || 1080;
      const project = await createProject('canvas', 'Photo Canvas', {
        width: w, height: h, backgroundHex: '#000000',
      });
      const now = new Date().toISOString();
      await updateProject(project.id, {
        layers: [{
          id: uid(), name: 'Photo', type: 'image',
          visible: true, locked: false, order: 0, opacity: 1,
          transform: { x: 0, y: 0, width: w, height: h, rotation: 0, scaleX: 1, scaleY: 1 },
          data: { kind: 'image' as const, uri: durable, opacity: 1, fit: 'contain', blendMode: 'normal' },
          createdAt: now, updatedAt: now,
        }],
      });
      router.push(`/design-canvas?id=${project.id}`);
    } catch {
      Alert.alert('Error', 'Could not import photo.');
    }
  }

  // ── Image-only import ─────────────────────────────────────────────────────

  async function handleImport() {
    Alert.alert(
      'Import',
      'Import an image to start a new canvas, or paste a Brandthread project JSON from clipboard.',
      [
        {
          text: 'Import Image',
          onPress: async () => {
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              allowsEditing: false,
              quality: 1,
            });
            if (result.canceled || !result.assets?.[0]) return;
            const asset = result.assets[0];
            let durable: string;
            try {
              durable = await makeDurableUri(asset.uri);
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : String(e);
              Alert.alert('Import failed', msg);
              return;
            }
            const w = asset.width || 1080;
            const h = asset.height || 1080;
            const project = await createProject('canvas', 'Imported Image', {
              width: w, height: h, backgroundHex: '#000000',
            });
            const now = new Date().toISOString();
            await updateProject(project.id, {
              layers: [{
                id: uid(), name: 'Image', type: 'image',
                visible: true, locked: false, order: 0, opacity: 1,
                transform: { x: 0, y: 0, width: w, height: h, rotation: 0, scaleX: 1, scaleY: 1 },
                data: { kind: 'image' as const, uri: durable, opacity: 1, fit: 'contain', blendMode: 'normal' },
                createdAt: now, updatedAt: now,
              }],
            });
            router.push(`/design-canvas?id=${project.id}`);
          },
        },
        {
          text: 'Import from Clipboard',
          onPress: () => setNewCanvasVisible(true),
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={[s.screen, { backgroundColor: BG }]}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + SP.sm }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerBack} hitSlop={HIT}>
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Design Studio</Text>
        {selectionMode ? (
          <TouchableOpacity onPress={cancelSelection} hitSlop={HIT}>
            <Text style={s.headerAction}>Cancel</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => enterSelection()} hitSlop={HIT}>
            <Text style={s.headerAction}>Select</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Action row */}
      {!selectionMode && (
        <View style={s.actionRow}>
          <TouchableOpacity style={s.actionBtn} onPress={handleImport} activeOpacity={0.75}>
            <Feather name="download" size={ICON.md} color={FG} />
            <Text style={s.actionBtnLabel}>Import</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.actionBtn} onPress={handlePhotoImport} activeOpacity={0.75}>
            <Feather name="camera" size={ICON.md} color={FG} />
            <Text style={s.actionBtnLabel}>Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.actionBtn, s.actionBtnPrimary]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setNewCanvasVisible(true);
            }}
            activeOpacity={0.8}
          >
            <Feather name="plus" size={ICON.md} color={BG} />
            <Text style={[s.actionBtnLabel, { color: BG }]}>New Canvas</Text>
          </TouchableOpacity>
        </View>
      )}

      {!selectionMode && recoverableLegacyCount > 0 && (
        <TouchableOpacity
          style={{ marginHorizontal: SP.lg, marginTop: SP.sm, padding: SP.md, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md }}
          onPress={() => Alert.alert(
            'Recover projects from this device?',
            `${recoverableLegacyCount} project${recoverableLegacyCount === 1 ? '' : 's'} were saved before account sync. Recover them into the selected store only if they belong to this store.`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Recover',
                onPress: async () => {
                  try {
                    await recoverLegacyDesignProjects();
                    await loadData();
                  } catch {
                    Alert.alert('Recovery failed', 'Your original device projects were not changed. Try again.');
                  }
                },
              },
            ],
          )}
        >
          <Text style={{ color: FG, fontSize: FS.sm, fontFamily: FONT.medium }}>
            Recover {recoverableLegacyCount} project{recoverableLegacyCount === 1 ? '' : 's'} from this device
          </Text>
          <Text style={{ color: MUTED, fontSize: FS.xs, marginTop: SP.xs }}>
            Confirm they belong to the selected store before syncing.
          </Text>
        </TouchableOpacity>
      )}

      {/* Project grid */}
      {loading ? (
        <View style={s.loadingBox}>
          <ActivityIndicator color={FG} size="large" />
        </View>
      ) : (
        <FlatList
          data={projects}
          keyExtractor={p => p.id}
          numColumns={GRID_COLUMNS}
          columnWrapperStyle={s.gridRow}
          contentContainerStyle={[s.gridContent, { paddingBottom: insets.bottom + 120 }]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={s.emptyBox}>
              <Feather name="edit-3" size={ICON.xxl} color={SUBTLE} />
              <Text style={s.emptyTitle}>No artworks yet</Text>
              <Text style={s.emptyDesc}>Tap New Canvas to start your first design.</Text>
            </View>
          }
          ListFooterComponent={
            <RecentlyDeletedSection
              expanded={deletedExpanded}
              onToggle={() => setDeletedExpanded(v => {
                const next = !v;
                if (next) setDeletedRefreshToken(t => t + 1);
                return next;
              })}
              onDataChanged={loadData}
              refreshToken={deletedRefreshToken}
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

      {/* Selection toolbar */}
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

      {/* Sheets / modals */}
      <NewCanvasSheet
        visible={newCanvasVisible}
        onClose={() => setNewCanvasVisible(false)}
        onCreated={(id) => router.push(`/design-canvas?id=${id}`)}
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
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  screen:       { flex: 1, backgroundColor: BG },

  // Header
  header:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingBottom: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE },
  headerBack:   { minWidth: COMP.iconBtn, minHeight: COMP.iconBtn, alignItems: 'center', justifyContent: 'center' },
  headerTitle:  { flex: 1, fontFamily: FONT.semibold, fontSize: FS.base, color: FG, textAlign: 'center' },
  headerAction: { fontFamily: FONT.medium, fontSize: FS.sm, color: FG, minWidth: COMP.iconBtn, textAlign: 'right', minHeight: COMP.iconBtn, lineHeight: COMP.iconBtn },

  // Action row
  actionRow:        { flexDirection: 'row', paddingHorizontal: SP.lg, paddingVertical: SP.md, gap: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE },
  actionBtn:        { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.xs, minHeight: COMP.buttonHSm, borderRadius: RADIUS.md, backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER, paddingHorizontal: SP.sm },
  actionBtnPrimary: { flex: 1.4, backgroundColor: FG, borderColor: FG },
  actionBtnLabel:   { fontFamily: FONT.medium, fontSize: FS.sm, color: FG },

  // Grid
  gridContent:   { paddingHorizontal: SP.lg, paddingTop: SP.md, gap: GRID_GAP },
  gridRow:       { gap: GRID_GAP, marginBottom: GRID_GAP },
  gridItem:      { backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, overflow: 'hidden', position: 'relative' },
  gridThumbWrap: { padding: SP.sm, alignItems: 'center', justifyContent: 'center' },
  gridNameRow:   { paddingHorizontal: SP.sm, paddingBottom: SP.sm, gap: 2 },
  gridName:      { fontFamily: FONT.medium, fontSize: FS.sm, color: FG },
  gridDims:      { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED },
  gridCheckbox:  { position: 'absolute', top: SP.sm, right: SP.sm, width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: FG, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', zIndex: 10 },

  // Loading / empty
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyBox:   { alignItems: 'center', paddingTop: 80, gap: SP.sm },
  emptyTitle: { fontFamily: FONT.semibold, fontSize: FS.md, color: FG },
  emptyDesc:  { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, textAlign: 'center' },

  // Selection toolbar
  selToolbar:  { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: CARD_ELEVATED, borderTopWidth: 1, borderTopColor: BORDER, paddingTop: SP.sm, paddingHorizontal: SP.lg },
  selCount:    { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG, textAlign: 'center', marginBottom: SP.xs },
  selActions:  { flexDirection: 'row', justifyContent: 'space-around' },
  selBtn:      { alignItems: 'center', gap: SP.xs, minHeight: COMP.iconBtn, justifyContent: 'center', paddingHorizontal: SP.sm },
  selBtnLabel: { fontFamily: FONT.regular, fontSize: FS.xs, color: FG },

  // Sheet shared
  sheetOverlay: { ...StyleSheet.absoluteFill, backgroundColor: OVERLAY },
  sheetHandle:  { width: 36, height: 4, borderRadius: 2, backgroundColor: BORDER_ACTIVE, alignSelf: 'center', marginTop: SP.sm, marginBottom: SP.xs, opacity: 0.3 },
  sheetHeader:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.lg, paddingBottom: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE },
  sheetCloseBtn: { minWidth: 60, minHeight: COMP.iconBtn, justifyContent: 'center' },
  sheetCancelText: { fontFamily: FONT.regular, fontSize: FS.base, color: MUTED },
  sheetTitle:   { flex: 1, textAlign: 'center', fontFamily: FONT.semibold, fontSize: FS.base, color: FG },

  // New canvas sheet
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '90%', backgroundColor: SURFACE, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, borderTopWidth: 1, borderColor: BORDER },

  // Tabs
  tabRow:   { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE, marginHorizontal: SP.lg },
  tabBtn:   { flex: 1, alignItems: 'center', paddingVertical: SP.sm, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabLabel: { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED },

  // Preset rows
  sectionTitle: { fontFamily: FONT.semibold, fontSize: FS.xs, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: SP.sm },
  presetRow:    { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingVertical: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE, minHeight: COMP.buttonHSm },
  presetIcon:   { width: 40, height: 40, borderRadius: RADIUS.sm, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' },
  presetInfo:   { flex: 1 },
  presetLabel:  { fontFamily: FONT.medium, fontSize: FS.base, color: FG },
  presetDims:   { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, marginTop: 2 },

  // Custom tab
  input:         { height: COMP.inputH, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, paddingHorizontal: SP.md, fontFamily: FONT.regular, fontSize: FS.base, color: FG, backgroundColor: CARD },
  segRow:        { flexDirection: 'row', gap: SP.xs },
  segBtn:        { flex: 1, height: 40, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', backgroundColor: CARD },
  segBtnActive:  { borderColor: FG, backgroundColor: FG },
  segLabel:      { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED },
  segLabelActive: { color: BG },
  dimRow:        { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  dimField:      { flex: 1 },
  dimLabel:      { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, marginBottom: SP.xs },
  dimInput:      { height: COMP.buttonHSm, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, paddingHorizontal: SP.md, fontFamily: FONT.regular, fontSize: FS.base, color: FG, backgroundColor: CARD, textAlign: 'center' },
  dimX:          { fontFamily: FONT.regular, fontSize: FS.base, color: MUTED, marginTop: SP.lg },
  dimPreview:    { backgroundColor: CARD, borderRadius: RADIUS.md, padding: SP.sm, marginVertical: SP.md, alignItems: 'center' },
  dimPreviewText: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED },
  createBtn:     { height: COMP.buttonH, borderRadius: RADIUS.md, backgroundColor: FG, alignItems: 'center', justifyContent: 'center', marginTop: SP.sm },
  createBtnLabel: { fontFamily: FONT.semibold, fontSize: FS.base, color: BG },

  // Clipboard tab
  clipCenter: { alignItems: 'center', paddingVertical: SP.xxl },
  clipRow:    { flexDirection: 'row', gap: SP.md, alignItems: 'flex-start', backgroundColor: CARD, borderRadius: RADIUS.lg, padding: SP.md, marginBottom: SP.md },
  clipTitle:  { fontFamily: FONT.semibold, fontSize: FS.base, color: FG, marginBottom: SP.xs },
  clipMsg:    { fontFamily: FONT.semibold, fontSize: FS.base, color: FG },
  clipSub:    { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, lineHeight: 20 },

  // Rename sheet
  renameSheet:    { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: SURFACE, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, borderTopWidth: 1, borderColor: BORDER, paddingHorizontal: SP.lg },
  renameThumbWrap: { alignItems: 'center', paddingTop: SP.lg, paddingBottom: SP.md },
  renameInput:    { height: COMP.inputH, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER_ACTIVE, paddingHorizontal: SP.md, fontFamily: FONT.semibold, fontSize: FS.md, color: FG, backgroundColor: CARD, textAlign: 'center', marginBottom: SP.xs },
  renameDims:     { fontFamily: FONT.regular, fontSize: FS.xs, color: SUBTLE, textAlign: 'center', marginBottom: SP.md },

  // Artwork preview modal
  previewClose:    { position: 'absolute', right: SP.md, zIndex: 10, width: COMP.iconBtn, height: COMP.iconBtn, alignItems: 'center', justifyContent: 'center' },
  previewArtWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl },
  previewInfo:     { paddingHorizontal: SP.lg, paddingVertical: SP.md, gap: SP.xs },
  previewName:     { fontFamily: FONT.bold, fontSize: FS.xl, color: FG },
  previewDims:     { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED },
  previewActions:  { paddingHorizontal: SP.lg },
  previewEditBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, height: COMP.buttonH, borderRadius: RADIUS.md, backgroundColor: FG },
  previewEditLabel: { fontFamily: FONT.semibold, fontSize: FS.base, color: BG },

  // Recently deleted
  deletedSection:     { marginHorizontal: SP.lg, marginTop: SP.xl, marginBottom: SP.md, borderTopWidth: 1, borderTopColor: BORDER_SUBTLE, paddingTop: SP.md },
  deletedHeader:      { flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: COMP.buttonHSm },
  deletedHeaderLabel: { flex: 1, fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED },
  deletedEmpty:       { fontFamily: FONT.regular, fontSize: FS.sm, color: SUBTLE, paddingVertical: SP.md },
  deletedItem:        { flexDirection: 'row', alignItems: 'center', paddingVertical: SP.sm, gap: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE },
  deletedItemInfo:    { flex: 1 },
  deletedItemName:    { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED },
  deletedItemTime:    { fontFamily: FONT.regular, fontSize: FS.xs, color: SUBTLE, marginTop: 2 },
  deletedRestoreBtn:  { minHeight: COMP.buttonHSm, justifyContent: 'center', paddingHorizontal: SP.sm },
  deletedRestoreLabel: { fontFamily: FONT.medium, fontSize: FS.sm, color: SUCCESS },
  deletedDeleteBtn:   { minHeight: COMP.buttonHSm, width: COMP.buttonHSm, alignItems: 'center', justifyContent: 'center' },
  purgeBtn:           { marginTop: SP.sm, alignItems: 'center', paddingVertical: SP.sm, minHeight: COMP.buttonHSm, justifyContent: 'center' },
  purgeBtnLabel:      { fontFamily: FONT.medium, fontSize: FS.sm, color: RED },
});
