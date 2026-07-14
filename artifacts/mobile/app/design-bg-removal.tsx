/**
 * Brandthread Design Studio — Background Removal
 * Route: /design-bg-removal
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, Image,
} from 'react-native';
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
import { removeBackgroundFromImage, createBrandAsset } from '@/services/designService';

export default function DesignBgRemovalScreen() {
  const router = useRouter();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [resultUri, setResultUri] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showCheckerboard, setShowCheckerboard] = useState(true);

  async function pickImage() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (!res.canceled && res.assets[0]) {
      setImageUri(res.assets[0].uri);
      setResultUri(null);
    }
  }

  async function handleRemove() {
    if (!imageUri) {
      Alert.alert('No image', 'Please upload an image first.');
      return;
    }
    setIsProcessing(true);
    try {
      const uri = await removeBackgroundFromImage(imageUri);
      setResultUri(uri);
    } catch {
      Alert.alert('Error', 'Background removal failed. Please try again.');
    } finally {
      setIsProcessing(false);
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
              </View>
              <TouchableOpacity onPress={() => setShowCheckerboard((v) => !v)} style={s.checkerToggle} activeOpacity={0.8}>
                <View style={[s.checkerDot, showCheckerboard && s.checkerDotActive]} />
                <Text style={s.checkerLabel}>Show transparent background</Text>
              </TouchableOpacity>
            </View>

            {/* Toolbar */}
            <SectionHeader title="Refine" style={s.sectionHdr} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.toolbarScroll}>
              <ToolButton label="Refine edges" icon="sliders" accent={PURPLE} onPress={() => Alert.alert('Refine Edges', 'AI refinement coming soon.')} />
              <ToolButton label="Restore area" icon="rotate-ccw" accent={CYAN} onPress={() => Alert.alert('Restore', 'Brush to restore removed areas.')} />
              <ToolButton label="Erase area" icon="minus-circle" accent="#F87171" onPress={() => Alert.alert('Erase', 'Brush to erase additional areas.')} />
              <ToolButton label="New background" icon="layers" accent={CYAN} onPress={() => router.push('/design-bg-replace?sourceUri=mock')} />
            </ScrollView>

            {/* Export actions */}
            <SectionHeader title="Export" style={s.sectionHdr} />
            <View style={s.exportActions}>
              <PrimaryButton
                label="Export transparent PNG"
                onPress={() => Alert.alert('Export', 'Save transparent PNG to your device?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Save', onPress: () => Alert.alert('Saved', 'PNG exported.') },
                ])}
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
            Background removal preview. Connect a processing service for real results.
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
