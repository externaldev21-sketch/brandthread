/**
 * Brandthread Design Studio — Campaign Generator
 * Route: /design-campaign
 */
import React, { useState } from 'react';
import { useColors } from '@/hooks/useColors';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import {
  BG, SURFACE, CARD, CARD_ELEVATED,
  BORDER, BORDER_ACTIVE, BORDER_SUBTLE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM,
  GRAD_PRIMARY, GRAD_CARD_GLOW,
  FONT, FS, SP, RADIUS, ICON, OVERLAY,
} from '@/lib/theme';
import {
  BrandthreadScreen, BrandthreadHeader, BrandthreadCard,
  GradientCard, PrimaryButton, SecondaryButton, SectionHeader, FormInput, StatusBadge,
} from '@/components/BrandthreadUI';
import { generateCampaign } from '@/services/designService';
import {
  AI_STYLES, CAMPAIGN_FORMATS,
} from '@/services/designTypes';
import type { AIStyleKind, CampaignFormatKind, CampaignProject, CampaignAsset } from '@/services/designTypes';

const COLOR_SWATCHES = [
  '#000000', '#FFFFFF', '#6B7280', '#F5F0E8',
  '#1E3A5F', '#2D5016', '#8B0000', '#F4A7B9',
  '#C4A882', '#2C2C2C', '#87A878', '#B89FD8',
];

// Map campaign format values to gradient colors for asset thumbnails
const FORMAT_GRAD: Record<string, readonly [string, string]> = {
  thread_post:   ['#8B5CF6', '#22D3EE'],
  story:         ['#F97316', '#8B5CF6'],
  store_hero:    ['#EC4899', '#8B5CF6'],
  product_banner:['#3B82F6', '#22D3EE'],
  email_banner:  ['#F59E0B', '#F97316'],
  ad_creative:   ['#10B981', '#22D3EE'],
  square_post:   ['#2C2C2C', '#8B5CF6'],
  portrait_post: ['#1E3A5F', '#3B82F6'],
};

export default function DesignCampaignScreen() {
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN } = useColors();
  const router = useRouter();
  const [productName, setProductName] = useState('');
  const [style, setStyle] = useState<AIStyleKind>('streetwear');
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [customColor, setCustomColor] = useState('');
  const [headline, setHeadline] = useState('');
  const [cta, setCta] = useState('');
  const [selectedFormats, setSelectedFormats] = useState<CampaignFormatKind[]>([]);
  const [count, setCount] = useState(4);
  const [isGenerating, setIsGenerating] = useState(false);
  const [campaign, setCampaign] = useState<CampaignProject | null>(null);

  function toggleColor(hex: string) {
    setSelectedColors((prev) => prev.includes(hex) ? prev.filter((c) => c !== hex) : [...prev, hex]);
  }

  function toggleFormat(fmt: CampaignFormatKind) {
    setSelectedFormats((prev) => prev.includes(fmt) ? prev.filter((f) => f !== fmt) : [...prev, fmt]);
  }

  async function handleGenerate() {
    if (!headline.trim()) { Alert.alert('Headline required', 'Please add a campaign headline.'); return; }
    if (selectedFormats.length === 0) { Alert.alert('Format required', 'Please select at least one output format.'); return; }
    setIsGenerating(true);
    try {
      const result = await generateCampaign(undefined, style, headline, cta, selectedFormats);
      setCampaign(result);
    } catch {
      Alert.alert('Error', 'Campaign generation failed. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <BrandthreadScreen>
      <BrandthreadHeader title="Campaign Generator" onBack={() => router.back()} gradient />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        {/* 1. Product */}
        <SectionHeader title="1. Select product" style={s.sectionHdr} />
        <View style={s.ph}>
          <FormInput label="Product name or description" value={productName} onChange={setProductName} placeholder="e.g. Summer Drop Oversized Hoodie, Black" />
        </View>

        {/* 2. Campaign style */}
        <SectionHeader title="2. Campaign style" style={s.sectionHdr} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.stylePillsScroll}>
          {AI_STYLES.map((st) => (
            <TouchableOpacity key={st.value} onPress={() => setStyle(st.value)} style={[s.stylePill, style === st.value && s.stylePillActive]} activeOpacity={0.8}>
              <Text style={[s.stylePillText, style === st.value && s.stylePillTextActive]}>{st.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* 3. Colors */}
        <SectionHeader title="3. Colors" style={s.sectionHdr} />
        <View style={s.ph}>
          <View style={s.colorGrid}>
            {COLOR_SWATCHES.map((hex) => (
              <TouchableOpacity key={hex} onPress={() => toggleColor(hex)} style={[s.colorSwatch, { backgroundColor: hex }, selectedColors.includes(hex) && s.colorSwatchSelected]} activeOpacity={0.8}>
                {selectedColors.includes(hex) && <Feather name="check" size={14} color={hex === '#FFFFFF' || hex === '#F5F0E8' || hex === '#F4A7B9' ? '#000' : '#FFF'} />}
              </TouchableOpacity>
            ))}
          </View>
          <View style={s.customColorRow}>
            <Text style={s.hexLabel}>Custom hex</Text>
            <TextInput
              value={customColor}
              onChangeText={setCustomColor}
              placeholder="#000000"
              placeholderTextColor={SUBTLE}
              style={s.hexInput}
              autoCapitalize="characters"
              onBlur={() => {
                if (customColor && customColor.startsWith('#') && customColor.length >= 4) {
                  toggleColor(customColor);
                  setCustomColor('');
                }
              }}
            />
          </View>
        </View>

        {/* 4. Headline */}
        <SectionHeader title="4. Headline" style={s.sectionHdr} />
        <View style={s.ph}>
          <FormInput label="Campaign headline" value={headline} onChange={setHeadline} placeholder="Your brand headline here" />
        </View>

        {/* 5. CTA */}
        <SectionHeader title="5. Call to action" style={s.sectionHdr} />
        <View style={s.ph}>
          <FormInput label="CTA text" value={cta} onChange={setCta} placeholder="Shop now, Explore the collection…" />
        </View>

        {/* 6. Formats */}
        <SectionHeader title="6. Output formats" style={s.sectionHdr} />
        <View style={s.ph}>
          <View style={s.formatsGrid}>
            {CAMPAIGN_FORMATS.map((fmt) => {
              const active = selectedFormats.includes(fmt.value);
              return (
                <TouchableOpacity key={fmt.value} onPress={() => toggleFormat(fmt.value)} style={[s.formatCard, active && s.formatCardActive]} activeOpacity={0.8}>
                  <View style={s.formatCheck}>
                    {active ? <Feather name="check-square" size={ICON.sm} color={PURPLE_LIGHT} /> : <Feather name="square" size={ICON.sm} color={MUTED} />}
                  </View>
                  <View style={s.formatInfo}>
                    <Text style={[s.formatLabel, active && s.formatLabelActive]}>{fmt.label}</Text>
                    <Text style={s.formatDims}>{fmt.dims}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 7. Count */}
        <SectionHeader title="7. Output count" style={s.sectionHdr} />
        <View style={s.ph}>
          <BrandthreadCard style={s.stepperCard}>
            <Text style={s.stepperLabel}>Variations per format</Text>
            <View style={s.stepper}>
              <TouchableOpacity onPress={() => setCount((v) => Math.max(1, v - 1))} style={[s.stepBtn, count <= 1 && s.stepBtnDisabled]} activeOpacity={0.8}>
                <Feather name="minus" size={ICON.sm} color={count <= 1 ? MUTED : FG} />
              </TouchableOpacity>
              <Text style={s.stepperValue}>{count}</Text>
              <TouchableOpacity onPress={() => setCount((v) => Math.min(8, v + 1))} style={[s.stepBtn, count >= 8 && s.stepBtnDisabled]} activeOpacity={0.8}>
                <Feather name="plus" size={ICON.sm} color={count >= 8 ? MUTED : FG} />
              </TouchableOpacity>
            </View>
          </BrandthreadCard>
        </View>

        {/* Generate */}
        <View style={s.ph}>
          <GradientCard colors={GRAD_PRIMARY} onPress={handleGenerate} glow style={s.generateBtn}>
            <View style={s.generateInner}>
              <Feather name="zap" size={ICON.md} color="#FFF" />
              <Text style={s.generateText}>Generate campaign</Text>
            </View>
          </GradientCard>
        </View>

        {/* Results */}
        {campaign !== null && (
          <View style={s.results}>
            <View style={s.resultHeader}>
              <Text style={s.resultTitle}>Campaign results</Text>
              <StatusBadge label={`${campaign.assets.length} assets`} variant="purple" />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.assetScroll}>
              {campaign.assets.map((asset) => (
                <AssetCard key={asset.id} asset={asset} router={router} formatGrad={FORMAT_GRAD} />
              ))}
            </ScrollView>
            <View style={s.bottomActions}>
              <PrimaryButton label="Save campaign" onPress={() => Alert.alert('Save Campaign', 'Save this campaign to your library?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Save', onPress: () => Alert.alert('Saved', 'Campaign saved.') }])} icon="save" style={s.bottomBtn} />
              <SecondaryButton label="Edit individual asset" onPress={() => router.push('/design-prompt-edit')} icon="edit-2" style={s.bottomBtn} />
              <SecondaryButton label="Send to Content Creator" onPress={() => Alert.alert('Content Creator', 'Sending to Content Creator…')} icon="send" style={s.bottomBtn} />
              <SecondaryButton label="Add to Store Builder" onPress={() => Alert.alert('Store Builder', 'Added to store.')} icon="shopping-bag" style={s.bottomBtn} />
              <SecondaryButton label="Export all" onPress={() => Alert.alert('Export', 'Exporting all campaign assets…')} icon="download" style={s.bottomBtn} />
            </View>
          </View>
        )}

        <View style={s.bottomPad} />
      </ScrollView>

      {isGenerating && (
        <View style={s.overlay}>
          <BrandthreadCard style={s.overlayCard}>
            <LinearGradient colors={GRAD_CARD_GLOW} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.overlayGrad}>
              <ActivityIndicator size="large" color={PURPLE} />
              <Text style={s.overlayTitle}>Generating campaign…</Text>
              <Text style={s.overlaySub}>AI is creating your assets</Text>
            </LinearGradient>
          </BrandthreadCard>
        </View>
      )}
    </BrandthreadScreen>
  );
}

function AssetCard({ asset, router, formatGrad }: {
  asset: CampaignAsset;
  router: ReturnType<typeof useRouter>;
  formatGrad: Record<string, readonly [string, string]>;
}) {
  const fmt = CAMPAIGN_FORMATS.find((f) => f.value === asset.format);
  const gradColors = formatGrad[asset.format] ?? (['#8B5CF6', '#22D3EE'] as const);
  return (
    <BrandthreadCard style={s.assetCard}>
      <LinearGradient colors={gradColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.assetThumb}>
        <Feather name="image" size={ICON.lg} color="rgba(255,255,255,0.8)" />
        <Text style={s.assetFormat}>{fmt?.label ?? asset.format}</Text>
        {fmt && <Text style={s.assetDims}>{fmt.dims}</Text>}
      </LinearGradient>
      {asset.headline !== undefined && <Text style={s.assetHeadline} numberOfLines={2}>{asset.headline}</Text>}
      {asset.cta !== undefined && <Text style={s.assetCta} numberOfLines={1}>{asset.cta}</Text>}
      <View style={s.assetBtns}>
        <TouchableOpacity onPress={() => router.push('/design-prompt-edit')} style={s.assetBtn} activeOpacity={0.8}>
          <Feather name="edit-2" size={12} color={PURPLE_LIGHT} />
          <Text style={s.assetBtnText}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => Alert.alert('Saved', 'Asset saved.')} style={s.assetBtn} activeOpacity={0.8}>
          <Feather name="save" size={12} color={CYAN} />
          <Text style={[s.assetBtnText, { color: CYAN }]}>Save</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => Alert.alert('Export', 'Exporting asset…')} style={s.assetBtn} activeOpacity={0.8}>
          <Feather name="download" size={12} color={MUTED} />
          <Text style={s.assetBtnText}>Export</Text>
        </TouchableOpacity>
      </View>
    </BrandthreadCard>
  );
}

const s = StyleSheet.create({
  scroll:              { paddingBottom: 40 },
  ph:                  { paddingHorizontal: SP.md },
  sectionHdr:          { marginTop: SP.lg, marginBottom: SP.sm },
  stylePillsScroll:    { paddingHorizontal: SP.md, gap: SP.sm, paddingBottom: SP.sm },
  stylePill:           { paddingHorizontal: SP.md, paddingVertical: SP.sm, borderRadius: RADIUS.pill, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  stylePillActive:     { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE },
  stylePillText:       { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  stylePillTextActive: { color: PURPLE_LIGHT, fontFamily: FONT.semibold },
  colorGrid:           { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  colorSwatch:         { width: 44, height: 44, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  colorSwatchSelected: { borderColor: PURPLE },
  customColorRow:      { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.md },
  hexLabel:            { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, width: 72 },
  hexInput:            { flex: 1, height: 40, backgroundColor: CARD, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, paddingHorizontal: SP.md, fontSize: FS.sm, fontFamily: FONT.medium, color: FG },
  formatsGrid:         { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  formatCard:          { width: '48%', flexDirection: 'row', gap: SP.sm, padding: SP.sm, backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, alignItems: 'flex-start' },
  formatCardActive:    { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE },
  formatCheck:         { paddingTop: 2 },
  formatInfo:          { flex: 1, gap: 2 },
  formatLabel:         { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  formatLabelActive:   { color: PURPLE_LIGHT },
  formatDims:          { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  stepperCard:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepperLabel:        { fontSize: FS.base, fontFamily: FONT.medium, color: FG },
  stepper:             { flexDirection: 'row', alignItems: 'center', gap: SP.md },
  stepBtn:             { width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  stepBtnDisabled:     { opacity: 0.4 },
  stepperValue:        { fontSize: FS.xl, fontFamily: FONT.bold, color: FG, minWidth: 28, textAlign: 'center' },
  generateBtn:         { marginTop: SP.md },
  generateInner:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, paddingVertical: SP.md },
  generateText:        { fontSize: FS.md, fontFamily: FONT.bold, color: '#FFF' },
  results:             { marginTop: SP.lg },
  resultHeader:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, marginBottom: SP.md },
  resultTitle:         { fontSize: FS.lg, fontFamily: FONT.bold, color: FG },
  assetScroll:         { paddingHorizontal: SP.md, gap: SP.md, paddingBottom: SP.sm },
  assetCard:           { width: 200, padding: 0, overflow: 'hidden', gap: 0 },
  assetThumb:          { height: 130, alignItems: 'center', justifyContent: 'center', gap: SP.xs },
  assetFormat:         { fontSize: FS.sm, fontFamily: FONT.semibold, color: '#FFF' },
  assetDims:           { fontSize: FS.xs, fontFamily: FONT.regular, color: 'rgba(255,255,255,0.65)' },
  assetHeadline:       { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, paddingHorizontal: SP.md, paddingTop: SP.sm },
  assetCta:            { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, paddingHorizontal: SP.md, paddingTop: 2, paddingBottom: SP.sm },
  assetBtns:           { flexDirection: 'row', borderTopWidth: 1, borderTopColor: BORDER },
  assetBtn:            { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: SP.sm },
  assetBtnText:        { fontSize: FS.xs, fontFamily: FONT.medium, color: PURPLE_LIGHT },
  bottomActions:       { gap: SP.sm, paddingHorizontal: SP.md, marginTop: SP.md },
  bottomBtn:           { width: '100%' },
  overlay:             { ...StyleSheet.absoluteFillObject, backgroundColor: OVERLAY, alignItems: 'center', justifyContent: 'center', zIndex: 99 },
  overlayCard:         { width: 280, padding: 0, overflow: 'hidden' },
  overlayGrad:         { alignItems: 'center', gap: SP.md, padding: SP.xl, borderRadius: RADIUS.lg },
  overlayTitle:        { fontSize: FS.lg, fontFamily: FONT.bold, color: FG },
  overlaySub:          { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  bottomPad:           { height: 40 },
});
