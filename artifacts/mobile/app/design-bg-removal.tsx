/**
 * Brandthread Design Studio — Background Removal
 * Route: /design-bg-removal
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, Image,
} from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';

import {
  BG, SURFACE, CARD, CARD_ELEVATED,
  BORDER, BORDER_ACTIVE, BORDER_SUBTLE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, SUCCESS,
  GRAD_PRIMARY, GRAD_CARD_GLOW,
  FONT, FS, SP, RADIUS, ICON, OVERLAY,
} from '@/lib/theme';
import {
  BrandthreadScreen, BrandthreadHeader, BrandthreadCard,
  GradientCard, PrimaryButton, SecondaryButton, SectionHeader,
} from '@/components/BrandthreadUI';
import { createBrandAsset } from '@/services/designService';

export default function DesignBgRemovalScreen() {
  const router = useRouter();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState('image/jpeg');
  const [resultUri, setResultUri] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showCheckerboard, setShowCheckerboard] = useState(true);

  async function pickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Please allow photo library access.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
      base64: true,   // request base64 so we can send to API without FileSystem read
    });
    if (!res.canceled && res.assets[0]?.base64) {
      setImageUri(res.assets[0].uri);
      setImageBase64(res.assets[0].base64);
      setImageMime(res.assets[0].mimeType ?? 'image/jpeg');
      setResultUri(null);
    }
  }

  async function handleRemove() {
    if (!imageBase64) {
      Alert.alert('No image', 'Please upload an image first.');
      return;
    }
    setIsProcessing(true);
    try {
      const dataUrl = `data:${imageMime};base64,${imageBase64}`;
      const apiBase = (process.env.EXPO_PUBLIC_API_BASE_URL as string | undefined ?? '').replace(/\/$/, '');
      const resp = await fetch(`${apiBase}/bg-removal/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`API ${resp.status}: ${errText}`);
      }
      const data: { b64_json: string } = await resp.json();
      setResultUri(`data:image/png;base64,${data.b64_json}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      Alert.alert('Error', `Background removal failed: ${msg}`);
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleExportPNG() {
    if (!resultUri || !resultUri.startsWith('data:')) {
      Alert.alert('Nothing to export', 'Process an image first.');
      return;
    }
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Please allow access to save photos.');
        return;
      }
      const b64 = resultUri.replace(/^data:image\/png;base64,/, '');
      const file = new File(Paths.cache, `bg_removed_${Date.now()}.png`);
      file.write(b64, { encoding: 'base64' });
      await MediaLibrary.saveToLibraryAsync(file.uri);
      Alert.alert('Saved', 'Transparent PNG saved to your photo library.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      Alert.alert('Export failed', msg);
    }
  }

  async function handleSaveToBrandAssets() {
    try {
      await createBrandAsset({
        name: 'Transparent Image',
        type: 'photo',
        uri: resultUri ?? undefined,
        tags: ['bg-removed', 'transparent'],
      });
      Alert.alert('Saved', 'Image added to Brand Assets.');
    } catch {
      Alert.alert('Error', 'Could not save to Brand Assets.');
    }
  }

  return (
    <BrandthreadScreen>
      <BrandthreadHeader title="Remove Background" onBack={() => router.back()} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* Upload Zone */}
        <SectionHeader title="Source image" style={s.sectionHdr} />
        <View style={s.ph}>
          <View style={s.uploadZone}>
            {imageUri && !imageUri.startsWith('mock://') ? (
              <Image source={{ uri: imageUri }} style={s.preview} resizeMode="contain" />
            ) : imageUri ? (
              <LinearGradient colors={GRAD_CARD_GLOW} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.mockPreview}>
                <Feather name="image" size={ICON.xl} color={PURPLE_LIGHT} />
                <Text style={s.mockLabel}>Image loaded</Text>
              </LinearGradient>
            ) : (
              <View style={s.emptyZone}>
                <Feather name="upload-cloud" size={ICON.xxl} color={MUTED} />
                <Text style={s.emptyTitle}>Upload image</Text>
                <Text style={s.emptySub}>JPG, PNG, WEBP • Max 20MB</Text>
              </View>
            )}
          </View>
          <View style={s.uploadRow}>
            <PrimaryButton label={imageUri ? 'Change image' : 'Upload image'} onPress={pickImage} icon="upload" style={s.flex1} />
            {imageUri && !resultUri && (
              <GradientCard colors={GRAD_PRIMARY} onPress={handleRemove} glow style={s.removeBtn}>
                <View style={s.removeBtnInner}>
                  <Feather name="scissors" size={ICON.sm} color="#FFF" />
                  <Text style={s.removeBtnText}>Remove BG</Text>
                </View>
              </GradientCard>
            )}
          </View>
        </View>

        {/* Result */}
        {resultUri !== null && (
          <>
            <SectionHeader title="Result" style={s.sectionHdr} />
            <View style={s.ph}>
              <View style={[s.resultContainer, showCheckerboard && s.checkerboard]}>
                {resultUri.startsWith('data:') ? (
                  <Image
                    source={{ uri: resultUri }}
                    style={s.resultImage}
                    resizeMode="contain"
                  />
                ) : (
                  <LinearGradient
                    colors={['rgba(139,92,246,0.20)', 'rgba(34,211,238,0.10)']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={s.resultGrad}
                  >
                    <Feather name="check-circle" size={ICON.xl} color={SUCCESS} />
                    <Text style={s.resultLabel}>Background removed</Text>
                    <Text style={s.resultSub}>Transparent PNG ready</Text>
                  </LinearGradient>
                )}
              </View>
              <TouchableOpacity onPress={() => setShowCheckerboard((v) => !v)} style={s.checkerToggle} activeOpacity={0.8}>
                <View style={[s.checkerDot, showCheckerboard && s.checkerDotActive]} />
                <Text style={s.checkerLabel}>Show transparent background</Text>
              </TouchableOpacity>
            </View>

            {/* Toolbar */}
            <SectionHeader title="Refine" style={s.sectionHdr} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.toolbarScroll}>
              <ToolButton label="New background" icon="layers" accent={CYAN} onPress={() => router.push(`/design-bg-replace?sourceUri=${encodeURIComponent(resultUri ?? 'mock')}` as any)} />
              <ToolButton label="Refine edges" icon="sliders" accent={PURPLE} onPress={() => Alert.alert('Coming Soon', 'AI edge refinement requires a brush canvas — available in a future update.')} />
              <ToolButton label="Restore area" icon="rotate-ccw" accent={CYAN} onPress={() => Alert.alert('Coming Soon', 'Area restore brush available in a future update.')} />
              <ToolButton label="Erase area" icon="minus-circle" accent="#F87171" onPress={() => Alert.alert('Coming Soon', 'Area erase brush available in a future update.')} />
            </ScrollView>

            {/* Export actions */}
            <SectionHeader title="Export" style={s.sectionHdr} />
            <View style={s.exportActions}>
              <PrimaryButton
                label="Export transparent PNG"
                onPress={handleExportPNG}
                icon="download"
                style={s.exportBtn}
              />
              <SecondaryButton label="Save to Brand Assets" onPress={handleSaveToBrandAssets} icon="bookmark" style={s.exportBtn} />
            </View>
          </>
        )}

        {/* Disclaimer */}
        <View style={s.disclaimer}>
          <Feather name="info" size={ICON.xs} color={MUTED} />
          <Text style={s.disclaimerText}>
            Background is removed by AI. Results may vary by image quality and complexity.
          </Text>
        </View>

        <View style={s.bottomPad} />
      </ScrollView>

      {isProcessing && (
        <View style={s.overlay}>
          <BrandthreadCard style={s.overlayCard}>
            <LinearGradient colors={GRAD_CARD_GLOW} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.overlayGrad}>
              <ActivityIndicator size="large" color={PURPLE} />
              <Text style={s.overlayTitle}>Removing background…</Text>
              <Text style={s.overlaySub}>AI is processing your image</Text>
            </LinearGradient>
          </BrandthreadCard>
        </View>
      )}
    </BrandthreadScreen>
  );
}

function ToolButton({ label, icon, accent, onPress }: { label: string; icon: string; accent: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={s.toolBtn} activeOpacity={0.8}>
      <View style={[s.toolIcon, { backgroundColor: accent + '20' }]}>
        <Feather name={icon as any} size={ICON.sm} color={accent} />
      </View>
      <Text style={s.toolLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  scroll:          { paddingBottom: 40 },
  ph:              { paddingHorizontal: SP.md },
  sectionHdr:      { marginTop: SP.lg, marginBottom: SP.sm },
  uploadZone:      { borderWidth: 1.5, borderColor: BORDER, borderStyle: 'dashed', borderRadius: RADIUS.lg, overflow: 'hidden', minHeight: 200, backgroundColor: CARD },
  preview:         { width: '100%', height: 200 },
  mockPreview:     { height: 200, alignItems: 'center', justifyContent: 'center', gap: SP.sm },
  mockLabel:       { fontSize: FS.sm, fontFamily: FONT.medium, color: PURPLE_LIGHT },
  emptyZone:       { alignItems: 'center', justifyContent: 'center', height: 200, gap: SP.sm },
  emptyTitle:      { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  emptySub:        { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  uploadRow:       { flexDirection: 'row', gap: SP.sm, marginTop: SP.sm },
  flex1:           { flex: 1 },
  removeBtn:       { flex: 1 },
  removeBtnInner:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, paddingVertical: 14 },
  removeBtnText:   { fontSize: FS.base, fontFamily: FONT.bold, color: '#FFF' },
  resultContainer: { borderRadius: RADIUS.lg, overflow: 'hidden', borderWidth: 1, borderColor: BORDER_ACTIVE },
  checkerboard:    { backgroundColor: '#999' },
  resultImage:     { width: '100%', height: 280 },
  resultGrad:      { height: 220, alignItems: 'center', justifyContent: 'center', gap: SP.sm },
  resultLabel:     { fontSize: FS.md, fontFamily: FONT.bold, color: FG },
  resultSub:       { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  checkerToggle:   { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.sm },
  checkerDot:      { width: 18, height: 18, borderRadius: RADIUS.xs, borderWidth: 1.5, borderColor: BORDER },
  checkerDotActive:{ backgroundColor: PURPLE, borderColor: PURPLE },
  checkerLabel:    { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  toolbarScroll:   { gap: SP.sm, paddingHorizontal: SP.md, paddingBottom: SP.sm },
  toolBtn:         { alignItems: 'center', gap: SP.xs, width: 84 },
  toolIcon:        { width: 48, height: 48, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER },
  toolLabel:       { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, textAlign: 'center' },
  exportActions:   { gap: SP.sm, paddingHorizontal: SP.md },
  exportBtn:       { width: '100%' },
  disclaimer:      { flexDirection: 'row', alignItems: 'flex-start', gap: SP.xs, margin: SP.md, padding: SP.md, backgroundColor: SURFACE, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER_SUBTLE },
  disclaimerText:  { flex: 1, fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, lineHeight: 17 },
  overlay:         { ...StyleSheet.absoluteFillObject, backgroundColor: OVERLAY, alignItems: 'center', justifyContent: 'center', zIndex: 99 },
  overlayCard:     { width: 280, padding: 0, overflow: 'hidden' },
  overlayGrad:     { alignItems: 'center', gap: SP.md, padding: SP.xl, borderRadius: RADIUS.lg },
  overlayTitle:    { fontSize: FS.lg, fontFamily: FONT.bold, color: FG },
  overlaySub:      { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  bottomPad:       { height: 40 },
});
