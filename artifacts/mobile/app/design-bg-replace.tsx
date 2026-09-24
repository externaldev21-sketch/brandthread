/**
 * Brandthread Design Studio — Background Replacement
 * Route: /design-bg-replace
 * Params: sourceUri?
 */
import React, { useState } from 'react';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, Image, TextInput, Modal, FlatList,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';

import {
  BG, SURFACE, CARD, CARD_ELEVATED,
  BORDER, BORDER_ACTIVE, BORDER_SUBTLE,
  FG, MUTED, SUBTLE,
  FONT, FS, SP, RADIUS, ICON, OVERLAY,
} from '@/lib/theme';
import {
  BrandthreadScreen, BrandthreadHeader, BrandthreadCard,
  GradientCard, PrimaryButton, SecondaryButton, SectionHeader, FormInput,
} from '@/components/BrandthreadUI';
import { replaceBackground } from '@/services/designService';
import { getProducts, updateProduct } from '@/services/productService';
import type { Product, ProductMedia } from '@/services/productTypes';

type BgTab = 'color' | 'gradient' | 'upload' | 'ai';

const COLOR_SWATCHES = [
  { label: 'Black',        hex: '#000000' },
  { label: 'White',        hex: '#FFFFFF' },
  { label: 'Gray',         hex: '#6B7280' },
  { label: 'Cream',        hex: '#F5F0E8' },
  { label: 'Navy',         hex: '#1E3A5F' },
  { label: 'Forest Green', hex: '#2D5016' },
  { label: 'Deep Red',     hex: '#8B0000' },
  { label: 'Blush Pink',   hex: '#F4A7B9' },
  { label: 'Warm Sand',    hex: '#C4A882' },
  { label: 'Charcoal',     hex: '#2C2C2C' },
  { label: 'Sage',         hex: '#87A878' },
  { label: 'Sky Blue',     hex: '#7DD3FC' },
];

const GRADIENT_PRESETS = [
  { label: 'Sunset',  from: '#FF6B6B', to: '#FFD93D' },
  { label: 'Ocean',   from: '#0EA5E9', to: '#1E3A5F' },
  { label: 'Forest',  from: '#2D5016', to: '#87A878' },
  { label: 'Studio',  from: '#1A1A2E', to: '#4A4A6A' },
];

const AI_SCENES = ['Studio', 'Street', 'Luxury interior', 'Outdoor', 'Industrial', 'Minimal', 'Runway', 'Night'];

const BG_TABS: { key: BgTab; label: string }[] = [
  { key: 'color',    label: 'Color' },
  { key: 'gradient', label: 'Gradient' },
  { key: 'upload',   label: 'Upload' },
  { key: 'ai',       label: 'AI Scene' },
];

export default function DesignBgReplaceScreen({
  embedded = false,
  onSelectRemove,
}: {
  embedded?: boolean;
  onSelectRemove?: () => void;
} = {}) {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  const s = createStyles(theme);
  const router = useRouter();
  const params = useLocalSearchParams<{ sourceUri?: string }>();
  const [imageUri, setImageUri] = useState<string | null>(params.sourceUri ?? null);
  const [selectedSwatchHex, setSelectedSwatchHex] = useState('#000000');
  const [customColor, setCustomColor] = useState('#000000');
  const [bgTab, setBgTab] = useState<BgTab>('color');
  const [selectedGradient, setSelectedGradient] = useState(0);
  const [customGradFrom, setCustomGradFrom] = useState('#0EA5E9');
  const [customGradTo, setCustomGradTo] = useState('#22D3EE');
  const [uploadedBgUri, setUploadedBgUri] = useState<string | null>(null);
  const [selectedScene, setSelectedScene] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');
  const [resultUri, setResultUri] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [pickerProducts, setPickerProducts] = useState<Product[]>([]);
  const [loadingPickerProducts, setLoadingPickerProducts] = useState(false);

  async function pickSourceImage() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
    if (!res.canceled && res.assets[0]) { setImageUri(res.assets[0].uri); setResultUri(null); }
  }

  async function pickBgImage() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
    if (!res.canceled && res.assets[0]) setUploadedBgUri(res.assets[0].uri);
  }

  async function handleGenerate() {
    if (!imageUri) { Alert.alert('No source image', 'Please upload a source image first.'); return; }
    if (bgTab === 'upload' && !uploadedBgUri) {
      Alert.alert('No background image', 'Upload the background image you want to use.');
      return;
    }
    let prompt = '';
    let color: string | undefined;
    if (bgTab === 'color') {
      color = selectedSwatchHex;
      prompt = `Solid color background: ${color}`;
    } else if (bgTab === 'gradient') {
      const g = GRADIENT_PRESETS[selectedGradient];
      prompt = `Gradient background from ${g.from} to ${g.to}`;
    } else if (bgTab === 'upload') {
      prompt = 'Replace background with uploaded image';
    } else {
      prompt = selectedScene ? `${selectedScene} scene background` : customPrompt;
    }
    setIsGenerating(true);
    try {
      const res = await replaceBackground({
        imageUri,
        bgType: bgTab,
        color,
        prompt,
        backgroundImageUri: bgTab === 'upload' ? uploadedBgUri ?? undefined : undefined,
      });
      setResultUri(res.resultUri);
    } catch {
      Alert.alert('Error', 'Generation failed. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  }

  async function writeResultToTempFile(): Promise<string | null> {
    if (!resultUri) return null;
    if (resultUri.startsWith('data:')) {
      const b64 = resultUri.replace(/^data:image\/[a-z]+;base64,/, '');
      const file = new File(Paths.cache, `bg-replace-${Date.now()}.png`);
      file.write(b64, { encoding: 'base64' });
      return file.uri;
    }
    return resultUri;
  }

  async function handleSaveResult() {
    if (!resultUri) return;
    setIsSaving(true);
    try {
      const MediaLibrary = await import('expo-media-library');
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Allow photo library access to save this image.');
        return;
      }
      const fileUri = await writeResultToTempFile();
      if (!fileUri) return;
      await MediaLibrary.saveToLibraryAsync(fileUri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved', 'Saved to Photos.');
    } catch {
      Alert.alert('Save failed', 'Could not save this image. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleExportResult() {
    if (!resultUri) return;
    setIsExporting(true);
    try {
      const fileUri = await writeResultToTempFile();
      if (!fileUri) return;
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert('Sharing unavailable', 'System share sheet is not available.');
        return;
      }
      await Sharing.shareAsync(fileUri, { mimeType: 'image/png', UTI: 'public.png' });
    } catch {
      Alert.alert('Couldn’t open sharing', 'Try again.');
    } finally {
      setIsExporting(false);
    }
  }

  async function handleAddToProduct() {
    if (!resultUri) return;
    setLoadingPickerProducts(true);
    try {
      const all = await getProducts();
      const active = all.filter(p => p.status !== 'archived');
      if (active.length === 0) {
        Alert.alert('No products', 'Create a product first, then add this image to its media gallery.');
        return;
      }
      setPickerProducts(active);
      setShowProductPicker(true);
    } catch {
      Alert.alert('Couldn’t load products', 'Try again.');
    } finally {
      setLoadingPickerProducts(false);
    }
  }

  async function confirmAddToProduct(product: Product) {
    if (!resultUri) return;
    setShowProductPicker(false);
    try {
      const existing = product.media ?? [];
      const newMedia: ProductMedia = {
        id: `bg-replace-${Date.now()}`,
        type: 'image',
        uri: resultUri,
        altText: 'Background replaced image',
        isCover: false,
        sortOrder: existing.length,
        createdAt: new Date().toISOString(),
      };
      const updated = await updateProduct(product.id, { media: [...existing, newMedia] });
      if (updated) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Added', `Added to "${product.name ?? 'product'}" media gallery.`);
      } else {
        Alert.alert('Couldn’t update product', 'Try again.');
      }
    } catch {
      Alert.alert('Couldn’t add to product', 'Try again.');
    }
  }

  return (
    <BrandthreadScreen>
      <BrandthreadHeader title="Background Tools" onBack={() => router.back()} />
      {embedded && (
        <View style={s.modeWrap}>
          <View style={s.modeRow}>
            <TouchableOpacity style={s.modeButton} onPress={onSelectRemove} activeOpacity={0.8}>
              <Text style={s.modeText}>Remove</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.modeButton, s.modeButtonActive]} activeOpacity={0.8}>
              <Text style={[s.modeText, s.modeTextActive]}>Replace</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        {/* Source Image */}
        <SectionHeader title="Source image" style={s.sectionHdr} />
        <View style={s.ph}>
          <TouchableOpacity onPress={pickSourceImage} activeOpacity={0.85}>
            {imageUri ? (
              <View style={s.sourcePreview}>
                <Image source={{ uri: imageUri }} style={s.sourceImage} resizeMode="cover" />
                <View style={s.sourceChip}>
                  <Feather name="edit-2" size={ICON.xs} color={FG} />
                  <Text style={s.sourceChipText}>Change</Text>
                </View>
              </View>
            ) : (
              <View style={s.uploadZone}>
                <Feather name="upload-cloud" size={ICON.xxl} color={MUTED} />
                <Text style={s.uploadTitle}>Upload source image</Text>
                <Text style={s.uploadSub}>Tap to browse</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Tabs */}
        <SectionHeader title="Background type" style={s.sectionHdr} />
        <View style={s.ph}>
          <View style={s.tabRow}>
            {BG_TABS.map((tab) => (
              <TouchableOpacity key={tab.key} onPress={() => setBgTab(tab.key)} style={[s.tab, bgTab === tab.key && s.tabActive]} activeOpacity={0.8}>
                <Text style={[s.tabText, bgTab === tab.key && s.tabTextActive]}>{tab.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Color Tab */}
        {bgTab === 'color' && (
          <View style={s.ph}>
            <View style={s.swatchGrid}>
              {COLOR_SWATCHES.map((sw) => (
                <TouchableOpacity
                  key={sw.hex}
                  onPress={() => { setSelectedSwatchHex(sw.hex); setCustomColor(sw.hex); }}
                  style={[s.swatch, { backgroundColor: sw.hex }, selectedSwatchHex === sw.hex && s.swatchSelected]}
                  activeOpacity={0.8}
                >
                  {selectedSwatchHex === sw.hex && <Feather name="check" size={14} color={sw.hex === '#FFFFFF' || sw.hex === '#F5F0E8' || sw.hex === '#F4A7B9' ? '#000' : '#FFF'} />}
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.hexRow}>
              <Text style={s.hexLabel}>Custom hex</Text>
              <TextInput
                value={customColor}
                onChangeText={(t) => { setCustomColor(t); setSelectedSwatchHex(t); }}
                placeholder="#000000"
                placeholderTextColor={SUBTLE}
                style={s.hexInput}
                autoCapitalize="characters"
              />
            </View>
          </View>
        )}

        {/* Gradient Tab */}
        {bgTab === 'gradient' && (
          <View style={s.ph}>
            <View style={s.gradientGrid}>
              {GRADIENT_PRESETS.map((gp, idx) => (
                <TouchableOpacity key={gp.label} onPress={() => setSelectedGradient(idx)} style={[s.gradCard, selectedGradient === idx && s.gradCardSelected]} activeOpacity={0.8}>
                  <LinearGradient colors={[gp.from, gp.to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.gradSwatch} />
                  <Text style={s.gradLabel}>{gp.label}</Text>
                  {selectedGradient === idx && (
                    <View style={s.gradCheck}><Feather name="check" size={12} color="#FFF" /></View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
            <Text style={s.customGradLabel}>Custom gradient</Text>
            <View style={s.customGradRow}>
              <View style={s.customGradField}>
                <Text style={s.hexLabel}>From</Text>
                <TextInput value={customGradFrom} onChangeText={setCustomGradFrom} placeholder="#0EA5E9" placeholderTextColor={SUBTLE} style={s.hexInput} autoCapitalize="characters" />
              </View>
              <View style={s.customGradField}>
                <Text style={s.hexLabel}>To</Text>
                <TextInput value={customGradTo} onChangeText={setCustomGradTo} placeholder="#22D3EE" placeholderTextColor={SUBTLE} style={s.hexInput} autoCapitalize="characters" />
              </View>
            </View>
          </View>
        )}

        {/* Upload Tab */}
        {bgTab === 'upload' && (
          <View style={s.ph}>
            <PrimaryButton label={uploadedBgUri ? 'Change background image' : 'Upload background image'} onPress={pickBgImage} icon="image" />
            {uploadedBgUri && (
              <View style={s.bgUploadedRow}>
                <Feather name="check-circle" size={ICON.sm} color={PURPLE_LIGHT} />
                <Text style={s.bgUploadedText}>Background image selected</Text>
              </View>
            )}
          </View>
        )}

        {/* AI Scene Tab */}
        {bgTab === 'ai' && (
          <View style={s.ph}>
            <View style={s.sceneGrid}>
              {AI_SCENES.map((scene) => (
                <TouchableOpacity key={scene} onPress={() => setSelectedScene(scene)} style={[s.scenePill, selectedScene === scene && s.scenePillActive]} activeOpacity={0.8}>
                  <Text style={[s.scenePillText, selectedScene === scene && s.scenePillTextActive]}>{scene}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <FormInput label="Or describe a custom scene" value={customPrompt} onChange={(t) => { setCustomPrompt(t); setSelectedScene(null); }} placeholder="e.g. Lush rooftop garden at golden hour…" multiline style={s.scenePrompt} />
          </View>
        )}

        {/* Generate */}
        <View style={s.ph}>
          <GradientCard colors={theme.primaryGradient} onPress={handleGenerate} glow style={[s.generateBtn, { shadowColor: theme.shadowColor }]}>
            <View style={s.generateInner}>
              <Feather name="zap" size={ICON.md} color={theme.onAccent} />
              <Text style={[s.generateText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Generate</Text>
            </View>
          </GradientCard>
        </View>

        {/* Result */}
        {resultUri !== null && (
          <>
            <SectionHeader title="Result" style={s.sectionHdr} />
            <View style={s.ph}>
              <Image source={{ uri: resultUri }} style={s.resultPlaceholder} resizeMode="cover" />
            </View>
            <View style={s.resultActions}>
              <PrimaryButton label="Save" onPress={handleSaveResult} icon="save" loading={isSaving} style={s.actionBtn} />
              <SecondaryButton label="Try another" onPress={handleGenerate} icon="refresh-cw" style={s.actionBtn} />
              <SecondaryButton label="Add to product" onPress={handleAddToProduct} icon="package" style={s.actionBtn} />
              <SecondaryButton label={isExporting ? 'Exporting…' : 'Export'} onPress={handleExportResult} icon="download" disabled={isExporting} style={s.actionBtn} />
            </View>
          </>
        )}

        <View style={s.bottomPad} />
      </ScrollView>

      {isGenerating && (
        <View style={s.overlay}>
          <BrandthreadCard style={s.overlayCard}>
            <LinearGradient colors={theme.glowGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.overlayGrad}>
              <ActivityIndicator size="large" color={PURPLE} />
              <Text style={s.overlayTitle}>Replacing background…</Text>
              <Text style={s.overlaySub}>AI is compositing your image</Text>
            </LinearGradient>
          </BrandthreadCard>
        </View>
      )}

      <Modal
        visible={showProductPicker}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setShowProductPicker(false)}
      >
        <View style={s.pickerRoot}>
          <View style={s.pickerHeader}>
            <Text style={s.pickerTitle}>Choose a product</Text>
            <TouchableOpacity onPress={() => setShowProductPicker(false)} activeOpacity={0.7}>
              <Feather name="x" size={ICON.sm} color={FG} />
            </TouchableOpacity>
          </View>
          <Text style={s.pickerSub}>The image will be added to the product's media gallery.</Text>
          {loadingPickerProducts ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={PURPLE} />
          ) : (
            <FlatList
              data={pickerProducts}
              keyExtractor={p => p.id}
              contentContainerStyle={{ padding: SP.md }}
              renderItem={({ item }) => (
                <TouchableOpacity style={s.productRow} onPress={() => confirmAddToProduct(item)} activeOpacity={0.82}>
                  {item.media?.[0]?.uri ? (
                    <Image source={{ uri: item.media[0].uri }} style={s.productThumb} resizeMode="cover" />
                  ) : (
                    <View style={[s.productThumb, s.productThumbEmpty]}>
                      <Feather name="package" size={ICON.md} color={SUBTLE} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={s.productName} numberOfLines={1}>{item.name}</Text>
                    <Text style={s.productStatus}>{item.status}</Text>
                  </View>
                  <Feather name="chevron-right" size={ICON.xs} color={MUTED} />
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </Modal>
    </BrandthreadScreen>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const { accent: PURPLE, accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  return StyleSheet.create({
  modeWrap:           { paddingHorizontal: SP.md, marginBottom: SP.sm },
  modeRow:            { flexDirection: 'row', padding: 4, gap: 4, backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER },
  modeButton:         { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.sm },
  modeButtonActive:   { backgroundColor: PURPLE_DIM, borderWidth: 1, borderColor: BORDER_ACTIVE },
  modeText:           { color: MUTED, fontFamily: FONT.medium, fontSize: FS.sm },
  modeTextActive:     { color: PURPLE_LIGHT, fontFamily: FONT.semibold },
  scroll:             { paddingBottom: 40 },
  ph:                 { paddingHorizontal: SP.md },
  sectionHdr:         { marginTop: SP.lg, marginBottom: SP.sm },
  sourcePreview:      { height: 200, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER_ACTIVE, overflow: 'hidden', position: 'relative' },
  sourceImage:        { width: '100%', height: '100%' },
  sourceChip:         { position: 'absolute', right: SP.sm, bottom: SP.sm, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: OVERLAY, borderRadius: RADIUS.pill, paddingHorizontal: SP.sm, paddingVertical: 6 },
  sourceChipText:     { fontSize: FS.xs, fontFamily: FONT.semibold, color: FG },
  uploadZone:         { height: 200, borderWidth: 1.5, borderColor: BORDER, borderStyle: 'dashed', borderRadius: RADIUS.lg, alignItems: 'center', justifyContent: 'center', gap: SP.sm, backgroundColor: CARD },
  uploadTitle:        { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  uploadSub:          { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  tabRow:             { flexDirection: 'row', backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, padding: 4, gap: 4 },
  tab:                { flex: 1, paddingVertical: 8, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  tabActive:          { backgroundColor: PURPLE_DIM, borderWidth: 1, borderColor: BORDER_ACTIVE },
  tabText:            { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  tabTextActive:      { color: PURPLE_LIGHT, fontFamily: FONT.semibold },
  swatchGrid:         { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginTop: SP.sm },
  swatch:             { width: 44, height: 44, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  swatchSelected:     { borderColor: PURPLE },
  hexRow:             { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.md },
  hexLabel:           { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, width: 56 },
  hexInput:           { flex: 1, height: 40, backgroundColor: CARD, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, paddingHorizontal: SP.md, fontSize: FS.sm, fontFamily: FONT.medium, color: FG },
  gradientGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginTop: SP.sm },
  gradCard:           { width: '48%', borderRadius: RADIUS.md, overflow: 'hidden', borderWidth: 1.5, borderColor: BORDER, position: 'relative' },
  gradCardSelected:   { borderColor: BORDER_ACTIVE },
  gradSwatch:         { height: 64 },
  gradLabel:          { fontSize: FS.xs, fontFamily: FONT.medium, color: FG, paddingHorizontal: SP.sm, paddingVertical: SP.xs },
  gradCheck:          { position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: 10, backgroundColor: PURPLE, alignItems: 'center', justifyContent: 'center' },
  customGradLabel:    { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, marginTop: SP.md, marginBottom: SP.sm },
  customGradRow:      { flexDirection: 'row', gap: SP.sm },
  customGradField:    { flex: 1, gap: SP.xs },
  bgUploadedRow:      { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.sm },
  bgUploadedText:     { fontSize: FS.sm, fontFamily: FONT.medium, color: PURPLE_LIGHT },
  sceneGrid:          { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginTop: SP.sm },
  scenePill:          { paddingHorizontal: SP.md, paddingVertical: SP.sm, borderRadius: RADIUS.pill, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  scenePillActive:    { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE },
  scenePillText:      { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  scenePillTextActive:{ color: PURPLE_LIGHT },
  scenePrompt:        { marginTop: SP.md },
  generateBtn:        { marginTop: SP.md },
  generateInner:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, paddingVertical: SP.md },
  generateText:       { fontSize: FS.md, fontFamily: FONT.bold, color: '#FFF' },
  resultPlaceholder:  { height: 240, borderRadius: RADIUS.lg, alignItems: 'center', justifyContent: 'center', gap: SP.sm, borderWidth: 1, borderColor: BORDER_ACTIVE },
  resultLabel:        { fontSize: FS.base, fontFamily: FONT.semibold, color: PURPLE_LIGHT },
  resultActions:      { gap: SP.sm, paddingHorizontal: SP.md, marginTop: SP.sm },
  actionBtn:          { width: '100%' },
  overlay:            { ...StyleSheet.absoluteFill, backgroundColor: OVERLAY, alignItems: 'center', justifyContent: 'center', zIndex: 99 },
  overlayCard:        { width: 280, padding: 0, overflow: 'hidden' },
  overlayGrad:        { alignItems: 'center', gap: SP.md, padding: SP.xl, borderRadius: RADIUS.lg },
  overlayTitle:       { fontSize: FS.lg, fontFamily: FONT.bold, color: FG },
  overlaySub:         { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  bottomPad:          { height: 40 },
  pickerRoot:         { flex: 1, backgroundColor: BG, paddingTop: SP.md },
  pickerHeader:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.lg },
  pickerTitle:        { fontFamily: FONT.bold, fontSize: FS.lg, color: FG },
  pickerSub:          { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, paddingHorizontal: SP.lg, marginTop: SP.xs, marginBottom: SP.sm },
  productRow:         { flexDirection: 'row', alignItems: 'center', gap: SP.md, backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, padding: SP.sm, marginBottom: SP.sm },
  productThumb:       { width: 52, height: 52, borderRadius: RADIUS.sm },
  productThumbEmpty:  { backgroundColor: CARD_ELEVATED, alignItems: 'center', justifyContent: 'center' },
  productName:        { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG, marginBottom: 4 },
  productStatus:      { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED },
  });
};
