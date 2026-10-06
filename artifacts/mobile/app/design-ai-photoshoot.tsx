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
import React, { useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  ActivityIndicator, Alert, Image, FlatList,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { isSellerDevPreview } from '@/lib/devPreview';
import { saveImageToCameraRoll, saveAllToCameraRoll, shareImage } from '@/lib/aiToolMedia';
import { ScreenHeader } from '@/components/ScreenHeader';
import { AiToolProgressBar } from '@/components/ai-tools/AiToolProgressBar';
import { AiPrimaryButton, AiButtonDock, AiSecondaryButton } from '@/components/ai-tools/AiToolButtons';
import { ReferencePhotoTiles } from '@/components/ai-tools/ReferencePhotoTiles';
import { AiResultsGrid } from '@/components/ai-tools/AiResultsGrid';
import { AiResultViewer } from '@/components/ai-tools/AiResultViewer';
import type { AiResultSlot } from '@/components/ai-tools/AiResultTypes';
import { BG, CARD, BORDER, FG, MUTED, SUBTLE, FONT, FS, SP, RADIUS, ICON, COMP } from '@/lib/theme';
import { MODEL_STYLES, SCENE_STYLES, ImageRatioKind, ModelStyleKind, SceneStyleKind } from '@/services/designTypes';
import { generatePhotoshootShot, createBrandAsset } from '@/services/designService';
import { getProducts, updateProduct } from '@/services/productService';
import type { Product } from '@/services/productTypes';
import { useHideTabBar } from '@/lib/tabBarVisibility';
import { useSellerTabBarInset } from '@/hooks/useSellerTabBarInset';

const MAX_REFS = 6; // seller-facing cap. NOTE: combined with product photos,
// the real generate call can still be rejected by the backend's own,
// smaller total-image cap (artifacts/api-server/src/routes/photography.ts's
// MAX_IMAGES = 4, server-owned, not touched here) — see handleGenerate's
// catch. Flagged as a needs-backend item in the PR body: the seller-facing
// "up to 6 references" UI exceeds what the server will actually accept
// once product photos are added in too.
const SHOT_COUNTS = [1, 2, 4];
const RATIOS: { value: ImageRatioKind; label: string }[] = [
  { value: '1:1', label: '1:1' },
  { value: '4:5', label: '4:5' },
  { value: '9:16', label: '9:16' },
];

export default function AIPhotoshootScreen() {
  useHideTabBar();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarInset = useSellerTabBarInset();

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
  const requestRef = useRef<{ productImageUris: string[]; refUris: string[] } | null>(null);

  // Product picker source photos
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [pickerProducts, setPickerProducts] = useState<Product[]>([]);
  const [loadingPickerProducts, setLoadingPickerProducts] = useState(false);
  const [pickerImageUri, setPickerImageUri] = useState<string | null>(null);

  useMemo(() => {
    getProducts().then(setProducts).catch(() => setProducts([]));
  }, []);

  function toggleProduct(id: string) {
    setSelectedProductIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function pickReferences() {
    const remaining = MAX_REFS - refUris.length;
    if (remaining <= 0) {
      Alert.alert('Maximum reached', `You can add at most ${MAX_REFS} reference photos.`);
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.92,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
    });
    if (!res.canceled && res.assets.length > 0) {
      setRefUris(prev => [...prev, ...res.assets.map(a => a.uri)].slice(0, MAX_REFS));
    }
  }

  function removeRef(index: number) {
    setRefUris(prev => prev.filter((_, i) => i !== index));
  }

  async function pickUploadInsteadOfProduct() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.92,
      allowsMultipleSelection: true,
      selectionLimit: 4,
    });
    if (!res.canceled && res.assets.length > 0) {
      setUploadedProductUris(prev => [...prev, ...res.assets.map(a => a.uri)].slice(0, 4));
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

  const canGenerate = productImageUris.length > 0;

  async function handleGenerate() {
    if (!canGenerate) {
      Alert.alert('Choose a product', 'Select at least one product photo, or upload one, first.');
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

    requestRef.current = { productImageUris, refUris };
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

    const results = await Promise.allSettled(
      initialSlots.map(() => generatePhotoshootShot({
        productImageUris, referenceUris: refUris, prompt, sceneStyle, modelStyle,
      })),
    );
    setSlots(prev => prev.map((slot, i) => {
      const r = results[i];
      if (r.status === 'fulfilled') return { ...slot, status: 'done', imageUri: r.value };
      return { ...slot, status: 'failed', error: r.reason?.message ?? 'Generation failed. Please try again.' };
    }));
    setIsGenerating(false);
  }

  async function handleRetryOne(id: number) {
    const req = requestRef.current;
    if (!req) return;
    setSlots(prev => prev.map(s => s.id === id ? { ...s, status: 'generating', error: undefined } : s));
    try {
      const uri = await generatePhotoshootShot({
        productImageUris: req.productImageUris, referenceUris: req.refUris, prompt, sceneStyle, modelStyle,
      });
      setSlots(prev => prev.map(s => s.id === id ? { ...s, status: 'done', imageUri: uri } : s));
    } catch (err: any) {
      setSlots(prev => prev.map(s => s.id === id ? { ...s, status: 'failed', error: err?.message ?? 'Retry failed. Please try again.' } : s));
    }
  }

  const doneSlots = useMemo(() => slots.filter(sl => sl.status === 'done' && sl.imageUri), [slots]);

  async function handleSaveSlot(id: number, imageUri: string) {
    setSavingIndex(id);
    const result = await saveImageToCameraRoll(imageUri, 'ai-photoshoot');
    setSavingIndex(null);
    if (result.ok) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (result.reason === 'permission') Alert.alert('Permission required', 'Allow photo library access to save this image.');
    else Alert.alert('Download failed', 'Could not save this image. Please try again.');
  }

  async function handleSaveAll() {
    const uris = doneSlots.map(sl => sl.imageUri!);
    if (uris.length === 0) return;
    setSavingAll(true);
    const { failed, succeeded } = await saveAllToCameraRoll(uris, 'ai-photoshoot');
    setSavingAll(false);
    if (failed === 0) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else Alert.alert('Some downloads failed', `${succeeded} of ${uris.length} photos saved.`);
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
        <ScreenHeader title="Photoshoot" onBack={() => setStep(1)} />
        <AiToolProgressBar step={2} />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[s.content, { paddingBottom: insets.bottom + COMP.tabBarH + SP.xxl }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={s.progressBar}>
            {!allDone ? (
              <>
                <ActivityIndicator size="small" color={FG} />
                <Text style={s.progressText}>Generating {slots.filter(sl => sl.status === 'generating').length} shot{slots.filter(sl => sl.status === 'generating').length !== 1 ? 's' : ''}…</Text>
              </>
            ) : (
              <>
                <Feather name="check-circle" size={ICON.sm} color={FG} />
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
            <AiSecondaryButton label="Back to setup" icon="arrow-left" variant="outline" onPress={() => setStep(1)} />
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
        {products === null ? (
          <ActivityIndicator style={{ marginTop: SP.lg }} color={FG} />
        ) : products.length === 0 && uploadedProductUris.length === 0 ? (
          <View style={s.emptyCatalog}>
            <Feather name="package" size={ICON.lg} color={MUTED} />
            <Text style={s.emptyCatalogTitle}>No products yet</Text>
            <Text style={s.emptyCatalogSub}>Add a product first, or upload photos directly for this shoot.</Text>
            <View style={{ flexDirection: 'row', gap: SP.sm, marginTop: SP.sm }}>
              <AiSecondaryButton label="Add a product" icon="plus" variant="outline" onPress={() => router.push('/add-product' as never)} />
              <AiSecondaryButton label="Upload photos instead" icon="upload" variant="outline" onPress={pickUploadInsteadOfProduct} />
            </View>
          </View>
        ) : (
          <>
            <View style={s.productGrid}>
              {(products ?? []).slice(0, 12).map((p) => {
                const selected = selectedProductIds.has(p.id);
                const thumb = p.media?.[0]?.uri;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[s.productTile, selected && s.productTileSelected]}
                    onPress={() => toggleProduct(p.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${selected ? 'Deselect' : 'Select'} ${p.name}`}
                  >
                    {thumb ? (
                      <Image source={{ uri: thumb }} style={s.productTileImg} resizeMode="cover" />
                    ) : (
                      <View style={[s.productTileImg, s.productTileImgEmpty]}>
                        <Feather name="package" size={ICON.md} color={SUBTLE} />
                      </View>
                    )}
                    {selected && (
                      <View style={s.productTileCheck}>
                        <Feather name="check" size={12} color={BG} />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity style={s.uploadInsteadRow} onPress={pickUploadInsteadOfProduct} accessibilityRole="button">
              <Feather name="upload" size={ICON.sm} color={MUTED} />
              <Text style={s.uploadInsteadText}>Upload photos instead</Text>
            </TouchableOpacity>
            {uploadedProductUris.length > 0 && (
              <ReferencePhotoTiles
                uris={uploadedProductUris}
                max={4}
                onAdd={pickUploadInsteadOfProduct}
                onRemove={(i) => setUploadedProductUris(prev => prev.filter((_, idx) => idx !== i))}
                label="uploaded photo"
              />
            )}
          </>
        )}

        <View style={s.sectionDivider} />
        <Text style={s.sectionLabel}>Creative reference photos</Text>
        <Text style={s.sectionSub}>Any scene, model, pose, or lighting you want to match. Optional.</Text>
        <ReferencePhotoTiles uris={refUris} max={MAX_REFS} onAdd={pickReferences} onRemove={removeRef} label="reference" />

        <View style={s.sectionDivider} />
        <Text style={s.sectionLabel}>Describe the shoot</Text>
        <TextInput
          style={s.promptInput}
          value={prompt}
          onChangeText={setPrompt}
          placeholder="e.g. Golden-hour rooftop, editorial mood, film grain"
          placeholderTextColor={SUBTLE}
          multiline
        />

        <View style={s.chipRow}>
          {SCENE_STYLES.slice(0, 6).map((opt) => (
            <TouchableOpacity key={opt.value} style={[s.chip, sceneStyle === opt.value && s.chipActive]} onPress={() => setSceneStyle(opt.value)}>
              <Text style={[s.chipText, sceneStyle === opt.value && s.chipTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={s.chipRow}>
          {MODEL_STYLES.slice(0, 5).map((opt) => (
            <TouchableOpacity key={opt.value} style={[s.chip, modelStyle === opt.value && s.chipActive]} onPress={() => setModelStyle(opt.value)}>
              <Text style={[s.chipText, modelStyle === opt.value && s.chipTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={s.optionRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.optionLabel}>Aspect ratio</Text>
            <View style={s.chipRow}>
              {RATIOS.map((r) => (
                <TouchableOpacity key={r.value} style={[s.chip, ratio === r.value && s.chipActive]} onPress={() => setRatio(r.value)}>
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
                <TouchableOpacity key={n} style={[s.chip, shotCount === n && s.chipActive]} onPress={() => setShotCount(n)}>
                  <Text style={[s.chipText, shotCount === n && s.chipTextActive]}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>

      {/* In-flow footer below the ScrollView, so Generate never floats over
          the scene/model options. The tab bar is hidden here (useHideTabBar). */}
      <AiButtonDock bottomInset={tabBarInset || insets.bottom} style={{ position: 'relative', overflow: 'hidden' }}>
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
              <TouchableOpacity style={s.productRow} onPress={() => onSelect(item)} activeOpacity={0.82}>
                {item.media?.[0]?.uri ? (
                  <Image source={{ uri: item.media[0].uri }} style={s.productThumb} resizeMode="cover" />
                ) : (
                  <View style={[s.productThumb, s.productTileImgEmpty]}>
                    <Feather name="package" size={ICON.md} color={SUBTLE} />
                  </View>
                )}
                <Text style={s.productName} numberOfLines={1}>{item.name}</Text>
                <Feather name="chevron-right" size={ICON.xs} color={MUTED} />
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  content: { padding: SP.lg },
  sectionLabel: { fontFamily: FONT.bold, fontSize: FS.md, color: FG, marginBottom: SP.xs },
  sectionSub: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, marginBottom: SP.md, lineHeight: 18 },
  sectionDivider: { height: 1, backgroundColor: BORDER, marginVertical: SP.lg },
  productGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: SP.sm },
  productTile: { width: 88, height: 88, borderRadius: RADIUS.md, overflow: 'hidden', borderWidth: 1, borderColor: BORDER, position: 'relative' },
  productTileSelected: { borderColor: FG, borderWidth: 2 },
  productTileImg: { width: '100%', height: '100%' },
  productTileImgEmpty: { backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' },
  productTileCheck: { position: 'absolute', top: 5, right: 5, width: 18, height: 18, borderRadius: 9, backgroundColor: FG, alignItems: 'center', justifyContent: 'center' },
  uploadInsteadRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SP.sm },
  uploadInsteadText: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED },
  emptyCatalog: { alignItems: 'center', gap: SP.xs, paddingVertical: SP.xl, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD },
  emptyCatalogTitle: { fontFamily: FONT.semibold, fontSize: FS.md, color: FG, marginTop: SP.xs },
  emptyCatalogSub: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, textAlign: 'center', paddingHorizontal: SP.lg },
  promptInput: {
    borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.lg, backgroundColor: CARD, color: FG,
    fontFamily: FONT.regular, fontSize: FS.sm, padding: SP.md, minHeight: 64, textAlignVertical: 'top', marginBottom: SP.md,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: SP.md },
  chip: { paddingHorizontal: SP.md, paddingVertical: 8, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD },
  chipActive: { backgroundColor: FG, borderColor: FG },
  chipText: { fontFamily: FONT.medium, fontSize: FS.xs, color: MUTED },
  chipTextActive: { color: BG },
  optionRow: { marginBottom: SP.xs },
  optionLabel: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG, marginBottom: SP.xs },
  progressBar: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: CARD, borderRadius: RADIUS.md,
    padding: SP.md, marginBottom: SP.lg, borderWidth: 1, borderColor: BORDER,
  },
  progressText: { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED },
  footerRow: { marginTop: SP.lg, gap: SP.sm },
  pickerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: BG, zIndex: 10 },
  pickerSheet: { flex: 1 },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER },
  productThumb: { width: 44, height: 44, borderRadius: RADIUS.sm },
  productName: { flex: 1, fontFamily: FONT.medium, fontSize: FS.sm, color: FG },
});
