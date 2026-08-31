/**
 * Brandthread Design Studio — Mockup to Model
 * Route: /design-mockup-to-model
 */
import React, { useState } from 'react';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Image, Dimensions,
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
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import {
  MODEL_STYLES, SCENE_STYLES, LIGHTING_STYLES,
  ModelStyleKind, SceneStyleKind, LightingStyleKind, ImageRatioKind,
} from '@/services/designTypes';
import {
  generateMockupToModel, GenerateMockupResult,
} from '@/services/designService';

const { width: SW } = Dimensions.get('window');
const COL_W = (SW - SP.lg * 2 - SP.sm) / 2;

type Step = 1 | 2 | 3 | 4;

const IMAGE_RATIOS: { value: ImageRatioKind; label: string }[] = [
  { value: '9:16', label: '9:16' },
  { value: '4:5', label: '4:5' },
  { value: '1:1', label: '1:1' },
  { value: '3:4', label: '3:4' },
];

const GRAD_PALETTES: Record<number, readonly [string, string]> = {
  0: ['#0F766E', '#22D3EE'],
  1: ['#F97316', '#0EA5E9'],
  2: ['#22D3EE', '#3B82F6'],
  3: ['#F59E0B', '#F97316'],
};

export default function MockupToModelScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  const s = createStyles(theme);
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [mockupUri, setMockupUri] = useState<string | null>(null);
  const [modelStyle, setModelStyle] = useState<ModelStyleKind>('female');
  const [sceneStyle, setSceneStyle] = useState<SceneStyleKind>('studio');
  const [lightingStyle, setLightingStyle] = useState<LightingStyleKind>('natural');
  const [imageRatio, setImageRatio] = useState<ImageRatioKind>('4:5');
  const [count, setCount] = useState(2);
  const [isGenerating, setIsGenerating] = useState(false);
  const [results, setResults] = useState<GenerateMockupResult | null>(null);

  async function pickMockup() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (!res.canceled && res.assets[0]) {
      setMockupUri(res.assets[0].uri);
    }
  }

  async function handleGenerate() {
    if (!mockupUri) return;
    setIsGenerating(true);
    try {
      const result = await generateMockupToModel({
        mockupUri,
        modelStyle,
        sceneStyle,
        lightingStyle,
        imageRatio,
        count,
      });
      setResults(result);
    } catch {
      Alert.alert('Generation failed', 'Please try again.');
    } finally {
      setIsGenerating(false);
    }
  }

  // Step indicator
  function StepIndicator() {
    return (
      <View style={s.stepIndicator}>
        {([1, 2, 3, 4] as Step[]).map(n => (
          <View key={n} style={s.stepRow}>
            <View style={[s.stepDot, step >= n && s.stepDotActive]}>
              <Text style={[s.stepDotText, step >= n && s.stepDotTextActive]}>
                {n}
              </Text>
            </View>
            {n < 4 && <View style={[s.stepLine, step > n && s.stepLineActive]} />}
          </View>
        ))}
      </View>
    );
  }

  // Results screen
  if (results) {
    return (
      <BrandthreadScreen>
        <BrandthreadHeader title="Model photos" onBack={() => setResults(null)} />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={s.grid}>
            {results.imageUris.map((uri, idx) => (
              <View key={uri} style={s.resultCard}>
                <Image source={{ uri }} style={s.resultGradient} resizeMode="cover" />
                <View style={s.resultMeta}>
                  <Text style={s.resultMetaText}>{results.modelStyle} · {results.sceneStyle}</Text>
                </View>
                <View style={s.resultActions}>
                  <TouchableOpacity style={s.actionBtn} onPress={() => Alert.alert('Saved')}>
                    <Feather name="bookmark" size={ICON.sm} color={PURPLE} />
                  </TouchableOpacity>
                  <TouchableOpacity style={s.actionBtn} onPress={() => handleGenerate()}>
                    <Feather name="refresh-cw" size={ICON.sm} color={CYAN} />
                  </TouchableOpacity>
                  <TouchableOpacity style={s.actionBtn} onPress={() => Alert.alert('Add to product media')}>
                    <Feather name="package" size={ICON.sm} color={FG} />
                  </TouchableOpacity>
                  <TouchableOpacity style={s.actionBtn} onPress={() => Alert.alert('Create Seller post')}>
                    <Feather name="send" size={ICON.sm} color={FG} />
                  </TouchableOpacity>
                  <TouchableOpacity style={s.actionBtn} onPress={() => Alert.alert('Add to storefront')}>
                    <Feather name="shopping-bag" size={ICON.sm} color={FG} />
                  </TouchableOpacity>
                  <TouchableOpacity style={s.actionBtn} onPress={() => Alert.alert('Create campaign')}>
                    <Feather name="trending-up" size={ICON.sm} color={FG} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>

          <View style={s.disclaimer}>
            <Feather name="info" size={ICON.sm} color={MUTED} />
            <Text style={s.disclaimerText}>
              Preview shown. Connect an AI provider to generate real photos.
            </Text>
          </View>

          <View style={s.footerRow}>
            <TouchableOpacity style={s.footerBtn} onPress={() => { setResults(null); setStep(1); }}>
              <Feather name="refresh-cw" size={ICON.sm} color={FG} />
              <Text style={s.footerBtnText}>Start over</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.footerBtn, { borderColor: PURPLE }]} onPress={handleGenerate}>
              <Feather name="zap" size={ICON.sm} color={PURPLE} />
              <Text style={[s.footerBtnText, { color: PURPLE }]}>Regenerate</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </BrandthreadScreen>
    );
  }

  return (
    <BrandthreadScreen>
      {isGenerating && (
        <View style={s.loadingOverlay}>
          <ActivityIndicator size="large" color={PURPLE} />
          <Text style={s.loadingText}>Generating model photos…</Text>
        </View>
      )}
      <BrandthreadHeader title="Mockup to Model" onBack={() => step > 1 ? setStep((step - 1) as Step) : router.back()} />
      <StepIndicator />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Step 1 — Upload mockup */}
        {step === 1 && (
          <>
            <Text style={s.stepTitle}>Upload garment mockup</Text>
            <Text style={s.stepSub}>Upload a flat-lay or product image of your garment.</Text>
            <TouchableOpacity style={s.uploadZone} onPress={pickMockup}>
              {mockupUri ? (
                <Image source={{ uri: mockupUri }} style={s.uploadThumb} />
              ) : (
                <>
                  <View style={s.uploadIconCircle}>
                    <Feather name="upload" size={ICON.xl} color={PURPLE} />
                  </View>
                  <Text style={s.uploadZoneTitle}>Upload garment mockup</Text>
                  <Text style={s.uploadZoneSub}>JPG, PNG up to 20MB</Text>
                </>
              )}
            </TouchableOpacity>
            {mockupUri && (
              <GradientCard colors={theme.primaryGradient} style={[s.nextCard, { shadowColor: theme.shadowColor }]} onPress={() => setStep(2)}>
                <View style={s.nextInner}>
                  <Text style={[s.nextText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Next: Choose model & scene</Text>
                  <Feather name="arrow-right" size={ICON.md} color={theme.onAccent} />
                </View>
              </GradientCard>
            )}
          </>
        )}

        {/* Step 2 — Model & Scene */}
        {step === 2 && (
          <>
            <Text style={s.stepTitle}>Model & Scene</Text>
            <Text style={s.label}>Model style</Text>
            <View style={s.modelGrid}>
              {MODEL_STYLES.map(m => (
                <TouchableOpacity
                  key={m.value}
                  style={[s.modelCard, modelStyle === m.value && s.modelCardActive]}
                  onPress={() => setModelStyle(m.value)}
                >
                  <Feather name="user" size={ICON.lg} color={modelStyle === m.value ? PURPLE_LIGHT : MUTED} />
                  <Text style={[s.modelCardText, modelStyle === m.value && s.modelCardTextActive]}>
                    {m.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.label}>Scene style</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.pillRow}>
              {SCENE_STYLES.map(sc => (
                <TouchableOpacity
                  key={sc.value}
                  style={[s.pill, sceneStyle === sc.value && s.pillActive]}
                  onPress={() => setSceneStyle(sc.value)}
                >
                  <Text style={[s.pillText, sceneStyle === sc.value && s.pillTextActive]}>
                    {sc.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <GradientCard colors={theme.primaryGradient} style={[s.nextCard, { shadowColor: theme.shadowColor }]} onPress={() => setStep(3)}>
              <View style={s.nextInner}>
                <Text style={[s.nextText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Next: Lighting & format</Text>
                <Feather name="arrow-right" size={ICON.md} color={theme.onAccent} />
              </View>
            </GradientCard>
          </>
        )}

        {/* Step 3 — Details */}
        {step === 3 && (
          <>
            <Text style={s.stepTitle}>Lighting & format</Text>

            <Text style={s.label}>Lighting style</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.pillRow}>
              {LIGHTING_STYLES.map(l => (
                <TouchableOpacity
                  key={l.value}
                  style={[s.pill, lightingStyle === l.value && s.pillActive]}
                  onPress={() => setLightingStyle(l.value)}
                >
                  <Text style={[s.pillText, lightingStyle === l.value && s.pillTextActive]}>
                    {l.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={s.label}>Image ratio</Text>
            <View style={s.ratioRow}>
              {IMAGE_RATIOS.map(r => (
                <TouchableOpacity
                  key={r.value}
                  style={[s.ratioBtn, imageRatio === r.value && s.ratioBtnActive]}
                  onPress={() => setImageRatio(r.value)}
                >
                  <Text style={[s.ratioBtnText, imageRatio === r.value && s.ratioBtnTextActive]}>
                    {r.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.label}>Number of photos</Text>
            <View style={s.stepperRow}>
              <TouchableOpacity style={s.stepperBtn} onPress={() => setCount(Math.max(1, count - 1))}>
                <Feather name="minus" size={ICON.md} color={FG} />
              </TouchableOpacity>
              <Text style={s.stepperVal}>{count}</Text>
              <TouchableOpacity style={s.stepperBtn} onPress={() => setCount(Math.min(4, count + 1))}>
                <Feather name="plus" size={ICON.md} color={FG} />
              </TouchableOpacity>
            </View>

            <GradientCard colors={theme.primaryGradient} style={[s.nextCard, { shadowColor: theme.shadowColor }]} onPress={() => setStep(4)}>
              <View style={s.nextInner}>
                <Text style={[s.nextText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Next: Review & generate</Text>
                <Feather name="arrow-right" size={ICON.md} color={theme.onAccent} />
              </View>
            </GradientCard>
          </>
        )}

        {/* Step 4 — Generate */}
        {step === 4 && (
          <>
            <Text style={s.stepTitle}>Ready to generate</Text>

            <View style={s.summaryCard}>
              <Text style={s.summaryTitle}>Summary</Text>
              {[
                { label: 'Model', value: MODEL_STYLES.find(m => m.value === modelStyle)?.label ?? modelStyle },
                { label: 'Scene', value: SCENE_STYLES.find(sc => sc.value === sceneStyle)?.label ?? sceneStyle },
                { label: 'Lighting', value: LIGHTING_STYLES.find(l => l.value === lightingStyle)?.label ?? lightingStyle },
                { label: 'Ratio', value: imageRatio },
                { label: 'Count', value: String(count) },
              ].map(row => (
                <View key={row.label} style={s.summaryRow}>
                  <Text style={s.summaryLabel}>{row.label}</Text>
                  <Text style={s.summaryValue}>{row.value}</Text>
                </View>
              ))}
            </View>

            <GradientCard colors={theme.primaryGradient} style={[s.nextCard, { shadowColor: theme.shadowColor }]} onPress={handleGenerate}>
              <View style={s.nextInner}>
                <Feather name="zap" size={ICON.md} color={theme.onAccent} />
                <Text style={[s.nextText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Generate {count} photo{count !== 1 ? 's' : ''}</Text>
              </View>
            </GradientCard>
          </>
        )}
      </ScrollView>
    </BrandthreadScreen>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const { accent: PURPLE, accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  return StyleSheet.create({
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP.xl,
    paddingVertical: SP.md,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotActive: {
    backgroundColor: PURPLE_DIM,
    borderColor: PURPLE,
  },
  stepDotText: {
    fontFamily: FONT.bold,
    fontSize: FS.xs,
    color: SUBTLE,
  },
  stepDotTextActive: {
    color: PURPLE_LIGHT,
  },
  stepLine: {
    width: 32,
    height: 2,
    backgroundColor: BORDER,
  },
  stepLineActive: {
    backgroundColor: PURPLE,
  },
  content: { padding: SP.lg, paddingBottom: SP.xxl },
  stepTitle: {
    fontFamily: FONT.bold,
    fontSize: FS.lg,
    color: FG,
    marginBottom: SP.xs,
  },
  stepSub: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
    marginBottom: SP.lg,
  },
  label: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    color: FG,
    marginBottom: SP.sm,
    marginTop: SP.lg,
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
  modelGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.sm,
  },
  modelCard: {
    width: COL_W,
    paddingVertical: SP.md,
    paddingHorizontal: SP.sm,
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    gap: SP.xs,
  },
  modelCardActive: {
    borderColor: PURPLE,
    backgroundColor: PURPLE_DIM,
  },
  modelCardText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: MUTED,
    textAlign: 'center',
  },
  modelCardTextActive: {
    color: PURPLE_LIGHT,
  },
  pillRow: {
    flexGrow: 0,
    marginBottom: SP.xs,
  },
  pill: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm - 2,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
    marginRight: SP.sm,
  },
  pillActive: {
    borderColor: PURPLE,
    backgroundColor: PURPLE_DIM,
  },
  pillText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: MUTED,
  },
  pillTextActive: {
    color: PURPLE_LIGHT,
  },
  ratioRow: {
    flexDirection: 'row',
    gap: SP.sm,
  },
  ratioBtn: {
    flex: 1,
    paddingVertical: SP.sm,
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },
  ratioBtnActive: {
    borderColor: CYAN,
    backgroundColor: CYAN_DIM,
  },
  ratioBtnText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: MUTED,
  },
  ratioBtnTextActive: {
    color: CYAN,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.lg,
  },
  stepperBtn: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperVal: {
    fontFamily: FONT.bold,
    fontSize: FS.xl,
    color: FG,
    minWidth: 40,
    textAlign: 'center',
  },
  summaryCard: {
    backgroundColor: CARD,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.lg,
    gap: SP.sm,
    marginBottom: SP.md,
  },
  summaryTitle: {
    fontFamily: FONT.semibold,
    fontSize: FS.md,
    color: FG,
    marginBottom: SP.sm,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryLabel: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
  },
  summaryValue: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: FG,
  },
  nextCard: {
    marginTop: SP.xl,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
  },
  nextInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
    paddingVertical: SP.md,
  },
  nextText: {
    fontFamily: FONT.bold,
    fontSize: FS.md,
    color: '#fff',
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
  // Results
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
    height: COL_W * 1.3,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
  },
  resultLabel: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: 'rgba(255,255,255,0.7)',
  },
  resultMeta: {
    paddingHorizontal: SP.sm,
    paddingTop: SP.xs,
  },
  resultMetaText: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: SUBTLE,
  },
  resultActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.xs,
    padding: SP.sm,
  },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.sm,
    backgroundColor: SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disclaimer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SP.sm,
    marginTop: SP.lg,
    padding: SP.md,
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
  },
  disclaimerText: {
    flex: 1,
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
    lineHeight: 18,
  },
  footerRow: {
    flexDirection: 'row',
    gap: SP.sm,
    marginTop: SP.lg,
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
  });
};
