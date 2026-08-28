/**
 * Design Mockup Preview — /design-mockup-preview
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, Dimensions, ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Svg, { Path, Rect } from 'react-native-svg';
import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE,
  BLUE, ORANGE, GOLD,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import {
  BrandthreadCard, PrimaryButton, SecondaryButton,
  SectionHeader, StatusBadge,
} from '@/components/BrandthreadUI';
import { getProject, exportProject, createBrandAsset } from '@/services/designService';
import { DesignProject } from '@/services/designTypes';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const PANEL_H = SCREEN_H * 0.6;

const VIEWS = ['Front', 'Back', 'Detail', 'Flat Lay'] as const;
type ViewTab = typeof VIEWS[number];

const BG_OPTIONS = [
  { label: 'Black',  color: '#000000' },
  { label: 'White',  color: '#FFFFFF' },
  { label: 'Gray',   color: '#6B7280' },
  { label: 'Cream',  color: '#FFF8F0' },
];

const SHADOW_STYLES = ['None', 'Soft', 'Hard', 'Drop'] as const;
type ShadowStyle = typeof SHADOW_STYLES[number];

export default function DesignMockupPreviewScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT, secondary: CYAN } = theme;
  const styles = createStyles(theme);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();

  const [project, setProject]       = useState<DesignProject | null>(null);
  const [loading, setLoading]       = useState(true);
  const [activeView, setActiveView] = useState<ViewTab>('Front');
  const [bgColor, setBgColor]       = useState('#000000');
  const [shadow, setShadow]         = useState<ShadowStyle>('Soft');
  const [exporting, setExporting]   = useState(false);

  useEffect(() => {
    if (!projectId) { setLoading(false); return; }
    getProject(projectId).then(p => { setProject(p); setLoading(false); });
  }, [projectId]);

  const handleExport = useCallback(async () => {
    if (!project) return;
    Alert.alert('Export Mockup', 'Export this mockup to your device?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Export',
        onPress: async () => {
          setExporting(true);
          await exportProject(project.id, 'png');
          setExporting(false);
          Alert.alert('Success', 'Mockup exported successfully!');
        },
      },
    ]);
  }, [project]);

  const handleSaveMockup = useCallback(async () => {
    if (!project) return;
    await createBrandAsset({ name: `${project.name} Mockup`, type: 'mockup', tags: [] });
    Alert.alert('Saved', 'Mockup saved to Brand Assets.');
  }, [project]);

  const handleAddToProduct = useCallback(() => {
    Alert.alert('Add to Product', 'Choose an option:', [
      {
        text: 'Existing product',
        onPress: () => router.push(('/(tabs)/products?pickForMockup=1&projectId=' + (project?.id ?? '')) as never),
      },
      {
        text: 'Create new product',
        onPress: () => router.push(('/add-product?mockupProjectId=' + (project?.id ?? '')) as never),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [project, router]);

  const handleCustomBg = useCallback(() => {
    Alert.alert('Custom Background', 'Enter a hex color in the next version. Using current color for now.');
  }, []);

  const renderGarmentSvg = () => {
    const garment = project?.garmentType ?? 'tshirt';
    const fill = project?.garmentColor ?? '#1A1A2E';

    if (garment === 'tshirt') {
      // T-shirt shape path
      return (
        <Svg width={SCREEN_W * 0.7} height={PANEL_H * 0.7} viewBox="0 0 200 220">
          <Path
            d="M60,10 L30,50 L0,40 L20,80 L40,70 L40,210 L160,210 L160,70 L180,80 L200,40 L170,50 L140,10 Q120,0 100,0 Q80,0 60,10 Z"
            fill={fill}
            stroke={PURPLE + '88'}
            strokeWidth={1.5}
          />
        </Svg>
      );
    }

    // Default: rounded rect with label
    const label = garment.charAt(0).toUpperCase() + garment.slice(1);
    return (
      <Svg width={SCREEN_W * 0.7} height={PANEL_H * 0.6} viewBox="0 0 200 250">
        <Rect
          x={10} y={10} width={180} height={230}
          rx={16} ry={16}
          fill={fill}
          stroke={CYAN + '66'}
          strokeWidth={1.5}
        />
      </Svg>
    );
  };

  if (loading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={PURPLE} />
      </View>
    );
  }

  if (!project) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={ICON.md} color={FG} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Mockup Preview</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centered}>
          <Feather name="image" size={48} color={SUBTLE} />
          <Text style={styles.disclaimer}>Open a garment project to see the mockup preview.</Text>
          <SecondaryButton label="Go back" onPress={() => router.back()} style={{ marginTop: SP.md }} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Mockup Preview</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* View tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
          {VIEWS.map(v => (
            <TouchableOpacity
              key={v}
              onPress={() => { Haptics.selectionAsync(); setActiveView(v); }}
              style={[styles.tabBtn, activeView === v && styles.tabBtnActive]}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, activeView === v && styles.tabTextActive]}>{v}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Main preview panel */}
        <View style={[styles.previewPanel, { backgroundColor: bgColor, height: PANEL_H }]}>
          <View style={styles.garmentWrap}>
            {renderGarmentSvg()}
          </View>
          <View style={styles.overlayLabels}>
            <Text style={[styles.overlayName, { color: bgColor === '#FFFFFF' || bgColor === '#FFF8F0' ? '#000' : FG }]}>
              {project.name}
            </Text>
            <Text style={[styles.overlayType, { color: bgColor === '#FFFFFF' || bgColor === '#FFF8F0' ? '#333' : MUTED }]}>
              {project.garmentType ?? 'Garment'} · {activeView}
            </Text>
          </View>
        </View>

        {/* Background options */}
        <SectionHeader title="Background" style={styles.sectionHeader} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bgRow}>
          {BG_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.label}
              onPress={() => { Haptics.selectionAsync(); setBgColor(opt.color); }}
              style={[styles.bgSwatch, { backgroundColor: opt.color, borderColor: bgColor === opt.color ? PURPLE : BORDER }]}
              activeOpacity={0.8}
            />
          ))}
          <TouchableOpacity
            onPress={handleCustomBg}
            style={[styles.bgSwatchCustom, { borderColor: BORDER }]}
            activeOpacity={0.8}
          >
            <Feather name="plus" size={16} color={MUTED} />
          </TouchableOpacity>
        </ScrollView>

        {/* Shadow style */}
        <SectionHeader title="Shadow Style" style={styles.sectionHeader} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bgRow}>
          {SHADOW_STYLES.map(s => (
            <TouchableOpacity
              key={s}
              onPress={() => { Haptics.selectionAsync(); setShadow(s); }}
              style={[styles.shadowPill, shadow === s && styles.shadowPillActive]}
              activeOpacity={0.8}
            >
              <Text style={[styles.shadowText, shadow === s && styles.shadowTextActive]}>{s}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Actions */}
        <View style={styles.actionsWrap}>
          {exporting ? (
            <ActivityIndicator color={PURPLE} style={{ marginBottom: SP.sm }} />
          ) : (
            <PrimaryButton label="Export mockup" onPress={handleExport} style={styles.actionBtn} />
          )}
          <SecondaryButton label="Save mockup" onPress={handleSaveMockup} style={styles.actionBtn} />
          <SecondaryButton label="Add to product" onPress={handleAddToProduct} accent={CYAN} style={styles.actionBtn} />
        </View>
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const { accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT } = theme;
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  scrollContent: { paddingBottom: 120 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.lg },
  disclaimer: { fontSize: FS.base, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', marginTop: SP.md },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, paddingVertical: SP.sm,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: FS.md, fontFamily: FONT.bold, color: FG },

  tabsRow: { flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.md, paddingBottom: SP.sm },
  tabBtn: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: RADIUS.pill, backgroundColor: CARD,
    borderWidth: 1, borderColor: BORDER,
  },
  tabBtnActive: { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE },
  tabText: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  tabTextActive: { color: PURPLE_LIGHT, fontFamily: FONT.semibold },

  previewPanel: {
    width: SCREEN_W,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  garmentWrap: { alignItems: 'center', justifyContent: 'center' },
  overlayLabels: {
    position: 'absolute', bottom: SP.md, left: SP.md, right: SP.md,
  },
  overlayName: { fontSize: FS.md, fontFamily: FONT.bold },
  overlayType: { fontSize: FS.sm, fontFamily: FONT.regular, marginTop: 2 },

  sectionHeader: { marginTop: SP.lg, marginBottom: SP.sm },
  bgRow: { flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.md, paddingBottom: SP.sm },
  bgSwatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 2 },
  bgSwatchCustom: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', backgroundColor: CARD,
  },
  shadowPill: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: RADIUS.pill, backgroundColor: CARD,
    borderWidth: 1, borderColor: BORDER,
  },
  shadowPillActive: { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE },
  shadowText: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  shadowTextActive: { color: PURPLE_LIGHT, fontFamily: FONT.semibold },

  actionsWrap: { padding: SP.md, gap: SP.sm },
  actionBtn: { marginBottom: 0 },
  });
};
