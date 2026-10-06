/**
 * Brandthread Design Studio — Mockup to Model
 * Route: /design-mockup-to-model
 *
 * Single-page compact flow (kept intentionally — Dev explicitly likes this
 * one-screen structure, see PR body): garment upload + up to 4 reference
 * photos on the SAME screen, pinned "Create photos" button. After Create:
 * results screen — per-tile shimmer while generating, tap a finished tile
 * to view it full-screen with swipe between results.
 *
 * Uses the AI-tools family's shared pieces (components/ai-tools/*,
 * lib/aiToolMedia.ts) — the same components AI Photoshoot and Remove
 * Background build on, so all three tools share one results screen, one
 * button system, and one save/share implementation instead of three
 * parallel ones.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Image,
  Modal, FlatList,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets, SafeAreaProvider } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE,
  FONT, FS, SP, RADIUS, ICON, COMP,
} from '@/lib/theme';
import { isSellerDevPreview } from '@/lib/devPreview';
import { saveImageToCameraRoll, saveAllToCameraRoll, shareImage } from '@/lib/aiToolMedia';
import { AiPrimaryButton, AiButtonDock, AiSecondaryButton } from '@/components/ai-tools/AiToolButtons';
import { ReferencePhotoTiles } from '@/components/ai-tools/ReferencePhotoTiles';
import { AiResultsGrid } from '@/components/ai-tools/AiResultsGrid';
import { AiResultViewer } from '@/components/ai-tools/AiResultViewer';
import type { AiResultSlot } from '@/components/ai-tools/AiResultTypes';
import {
  generateMockupToModel,
  retryMockupToModelRef,
  createBrandAsset,
} from '@/services/designService';
import { getProducts, updateProduct } from '@/services/productService';
import type { Product } from '@/services/productTypes';
import { FirstRunTip } from '@/components/first-run-tips/FirstRunTip';
import { MOCKUP_TO_MODEL_STEPS } from '@/lib/firstRunTips/content';
import { useHideTabBar } from '@/lib/tabBarVisibility';
import { useSellerTabBarInset } from '@/hooks/useSellerTabBarInset';

/**
 * `TUTORIAL_ID` also doubles as the app-wide first-run tutorial system's
 * `<FirstRunTip id="mockup-to-model" .../>` id below — that system (built
 * by a different session) landed on dev mid-PR; kept the testID tag too
 * since it's a harmless, stable hook for tests/tooling.
 */
const TUTORIAL_ID = 'mockup-to-model';

const MAX_REFS = 4;
const FOOTER_DOCK = { position: 'relative', overflow: 'hidden' } as const;

export default function MockupToModelScreen() {
  useHideTabBar();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarInset = useSellerTabBarInset();
  const params = useLocalSearchParams<{ seedMockupUri?: string }>();

  // Form state
  const [mockupUri, setMockupUri] = useState<string | null>(null);
  const [refUris, setRefUris] = useState<string[]>([]);

  // Prefill the mockup when arriving from another AI tool (e.g. AI Design's
  // "Send to Mockup to Model"). Only applies once, on first arrival.
  useEffect(() => {
    if (params.seedMockupUri && !mockupUri) {
      setMockupUri(params.seedMockupUri);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.seedMockupUri]);

  // Generation state
  const [slots, setSlots] = useState<AiResultSlot[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasResults, setHasResults] = useState(false);

  // Keep original inputs for retry
  const mockupUriRef = useRef<string | null>(null);
  const refUrisRef = useRef<string[]>([]);

  // Track per-slot saving state for the Save icon
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [libraryIndex, setLibraryIndex] = useState<number | null>(null);
  const [savingAll, setSavingAll] = useState(false);

  // Full-screen result viewer
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  // Use-as-product-photo picker
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [pickerProducts, setPickerProducts] = useState<Product[]>([]);
  const [loadingPickerProducts, setLoadingPickerProducts] = useState(false);
  const [pickerImageUri, setPickerImageUri] = useState<string | null>(null);

  async function handleSaveSlot(refIndex: number, imageUri: string) {
    setSavingIndex(refIndex);
    const result = await saveImageToCameraRoll(imageUri, 'mockup-to-model');
    setSavingIndex(null);
    if (result.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (result.reason === 'permission') {
      Alert.alert('Permission required', 'Allow photo library access to save this image.');
    } else {
      Alert.alert('Download failed', 'Could not save this image. Please try again.');
    }
  }

  async function handleSaveAll() {
    const done = slots.filter(sl => sl.status === 'done' && sl.imageUri).map(sl => sl.imageUri!);
    if (done.length === 0) return;
    setSavingAll(true);
    const { succeeded, failed } = await saveAllToCameraRoll(done, 'mockup-to-model');
    setSavingAll(false);
    if (failed === 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Alert.alert('Some downloads failed', `${succeeded} of ${done.length} photos saved.`);
    }
  }

  async function handleSaveToLibrary(refIndex: number, imageUri: string) {
    setLibraryIndex(refIndex);
    try {
      // Real, persisted save — not local/ephemeral state. This is the
      // durable "history" of a generation batch: since the backend has no
      // dedicated generations-history endpoint yet (see PR body, "needs
      // backend"), a result a seller wants to keep has to be explicitly
      // saved here (or to a product, below) to survive leaving this screen.
      await createBrandAsset({
        name: `Mockup to Model #${refIndex + 1}`,
        type: 'graphic',
        uri: imageUri,
        tags: ['ai-generated', 'mockup-to-model'],
      });
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
    try {
      const existing = product.media ?? [];
      const newMedia = {
        id: `mockup-to-model-${Date.now()}`,
        type: 'image' as const,
        uri,
        altText: 'AI-generated model photo',
        isCover: true,
        sortOrder: existing.length,
        createdAt: new Date().toISOString(),
      };
      const updated = await updateProduct(product.id, { media: [...existing, newMedia] });
      if (updated) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Set', `"${product.name ?? 'Product'}" now uses this as its product photo.`);
      } else {
        Alert.alert("Couldn't update product", 'Try again.');
      }
    } catch {
      Alert.alert("Couldn't set product photo", 'Try again.');
    }
  }

  // ─── Pickers ───────────────────────────────────────────────────────────────

  async function pickMockup() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.92,
    });
    if (!res.canceled && res.assets[0]) {
      setMockupUri(res.assets[0].uri);
    }
  }

  function removeMockup() {
    setMockupUri(null);
  }

  async function pickReferences() {
    const remaining = MAX_REFS - refUris.length;
    if (remaining <= 0) {
      Alert.alert('Maximum reached', `You can upload at most ${MAX_REFS} reference images.`);
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.92,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
    });
    if (!res.canceled && res.assets.length > 0) {
      setRefUris(prev => {
        const uris = res.assets.map(a => a.uri);
        return [...prev, ...uris].slice(0, MAX_REFS);
      });
    }
  }

  function removeRef(index: number) {
    setRefUris(prev => prev.filter((_, i) => i !== index));
  }

  // ─── Generate ──────────────────────────────────────────────────────────────

  async function handleCreate() {
    if (!mockupUri) {
      Alert.alert('Missing mockup', 'Please upload a garment or product mockup first.');
      return;
    }
    if (refUris.length === 0) {
      Alert.alert('Missing references', 'Please add at least one reference model image.');
      return;
    }

    // Dev seller preview: this is a real, metered AI generation call — never
    // let a signed-out/fresh preview session trigger it. Same pattern as
    // app/boost.tsx's handleBoostPost() for its own paid action.
    if (isSellerDevPreview()) {
      Alert.alert(
        'Sign in required',
        'Generating AI photos requires a real seller account.\n\nSign in to a Brandthread seller account to continue.',
        [{ text: 'OK' }],
      );
      return;
    }

    mockupUriRef.current = mockupUri;
    refUrisRef.current = [...refUris];

    const initialSlots: AiResultSlot[] = refUris.map((uri, i) => ({
      id: i,
      status: 'generating',
      sourceUri: uri,
      label: `Reference ${i + 1}`,
    }));
    setSlots(initialSlots);
    setIsGenerating(true);
    setHasResults(true);

    try {
      const batch = await generateMockupToModel({ mockupUri, referenceUris: refUris });

      setSlots(prev => {
        const next = [...prev];
        for (const r of batch.results) {
          if (next[r.refIndex]) next[r.refIndex] = { ...next[r.refIndex], status: 'done', imageUri: r.imageUri };
        }
        for (const e of batch.errors) {
          if (next[e.refIndex]) next[e.refIndex] = { ...next[e.refIndex], status: 'failed', error: e.error };
        }
        return next.map(slot => slot.status === 'generating' ? { ...slot, status: 'failed', error: 'No result received.' } : slot);
      });
    } catch (err: any) {
      const msg = err?.message ?? 'Generation failed. Please try again.';
      setSlots(prev => prev.map(slot => slot.status === 'generating' ? { ...slot, status: 'failed', error: msg } : slot));
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleRetry(refIndex: number) {
    const mockup = mockupUriRef.current;
    const refUri = refUrisRef.current[refIndex];
    if (!mockup || !refUri) return;

    setSlots(prev => {
      const next = [...prev];
      if (next[refIndex]) next[refIndex] = { ...next[refIndex], status: 'generating', error: undefined };
      return next;
    });

    try {
      const result = await retryMockupToModelRef({ mockupUri: mockup, referenceUri: refUri, refIndex });
      setSlots(prev => {
        const next = [...prev];
        if (next[result.refIndex]) next[result.refIndex] = { ...next[result.refIndex], status: 'done', imageUri: result.imageUri };
        return next;
      });
    } catch (err: any) {
      const msg = err?.message ?? 'Retry failed. Please try again.';
      setSlots(prev => {
        const next = [...prev];
        if (next[refIndex]) next[refIndex] = { ...next[refIndex], status: 'failed', error: msg };
        return next;
      });
    }
  }

  const doneSlots = useMemo(() => slots.filter(sl => sl.status === 'done' && sl.imageUri), [slots]);

  // ─── Results Screen ────────────────────────────────────────────────────────

  if (hasResults) {
    const allDone = slots.every(sl => sl.status === 'done' || sl.status === 'failed');
    const successCount = slots.filter(sl => sl.status === 'done').length;
    const failCount = slots.filter(sl => sl.status === 'failed').length;

    return (
      <View style={s.root} testID={`tutorial-${TUTORIAL_ID}`}>
        <ScreenHeader
          title="Model photos"
          onBack={() => {
            if (isGenerating) {
              Alert.alert('Still generating', 'Photos are still being created. Go back anyway?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Go back', style: 'destructive', onPress: () => { setHasResults(false); setIsGenerating(false); setSlots([]); } },
              ]);
            } else {
              setHasResults(false);
              setSlots([]);
            }
          }}
        />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[s.content, { paddingBottom: insets.bottom + COMP.tabBarH + SP.xxl }]}
          showsVerticalScrollIndicator={false}
        >
          {!allDone && (
            <View style={s.progressBar}>
              <ActivityIndicator size="small" color={FG} />
              <Text style={s.progressText}>
                Generating {slots.filter(sl => sl.status === 'generating').length} photo{slots.filter(sl => sl.status === 'generating').length !== 1 ? 's' : ''}…
              </Text>
            </View>
          )}
          {allDone && successCount > 0 && (
            <View style={s.progressBar}>
              <Feather name="check-circle" size={ICON.sm} color={FG} />
              <Text style={[s.progressText, { color: FG }]}>
                {successCount} photo{successCount !== 1 ? 's' : ''} ready
                {failCount > 0 ? ` · ${failCount} failed` : ''}
              </Text>
            </View>
          )}

          <AiResultsGrid
            slots={slots}
            onOpen={(id) => setViewerIndex(doneSlots.findIndex(d => d.id === id))}
            onRetry={handleRetry}
            onSaveToLibrary={handleSaveToLibrary}
            onDownload={handleSaveSlot}
            onUseAsProduct={handleUseAsProduct}
            savingId={savingIndex}
            libraryId={libraryIndex}
          />

          <View style={s.footerRow}>
            {doneSlots.length > 0 && (
              <AiPrimaryButton
                label={`Save all (${doneSlots.length})`}
                icon="download"
                onPress={handleSaveAll}
                loading={savingAll}
                accessibilityLabel={`Save all ${doneSlots.length} photos`}
              />
            )}
            <AiSecondaryButton
              label="Start over"
              icon="refresh-cw"
              variant="outline"
              onPress={() => { setHasResults(false); setSlots([]); setMockupUri(null); setRefUris([]); }}
            />
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
            { icon: 'share', label: 'Share', onPress: (item) => shareImage(item.imageUri!, 'mockup-to-model') },
            { icon: 'package', label: 'Product', onPress: (item) => handleUseAsProduct(item.imageUri!) },
            { icon: 'refresh-cw', label: 'Redo', onPress: (item) => handleRetry(item.id) },
          ]}
        />

        <Modal
          visible={showProductPicker}
          animationType="slide"
          presentationStyle="formSheet"
          onRequestClose={() => setShowProductPicker(false)}
        >
          <SafeAreaProvider style={s.pickerRoot}>
            <ScreenHeader title="Choose a product" variant="modal" onBack={() => setShowProductPicker(false)} />
            <Text style={s.pickerSub}>This photo will become the product's cover photo.</Text>
            {loadingPickerProducts ? (
              <ActivityIndicator style={{ marginTop: 40 }} color={FG} />
            ) : (
              <FlatList
                data={pickerProducts}
                keyExtractor={p => p.id}
                contentContainerStyle={{ padding: SP.md }}
                renderItem={({ item }) => (
                  <TouchableOpacity style={s.productRow} onPress={() => confirmUseAsProduct(item)} activeOpacity={0.82}>
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
          </SafeAreaProvider>
        </Modal>
      </View>
    );
  }

  // ─── Input Screen ──────────────────────────────────────────────────────────

  const canCreate = !!mockupUri && refUris.length > 0;

  return (
    <View style={s.root} testID={`tutorial-${TUTORIAL_ID}`}>
      <ScreenHeader title="Mockup to Model" onBack={() => goBackOr(router)} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.content, { paddingBottom: SP.xl }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        accessibilityLabel="Mockup to Model form"
      >
        <Text style={s.sectionLabel}>Garment mockup</Text>
        <Text style={s.sectionSub}>Upload a flat-lay or product image of your garment. Required.</Text>
        {mockupUri ? (
          <View style={s.uploadZoneFilled}>
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              onPress={pickMockup}
              accessibilityLabel="Change garment mockup"
              accessibilityRole="button"
            >
              <Image source={{ uri: mockupUri }} style={s.uploadThumb} resizeMode="cover" />
            </TouchableOpacity>
            <TouchableOpacity
              style={s.uploadRemoveBtn}
              onPress={removeMockup}
              accessibilityLabel="Remove garment mockup"
              accessibilityRole="button"
            >
              <Feather name="x" size={14} color="#fff" />
            </TouchableOpacity>
            <View style={s.uploadOverlay} pointerEvents="none">
              <Feather name="edit-2" size={ICON.md} color="#fff" />
            </View>
          </View>
        ) : (
          <TouchableOpacity
            style={s.uploadZone}
            onPress={pickMockup}
            accessibilityLabel="Upload garment mockup"
            accessibilityRole="button"
          >
            <View style={s.uploadIconCircle}>
              <Feather name="upload" size={ICON.xl} color={FG} />
            </View>
            <Text style={s.uploadZoneTitle}>Upload garment mockup</Text>
            <Text style={s.uploadZoneSub}>JPEG, PNG or WEBP · max 8 MB</Text>
          </TouchableOpacity>
        )}

        <View style={s.sectionDivider} />
        <View style={s.sectionHeaderRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.sectionLabel}>Reference model images</Text>
            <Text style={s.sectionSub}>Add 1–4 photos. Each reference produces one distinct AI photo of a model wearing your piece.</Text>
          </View>
          <View style={s.refCountBadge}>
            <Text style={s.refCountText}>{refUris.length}/{MAX_REFS}</Text>
          </View>
        </View>

        {refUris.length > 0 ? (
          <ReferencePhotoTiles
            uris={refUris}
            max={MAX_REFS}
            onAdd={pickReferences}
            onRemove={removeRef}
            label="reference"
          />
        ) : (
          <TouchableOpacity
            style={s.refPickerBtn}
            onPress={pickReferences}
            accessibilityLabel="Add reference model images"
            accessibilityRole="button"
          >
            <Feather name="image" size={ICON.lg} color={FG} />
            <Text style={s.refPickerBtnText}>Add reference photos</Text>
            <Text style={s.refPickerBtnSub}>Select 1–4 images · multi-select supported</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* In-flow footer below the ScrollView (not floating over it), so the
          form always ends above the button. The seller tab bar is hidden
          here (useHideTabBar + root deny-list); the inset only applies if
          it ever shows. */}
      <AiButtonDock bottomInset={tabBarInset || insets.bottom} style={FOOTER_DOCK}>
        <AiPrimaryButton
          label={`Create ${refUris.length > 0 ? `${refUris.length} photo${refUris.length !== 1 ? 's' : ''}` : 'photos'}`}
          icon="zap"
          onPress={handleCreate}
          disabled={!canCreate}
          testID="create-model-photos-btn"
          accessibilityLabel="Create model photos"
          // No real per-generation cost/credit model exists in the backend
          // yet for this endpoint (checked artifacts/api-server/src/routes/
          // photography.ts) — flagging that as "needs backend" in the PR
          // body instead of fabricating a number here.
        />
      </AiButtonDock>
      {/* App-wide first-run tutorial system (built by a different session,
          landed on dev while this PR was in flight) — wired in for real
          here rather than just tagged, since it turned out to need no
          screen-specific anchors (MOCKUP_TO_MODEL_STEPS has no `targets`,
          so both steps render as centered cards). */}
      <FirstRunTip
        id="mockup-to-model"
        variant="anchored"
        contentReady
        anchored={{ steps: MOCKUP_TO_MODEL_STEPS }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  content: { padding: SP.lg },
  sectionLabel: { fontFamily: FONT.bold, fontSize: FS.md, color: FG, marginBottom: SP.xs },
  sectionSub: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, marginBottom: SP.md, lineHeight: 18 },
  sectionDivider: { height: 1, backgroundColor: BORDER, marginVertical: SP.xl },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.md, marginBottom: SP.md },
  refCountBadge: {
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm, paddingVertical: 3, alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  refCountText: { fontFamily: FONT.bold, fontSize: FS.xs, color: FG },
  uploadZone: {
    borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.xl, backgroundColor: CARD,
    height: 180, alignItems: 'center', justifyContent: 'center', gap: SP.sm, overflow: 'hidden',
  },
  uploadZoneFilled: { height: 180, borderRadius: RADIUS.xl, overflow: 'hidden', position: 'relative' },
  uploadThumb: { width: '100%', height: '100%' },
  uploadRemoveBtn: {
    position: 'absolute', top: SP.sm, right: SP.sm, width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center',
  },
  uploadOverlay: {
    position: 'absolute', bottom: SP.sm, right: SP.sm, width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  uploadIconCircle: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: CARD, borderWidth: 1,
    borderColor: BORDER, alignItems: 'center', justifyContent: 'center',
  },
  uploadZoneTitle: { fontFamily: FONT.semibold, fontSize: FS.md, color: FG },
  uploadZoneSub: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED },
  refPickerBtn: {
    borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.xl, backgroundColor: CARD,
    paddingVertical: SP.lg, alignItems: 'center', gap: SP.xs,
  },
  refPickerBtnText: { fontFamily: FONT.semibold, fontSize: FS.md, color: FG },
  refPickerBtnSub: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED },
  pickerRoot: { flex: 1, backgroundColor: BG },
  pickerSub: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, padding: SP.md, paddingTop: SP.sm, paddingBottom: 0 },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER },
  productThumb: { width: 44, height: 44, borderRadius: RADIUS.sm },
  productThumbEmpty: { backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' },
  productName: { fontFamily: FONT.medium, fontSize: FS.sm, color: FG },
  productStatus: { fontFamily: FONT.regular, fontSize: FS.xs, color: SUBTLE, textTransform: 'capitalize' },
  progressBar: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: CARD, borderRadius: RADIUS.md,
    padding: SP.md, marginBottom: SP.lg, borderWidth: 1, borderColor: BORDER,
  },
  progressText: { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED },
  footerRow: { marginTop: SP.lg, gap: SP.sm },
});
