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
import { Header } from '@/components/layout';
import {
  BG, CARD, SURFACE, BORDER,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, SUCCESS, PURPLE as ACCENT,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { BrandthreadCard, PrimaryButton, SecondaryButton, StatusBadge } from '@/components/BrandthreadUI';
import {
  generateFromLogo, applyFromLogo, getStoreApplyFailure, StoreApplyFailure,
} from '@/services/storeService';
import { StoreColorPalette, TypographyStyle, BrandMood } from '@/services/storeTypes';

const LOGO_ANALYSIS_CACHE_PREFIX = 'bt:store:logo-analysis:transient:v1';

type LogoAnalysisResult = {
  dominantColors: string[];
  suggestedPalette: StoreColorPalette;
  suggestedThemeId: string;
  suggestedTypography: TypographyStyle;
  brandMoods: BrandMood[];
  aiSections: import('@/services/storeTypes').StoreSection[];
  source: 'ai' | 'fallback';
};

type LogoAnalysisCache = {
  logoUri: string;
  result: LogoAnalysisResult;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLogoAnalysisCache(value: unknown): value is LogoAnalysisCache {
  if (!isRecord(value) || typeof value.logoUri !== 'string' || !isRecord(value.result)) {
    return false;
  }
  const result = value.result;
  return (
    Array.isArray(result.dominantColors) &&
    isRecord(result.suggestedPalette) &&
    typeof result.suggestedThemeId === 'string' &&
    typeof result.suggestedTypography === 'string' &&
    Array.isArray(result.brandMoods) &&
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
 */
async function resizeToBase64(uri: string, maxPx = 1024): Promise<string> {
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
    { compress: 0.8, format: SaveFormat.JPEG, base64: true },
  );
  return result.base64 ?? '';
}

export default function StoreFromLogoScreen() {
  const { theme } = useAppTheme();
  const fl = makeStyles(theme);
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN } = useColors();
  const router = useRouter();
  const { user, isLoaded: isUserLoaded } = useUser();
  const [logoUri, setLogoUri] = useState<string | null>(null);
  const [logoBase64, setLogoBase64] = useState<string | null>(null);
  const [preparingLogo, setPreparingLogo] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoringAnalysis, setRestoringAnalysis] = useState(true);
  const [analysisFailure, setAnalysisFailure] = useState<StoreApplyFailure | null>(null);
  const [applyFailure, setApplyFailure] = useState<StoreApplyFailure | null>(null);
  const [result, setResult] = useState<LogoAnalysisResult | null>(null);
  const inputChangedRef = useRef(false);
  const cacheKey = user?.id ? `${LOGO_ANALYSIS_CACHE_PREFIX}:${user.id}` : null;

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
    setLogoUri(null);
    setLogoBase64(null);
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
        if (!isLogoAnalysisCache(cached) || !(await isUsableImageUri(cached.logoUri))) {
          await AsyncStorage.removeItem(cacheKey);
          return;
        }

        const restoredBase64 = await resizeToBase64(cached.logoUri);
        if (!restoredBase64) {
          await AsyncStorage.removeItem(cacheKey);
          return;
        }

        if (isMounted && !inputChangedRef.current) {
          setLogoUri(cached.logoUri);
          setLogoBase64(restoredBase64);
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

  const pickLogo = async () => {
    if (preparingLogo) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo access to upload your logo.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (!res.canceled && res.assets[0]) {
      inputChangedRef.current = true;
      void clearCachedAnalysis();
      const uri = res.assets[0].uri;
      // Resize to ≤1024 px before encoding — keeps payload well under the 10 MB
      // server limit and reduces GPT-5 vision latency (detail:"low" only needs ~512 px).
      setResult(null);
      setAnalysisFailure(null);
      setApplyFailure(null);
      setPreparingLogo(true);
      try {
        const b64 = await resizeToBase64(uri);
        if (!b64) {
          throw new Error('The logo could not be prepared.');
        }
        setLogoUri(uri);
        setLogoBase64(b64);
      } catch {
        Alert.alert('Could not prepare logo', 'Please choose the logo again and try once more.');
      } finally {
        setPreparingLogo(false);
      }
    }
  };

  const handleAnalyze = async () => {
    if (!logoUri || restoringAnalysis || preparingLogo) return;
    setAnalyzing(true);
    setAnalysisFailure(null);
    try {
      const r = await generateFromLogo(logoUri, logoBase64 ?? undefined);
      setResult(r);
      if (cacheKey) {
        await AsyncStorage.setItem(
          cacheKey,
          JSON.stringify({ logoUri, result: r } satisfies LogoAnalysisCache),
        ).catch(() => {});
      }
    } catch (error) {
      const failure = getStoreApplyFailure(error);
      if (failure.kind === 'payload-too-large') {
        setAnalysisFailure(failure);
      } else {
        Alert.alert('Analysis failed', 'Could not analyze logo. Please try again.');
      }
    } finally {
      setAnalyzing(false);
    }
  };

  const handleApply = async () => {
    if (!logoUri || restoringAnalysis || preparingLogo) return;
    setApplying(true);
    setApplyFailure(null);
    try {
      // applyFromLogo calls the vision API, maps ALL config fields (sections,
      // palette, typography, title, SEO, branding), and awaits backend sync.
      // It throws on failure so we never navigate as though it succeeded.
      await applyFromLogo(logoUri, logoBase64);
      await clearCachedAnalysis();
      router.push('/store-editor' as never);
    } catch (error) {
      setApplyFailure(getStoreApplyFailure(error));
    } finally {
      setApplying(false);
    }
  };

  return (
    <View style={fl.root}>
      <Header title="Generate from Logo" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={fl.scroll}>
        <Text style={fl.subtitle}>
          Upload your brand logo. AI will extract your colors and suggest a matching storefront style.
        </Text>

        {/* AI badge */}
        <BrandthreadCard style={[fl.card, { borderColor: PURPLE_DIM, backgroundColor: theme.accentDim }]}>
          <View style={fl.bannerRow}>
            <Feather name="zap" size={ICON.sm} color={PURPLE_LIGHT} />
            <Text style={[fl.bannerText, { color: PURPLE_LIGHT }]}>
              We'll pull your colors, type and vibe from your logo.
            </Text>
          </View>
        </BrandthreadCard>

        {/* Upload Area */}
        <TouchableOpacity
          testID="store-from-logo-upload"
          style={[fl.uploadArea, preparingLogo && fl.disabledUploadArea]}
          onPress={pickLogo}
          activeOpacity={0.7}
          disabled={preparingLogo}
          accessibilityState={{ disabled: preparingLogo }}
        >
          {preparingLogo ? (
            <>
              <ActivityIndicator color={PURPLE} size="large" />
              <Text style={fl.preparingText}>Preparing logo...</Text>
            </>
          ) : logoUri ? (
            <>
              <Image source={{ uri: logoUri }} style={fl.logoImage} resizeMode="contain" />
              <Text style={fl.changeText}>Tap to change</Text>
            </>
          ) : (
            <>
              <Feather name="upload" size={ICON.xxl} color={PURPLE} />
              <Text style={fl.uploadLabel}>Tap to upload logo</Text>
              <Text style={fl.uploadSub}>PNG, JPG, or SVG</Text>
            </>
          )}
        </TouchableOpacity>

        {logoUri && !result && !preparingLogo && !analyzing && !restoringAnalysis && (
          <PrimaryButton
            label="Analyze Logo"
            onPress={handleAnalyze}
            icon="zap"
            style={fl.analyzeBtn}
          />
        )}

        {(analyzing || restoringAnalysis) && (
          <View style={fl.loadingRow}>
            <ActivityIndicator color={PURPLE} />
            <Text style={fl.loadingText}>
              {restoringAnalysis ? 'Restoring your latest analysis...' : 'Analyzing your logo with AI...'}
            </Text>
          </View>
        )}

        {analysisFailure && (
          <BrandthreadCard style={[fl.card, fl.importFailureCard]}>
            <View style={fl.bannerRow}>
              <Feather name="image" size={ICON.sm} color={PURPLE_LIGHT} />
              <View style={fl.applyFailureCopy}>
                <Text style={fl.applyFailureTitle}>Image too large</Text>
                <Text style={fl.applyFailureText}>{analysisFailure.message}</Text>
              </View>
            </View>
            <TouchableOpacity
              style={fl.applyRetryBtn}
              onPress={handleAnalyze}
              disabled={analyzing || restoringAnalysis || preparingLogo}
              accessibilityRole="button"
              accessibilityLabel="Retry analyzing this logo"
            >
              <Feather name="refresh-cw" size={ICON.sm} color={PURPLE_LIGHT} />
              <Text style={fl.applyRetryText}>Retry analysis</Text>
            </TouchableOpacity>
          </BrandthreadCard>
        )}

        {result && (
          <>
            {/* Fallback warning */}
            {result.source === 'fallback' && (
              <BrandthreadCard style={[fl.card, { borderColor: 'rgba(251,191,36,0.4)', backgroundColor: 'rgba(251,191,36,0.07)' }]}>
                <View style={fl.bannerRow}>
                  <Feather name="alert-triangle" size={ICON.sm} color="#fbbf24" />
                  <Text style={[fl.bannerText, { color: '#fbbf24' }]}>
                    We couldn't fully analyze your image — showing a suggested starting point.
                  </Text>
                </View>
                <TouchableOpacity style={fl.retryBtn} onPress={handleAnalyze} disabled={analyzing || restoringAnalysis}>
                  <Feather name="refresh-cw" size={12} color="#fbbf24" />
                  <Text style={fl.retryText}>Retry Analysis</Text>
                </TouchableOpacity>
              </BrandthreadCard>
            )}

            {/* Detected Colors */}
            <BrandthreadCard style={fl.card}>
              <Text style={fl.resultSectionLabel}>Detected Colors</Text>
              <View style={fl.swatchRow}>
                {result.dominantColors.slice(0, 3).map((col, i) => (
                  <View key={i} style={[fl.swatch, { backgroundColor: col }]} />
                ))}
              </View>
            </BrandthreadCard>

            {/* Suggested Palette */}
            <BrandthreadCard style={fl.card}>
              <Text style={fl.resultSectionLabel}>Suggested Palette</Text>
              <View style={fl.paletteRow}>
                {Object.entries(result.suggestedPalette).map(([key, val]) => (
                  <View key={key} style={fl.paletteItem}>
                    <View style={[fl.paletteSwatch, { backgroundColor: val }]} />
                    <Text style={fl.paletteLabel}>{key}</Text>
                  </View>
                ))}
              </View>
            </BrandthreadCard>

            {/* Suggested Theme */}
            <BrandthreadCard style={fl.card}>
              <Text style={fl.resultSectionLabel}>Suggested Theme</Text>
              <View style={fl.rowWrap}>
                <StatusBadge label={result.suggestedThemeId} variant="purple" />
                <TouchableOpacity onPress={() => router.push('/store-theme-picker' as never)}>
                  <Text style={fl.previewLink}>Preview Theme →</Text>
                </TouchableOpacity>
              </View>
            </BrandthreadCard>

            {/* Typography */}
            <BrandthreadCard style={fl.card}>
              <Text style={fl.resultSectionLabel}>Suggested Typography</Text>
              <StatusBadge label={result.suggestedTypography} variant="info" />
            </BrandthreadCard>

            {/* Brand Moods */}
            {result.brandMoods.length > 0 && (
              <BrandthreadCard style={fl.card}>
                <Text style={fl.resultSectionLabel}>Brand Moods</Text>
                <View style={fl.chipWrap}>
                  {result.brandMoods.map(m => (
                    <StatusBadge key={m} label={m} variant="neutral" />
                  ))}
                </View>
              </BrandthreadCard>
            )}

            {applyFailure && (
              <BrandthreadCard style={[fl.card, fl.applyFailureCard]}>
                <View style={fl.bannerRow}>
                  <Feather
                    name={applyFailure.kind === 'network' ? 'wifi-off' : 'server'}
                    size={ICON.sm}
                    color={PURPLE_LIGHT}
                  />
                  <View style={fl.applyFailureCopy}>
                    <Text style={fl.applyFailureTitle}>
                      {applyFailure.kind === 'network'
                        ? 'Connection problem'
                        : applyFailure.kind === 'payload-too-large'
                          ? 'Image too large'
                        : applyFailure.kind === 'server'
                          ? 'Store service problem'
                          : 'Couldn’t apply design'}
                    </Text>
                    <Text style={fl.applyFailureText}>{applyFailure.message}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={fl.applyRetryBtn}
                  onPress={handleApply}
                  disabled={applying || restoringAnalysis || preparingLogo}
                  accessibilityRole="button"
                  accessibilityLabel="Retry applying this store design"
                >
                  <Feather name="refresh-cw" size={ICON.sm} color={PURPLE_LIGHT} />
                  <Text style={fl.applyRetryText}>Retry apply</Text>
                </TouchableOpacity>
              </BrandthreadCard>
            )}

            <PrimaryButton
              label={applying ? 'Applying...' : 'Apply to Store'}
              onPress={handleApply}
              loading={applying}
              disabled={!result || applying || restoringAnalysis || preparingLogo}
              style={fl.actionBtn}
              icon="check"
            />
            <SecondaryButton
              label="Generate Full Store with AI"
              onPress={() => router.push('/store-generate' as never)}
              disabled={preparingLogo}
              style={fl.actionBtn}
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
  scroll: { paddingBottom: 60, paddingTop: SP.md },
  subtitle: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginHorizontal: SP.md, marginBottom: SP.md, lineHeight: 20 },
  card: { marginHorizontal: SP.md, marginBottom: SP.sm, gap: SP.md },
  bannerRow: { flexDirection: 'row', gap: SP.sm, alignItems: 'flex-start' },
  bannerText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 18 },
  uploadArea: {
    width: 200, height: 200, alignSelf: 'center',
    backgroundColor: CARD, borderRadius: RADIUS.lg,
    borderWidth: 2, borderColor: PURPLE_DIM, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: SP.sm,
    marginBottom: SP.md,
  },
   disabledUploadArea: { opacity: 0.75 },
  logoImage: { width: 160, height: 160, borderRadius: RADIUS.md },
  uploadLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
  uploadSub: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  changeText: { fontSize: FS.xs, fontFamily: FONT.medium, color: PURPLE_LIGHT },
   preparingText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
  analyzeBtn: { marginHorizontal: SP.md, marginBottom: SP.md },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, justifyContent: 'center', padding: SP.md },
  loadingText: { fontSize: FS.base, fontFamily: FONT.medium, color: MUTED },
  resultSectionLabel: { fontSize: FS.sm, fontFamily: FONT.bold, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5 },
  swatchRow: { flexDirection: 'row', gap: SP.md },
  swatch: { width: 48, height: 48, borderRadius: RADIUS.sm },
  paletteRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  paletteItem: { alignItems: 'center', gap: 4 },
  paletteSwatch: { width: 36, height: 36, borderRadius: RADIUS.xs },
  paletteLabel: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  rowWrap: { flexDirection: 'row', alignItems: 'center', gap: SP.md, flexWrap: 'wrap' },
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
