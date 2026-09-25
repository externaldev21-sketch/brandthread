/**
 * Brandthread Design Studio — Edit with Prompt
 * Route: /design-prompt-edit
 */
import React, { useState } from 'react';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Switch, Alert, ActivityIndicator, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';

import {
  FONT, FS, SP, RADIUS, ICON, OVERLAY,
} from '@/lib/theme';
import {
  BrandthreadScreen, BrandthreadHeader, BrandthreadCard,
  GradientCard, PrimaryButton, SecondaryButton, SectionHeader, FormInput,
} from '@/components/BrandthreadUI';
import { applyPromptEdit } from '@/services/designService';
import type { AIGenerationResult } from '@/services/designTypes';

const EXAMPLE_PROMPTS = [
  'Make the background black',
  'Change hoodie color to gray',
  'Add dramatic lighting',
  'Remove wrinkles',
  'Make image look like a campaign photo',
  'Put the model in a studio',
];

const RECENT_PROJECTS = [
  'Summer Drop Hoodie',
  'Logo Tee — White',
  'Fall Collection Jacket',
  'Streetwear Lookbook',
];

export default function DesignPromptEditScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT } = theme;
  const s = createStyles(theme);
  const router = useRouter();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [preserveProduct, setPreserveProduct] = useState(true);
  const [preserveLogo, setPreserveLogo] = useState(true);
  const [preserveGarmentColor, setPreserveGarmentColor] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<AIGenerationResult | null>(null);
  const [showComparison, setShowComparison] = useState(false);

  async function pickImage() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (!res.canceled && res.assets[0]) {
      setImageUri(res.assets[0].uri);
    }
  }

  function chooseFromRecent() {
    Alert.alert(
      'Recent Projects',
      'Choose a project to edit',
      [
        ...RECENT_PROJECTS.map((p) => ({
          text: p,
          onPress: () => setImageUri(`mock://project/${p.replace(/\s/g, '-').toLowerCase()}`),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  }

  async function handleGenerate() {
    if (!imageUri || imageUri.startsWith('mock://')) {
      Alert.alert('Choose a source image', 'Upload the real image you want to edit.');
      return;
    }
    if (!prompt.trim()) {
      Alert.alert('Add a prompt', 'Describe the edit you want to make.');
      return;
    }
    setIsGenerating(true);
    try {
      const res = await applyPromptEdit({
        imageUri: imageUri ?? '',
        prompt,
        preserveProduct,
        preserveLogo,
        preserveGarmentColor,
      });
      setResult(res);
    } catch {
      Alert.alert('Error', 'Generation failed. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <BrandthreadScreen>
      <BrandthreadHeader title="Edit with Prompt" onBack={() => router.back()} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* Upload Zone */}
        <SectionHeader title="Source image" style={s.sectionHdr} />
        <BrandthreadCard style={s.uploadCard}>
          {imageUri && !imageUri.startsWith('mock://') ? (
            <Image source={{ uri: imageUri }} style={s.preview} resizeMode="cover" />
          ) : imageUri ? (
            <LinearGradient colors={theme.glowGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.mockPreview}>
              <Feather name="image" size={ICON.xl} color={PURPLE_LIGHT} />
              <Text style={s.mockLabel}>Project image loaded</Text>
            </LinearGradient>
          ) : (
            <View style={s.uploadZone}>
              <Feather name="upload-cloud" size={ICON.xxl} color={theme.muted} />
              <Text style={s.uploadTitle}>Upload or choose image</Text>
              <Text style={s.uploadSub}>JPG, PNG, WEBP up to 20MB</Text>
            </View>
          )}
          <View style={s.uploadActions}>
            <PrimaryButton label={imageUri ? 'Change image' : 'Upload image'} onPress={pickImage} icon="upload" style={s.uploadBtn} />
            <SecondaryButton label="Recent projects" onPress={chooseFromRecent} icon="folder" style={s.uploadBtn} />
          </View>
        </BrandthreadCard>

        {/* Prompt */}
        <SectionHeader title="Edit prompt" style={s.sectionHdr} />
        <View style={s.ph}>
          <FormInput
            label="Describe the edit"
            value={prompt}
            onChange={setPrompt}
            placeholder="e.g. Make the background black and add dramatic lighting…"
            multiline
            style={s.promptInput}
          />
          <Text style={s.chipsLabel}>Quick examples</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipsScroll}>
            {EXAMPLE_PROMPTS.map((ex) => (
              <TouchableOpacity
                key={ex}
                onPress={() => setPrompt(ex)}
                style={[s.chip, prompt === ex && s.chipActive]}
                activeOpacity={0.8}
              >
                <Text style={[s.chipText, prompt === ex && s.chipTextActive]}>{ex}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Preserve Toggles */}
        <SectionHeader title="Preserve settings" style={s.sectionHdr} />
        <BrandthreadCard style={s.toggleCard}>
          <ToggleRow label="Preserve product" description="Keep the garment shape & structure" value={preserveProduct} onChange={setPreserveProduct} />
          <View style={s.divider} />
          <ToggleRow label="Preserve logo" description="Keep logos and brand marks unchanged" value={preserveLogo} onChange={setPreserveLogo} />
          <View style={s.divider} />
          <ToggleRow label="Preserve garment color" description="Lock the current garment color" value={preserveGarmentColor} onChange={setPreserveGarmentColor} />
        </BrandthreadCard>

        {/* Generate Button */}
        <View style={s.ph}>
          <GradientCard colors={theme.primaryGradient} onPress={handleGenerate} glow style={[s.generateBtn, { shadowColor: theme.shadowColor }]}>
            <View style={s.generateInner}>
              <Feather name="zap" size={ICON.md} color={theme.onAccent} />
              <Text style={[s.generateText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Generate edit</Text>
            </View>
          </GradientCard>
        </View>

        {/* Results */}
        {result !== null && (
          <View style={s.resultsSection}>
            <SectionHeader title="Result" style={s.sectionHdr} />
            {showComparison ? (
              <View style={s.comparison}>
                <ComparisonPanel label="Before" accent={theme.muted} uri={imageUri ?? undefined} />
                <ComparisonPanel label="After" accent={theme.secondary} uri={result.imageUris[0]} />
              </View>
            ) : (
              <Image source={{ uri: result.imageUris[0] }} style={s.resultPlaceholder} resizeMode="cover" />
            )}
            <SecondaryButton
              label={showComparison ? 'Single view' : 'Compare Before/After'}
              onPress={() => setShowComparison((v) => !v)}
              icon={showComparison ? 'minimize-2' : 'columns'}
              style={s.compToggle}
            />
            <View style={s.resultActions}>
              <PrimaryButton label="Save result" onPress={() => Alert.alert('Saved', 'Result saved to your gallery.')} icon="save" style={s.actionBtn} />
              <SecondaryButton label="Try again" onPress={handleGenerate} icon="refresh-cw" style={s.actionBtn} />
              <SecondaryButton label="Save to Brand Assets" onPress={() => Alert.alert('Saved', 'Added to Brand Assets.')} icon="bookmark" style={s.actionBtn} />
              <SecondaryButton label="Add to product" onPress={() => Alert.alert('Add to Product', 'Choose a product to attach this image to.')} icon="package" style={s.actionBtn} />
            </View>
          </View>
        )}

        <View style={s.bottomPad} />
      </ScrollView>

      {isGenerating && (
        <View style={s.overlay}>
          <BrandthreadCard style={s.overlayCard}>
            <LinearGradient colors={theme.glowGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.overlayGrad}>
              <ActivityIndicator size="large" color={PURPLE} />
              <Text style={s.overlayTitle}>Generating edit…</Text>
              <Text style={s.overlaySub}>AI is applying your prompt</Text>
            </LinearGradient>
          </BrandthreadCard>
        </View>
      )}
    </BrandthreadScreen>
  );
}

function ToggleRow({ label, description, value, onChange }: {
  label: string; description: string; value: boolean;
  onChange: (v: boolean) => void;
}) {
  const { theme } = useAppTheme();
  const { accent: PURPLE } = theme;
  const s = createStyles(theme);
  return (
    <View style={s.toggleRow}>
      <View style={s.toggleInfo}>
        <Text style={s.toggleLabel}>{label}</Text>
        <Text style={s.toggleDesc}>{description}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: theme.cardElevated, true: PURPLE }} thumbColor={value ? theme.onAccent : theme.muted} />
    </View>
  );
}

function ComparisonPanel({ label, accent, uri }: { label: string; accent: string; uri?: string }) {
  const s = createStyles(useAppTheme().theme);
  return (
    <View style={s.compPanel}>
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <Feather name="image" size={ICON.lg} color={accent} />
      )}
      <Text style={[s.compLabel, { color: accent }]}>{label}</Text>
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const { accent: PURPLE, accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT } = theme;
  return StyleSheet.create({
  scroll:                 { paddingBottom: 40 },
  ph:                     { paddingHorizontal: SP.md },
  sectionHdr:             { marginTop: SP.lg, marginBottom: SP.sm },
  uploadCard:             { marginHorizontal: SP.md, padding: 0, overflow: 'hidden' },
  uploadZone:             { alignItems: 'center', justifyContent: 'center', gap: SP.sm, paddingVertical: SP.xl, paddingHorizontal: SP.md },
  uploadTitle:            { fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text },
  uploadSub:              { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted },
  uploadActions:          { flexDirection: 'row', gap: SP.sm, padding: SP.md },
  uploadBtn:              { flex: 1 },
  preview:                { width: '100%', height: 200 },
  mockPreview:            { alignItems: 'center', justifyContent: 'center', height: 200, gap: SP.sm },
  mockLabel:              { fontSize: FS.sm, fontFamily: FONT.medium, color: PURPLE_LIGHT },
  promptInput:            { marginBottom: SP.sm },
  chipsLabel:             { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.muted, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: SP.sm },
  chipsScroll:            { gap: SP.sm, paddingRight: SP.md },
  chip:                   { paddingHorizontal: SP.md, paddingVertical: SP.sm, borderRadius: RADIUS.pill, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border },
  chipActive:             { backgroundColor: PURPLE_DIM, borderColor: theme.accent },
  chipText:               { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.muted },
  chipTextActive:         { color: PURPLE_LIGHT },
  toggleCard:             { marginHorizontal: SP.md, gap: 0 },
  toggleRow:              { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingVertical: SP.sm },
  toggleInfo:             { flex: 1, gap: 2 },
  toggleLabel:            { fontSize: FS.base, fontFamily: FONT.medium, color: theme.text },
  toggleDesc:             { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted },
  divider:                { height: 1, backgroundColor: theme.borderSubtle, marginVertical: SP.xs },
  generateBtn:            { marginTop: SP.md },
  generateInner:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, paddingVertical: SP.md },
  generateText:           { fontSize: FS.md, fontFamily: FONT.bold, color: theme.onAccent },
  resultsSection:         { marginTop: SP.lg },
  comparison:             { flexDirection: 'row', gap: SP.sm, marginHorizontal: SP.md },
  compPanel:              { flex: 1, height: 200, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', gap: SP.sm, borderWidth: 1, borderColor: theme.border },
  compLabel:              { fontSize: FS.sm, fontFamily: FONT.semibold },
  compToggle:             { marginHorizontal: SP.md, marginTop: SP.sm },
  resultPlaceholder:      { marginHorizontal: SP.md, height: 240, borderRadius: RADIUS.lg, alignItems: 'center', justifyContent: 'center', gap: SP.sm, borderWidth: 1, borderColor: theme.border },
  resultPlaceholderLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: PURPLE_LIGHT },
  resultActions:          { gap: SP.sm, marginHorizontal: SP.md, marginTop: SP.md },
  actionBtn:              { width: '100%' },
  overlay:                { ...StyleSheet.absoluteFill, backgroundColor: OVERLAY, alignItems: 'center', justifyContent: 'center', zIndex: 99 },
  overlayCard:            { width: 280, padding: 0, overflow: 'hidden' },
  overlayGrad:            { alignItems: 'center', gap: SP.md, padding: SP.xl, borderRadius: RADIUS.lg },
  overlayTitle:           { fontSize: FS.lg, fontFamily: FONT.bold, color: theme.text },
  overlaySub:             { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted },
  bottomPad:              { height: 40 },
  });
};
