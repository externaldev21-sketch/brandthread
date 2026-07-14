import React, { useState } from 'react';
import {
  View, Text, ScrollView, Image, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';
import {
  BG, CARD, SURFACE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { BrandthreadCard, PrimaryButton, SecondaryButton, StatusBadge } from '@/components/BrandthreadUI';
import { generateFromMoodBoard } from '@/services/storeService';
import { StoreColorPalette, StoreSectionType } from '@/services/storeTypes';

const MAX_IMAGES = 8;

export default function StoreFromMoodboardScreen() {
  const router = useRouter();
  const [imageUris, setImageUris] = useState<string[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<{
    colorPalette: StoreColorPalette;
    typographyDirection: string;
    layoutStyle: string;
    imageTreatment: string;
    suggestedThemeId: string;
    suggestedSections: StoreSectionType[];
  } | null>(null);

  const addImages = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: MAX_IMAGES,
      quality: 0.8,
    });
    if (!res.canceled && res.assets.length > 0) {
      const newUris = res.assets.map(a => a.uri);
      setImageUris(prev => [...prev, ...newUris].slice(0, MAX_IMAGES));
      setResult(null);
    }
  };

  const removeImage = (idx: number) => {
    setImageUris(prev => prev.filter((_, i) => i !== idx));
    setResult(null);
  };

  const handleAnalyze = async () => {
    if (imageUris.length < 2) {
      Alert.alert('Need at least 2 images', 'Add more images to your mood board.');
      return;
    }
    setAnalyzing(true);
    try {
      const r = await generateFromMoodBoard(imageUris);
      setResult(r);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <View style={mb.root}>
      <View style={mb.header}>
        <TouchableOpacity onPress={() => router.back()} style={mb.backBtn}>
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={mb.headerTitle}>Generate from Mood Board</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={mb.scroll}>
        <Text style={mb.subtitle}>
          Upload images that represent your brand aesthetic. We'll suggest colors, typography, and a theme.
        </Text>

        {/* Demo Notice */}
        <BrandthreadCard style={[mb.card, { borderColor: CYAN, backgroundColor: CYAN_DIM }]}>
          <View style={mb.bannerRow}>
            <Feather name="info" size={ICON.sm} color={CYAN} />
            <Text style={[mb.bannerText, { color: CYAN }]}>
              Mood board analysis is simulated in this demo. Add a vision API for real extraction.
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
              <TouchableOpacity style={mb.removeBtn} onPress={() => removeImage(idx)}>
                <Feather name="x" size={12} color={FG} />
              </TouchableOpacity>
            </View>
          ))}
          {imageUris.length < MAX_IMAGES && (
            <TouchableOpacity style={mb.addTile} onPress={addImages} activeOpacity={0.7}>
              <Feather name="plus" size={ICON.md} color={PURPLE_LIGHT} />
              <Text style={mb.addTileLabel}>Add</Text>
            </TouchableOpacity>
          )}
        </View>

        <PrimaryButton
          label={analyzing ? 'Analyzing...' : 'Analyze Mood Board'}
          onPress={handleAnalyze}
          loading={analyzing}
          disabled={imageUris.length < 2}
          icon="zap"
          style={mb.analyzeBtn}
        />

        {analyzing && (
          <View style={mb.loadingRow}>
            <ActivityIndicator color={PURPLE} />
            <Text style={mb.loadingText}>Analyzing your mood board...</Text>
          </View>
        )}

        {result && (
          <>
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

            <PrimaryButton
              label="Apply These Settings"
              onPress={() => router.push('/store-editor' as never)}
              style={mb.actionBtn}
            />
            <SecondaryButton
              label="Generate Full Store"
              onPress={() => router.push('/store-generate' as never)}
              style={mb.actionBtn}
              icon="zap"
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const mb = StyleSheet.create({
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
});
