import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Modal, Image, ActivityIndicator } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { showAlert } from '@/lib/actionSheet';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/BrandthreadUI';
import { Icon } from '@/components/ui/Icon';
import { useRouter, useFocusEffect } from 'expo-router';
import { haptics } from '@/lib/haptics';
import * as ImagePicker from 'expo-image-picker';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { getProjects, createProject, updateProject } from '@/services/designService';
import { makeDurableUri } from '@/lib/imageUri';
import { canvasPixelSize, buildImageLayer } from '@/lib/aiStudioCanvas';
import { minHitSlop } from '@/lib/hitSlop';

// Segmented mode buttons draw 34pt tall; pad the touch area vertically to 44pt.
const MODE_BTN_HIT_SLOP = minHitSlop({ height: 34 });
import { DesignProject } from '@/services/designTypes';
import { SheetRise } from '@/components/motion/SheetRise';
import { ModalSafeArea } from '@/components/ModalSafeArea';
import { FirstRunTip } from '@/components/first-run-tips/FirstRunTip';
import { DESIGN_STUDIO_ROWS } from '@/lib/firstRunTips/content';
import { useTabBarClearance } from '@/components/buyer-nav/buyerTabBarMetrics';

const STUDIO_TOOLS = [
  { label: 'Clothing mockups', icon: 'image' as const, desc: 'Generate photorealistic product mockups', badge: 'Popular' },
  { label: 'Product photography', icon: 'camera' as const, desc: 'Studio-quality product shots without a camera', badge: null },
  { label: 'Background Removal', icon: 'scissors' as const, desc: 'Clean product cutouts in seconds', badge: null },
  { label: 'Lifestyle Images', icon: 'sun' as const, desc: 'Contextual lifestyle shots for any product', badge: null },
  { label: 'Tech Pack Generator', icon: 'file-text' as const, desc: 'Professional tech packs for manufacturers', badge: 'New' },
];

type SizePreset = {
  label: string;
  profile?: string;
  dims: string;
  ratio: number;
};

const SCREEN_SIZE: SizePreset = { label: 'Screen Size', dims: '1320 \u00d7 2868px', ratio: 1320 / 2868 };

const SIZE_PRESETS: SizePreset[] = [
  { label: 'Square',        profile: 'sRGB', dims: '2048 \u00d7 2048px', ratio: 1 },
  { label: '4K',             profile: 'sRGB', dims: '4096 \u00d7 1714px', ratio: 4096 / 1714 },
  { label: 'A4',             profile: 'sRGB', dims: '210 \u00d7 297mm',   ratio: 210 / 297 },
  { label: '4 \u00d7 6 Photo', profile: 'sRGB', dims: '6" \u00d7 4"',       ratio: 6 / 4 },
  { label: 'Paper',          profile: 'sRGB', dims: '11" \u00d7 8.5"',    ratio: 11 / 8.5 },
  { label: 'Comic',          profile: 'CMYK', dims: '6" \u00d7 9.5"',     ratio: 6 / 9.5 },
  { label: 'FacePaint',      profile: 'sRGB', dims: '2048 \u00d7 2048px', ratio: 1 },
];

export default function AIStudioScreen() {
  const colors = useColors();
  const router = useRouter();
  const [mode, setMode] = useState<'ai' | 'manual'>('ai');
  const [newCanvasVisible, setNewCanvasVisible] = useState(false);
  // New-canvas sheet tab: preset sizes, or an image already on the clipboard.
  const [sheetTab, setSheetTab] = useState<'custom' | 'clipboard'>('custom');
  const [clipState, setClipState] = useState<'checking' | 'has_image' | 'empty' | 'unsupported'>('checking');
  const [projects, setProjects] = useState<DesignProject[] | null>(null);
  const [projectsError, setProjectsError] = useState(false);
  // Content ends above the floating tab bar (shared app-wide rule).
  const tabBarClearance = useTabBarClearance(2);

  const loadProjects = useCallback(() => {
    getProjects()
      .then((p) => { setProjects(p); setProjectsError(false); })
      .catch(() => { setProjects([]); setProjectsError(true); });
  }, []);

  useFocusEffect(useCallback(() => { loadProjects(); }, [loadProjects]));

  function openProject(project: DesignProject) {
    router.push(`/design-canvas?id=${project.id}` as never);
  }

  // The canvas screen opens saved projects by `?id=`, so every entry here
  // creates the project first (same as the Design gallery's new-canvas flows).
  async function openCanvas(preset: SizePreset) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setNewCanvasVisible(false);
    try {
      const proj = await createProject('canvas', preset.label, { ...canvasPixelSize(preset.dims), backgroundHex: '#FFFFFF' });
      router.push(`/design-canvas?id=${proj.id}` as never);
    } catch { showAlert('Error', 'Could not create canvas.'); }
  }

  async function openImageCanvas(asset: { uri: string; width?: number; height?: number }, name: string) {
    try {
      const uri = await makeDurableUri(asset.uri);
      const width = asset.width || 1080, height = asset.height || 1080;
      const proj = await createProject('canvas', name, { width, height, backgroundHex: '#FFFFFF' });
      await updateProject(proj.id, {
        layers: [buildImageLayer({ id: `uid_${Date.now()}`, name, uri, width, height, now: new Date().toISOString() })],
      });
      router.push(`/design-canvas?id=${proj.id}` as never);
    } catch { showAlert('Error', 'Could not import photo.'); }
  }

  function openNewCanvasSheet() {
    setSheetTab('custom');
    setNewCanvasVisible(true);
  }

  async function checkClipboard() {
    setClipState('checking');
    try {
      setClipState((await Clipboard.hasImageAsync()) ? 'has_image' : 'empty');
    } catch {
      setClipState('unsupported');
    }
  }

  function switchSheetTab(tab: 'custom' | 'clipboard') {
    Haptics.selectionAsync().catch(() => {});
    setSheetTab(tab);
    if (tab === 'clipboard') void checkClipboard();
  }

  async function createFromClipboard() {
    let img: Awaited<ReturnType<typeof Clipboard.getImageAsync>>;
    try {
      img = await Clipboard.getImageAsync({ format: 'png' });
    } catch {
      img = null;
    }
    if (!img?.data) {
      setClipState('empty');
      showAlert('No image on your clipboard', 'Copy an image, then try again.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setNewCanvasVisible(false);
    const uri = img.data.startsWith('data:') ? img.data : `data:image/png;base64,${img.data}`;
    await openImageCanvas({ uri, width: img.size?.width, height: img.size?.height }, 'From Clipboard');
  }

  async function importFromLibrary() {
    let res: ImagePicker.ImagePickerResult;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { showAlert('Permission needed', 'Allow photo access to import artwork.'); return; }
      res = await ImagePicker.launchImageLibraryAsync({ quality: 0.9, allowsEditing: false });
    } catch {
      showAlert("Couldn't open your photos", 'Please try again.');
      return;
    }
    if (!res.canceled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await openImageCanvas(res.assets[0], 'Imported');
    }
  }

  async function openFromCamera() {
    let res: ImagePicker.ImagePickerResult;
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { showAlert('Permission needed', 'Allow camera access to take a photo.'); return; }
      res = await ImagePicker.launchCameraAsync({ quality: 0.9, allowsEditing: true });
    } catch {
      showAlert("Couldn't open the camera", 'Please try again.');
      return;
    }
    if (!res.canceled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await openImageCanvas(res.assets[0], 'Photo');
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Design Studio" />

      {/* Mode switch */}
      <View style={styles.modeRow}>
        <View style={[styles.modeSwitch, { backgroundColor: colors.secondary }]}>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'ai' && { backgroundColor: colors.card }]}
            activeOpacity={0.8}
            hitSlop={MODE_BTN_HIT_SLOP}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setMode('ai'); }}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === 'ai' }}
          >
            <Icon name="zap" size={13} color={mode === 'ai' ? colors.primary : colors.mutedForeground} />
            <Text style={[styles.modeBtnText, { color: mode === 'ai' ? colors.foreground : colors.mutedForeground }]}>Generate</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'manual' && { backgroundColor: colors.card }]}
            activeOpacity={0.8}
            hitSlop={MODE_BTN_HIT_SLOP}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setMode('manual'); }}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === 'manual' }}
          >
            <Icon name="edit-3" size={13} color={mode === 'manual' ? colors.primary : colors.mutedForeground} />
            <Text style={[styles.modeBtnText, { color: mode === 'manual' ? colors.foreground : colors.mutedForeground }]}>Manual Design</Text>
          </TouchableOpacity>
        </View>
      </View>

      {mode === 'manual' ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: 4, paddingBottom: tabBarClearance, paddingHorizontal: 20 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.manualTopRow}>
            <View style={styles.manualLinks}>
              <TouchableOpacity onPress={importFromLibrary} accessibilityRole="button" accessibilityLabel="Import artwork" hitSlop={14}>
                <Text style={[styles.manualLink, { color: colors.mutedForeground }]}>Import</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={openFromCamera} accessibilityRole="button" accessibilityLabel="Take a photo" hitSlop={14}>
                <Text style={[styles.manualLink, { color: colors.mutedForeground }]}>Photo</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="New canvas"
              style={[styles.newCanvasBtn, { backgroundColor: colors.primary }]}
              activeOpacity={0.8}
              onPress={openNewCanvasSheet}
            >
              <Icon name="plus" size={18} color={colors.primaryForeground} />
            </TouchableOpacity>
          </View>

          {projectsError ? (
            <EmptyState
              icon="alert-circle"
              title="Couldn't load your designs"
              description="Check your connection and try again."
              action={{ label: 'Try again', onPress: loadProjects }}
              style={{ marginTop: 24 }}
            />
          ) : projects && projects.length === 0 ? (
            <EmptyState
              icon="edit-3"
              title="No designs yet"
              description="Start a canvas or import artwork."
              action={{ label: 'New canvas', onPress: openNewCanvasSheet }}
              style={{ marginTop: 24 }}
            />
          ) : (
            <View style={styles.canvasGrid}>
              {(projects ?? []).map((p) => {
                const ratio = p.canvas.width / p.canvas.height;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.canvasCell}
                    activeOpacity={0.8}
                    onPress={() => openProject(p)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${p.name || 'Untitled design'}`}
                  >
                    <View style={[styles.canvasTile, { borderColor: colors.border, backgroundColor: colors.card }]}>
                      <View style={[styles.canvasShape, {
                        aspectRatio: ratio,
                        backgroundColor: p.canvas.backgroundHex || '#FFFFFF',
                        ...(ratio >= 1 ? { width: '90%' } : { height: '90%' }),
                      }]}>
                        {p.thumbnail ? (
                          <Image source={{ uri: p.thumbnail }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
                        ) : (
                          <Icon name="image" size={18} color={colors.mutedForeground} />
                        )}
                      </View>
                    </View>
                    <Text style={[styles.canvasLabel, { color: colors.foreground }]} numberOfLines={1}>{p.name || 'Untitled design'}</Text>
                    <Text style={[styles.canvasDims, { color: colors.mutedForeground }]}>{`${p.canvas.width} × ${p.canvas.height}px`}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </ScrollView>
      ) : (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: tabBarClearance, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >

      {/* Tools */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Studio Tools</Text>
      {STUDIO_TOOLS.map((tool) => (
        <TouchableOpacity
          key={tool.label}
          accessibilityRole="button"
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            if (tool.label === 'Clothing mockups') {
              router.push('/ai-mockup-chat' as never);
              return;
            }
            if (tool.label === 'Product photography') {
              router.push('/ai-photography-chat' as never);
              return;
            }
            if (tool.label === 'Background Removal') {
              router.push('/design-bg-removal' as never);
              return;
            }
            if (tool.label === 'Lifestyle Images') {
              router.push('/lifestyle-images' as never);
              return;
            }
            if (tool.label === 'Tech Pack Generator') {
              router.push('/tech-pack-generator' as never);
            }
          }}
          activeOpacity={0.75}
          style={[
            styles.toolRow,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={[styles.toolIcon, { backgroundColor: colors.secondary }]}>
            <Icon name={tool.icon} size={18} color={colors.mutedForeground} />
          </View>
          <View style={styles.toolInfo}>
            <Text style={[styles.toolLabel, { color: colors.foreground }]}>{tool.label}</Text>
            <Text style={[styles.toolDesc, { color: colors.mutedForeground }]}>{tool.desc}</Text>
          </View>
          {tool.badge != null && (
            <View style={[styles.toolBadge, { backgroundColor: colors.accent }]}>
              {/* Monochrome only — no green "success" accent for the "New"
                  badge; it isn't one of the app's 3 allowed color accents. */}
              <Text style={[styles.toolBadgeText, { color: colors.primary }]}>{tool.badge}</Text>
            </View>
          )}
          <Icon name="chevron-right" size={15} color={colors.mutedForeground} />
        </TouchableOpacity>
      ))}
      </ScrollView>
      )}

      {/* New canvas sheet */}
      <Modal
        visible={newCanvasVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setNewCanvasVisible(false)}
      >
        <ModalSafeArea>
          <View style={styles.sheetOverlay}>
            <SheetRise style={[styles.sheetCard, { backgroundColor: colors.card }]}>
              <TouchableOpacity style={styles.sheetCancel} activeOpacity={0.7} onPress={() => setNewCanvasVisible(false)} accessibilityRole="button" hitSlop={14}>
                <Text style={[styles.sheetCancelText, { color: colors.mutedForeground }]}>Cancel</Text>
              </TouchableOpacity>

              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>New canvas</Text>
              <View style={styles.sheetSubRow} accessibilityRole="tablist">
                {([['custom', 'Custom Size'], ['clipboard', 'From Clipboard']] as const).map(([id, label]) => {
                  const on = sheetTab === id;
                  return (
                    <TouchableOpacity
                      key={id}
                      onPress={() => switchSheetTab(id)}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: on }}
                      hitSlop={14}
                      testID={`ai-studio-sheet-tab-${id}`}
                    >
                      <Text style={[on ? styles.sheetSubActive : styles.sheetSubMuted, { color: on ? colors.foreground : colors.mutedForeground }]}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {sheetTab === 'clipboard' ? (
                clipState === 'checking' ? (
                  <View style={styles.clipStatus}><ActivityIndicator color={colors.mutedForeground} /></View>
                ) : clipState === 'has_image' ? (
                  <TouchableOpacity
                    style={[styles.sheetSoloRow, { backgroundColor: colors.elevated }]}
                    activeOpacity={0.7}
                    onPress={() => { void createFromClipboard(); }}
                    accessibilityRole="button"
                    testID="ai-studio-clipboard-create"
                  >
                    <Text style={[styles.sheetRowLabel, { color: colors.foreground }]}>New canvas from clipboard image</Text>
                    <Icon name="clipboard" size={16} color={colors.mutedForeground} />
                  </TouchableOpacity>
                ) : (
                  <View style={styles.clipStatus}>
                    <Text style={[styles.sheetRowLabel, { color: colors.foreground, textAlign: 'center' }]}>
                      {clipState === 'unsupported' ? "Can't read the clipboard here" : 'No image on your clipboard'}
                    </Text>
                    <Text style={[styles.sheetRowDims, { color: colors.mutedForeground, textAlign: 'center', marginTop: SP.xs }]}>
                      {clipState === 'unsupported' ? 'Import the image from your photos instead.' : 'Copy an image, then check again.'}
                    </Text>
                    {clipState === 'empty' ? (
                      <TouchableOpacity onPress={() => { void checkClipboard(); }} accessibilityRole="button" hitSlop={14} style={{ marginTop: SP.md }}>
                        <Text style={[styles.sheetSubActive, { color: colors.foreground }]}>Check again</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                )
              ) : (
              <>
              <TouchableOpacity
                style={[styles.sheetSoloRow, { backgroundColor: colors.elevated }]}
                activeOpacity={0.7}
                onPress={() => openCanvas(SCREEN_SIZE)}
                accessibilityRole="button"
              >
                <Text style={[styles.sheetRowLabel, { color: colors.foreground }]}>{SCREEN_SIZE.label}</Text>
                <Text style={[styles.sheetRowDims, { color: colors.mutedForeground }]}>{SCREEN_SIZE.dims}</Text>
              </TouchableOpacity>

              <View style={[styles.sheetGroup, { backgroundColor: colors.elevated }]}>
                {SIZE_PRESETS.map((p, i) => (
                  <TouchableOpacity
                    key={p.label}
                    style={[styles.sheetRow, i > 0 && [styles.sheetRowBorder, { borderTopColor: colors.border }]]}
                    activeOpacity={0.7}
                    onPress={() => openCanvas(p)}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.sheetRowLabel, { color: colors.foreground }]}>{p.label}</Text>
                    <View style={styles.sheetRowRight}>
                      {p.profile != null && <Text style={[styles.sheetRowProfile, { color: colors.mutedForeground }]}>{p.profile}</Text>}
                      <Text style={[styles.sheetRowDims, { color: colors.mutedForeground }]}>{p.dims}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
              </>
              )}
            </SheetRise>
          </View>
        </ModalSafeArea>
      </Modal>
      <FirstRunTip
        id="design-studio"
        variant="fullscreen"
        contentReady={projects !== null}
        fullscreen={{ title: 'Design Studio', subtitle: 'A few gestures to get you moving', rows: DESIGN_STUDIO_ROWS }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  sectionTitle: { fontSize: FS.md, fontFamily: FONT.semibold, marginBottom: 12 },

  modeRow: { paddingHorizontal: 20, marginBottom: 16 },
  modeSwitch: { flexDirection: 'row', borderRadius: RADIUS.md, padding: 3, gap: SP.xs },
  modeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: RADIUS.sm },
  modeBtnText: { fontSize: FS.sm, fontFamily: FONT.semibold },

  manualTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.md },
  manualLinks: { flexDirection: 'row', gap: SP.md },
  manualLink: { fontSize: FS.sm, fontFamily: FONT.semibold },
  // 44x44 minimum comfortable touch target (COMP.minTouchTarget); was 34x34.
  newCanvasBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },

  canvasGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: '3%', rowGap: 20 },
  canvasCell: { width: '31.333%' },
  canvasTile: { width: '100%', height: 110, borderRadius: RADIUS.sm, borderWidth: 1, marginBottom: SP.sm, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  canvasShape: { borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  canvasLabel: { fontSize: FS.xs, fontFamily: FONT.semibold },
  canvasDims: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  toolRow: { flexDirection: 'row', alignItems: 'center', borderRadius: RADIUS.md, padding: SP.md, borderWidth: 1, marginBottom: SP.sm, gap: 12 },
  toolIcon: { width: 40, height: 40, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  toolInfo: { flex: 1 },
  toolLabel: { fontSize: FS.sm, fontFamily: FONT.semibold },
  toolDesc: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  toolBadge: { paddingHorizontal: SP.sm, paddingVertical: 2, borderRadius: RADIUS.sm },
  toolBadgeText: { fontSize: FS.xs, fontFamily: FONT.bold },

  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-start' },
  sheetCard: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: SP.lg, borderBottomLeftRadius: RADIUS.lg, borderBottomRightRadius: RADIUS.lg },
  sheetCancel: { position: 'absolute', top: 16, right: 20 },
  sheetCancelText: { fontSize: FS.md, fontFamily: FONT.regular },
  sheetTitle: { fontSize: FS.h2, fontFamily: FONT.bold, marginBottom: 8 },
  sheetSubRow: { flexDirection: 'row', gap: SP.md, marginBottom: SP.md },
  sheetSubActive: { fontSize: FS.sm, fontFamily: FONT.semibold },
  sheetSubMuted: { fontSize: FS.sm, fontFamily: FONT.regular },
  sheetSoloRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: RADIUS.md, paddingHorizontal: SP.md, paddingVertical: SP.md, marginBottom: SP.md },
  clipStatus: { alignItems: 'center', paddingVertical: SP.lg },
  sheetGroup: { borderRadius: RADIUS.md, overflow: 'hidden' },
  sheetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingVertical: SP.md },
  sheetRowBorder: { borderTopWidth: 1 },
  sheetRowLabel: { fontSize: FS.base, fontFamily: FONT.regular },
  sheetRowRight: { flexDirection: 'row', alignItems: 'center', gap: SP.md },
  sheetRowProfile: { fontSize: FS.xs, fontFamily: FONT.regular },
  sheetRowDims: { fontSize: FS.sm, fontFamily: FONT.regular },
});
