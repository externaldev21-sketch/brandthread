import React, { useEffect, useRef, useState } from 'react';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, ScrollView, Image, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useUser } from '@clerk/expo';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import {
  BG, CARD, SURFACE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { BrandthreadCard, PrimaryButton, SecondaryButton, StatusBadge } from '@/components/BrandthreadUI';
import {
  generateFromMoodBoard, applyFromMoodboard, getStoreApplyFailure, StoreApplyFailure,
} from '@/services/storeService';
import { StoreColorPalette, StoreSectionType } from '@/services/storeTypes';

const MAX_IMAGES = 8;
const MOODBOARD_ANALYSIS_CACHE_PREFIX = 'bt:store:moodboard-analysis:transient:v1';

type MoodboardAnalysisResult = {
  colorPalette: StoreColorPalette;
  typographyDirection: string;
  layoutStyle: string;
  imageTreatment: string;
  suggestedThemeId: string;
  suggestedSections: StoreSectionType[];
  aiSections: import('@/services/storeTypes').StoreSection[];
  source: 'ai' | 'fallback';
};

type MoodboardAnalysisCache = {
  imageUris: string[];
  result: MoodboardAnalysisResult;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMoodboardAnalysisCache(value: unknown): value is MoodboardAnalysisCache {
  if (
    !isRecord(value) ||
    !Array.isArray(value.imageUris) ||
    value.imageUris.length < 2 ||
    value.imageUris.length > MAX_IMAGES ||
    !value.imageUris.every(uri => typeof uri === 'string') ||
    !isRecord(value.result)
  ) {
    return false;
  }
  const result = value.result;
  return (
    isRecord(result.colorPalette) &&
    typeof result.typographyDirection === 'string' &&
    typeof result.layoutStyle === 'string' &&
    typeof result.imageTreatment === 'string' &&
    typeof result.suggestedThemeId === 'string' &&
    Array.isArray(result.suggestedSections) &&
    Array.isArray(result.aiSections) &&
    (result.source === 'ai' || result.source === 'fallback')
  );
}

async function isUsableImageUri(uri: string): Promise<boolean> {
  return new Promise(resolve => {
    Image.getSize(uri, () => resolve(true), () => resolve(false));
  });
}

/**
 * Resize an image so its longest edge is at most maxPx, then return the
 * JPEG base64 string.  If the image is already within bounds it is only
 * re-encoded (no upscaling).  Portrait and landscape orientations are both
 * handled correctly by constraining the appropriate axis.
 *
 * For moodboards the default cap is 800 px so that eight images together
 * stay well under the 10 MB server limit (~200 KB each × 8 ≈ 1.6 MB base64).
 */
async function resizeToBase64(uri: string, maxPx = 800): Promise<string> {
  // Resolve original dimensions so we constrain the right axis and never upscale.
  const { width, height } = await new Promise<{ width: number; height: number }>(
    (resolve, reject) =>
      Image.getSize(uri, (w, h) => resolve({ width: w, height: h }), reject),
  );

  const longest = Math.max(width, height);
  const actions =
    longest > maxPx
      ? width >= height
        ? [{ resize: { width: maxPx } }]   // landscape / square
        : [{ resize: { height: maxPx } }]  // portrait
      : [];                                 // already fits — just re-encode

  const result = await manipulateAsync(
    uri,
    actions,
    { compress: 0.75, format: SaveFormat.JPEG, base64: true },
  );
  return result.base64 ?? '';
}

export default function StoreFromMoodboardScreen() {
  const { theme } = useAppTheme();
  const mb = makeStyles(theme);
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN } = useColors();
  const router = useRouter();
  const { user, isLoaded: isUserLoaded } = useUser();
  const headerTopInset = useHeaderTopInset();
  const [imageUris, setImageUris] = useState<string[]>([]);
  const [imageBase64s, setImageBase64s] = useState<string[]>([]);
  const [preparingImages, setPreparingImages] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoringAnalysis, setRestoringAnalysis] = useState(true);
  const [analysisFailure, setAnalysisFailure] = useState<StoreApplyFailure | null>(null);
  const [applyFailure, setApplyFailure] = useState<StoreApplyFailure | null>(null);
  const [result, setResult] = useState<MoodboardAnalysisResult | null>(null);
  const inputChangedRef = useRef(false);
  const cacheKey = user?.id ? `${MOODBOARD_ANALYSIS_CACHE_PREFIX}:${user.id}` : null;

  const clearCachedAnalysis = async () => {
    if (cacheKey) {
      await AsyncStorage.removeItem(cacheKey).catch(() => {});
    }
  };

  useEffect(() => {
    let isMounted = true;

    if (!isUserLoaded) {
      setRestoringAnalysis(true);
      return () => {
        isMounted = false;
      };
    }

    inputChangedRef.current = false;
    setRestoringAnalysis(true);
    setImageUris([]);
    setImageBase64s([]);
    setResult(null);

    if (!cacheKey) {
      setRestoringAnalysis(false);
      return () => {
        isMounted = false;
      };
    }

    const restoreCachedAnalysis = async () => {
      try {
        const raw = await AsyncStorage.getItem(cacheKey);
        if (!raw) return;

        const cached: unknown = JSON.parse(raw);
        if (!isMoodboardAnalysisCache(cached)) {
          await AsyncStorage.removeItem(cacheKey);
          return;
        }

        const allImagesAvailable = (await Promise.all(cached.imageUris.map(isUsableImageUri))).every(Boolean);
        if (!allImagesAvailable) {
          await AsyncStorage.removeItem(cacheKey);
          return;
        }

        const restoredBase64s = await Promise.all(cached.imageUris.map(resizeToBase64));
        if (restoredBase64s.some(base64 => !base64)) {
          await AsyncStorage.removeItem(cacheKey);
          return;
        }

        if (isMounted && !inputChangedRef.current) {
          setImageUris(cached.imageUris);
          setImageBase64s(restoredBase64s);
          setResult(cached.result);
        }
      } catch {
        // This cache only prevents repeat work. Ignore malformed or unavailable storage.
      } finally {
        if (isMounted) setRestoringAnalysis(false);
      }
    };

    void restoreCachedAnalysis();
    return () => {
      isMounted = false;
    };
  }, [cacheKey, isUserLoaded]);

  const addImages = async () => {
    if (preparingImages) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo access to upload mood board images.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: MAX_IMAGES,
      quality: 1,
    });
    if (!res.canceled && res.assets.length > 0) {
      inputChangedRef.current = true;
      void clearCachedAnalysis();
      const newUris = res.assets.map(a => a.uri);
      // Resize each image to ≤1024 px before base64 encoding — keeps total
      // payload under the 10 MB server limit even for 8-image moodboards.
      setResult(null);
      setAnalysisFailure(null);
      setApplyFailure(null);
      setPreparingImages(true);
      try {
        const newB64s = await Promise.all(newUris.map(resizeToBase64));
        if (newB64s.some(base64 => !base64)) {
          throw new Error('One or more images could not be prepared.');
        }
        setImageUris(prev => [...prev, ...newUris].slice(0, MAX_IMAGES));
        setImageBase64s(prev => [...prev, ...newB64s].slice(0, MAX_IMAGES));
      } catch {
        Alert.alert('Could not prepare images', 'Please choose the images again and try once more.');
      } finally {
        setPreparingImages(false);
      }
    }
  };

  const removeImage = (idx: number) => {
    inputChangedRef.current = true;
    void clearCachedAnalysis();
    setImageUris(prev => prev.filter((_, i) => i !== idx));
    setImageBase64s(prev => prev.filter((_, i) => i !== idx));
    setResult(null);
    setAnalysisFailure(null);
  };

  const handleAnalyze = async () => {
    if (restoringAnalysis || preparingImages) return;
    if (imageUris.length < 2) {
      Alert.alert('Need at least 2 images', 'Add more images to your mood board.');
      return;
    }
    setAnalyzing(true);
    setAnalysisFailure(null);
    try {
      const r = await generateFromMoodBoard(imageUris, imageBase64s.filter(Boolean));
      setResult(r);
      if (cacheKey) {
        await AsyncStorage.setItem(
          cacheKey,
          JSON.stringify({ imageUris, result: r } satisfies MoodboardAnalysisCache),
        ).catch(() => {});
      }
    } catch (error) {
      const failure = getStoreApplyFailure(error);
      if (failure.kind === 'payload-too-large') {
        setAnalysisFailure(failure);
      } else {
        Alert.alert('Analysis failed', 'Could not analyze mood board. Please try again.');
      }
    } finally {
      setAnalyzing(false);
    }
  };

  const handleApply = async () => {
    if (restoringAnalysis || preparingImages) return;
    setApplying(true);
    setApplyFailure(null);
    try {
      // applyFromMoodboard maps ALL AI config fields (sections, palette,
      // typography, title, SEO, branding) and awaits backend sync.
      // It throws on failure — we do NOT navigate until it succeeds.
      await applyFromMoodboard(imageUris, imageBase64s.filter(Boolean));
      await clearCachedAnalysis();
      router.push('/store-editor' as never);
    } catch (error) {
      setApplyFailure(getStoreApplyFailure(error));
    } finally {
      setApplying(false);
    }
  };

  return (
    <View style={mb.root}>
      <View style={[mb.header, { paddingTop: headerTopInset + SP.sm }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={mb.backBtn}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        >
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={mb.headerTitle}>Generate from Mood Board</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={mb.scroll}>
        <Text style={mb.subtitle}>
          Upload 2–8 images that represent your brand aesthetic. AI will suggest colors, typography, and a theme.
        </Text>

        {/* AI badge */}
        <BrandthreadCard style={[mb.card, { borderColor: PURPLE_DIM, backgroundColor: theme.accentDim }]}>
          <View style={mb.bannerRow}>
            <Feather name="zap" size={ICON.sm} color={PURPLE_LIGHT} />
            <Text style={[mb.bannerText, { color: PURPLE_LIGHT }]}>
              Powered by GPT-4 — AI reads your mood board and extracts a brand direction: palette, layout style, image treatment, and recommended sections.
            </Text>
          </View>
        </BrandthreadCard>

        {/* Image Count */}
        <Text style={mb.countLabel}>{imageUris.length} of {MAX_IMAGES} images</Text>

        {/* Image Grid */}
        <View style={mb.grid}>
          {imageUris.map((uri, idx) => (
            <View key={uri + idx} style={mb.imageWrap}>
              <Image source={{ uri }} style={mb.gridImage} resizeMode="cover" />
              <TouchableOpacity
                style={mb.removeBtn}
                onPress={() => removeImage(idx)}
                disabled={preparingImages}
              >
                <Feather name="x" size={12} color={FG} />
              </TouchableOpacity>
            </View>
          ))}
          {imageUris.length < MAX_IMAGES && (
            <TouchableOpacity
              testID="store-from-moodboard-add"
              style={[mb.addTile, preparingImages && mb.disabledTile]}
              onPress={addImages}
              activeOpacity={0.7}
              disabled={preparingImages}
              accessibilityState={{ disabled: preparingImages }}
            >
              <Feather name="plus" size={ICON.md} color={PURPLE_LIGHT} />
              <Text style={mb.addTileLabel}>Add</Text>
            </TouchableOpacity>
          )}
        </View>

        <PrimaryButton
          label={analyzing ? 'Analyzing...' : 'Analyze Mood Board'}
          onPress={handleAnalyze}
          loading={analyzing}
          disabled={imageUris.length < 2 || restoringAnalysis || preparingImages}
          icon="zap"
          style={mb.analyzeBtn}
        />

        {(preparingImages || analyzing || restoringAnalysis) && (
          <View style={mb.loadingRow}>
            <ActivityIndicator color={PURPLE} />
            <Text style={mb.loadingText}>
              {preparingImages
                ? 'Preparing images...'
                : restoringAnalysis
                  ? 'Restoring your latest analysis...'
                  : 'Analyzing your mood board with AI...'}
            </Text>
          </View>
        )}

        {analysisFailure && (
          <BrandthreadCard style={[mb.card, mb.importFailureCard]}>
            <View style={mb.bannerRow}>
              <Feather name="image" size={ICON.sm} color={PURPLE_LIGHT} />
              <View style={mb.applyFailureCopy}>
                <Text style={mb.applyFailureTitle}>Images too large</Text>
                <Text style={mb.applyFailureText}>{analysisFailure.message}</Text>
              </View>
            </View>
            <TouchableOpacity
              style={mb.applyRetryBtn}
              onPress={handleAnalyze}
              disabled={analyzing || restoringAnalysis || preparingImages}
              accessibilityRole="button"
              accessibilityLabel="Retry analyzing this mood board"
            >
              <Feather name="refresh-cw" size={ICON.sm} color={PURPLE_LIGHT} />
              <Text style={mb.applyRetryText}>Retry analysis</Text>
            </TouchableOpacity>
          </BrandthreadCard>
        )}

        {result && (
          <>
            {/* Fallback warning */}
            {result.source === 'fallback' && (
              <BrandthreadCard style={[mb.card, { borderColor: 'rgba(251,191,36,0.4)', backgroundColor: 'rgba(251,191,36,0.07)' }]}>
                <View style={mb.bannerRow}>
                  <Feather name="alert-triangle" size={ICON.sm} color="#fbbf24" />
                  <Text style={[mb.bannerText, { color: '#fbbf24' }]}>
                    We couldn't fully analyze your images — showing a suggested starting point.
                  </Text>
                </View>
                <TouchableOpacity style={mb.retryBtn} onPress={handleAnalyze} disabled={analyzing || restoringAnalysis}>
                  <Feather name="refresh-cw" size={12} color="#fbbf24" />
                  <Text style={mb.retryText}>Retry Analysis</Text>
                </TouchableOpacity>
              </BrandthreadCard>
            )}

            {/* Color Palette */}
            <BrandthreadCard style={mb.card}>
              <Text style={mb.resultLabel}>Color Palette</Text>
              <View style={mb.swatchRow}>
                {Object.values(result.colorPalette).map((col, i) => (
                  <View key={i} style={[mb.swatch, { backgroundColor: col }]} />
                ))}
              </View>
            </BrandthreadCard>

            {/* Layout + Image Treatment */}
            <BrandthreadCard style={mb.card}>
              <Text style={mb.resultLabel}>Layout Style</Text>
              <Text style={mb.resultValue}>{result.layoutStyle}</Text>
              <View style={mb.divider} />
              <Text style={mb.resultLabel}>Image Treatment</Text>
              <Text style={mb.resultValue}>{result.imageTreatment}</Text>
            </BrandthreadCard>

            {/* Typography */}
            <BrandthreadCard style={mb.card}>
              <Text style={mb.resultLabel}>Typography Direction</Text>
              <StatusBadge label={result.typographyDirection} variant="info" />
            </BrandthreadCard>

            {/* Suggested Theme */}
            <BrandthreadCard style={mb.card}>
              <Text style={mb.resultLabel}>Suggested Theme</Text>
              <View style={mb.rowWrap}>
                <StatusBadge label={result.suggestedThemeId} variant="purple" />
                <TouchableOpacity onPress={() => router.push('/store-theme-picker' as never)}>
                  <Text style={mb.previewLink}>Preview →</Text>
                </TouchableOpacity>
              </View>
            </BrandthreadCard>

            {/* Suggested Sections */}
            <BrandthreadCard style={mb.card}>
              <Text style={mb.resultLabel}>Suggested Sections</Text>
              <View style={mb.chipWrap}>
                {result.suggestedSections.map(sec => (
                  <StatusBadge key={sec} label={sec.replace(/_/g, ' ')} variant="neutral" />
                ))}
              </View>
            </BrandthreadCard>

            {applyFailure && (
              <BrandthreadCard style={[mb.card, mb.applyFailureCard]}>
                <View style={mb.bannerRow}>
                  <Feather
                    name={applyFailure.kind === 'network' ? 'wifi-off' : 'server'}
                    size={ICON.sm}
                    color={PURPLE_LIGHT}
                  />
                  <View style={mb.applyFailureCopy}>
                    <Text style={mb.applyFailureTitle}>
                      {applyFailure.kind === 'network'
                        ? 'Connection problem'
                        : applyFailure.kind === 'payload-too-large'
                          ? 'Images too large'
                        : applyFailure.kind === 'server'
                          ? 'Store service problem'
                          : 'Couldn’t apply design'}
                    </Text>
                    <Text style={mb.applyFailureText}>{applyFailure.message}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={mb.applyRetryBtn}
                  onPress={handleApply}
                  disabled={applying || restoringAnalysis || preparingImages}
                  accessibilityRole="button"
                  accessibilityLabel="Retry applying these store settings"
                >
                  <Feather name="refresh-cw" size={ICON.sm} color={PURPLE_LIGHT} />
                  <Text style={mb.applyRetryText}>Retry apply</Text>
                </TouchableOpacity>
              </BrandthreadCard>
            )}

            <PrimaryButton
              label={applying ? 'Applying...' : 'Apply These Settings'}
              loading={applying}
              disabled={applying || restoringAnalysis || preparingImages}
              onPress={handleApply}
              style={mb.actionBtn}
              icon="check"
            />
            <SecondaryButton
              label="Generate Full Store"
              onPress={() => router.push('/store-generate' as never)}
              disabled={preparingImages}
              style={mb.actionBtn}
              icon="zap"
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const PURPLE_DIM = theme.accentDim;
  const PURPLE_LIGHT = theme.accentLight;
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    paddingHorizontal: SP.md, paddingVertical: SP.sm,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  backBtn: {
    width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: CARD,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG },
  scroll: { paddingBottom: 60, paddingTop: SP.md },
  subtitle: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginHorizontal: SP.md, marginBottom: SP.md, lineHeight: 20 },
  card: { marginHorizontal: SP.md, marginBottom: SP.sm, gap: SP.md },
  bannerRow: { flexDirection: 'row', gap: SP.sm, alignItems: 'flex-start' },
  bannerText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 18 },
  countLabel: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED, textAlign: 'center', marginBottom: SP.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginHorizontal: SP.md, marginBottom: SP.md },
  imageWrap: { position: 'relative' },
  gridImage: { width: 120, height: 120, borderRadius: RADIUS.md },
  removeBtn: {
    position: 'absolute', top: 4, right: 4, width: 22, height: 22,
    borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  addTile: {
    width: 120, height: 120, borderRadius: RADIUS.md,
    borderWidth: 2, borderColor: PURPLE_DIM, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
   disabledTile: { opacity: 0.5 },
  addTileLabel: { fontSize: FS.xs, fontFamily: FONT.medium, color: PURPLE_LIGHT },
  analyzeBtn: { marginHorizontal: SP.md, marginBottom: SP.sm },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, justifyContent: 'center', padding: SP.md },
  loadingText: { fontSize: FS.base, fontFamily: FONT.medium, color: MUTED },
  resultLabel: { fontSize: FS.sm, fontFamily: FONT.bold, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5 },
  resultValue: { fontSize: FS.base, fontFamily: FONT.regular, color: FG },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.07)' },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  swatch: { width: 44, height: 44, borderRadius: RADIUS.sm },
  rowWrap: { flexDirection: 'row', alignItems: 'center', gap: SP.md },
  previewLink: { fontSize: FS.sm, fontFamily: FONT.semibold, color: PURPLE_LIGHT },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  actionBtn: { marginHorizontal: SP.md, marginBottom: SP.sm },
  applyFailureCard: { borderColor: PURPLE_DIM, backgroundColor: SURFACE },
  importFailureCard: { borderColor: PURPLE_DIM, backgroundColor: SURFACE },
  applyFailureCopy: { flex: 1, gap: 3 },
  applyFailureTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  applyFailureText: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 18 },
  applyRetryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: SP.xs,
    alignSelf: 'flex-start', paddingVertical: SP.xs, paddingHorizontal: SP.sm,
  },
  applyRetryText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: PURPLE_LIGHT },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', marginTop: SP.xs,
    paddingVertical: 4, paddingHorizontal: 8,
    borderRadius: RADIUS.xs, borderWidth: 1, borderColor: 'rgba(251,191,36,0.35)',
  },
  retryText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: '#fbbf24' },
  });
};
