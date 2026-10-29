/**
 * Brandthread Design Studio — Upload Sketch
 * Route: /design-upload-sketch  (Studio tab → "Upload Sketch")
 *
 * Pick a sketch (optionally cropped in the system picker), choose a style,
 * and generate 4 cleaned designs through the real AI endpoint
 * (POST /api/mockup/generate, mode "sketch_to_design", Growth plan). Each of
 * the 4 results is its own request, so progress is real: tiles fill in as
 * they finish, and a failed tile shows the server's reason with Retry.
 */
import React, { useEffect, useRef, useState } from 'react';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Alert, Image, Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import {
  BrandthreadScreen, GradientCard,
} from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  SURFACE, CARD,
  BORDER,
  FG, MUTED, SUBTLE,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { AI_STYLES, AIStyleKind } from '@/services/designTypes';
import { generateSketchToDesign, createBrandAsset } from '@/services/designService';
import { AiResultsGrid } from '@/components/ai-tools/AiResultsGrid';
import { AiResultViewer } from '@/components/ai-tools/AiResultViewer';
import type { AiResultSlot } from '@/components/ai-tools/AiResultTypes';
import { saveImageToCameraRoll, saveAllToCameraRoll, shareImage } from '@/lib/aiToolMedia';
// Shared AI-tool copy: a 402 insufficient_credits opens /ai-credits, daily caps get the gate's copy.
import { aiToolErrorMessage } from '@/components/ai-tools/aiToolErrorMessage';
import { showAlert } from '@/lib/actionSheet';

const { width: SW } = Dimensions.get('window');
const COL_W = (SW - SP.lg * 2 - SP.sm) / 2;
const RESULT_COUNT = 4;

type Step = 'upload' | 'style' | 'results';

const CONTRAST_HINT = 'The sketch lines are faint: boost the contrast and clean up the line work.';

export default function UploadSketchScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, secondary: CYAN } = theme;
  const s = createStyles(theme);
  const router = useRouter();
  const [step, setStep] = useState<Step>('upload');
  const [sketchUri, setSketchUri] = useState<string | null>(null);
  const [contrastEnabled, setContrastEnabled] = useState(false);
  const [style, setStyle] = useState<AIStyleKind>('streetwear');
  const [colorPalette, setColorPalette] = useState('');
  const [slots, setSlots] = useState<AiResultSlot[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [libraryId, setLibraryId] = useState<number | null>(null);

  // One controller per generation run: leaving the results (back, New
  // sketch) or the screen aborts its requests, and a stale run's results
  // never land in a newer run's tiles (they reuse the same slot ids).
  const runRef = useRef<AbortController | null>(null);
  function cancelRun() {
    runRef.current?.abort();
    runRef.current = null;
  }
  useEffect(() => () => cancelRun(), []);

  const doneSlots = slots.filter(sl => sl.status === 'done' && sl.imageUri);
  const generatingCount = slots.filter(sl => sl.status === 'generating').length;
  const failedCount = slots.filter(sl => sl.status === 'failed').length;

  async function pickSketch(crop = false) {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
        allowsEditing: crop,
      });
      if (!res.canceled && res.assets[0]) setSketchUri(res.assets[0].uri);
    } catch {
      Alert.alert('Couldn’t open your photos', 'Check photo access for Brandthread in Settings and try again.');
    }
  }

  function palettePrompt(): string {
    return [colorPalette.trim(), contrastEnabled ? CONTRAST_HINT : ''].filter(Boolean).join('. ');
  }

  async function runSlot(id: number) {
    if (!sketchUri) return;
    if (!runRef.current) runRef.current = new AbortController();
    const { signal } = runRef.current;
    setSlots(prev => prev.map(sl => sl.id === id ? { ...sl, status: 'generating', error: undefined } : sl));
    try {
      const result = await generateSketchToDesign({ sketchUri, style, colorPalette: palettePrompt(), count: 1, signal });
      if (signal.aborted) return;
      const imageUri = result.imageUris[0];
      if (!imageUri) throw new Error('The AI returned no image. Try again.');
      setSlots(prev => prev.map(sl => sl.id === id ? { ...sl, status: 'done', imageUri } : sl));
    } catch (err) {
      if (signal.aborted) return;
      setSlots(prev => prev.map(sl => sl.id === id
        ? { ...sl, status: 'failed', error: aiToolErrorMessage(err, 'Generation failed. Try again.') }
        : sl));
    }
  }

  function handleGenerate() {
    // A run already started (double tap before the results step renders):
    // starting another would abort it and fire 4 more paid requests.
    if (!sketchUri || runRef.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const fresh: AiResultSlot[] = Array.from({ length: RESULT_COUNT }, (_, i) => ({
      id: i, status: 'generating', sourceUri: sketchUri, label: `Design ${i + 1}`,
    }));
    cancelRun();
    runRef.current = new AbortController();
    setSlots(fresh);
    setStep('results');
    fresh.forEach(sl => { void runSlot(sl.id); });
  }

  async function handleSaveToLibrary(id: number, imageUri: string) {
    setLibraryId(id);
    try {
      await createBrandAsset({ name: `Sketch design ${id + 1}`, type: 'graphic', uri: imageUri, tags: ['ai-generated', 'sketch-to-design'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert('Saved', 'Saved to Brand Assets. Insert it into any design from the assets panel.');
    } catch {
      Alert.alert('Save failed', 'Could not save to Brand Assets. Please try again.');
    } finally {
      setLibraryId(null);
    }
  }

  async function handleDownload(id: number, imageUri: string) {
    setSavingId(id);
    const result = await saveImageToCameraRoll(imageUri, 'sketch-design');
    setSavingId(null);
    if (result.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } else {
      Alert.alert(
        result.reason === 'permission' ? 'Permission required' : result.reason === 'unavailable' ? 'Unavailable' : 'Download failed',
        result.reason === 'permission'
          ? 'Allow photo library access to save this image.'
          : result.reason === 'unavailable'
            ? 'Saving to Photos is unavailable in this app build.'
            : 'Could not save this image. Please try again.',
      );
    }
  }

  async function handleSaveAll() {
    const uris = doneSlots.map(sl => sl.imageUri!);
    if (uris.length === 0) return;
    const { succeeded, failed, unavailable } = await saveAllToCameraRoll(uris, 'sketch-design');
    if (failed === 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert('Saved', `${succeeded} design${succeeded === 1 ? '' : 's'} saved.`);
    } else {
      Alert.alert(unavailable ? 'Photos unavailable' : 'Some saves failed',
        unavailable ? 'Saving to Photos is unavailable in this app build.' : `${succeeded} of ${uris.length} designs saved.`);
    }
  }

  function reset() {
    cancelRun();
    setStep('upload');
    setSketchUri(null);
    setSlots([]);
    setViewerIndex(null);
  }

  // ─── Results ─────────────────────────────────────────────────────────────────
  if (step === 'results') {
    const status = generatingCount > 0
      ? `Generating ${RESULT_COUNT - generatingCount} of ${RESULT_COUNT} done…`
      : failedCount > 0
        ? `${doneSlots.length} of ${RESULT_COUNT} ready · ${failedCount} failed`
        : `Style: ${AI_STYLES.find(st => st.value === style)?.label ?? style}`;
    return (
      <BrandthreadScreen noSafeTop>
        <ScreenHeader title="Cleaned designs" onBack={() => { cancelRun(); setSlots([]); setStep('style'); }} />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.sectionLabel}>{status}</Text>
          <AiResultsGrid
            slots={slots}
            onOpen={(id) => setViewerIndex(doneSlots.findIndex(d => d.id === id))}
            onRetry={(id) => { void runSlot(id); }}
            onSaveToLibrary={handleSaveToLibrary}
            onDownload={handleDownload}
            savingId={savingId}
            libraryId={libraryId}
          />
          <View style={s.footerRow}>
            <TouchableOpacity style={s.footerBtn} onPress={reset} accessibilityRole="button">
              <Feather name="refresh-cw" size={ICON.sm} color={FG} />
              <Text style={s.footerBtnText}>New sketch</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.footerBtn, { borderColor: PURPLE, opacity: doneSlots.length === 0 ? 0.5 : 1 }]}
              onPress={handleSaveAll}
              disabled={doneSlots.length === 0}
            >
              <Feather name="download" size={ICON.sm} color={PURPLE} />
              <Text style={[s.footerBtnText, { color: PURPLE }]}>Save all</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
        <AiResultViewer
          visible={viewerIndex !== null && viewerIndex >= 0}
          items={doneSlots}
          index={Math.max(0, viewerIndex ?? 0)}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
          actions={[
            { icon: 'bookmark', label: 'Library', onPress: (item) => handleSaveToLibrary(item.id, item.imageUri!), loading: (item) => libraryId === item.id },
            { icon: 'download', label: 'Save', onPress: (item) => handleDownload(item.id, item.imageUri!), loading: (item) => savingId === item.id },
            { icon: 'share', label: 'Share', onPress: (item) => shareImage(item.imageUri!, 'sketch-design') },
          ]}
        />
      </BrandthreadScreen>
    );
  }

  // ─── Style selection ──────────────────────────────────────────────────────────
  if (step === 'style') {
    return (
      <BrandthreadScreen noSafeTop>
        <ScreenHeader title="Choose style" onBack={() => setStep('upload')} />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {sketchUri && (
            <View style={s.sketchPreviewWrap}>
              <Image source={{ uri: sketchUri }} style={s.sketchPreview} />
              <View style={s.sketchPreviewBadge}>
                <Text style={s.sketchPreviewBadgeText}>Your sketch</Text>
              </View>
            </View>
          )}
          <Text style={s.label}>Style</Text>
          <View style={s.styleGrid}>
            {AI_STYLES.map(st => (
              <TouchableOpacity
                key={st.value}
                style={[s.styleCard, style === st.value && s.styleCardActive]}
                onPress={() => setStyle(st.value)}
                accessibilityRole="button"
                accessibilityState={{ selected: style === st.value }}
              >
                <Text style={[s.styleCardText, style === st.value && s.styleCardTextActive]}>
                  {st.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.label}>Color palette <Text style={s.optional}>(optional)</Text></Text>
          <View style={s.inputWrap}>
            <TextInput
              style={s.input}
              value={colorPalette}
              onChangeText={setColorPalette}
              placeholder="Black, white, gold…"
              placeholderTextColor={SUBTLE}
            />
          </View>

          <GradientCard colors={theme.primaryGradient} style={[s.generateCard, { shadowColor: theme.shadowColor }]} onPress={handleGenerate}>
            <View style={s.generateInner}>
              <Feather name="zap" size={ICON.md} color={theme.onAccent} />
              <Text style={[s.generateText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Generate {RESULT_COUNT} cleaned designs</Text>
            </View>
          </GradientCard>
        </ScrollView>
      </BrandthreadScreen>
    );
  }

  // ─── Upload step ──────────────────────────────────────────────────────────────
  return (
    <BrandthreadScreen noSafeTop>
      <ScreenHeader title="Upload Sketch" onBack={() => goBackOr(router)} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.uploadHint}>
          Upload a hand-drawn sketch or rough design. AI turns it into clean, print-ready artwork.
        </Text>

        <TouchableOpacity style={s.uploadZone} onPress={() => pickSketch(false)}>
          {sketchUri ? (
            <Image source={{ uri: sketchUri }} style={s.uploadThumb} />
          ) : (
            <>
              <View style={s.uploadIconCircle}>
                <Feather name="upload" size={ICON.xl} color={PURPLE} />
              </View>
              <Text style={s.uploadZoneTitle}>Upload sketch</Text>
              <Text style={s.uploadZoneSub}>JPG, PNG or WEBP up to 8MB</Text>
            </>
          )}
        </TouchableOpacity>

        {sketchUri && (
          <>
            <Text style={s.label}>Options</Text>
            <View style={s.toggleRow}>
              <TouchableOpacity style={s.toggle} onPress={() => pickSketch(true)}>
                <Feather name="crop" size={ICON.sm} color={MUTED} />
                <Text style={s.toggleText}>Crop</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.toggle, contrastEnabled && s.toggleActive]}
                onPress={() => setContrastEnabled(!contrastEnabled)}
                accessibilityRole="switch"
                accessibilityState={{ checked: contrastEnabled }}
              >
                <Feather name="sun" size={ICON.sm} color={contrastEnabled ? CYAN : MUTED} />
                <Text style={[s.toggleText, contrastEnabled && { color: CYAN }]}>Faint lines</Text>
              </TouchableOpacity>
            </View>

            <GradientCard colors={theme.primaryGradient} style={[s.generateCard, { shadowColor: theme.shadowColor }]} onPress={() => setStep('style')}>
              <View style={s.generateInner}>
                <Feather name="arrow-right" size={ICON.md} color={theme.onAccent} />
                <Text style={[s.generateText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Next: Choose style</Text>
              </View>
            </GradientCard>
          </>
        )}

        {!sketchUri && (
          <View style={s.emptyHints}>
            {['Hand-drawn logos', 'Rough illustrations', 'Typography sketches', 'Pattern drafts'].map(hint => (
              <View key={hint} style={s.hintChip}>
                <Feather name="check" size={ICON.xs} color={CYAN} />
                <Text style={s.hintChipText}>{hint}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </BrandthreadScreen>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const { accent: PURPLE, accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT } = theme;
  return StyleSheet.create({
  content: { padding: SP.lg, paddingBottom: SP.xxl },
  uploadHint: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
    marginBottom: SP.lg,
    lineHeight: 20,
  },
  uploadZone: {
    borderWidth: 2,
    borderColor: BORDER,
    borderStyle: 'dashed',
    borderRadius: RADIUS.xl,
    backgroundColor: CARD,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
    overflow: 'hidden',
  },
  uploadIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: PURPLE_DIM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadZoneTitle: {
    fontFamily: FONT.semibold,
    fontSize: FS.md,
    color: FG,
  },
  uploadZoneSub: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
  },
  uploadThumb: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
  },
  label: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    color: FG,
    marginBottom: SP.sm,
    marginTop: SP.lg,
  },
  optional: {
    fontFamily: FONT.regular,
    color: MUTED,
    fontSize: FS.xs,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: SP.sm,
  },
  toggle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    paddingVertical: SP.sm,
    paddingHorizontal: SP.md,
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
  },
  toggleActive: {
    borderColor: PURPLE,
    backgroundColor: PURPLE_DIM,
  },
  toggleText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: MUTED,
  },
  generateCard: {
    marginTop: SP.xl,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
  },
  generateInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
    paddingVertical: SP.md,
  },
  generateText: {
    fontFamily: FONT.bold,
    fontSize: FS.md,
    color: '#fff',
  },
  emptyHints: {
    marginTop: SP.xl,
    gap: SP.sm,
  },
  hintChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingVertical: SP.xs,
  },
  hintChipText: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
  },
  // Processing
  processCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SP.lg,
  },
  processCard: {
    width: '100%',
    backgroundColor: CARD,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.xl,
    gap: SP.lg,
  },
  processTitle: {
    fontFamily: FONT.semibold,
    fontSize: FS.md,
    color: FG,
    textAlign: 'center',
  },
  progressBarTrack: {
    height: 4,
    backgroundColor: SURFACE,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: PURPLE,
    borderRadius: RADIUS.pill,
  },
  processStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
  },
  processStepText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: SUBTLE,
  },
  // Style step
  styleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.sm,
  },
  styleCard: {
    width: COL_W,
    paddingVertical: SP.md,
    paddingHorizontal: SP.sm,
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },
  styleCardActive: {
    borderColor: PURPLE,
    backgroundColor: PURPLE_DIM,
  },
  styleCardText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: MUTED,
  },
  styleCardTextActive: {
    color: PURPLE_LIGHT,
  },
  inputWrap: {
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
  },
  input: {
    fontFamily: FONT.regular,
    fontSize: FS.base,
    color: FG,
    padding: SP.md,
    height: 52,
  },
  sketchPreviewWrap: {
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    height: 160,
    marginBottom: SP.md,
    position: 'relative',
  },
  sketchPreview: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
    backgroundColor: CARD,
  },
  sketchPreviewBadge: {
    position: 'absolute',
    top: SP.sm,
    left: SP.sm,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: 2,
  },
  sketchPreviewBadgeText: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    color: MUTED,
  },
  // Results
  sectionLabel: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: MUTED,
    marginBottom: SP.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.sm,
  },
  resultCard: {
    width: COL_W,
    backgroundColor: CARD,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: BORDER,
  },
  resultGradient: {
    height: COL_W * 1.2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
  },
  resultLabel: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: 'rgba(255,255,255,0.7)',
  },
  resultActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: SP.sm,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    backgroundColor: SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerRow: {
    flexDirection: 'row',
    gap: SP.sm,
    marginTop: SP.xl,
  },
  footerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.xs,
    paddingVertical: SP.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
  },
  footerBtnText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: FG,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.92)',
    zIndex: 100,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.md,
  },
  loadingText: {
    fontFamily: FONT.semibold,
    fontSize: FS.lg,
    color: FG,
  },
  });
};
