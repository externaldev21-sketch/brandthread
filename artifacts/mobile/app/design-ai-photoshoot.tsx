import { MEDIA } from '@/lib/theme';
/**
 * Brandthread Design Studio — AI Photoshoot
 * Route: /design-ai-photoshoot
 *
 * Rebuilt to exactly two screens (setup, results), per Dev's spec — no
 * step-dot stepper, a thin white progress bar instead that glides
 * 0->50%->100% across the two screens. Reuses the AI-tools family's
 * shared pieces (components/ai-tools/*, lib/aiToolMedia.ts) — the same
 * results grid/viewer, save/share logic, reference-photo tiles, and
 * button system as Mockup to Model and Remove Background, per Dev's
 * explicit shared-components ask (these tools may merge later; sharing
 * the components now makes that a routing change, not a rewrite).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Image, FlatList,
} from 'react-native';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { isSellerDevPreview } from '@/lib/devPreview';
import { saveImageToCameraRoll, saveAllToCameraRoll, shareImage } from '@/lib/aiToolMedia';
import { ScreenHeader } from '@/components/ScreenHeader';
import { AiToolProgressBar } from '@/components/ai-tools/AiToolProgressBar';
import { AiPrimaryButton, AiButtonDock, AiSecondaryButton } from '@/components/ai-tools/AiToolButtons';
import { ReferencePhotoTiles } from '@/components/ai-tools/ReferencePhotoTiles';
import { AiSlimComposer } from '@/components/ai-tools/AiSlimComposer';
import { AiResultsGrid } from '@/components/ai-tools/AiResultsGrid';
import { AiResultViewer } from '@/components/ai-tools/AiResultViewer';
import type { AiResultSlot } from '@/components/ai-tools/AiResultTypes';
import { aiToolErrorMessage, aiToolFailure } from '@/components/ai-tools/aiToolErrorMessage';
import { BG, CARD, BORDER, FG, MUTED, SUBTLE, FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { MODEL_STYLES, SCENE_STYLES, ImageRatioKind, ModelStyleKind, SceneStyleKind } from '@/services/designTypes';
import {
  generatePhotoshootShot, preparePhotoshootPhotos, createBrandAsset,
  PHOTOSHOOT_MAX_PRODUCT_PHOTOS, PHOTOSHOOT_MAX_REFERENCE_PHOTOS, type PreparedPhotoshootPhotos,
} from '@/services/designService';
import { getProducts, updateProduct } from '@/services/productService';
import type { Product } from '@/services/productTypes';
import { useHideTabBar } from '@/lib/tabBarVisibility';
import { radius } from '@/constants/radii';
import { useScreenBottomInset } from '@/hooks/useScreenBottomInset';

// Product photos (the garment the model must wear, exactly) and creative
// reference photos (art direction) have separate budgets, the same numbers the
// server enforces: 4 product photos, 6 references.
const MAX_PRODUCT_PHOTOS = PHOTOSHOOT_MAX_PRODUCT_PHOTOS;
const MAX_REF_PHOTOS = PHOTOSHOOT_MAX_REFERENCE_PHOTOS;
const SHOT_COUNTS = [1, 2, 4];
const RATIOS: { value: ImageRatioKind; label: string }[] = [
  { value: '1:1', label: '1:1' },
  { value: '4:5', label: '4:5' },
  { value: '9:16', label: '9:16' },
];
// 92, not 84: at FS.xs (11px) the longest tile caption ("Add product")
// needs this much width to clear a 12px inner margin on each side without
// wrapping past 2 lines — see the text-fit pass in this screen's PR.
const PRODUCT_TILE = 92;

// Scene-preset image tiles (item 3 of Dev's follow-up: convert the old text
// chips to photo+label tiles). No real preset photography exists in this
// repo — using a consistent dark gradient + icon per scene, at the same
// tile size/weight as the product and reference-photo tile rows, rather
// than inventing per-scene stock photography.
const SCENE_ICONS: Record<SceneStyleKind, IconName> = {
  studio: 'aperture', street: 'map', luxury_interior: 'home', outdoor: 'sun',
  industrial: 'tool', minimal: 'minus-circle', runway: 'flag', night: 'moon', custom: 'edit-3',
};
// This scene row scrolls like a tab row, so every label must fit one line
// at PRODUCT_TILE width (text-fit pass) — "Luxury interior" is the one
// SCENE_STYLES label too long for that; shown as "Luxury" on the tile only,
// the underlying value/prompt is untouched.
const SCENE_TILE_LABEL: Partial<Record<SceneStyleKind, string>> = {
  luxury_interior: 'Luxury',
};

export default function AIPhotoshootScreen() {
  useHideTabBar();
  const router = useRouter();
  // The tab bar is hidden on this screen (useHideTabBar), so the dock only
  // clears the home indicator. Not useSellerTabBarInset(): until the hide
  // takes effect it reports the ~100pt bar height, which floated the dock
  // over the form.
  const bottomInset = useScreenBottomInset();

  const [step, setStep] = useState<1 | 2>(1);

  // Screen 1 state
  const [products, setProducts] = useState<Product[] | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [refUris, setRefUris] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [sceneStyle, setSceneStyle] = useState<SceneStyleKind>('studio');
  const [modelStyle, setModelStyle] = useState<ModelStyleKind>('female');
  const [ratio, setRatio] = useState<ImageRatioKind>('4:5');
  const [shotCount, setShotCount] = useState(2);

  // Results state
  const [slots, setSlots] = useState<AiResultSlot[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [libraryIndex, setLibraryIndex] = useState<number | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // The run's inputs, read once: retries reuse them instead of re-encoding.
  const requestRef = useRef<{ photos: PreparedPhotoshootPhotos; prompt: string; sceneStyle: SceneStyleKind; modelStyle: ModelStyleKind; ratio: ImageRatioKind; shotCount: number } | null>(null);
  // Leaving the screen (or going back to setup) cancels the run in flight.
  const runAbortRef = useRef<AbortController | null>(null);
  function cancelRun() {
    runAbortRef.current?.abort();
    runAbortRef.current = null;
  }
  useEffect(() => () => cancelRun(), []);

  // Product picker source photos
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [pickerProducts, setPickerProducts] = useState<Product[]>([]);
  const [loadingPickerProducts, setLoadingPickerProducts] = useState(false);
  const [pickerImageUri, setPickerImageUri] = useState<string | null>(null);
  // Product ids whose cover photo failed to load: shown with the placeholder.
  const [brokenThumbs, setBrokenThumbs] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    getProducts()
      .then((list) => { if (alive) setProducts(list); })
      .catch(() => { if (alive) setProducts([]); });
    return () => { alive = false; };
  }, []);

  function alertPhotoLimit(kind: 'product' | 'reference') {
    Alert.alert('Photo limit reached', kind === 'product'
      ? `Use up to ${MAX_PRODUCT_PHOTOS} product photos. Remove one to add another.`
      : `Use up to ${MAX_REF_PHOTOS} reference photos. Remove one to add another.`);
  }

  function toggleProduct(id: string) {
    if (!selectedProductIds.has(id) && productSlotsLeft <= 0) {
      alertPhotoLimit('product');
      return;
    }
    setSelectedProductIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function pickReferences() {
    const remaining = refSlotsLeft;
    if (remaining <= 0) {
      alertPhotoLimit('reference');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.92,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
    });
    if (!res.canceled && res.assets.length > 0) {
      setRefUris(prev => [...prev, ...res.assets.map(a => a.uri).slice(0, remaining)]);
    }
  }

  function removeRef(index: number) {
    setRefUris(prev => prev.filter((_, i) => i !== index));
  }

  async function pickUploadInsteadOfProduct() {
    const remaining = productSlotsLeft;
    if (remaining <= 0) {
      alertPhotoLimit('product');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.92,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
    });
    if (!res.canceled && res.assets.length > 0) {
      setUploadedProductUris(prev => [...prev, ...res.assets.map(a => a.uri).slice(0, remaining)]);
    }
  }
  const [uploadedProductUris, setUploadedProductUris] = useState<string[]>([]);

  const selectedProducts = useMemo(
    () => (products ?? []).filter(p => selectedProductIds.has(p.id)),
    [products, selectedProductIds],
  );
  const productImageUris = useMemo(() => {
    const fromProducts = selectedProducts.flatMap(p => (p.media ?? []).slice(0, 1).map(m => m.uri));
    return [...fromProducts, ...uploadedProductUris];
  }, [selectedProducts, uploadedProductUris]);

  const productSlotsLeft = Math.max(0, MAX_PRODUCT_PHOTOS - productImageUris.length);
  const refSlotsLeft = Math.max(0, MAX_REF_PHOTOS - refUris.length);
  const canGenerate = productImageUris.length > 0 && productImageUris.length <= MAX_PRODUCT_PHOTOS;

  async function handleGenerate() {
    if (productImageUris.length === 0) {
      Alert.alert('Choose a product', 'Select at least one product photo, or upload one, first.');
      return;
    }
    if (productImageUris.length > MAX_PRODUCT_PHOTOS) {
      Alert.alert('Too many product photos', `Use up to ${MAX_PRODUCT_PHOTOS} product photos. Remove ${productImageUris.length - MAX_PRODUCT_PHOTOS} to continue.`);
      return;
    }
    if (isSellerDevPreview()) {
      Alert.alert(
        'Sign in required',
        'Generating AI photoshoot photos requires a real seller account.\n\nSign in to a Brandthread seller account to continue.',
        [{ text: 'OK' }],
      );
      return;
    }

    const initialSlots: AiResultSlot[] = Array.from({ length: shotCount }, (_, i) => ({
      id: i,
      status: 'generating',
      sourceUri: productImageUris[0],
      label: `Shot ${i + 1}`,
    }));
    setSlots(initialSlots);
    setIsGenerating(true);
    setStep(2);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    cancelRun();
    const controller = new AbortController();
    runAbortRef.current = controller;
    const fail = (err: unknown) => setSlots(prev => prev.map(slot => slot.status === 'generating'
      ? { ...slot, status: 'failed', ...aiToolFailure(aiToolErrorMessage(err, 'Generation failed. Please try again.')) }
      : slot));

    let photos: PreparedPhotoshootPhotos;
    try {
      photos = await preparePhotoshootPhotos({ productImageUris, referenceUris: refUris });
    } catch (err) {
      if (!controller.signal.aborted) { fail(err); setIsGenerating(false); }
      return;
    }
    if (controller.signal.aborted) return;
    const run = { photos, prompt, sceneStyle, modelStyle, ratio, shotCount };
    requestRef.current = run;

    // Each shot lands in its tile as soon as it is ready.
    await Promise.allSettled(initialSlots.map(async (slot, i) => {
      try {
        const uri = await generatePhotoshootShot({ ...run, shotIndex: i, signal: controller.signal });
        if (!controller.signal.aborted) setSlots(prev => prev.map(s => s.id === slot.id ? { ...s, status: 'done', imageUri: uri } : s));
      } catch (err) {
        if (!controller.signal.aborted) {
          setSlots(prev => prev.map(s => s.id === slot.id ? { ...s, status: 'failed', ...aiToolFailure(aiToolErrorMessage(err, 'Generation failed. Please try again.')) } : s));
        }
      }
    }));
    if (!controller.signal.aborted) setIsGenerating(false);
  }

  async function handleRetryOne(id: number) {
    const req = requestRef.current;
    if (!req) return;
    if (!runAbortRef.current) runAbortRef.current = new AbortController();
    const signal = runAbortRef.current.signal;
    setSlots(prev => prev.map(s => s.id === id ? { ...s, status: 'generating', error: undefined } : s));
    try {
      const uri = await generatePhotoshootShot({ ...req, shotIndex: id, signal });
      if (!signal.aborted) setSlots(prev => prev.map(s => s.id === id ? { ...s, status: 'done', imageUri: uri } : s));
    } catch (err: any) {
      if (!signal.aborted) setSlots(prev => prev.map(s => s.id === id ? { ...s, status: 'failed', ...aiToolFailure(aiToolErrorMessage(err, 'Retry failed. Please try again.')) } : s));
    }
  }

  function backToSetup() {
    cancelRun();
    setIsGenerating(false);
    setStep(1);
  }

  const doneSlots = useMemo(() => slots.filter(sl => sl.status === 'done' && sl.imageUri), [slots]);

  async function handleSaveSlot(id: number, imageUri: string) {
    setSavingIndex(id);
    const result = await saveImageToCameraRoll(imageUri, 'ai-photoshoot');
    setSavingIndex(null);
    if (result.ok) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (result.reason === 'permission') Alert.alert('Permission required', 'Allow photo library access to save this image.');
    else Alert.alert(result.reason === 'unavailable' ? 'Unavailable' : 'Download failed',
      result.reason === 'unavailable' ? 'Saving to Photos is unavailable in this app build.' : 'Could not save this image. Please try again.');
  }

  async function handleSaveAll() {
    const uris = doneSlots.map(sl => sl.imageUri!);
    if (uris.length === 0) return;
    setSavingAll(true);
    const { failed, succeeded, unavailable } = await saveAllToCameraRoll(uris, 'ai-photoshoot');
    setSavingAll(false);
    if (failed === 0) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else Alert.alert(unavailable ? 'Photos unavailable' : 'Some downloads failed',
      unavailable ? 'Saving to Photos is unavailable in this app build.' : `${succeeded} of ${uris.length} photos saved.`);
  }

  async function handleSaveToLibrary(id: number, imageUri: string) {
    setLibraryIndex(id);
    try {
      await createBrandAsset({ name: `AI Photoshoot #${id + 1}`, type: 'photo', uri: imageUri, tags: ['ai-generated', 'photoshoot'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved', 'Saved to your design library.');
    } catch {
      Alert.alert('Save failed', 'Could not save to your library. Please try again.');
    } finally {
      setLibraryIndex(null);
    }
  }

  async function handleUseAsProduct(imageUri: string) {
    setPickerImageUri(imageUri);
    setLoadingPickerProducts(true);
    try {
      const all = await getProducts();
      const active = all.filter(p => p.status !== 'archived');
      if (active.length === 0) {
        Alert.alert('No products', 'Create a product first, then use this photo as its product photo.');
        return;
      }
      setPickerProducts(active);
      setShowProductPicker(true);
    } catch {
      Alert.alert("Couldn't load products", 'Try again.');
    } finally {
      setLoadingPickerProducts(false);
    }
  }

  async function confirmUseAsProduct(product: Product) {
    setShowProductPicker(false);
    const uri = pickerImageUri;
    if (!uri) return;
    const existing = product.media ?? [];
    const updated = await updateProduct(product.id, {
      media: [...existing, { id: `photoshoot-${Date.now()}`, type: 'image', uri, altText: 'AI photoshoot photo', isCover: true, sortOrder: existing.length, createdAt: new Date().toISOString() }],
    }).catch(() => null);
    if (updated) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Set', `"${product.name ?? 'Product'}" now uses this as its product photo.`);
    } else {
      Alert.alert("Couldn't update product", 'Try again.');
    }
  }

  // ─── Screen 2: results ───────────────────────────────────────────────────

  if (step === 2) {
    const allDone = slots.every(sl => sl.status === 'done' || sl.status === 'failed');
    const successCount = slots.filter(sl => sl.status === 'done').length;

    return (
      <View style={s.root}>
        <ScreenHeader title="Photoshoot" onBack={backToSetup} />
        <AiToolProgressBar step={2} />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[s.content, { paddingBottom: bottomInset + SP.xxl }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={s.progressBar}>
            {!allDone ? (
              <>
                <ActivityIndicator size="small" color={FG} />
                <Text style={s.progressText}>Generating {slots.filter(sl => sl.status === 'generating').length} shot{slots.filter(sl => sl.status === 'generating').length !== 1 ? 's' : ''}…</Text>
              </>
            ) : successCount === 0 ? (
              <>
                <Feather name="alert-circle" size={ICON.sm} color={FG} />
                <Text style={[s.progressText, { color: FG }]}>
                  {slots.some(sl => sl.retryable !== false) ? 'No shots were created. Tap Retry to try again.' : slots[0]?.error ?? 'No shots were created.'}
                </Text>
              </>
            ) : (
              <>
                <Icon name="check-circle" size={ICON.sm} color={FG} />
                <Text style={[s.progressText, { color: FG }]}>{successCount} shot{successCount !== 1 ? 's' : ''} ready</Text>
              </>
            )}
          </View>

          <AiResultsGrid
            slots={slots}
            onOpen={(id) => setViewerIndex(doneSlots.findIndex(d => d.id === id))}
            onRetry={handleRetryOne}
            onSaveToLibrary={handleSaveToLibrary}
            onDownload={handleSaveSlot}
            onUseAsProduct={handleUseAsProduct}
            savingId={savingIndex}
            libraryId={libraryIndex}
          />

          <View style={s.footerRow}>
            {doneSlots.length > 0 && (
              <AiPrimaryButton label={`Save all (${doneSlots.length})`} icon="download" onPress={handleSaveAll} loading={savingAll} />
            )}
            <AiSecondaryButton label="Back to setup" icon="arrow-left" variant="outline" onPress={backToSetup} />
          </View>
        </ScrollView>

        <AiResultViewer
          visible={viewerIndex !== null}
          items={doneSlots}
          index={viewerIndex ?? 0}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
          actions={[
            { icon: 'bookmark', label: 'Library', onPress: (item) => handleSaveToLibrary(item.id, item.imageUri!), loading: (item) => libraryIndex === item.id },
            { icon: 'download', label: 'Save', onPress: (item) => handleSaveSlot(item.id, item.imageUri!), loading: (item) => savingIndex === item.id },
            { icon: 'share', label: 'Share', onPress: (item) => shareImage(item.imageUri!, 'ai-photoshoot') },
            { icon: 'package', label: 'Product', onPress: (item) => handleUseAsProduct(item.imageUri!) },
            { icon: 'refresh-cw', label: 'Redo', onPress: (item) => handleRetryOne(item.id) },
          ]}
        />

        <ProductPickerModal
          visible={showProductPicker}
          loading={loadingPickerProducts}
          products={pickerProducts}
          onClose={() => setShowProductPicker(false)}
          onSelect={confirmUseAsProduct}
        />
      </View>
    );
  }

  // ─── Screen 1: setup ──────────────────────────────────────────────────────

  return (
    <View style={s.root}>
      <ScreenHeader title="AI Photoshoot" onBack={() => goBackOr(router)} />
      <AiToolProgressBar step={1} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.content, { paddingBottom: SP.xl }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.sectionLabel}>Product photos</Text>
        <Text style={s.sectionSub}>The exact piece the model wears. Up to {MAX_PRODUCT_PHOTOS}; front, back and detail shots help.</Text>
        {products === null ? (
          <ActivityIndicator style={{ marginTop: SP.lg }} color={FG} />
        ) : (
          <ScrollView horizontal style={s.tileRowScroller} showsHorizontalScrollIndicator={false} contentContainerStyle={s.tileRow}>
            <TouchableOpacity
              style={s.actionTile}
              onPress={pickUploadInsteadOfProduct}
              accessibilityRole="button"
              accessibilityLabel="Upload photos"
            >
              <Icon name="upload" size={20} color={MUTED} />
              <Text style={s.actionTileLabel} numberOfLines={2}>Upload</Text>
            </TouchableOpacity>
            {products.length === 0 && (
              <TouchableOpacity
                style={s.actionTile}
                onPress={() => router.push('/add-product' as never)}
                accessibilityRole="button"
                accessibilityLabel="Add a product"
              >
                <Icon name="plus-circle" size={20} color={MUTED} />
                <Text style={s.actionTileLabel} numberOfLines={2}>Add product</Text>
              </TouchableOpacity>
            )}
            {products.slice(0, 20).map((p) => {
              const selected = selectedProductIds.has(p.id);
              const thumb = brokenThumbs.has(p.id) ? undefined : p.media?.[0]?.uri;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={s.productTileWrap}
                  onPress={() => toggleProduct(p.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${selected ? 'Deselect' : 'Select'} ${p.name}`}
                  accessibilityState={{ selected }}
                >
                  <View style={[s.productTile, selected && s.productTileSelected]}>
                    {thumb ? (
                      <Image
                        source={{ uri: thumb }}
                        style={s.productTileImg}
                        resizeMode="cover"
                        onError={() => setBrokenThumbs(prev => new Set(prev).add(p.id))}
                      />
                    ) : (
                      <View style={[s.productTileImg, s.productTileImgEmpty]}>
                        <Icon name="package" size={ICON.md} color={SUBTLE} />
                      </View>
                    )}
                    {selected && (
                      <View style={s.productTileCheck}>
                        <Icon name="check" size={12} color={BG} />
                      </View>
                    )}
                  </View>
                  <Text style={[s.presetTileLabel, selected && s.presetTileLabelActive]} numberOfLines={1}>
                    {p.name || 'Untitled product'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
        {uploadedProductUris.length > 0 && (
          <View style={{ marginTop: SP.sm }}>
            <ReferencePhotoTiles
              uris={uploadedProductUris}
              max={uploadedProductUris.length + productSlotsLeft}
              onAdd={pickUploadInsteadOfProduct}
              onRemove={(i) => setUploadedProductUris(prev => prev.filter((_, idx) => idx !== i))}
              label="uploaded photo"
            />
          </View>
        )}

        <View style={s.sectionDivider} />
        <Text style={s.sectionLabel}>Creative reference photos</Text>
        <Text style={s.sectionSub}>Setting, pose and light to follow. Up to {MAX_REF_PHOTOS}{refSlotsLeft === 0 ? ', limit reached.' : `, ${refSlotsLeft} left.`}</Text>
        <ReferencePhotoTiles uris={refUris} max={MAX_REF_PHOTOS} onAdd={pickReferences} onRemove={removeRef} label="reference" />

        <View style={s.sectionDivider} />
        <Text style={s.sectionLabel}>Describe the shoot</Text>
        <AiSlimComposer
          value={prompt}
          onChangeText={setPrompt}
          placeholder="e.g. Golden-hour rooftop, editorial mood"
          icon="edit-3"
          accessibilityLabel="Describe the shoot"
        />

        <View style={s.sectionDivider} />
        <Text style={s.sectionLabel}>Scene</Text>
        <ScrollView horizontal style={s.tileRowScroller} showsHorizontalScrollIndicator={false} contentContainerStyle={s.tileRow}>
          {SCENE_STYLES.slice(0, 8).map((opt) => {
            const active = sceneStyle === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={s.presetTile}
                onPress={() => setSceneStyle(opt.value)}
                accessibilityRole="button"
                accessibilityLabel={`Scene: ${opt.label}`}
                accessibilityState={{ selected: active }}
              >
                <LinearGradient
                  colors={active ? ['#4a4a4a', MEDIA.background] : [MEDIA.background, MEDIA.background]}
                  style={[s.presetTileImg, active && s.presetTileImgActive]}
                >
                  <Icon name={SCENE_ICONS[opt.value]} size={20} color="#fff" />
                </LinearGradient>
                <Text style={[s.presetTileLabel, active && s.presetTileLabelActive]} numberOfLines={1}>
                  {SCENE_TILE_LABEL[opt.value] ?? opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <Text style={[s.optionLabel, { marginTop: SP.md }]}>Model</Text>
        <View style={s.chipRow}>
          {MODEL_STYLES.slice(0, 5).map((opt) => (
            <TouchableOpacity key={opt.value} style={[s.chip, modelStyle === opt.value && s.chipActive]} hitSlop={CHIP_HIT_SLOP} accessibilityRole="button" accessibilityState={{ selected: modelStyle === opt.value }} onPress={() => setModelStyle(opt.value)}>
              <Text style={[s.chipText, modelStyle === opt.value && s.chipTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={s.optionRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.optionLabel}>Aspect ratio</Text>
            <View style={s.chipRow}>
              {RATIOS.map((r) => (
                <TouchableOpacity key={r.value} style={[s.chip, ratio === r.value && s.chipActive]} hitSlop={CHIP_HIT_SLOP} accessibilityRole="button" accessibilityState={{ selected: ratio === r.value }} onPress={() => setRatio(r.value)}>
                  <Text style={[s.chipText, ratio === r.value && s.chipTextActive]}>{r.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
        <View style={s.optionRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.optionLabel}>Number of shots</Text>
            <View style={s.chipRow}>
              {SHOT_COUNTS.map((n) => (
                <TouchableOpacity key={n} style={[s.chip, shotCount === n && s.chipActive]} hitSlop={CHIP_HIT_SLOP} accessibilityRole="button" accessibilityState={{ selected: shotCount === n }} onPress={() => setShotCount(n)}>
                  <Text style={[s.chipText, shotCount === n && s.chipTextActive]}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>

      {/* In-flow footer below the ScrollView, so Generate never floats over
          the scene/model options. The tab bar is hidden here (useHideTabBar). */}
      <AiButtonDock bottomInset={bottomInset} style={{ position: 'relative', overflow: 'hidden' }}>
        <AiPrimaryButton
          label="Generate"
          icon="zap"
          onPress={handleGenerate}
          disabled={!canGenerate}
          accessibilityLabel="Generate photoshoot"
          // No real per-shot cost/credit model exists in the backend yet —
          // flagged as "needs backend" in the PR body instead of a made-up
          // number here (same note as Mockup to Model's Create button).
        />
      </AiButtonDock>
    </View>
  );
}

function ProductPickerModal({ visible, loading, products, onClose, onSelect }: {
  visible: boolean; loading: boolean; products: Product[]; onClose: () => void; onSelect: (p: Product) => void;
}) {
  if (!visible) return null;
  return (
    <View style={s.pickerOverlay}>
      <View style={s.pickerSheet}>
        <ScreenHeader title="Choose a product" variant="modal" onBack={onClose} />
        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={FG} />
        ) : (
          <FlatList
            data={products}
            keyExtractor={p => p.id}
            contentContainerStyle={{ padding: SP.md }}
            renderItem={({ item }) => (
              <TouchableOpacity style={s.productRow} onPress={() => onSelect(item)} activeOpacity={0.82} accessibilityRole="button" accessibilityLabel={`Use for ${item.name}`}>
                {item.media?.[0]?.uri ? (
                  <Image source={{ uri: item.media[0].uri }} style={s.productThumb} resizeMode="cover" />
                ) : (
                  <View style={[s.productThumb, s.productTileImgEmpty]}>
                    <Icon name="package" size={ICON.md} color={SUBTLE} />
                  </View>
                )}
                <Text style={s.productName} numberOfLines={1}>{item.name}</Text>
                <Icon name="chevron-right" size={ICON.xs} color={MUTED} />
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </View>
  );
}

// Option chips draw 32pt tall in wrapping rows with 8pt gaps: pad vertically
// and up to 3pt sideways past the 1pt border (never reaching a neighbouring
// chip) so every chip, even the narrow "1"/"2" shot counts, gets a 44pt tap
// area. hitSlop is measured from inside the border, hence the +1.
const CHIP_HIT_SLOP = { top: 7, bottom: 7, left: 4, right: 4 };
const UPLOAD_INSTEAD_HIT_SLOP = { top: 8, bottom: 19, left: 0, right: 0 };
const UPLOAD_INSTEAD_HIT_SLOP_ABOVE_TILES = { top: 8, bottom: 0, left: 0, right: 0 };

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  content: { padding: SP.md },
  sectionLabel: { fontFamily: FONT.bold, fontSize: FS.md, color: FG, marginBottom: SP.xs },
  sectionSub: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, marginBottom: SP.md, lineHeight: 18 },
  sectionDivider: { height: 1, backgroundColor: BORDER, marginVertical: SP.lg },
  tileRowScroller: { alignSelf: 'stretch' },
  tileRow: { flexDirection: 'row', gap: 10, paddingRight: SP.lg },
  actionTile: {
    width: PRODUCT_TILE, height: PRODUCT_TILE, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
    backgroundColor: CARD, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12,
  },
  actionTileLabel: { fontFamily: FONT.medium, fontSize: FS.xs, color: MUTED, textAlign: 'center', lineHeight: 14 },
  productTileWrap: { width: PRODUCT_TILE, alignItems: 'center', gap: 6 },
  productTile: { width: PRODUCT_TILE, height: PRODUCT_TILE, borderRadius: RADIUS.md, overflow: 'hidden', borderWidth: 1, borderColor: BORDER, position: 'relative' },
  productTileSelected: { borderColor: FG, borderWidth: 2 },
  productTileImg: { width: '100%', height: '100%' },
  productTileImgEmpty: { backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' },
  productTileCheck: { position: 'absolute', top: 5, right: 5, width: 18, height: 18, borderRadius: 9, backgroundColor: FG, alignItems: 'center', justifyContent: 'center' },
  presetTile: { width: PRODUCT_TILE, alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  presetTileImg: { width: PRODUCT_TILE, height: PRODUCT_TILE, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  presetTileImgActive: { borderWidth: 2, borderColor: FG },
  presetTileLabel: { fontFamily: FONT.medium, fontSize: FS.xs, color: MUTED, textAlign: 'center' },
  presetTileLabelActive: { color: FG, fontFamily: FONT.semibold },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: SP.md },
  chip: { paddingHorizontal: SP.md, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD },
  chipActive: { backgroundColor: FG, borderColor: FG },
  chipText: { fontFamily: FONT.medium, fontSize: FS.xs, color: MUTED },
  chipTextActive: { color: BG },
  optionRow: { marginBottom: SP.xs },
  optionLabel: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG, marginBottom: SP.xs },
  progressBar: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: CARD, borderRadius: RADIUS.md,
    padding: SP.md, marginBottom: SP.lg, borderWidth: 1, borderColor: BORDER,
  },
  progressText: { flexShrink: 1, fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED },
  footerRow: { marginTop: SP.lg, gap: SP.sm },
  pickerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: BG, zIndex: 10 },
  pickerSheet: { flex: 1 },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER },
  productThumb: { width: 44, height: 44, borderRadius: RADIUS.sm },
  productName: { flex: 1, fontFamily: FONT.medium, fontSize: FS.sm, color: FG },
});
