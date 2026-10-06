/**
 * Brandthread Design Studio — Garment Design Mode
 * Route: /design-garment?projectId=<id>&garmentType=tshirt&garmentColor=#FFFFFF
 */
import React, { useState, useEffect } from 'react';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Ellipse, Rect, Line } from 'react-native-svg';
import { Feather } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  BG, SURFACE, CARD, CARD_ELEVATED,
  BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE,
  SUCCESS, SUCCESS_DIM,
  FONT, FS, SP, RADIUS, ICON, COMP,
} from '@/lib/theme';
import { getProject, updateProject } from '@/services/designService';
import { GARMENT_TYPES, GARMENT_TEMPLATES, GARMENT_VIEWS } from '@/services/designTypes';

function viewLabel(view: string): string {
  return GARMENT_VIEWS.find(v => v.value === view)?.label ?? view;
}

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

// ─── Garment silhouette ───────────────────────────────────────────────────
// A real vector garment outline, tinted by the selected color — not a flat
// colored card with a text label. Front/back share the same body silhouette
// (accurate to how a real garment looks from either side) with a small
// front-only or back-only detail (collar tag vs. neck seam) so the two
// views are still visually distinct; "detail" zooms into the chest/pocket
// area via a tighter viewBox, mimicking a close-up product shot.
// All paths sit on a shared 200×240 canvas.

const GARMENT_STROKE = 'rgba(0,0,0,0.22)';

function torsoBodyPath(sleeveLength: number): string {
  // Crew-neck tee/sweatshirt/jacket body: shoulders → sleeve → underarm →
  // hem → mirrored back up the other side, with a shallow front neckline.
  // Real tee proportions: body width 80 (shoulder-to-shoulder, x 60–140),
  // height 96 — 1.2× the width, y 40 (neckline) to 136 (hem). The previous
  // path was ~64 wide by ~192 tall (a 1:3 column), which read as a dress,
  // not a T-shirt.
  const s = sleeveLength; // how far the sleeve extends past the shoulder
  return `M 75 40
    C 80 33, 120 33, 125 40
    L 140 48
    L ${140 + s} 66
    L ${132 + s} 84
    L 140 92
    L 140 136
    L 60 136
    L 60 92
    L ${68 - s} 84
    L ${60 - s} 66
    L 60 48
    Z`;
}

function GarmentSilhouette({ type, view, colorHex }: { type: string; view: string; colorHex: string }) {
  const isDetail = view === 'detail';
  const isBack = view === 'back';
  const viewBox = isDetail ? '65 45 70 60' : '0 0 200 240';
  const fill = colorHex;
  const isPants = type === 'sweatpants' || type === 'shorts';
  const isHat = type === 'hat';
  const isBag = type === 'bag';
  const isBoxy = type === 'packaging';

  return (
    <Svg width="72%" height="72%" viewBox={viewBox} preserveAspectRatio="xMidYMid meet">
      {isHat ? (
        <>
          <Path d="M 40 130 C 40 80, 75 45, 100 45 C 125 45, 160 80, 160 130 Z" fill={fill} stroke={GARMENT_STROKE} strokeWidth={2} />
          <Ellipse cx={100} cy={132} rx={72} ry={14} fill={fill} stroke={GARMENT_STROKE} strokeWidth={2} />
        </>
      ) : isBag ? (
        <>
          <Path d="M 55 90 L 145 90 L 155 205 L 45 205 Z" fill={fill} stroke={GARMENT_STROKE} strokeWidth={2} />
          <Path d="M 75 90 C 75 60, 125 60, 125 90" fill="none" stroke={GARMENT_STROKE} strokeWidth={4} />
        </>
      ) : isBoxy ? (
        <>
          <Rect x={45} y={70} width={110} height={110} fill={fill} stroke={GARMENT_STROKE} strokeWidth={2} />
          <Path d="M 45 70 L 100 40 L 155 70" fill="none" stroke={GARMENT_STROKE} strokeWidth={2} />
          <Path d="M 100 40 L 100 180" fill="none" stroke={GARMENT_STROKE} strokeWidth={1.5} opacity={0.5} />
        </>
      ) : isPants ? (
        <>
          <Path
            d="M 62 20 L 138 20 L 142 100 L 116 220 L 100 220 L 100 130 L 84 220 L 68 220 L 58 100 Z"
            fill={fill}
            stroke={GARMENT_STROKE}
            strokeWidth={2}
          />
          <Line x1={72} y1={20} x2={72} y2={95} stroke={GARMENT_STROKE} strokeWidth={1} opacity={0.4} />
          <Line x1={128} y1={20} x2={128} y2={95} stroke={GARMENT_STROKE} strokeWidth={1} opacity={0.4} />
        </>
      ) : (
        <>
          <Path
            d={torsoBodyPath(type === 'tank' ? 2 : type === 'longsleeve' ? 30 : 16)}
            fill={fill}
            stroke={GARMENT_STROKE}
            strokeWidth={2}
          />
          {type === 'hoodie' && (
            <Path d="M 76 20 C 76 2, 124 2, 124 20 C 124 30, 112 30, 100 34 C 88 30, 76 30, 76 20 Z" fill={fill} stroke={GARMENT_STROKE} strokeWidth={2} />
          )}
          {!isBack && (type === 'jacket' || type === 'denim') && (
            <Line x1={100} y1={44} x2={100} y2={136} stroke={GARMENT_STROKE} strokeWidth={2} opacity={0.6} />
          )}
          {!isBack && type !== 'jacket' && type !== 'denim' && (
            <Path d="M 88 40 Q 100 52 112 40" fill="none" stroke={GARMENT_STROKE} strokeWidth={2} opacity={0.55} />
          )}
          {isBack && (
            <Line x1={100} y1={40} x2={100} y2={136} stroke={GARMENT_STROKE} strokeWidth={1.5} opacity={0.35} />
          )}
          {type === 'hoodie' && (
            <Path d="M 92 64 L 108 64 L 108 96 L 100 104 L 92 96 Z" fill="none" stroke={GARMENT_STROKE} strokeWidth={1.5} opacity={0.5} />
          )}
        </>
      )}
    </Svg>
  );
}

export default function DesignGarmentScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  const gs = createStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string; garmentType?: string; garmentColor?: string }>();

  const [garmentType, setGarmentType] = useState(params.garmentType ?? 'tshirt');
  const [garmentColor, setGarmentColor] = useState(params.garmentColor ?? '#FFFFFF');
  const [currentView, setCurrentView] = useState('front');
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [showEmbroidery, setShowEmbroidery] = useState(false);
  const [saving, setSaving] = useState(false);

  const projectId = params.projectId ?? '';
  const template = GARMENT_TEMPLATES.find(t => t.garmentType === garmentType)
    ?? GARMENT_TEMPLATES.find(t => t.garmentType === 'tshirt')!;
  const availableViews = template.views;
  const availableZones = PLACEMENT_ZONES_ALL;

  // Reset view when garment type changes
  useEffect(() => {
    if (!(availableViews as string[]).includes(currentView)) {
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

  // The canvas takes its garment view from the saved project
  // (project.garmentView), not from the URL, so save the chosen view first —
  // otherwise picking "Back" and opening the editor showed the front.
  async function openInEditor() {
    if (projectId) {
      await updateProject(projectId, { garmentView: currentView } as any).catch(() => {});
    }
    router.push(`/design-canvas?id=${projectId}&garmentView=${currentView}` as any);
  }

  // Determine if garment is light or dark for text contrast
  const isDarkGarment = ['#000000', '#1E3A5F', '#6B7280', '#EF4444', '#3B82F6', '#0F766E', '#22C55E', '#F97316', '#EC4899'].includes(garmentColor);

  return (
    <View style={gs.root}>
      <ScreenHeader
        title="Garment Design"
        onBack={() => goBackOr(router)}
        actions={[{
          icon: 'edit-2',
          onPress: openInEditor,
          accessibilityLabel: 'Open in editor',
        }]}
      />

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
          <View style={gs.garmentPreview}>
            {/* Real vector garment mockup, tinted by the selected color —
                not a flat color card with a text label standing in for it. */}
            <GarmentSilhouette type={garmentType} view={currentView} colorHex={garmentColor} />
            <View style={gs.garmentCaption}>
              <Text style={gs.garmentCaptionText}>
                {garmentLabel(garmentType)} · {viewLabel(currentView)}
              </Text>
            </View>

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
                <Text style={[gs.viewTabText, currentView === view && { color: '#000000', fontFamily: FONT.bold }]}>{viewLabel(view)}</Text>
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
        {/* This screen keeps the persistent seller tab bar — its own real
            44px+ tall floating capsule, not just the safe-area inset. A
            flat `insets.bottom + SP.xl` guess left the last section (and,
            above it, Garment Color's swatch row) sitting under the bar
            instead of clearing it. */}
        <View style={[gs.section, { paddingBottom: Math.max(insets.bottom, SP.md) + COMP.tabBarH + SP.md }]}>
          <TouchableOpacity
            style={gs.savePlacementBtn}
            onPress={handleSavePlacement}
            disabled={saving}
            activeOpacity={0.85}
          >
            <Feather name="save" size={ICON.sm} color="#000000" />
            <Text style={gs.savePlacementText}>{saving ? 'Saving…' : 'Save Placement'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={gs.openEditorLargeBtn}
            onPress={openInEditor}
            activeOpacity={0.85}
          >
            <Feather name="edit-2" size={ICON.sm} color={FG} />
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
  root:         { flex: 1, backgroundColor: 'transparent' },

  section:      { paddingHorizontal: SP.md, paddingTop: SP.md },
  sectionLabel: { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: SP.sm },

  typePill:     { paddingHorizontal: SP.md, paddingVertical: 8, borderRadius: RADIUS.pill, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  typePillActive: { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE },
  typePillText: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },

  previewContainer: { paddingHorizontal: SP.md, paddingTop: SP.md },
  // A near-square (0.85) preview card left almost nothing above the fold
  // for Garment Color once View/Type picker chrome was accounted for — the
  // swatch row landed right at the floating tab bar on first load, not
  // just at the very end of scroll. Shorter card gives real headroom.
  garmentPreview: { width: '100%', aspectRatio: 1.35, borderRadius: RADIUS.lg, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER, position: 'relative', backgroundColor: CARD_ELEVATED },
  garmentCaption: { position: 'absolute', bottom: SP.md, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: RADIUS.pill, paddingHorizontal: SP.md, paddingVertical: 6 },
  garmentCaptionText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: '#FFFFFF' },

  zoneOverlay:  { position: 'absolute', borderRadius: RADIUS.xs, borderWidth: 2, borderColor: PURPLE, backgroundColor: PURPLE_DIM },
  safeAreaOverlay: { position: 'absolute', left: '8%', top: '8%', width: '84%', height: '84%', borderRadius: RADIUS.sm, borderWidth: 1.5, borderColor: SUCCESS, backgroundColor: 'rgba(16,185,129,0.12)', borderStyle: 'dashed' },
  embroideryOverlay: { position: 'absolute', left: '25%', top: '15%', width: '50%', height: '40%', borderRadius: RADIUS.sm, borderWidth: 1.5, borderColor: CYAN, backgroundColor: CYAN_DIM, borderStyle: 'dashed' },

  viewTabs:     { flexDirection: 'row', backgroundColor: CARD, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  viewTab:      { flex: 1, paddingVertical: SP.sm, alignItems: 'center', justifyContent: 'center' },
  // Monochrome rule: the selected segment is a solid white fill with black
  // text, not a tinted grey pill.
  viewTabActive:{ backgroundColor: FG },
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

  // PURPLE resolves to white (#FFFFFF) in the monochrome theme — that's
  // the intended white primary-button fill, but the label/icon must be
  // black on it, not white-on-white.
  savePlacementBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, backgroundColor: PURPLE, borderRadius: RADIUS.md, paddingVertical: SP.md, marginBottom: SP.sm },
  savePlacementText: { fontSize: FS.base, fontFamily: FONT.bold, color: '#000000' },
  // Black fill + a 1px white border, not a translucent white wash — same
  // "translucency reads as grey once real content is behind it" issue as
  // the canvas sliders, and the monochrome rule bans grey fills outright.
  openEditorLargeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, backgroundColor: '#000000', borderRadius: RADIUS.md, paddingVertical: SP.md, borderWidth: 1, borderColor: FG },
  openEditorLargeText: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  });
};
