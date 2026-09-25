/**
 * Brandthread Design Studio — Mockup to Model
 * Route: /design-mockup-to-model
 *
 * Single-page compact flow:
 *   1. Garment/product mockup upload (required)
 *   2. Reference model images picker (1–5, multi-select, thumbnails, remove)
 *   3. Sticky "Create" button
 * After Create: per-reference generation progress → results grid with partial-failure retry.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Image,
  Dimensions, Platform, Modal, FlatList,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { File, Paths } from 'expo-file-system';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  BrandthreadScreen, BrandthreadHeader,
} from '@/components/BrandthreadUI';
import {
  BG, SURFACE, CARD, CARD_ELEVATED,
  BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE,
  FONT, FS, SP, RADIUS, ICON,
  SUCCESS, SUCCESS_DIM, RED, RED_DIM, ORANGE,
} from '@/lib/theme';
import { useAppTheme, getOnAccentTextStyle } from '@/contexts/AppThemeContext';
import {
  generateMockupToModel,
  retryMockupToModelRef,
  createBrandAsset,
  MockupToModelBatchResult,
  MockupToModelRefResult,
  MockupToModelRefError,
} from '@/services/designService';
import { getProducts, updateProduct } from '@/services/productService';
import type { Product } from '@/services/productTypes';

const { width: SW } = Dimensions.get('window');
const THUMB_SIZE = 72;
const COL_W = (SW - SP.lg * 2 - SP.sm) / 2;
const MAX_REFS = 4;

// ─── Types ────────────────────────────────────────────────────────────────────

type RefSlotStatus = 'pending' | 'generating' | 'done' | 'failed';

interface RefSlot {
  uri: string;       // original picked URI
  status: RefSlotStatus;
  imageUri?: string; // generated result
  error?: string;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function MockupToModelScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT } = theme;
  const s = createStyles(theme);
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
  const [slots, setSlots] = useState<RefSlot[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasResults, setHasResults] = useState(false);

  // Keep original inputs for retry
  const mockupUriRef = useRef<string | null>(null);
  const refUrisRef = useRef<string[]>([]);

  // Track per-slot saving state for the Save icon
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [libraryIndex, setLibraryIndex] = useState<number | null>(null);

  // Use-as-product-photo picker
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [pickerProducts, setPickerProducts] = useState<Product[]>([]);
  const [loadingPickerProducts, setLoadingPickerProducts] = useState(false);
  const [pickerImageUri, setPickerImageUri] = useState<string | null>(null);

  async function saveImageToMediaLibrary(imageUri: string): Promise<boolean> {
    try {
      const MediaLibrary = await import('expo-media-library');
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Allow photo library access to save this image.');
        return false;
      }
      let fileUri = imageUri;
      if (imageUri.startsWith('data:')) {
        const b64 = imageUri.replace(/^data:image\/[a-z]+;base64,/, '');
        const file = new File(Paths.cache, `mockup-to-model-${Date.now()}.png`);
        file.write(b64, { encoding: 'base64' });
        fileUri = file.uri;
      }
      await MediaLibrary.saveToLibraryAsync(fileUri);
      return true;
    } catch {
      return false;
    }
  }

  async function handleSaveSlot(refIndex: number, imageUri: string) {
    setSavingIndex(refIndex);
    const ok = await saveImageToMediaLibrary(imageUri);
    setSavingIndex(null);
    if (ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Downloaded', 'Saved to Photos.');
    } else {
      Alert.alert('Download failed', 'Could not save this image. Please try again.');
    }
  }

  async function handleSaveToLibrary(refIndex: number, imageUri: string) {
    setLibraryIndex(refIndex);
    try {
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

  async function pickReferences() {
    const remaining = MAX_REFS - refUris.length;
    if (remaining <= 0) {
      Alert.alert('Maximum reached', `You can upload at most ${MAX_REFS} reference images.`);
      return;
    }
    // On native, allowsMultipleSelection is available in SDK 47+
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.92,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
    });
    if (!res.canceled && res.assets.length > 0) {
      setRefUris(prev => {
        const uris = res.assets.map(a => a.uri);
        const next = [...prev, ...uris].slice(0, MAX_REFS);
        return next;
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

    // Save for retry
    mockupUriRef.current = mockupUri;
    refUrisRef.current = [...refUris];

    // Initialize slots — one per reference, in input order
    const initialSlots: RefSlot[] = refUris.map(uri => ({
      uri,
      status: 'generating',
    }));
    setSlots(initialSlots);
    setIsGenerating(true);
    setHasResults(true);

    try {
      const batch = await generateMockupToModel({
        mockupUri,
        referenceUris: refUris,
      });

      setSlots(prev => {
        const next = [...prev];
        // Apply successful results
        for (const r of batch.results) {
          if (next[r.refIndex]) {
            next[r.refIndex] = { ...next[r.refIndex], status: 'done', imageUri: r.imageUri };
          }
        }
        // Apply errors
        for (const e of batch.errors) {
          if (next[e.refIndex]) {
            next[e.refIndex] = {
              ...next[e.refIndex],
              status: 'failed',
              error: e.error,
            };
          }
        }
        // Mark any still-generating as failed (shouldn't happen)
        return next.map(slot =>
          slot.status === 'generating' ? { ...slot, status: 'failed', error: 'No result received.' } : slot,
        );
      });
    } catch (err: any) {
      const msg = err?.message ?? 'Generation failed. Please try again.';
      // Mark all pending as failed
      setSlots(prev => prev.map(slot =>
        slot.status === 'generating' ? { ...slot, status: 'failed', error: msg } : slot,
      ));
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
        if (next[result.refIndex]) {
          next[result.refIndex] = { ...next[result.refIndex], status: 'done', imageUri: result.imageUri };
        }
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

  // ─── Results Screen ────────────────────────────────────────────────────────

  if (hasResults) {
    const allDone = slots.every(s => s.status === 'done' || s.status === 'failed');
    const successCount = slots.filter(s => s.status === 'done').length;
    const failCount = slots.filter(s => s.status === 'failed').length;

    return (
      <BrandthreadScreen>
        <BrandthreadHeader
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
          contentContainerStyle={[s.content, { paddingBottom: insets.bottom + SP.xxl }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Status bar */}
          {!allDone && (
            <View style={s.progressBar}>
              <ActivityIndicator size="small" color={PURPLE} />
              <Text style={s.progressText}>
                Generating {slots.filter(sl => sl.status === 'generating').length} photo{slots.filter(sl => sl.status === 'generating').length !== 1 ? 's' : ''}…
              </Text>
            </View>
          )}
          {allDone && successCount > 0 && (
            <View style={[s.progressBar, { backgroundColor: SUCCESS_DIM }]}>
              <Feather name="check-circle" size={ICON.sm} color={SUCCESS} />
              <Text style={[s.progressText, { color: SUCCESS }]}>
                {successCount} photo{successCount !== 1 ? 's' : ''} ready
                {failCount > 0 ? ` · ${failCount} failed` : ''}
              </Text>
            </View>
          )}

          {/* Results grid */}
          <View style={s.grid}>
            {slots.map((slot, idx) => (
              <ResultCard
                key={idx}
                slot={slot}
                refIndex={idx}
                onRetry={handleRetry}
                onDownload={handleSaveSlot}
                onSaveToLibrary={handleSaveToLibrary}
                onUseAsProduct={handleUseAsProduct}
                downloading={savingIndex === idx}
                savingToLibrary={libraryIndex === idx}
                styles={s}
                PURPLE={PURPLE}
              />
            ))}
          </View>

          {/* Footer actions */}
          <View style={s.footerRow}>
            <TouchableOpacity
              style={s.footerBtn}
              onPress={() => { setHasResults(false); setSlots([]); setMockupUri(null); setRefUris([]); }}
              accessibilityLabel="Start over"
            >
              <Feather name="refresh-cw" size={ICON.sm} color={FG} />
              <Text style={s.footerBtnText}>Start over</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

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
            <Text style={s.pickerSub}>This photo will become the product's cover photo.</Text>
            {loadingPickerProducts ? (
              <ActivityIndicator style={{ marginTop: 40 }} color={PURPLE} />
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
          </View>
        </Modal>
      </BrandthreadScreen>
    );
  }

  // ─── Input Screen ──────────────────────────────────────────────────────────

  const canCreate = !!mockupUri && refUris.length > 0;

  return (
    <BrandthreadScreen>
      <BrandthreadHeader title="Mockup to Model" onBack={() => router.back()} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        accessibilityLabel="Mockup to Model form"
      >
        {/* ── How it works ── */}
        <View style={s.howToCard}>
          <Feather name="info" size={ICON.sm} color={PURPLE} />
          <Text style={s.howToText}>
            Upload a mockup or photo of your garment, then add 1–4 reference photos showing the model,
            pose, lighting, and background you want. We'll generate photoreal shots of a model in that
            exact look and setting — wearing your garment.
          </Text>
        </View>

        {/* ── Section 1: Garment Mockup ── */}
        <Text style={s.sectionLabel}>Garment mockup</Text>
        <Text style={s.sectionSub}>
          Upload a flat-lay or product image of your garment. Required.
        </Text>
        <TouchableOpacity
          style={s.uploadZone}
          onPress={pickMockup}
          accessibilityLabel={mockupUri ? 'Change garment mockup' : 'Upload garment mockup'}
          accessibilityRole="button"
        >
          {mockupUri ? (
            <>
              <Image source={{ uri: mockupUri }} style={s.uploadThumb} resizeMode="cover" />
              <View style={s.uploadOverlay}>
                <Feather name="edit-2" size={ICON.md} color="#fff" />
              </View>
            </>
          ) : (
            <>
              <View style={s.uploadIconCircle}>
                <Feather name="upload" size={ICON.xl} color={PURPLE} />
              </View>
              <Text style={s.uploadZoneTitle}>Upload garment mockup</Text>
              <Text style={s.uploadZoneSub}>JPEG, PNG or WEBP · max 8 MB</Text>
            </>
          )}
        </TouchableOpacity>

        {/* ── Section 2: Reference Model Images ── */}
        <View style={s.sectionDivider} />
        <View style={s.sectionHeaderRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.sectionLabel}>Reference model images</Text>
            <Text style={s.sectionSub}>
              Add 1–4 photos. Each reference produces one distinct AI photo of a model wearing your piece.
            </Text>
          </View>
          <View style={s.refCountBadge}>
            <Text style={s.refCountText}>{refUris.length}/{MAX_REFS}</Text>
          </View>
        </View>

        {/* Ref thumbnails */}
        {refUris.length > 0 && (
          <View style={s.refGrid}>
            {refUris.map((uri, idx) => (
              <View key={idx} style={s.refThumbContainer}>
                <Image source={{ uri }} style={s.refThumb} resizeMode="cover" />
                <TouchableOpacity
                  style={s.refRemoveBtn}
                  onPress={() => removeRef(idx)}
                  accessibilityLabel={`Remove reference ${idx + 1}`}
                  accessibilityRole="button"
                >
                  <Feather name="x" size={12} color="#fff" />
                </TouchableOpacity>
              </View>
            ))}
            {/* Add more slot */}
            {refUris.length < MAX_REFS && (
              <TouchableOpacity
                style={s.refAddSlot}
                onPress={pickReferences}
                accessibilityLabel="Add more reference images"
                accessibilityRole="button"
              >
                <Feather name="plus" size={ICON.md} color={MUTED} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Empty ref picker button */}
        {refUris.length === 0 && (
          <TouchableOpacity
            style={s.refPickerBtn}
            onPress={pickReferences}
            accessibilityLabel="Add reference model images"
            accessibilityRole="button"
          >
            <Feather name="image" size={ICON.lg} color={PURPLE} />
            <Text style={s.refPickerBtnText}>Add reference photos</Text>
            <Text style={s.refPickerBtnSub}>Select 1–4 images · multi-select supported</Text>
          </TouchableOpacity>
        )}

        {refUris.length > 0 && refUris.length < MAX_REFS && (
          <TouchableOpacity
            style={s.addMoreBtn}
            onPress={pickReferences}
            accessibilityLabel="Add more reference images"
            accessibilityRole="button"
          >
            <Feather name="plus-circle" size={ICON.sm} color={MUTED} />
            <Text style={s.addMoreBtnText}>Add more · {MAX_REFS - refUris.length} remaining</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* ── Sticky Create Button ── */}
      <View
        style={[s.stickyFooter, { paddingBottom: insets.bottom + SP.md }]}
        accessibilityLabel="Create model photos"
      >
        <TouchableOpacity
          style={[s.createBtn, !canCreate && s.createBtnDisabled]}
          onPress={handleCreate}
          disabled={!canCreate}
          accessibilityLabel="Create model photos"
          accessibilityRole="button"
          accessibilityState={{ disabled: !canCreate }}
          testID="create-model-photos-btn"
        >
          <Feather
            name="zap"
            size={ICON.md}
            color={canCreate ? theme.onAccent : MUTED}
          />
          <Text style={[s.createBtnText, !canCreate && s.createBtnTextDisabled]}>
            Create {refUris.length > 0 ? `${refUris.length} photo${refUris.length !== 1 ? 's' : ''}` : 'photos'}
          </Text>
        </TouchableOpacity>
      </View>
    </BrandthreadScreen>
  );
}

// ─── ResultCard ───────────────────────────────────────────────────────────────

interface ResultCardProps {
  slot: RefSlot;
  refIndex: number;
  onRetry: (refIndex: number) => void;
  onDownload: (refIndex: number, imageUri: string) => void;
  onSaveToLibrary: (refIndex: number, imageUri: string) => void;
  onUseAsProduct: (imageUri: string) => void;
  downloading: boolean;
  savingToLibrary: boolean;
  styles: ReturnType<typeof createStyles>;
  PURPLE: string;
}

function ResultCard({
  slot, refIndex, onRetry, onDownload, onSaveToLibrary, onUseAsProduct,
  downloading, savingToLibrary, styles: s, PURPLE,
}: ResultCardProps) {
  const [showBefore, setShowBefore] = useState(false);
  if (slot.status === 'generating') {
    return (
      <View style={s.resultCard}>
        <View style={s.resultGenerating}>
          <ActivityIndicator size="small" color={PURPLE} />
          <Text style={s.resultGeneratingText}>Generating…</Text>
        </View>
        <View style={s.resultMeta}>
          <Text style={s.resultMetaText}>Reference {refIndex + 1}</Text>
        </View>
      </View>
    );
  }

  if (slot.status === 'failed') {
    return (
      <View style={[s.resultCard, s.resultCardFailed]}>
        <View style={s.resultFailed}>
          <Feather name="alert-circle" size={ICON.lg} color={RED} />
          <Text style={s.resultFailedText}>
            {slot.error ?? 'Generation failed'}
          </Text>
          <TouchableOpacity
            style={s.retryBtn}
            onPress={() => onRetry(refIndex)}
            accessibilityLabel={`Retry reference ${refIndex + 1}`}
            accessibilityRole="button"
          >
            <Feather name="refresh-cw" size={ICON.sm} color={PURPLE} />
            <Text style={s.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
        <View style={s.resultMeta}>
          <Text style={s.resultMetaText}>Reference {refIndex + 1} · Failed</Text>
        </View>
      </View>
    );
  }

  if (slot.status === 'done' && slot.imageUri) {
    return (
      <View style={s.resultCard}>
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => setShowBefore(v => !v)}
          accessibilityLabel={showBefore ? 'Show generated photo' : 'Show original reference photo'}
          accessibilityRole="button"
        >
          <Image
            source={{ uri: showBefore ? slot.uri : slot.imageUri }}
            style={s.resultImage}
            resizeMode="cover"
          />
          <View style={s.beforeAfterPill}>
            <Text style={s.beforeAfterPillText}>{showBefore ? 'Before' : 'After'}</Text>
          </View>
        </TouchableOpacity>
        <View style={s.resultMeta}>
          <Text style={s.resultMetaText}>Reference {refIndex + 1}</Text>
        </View>
        <View style={s.resultActions}>
          <TouchableOpacity
            style={s.actionBtn}
            onPress={() => onSaveToLibrary(refIndex, slot.imageUri!)}
            accessibilityLabel="Save to library"
            disabled={savingToLibrary}
          >
            {savingToLibrary ? (
              <ActivityIndicator size="small" color={PURPLE} />
            ) : (
              <Feather name="bookmark" size={ICON.sm} color={PURPLE} />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={s.actionBtn}
            onPress={() => onDownload(refIndex, slot.imageUri!)}
            accessibilityLabel="Download to Photos"
            disabled={downloading}
          >
            {downloading ? (
              <ActivityIndicator size="small" color={FG} />
            ) : (
              <Feather name="download" size={ICON.sm} color={FG} />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={s.actionBtn}
            onPress={() => onUseAsProduct(slot.imageUri!)}
            accessibilityLabel="Use as product photo"
          >
            <Feather name="package" size={ICON.sm} color={FG} />
          </TouchableOpacity>
          <TouchableOpacity
            style={s.actionBtn}
            onPress={() => onRetry(refIndex)}
            accessibilityLabel={`Regenerate reference ${refIndex + 1}`}
          >
            <Feather name="refresh-cw" size={ICON.sm} color={MUTED} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return null;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const { accent: PURPLE, accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT } = theme;
  return StyleSheet.create({
    content: {
      padding: SP.lg,
    },
    howToCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: SP.sm,
      backgroundColor: PURPLE_DIM,
      borderRadius: RADIUS.lg,
      padding: SP.md,
      marginBottom: SP.lg,
    },
    howToText: {
      flex: 1,
      fontFamily: FONT.regular,
      fontSize: FS.sm,
      color: FG,
      lineHeight: 19,
    },
    sectionLabel: {
      fontFamily: FONT.bold,
      fontSize: FS.md,
      color: FG,
      marginBottom: SP.xs,
    },
    sectionSub: {
      fontFamily: FONT.regular,
      fontSize: FS.sm,
      color: MUTED,
      marginBottom: SP.md,
      lineHeight: 18,
    },
    sectionDivider: {
      height: 1,
      backgroundColor: BORDER,
      marginVertical: SP.xl,
    },
    sectionHeaderRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: SP.md,
      marginBottom: SP.md,
    },
    refCountBadge: {
      backgroundColor: PURPLE_DIM,
      borderRadius: RADIUS.pill,
      paddingHorizontal: SP.sm,
      paddingVertical: 3,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
    },
    refCountText: {
      fontFamily: FONT.bold,
      fontSize: FS.xs,
      color: PURPLE_LIGHT,
    },
    uploadZone: {
      borderWidth: 2,
      borderColor: BORDER,
      borderStyle: 'dashed',
      borderRadius: RADIUS.xl,
      backgroundColor: CARD,
      height: 200,
      alignItems: 'center',
      justifyContent: 'center',
      gap: SP.sm,
      overflow: 'hidden',
    },
    uploadThumb: {
      width: '100%',
      height: '100%',
    },
    uploadOverlay: {
      position: 'absolute',
      bottom: SP.sm,
      right: SP.sm,
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(0,0,0,0.6)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    uploadIconCircle: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: PURPLE_DIM,
      alignItems: 'center',
      justifyContent: 'center',
    },
    uploadZoneTitle: {
      fontFamily: FONT.semibold,
      fontSize: FS.md,
      color: FG,
    },
    uploadZoneSub: {
      fontFamily: FONT.regular,
      fontSize: FS.sm,
      color: MUTED,
    },
    // Reference picker
    refPickerBtn: {
      borderWidth: 2,
      borderColor: BORDER,
      borderStyle: 'dashed',
      borderRadius: RADIUS.xl,
      backgroundColor: CARD,
      paddingVertical: SP.xl,
      alignItems: 'center',
      gap: SP.sm,
    },
    refPickerBtnText: {
      fontFamily: FONT.semibold,
      fontSize: FS.md,
      color: FG,
    },
    refPickerBtnSub: {
      fontFamily: FONT.regular,
      fontSize: FS.sm,
      color: MUTED,
    },
    refGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: SP.sm,
      marginBottom: SP.sm,
    },
    refThumbContainer: {
      width: THUMB_SIZE,
      height: THUMB_SIZE,
      borderRadius: RADIUS.md,
      overflow: 'hidden',
      position: 'relative',
    },
    refThumb: {
      width: THUMB_SIZE,
      height: THUMB_SIZE,
    },
    refRemoveBtn: {
      position: 'absolute',
      top: 3,
      right: 3,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: 'rgba(0,0,0,0.7)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    refAddSlot: {
      width: THUMB_SIZE,
      height: THUMB_SIZE,
      borderRadius: RADIUS.md,
      borderWidth: 2,
      borderColor: BORDER,
      borderStyle: 'dashed',
      backgroundColor: CARD,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addMoreBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SP.xs,
      marginTop: SP.xs,
    },
    addMoreBtnText: {
      fontFamily: FONT.regular,
      fontSize: FS.sm,
      color: MUTED,
    },
    // Sticky footer
    stickyFooter: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: BG,
      borderTopWidth: 1,
      borderTopColor: BORDER,
      paddingTop: SP.md,
      paddingHorizontal: SP.lg,
    },
    createBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: SP.sm,
      paddingVertical: SP.md,
      borderRadius: RADIUS.lg,
      backgroundColor: PURPLE,
    },
    createBtnDisabled: {
      backgroundColor: CARD,
      borderWidth: 1,
      borderColor: BORDER,
    },
    createBtnText: {
      fontFamily: FONT.bold,
      fontSize: FS.md,
      color: theme.onAccent,
    },
    createBtnTextDisabled: {
      color: MUTED,
    },
    // Results
    progressBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SP.sm,
      backgroundColor: CARD,
      borderRadius: RADIUS.md,
      padding: SP.md,
      marginBottom: SP.lg,
      borderWidth: 1,
      borderColor: BORDER,
    },
    progressText: {
      fontFamily: FONT.medium,
      fontSize: FS.sm,
      color: MUTED,
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
    },
    resultCardFailed: {
      borderColor: RED,
    },
    resultImage: {
      width: COL_W,
      height: COL_W * 1.3,
    },
    beforeAfterPill: {
      position: 'absolute',
      top: SP.xs,
      left: SP.xs,
      backgroundColor: 'rgba(0,0,0,0.6)',
      borderRadius: RADIUS.pill,
      paddingHorizontal: SP.sm,
      paddingVertical: 2,
    },
    beforeAfterPillText: {
      fontFamily: FONT.bold,
      fontSize: FS.xs,
      color: '#fff',
    },
    pickerRoot: {
      flex: 1,
      backgroundColor: BG,
    },
    pickerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: SP.md,
      borderBottomWidth: 1,
      borderBottomColor: BORDER,
    },
    pickerTitle: {
      fontFamily: FONT.bold,
      fontSize: FS.md,
      color: FG,
    },
    pickerSub: {
      fontFamily: FONT.regular,
      fontSize: FS.sm,
      color: MUTED,
      padding: SP.md,
      paddingTop: SP.sm,
      paddingBottom: 0,
    },
    productRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SP.sm,
      paddingVertical: SP.sm,
      borderBottomWidth: 1,
      borderBottomColor: BORDER,
    },
    productThumb: {
      width: 44,
      height: 44,
      borderRadius: RADIUS.sm,
    },
    productThumbEmpty: {
      backgroundColor: SURFACE,
      alignItems: 'center',
      justifyContent: 'center',
    },
    productName: {
      fontFamily: FONT.medium,
      fontSize: FS.sm,
      color: FG,
    },
    productStatus: {
      fontFamily: FONT.regular,
      fontSize: FS.xs,
      color: SUBTLE,
      textTransform: 'capitalize',
    },
    resultGenerating: {
      width: COL_W,
      height: COL_W * 1.3,
      alignItems: 'center',
      justifyContent: 'center',
      gap: SP.sm,
      backgroundColor: SURFACE,
    },
    resultGeneratingText: {
      fontFamily: FONT.regular,
      fontSize: FS.xs,
      color: SUBTLE,
    },
    resultFailed: {
      width: COL_W,
      height: COL_W * 1.3,
      alignItems: 'center',
      justifyContent: 'center',
      padding: SP.md,
      gap: SP.sm,
      backgroundColor: RED_DIM,
    },
    resultFailedText: {
      fontFamily: FONT.regular,
      fontSize: FS.xs,
      color: RED,
      textAlign: 'center',
      lineHeight: 16,
    },
    retryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SP.xs,
      paddingHorizontal: SP.md,
      paddingVertical: SP.xs,
      borderRadius: RADIUS.pill,
      borderWidth: 1,
      borderColor: PURPLE,
      marginTop: SP.xs,
    },
    retryBtnText: {
      fontFamily: FONT.medium,
      fontSize: FS.xs,
      color: PURPLE,
    },
    resultMeta: {
      paddingHorizontal: SP.sm,
      paddingTop: SP.xs,
      paddingBottom: SP.xs,
    },
    resultMetaText: {
      fontFamily: FONT.regular,
      fontSize: FS.xs,
      color: SUBTLE,
    },
    resultActions: {
      flexDirection: 'row',
      gap: SP.xs,
      padding: SP.sm,
      paddingTop: 0,
    },
    actionBtn: {
      width: 34,
      height: 34,
      borderRadius: RADIUS.sm,
      backgroundColor: SURFACE,
      alignItems: 'center',
      justifyContent: 'center',
    },
    footerRow: {
      marginTop: SP.lg,
    },
    footerBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: SP.xs,
      paddingVertical: SP.md,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: BORDER,
      backgroundColor: CARD,
    },
    footerBtnText: {
      fontFamily: FONT.medium,
      fontSize: FS.sm,
      color: FG,
    },
  });
};
