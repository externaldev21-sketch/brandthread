import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Platform, Alert, Modal } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/BrandthreadUI';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { FONT, FS } from '@/lib/theme';
import { getProjects, createProject, updateProject } from '@/services/designService';
import { makeDurableUri } from '@/lib/imageUri';
import { canvasPixelSize, buildImageLayer } from '@/lib/aiStudioCanvas';
import { DesignProject } from '@/services/designTypes';
import { SheetRise } from '@/components/motion/SheetRise';
import { ModalSafeArea } from '@/components/ModalSafeArea';
import { FirstRunTip } from '@/components/first-run-tips/FirstRunTip';
import { DESIGN_STUDIO_ROWS } from '@/lib/firstRunTips/content';

const STUDIO_TOOLS = [
  { label: 'AI Clothing Mockups', icon: 'image' as const, desc: 'Generate photorealistic product mockups', badge: 'Popular' },
  { label: 'AI Product Photography', icon: 'camera' as const, desc: 'Studio-quality product shots without a camera', badge: null },
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
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<'ai' | 'manual'>('ai');
  const [newCanvasVisible, setNewCanvasVisible] = useState(false);
  const [projects, setProjects] = useState<DesignProject[] | null>(null);

  const loadProjects = useCallback(() => {
    getProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  useFocusEffect(useCallback(() => { loadProjects(); }, [loadProjects]));

  function openProject(project: DesignProject) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
    } catch { Alert.alert('Error', 'Could not create canvas.'); }
  }

  async function openImageCanvas(asset: ImagePicker.ImagePickerAsset, name: string) {
    try {
      const uri = await makeDurableUri(asset.uri);
      const width = asset.width || 1080, height = asset.height || 1080;
      const proj = await createProject('canvas', name, { width, height, backgroundHex: '#FFFFFF' });
      await updateProject(proj.id, {
        layers: [buildImageLayer({ id: `uid_${Date.now()}`, name, uri, width, height, now: new Date().toISOString() })],
      });
      router.push(`/design-canvas?id=${proj.id}` as never);
    } catch { Alert.alert('Error', 'Could not import photo.'); }
  }

  async function importFromLibrary() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access to import artwork.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.9, allowsEditing: false });
    if (!res.canceled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await openImageCanvas(res.assets[0], 'Imported');
    }
  }

  async function openFromCamera() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow camera access to take a photo.'); return; }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.9, allowsEditing: true });
    if (!res.canceled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await openImageCanvas(res.assets[0], 'Photo');
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Design Studio" subtitle="Powered by generative AI" />

      {/* Mode switch */}
      <View style={styles.modeRow}>
        <View style={[styles.modeSwitch, { backgroundColor: colors.secondary }]}>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'ai' && { backgroundColor: colors.card }]}
            activeOpacity={0.8}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setMode('ai'); }}
          >
            <Feather name="zap" size={13} color={mode === 'ai' ? colors.primary : colors.mutedForeground} />
            <Text style={[styles.modeBtnText, { color: mode === 'ai' ? colors.foreground : colors.mutedForeground }]}>AI Generate</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'manual' && { backgroundColor: colors.card }]}
            activeOpacity={0.8}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setMode('manual'); }}
          >
            <Feather name="edit-3" size={13} color={mode === 'manual' ? colors.primary : colors.mutedForeground} />
            <Text style={[styles.modeBtnText, { color: mode === 'manual' ? colors.foreground : colors.mutedForeground }]}>Manual Design</Text>
          </TouchableOpacity>
        </View>
      </View>

      {mode === 'manual' ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: 4, paddingBottom: 100, paddingHorizontal: 20 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.manualTopRow}>
            <View style={styles.manualLinks}>
              <TouchableOpacity onPress={importFromLibrary}>
                <Text style={[styles.manualLink, { color: colors.mutedForeground }]}>Import</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={openFromCamera}>
                <Text style={[styles.manualLink, { color: colors.mutedForeground }]}>Photo</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.newCanvasBtn, { backgroundColor: colors.primary }]}
              activeOpacity={0.8}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setNewCanvasVisible(true); }}
            >
              <Feather name="plus" size={18} color={colors.primaryForeground} />
            </TouchableOpacity>
          </View>

          {projects && projects.length === 0 ? (
            <EmptyState
              icon="edit-3"
              title="No designs yet"
              description="Start a canvas or import artwork."
              action={{ label: 'New canvas', onPress: () => setNewCanvasVisible(true) }}
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
                  >
                    <View style={[styles.canvasTile, { borderColor: colors.border, backgroundColor: colors.card }]}>
                      <View style={[styles.canvasShape, {
                        aspectRatio: ratio,
                        backgroundColor: p.canvas.backgroundHex || '#FFFFFF',
                        ...(ratio >= 1 ? { width: '90%' } : { height: '90%' }),
                      }]}>
                        {!p.thumbnail && <Feather name="image" size={18} color={colors.mutedForeground} />}
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
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 100, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >

      {/* Tools */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Studio Tools</Text>
      {STUDIO_TOOLS.map((tool) => (
        <TouchableOpacity
          key={tool.label}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            if (tool.label === 'AI Clothing Mockups') {
              router.push('/ai-mockup-chat' as never);
              return;
            }
            if (tool.label === 'AI Product Photography') {
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
              return;
            }
            setSelected(tool.label);
          }}
          activeOpacity={0.75}
          style={[
            styles.toolRow,
            { backgroundColor: colors.card, borderColor: selected === tool.label ? colors.primary : colors.border },
          ]}
        >
          <View style={[styles.toolIcon, { backgroundColor: selected === tool.label ? colors.accent : colors.secondary }]}>
            <Feather name={tool.icon} size={18} color={selected === tool.label ? colors.primary : colors.mutedForeground} />
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
          <Feather name="chevron-right" size={15} color={colors.mutedForeground} />
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
              <TouchableOpacity style={styles.sheetCancel} activeOpacity={0.7} onPress={() => setNewCanvasVisible(false)}>
                <Text style={[styles.sheetCancelText, { color: colors.mutedForeground }]}>Cancel</Text>
              </TouchableOpacity>

              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>New canvas</Text>
              <View style={styles.sheetSubRow}>
                <Text style={[styles.sheetSubActive, { color: colors.foreground }]}>Custom Size</Text>
                <Text style={[styles.sheetSubMuted, { color: colors.mutedForeground }]}>From Clipboard</Text>
              </View>

              <TouchableOpacity
                style={[styles.sheetSoloRow, { backgroundColor: colors.elevated }]}
                activeOpacity={0.7}
                onPress={() => openCanvas(SCREEN_SIZE)}
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
                  >
                    <Text style={[styles.sheetRowLabel, { color: colors.foreground }]}>{p.label}</Text>
                    <View style={styles.sheetRowRight}>
                      {p.profile != null && <Text style={[styles.sheetRowProfile, { color: colors.mutedForeground }]}>{p.profile}</Text>}
                      <Text style={[styles.sheetRowDims, { color: colors.mutedForeground }]}>{p.dims}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
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
  modeSwitch: { flexDirection: 'row', borderRadius: 12, padding: 3, gap: 4 },
  modeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 9 },
  modeBtnText: { fontSize: FS.sm, fontFamily: FONT.semibold },

  manualTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  manualLinks: { flexDirection: 'row', gap: 18 },
  manualLink: { fontSize: FS.sm, fontFamily: FONT.semibold },
  // 44x44 minimum comfortable touch target (COMP.minTouchTarget); was 34x34.
  newCanvasBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },

  canvasGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: '3%', rowGap: 20 },
  canvasCell: { width: '31.333%' },
  canvasTile: { width: '100%', height: 110, borderRadius: 10, borderWidth: 1, marginBottom: 8, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  canvasShape: { borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  canvasLabel: { fontSize: FS.xs, fontFamily: FONT.semibold },
  canvasDims: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  toolRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 14, borderWidth: 1, marginBottom: 8, gap: 12 },
  toolIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  toolInfo: { flex: 1 },
  toolLabel: { fontSize: FS.sm, fontFamily: FONT.semibold },
  toolDesc: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  toolBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  toolBadgeText: { fontSize: FS.xs, fontFamily: FONT.bold },

  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-start' },
  sheetCard: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 24, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  sheetCancel: { position: 'absolute', top: 16, right: 20 },
  sheetCancelText: { fontSize: FS.md, fontFamily: FONT.regular },
  sheetTitle: { fontSize: FS.h2, fontFamily: FONT.bold, marginBottom: 8 },
  sheetSubRow: { flexDirection: 'row', gap: 18, marginBottom: 16 },
  sheetSubActive: { fontSize: FS.sm, fontFamily: FONT.semibold },
  sheetSubMuted: { fontSize: FS.sm, fontFamily: FONT.regular },
  sheetSoloRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 14 },
  sheetGroup: { borderRadius: 12, overflow: 'hidden' },
  sheetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  sheetRowBorder: { borderTopWidth: 1 },
  sheetRowLabel: { fontSize: FS.base, fontFamily: FONT.regular },
  sheetRowRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  sheetRowProfile: { fontSize: FS.xs, fontFamily: FONT.regular },
  sheetRowDims: { fontSize: FS.sm, fontFamily: FONT.regular },
});
