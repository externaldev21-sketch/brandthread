import React, { useState } from 'react';
import {
  View, Text, ScrollView, Image, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';
import {
  BG, CARD, SURFACE, BORDER,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, SUCCESS,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { BrandthreadCard, PrimaryButton, SecondaryButton, StatusBadge } from '@/components/BrandthreadUI';
import { generateFromLogo, applyGenerationResult, generateStoreFromAnswers } from '@/services/storeService';
import { StoreColorPalette, TypographyStyle, BrandMood } from '@/services/storeTypes';

export default function StoreFromLogoScreen() {
  const router = useRouter();
  const [logoUri, setLogoUri] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<{
    dominantColors: string[];
    suggestedPalette: StoreColorPalette;
    suggestedThemeId: string;
    suggestedTypography: TypographyStyle;
    brandMoods: BrandMood[];
  } | null>(null);

  const pickLogo = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!res.canceled && res.assets[0]) {
      setLogoUri(res.assets[0].uri);
      setResult(null);
    }
  };

  const handleAnalyze = async () => {
    if (!logoUri) return;
    setAnalyzing(true);
    try {
      const r = await generateFromLogo(logoUri);
      setResult(r);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <View style={fl.root}>
      <View style={fl.header}>
        <TouchableOpacity onPress={() => router.back()} style={fl.backBtn}>
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={fl.headerTitle}>Generate from Logo</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={fl.scroll}>
        <Text style={fl.subtitle}>Upload your brand logo. We'll extract your colors and suggest a matching storefront.</Text>

        {/* Upload Area */}
        <TouchableOpacity style={fl.uploadArea} onPress={pickLogo} activeOpacity={0.7}>
          {logoUri ? (
            <>
              <Image source={{ uri: logoUri }} style={fl.logoImage} resizeMode="contain" />
              <Text style={fl.changeText}>Tap to change</Text>
            </>
          ) : (
            <>
              <Feather name="upload" size={ICON.xxl} color={PURPLE} />
              <Text style={fl.uploadLabel}>Tap to upload logo</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Demo Notice */}
        <BrandthreadCard style={[fl.card, { borderColor: CYAN, backgroundColor: CYAN_DIM }]}>
          <View style={fl.bannerRow}>
            <Feather name="info" size={ICON.sm} color={CYAN} />
            <Text style={[fl.bannerText, { color: CYAN }]}>
              Color extraction and mood analysis are simulated in this demo. Connect a vision API for real analysis.
            </Text>
          </View>
        </BrandthreadCard>

        {logoUri && !result && (
          <PrimaryButton
            label={analyzing ? 'Analyzing...' : 'Analyze Logo'}
            onPress={handleAnalyze}
            loading={analyzing}
            icon="zap"
            style={fl.analyzeBtn}
          />
        )}

        {analyzing && (
          <View style={fl.loadingRow}>
            <ActivityIndicator color={PURPLE} />
            <Text style={fl.loadingText}>Analyzing your logo...</Text>
          </View>
        )}

        {result && (
          <>
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
            <BrandthreadCard style={fl.card}>
              <Text style={fl.resultSectionLabel}>Brand Moods Detected</Text>
              <View style={fl.chipWrap}>
                {result.brandMoods.map(m => (
                  <StatusBadge key={m} label={m} variant="neutral" />
                ))}
              </View>
            </BrandthreadCard>

            <PrimaryButton
              label="Use These Settings"
              onPress={() => router.push('/store-editor' as never)}
              style={fl.actionBtn}
            />
            <SecondaryButton
              label="Generate Full Store with AI"
              onPress={() => router.push('/store-generate' as never)}
              style={fl.actionBtn}
              icon="zap"
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const fl = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
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
  subtitle: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginHorizontal: SP.md, marginBottom: SP.md },
  uploadArea: {
    width: 200, height: 200, alignSelf: 'center',
    backgroundColor: CARD, borderRadius: RADIUS.lg,
    borderWidth: 2, borderColor: PURPLE_DIM, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: SP.sm,
    marginBottom: SP.md,
  },
  logoImage: { width: 160, height: 160, borderRadius: RADIUS.md },
  uploadLabel: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  changeText: { fontSize: FS.xs, fontFamily: FONT.medium, color: PURPLE_LIGHT },
  card: { marginHorizontal: SP.md, marginBottom: SP.sm, gap: SP.md },
  bannerRow: { flexDirection: 'row', gap: SP.sm, alignItems: 'flex-start' },
  bannerText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 18 },
  analyzeBtn: { marginHorizontal: SP.md, marginBottom: SP.md },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, justifyContent: 'center', padding: SP.md },
  loadingText: { fontSize: FS.base, fontFamily: FONT.medium, color: MUTED },
  resultSectionLabel: { fontSize: FS.sm, fontFamily: FONT.bold, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5 },
  swatchRow: { flexDirection: 'row', gap: SP.md },
  swatch: { width: 48, height: 48, borderRadius: RADIUS.sm },
  paletteRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  paletteItem: { alignItems: 'center', gap: 4 },
  paletteSwatch: { width: 36, height: 36, borderRadius: RADIUS.xs },
  paletteLabel: { fontSize: 9, fontFamily: FONT.regular, color: MUTED },
  rowWrap: { flexDirection: 'row', alignItems: 'center', gap: SP.md, flexWrap: 'wrap' },
  previewLink: { fontSize: FS.sm, fontFamily: FONT.semibold, color: PURPLE_LIGHT },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  actionBtn: { marginHorizontal: SP.md, marginBottom: SP.sm },
});
