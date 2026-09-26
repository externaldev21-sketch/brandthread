/**
 * Design Export — /design-export  (modal)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, Dimensions,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, BLUE, ORANGE, GOLD,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import {
  BrandthreadCard, PrimaryButton, SecondaryButton,
  SectionHeader, StatusBadge,
} from '@/components/BrandthreadUI';
import { getProject, exportProject } from '@/services/designService';
import { DesignProject } from '@/services/designTypes';

const { width: SCREEN_W } = Dimensions.get('window');

interface FormatOption {
  id: string;
  label: string;
  desc: string;
  icon: keyof typeof Feather.glyphMap;
}

const FORMATS: FormatOption[] = [
  { id: 'png',       label: 'PNG',              desc: 'Raster, full quality',              icon: 'image' },
  { id: 'jpg',       label: 'JPG',              desc: 'Compressed, smaller file size',     icon: 'image' },
  { id: 'tpng',      label: 'Transparent PNG',  desc: 'No background (canvas transparency)', icon: 'layers' },
  { id: 'pdf',       label: 'PDF',              desc: 'Print-ready layout export',         icon: 'file-text' },
  { id: 'project',   label: 'Project File',     desc: 'Save editable copy of project',    icon: 'save' },
];

interface SizeOption {
  id: string;
  label: string;
  desc: string;
}

const SIZES: SizeOption[] = [
  { id: 'original',  label: 'Original',        desc: 'Canvas dimensions' },
  { id: 'web',       label: 'Web',             desc: '72 DPI optimized' },
  { id: 'product',   label: 'Product Page',    desc: '2000 × 2000 px' },
  { id: 'story',     label: 'Story',           desc: '1080 × 1920' },
  { id: 'thread',    label: 'Thread Post',     desc: '1080 × 1350' },
  { id: 'print',     label: 'Print',           desc: '300 DPI, scales to print size' },
];

export default function DesignExportScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT, secondary: CYAN } = theme;
  const styles = createStyles(theme);
  const router   = useRouter();
  const insets   = useSafeAreaInsets();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();

  const [project, setProject]       = useState<DesignProject | null>(null);
  const [loading, setLoading]       = useState(true);
  const [selectedFormat, setSelectedFormat] = useState<string>('png');
  const [selectedSize, setSelectedSize]     = useState<string>('original');
  const [exporting, setExporting]   = useState(false);

  useEffect(() => {
    if (!projectId) { setLoading(false); return; }
    getProject(projectId).then(p => { setProject(p); setLoading(false); });
  }, [projectId]);

  const handleExport = useCallback(async () => {
    if (!project) {
      Alert.alert('No project', 'No project loaded to export.');
      return;
    }
    setExporting(true);
    try {
      await exportProject(project.id, 'png');
      Alert.alert('Export complete!', 'File saved to your device.');
    } catch {
      Alert.alert('Error', 'Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }, [project]);

  const selectFormat = (id: string) => {
    Haptics.selectionAsync();
    setSelectedFormat(id);
  };

  const selectSize = (id: string) => {
    Haptics.selectionAsync();
    setSelectedSize(id);
  };

  if (loading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={PURPLE} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Export</Text>
        <TouchableOpacity onPress={() => goBackOr(router)} style={styles.closeBtn}>
          <Feather name="x" size={ICON.md} color={FG} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

        {/* Preview thumbnail */}
        <View style={styles.thumbWrap}>
          <LinearGradient
            colors={theme.primaryGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.thumb}
          >
            <Text style={styles.thumbLabel}>{project?.name ?? 'Untitled'}</Text>
            <Text style={styles.thumbSub}>
              {project ? `${project.canvas.width} × ${project.canvas.height}` : '–'}
            </Text>
          </LinearGradient>
        </View>

        {/* Format cards */}
        <SectionHeader title="Format" style={styles.sectionHeader} />
        {FORMATS.map(fmt => (
          <TouchableOpacity
            key={fmt.id}
            onPress={() => selectFormat(fmt.id)}
            activeOpacity={0.8}
          >
            <BrandthreadCard
              style={[styles.formatCard, selectedFormat === fmt.id && styles.formatCardActive]}
            >
              <View style={styles.formatRow}>
                <View style={[styles.formatIcon, selectedFormat === fmt.id && { backgroundColor: PURPLE_DIM }]}>
                  <Feather name={fmt.icon} size={18} color={selectedFormat === fmt.id ? PURPLE_LIGHT : MUTED} />
                </View>
                <View style={styles.formatInfo}>
                  <Text style={[styles.formatLabel, selectedFormat === fmt.id && { color: PURPLE_LIGHT }]}>
                    {fmt.label}
                  </Text>
                  <Text style={styles.formatDesc}>{fmt.desc}</Text>
                </View>
                {selectedFormat === fmt.id && (
                  <Feather name="check-circle" size={18} color={PURPLE_LIGHT} />
                )}
              </View>
            </BrandthreadCard>
          </TouchableOpacity>
        ))}

        {/* Size options */}
        <SectionHeader title="Size" style={styles.sectionHeader} />
        {SIZES.map(sz => (
          <TouchableOpacity
            key={sz.id}
            onPress={() => selectSize(sz.id)}
            activeOpacity={0.8}
          >
            <BrandthreadCard
              style={[styles.sizeCard, selectedSize === sz.id && styles.formatCardActive]}
            >
              <View style={styles.sizeRow}>
                <View style={[styles.radio, selectedSize === sz.id && styles.radioActive]}>
                  {selectedSize === sz.id && <View style={styles.radioDot} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sizeLabel, selectedSize === sz.id && { color: PURPLE_LIGHT }]}>
                    {sz.label}
                  </Text>
                  <Text style={styles.sizeDesc}>{sz.desc}</Text>
                </View>
              </View>
            </BrandthreadCard>
          </TouchableOpacity>
        ))}

        {/* Color space note */}
        <BrandthreadCard style={styles.noteCard}>
          <View style={styles.noteRow}>
            <Feather name="info" size={14} color={CYAN} />
            <Text style={styles.noteText}>
              RGB for digital. CMYK note included in print exports.
            </Text>
          </View>
        </BrandthreadCard>

        {/* Export button */}
        <View style={styles.exportWrap}>
          {exporting ? (
            <ActivityIndicator color={PURPLE} style={{ marginBottom: SP.sm }} />
          ) : (
            <PrimaryButton label="Export" onPress={handleExport} style={styles.exportBtn} />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const { accent: PURPLE, accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT } = theme;
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  scrollContent: { paddingBottom: 120, paddingHorizontal: SP.md },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, paddingVertical: SP.sm,
  },
  headerTitle: { fontSize: FS.md, fontFamily: FONT.bold, color: FG },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  thumbWrap: { alignItems: 'center', marginBottom: SP.md, marginTop: SP.sm },
  thumb: {
    width: SCREEN_W - SP.md * 2, height: 160,
    borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center',
  },
  thumbLabel: { fontSize: FS.lg, fontFamily: FONT.bold, color: '#FFF' },
  thumbSub: { fontSize: FS.sm, fontFamily: FONT.regular, color: 'rgba(255,255,255,0.7)', marginTop: 4 },

  sectionHeader: { marginTop: SP.lg, marginBottom: SP.sm },

  formatCard: { marginBottom: SP.sm },
  formatCardActive: { borderColor: BORDER_ACTIVE },
  formatRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  formatIcon: {
    width: 36, height: 36, borderRadius: RADIUS.sm,
    backgroundColor: CARD_ELEVATED, alignItems: 'center', justifyContent: 'center',
  },
  formatInfo: { flex: 1 },
  formatLabel: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  formatDesc: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },

  sizeCard: { marginBottom: SP.sm },
  sizeRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md },
  radio: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 2, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  radioActive: { borderColor: PURPLE },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: PURPLE },
  sizeLabel: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  sizeDesc: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },

  noteCard: { marginTop: SP.sm },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  noteText: { flex: 1, fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },

  exportWrap: { marginTop: SP.lg },
  exportBtn: {},
  });
};
