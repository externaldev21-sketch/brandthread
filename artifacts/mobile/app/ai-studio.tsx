import React, { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Platform, Alert, Modal } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

type CanvasTile = {
  id: string;
  dims: string;
  ratio: number;
  dark?: boolean;
  hasContent?: boolean;
};

const CANVASES: CanvasTile[] = [
  { id: 'c1', dims: '1320 \u00d7 2868px', ratio: 1320 / 2868, hasContent: true },
  { id: 'c2', dims: '11" \u00d7 8.5"',    ratio: 11 / 8.5,     dark: true },
  { id: 'c3', dims: '6" \u00d7 9.5"',     ratio: 6 / 9.5 },
  { id: 'c4', dims: '2048 \u00d7 2048px', ratio: 1,            dark: true },
  { id: 'c5', dims: '210 \u00d7 297mm',   ratio: 210 / 297 },
  { id: 'c6', dims: '6" \u00d7 4"',       ratio: 6 / 4 },
];

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

const RECENT_MOCKUPS = [
  { name: 'Classic Tee – White', color: '#E8E8E8', status: 'ready' },
  { name: 'Hoodie – Black', color: '#1A1A1A', status: 'ready' },
  { name: 'Cargo Shorts – Khaki', color: '#8A7A5C', status: 'generating' },
  { name: 'Blazer – Navy', color: '#1A2A4A', status: 'ready' },
];

export default function AIStudioScreen() {
  const colors = useColors();
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<'ai' | 'manual'>('ai');
  const [newCanvasVisible, setNewCanvasVisible] = useState(false);

  function openCanvas(preset: SizePreset) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setNewCanvasVisible(false);
    router.push({
      pathname: '/design-canvas',
      params: { label: preset.label, dims: preset.dims, ratio: String(preset.ratio) },
    } as never);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
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
              <TouchableOpacity onPress={() => Alert.alert('Select', 'Tap artwork tiles to select them for batch actions.')}>
                <Text style={[styles.manualLink, { color: colors.mutedForeground }]}>Select</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => Alert.alert('Import', 'Import artwork from your device.')}>
                <Text style={[styles.manualLink, { color: colors.mutedForeground }]}>Import</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => Alert.alert('Photo', 'Start a new canvas from a photo.')}>
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

          <View style={styles.canvasGrid}>
            {CANVASES.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={styles.canvasCell}
                activeOpacity={0.8}
                onPress={() => openCanvas({ label: 'Untitled Artwork', dims: c.dims, ratio: c.ratio })}
              >
                <View style={[styles.canvasTile, { borderColor: colors.border }]}>
                  <View style={[styles.canvasShape, {
                    aspectRatio: c.ratio,
                    backgroundColor: c.dark ? '#1C1C1C' : '#FFFFFF',
                    ...(c.ratio >= 1
                      ? { width: '90%' }
                      : { height: '90%' }),
                  }]}>
                    {c.hasContent && <Feather name="user" size={18} color="#B8B8B8" />}
                  </View>
                </View>
                <Text style={[styles.canvasLabel, { color: colors.foreground }]}>Untitled Artwork</Text>
                <Text style={[styles.canvasDims, { color: colors.mutedForeground }]}>{c.dims}</Text>
              </TouchableOpacity>
            ))}
          </View>
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
              router.push('/bg-removal' as never);
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
            { backgroundColor: selected === tool.label ? '#17140F' : colors.card, borderColor: selected === tool.label ? colors.primary : colors.border },
          ]}
        >
          <View style={[styles.toolIcon, { backgroundColor: selected === tool.label ? '#C1440E22' : colors.secondary }]}>
            <Feather name={tool.icon} size={18} color={selected === tool.label ? colors.primary : colors.mutedForeground} />
          </View>
          <View style={styles.toolInfo}>
            <Text style={[styles.toolLabel, { color: colors.foreground }]}>{tool.label}</Text>
            <Text style={[styles.toolDesc, { color: colors.mutedForeground }]}>{tool.desc}</Text>
          </View>
          {tool.badge != null && (
            <View style={[styles.toolBadge, { backgroundColor: tool.badge === 'Popular' ? '#C1440E22' : '#4C9A5E22' }]}>
              <Text style={[styles.toolBadgeText, { color: tool.badge === 'Popular' ? colors.primary : colors.success }]}>{tool.badge}</Text>
            </View>
          )}
          <Feather name="chevron-right" size={15} color={colors.mutedForeground} />
        </TouchableOpacity>
      ))}

      {/* Recent Mockups */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recent Mockups</Text>
      <View style={styles.mockupsGrid}>
        {RECENT_MOCKUPS.map((m) => (
          <View key={m.name} style={[styles.mockupCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.mockupPreview, { backgroundColor: m.color + '44' }]}>
              <View style={[styles.mockupDot, { backgroundColor: m.color }]} />
              {m.status === 'generating' && (
                <View style={[styles.generatingOverlay, { backgroundColor: '#00000088' }]}>
                  <Feather name="loader" size={16} color="#FFFFFF" />
                </View>
              )}
            </View>
            <Text style={[styles.mockupName, { color: colors.foreground }]} numberOfLines={2}>{m.name}</Text>
            <Text style={[styles.mockupStatus, { color: m.status === 'ready' ? colors.success : colors.warning }]}>
              {m.status === 'ready' ? 'Ready' : 'Generating...'}
            </Text>
          </View>
        ))}
      </View>
      </ScrollView>
      )}

      {/* New canvas sheet */}
      <Modal
        visible={newCanvasVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setNewCanvasVisible(false)}
      >
        <View style={styles.sheetOverlay}>
          <View style={styles.sheetCard}>
            <TouchableOpacity style={styles.sheetCancel} activeOpacity={0.7} onPress={() => setNewCanvasVisible(false)}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>

            <Text style={styles.sheetTitle}>New canvas</Text>
            <View style={styles.sheetSubRow}>
              <Text style={styles.sheetSubActive}>Custom Size</Text>
              <Text style={styles.sheetSubMuted}>From Clipboard</Text>
            </View>

            <TouchableOpacity
              style={styles.sheetSoloRow}
              activeOpacity={0.7}
              onPress={() => openCanvas(SCREEN_SIZE)}
            >
              <Text style={styles.sheetRowLabel}>{SCREEN_SIZE.label}</Text>
              <Text style={styles.sheetRowDims}>{SCREEN_SIZE.dims}</Text>
            </TouchableOpacity>

            <View style={styles.sheetGroup}>
              {SIZE_PRESETS.map((p, i) => (
                <TouchableOpacity
                  key={p.label}
                  style={[styles.sheetRow, i > 0 && styles.sheetRowBorder]}
                  activeOpacity={0.7}
                  onPress={() => openCanvas(p)}
                >
                  <Text style={styles.sheetRowLabel}>{p.label}</Text>
                  <View style={styles.sheetRowRight}>
                    {p.profile != null && <Text style={styles.sheetRowProfile}>{p.profile}</Text>}
                    <Text style={styles.sheetRowDims}>{p.dims}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 },
  backText: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 },
  pageTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  pageSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', marginBottom: 12 },

  modeRow: { paddingHorizontal: 20, marginBottom: 16 },
  modeSwitch: { flexDirection: 'row', borderRadius: 12, padding: 3, gap: 4 },
  modeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 9 },
  modeBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  manualTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  manualLinks: { flexDirection: 'row', gap: 18 },
  manualLink: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  newCanvasBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },

  canvasGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: '3%', rowGap: 20 },
  canvasCell: { width: '31.333%' },
  canvasTile: { width: '100%', height: 110, borderRadius: 10, borderWidth: 1, marginBottom: 8, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: '#111' },
  canvasShape: { borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  canvasLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  canvasDims: { fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 2 },
  toolRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 14, borderWidth: 1, marginBottom: 8, gap: 12 },
  toolIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  toolInfo: { flex: 1 },
  toolLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  toolDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  toolBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  toolBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  generateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, padding: 16, marginBottom: 28, marginTop: 8 },
  generateText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  mockupsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  mockupCard: { width: '47.5%', borderRadius: 12, borderWidth: 1, overflow: 'hidden', padding: 12 },
  mockupPreview: { height: 100, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  mockupDot: { width: 32, height: 32, borderRadius: 16 },
  generatingOverlay: { ...StyleSheet.absoluteFillObject, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  mockupName: { fontSize: 12, fontFamily: 'Inter_600SemiBold', marginBottom: 3 },
  mockupStatus: { fontSize: 11, fontFamily: 'Inter_500Medium' },

  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-start' },
  sheetCard: { backgroundColor: '#161616', paddingTop: 60, paddingHorizontal: 20, paddingBottom: 24, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  sheetCancel: { position: 'absolute', top: 16, right: 20 },
  sheetCancelText: { fontSize: 16, fontFamily: 'Inter_400Regular', color: '#9A9A9A' },
  sheetTitle: { fontSize: 30, fontFamily: 'Inter_700Bold', color: '#FFFFFF', marginBottom: 8 },
  sheetSubRow: { flexDirection: 'row', gap: 18, marginBottom: 16 },
  sheetSubActive: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },
  sheetSubMuted: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#6E6E6E' },
  sheetSoloRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#232323', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 14 },
  sheetGroup: { backgroundColor: '#232323', borderRadius: 12, overflow: 'hidden' },
  sheetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  sheetRowBorder: { borderTopWidth: 1, borderTopColor: '#2E2E2E' },
  sheetRowLabel: { fontSize: 15, fontFamily: 'Inter_400Regular', color: '#FFFFFF' },
  sheetRowRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  sheetRowProfile: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#8A8A8A' },
  sheetRowDims: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#8A8A8A' },
});
