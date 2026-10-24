/**
 * Design Export — /design-export?projectId=…  (card)
 *
 * Renders the project's layers into an SVG framed at the chosen size, captures
 * it at exact output pixels (react-native-svg toDataURL — the same capture the
 * canvas editor uses), then:
 *   - web:    downloads the PNG / JPEG file
 *   - native: saves PNG / JPEG to Photos (falling back to the share sheet when
 *             Photos access isn't available), or shares a PDF
 * The status line only says a file was saved/downloaded after it really was.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, Dimensions, Platform, Image as RNImage,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Svg, { Rect } from 'react-native-svg';
import { File, Paths, EncodingType } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED,
  FONT, FS, SP, RADIUS, COMP,
} from '@/lib/theme';
import {
  BrandthreadCard, PrimaryButton, SectionHeader, EmptyState,
} from '@/components/BrandthreadUI';
import { renderLayer } from '@/components/DesignLayerCompositor';
import { getProject } from '@/services/designService';
import { DesignProject } from '@/services/designTypes';
import { saveImageToMediaLibrary } from '@/lib/mediaLibraryAdapter';
import { mediaLibraryUnavailableMessage } from '@/lib/mediaLibraryCompat';
import { triggerWebImageDownload } from '@/lib/shareCard';
import {
  clampJpegQuality, MASTER_JPEG_QUALITY, verifyExportDimensionsNative,
  verifyExportDimensionsWeb, type MasterDescriptor,
} from '@/lib/designExportPolicy';
import {
  DESIGN_EXPORT_FORMATS, DESIGN_EXPORT_SIZES, exportFileName, fitCanvasViewBox,
  getExportFormat, resolveExportPixels,
  type DesignExportFormatId, type DesignExportSizeId,
} from '@/lib/designExportPresets';

const { width: SCREEN_W } = Dimensions.get('window');
const PREVIEW_MAX_H = 220;
const PDF_POINTS_PER_PIXEL = 72 / 300; // PDF page sized as the export at 300 DPI

type ExportStatus = { kind: 'idle' } | { kind: 'done'; message: string } | { kind: 'error'; message: string };

function captureSvgPngBase64(svg: Svg | null, width: number, height: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!svg || typeof svg.toDataURL !== 'function') {
      reject(new Error('Preview is not ready yet.'));
      return;
    }
    svg.toDataURL((b64: string) => {
      if (!b64) reject(new Error('Capture returned no image data.'));
      else resolve(b64);
    }, { width, height });
  });
}

function webJpegDataUrl(pngDataUrl: string, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) { reject(new Error('JPEG encoding is unavailable in this browser.')); return; }
      context.drawImage(image, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    image.onerror = () => reject(new Error('Could not prepare the image for JPEG export.'));
    image.src = pngDataUrl;
  });
}

export default function DesignExportScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT, secondary: CYAN } = theme;
  const styles = createStyles(theme);
  const router   = useRouter();
  const insets = useSafeAreaInsets();
  // This screen keeps the persistent seller tab bar (a normal card-pushed
  // screen, not a full-screen flow) but scrollContent's paddingBottom was a
  // flat guess (120) that didn't account for the device's actual safe-area
  // inset — the audit caught it overlapping the tab bar's cart badge.
  const tabBarClearance = Math.max(insets.bottom, SP.md) + COMP.tabBarH + SP.md;
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();

  const [project, setProject]       = useState<DesignProject | null>(null);
  const [loading, setLoading]       = useState(Boolean(projectId));
  const [selectedFormat, setSelectedFormat] = useState<DesignExportFormatId>('png');
  const [selectedSize, setSelectedSize]     = useState<DesignExportSizeId>('original');
  const [exporting, setExporting]   = useState(false);
  const [status, setStatus]         = useState<ExportStatus>({ kind: 'idle' });
  const svgRef = useRef<Svg>(null);

  useEffect(() => {
    if (!projectId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    getProject(projectId)
      .then(p => { if (!cancelled) setProject(p); })
      .catch(() => { if (!cancelled) setProject(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  const format = getExportFormat(selectedFormat);
  const canvasW = project?.canvas.width || 1080;
  const canvasH = project?.canvas.height || 1080;
  const output = useMemo(
    () => resolveExportPixels(selectedSize, canvasW, canvasH),
    [selectedSize, canvasW, canvasH],
  );
  const viewBox = useMemo(
    () => fitCanvasViewBox(canvasW, canvasH, output.width, output.height),
    [canvasW, canvasH, output.width, output.height],
  );
  const previewScale = Math.min((SCREEN_W - SP.md * 2) / output.width, PREVIEW_MAX_H / output.height);
  const previewW = Math.max(1, Math.round(output.width * previewScale));
  const previewH = Math.max(1, Math.round(output.height * previewScale));
  const formatUnavailable = format.nativeOnly && Platform.OS === 'web';

  const handleExport = useCallback(async () => {
    if (!project || exporting) return;
    if (formatUnavailable) {
      setStatus({ kind: 'error', message: `${format.label} export is available in the iOS and Android app.` });
      return;
    }
    setExporting(true);
    setStatus({ kind: 'idle' });
    const desc: MasterDescriptor = { width: output.width, height: output.height, cropX: 0, cropY: 0, hasCrop: false };
    const fileName = exportFileName(project.name, selectedSize, format);
    const dims = `${output.width} × ${output.height}`;
    try {
      const pngBase64 = await captureSvgPngBase64(svgRef.current, output.width, output.height);

      if (Platform.OS === 'web') {
        let dataUrl = `data:image/png;base64,${pngBase64}`;
        if (format.id === 'jpg') dataUrl = await webJpegDataUrl(dataUrl, clampJpegQuality(MASTER_JPEG_QUALITY));
        await verifyExportDimensionsWeb(dataUrl, desc);
        triggerWebImageDownload(dataUrl, fileName);
        setStatus({ kind: 'done', message: `Downloaded ${fileName} (${dims}).` });
        return;
      }

      const pngFile = new File(Paths.cache, `${Date.now()}_${fileName.replace(/\.\w+$/, '.png')}`);
      pngFile.write(pngBase64, { encoding: EncodingType.Base64 });

      if (format.id === 'pdf') {
        const page = {
          width: Math.round(output.width * PDF_POINTS_PER_PIXEL),
          height: Math.round(output.height * PDF_POINTS_PER_PIXEL),
        };
        const { uri: pdfUri } = await Print.printToFileAsync({
          html: `<html><body style="margin:0"><img src="data:image/png;base64,${pngBase64}" style="display:block;width:100%;height:100%" /></body></html>`,
          width: page.width,
          height: page.height,
        });
        try { pngFile.delete(); } catch { /* best-effort */ }
        if (!(await Sharing.isAvailableAsync())) {
          setStatus({ kind: 'error', message: 'Sharing is not available on this device, so the PDF could not be saved.' });
          return;
        }
        await Sharing.shareAsync(pdfUri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: fileName });
        setStatus({ kind: 'done', message: `PDF (${dims}) ready — saved wherever you chose in the share sheet.` });
        return;
      }

      let fileUri = pngFile.uri;
      if (format.id === 'jpg') {
        const jpeg = await ImageManipulator.manipulateAsync(
          fileUri,
          [], // no resize — the capture is already at exact output size
          { compress: clampJpegQuality(MASTER_JPEG_QUALITY), format: ImageManipulator.SaveFormat.JPEG },
        );
        try { pngFile.delete(); } catch { /* best-effort */ }
        fileUri = jpeg.uri;
      }
      await verifyExportDimensionsNative(fileUri, desc, RNImage.getSize.bind(RNImage));

      const saved = await saveImageToMediaLibrary(fileUri);
      if (saved === 'saved') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setStatus({ kind: 'done', message: `Saved ${format.label} (${dims}) to Photos.` });
        return;
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: format.mimeType,
          UTI: format.id === 'jpg' ? 'public.jpeg' : 'public.png',
          dialogTitle: fileName,
        });
        setStatus({ kind: 'done', message: `Photos access is off, so the ${format.label} (${dims}) was opened in the share sheet instead.` });
        return;
      }
      setStatus({
        kind: 'error',
        message: saved === 'unavailable' ? mediaLibraryUnavailableMessage() : 'Allow Photos access in Settings to save the export.',
      });
    } catch (err) {
      console.error('[design-export] export failed', err);
      setStatus({ kind: 'error', message: 'Export failed. Please try again.' });
      if (Platform.OS !== 'web') Alert.alert('Export failed', "Couldn't create the file. Please try again.");
    } finally {
      setExporting(false);
    }
  }, [project, exporting, formatUnavailable, format, output, selectedSize]);

  const selectFormat = (id: DesignExportFormatId) => {
    Haptics.selectionAsync();
    setSelectedFormat(id);
    setStatus({ kind: 'idle' });
  };

  const selectSize = (id: DesignExportSizeId) => {
    Haptics.selectionAsync();
    setSelectedSize(id);
    setStatus({ kind: 'idle' });
  };

  if (loading) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Export" variant="modal" onBack={() => goBackOr(router)} />
        <View style={styles.centered}>
          <ActivityIndicator color={PURPLE} />
        </View>
      </View>
    );
  }

  if (!project) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Export" variant="modal" onBack={() => goBackOr(router)} />
        <View style={styles.centered}>
          <EmptyState
            icon="image"
            title={projectId ? 'Design not found' : 'No design selected'}
            description={projectId
              ? 'This project may have been deleted. Pick a design from your gallery to export.'
              : 'Open a design in Design Studio, then choose More export options from its Share menu.'}
            action={{ label: 'Open Design Studio', onPress: () => router.replace('/design' as never) }}
            testID="design-export-empty"
          />
        </View>
      </View>
    );
  }

  const bgHex = project.canvas.backgroundHex && project.canvas.backgroundHex !== 'transparent'
    ? project.canvas.backgroundHex
    : null;
  const sortedLayers = [...(project.layers ?? [])]
    .filter(layer => !layer.isTemplate)
    .sort((a, b) => a.order - b.order);

  return (
    <View style={styles.root}>
      <ScreenHeader title="Export" variant="modal" onBack={() => goBackOr(router)} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarClearance }]}>

        {/* Live preview — this exact SVG is what gets captured at full size. */}
        <View style={styles.previewWrap}>
          <View style={[styles.previewFrame, { width: previewW, height: previewH }]} testID="design-export-preview">
            <Svg
              ref={svgRef}
              width={previewW}
              height={previewH}
              viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
            >
              {format.includeBackground && bgHex && (
                <Rect
                  x={viewBox.x} y={viewBox.y} width={viewBox.width} height={viewBox.height}
                  fill={bgHex} opacity={project.canvas.backgroundOpacity ?? 1}
                />
              )}
              {sortedLayers.map(layer => renderLayer(layer, 1, 1, bgHex ?? CARD))}
            </Svg>
          </View>
          <Text style={styles.previewName} numberOfLines={1}>{project.name}</Text>
          <Text style={styles.previewSub}>
            {format.label} · {output.width} × {output.height} px
          </Text>
        </View>

        {/* Format cards */}
        <SectionHeader title="Format" style={styles.sectionHeader} />
        {DESIGN_EXPORT_FORMATS.map(fmt => {
          const active = selectedFormat === fmt.id;
          const unavailable = fmt.nativeOnly && Platform.OS === 'web';
          return (
            <TouchableOpacity
              key={fmt.id}
              onPress={() => selectFormat(fmt.id)}
              activeOpacity={0.8}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${fmt.label} format`}
              testID={`design-export-format-${fmt.id}`}
            >
              <BrandthreadCard style={[styles.formatCard, active && styles.formatCardActive]}>
                <View style={styles.formatRow}>
                  <View style={[styles.formatIcon, active && { backgroundColor: PURPLE_DIM }]}>
                    <Feather name={fmt.id === 'pdf' ? 'file-text' : fmt.id === 'tpng' ? 'layers' : 'image'} size={18} color={active ? PURPLE_LIGHT : MUTED} />
                  </View>
                  <View style={styles.formatInfo}>
                    <Text style={[styles.formatLabel, active && { color: PURPLE_LIGHT }]}>{fmt.label}</Text>
                    <Text style={styles.formatDesc}>{unavailable ? 'Available in the iOS and Android app' : fmt.desc}</Text>
                  </View>
                  {active && <Feather name="check-circle" size={18} color={PURPLE_LIGHT} />}
                </View>
              </BrandthreadCard>
            </TouchableOpacity>
          );
        })}

        {/* Size options */}
        <SectionHeader title="Size" style={styles.sectionHeader} />
        {DESIGN_EXPORT_SIZES.map(sz => {
          const active = selectedSize === sz.id;
          const px = resolveExportPixels(sz.id, canvasW, canvasH);
          return (
            <TouchableOpacity
              key={sz.id}
              onPress={() => selectSize(sz.id)}
              activeOpacity={0.8}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${sz.label} size, ${px.width} by ${px.height} pixels`}
              testID={`design-export-size-${sz.id}`}
            >
              <BrandthreadCard style={[styles.sizeCard, active && styles.formatCardActive]}>
                <View style={styles.sizeRow}>
                  <View style={[styles.radio, active && styles.radioActive]}>
                    {active && <View style={styles.radioDot} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sizeLabel, active && { color: PURPLE_LIGHT }]}>{sz.label}</Text>
                    <Text style={styles.sizeDesc}>
                      {px.width} × {px.height} px{sz.note ? ` · ${sz.note}` : ''}
                    </Text>
                  </View>
                </View>
              </BrandthreadCard>
            </TouchableOpacity>
          );
        })}

        <BrandthreadCard style={styles.noteCard}>
          <View style={styles.noteRow}>
            <Feather name="info" size={14} color={CYAN} />
            <Text style={styles.noteText}>
              Sizes with a different shape than your canvas fit the whole design and fill the edges with the canvas background (left clear for Transparent PNG). Garment guides are never exported.
            </Text>
          </View>
        </BrandthreadCard>

        {status.kind !== 'idle' && (
          <View style={styles.statusRow} testID="design-export-status" accessibilityLiveRegion="polite">
            <Feather
              name={status.kind === 'done' ? 'check-circle' : 'alert-circle'}
              size={14}
              color={status.kind === 'done' ? PURPLE_LIGHT : MUTED}
            />
            <Text style={styles.statusText}>{status.message}</Text>
          </View>
        )}

        <View style={styles.exportWrap}>
          <PrimaryButton
            label={`Export ${format.label}`}
            onPress={handleExport}
            loading={exporting}
            disabled={exporting || formatUnavailable}
            style={styles.exportBtn}
            testID="design-export-submit"
          />
        </View>
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const { accent: PURPLE } = theme;
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.md },
  scrollContent: { paddingHorizontal: SP.md },

  previewWrap: { alignItems: 'center', marginBottom: SP.md, marginTop: SP.sm },
  previewFrame: {
    backgroundColor: CARD, borderRadius: RADIUS.xs, overflow: 'hidden',
    borderWidth: 1, borderColor: BORDER,
  },
  previewName: { fontSize: FS.base, fontFamily: FONT.bold, color: FG, marginTop: SP.sm },
  previewSub: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },

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

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.md },
  statusText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.medium, color: FG },

  exportWrap: { marginTop: SP.lg },
  exportBtn: {},
  });
};
