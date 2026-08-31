/**
 * Brandthread Design Studio — Garment Design Mode
 * Route: /design-garment?projectId=<id>&garmentType=tshirt&garmentColor=#FFFFFF
 */
import React, { useState, useEffect } from 'react';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  BG, SURFACE, CARD, CARD_ELEVATED,
  BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE,
  SUCCESS, SUCCESS_DIM,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { getProject, updateProject } from '@/services/designService';
import { GARMENT_TYPES, GARMENT_TEMPLATES } from '@/services/designTypes';

const GARMENT_SWATCH_COLORS = [
  { label: 'Black',  hex: '#000000' },
  { label: 'White',  hex: '#FFFFFF' },
  { label: 'Navy',   hex: '#1E3A5F' },
  { label: 'Gray',   hex: '#6B7280' },
  { label: 'Red',    hex: '#EF4444' },
  { label: 'Green',  hex: '#22C55E' },
  { label: 'Blue',   hex: '#3B82F6' },
  { label: 'Yellow', hex: '#EAB308' },
  { label: 'Orange', hex: '#F97316' },
  { label: 'Pink',   hex: '#EC4899' },
  { label: 'Teal',   hex: '#0F766E' },
  { label: 'Cream',  hex: '#F5E6C8' },
];

const PLACEMENT_ZONES_ALL = [
  'Center Chest', 'Left Chest', 'Full Front', 'Full Back',
  'Upper Back', 'Sleeve', 'Pocket', 'Neck Label', 'Hem Label', 'Custom',
];

function garmentLabel(type: string): string {
  const map: Record<string, string> = {
    tshirt: 'T-Shirt', hoodie: 'Hoodie', sweatshirt: 'Sweatshirt',
    jacket: 'Jacket', hat: 'Hat', bag: 'Bag', polo: 'Polo',
    tank: 'Tank Top', longsleeve: 'Long Sleeve', shorts: 'Shorts',
    joggers: 'Joggers',
  };
  return map[type] ?? type;
}

// Approximate placement zone rects as % of garment preview area
const ZONE_RECTS: Record<string, { x: number; y: number; w: number; h: number }> = {
  'Center Chest': { x: 30, y: 20, w: 40, h: 30 },
  'Left Chest':   { x: 15, y: 18, w: 20, h: 15 },
  'Full Front':   { x: 10, y: 10, w: 80, h: 75 },
  'Full Back':    { x: 10, y: 10, w: 80, h: 75 },
  'Upper Back':   { x: 20, y: 10, w: 60, h: 25 },
  'Sleeve':       { x: 5,  y: 30, w: 18, h: 30 },
  'Pocket':       { x: 14, y: 30, w: 18, h: 18 },
  'Neck Label':   { x: 35, y: 2,  w: 30, h: 12 },
  'Hem Label':    { x: 35, y: 85, w: 30, h: 10 },
  'Custom':       { x: 20, y: 20, w: 60, h: 60 },
};

export default function DesignGarmentScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  const gs = createStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string; garmentType?: string; garmentColor?: string }>();

  const [garmentType, setGarmentType] = useState(params.garmentType ?? 'tshirt');
  const [garmentColor, setGarmentColor] = useState(params.garmentColor ?? '#FFFFFF');
  const [currentView, setCurrentView] = useState('Front');
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [showEmbroidery, setShowEmbroidery] = useState(false);
  const [saving, setSaving] = useState(false);

  const projectId = params.projectId ?? '';
  const template = (GARMENT_TEMPLATES as any)[garmentType] ?? (GARMENT_TEMPLATES as any)['tshirt'];
  const availableViews = template.views;
  const availableZones = template.placementZones ?? PLACEMENT_ZONES_ALL;

  // Reset view when garment type changes
  useEffect(() => {
    if (!availableViews.includes(currentView)) {
      setCurrentView(availableViews[0] ?? 'Front');
    }
    setSelectedZone(null);
  }, [garmentType]);

  async function handleSavePlacement() {
    if (!projectId) {
      Alert.alert('No project', 'Create a project first.');
      return;
    }
    setSaving(true);
    await updateProject(projectId, {
      garmentType,
      garmentColor,
      updatedAt: new Date().toISOString(),
    } as any);
    setSaving(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Saved', 'Placement saved to project.');
  }

  // Determine if garment is light or dark for text contrast
  const isDarkGarment = ['#000000', '#1E3A5F', '#6B7280', '#EF4444', '#3B82F6', '#0F766E', '#22C55E', '#F97316', '#EC4899'].includes(garmentColor);
  const garmentTextColor = isDarkGarment ? '#FFFFFF' : '#111111';

  return (
    <View style={gs.root}>
      {/* ── TOP BAR ── */}
      <View style={[gs.topBar, { paddingTop: insets.top + 4 }]}>
        <TouchableOpacity style={gs.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={gs.topTitle}>Garment Design</Text>
        <TouchableOpacity
          style={gs.openEditorBtn}
          onPress={() => router.push(`/design-canvas?id=${projectId}&garmentView=${currentView}` as any)}
        >
          <Feather name="edit-2" size={ICON.sm} color={PURPLE_LIGHT} />
          <Text style={gs.openEditorText}>Open Editor</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {/* ── GARMENT TYPE PICKER ── */}
        <View style={gs.section}>
          <Text style={gs.sectionLabel}>Garment Type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.xs, paddingHorizontal: SP.md }}>
            {GARMENT_TYPES.map(t => (
              <TouchableOpacity
                key={t.value}
                style={[gs.typePill, garmentType === t.value && gs.typePillActive]}
                onPress={() => { Haptics.selectionAsync(); setGarmentType(t.value); }}
              >
                <Text style={[gs.typePillText, garmentType === t.value && { color: PURPLE_LIGHT }]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* ── GARMENT PREVIEW ── */}
        <View style={gs.previewContainer}>
          <View style={[gs.garmentPreview, { backgroundColor: garmentColor }]}>
            {/* Garment silhouette label */}
            <Text style={[gs.garmentLabel, { color: garmentTextColor }]}>
              {garmentLabel(garmentType)}
            </Text>
            <Text style={[gs.garmentViewLabel, { color: garmentTextColor + 'AA' }]}>
              {currentView} View
            </Text>

            {/* Selected placement overlay */}
            {selectedZone && ZONE_RECTS[selectedZone] && (() => {
              const z = ZONE_RECTS[selectedZone];
              return (
                <View style={[gs.zoneOverlay, {
                  left: `${z.x}%`,
                  top: `${z.y}%`,
                  width: `${z.w}%`,
                  height: `${z.h}%`,
                }]} />
              );
            })()}

            {/* Safe area overlay */}
            {showSafeArea && (
              <View style={gs.safeAreaOverlay} />
            )}

            {/* Embroidery overlay */}
            {showEmbroidery && (
              <View style={gs.embroideryOverlay} />
            )}
          </View>
        </View>

        {/* ── VIEW SWITCHER ── */}
        <View style={gs.section}>
          <Text style={gs.sectionLabel}>View</Text>
          <View style={gs.viewTabs}>
            {availableViews.map((view: string) => (
              <TouchableOpacity
                key={view}
                style={[gs.viewTab, currentView === view && gs.viewTabActive]}
                onPress={() => { Haptics.selectionAsync(); setCurrentView(view); }}
              >
                <Text style={[gs.viewTabText, currentView === view && { color: PURPLE_LIGHT }]}>{view}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── GARMENT COLOR ── */}
        <View style={gs.section}>
          <Text style={gs.sectionLabel}>Garment Color</Text>
          <View style={gs.colorGrid}>
            {GARMENT_SWATCH_COLORS.map(({ label, hex }) => (
              <TouchableOpacity
                key={hex}
                style={[gs.colorSwatch, { backgroundColor: hex }, garmentColor === hex && gs.colorSwatchActive]}
                onPress={() => { Haptics.selectionAsync(); setGarmentColor(hex); }}
              >
                {garmentColor === hex && (
                  <Feather name="check" size={12} color={isDarkGarment ? '#FFFFFF' : '#000000'} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── PLACEMENT ZONES ── */}
        <View style={gs.section}>
          <Text style={gs.sectionLabel}>Placement Zone</Text>
          <View style={gs.zoneGrid}>
            {availableZones.map((zone: string) => (
              <TouchableOpacity
                key={zone}
                style={[gs.zoneChip, selectedZone === zone && gs.zoneChipActive]}
                onPress={() => { Haptics.selectionAsync(); setSelectedZone(selectedZone === zone ? null : zone); }}
              >
                <Text style={[gs.zoneChipText, selectedZone === zone && { color: CYAN }]}>{zone}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── PRINT OPTIONS ── */}
        <View style={gs.section}>
          <Text style={gs.sectionLabel}>Overlays</Text>
          <View style={gs.optionRow}>
            <TouchableOpacity
              style={[gs.optionToggle, showSafeArea && gs.optionToggleActive]}
              onPress={() => { Haptics.selectionAsync(); setShowSafeArea(v => !v); }}
            >
              <Feather name="maximize" size={14} color={showSafeArea ? SUCCESS : MUTED} />
              <Text style={[gs.optionToggleText, showSafeArea && { color: SUCCESS }]}>Print-Safe Area</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[gs.optionToggle, showEmbroidery && gs.optionToggleActive]}
              onPress={() => { Haptics.selectionAsync(); setShowEmbroidery(v => !v); }}
            >
              <Feather name="scissors" size={14} color={showEmbroidery ? CYAN : MUTED} />
              <Text style={[gs.optionToggleText, showEmbroidery && { color: CYAN }]}>Embroidery-Safe</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── ACTIONS ── */}
        <View style={[gs.section, { paddingBottom: insets.bottom + SP.xl }]}>
          <TouchableOpacity
            style={gs.savePlacementBtn}
            onPress={handleSavePlacement}
            disabled={saving}
            activeOpacity={0.85}
          >
            <Feather name="save" size={ICON.sm} color="#FFFFFF" />
            <Text style={gs.savePlacementText}>{saving ? 'Saving…' : 'Save Placement'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={gs.openEditorLargeBtn}
            onPress={() => router.push(`/design-canvas?id=${projectId}&garmentView=${currentView}` as any)}
            activeOpacity={0.85}
          >
            <Feather name="edit-2" size={ICON.sm} color={PURPLE_LIGHT} />
            <Text style={gs.openEditorLargeText}>Open in Editor</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const { accent: PURPLE, accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  return StyleSheet.create({
  root:         { flex: 1, backgroundColor: BG },
  topBar:       { flexDirection: 'row', alignItems: 'center', backgroundColor: SURFACE, borderBottomWidth: 1, borderBottomColor: BORDER, paddingHorizontal: SP.md, paddingBottom: SP.sm, gap: SP.sm },
  backBtn:      { width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  topTitle:     { flex: 1, fontSize: FS.md, fontFamily: FONT.bold, color: FG },
  openEditorBtn:{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: PURPLE_DIM, borderRadius: RADIUS.sm, paddingHorizontal: SP.sm, paddingVertical: 6, borderWidth: 1, borderColor: BORDER_ACTIVE },
  openEditorText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: PURPLE_LIGHT },

  section:      { paddingHorizontal: SP.md, paddingTop: SP.md },
  sectionLabel: { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: SP.sm },

  typePill:     { paddingHorizontal: SP.md, paddingVertical: 8, borderRadius: RADIUS.pill, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  typePillActive: { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE },
  typePillText: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },

  previewContainer: { paddingHorizontal: SP.md, paddingTop: SP.md },
  garmentPreview: { width: '100%', aspectRatio: 0.85, borderRadius: RADIUS.lg, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER, position: 'relative' },
  garmentLabel: { fontSize: FS.xxl, fontFamily: FONT.bold, letterSpacing: -0.5 },
  garmentViewLabel: { fontSize: FS.sm, fontFamily: FONT.medium, marginTop: 4 },

  zoneOverlay:  { position: 'absolute', borderRadius: RADIUS.xs, borderWidth: 2, borderColor: PURPLE, backgroundColor: PURPLE_DIM },
  safeAreaOverlay: { position: 'absolute', left: '8%', top: '8%', width: '84%', height: '84%', borderRadius: RADIUS.sm, borderWidth: 1.5, borderColor: SUCCESS, backgroundColor: 'rgba(16,185,129,0.12)', borderStyle: 'dashed' },
  embroideryOverlay: { position: 'absolute', left: '25%', top: '15%', width: '50%', height: '40%', borderRadius: RADIUS.sm, borderWidth: 1.5, borderColor: CYAN, backgroundColor: CYAN_DIM, borderStyle: 'dashed' },

  viewTabs:     { flexDirection: 'row', backgroundColor: CARD, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  viewTab:      { flex: 1, paddingVertical: SP.sm, alignItems: 'center', justifyContent: 'center' },
  viewTabActive:{ backgroundColor: PURPLE_DIM },
  viewTabText:  { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },

  colorGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  colorSwatch:  { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  colorSwatchActive: { borderColor: PURPLE_LIGHT, borderWidth: 2.5 },

  zoneGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: SP.xs },
  zoneChip:     { paddingHorizontal: SP.sm, paddingVertical: 7, borderRadius: RADIUS.pill, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  zoneChipActive: { backgroundColor: CYAN_DIM, borderColor: CYAN },
  zoneChipText: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },

  optionRow:    { flexDirection: 'row', gap: SP.sm },
  optionToggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SP.xs, padding: SP.sm, borderRadius: RADIUS.sm, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  optionToggleActive: { borderColor: BORDER_ACTIVE, backgroundColor: PURPLE_DIM },
  optionToggleText: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },

  savePlacementBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, backgroundColor: PURPLE, borderRadius: RADIUS.md, paddingVertical: SP.md, marginBottom: SP.sm },
  savePlacementText: { fontSize: FS.base, fontFamily: FONT.bold, color: '#FFFFFF' },
  openEditorLargeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, backgroundColor: PURPLE_DIM, borderRadius: RADIUS.md, paddingVertical: SP.md, borderWidth: 1, borderColor: BORDER_ACTIVE },
  openEditorLargeText: { fontSize: FS.base, fontFamily: FONT.semibold, color: PURPLE_LIGHT },
  });
};
