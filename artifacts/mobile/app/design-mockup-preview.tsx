import { GARMENT_TYPES } from '@/services/designTypes';
/**
 * Design Mockup Preview — /design-mockup-preview
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, Dimensions, ActivityIndicator, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import * as Haptics from 'expo-haptics';
import Svg, { Ellipse, G, Path, Rect } from 'react-native-svg';
import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE,
  BLUE, ORANGE, GOLD,
  FONT, FS, SP, ICON,
} from '@/lib/theme';
import {
  BrandthreadCard, PrimaryButton, SecondaryButton,
  SectionHeader, StatusBadge,
} from '@/components/BrandthreadUI';
import { getProject, createBrandAsset, whenDesignServiceReady } from '@/services/designService';
import { DesignProject } from '@/services/designTypes';
import DesignLayerCompositor from '@/components/DesignLayerCompositor';
import { ScreenHeader } from '@/components/ScreenHeader';
import { radius } from '@/constants/radii';
import { showActionSheet } from '@/components/ui/ActionSheet';
import { setPendingMockup } from '@/lib/mockupProductHandoff';
import { MissingItemState } from '@/components/states/MissingItemState';
import GarmentMockup, { type MockupGarment } from '@/components/design/GarmentMockup';
import { getDesignArtwork } from '@/lib/designHandoff';

const GARMENT_COLORS = [
  { label: 'White', color: '#FFFFFF' },
  { label: 'Black', color: '#111111' },
  { label: 'Heather grey', color: '#9A9A9A' },
  { label: 'Silver', color: '#C9CCD1' },
  { label: 'Charcoal', color: '#3A3A3C' },
  { label: 'Cream', color: '#F2EAD8' },
];

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const PANEL_H = SCREEN_H * 0.6;

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
  const headerTopInset = useHeaderTopInset();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();

  const [project, setProject]       = useState<DesignProject | null>(null);
  const [loading, setLoading]       = useState(true);
  const [bgColor, setBgColor]       = useState('#000000');
  const [shadow, setShadow]         = useState<ShadowStyle>('Soft');
  const [saving, setSaving]         = useState(false);
  // The transparent PNG exported by the canvas's "Use on mockup" (if any).
  const artwork = getDesignArtwork(projectId);
  const [garment, setGarment]       = useState<MockupGarment>('tshirt');
  const [garmentColor, setGarmentColor] = useState('#FFFFFF');
  const previewShotRef = useRef<View>(null);

  useEffect(() => {
    if (!projectId) { setLoading(false); return; }
    let cancelled = false;
    whenDesignServiceReady()
      .then(() => getProject(projectId))
      .then(p => {
        if (cancelled) return;
        setProject(p);
        if (p?.garmentType === 'hoodie' || p?.garmentType === 'sweatshirt') setGarment('hoodie');
        if (p?.garmentColor) setGarmentColor(p.garmentColor);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  // Flattens the on-screen preview panel (garment + composited design layers
  // + background + labels) into a real PNG via react-native-view-shot, the
  // same capture approach BgRefineCanvas uses for background removal exports.
  const handleSaveMockup = useCallback(async () => {
    if (!project || !previewShotRef.current || saving) return;
    setSaving(true);
    try {
      // Loaded on demand: keeps view-shot (html2canvas on web) out of the startup bundle.
      const { captureRef } = await import('react-native-view-shot');
      const uri = await captureRef(previewShotRef, { format: 'png', quality: 1, result: 'data-uri' });
      await createBrandAsset({
        name: `${project.name} Mockup`,
        type: 'mockup',
        uri: uri.startsWith('data:') ? uri : `data:image/png;base64,${uri}`,
        tags: [],
      });
      Alert.alert('Saved', 'Mockup saved to Brand Assets.');
    } catch {
      Alert.alert('Couldn’t save mockup', 'Something went wrong capturing this preview. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [project, saving]);

  // Flattens the preview (same capture as Save mockup) and hands it to the
  // product screen the seller picks, which attaches it as a product photo.
  const handleAddToProduct = useCallback(async () => {
    if (!project || !previewShotRef.current) return;
    try {
      // A temp file on native (uploaded via fetch like a picked photo); web only supports data URIs.
      const { captureRef } = await import('react-native-view-shot');
      const uri = await captureRef(previewShotRef, { format: 'png', quality: 1, result: Platform.OS === 'web' ? 'data-uri' : 'tmpfile' });
      setPendingMockup({
        projectId: project.id,
        uri: /^(data|file|blob|https?):/.test(uri) ? uri : uri.startsWith('/') ? `file://${uri}` : `data:image/png;base64,${uri}`,
        name: project.name,
      });
    } catch {
      Alert.alert('Couldn’t capture mockup', 'Something went wrong capturing this preview. Please try again.');
      return;
    }
    // Only "pick an existing product" exists: Add Product does not read a
    // pending mockup, so a "Create new product" option opened a blank form.
    showActionSheet('Add to Product', 'Pick the product this mockup should be added to.', [
      {
        text: 'Choose product',
        onPress: () => router.push(('/(tabs)/products?pickForMockup=1&projectId=' + (project?.id ?? '')) as never),
      },
      { text: 'Cancel', style: 'cancel', onPress: () => setPendingMockup(null) },
    ]);
  }, [project, router]);

  // Shadow Style: a contact shadow on the "floor" under the garment, part of
  // the captured mockup for Save / Add to product.
  const mockupW = Math.min(SCREEN_W * 0.86, PANEL_H * 0.8);
  const renderShadow = () => {
    if (shadow === 'None') return null;
    const w = mockupW;
    return (
      <Svg width={w} height={28} viewBox="0 0 200 14" style={{ marginTop: -14 }} pointerEvents="none" testID="mockup-shadow">
        {shadow === 'Hard' && <Ellipse cx={100} cy={7} rx={70} ry={3.5} fill="#000000" opacity={0.65} />}
        {shadow === 'Drop' && <Ellipse cx={108} cy={8} rx={82} ry={5} fill="#000000" opacity={0.4} />}
        {shadow === 'Soft' && (
          <G>
            <Ellipse cx={100} cy={7} rx={92} ry={6} fill="#000000" opacity={0.1} />
            <Ellipse cx={100} cy={7} rx={76} ry={4.5} fill="#000000" opacity={0.14} />
            <Ellipse cx={100} cy={7} rx={58} ry={3} fill="#000000" opacity={0.2} />
          </G>
        )}
      </Svg>
    );
  };

  if (loading) {
    return (
      <View style={[styles.root, { paddingTop: headerTopInset, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={PURPLE} />
      </View>
    );
  }

  if (!project) {
    return (
      <MissingItemState
        headerTitle="Mockup preview"
        title="No garment project"
        message="Open a garment project to see the mockup preview."
        icon="image"
      />
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title="Mockup preview" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Main preview panel */}
        <View
          ref={previewShotRef}
          collapsable={false}
          style={[styles.previewPanel, { backgroundColor: bgColor, height: PANEL_H }]}
        >
          <GarmentMockup
            garment={garment}
            color={garmentColor}
            width={mockupW}
            artworkUri={artwork?.uri}
            artworkAspect={artwork ? artwork.width / artwork.height : (project.canvas.width || 1080) / (project.canvas.height || 1080)}
            testID="garment-mockup"
            fallback={project.layers && project.layers.length > 0 ? (
              // From the gallery (no fresh export): the saved layer previews,
              // background left out so empty canvas shows the garment.
              <DesignLayerCompositor
                project={{ ...project, canvas: { ...project.canvas, backgroundHidden: true } }}
                displaySize={mockupW * 0.36}
                borderRadius={0}
              />
            ) : null}
          />
          {renderShadow()}
          <View style={styles.overlayLabels} testID="mockup-overlay-labels">
            <Text style={[styles.overlayName, { color: bgColor === '#FFFFFF' || bgColor === '#FFF8F0' ? '#000' : FG }]}>
              {project.name}
            </Text>
            <Text style={[styles.overlayType, { color: bgColor === '#FFFFFF' || bgColor === '#FFF8F0' ? '#333' : MUTED }]}>
              {garment === 'hoodie' ? 'Hoodie' : 'T-Shirt'} · {GARMENT_COLORS.find(c => c.color === garmentColor)?.label ?? 'Custom'}
            </Text>
          </View>
        </View>

        {/* Garment */}
        <SectionHeader title="Garment" style={styles.sectionHeader} />
        <View style={styles.bgRow}>
          {([['tshirt', 'T-Shirt'], ['hoodie', 'Hoodie']] as const).map(([key, label]) => (
            <TouchableOpacity
              key={key}
              onPress={() => { Haptics.selectionAsync(); setGarment(key); }}
              style={[styles.shadowPill, garment === key && styles.shadowPillActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: garment === key }}
              testID={`mockup-garment-${key}`}
            >
              <Text style={[styles.shadowText, garment === key && styles.shadowTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <SectionHeader title="Garment colour" style={styles.sectionHeader} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bgRow}>
          {GARMENT_COLORS.map(opt => (
            <TouchableOpacity
              key={opt.label}
              onPress={() => { Haptics.selectionAsync(); setGarmentColor(opt.color); }}
              style={[styles.bgSwatch, { backgroundColor: opt.color, borderColor: garmentColor === opt.color ? FG : BORDER }]}
              accessibilityRole="button"
              accessibilityLabel={`${opt.label} garment`}
              accessibilityState={{ selected: garmentColor === opt.color }}
              testID={`mockup-garment-color-${opt.label.toLowerCase().replace(/\s+/g, '-')}`}
            />
          ))}
        </ScrollView>

        {/* Background options */}
        <SectionHeader title="Background" style={styles.sectionHeader} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bgRow}>
          {BG_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.label}
              onPress={() => { Haptics.selectionAsync(); setBgColor(opt.color); }}
              style={[styles.bgSwatch, { backgroundColor: opt.color, borderColor: bgColor === opt.color ? PURPLE : BORDER }]}
              activeOpacity={0.8}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={`${opt.label} background`}
              accessibilityState={{ selected: bgColor === opt.color }}
            />
          ))}
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
              hitSlop={{ top: 6, bottom: 6 }}
              accessibilityRole="button"
              accessibilityLabel={`${s} shadow`}
              accessibilityState={{ selected: shadow === s }}
            >
              <Text style={[styles.shadowText, shadow === s && styles.shadowTextActive]}>{s}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Actions */}
        <View style={styles.actionsWrap}>
          <PrimaryButton label="Save mockup" onPress={handleSaveMockup} loading={saving} style={styles.actionBtn} />
          <SecondaryButton label="Add to product" onPress={handleAddToProduct} accent={CYAN} style={styles.actionBtn} />
        </View>
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const { accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT } = theme;
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  scrollContent: { paddingBottom: 120 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.lg },
  disclaimer: { fontSize: FS.base, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', marginTop: SP.md },

  previewPanel: {
    width: SCREEN_W,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  garmentWrap: { alignItems: 'center', justifyContent: 'center', position: 'relative' },
  designOverlay: {
    position: 'absolute',
    top: '30%',
    left: '33%',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
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
    borderRadius: radius.sm, backgroundColor: CARD,
    borderWidth: 1, borderColor: BORDER,
  },
  shadowPillActive: { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE },
  shadowText: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  shadowTextActive: { color: PURPLE_LIGHT, fontFamily: FONT.semibold },

  actionsWrap: { padding: SP.md, gap: SP.sm },
  actionBtn: { marginBottom: 0 },
  });
};
