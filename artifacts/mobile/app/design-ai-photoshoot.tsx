/**
 * Brandthread Design Studio — AI Photoshoot
 * Route: /design-ai-photoshoot
 */
import React, { useState, useEffect, useRef } from 'react';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Dimensions, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
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
  generatePhotoshoot, GeneratePhotoshootResult,
} from '@/services/designService';
import { useApi } from '@/hooks/useApi';
import { File, Paths } from 'expo-file-system';

const { width: SW } = Dimensions.get('window');
const COL_W = (SW - SP.lg * 2 - SP.sm) / 2;

type Step = 1 | 2 | 3 | 4 | 5 | 6;

const IMAGE_RATIOS: { value: ImageRatioKind; label: string }[] = [
  { value: '9:16', label: '9:16' },
  { value: '4:5', label: '4:5' },
  { value: '1:1', label: '1:1' },
  { value: '3:4', label: '3:4' },
];

const OUTPUT_FORMATS = [
  { value: 'product_page', label: 'Product page', icon: 'package' },
  { value: 'campaign', label: 'Campaign', icon: 'trending-up' },
  { value: 'story', label: 'Story', icon: 'smartphone' },
  { value: 'thread_post', label: 'Thread post', icon: 'message-square' },
  { value: 'lookbook', label: 'Lookbook', icon: 'book-open' },
  { value: 'ad_creative', label: 'Ad creative', icon: 'zap' },
] as const;

type OutputFormat = typeof OUTPUT_FORMATS[number]['value'];
type ProductOption = { id: string; name: string; images?: string[]; status?: string };

const GRAD_PALETTES: Record<number, readonly [string, string]> = {
  0: ['#0F766E', '#22D3EE'],
  1: ['#F97316', '#0EA5E9'],
  2: ['#22D3EE', '#3B82F6'],
  3: ['#F59E0B', '#F97316'],
};

export default function AIPhotoshootScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  const s = createStyles(theme);
  const router = useRouter();
  const api = useApi();
  const [step, setStep] = useState<Step>(1);

  // Step 1
  const [productSearch, setProductSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  // Step 2
  const [modelStyle, setModelStyle] = useState<ModelStyleKind>('female');
  // Step 3
  const [sceneStyle, setSceneStyle] = useState<SceneStyleKind>('studio');
  // Step 4
  const [lightingStyle, setLightingStyle] = useState<LightingStyleKind>('natural');
  // Step 5
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('product_page');
  const [count, setCount] = useState(4);
  const [imageRatio, setImageRatio] = useState<ImageRatioKind>('4:5');

  // Generation
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedCount, setGeneratedCount] = useState(0);
  const [results, setResults] = useState<GeneratePhotoshootResult | null>(null);

  // Multi-select for results
  const [selected, setSelected] = useState<Set<number>>(new Set());

  function toggleSelect(idx: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  const counterRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let active = true;
    setLoadingProducts(true);
    api.products.list()
      .then((rows) => {
        if (active) setProducts(Array.isArray(rows) ? rows as ProductOption[] : []);
      })
      .catch(() => {
        if (active) setProducts([]);
      })
      .finally(() => {
        if (active) setLoadingProducts(false);
      });
    return () => { active = false; };
  }, [api]);

  async function saveDataUriToDevice(dataUri: string): Promise<void> {
    const MediaLibrary = await import('expo-media-library');
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Please allow photo library access to save images.');
      return;
    }
    const b64 = dataUri.replace(/^data:image\/[a-z]+;base64,/, '');
    const file = new File(Paths.cache, `photoshoot_${Date.now()}.png`);
    file.write(b64, { encoding: 'base64' });
    await MediaLibrary.saveToLibraryAsync(file.uri);
  }

  async function handleSaveAll(imageUris: string[]): Promise<void> {
    const realUris = imageUris.filter(u => u.startsWith('data:'));
    if (realUris.length === 0) {
      Alert.alert('Nothing to save', 'Generate images first.');
      return;
    }
    try {
      await Promise.all(realUris.map(uri => saveDataUriToDevice(uri)));
      Alert.alert('Saved', `${realUris.length} photo${realUris.length !== 1 ? 's' : ''} saved to your photo library.`);
    } catch {
      Alert.alert('Save failed', 'Could not save all images. Please try again.');
    }
  }

  async function handleSaveSelected(imageUris: string[], selectedSet: Set<number>): Promise<void> {
    if (selectedSet.size === 0) {
      Alert.alert('Nothing selected', 'Tap photos to select them first.');
      return;
    }
    const toSave = Array.from(selectedSet).map(i => imageUris[i]).filter(u => u?.startsWith('data:'));
    if (toSave.length === 0) {
      Alert.alert('Nothing to save', 'Selected images are not yet generated.');
      return;
    }
    try {
      await Promise.all(toSave.map(uri => saveDataUriToDevice(uri)));
      Alert.alert('Saved', `${toSave.length} photo${toSave.length !== 1 ? 's' : ''} saved to your photo library.`);
    } catch {
      Alert.alert('Save failed', 'Could not save images. Please try again.');
    }
  }

  async function handleGenerate() {
    setIsGenerating(true);
    setGeneratedCount(0);
    // Mock progress counter
    let n = 0;
    counterRef.current = setInterval(() => {
      n += 1;
      setGeneratedCount(Math.min(n, count));
      if (n >= count) {
        if (counterRef.current) clearInterval(counterRef.current);
      }
    }, 3000 / count);

    try {
      const result = await generatePhotoshoot({
        productId: selectedProductId,
        modelStyle,
        sceneStyle,
        lightingStyle,
        outputFormat,
        imageRatio,
        count,
      });
      setResults(result);
      setSelected(new Set());
    } catch (error: any) {
      Alert.alert('Generation failed', error?.message || 'Please try again.');
    } finally {
      setIsGenerating(false);
      if (counterRef.current) clearInterval(counterRef.current);
    }
  }

  function goBack() {
    if (step > 1) setStep((step - 1) as Step);
    else router.back();
  }

  function goNext() {
    if (step === 1 && !selectedProductId) {
      Alert.alert('Choose a product', 'Select a product with at least one photo for the AI photoshoot.');
      return;
    }
    if (step < 6) setStep((step + 1) as Step);
  }

  // Step indicator
  function StepBar() {
    return (
      <View style={s.stepBar}>
        {([1, 2, 3, 4, 5, 6] as Step[]).map(n => (
          <View key={n} style={s.stepBarItem}>
            <View style={[s.stepDot, step >= n && s.stepDotActive]}>
              <Text style={[s.stepDotNum, step >= n && s.stepDotNumActive]}>{n}</Text>
            </View>
            {n < 6 && <View style={[s.stepConnector, step > n && s.stepConnectorActive]} />}
          </View>
        ))}
      </View>
    );
  }

  // ─── Results screen ──────────────────────────────────────────────────────────
  if (results) {
    const selectedArr = Array.from(selected);
    return (
      <BrandthreadScreen>
        <BrandthreadHeader title="Photoshoot results" onBack={() => { setResults(null); setStep(6); }} />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.resultsMeta}>
            {results.imageUris.length} photos · {results.modelStyle} · {results.sceneStyle}
          </Text>
          <View style={s.grid}>
            {results.imageUris.map((uri, idx) => {
              const isSelected = selected.has(idx);
              return (
                <TouchableOpacity
                  key={uri}
                  style={[s.resultCard, isSelected && s.resultCardSelected]}
                  onPress={() => toggleSelect(idx)}
                  activeOpacity={0.85}
                >
                  {uri.startsWith('data:') ? (
                    <Image source={{ uri }} style={s.resultGradient} resizeMode="cover" />
                  ) : (
                    <LinearGradient
                      colors={GRAD_PALETTES[idx % 4]}
                      style={s.resultGradient}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                    >
                      <Feather name="user" size={32} color="rgba(255,255,255,0.5)" />
                      <Text style={s.resultLabel}>Photo {idx + 1}</Text>
                    </LinearGradient>
                  )}
                  {/* Checkbox */}
                  <View style={[s.checkbox, isSelected && s.checkboxActive]}>
                    {isSelected && <Feather name="check" size={ICON.xs} color="#fff" />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Actions bar */}
          <View style={s.actionsBar}>
            <Text style={s.actionsTitle}>
              {selected.size > 0 ? `${selected.size} selected` : 'Select photos to act on'}
            </Text>
            <View style={s.actionsGrid}>
              {[
                { label: 'Save all', icon: 'save', onPress: () => handleSaveAll(results!.imageUris) },
                { label: 'Save selected', icon: 'bookmark', onPress: () => handleSaveSelected(results!.imageUris, selected) },
                { label: 'Retry', icon: 'refresh-cw', onPress: handleGenerate },
                { label: 'Add to Product', icon: 'package', onPress: () => Alert.alert('Add to Product', 'Attach these AI photos directly to a product listing in your store.') },
                { label: 'Seller post', icon: 'send', onPress: () => Alert.alert('Create Post', 'Share these photos as a Thread post to your brand feed.') },
                { label: 'Store Builder', icon: 'shopping-bag', onPress: () => Alert.alert('Store Builder', 'Use these photos as hero images or banners in your Store Builder.') },
                { label: 'Campaign', icon: 'trending-up', onPress: () => Alert.alert('Campaign', 'Add these photos to a marketing campaign for your next drop.') },
              ].map(a => (
                <TouchableOpacity key={a.label} style={s.actionItem} onPress={a.onPress}>
                  <View style={s.actionItemIcon}>
                    <Feather name={a.icon as any} size={ICON.sm} color={PURPLE} />
                  </View>
                  <Text style={s.actionItemText}>{a.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={s.disclaimer}>
            <Feather name="info" size={ICON.sm} color={MUTED} />
            <Text style={s.disclaimerText}>
              Images generated by AI. Results may vary — refine your prompt for best quality.
            </Text>
          </View>
        </ScrollView>
      </BrandthreadScreen>
    );
  }

  // ─── Wizard ──────────────────────────────────────────────────────────────────
  return (
    <BrandthreadScreen>
      {isGenerating && (
        <View style={s.loadingOverlay}>
          <ActivityIndicator size="large" color={PURPLE} />
          <Text style={s.loadingText}>
            Generating {generatedCount}/{count} images…
          </Text>
          <Text style={s.loadingSubtext}>Applying your photoshoot settings</Text>
        </View>
      )}

      <BrandthreadHeader title="AI Photoshoot" onBack={goBack} />
      <StepBar />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Step 1 — Choose product */}
        {step === 1 && (
          <>
            <Text style={s.stepTitle}>Choose product</Text>
            <Text style={s.stepSub}>Select the real product photos the AI should use as its reference.</Text>
            <View style={s.inputWrap}>
              <Feather name="search" size={ICON.sm} color={SUBTLE} style={s.inputIcon} />
              <TextInput
                style={[s.input, { paddingLeft: ICON.sm + SP.md + SP.sm }]}
                value={productSearch}
                onChangeText={setProductSearch}
                placeholder="Search products…"
                placeholderTextColor={SUBTLE}
              />
            </View>

            {loadingProducts ? (
              <ActivityIndicator color={PURPLE} style={{ marginVertical: SP.xl }} />
            ) : (
              <View style={s.productList}>
                {products
                  .filter(p => p.name.toLowerCase().includes(productSearch.trim().toLowerCase()))
                  .map(product => {
                    const selectedProduct = selectedProductId === product.id;
                    const cover = Array.isArray(product.images) ? product.images[0] : undefined;
                    return (
                      <TouchableOpacity
                        key={product.id}
                        style={[s.productOption, selectedProduct && s.productOptionActive]}
                        onPress={() => setSelectedProductId(product.id)}
                        activeOpacity={0.82}
                      >
                        {cover ? (
                          <Image source={{ uri: cover }} style={s.productCover} resizeMode="cover" />
                        ) : (
                          <View style={[s.productCover, s.productCoverEmpty]}>
                            <Feather name="image" size={ICON.md} color={SUBTLE} />
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={s.productOptionName} numberOfLines={1}>{product.name}</Text>
                          <Text style={s.productOptionMeta}>
                            {cover ? 'Product photo ready' : 'No product photo'}
                          </Text>
                        </View>
                        <Feather
                          name={selectedProduct ? 'check-circle' : 'circle'}
                          size={ICON.md}
                          color={selectedProduct ? PURPLE : MUTED}
                        />
                      </TouchableOpacity>
                    );
                  })}
              </View>
            )}

            <View style={s.stepBtns}>
              <GradientCard colors={theme.primaryGradient} style={{ flex: 1, shadowColor: theme.shadowColor }} onPress={goNext}>
                <View style={s.nextInner}>
                  <Text style={[s.nextText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Next</Text>
                  <Feather name="arrow-right" size={ICON.sm} color={theme.onAccent} />
                </View>
              </GradientCard>
            </View>
          </>
        )}

        {/* Step 2 — Model direction */}
        {step === 2 && (
          <>
            <Text style={s.stepTitle}>Model direction</Text>
            <Text style={s.stepSub}>Choose who wears your garment.</Text>
            <View style={s.modelGrid}>
              {MODEL_STYLES.map(m => (
                <TouchableOpacity
                  key={m.value}
                  style={[s.modelCard, modelStyle === m.value && s.modelCardActive]}
                  onPress={() => setModelStyle(m.value)}
                >
                  <View style={[s.modelCardIcon, modelStyle === m.value && s.modelCardIconActive]}>
                    <Feather name="user" size={ICON.lg} color={modelStyle === m.value ? PURPLE_LIGHT : MUTED} />
                  </View>
                  <Text style={[s.modelCardText, modelStyle === m.value && s.modelCardTextActive]}>
                    {m.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <GradientCard colors={theme.primaryGradient} style={[s.nextCard, { shadowColor: theme.shadowColor }]} onPress={goNext}>
              <View style={s.nextInner}>
                <Text style={[s.nextText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Next: Scene</Text>
                <Feather name="arrow-right" size={ICON.md} color={theme.onAccent} />
              </View>
            </GradientCard>
          </>
        )}

        {/* Step 3 — Scene */}
        {step === 3 && (
          <>
            <Text style={s.stepTitle}>Scene</Text>
            <Text style={s.stepSub}>Set the environment for your photoshoot.</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.sceneRow}>
              {SCENE_STYLES.map(sc => (
                <TouchableOpacity
                  key={sc.value}
                  style={[s.sceneCard, sceneStyle === sc.value && s.sceneCardActive]}
                  onPress={() => setSceneStyle(sc.value)}
                >
                  <LinearGradient
                    colors={sceneStyle === sc.value ? theme.primaryGradient : ['#18182E', '#12121F']}
                    style={s.sceneCardGrad}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <Feather name="image" size={ICON.md} color={sceneStyle === sc.value ? '#fff' : MUTED} />
                  </LinearGradient>
                  <Text style={[s.sceneCardText, sceneStyle === sc.value && { color: PURPLE_LIGHT }]}>
                    {sc.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <GradientCard colors={theme.primaryGradient} style={[s.nextCard, { shadowColor: theme.shadowColor }]} onPress={goNext}>
              <View style={s.nextInner}>
                <Text style={[s.nextText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Next: Lighting</Text>
                <Feather name="arrow-right" size={ICON.md} color={theme.onAccent} />
              </View>
            </GradientCard>
          </>
        )}

        {/* Step 4 — Lighting */}
        {step === 4 && (
          <>
            <Text style={s.stepTitle}>Lighting</Text>
            <Text style={s.stepSub}>Choose the lighting mood.</Text>
            <View style={s.lightingWrap}>
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
            </View>
            <GradientCard colors={theme.primaryGradient} style={[s.nextCard, { shadowColor: theme.shadowColor }]} onPress={goNext}>
              <View style={s.nextInner}>
                <Text style={[s.nextText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Next: Output format</Text>
                <Feather name="arrow-right" size={ICON.md} color={theme.onAccent} />
              </View>
            </GradientCard>
          </>
        )}

        {/* Step 5 — Output format */}
        {step === 5 && (
          <>
            <Text style={s.stepTitle}>Output format</Text>
            <Text style={s.stepSub}>Where will these photos be used?</Text>
            <View style={s.formatGrid}>
              {OUTPUT_FORMATS.map(f => (
                <TouchableOpacity
                  key={f.value}
                  style={[s.formatCard, outputFormat === f.value && s.formatCardActive]}
                  onPress={() => setOutputFormat(f.value)}
                >
                  <Feather
                    name={f.icon as any}
                    size={ICON.md}
                    color={outputFormat === f.value ? PURPLE_LIGHT : MUTED}
                  />
                  <Text style={[s.formatCardText, outputFormat === f.value && { color: PURPLE_LIGHT }]}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.label}>Count</Text>
            <View style={s.stepperRow}>
              <TouchableOpacity style={s.stepperBtn} onPress={() => setCount(Math.max(1, count - 1))}>
                <Feather name="minus" size={ICON.md} color={FG} />
              </TouchableOpacity>
              <Text style={s.stepperVal}>{count}</Text>
              <TouchableOpacity style={s.stepperBtn} onPress={() => setCount(Math.min(4, count + 1))}>
                <Feather name="plus" size={ICON.md} color={FG} />
              </TouchableOpacity>
            </View>

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

            <GradientCard colors={theme.primaryGradient} style={[s.nextCard, { shadowColor: theme.shadowColor }]} onPress={goNext}>
              <View style={s.nextInner}>
                <Text style={[s.nextText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Next: Review</Text>
                <Feather name="arrow-right" size={ICON.md} color={theme.onAccent} />
              </View>
            </GradientCard>
          </>
        )}

        {/* Step 6 — Generate */}
        {step === 6 && (
          <>
            <Text style={s.stepTitle}>Ready to shoot</Text>
            <Text style={s.stepSub}>Review your settings and generate.</Text>

            <View style={s.summaryCard}>
              <Text style={s.summaryTitle}>Photoshoot summary</Text>
              {[
                { label: 'Product', value: products.find(p => p.id === selectedProductId)?.name || 'No product selected' },
                { label: 'Model', value: MODEL_STYLES.find(m => m.value === modelStyle)?.label ?? modelStyle },
                { label: 'Scene', value: SCENE_STYLES.find(sc => sc.value === sceneStyle)?.label ?? sceneStyle },
                { label: 'Lighting', value: LIGHTING_STYLES.find(l => l.value === lightingStyle)?.label ?? lightingStyle },
                { label: 'Format', value: OUTPUT_FORMATS.find(f => f.value === outputFormat)?.label ?? outputFormat },
                { label: 'Ratio', value: imageRatio },
                { label: 'Images', value: String(count) },
              ].map(row => (
                <View key={row.label} style={s.summaryRow}>
                  <Text style={s.summaryLabel}>{row.label}</Text>
                  <Text style={s.summaryValue}>{row.value}</Text>
                </View>
              ))}
            </View>

            <GradientCard colors={theme.primaryGradient} style={[s.nextCard, { shadowColor: theme.shadowColor }]} onPress={handleGenerate}>
              <View style={s.nextInner}>
                <Feather name="camera" size={ICON.md} color={theme.onAccent} />
                <Text style={[s.nextText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Generate photoshoot</Text>
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
  stepBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP.lg,
    paddingVertical: SP.md,
  },
  stepBarItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
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
  stepDotNum: {
    fontFamily: FONT.bold,
    fontSize: FS.xs,
    color: SUBTLE,
  },
  stepDotNumActive: {
    color: PURPLE_LIGHT,
  },
  stepConnector: {
    width: 20,
    height: 2,
    backgroundColor: BORDER,
  },
  stepConnectorActive: {
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
    lineHeight: 20,
  },
  label: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    color: FG,
    marginBottom: SP.sm,
    marginTop: SP.lg,
  },
  inputWrap: {
    position: 'relative',
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: SP.lg,
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputIcon: {
    position: 'absolute',
    left: SP.md,
    zIndex: 1,
  },
  input: {
    flex: 1,
    fontFamily: FONT.regular,
    fontSize: FS.base,
    color: FG,
    padding: SP.md,
    height: 52,
  },
  productPlaceholder: {
    backgroundColor: CARD,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: BORDER,
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
    marginBottom: SP.xl,
  },
  productPlaceholderText: {
    fontFamily: FONT.semibold,
    fontSize: FS.md,
    color: MUTED,
  },
  productPlaceholderSub: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: SUBTLE,
    textAlign: 'center',
    paddingHorizontal: SP.xl,
  },
  productList: {
    gap: SP.sm,
    marginBottom: SP.xl,
  },
  productOption: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.md,
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.sm,
  },
  productOptionActive: {
    borderColor: PURPLE,
    backgroundColor: PURPLE_DIM,
  },
  productCover: {
    width: 52,
    height: 52,
    borderRadius: RADIUS.sm,
  },
  productCoverEmpty: {
    backgroundColor: CARD_ELEVATED,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productOptionName: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    color: FG,
    marginBottom: 4,
  },
  productOptionMeta: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: MUTED,
  },
  stepBtns: {
    flexDirection: 'row',
    gap: SP.sm,
    alignItems: 'stretch',
  },
  skipBtn: {
    paddingHorizontal: SP.lg,
    paddingVertical: SP.md,
    borderRadius: RADIUS.md,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipBtnText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: MUTED,
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
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    gap: SP.sm,
  },
  modelCardActive: {
    borderColor: PURPLE,
    backgroundColor: PURPLE_DIM,
  },
  modelCardIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelCardIconActive: {
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
  sceneRow: {
    flexGrow: 0,
    marginBottom: SP.lg,
  },
  sceneCard: {
    width: 100,
    marginRight: SP.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
    overflow: 'hidden',
    alignItems: 'center',
    paddingBottom: SP.sm,
  },
  sceneCardActive: {
    borderColor: PURPLE,
  },
  sceneCardGrad: {
    width: '100%',
    height: 70,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SP.xs,
  },
  sceneCardText: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    color: MUTED,
    textAlign: 'center',
    paddingHorizontal: SP.xs,
  },
  lightingWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.sm,
  },
  pill: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm - 2,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
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
  formatGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.sm,
  },
  formatCard: {
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
  formatCardActive: {
    borderColor: PURPLE,
    backgroundColor: PURPLE_DIM,
  },
  formatCardText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: MUTED,
    textAlign: 'center',
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
  loadingSubtext: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
  },
  // Results
  resultsMeta: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
    marginBottom: SP.md,
  },
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
    position: 'relative',
  },
  resultCardSelected: {
    borderColor: PURPLE,
    borderWidth: 2,
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
  checkbox: {
    position: 'absolute',
    top: SP.sm,
    right: SP.sm,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: {
    backgroundColor: PURPLE,
    borderColor: PURPLE,
  },
  actionsBar: {
    marginTop: SP.xl,
    backgroundColor: CARD,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.lg,
  },
  actionsTitle: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    color: MUTED,
    marginBottom: SP.md,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.sm,
  },
  actionItem: {
    alignItems: 'center',
    gap: SP.xs,
    width: (SW - SP.lg * 2 - SP.lg * 2 - SP.sm * 6) / 4,
  },
  actionItemIcon: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
    backgroundColor: PURPLE_DIM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionItemText: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    color: MUTED,
    textAlign: 'center',
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
  });
};
