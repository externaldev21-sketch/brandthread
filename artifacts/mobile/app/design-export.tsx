/**
 * Design Export — /design-export?projectId=<id>
 *
 * Reached from the Design Studio canvas's Export sheet ("More formats &
 * sizes"). Renders the project's layers into an off-screen SVG at the exact
 * output size (react-native-svg toDataURL, the same capture design-canvas uses
 * for its own PNG export), then:
 *   - PNG / Transparent PNG / JPG → saved to Photos (native) or downloaded (web)
 *   - PDF → one-page PDF via expo-print, handed to the share sheet
 *   - Project file → the project JSON, handed to the share sheet / downloaded
 * Every outcome is reported as what actually happened; failures say so.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, Dimensions, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { File, Paths, EncodingType } from 'expo-file-system';
import Svg, { Rect } from 'react-native-svg';
import {
  CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED,
  FONT, FS, SP, RADIUS, COMP,
} from '@/lib/theme';
import {
  BrandthreadCard, PrimaryButton,
  SectionHeader,
} from '@/components/BrandthreadUI';
import DesignLayerCompositor, { renderLayer } from '@/components/DesignLayerCompositor';
import { getProject, updateProject } from '@/services/designService';
import { DesignProject } from '@/services/designTypes';
import { saveImageToCameraRoll, triggerWebDownload } from '@/lib/aiToolMedia';
import {
  buildDesignPdfHtml, exportFileName, resolveExportDimensions,
  type DesignExportFormat, type DesignExportSize,
} from '@/lib/designExport';

const { width: SCREEN_W } = Dimensions.get('window');

interface FormatOption {
  id: DesignExportFormat;
  label: string;
  desc: string;
  icon: keyof typeof Feather.glyphMap;
}

const FORMATS: FormatOption[] = [
  { id: 'png',       label: 'PNG',              desc: 'Lossless, saves to Photos',           icon: 'image' },
  { id: 'jpg',       label: 'JPG',              desc: 'Compressed, smaller file size',       icon: 'image' },
  { id: 'tpng',      label: 'Transparent PNG',  desc: 'Layers only, no canvas background',   icon: 'layers' },
  { id: 'pdf',       label: 'PDF',              desc: 'One page, opens the share sheet',     icon: 'file-text' },
  { id: 'project',   label: 'Project File',     desc: 'Editable project data (.json)',       icon: 'save' },
];

interface SizeOption {
  id: DesignExportSize;
  label: string;
  desc: string;
}

const SIZES: SizeOption[] = [
  { id: 'original',  label: 'Original',        desc: 'Canvas dimensions' },
  { id: 'web',       label: 'Web',             desc: 'Fits within 1200 × 1200' },
  { id: 'product',   label: 'Product Page',    desc: 'Fits within 2000 × 2000' },
  { id: 'story',     label: 'Story',           desc: 'Fits within 1080 × 1920' },
  { id: 'thread',    label: 'Thread Post',     desc: 'Fits within 1080 × 1350' },
  { id: 'print',     label: 'Print',           desc: '3× canvas size (max 4096 px)' },
];

/** Render the project's layers to a base64 PNG at exactly width × height. */
function svgToPngBase64(svg: any, width: number, height: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!svg || typeof svg.toDataURL !== 'function') {
      reject(new Error('Export renderer is not ready.'));
      return;
    }
    try {
      svg.toDataURL((b64: string) => {
        if (!b64) reject(new Error('The export came back empty.'));
        else resolve(b64.replace(/^data:image\/png;base64,/, ''));
      }, { width, height });
    } catch (err) {
      reject(err);
    }
  });
}

function writeCacheFile(name: string, contents: string, base64: boolean): string {
  const file = new File(Paths.cache, `${Date.now()}_${name}`);
  if (base64) file.write(contents, { encoding: EncodingType.Base64 });
  else file.write(contents);
  return file.uri;
}

export default function DesignExportScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT, secondary: CYAN } = theme;
  const styles = createStyles(theme);
  const router   = useRouter();
  const headerTopInset = useHeaderTopInset();
  const insets = useSafeAreaInsets();
  // This screen keeps the persistent seller tab bar (a normal card-pushed
  // screen, not a full-screen flow) but scrollContent's paddingBottom was a
  // flat guess (120) that didn't account for the device's actual safe-area
  // inset — the audit caught it overlapping the tab bar's cart badge.
  const tabBarClearance = Math.max(insets.bottom, SP.md) + COMP.tabBarH + SP.md;
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();

  const [project, setProject]       = useState<DesignProject | null>(null);
  const [loading, setLoading]       = useState(true);
  const [loadError, setLoadError]   = useState<string | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<DesignExportFormat>('png');
  const [selectedSize, setSelectedSize]     = useState<DesignExportSize>('original');
  const [exporting, setExporting]   = useState(false);
  const exportSvgRef = useRef<any>(null);

  useEffect(() => {
    if (!projectId) {
      setLoadError('Open a project in Design Studio, then choose Export.');
      setLoading(false);
      return;
    }
    getProject(projectId)
      .then(p => {
        setProject(p);
        if (!p) setLoadError('This project could not be found on this device.');
      })
      .catch(() => setLoadError('Could not load this project. Please try again.'))
      .finally(() => setLoading(false));
  }, [projectId]);

  const dims = useMemo(
    () => project
      ? resolveExportDimensions(project.canvas.width, project.canvas.height, selectedSize)
      : { width: 0, height: 0 },
    [project, selectedSize],
  );
  const transparent = selectedFormat === 'tpng';
  const exportLayers = useMemo(
    () => [...(project?.layers ?? [])].filter(l => !l.isTemplate).sort((a, b) => a.order - b.order),
    [project],
  );

  const handleExport = useCallback(async () => {
    if (!project) {
      Alert.alert('No project', 'No project loaded to export.');
      return;
    }
    setExporting(true);
    const fileName = exportFileName(project.name, selectedFormat);
    try {
      // ── Project file: the editable project data itself ──
      if (selectedFormat === 'project') {
        const json = JSON.stringify(project, null, 2);
        if (Platform.OS === 'web') {
          triggerWebDownload(`data:application/json;charset=utf-8,${encodeURIComponent(json)}`, fileName);
          Alert.alert('Project downloaded', `${fileName} was downloaded.`);
        } else {
          const uri = writeCacheFile(fileName, json, false);
          if (!(await Sharing.isAvailableAsync())) {
            Alert.alert('Sharing unavailable', 'This device can’t open the share sheet, so the project file was not saved.');
            return;
          }
          await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: `Save ${fileName}`, UTI: 'public.json' });
        }
        return;
      }

      // ── Image-based formats: render the layers at the exact output size ──
      const pngBase64 = await svgToPngBase64(exportSvgRef.current, dims.width, dims.height);
      const pngDataUrl = `data:image/png;base64,${pngBase64}`;

      if (selectedFormat === 'pdf') {
        const html = buildDesignPdfHtml(pngDataUrl, dims.width, dims.height);
        if (Platform.OS === 'web') {
          // Browsers have no file API here — open the print dialog, where
          // "Save as PDF" is the save step.
          await Print.printAsync({ html });
          return;
        }
        const { uri } = await Print.printToFileAsync({ html, width: dims.width, height: dims.height });
        if (!(await Sharing.isAvailableAsync())) {
          Alert.alert('Sharing unavailable', 'This device can’t open the share sheet, so the PDF was not saved.');
          return;
        }
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Save ${fileName}`, UTI: 'com.adobe.pdf' });
        return;
      }

      let imageUri: string;
      if (selectedFormat === 'jpg') {
        const source = Platform.OS === 'web' ? pngDataUrl : writeCacheFile(exportFileName(project.name, 'png'), pngBase64, true);
        const jpg = await manipulateAsync(source, [], { compress: 0.92, format: SaveFormat.JPEG, base64: Platform.OS === 'web' });
        imageUri = Platform.OS === 'web' && jpg.base64 ? `data:image/jpeg;base64,${jpg.base64}` : jpg.uri;
      } else {
        imageUri = Platform.OS === 'web' ? pngDataUrl : writeCacheFile(fileName, pngBase64, true);
      }

      if (Platform.OS === 'web') {
        triggerWebDownload(imageUri, fileName);
        Alert.alert('Design downloaded', `${fileName} (${dims.width} × ${dims.height}) was downloaded.`);
      } else {
        const saved = await saveImageToCameraRoll(imageUri, 'design');
        if (!saved.ok) {
          Alert.alert(
            saved.reason === 'permission' ? 'Permission required' : saved.reason === 'unavailable' ? 'Photos unavailable' : 'Export failed',
            saved.reason === 'permission'
              ? 'Allow photo library access to save this design.'
              : saved.reason === 'unavailable'
                ? 'Saving to Photos isn’t available in this app build.'
                : 'Couldn’t save your design. Try again.',
          );
          return;
        }
        Alert.alert('Saved to Photos', `${fileName} (${dims.width} × ${dims.height}) was saved to your photo library.`);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // Best effort: reflect the export on the project card.
      if (project.status !== 'exported') void updateProject(project.id, { status: 'exported' }).catch(() => {});
    } catch {
      Alert.alert('Export failed', 'Couldn’t export your design. Nothing was saved — please try again.');
    } finally {
      setExporting(false);
    }
  }, [project, selectedFormat, dims]);

  const selectFormat = (id: DesignExportFormat) => {
    Haptics.selectionAsync();
    setSelectedFormat(id);
  };

  const selectSize = (id: DesignExportSize) => {
    Haptics.selectionAsync();
    setSelectedSize(id);
  };

  if (loading) {
    return (
      <View style={[styles.root, { paddingTop: headerTopInset, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={PURPLE} />
      </View>
    );
  }

  const previewSize = Math.min(SCREEN_W - SP.md * 2, 220);
  const canvasW = project?.canvas.width || 1080;
  const canvasH = project?.canvas.height || 1080;
  const bgHex = project?.canvas.backgroundHex || theme.card;
  const previewProject = project && transparent
    ? { ...project, canvas: { ...project.canvas, backgroundHex: 'transparent' } }
    : project;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Export" variant="modal" onBack={() => goBackOr(router)} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarClearance }]}>

        {/* Preview — the project's real layers */}
        <View style={styles.thumbWrap}>
          {previewProject ? (
            <DesignLayerCompositor project={previewProject} displaySize={previewSize} borderRadius={RADIUS.md} />
          ) : (
            <BrandthreadCard style={styles.missingCard}>
              <Feather name="alert-circle" size={18} color={MUTED} />
              <Text style={styles.formatDesc}>{loadError ?? 'No project loaded.'}</Text>
            </BrandthreadCard>
          )}
          <Text style={styles.thumbSub}>
            {project ? `${project.name} · exports at ${dims.width} × ${dims.height}` : '–'}
          </Text>
        </View>

        {/* Off-screen renderer; toDataURL rasterises it at the exact output size. */}
        {project && dims.width > 0 && (
          <View style={styles.offscreen} pointerEvents="none">
            <Svg ref={exportSvgRef} width={dims.width} height={dims.height} viewBox={`0 0 ${canvasW} ${canvasH}`}>
              {!transparent && bgHex !== 'transparent' && (
                <Rect x={0} y={0} width={canvasW} height={canvasH} fill={bgHex} />
              )}
              {exportLayers.map(layer => renderLayer(layer, 1, 1, transparent ? 'transparent' : bgHex))}
            </Svg>
          </View>
        )}

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
              Exports are RGB. Ask your print shop if they need CMYK.
            </Text>
          </View>
        </BrandthreadCard>

        {/* Export button */}
        <View style={styles.exportWrap}>
          {exporting ? (
            <ActivityIndicator color={PURPLE} style={{ marginBottom: SP.sm }} />
          ) : (
            <PrimaryButton label="Export" onPress={handleExport} disabled={!project} style={styles.exportBtn} />
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
  scrollContent: { paddingHorizontal: SP.md },

  thumbWrap: { alignItems: 'center', marginBottom: SP.md, marginTop: SP.sm },
  thumbSub: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginTop: SP.sm },
  missingCard: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  offscreen: { position: 'absolute', left: -10000, top: 0, width: 1, height: 1, overflow: 'hidden', opacity: 0 },

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
