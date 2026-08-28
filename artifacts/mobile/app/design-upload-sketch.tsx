/**
 * Brandthread Design Studio — Upload Sketch
 * Route: /design-upload-sketch
 */
import React, { useState, useEffect, useRef } from 'react';
import { useColors } from '@/hooks/useColors';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Image, Animated, Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import {
  BrandthreadScreen, BrandthreadHeader, GradientCard,
} from '@/components/BrandthreadUI';
import {
  BG, SURFACE, CARD, CARD_ELEVATED,
  BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE,
  PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM,
  GRAD_PRIMARY, GRAD_CARD_GLOW,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { AI_STYLES, AIStyleKind } from '@/services/designTypes';
import {
  generateSketchToDesign, GenerateDesignResult,
} from '@/services/designService';

const { width: SW } = Dimensions.get('window');
const COL_W = (SW - SP.lg * 2 - SP.sm) / 2;

type Step = 'upload' | 'process' | 'style' | 'results';

const PROCESS_STEPS = [
  'Cleaning background…',
  'Increasing contrast…',
  'Vectorizing…',
];

const GRAD_PALETTES: Record<number, readonly [string, string]> = {
  0: ['#8B5CF6', '#22D3EE'],
  1: ['#F97316', '#8B5CF6'],
  2: ['#22D3EE', '#3B82F6'],
  3: ['#F59E0B', '#F97316'],
};

export default function UploadSketchScreen() {
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN } = useColors();
  const router = useRouter();
  const [step, setStep] = useState<Step>('upload');
  const [sketchUri, setSketchUri] = useState<string | null>(null);
  const [cropEnabled, setCropEnabled] = useState(false);
  const [contrastEnabled, setContrastEnabled] = useState(false);
  const [style, setStyle] = useState<AIStyleKind>('streetwear');
  const [colorPalette, setColorPalette] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [results, setResults] = useState<GenerateDesignResult | null>(null);

  // Processing animation state
  const [processStep, setProcessStep] = useState(0);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const stepAnims = useRef(PROCESS_STEPS.map(() => new Animated.Value(0))).current;

  async function pickSketch() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (!res.canceled && res.assets[0]) {
      setSketchUri(res.assets[0].uri);
    }
  }

  function startProcessing() {
    setStep('process');
    // Animate progress bar
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 3000,
      useNativeDriver: false,
    }).start();
    // Fade in each step label
    PROCESS_STEPS.forEach((_, i) => {
      setTimeout(() => {
        setProcessStep(i);
        Animated.timing(stepAnims[i], {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }).start();
      }, i * 900);
    });
    // Go to style after animation
    setTimeout(() => setStep('style'), 3200);
  }

  async function handleGenerate() {
    if (!sketchUri) return;
    setIsGenerating(true);
    try {
      const result = await generateSketchToDesign({
        sketchUri,
        style,
        colorPalette,
        count: 4,
      });
      setResults(result);
      setStep('results');
    } catch {
      Alert.alert('Generation failed', 'Please try again.');
    } finally {
      setIsGenerating(false);
    }
  }

  function reset() {
    setStep('upload');
    setSketchUri(null);
    setResults(null);
    setProcessStep(0);
    progressAnim.setValue(0);
    stepAnims.forEach(a => a.setValue(0));
  }

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  // ─── Results ─────────────────────────────────────────────────────────────────
  if (step === 'results' && results) {
    return (
      <BrandthreadScreen>
        <BrandthreadHeader title="Cleaned designs" onBack={() => setStep('style')} />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.sectionLabel}>Style: {results.style}</Text>
          <View style={s.grid}>
            {results.imageUris.map((uri, idx) => (
              <View key={uri} style={s.resultCard}>
                <LinearGradient
                  colors={GRAD_PALETTES[idx % 4]}
                  style={s.resultGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <Feather name="image" size={32} color="rgba(255,255,255,0.5)" />
                  <Text style={s.resultLabel}>Design {idx + 1}</Text>
                </LinearGradient>
                <View style={s.resultActions}>
                  <TouchableOpacity style={s.actionBtn} onPress={() => Alert.alert('Saved to project')}>
                    <Feather name="folder-plus" size={ICON.sm} color={PURPLE} />
                  </TouchableOpacity>
                  <TouchableOpacity style={s.actionBtn} onPress={() => Alert.alert('Add to garment')}>
                    <Feather name="layers" size={ICON.sm} color={CYAN} />
                  </TouchableOpacity>
                  <TouchableOpacity style={s.actionBtn} onPress={() => Alert.alert('Create product')}>
                    <Feather name="package" size={ICON.sm} color={FG} />
                  </TouchableOpacity>
                  <TouchableOpacity style={s.actionBtn} onPress={() => Alert.alert('Export')}>
                    <Feather name="download" size={ICON.sm} color={FG} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
          <View style={s.footerRow}>
            <TouchableOpacity style={s.footerBtn} onPress={reset}>
              <Feather name="refresh-cw" size={ICON.sm} color={FG} />
              <Text style={s.footerBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.footerBtn, { borderColor: PURPLE }]} onPress={() => Alert.alert('All saved')}>
              <Feather name="save" size={ICON.sm} color={PURPLE} />
              <Text style={[s.footerBtnText, { color: PURPLE }]}>Save all</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </BrandthreadScreen>
    );
  }

  // ─── Processing ───────────────────────────────────────────────────────────────
  if (step === 'process') {
    return (
      <BrandthreadScreen>
        <BrandthreadHeader title="Processing sketch" />
        <View style={s.processCenter}>
          <View style={s.processCard}>
            <Text style={s.processTitle}>Preparing your sketch</Text>
            <View style={s.progressBarTrack}>
              <Animated.View style={[s.progressBarFill, { width: progressWidth }]} />
            </View>
            {PROCESS_STEPS.map((label, i) => (
              <Animated.View
                key={label}
                style={[s.processStepRow, { opacity: stepAnims[i] }]}
              >
                <Feather
                  name={i <= processStep ? 'check-circle' : 'circle'}
                  size={ICON.sm}
                  color={i <= processStep ? CYAN : SUBTLE}
                />
                <Text style={[s.processStepText, i <= processStep && { color: FG }]}>
                  {label}
                </Text>
              </Animated.View>
            ))}
          </View>
        </View>
      </BrandthreadScreen>
    );
  }

  // ─── Style selection ──────────────────────────────────────────────────────────
  if (step === 'style') {
    return (
      <BrandthreadScreen>
        {isGenerating && (
          <View style={s.loadingOverlay}>
            <ActivityIndicator size="large" color={PURPLE} />
            <Text style={s.loadingText}>Generating designs…</Text>
          </View>
        )}
        <BrandthreadHeader title="Choose style" onBack={() => setStep('upload')} />
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

          <GradientCard style={s.generateCard} onPress={handleGenerate}>
            <View style={s.generateInner}>
              <Feather name="zap" size={ICON.md} color="#fff" />
              <Text style={s.generateText}>Generate cleaned design</Text>
            </View>
          </GradientCard>
        </ScrollView>
      </BrandthreadScreen>
    );
  }

  // ─── Upload step ──────────────────────────────────────────────────────────────
  return (
    <BrandthreadScreen>
      <BrandthreadHeader title="Upload Sketch" onBack={() => router.back()} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.uploadHint}>
          Upload a hand-drawn sketch or rough design. Our AI will clean and vectorize it.
        </Text>

        <TouchableOpacity style={s.uploadZone} onPress={pickSketch}>
          {sketchUri ? (
            <Image source={{ uri: sketchUri }} style={s.uploadThumb} />
          ) : (
            <>
              <View style={s.uploadIconCircle}>
                <Feather name="upload" size={ICON.xl} color={PURPLE} />
              </View>
              <Text style={s.uploadZoneTitle}>Upload sketch</Text>
              <Text style={s.uploadZoneSub}>JPG, PNG up to 20MB</Text>
            </>
          )}
        </TouchableOpacity>

        {sketchUri && (
          <>
            <Text style={s.label}>Options</Text>
            <View style={s.toggleRow}>
              <TouchableOpacity
                style={[s.toggle, cropEnabled && s.toggleActive]}
                onPress={() => setCropEnabled(!cropEnabled)}
              >
                <Feather name="crop" size={ICON.sm} color={cropEnabled ? PURPLE_LIGHT : MUTED} />
                <Text style={[s.toggleText, cropEnabled && { color: PURPLE_LIGHT }]}>Crop</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.toggle, contrastEnabled && s.toggleActive]}
                onPress={() => setContrastEnabled(!contrastEnabled)}
              >
                <Feather name="sun" size={ICON.sm} color={contrastEnabled ? CYAN : MUTED} />
                <Text style={[s.toggleText, contrastEnabled && { color: CYAN }]}>Increase contrast</Text>
              </TouchableOpacity>
            </View>

            <GradientCard style={s.generateCard} onPress={startProcessing}>
              <View style={s.generateInner}>
                <Feather name="arrow-right" size={ICON.md} color="#fff" />
                <Text style={s.generateText}>Next: Process sketch</Text>
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

const s = StyleSheet.create({
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
    backgroundColor: 'rgba(7,7,15,0.8)',
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
    backgroundColor: 'rgba(7,7,15,0.92)',
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
