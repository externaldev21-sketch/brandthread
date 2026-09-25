/**
 * Brandthread Design Studio — Remove Background
 * Route: /design-bg-removal
 *
 * Full spec-compliant implementation:
 * – Real background removal via OpenAI (server-side, Clerk-authenticated)
 * – PNG result saved to GCS + cached locally in document directory
 * – No base64 stored in AsyncStorage
 * – All integrations: Brand Assets, Design Studio, Product, Content Creator, Store Builder
 * – Before/after comparison, checkerboard transparency, retry, cancel, error states
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, Image, Modal, FlatList,
  Platform, Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { File, Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BG, SURFACE, CARD, CARD_ELEVATED,
  BORDER, BORDER_ACTIVE, BORDER_SUBTLE,
  FG, MUTED, SUBTLE,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import {
  saveResult, getResults, deleteResult, isLocalFileAvailable, updateResultPixels,
  type BgRemovalResult,
} from '@/services/bgRemovalService';
import BgRefineCanvas from '@/components/design/BgRefineCanvas';
import Checkerboard from '@/components/design/Checkerboard';
import {
  createBrandAsset,
} from '@/services/designService';
import {
  getProducts, updateProduct,
} from '@/services/productService';
import type { Product, ProductMedia } from '@/services/productTypes';
import DesignBgReplaceScreen from './design-bg-replace';

// ─── Constants ───────────────────────────────────────────────────────────────

const BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
const MAX_BYTES = 8 * 1_024 * 1_024; // 8 MB
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/heic', 'image/heif', 'image/webp'];
const SW = Dimensions.get('window').width;

// ─── Types ───────────────────────────────────────────────────────────────────

type Phase = 'pick' | 'processing' | 'error' | 'result';

interface SourcePhoto {
  uri: string;
  base64: string;
  mime: string;
  fileSize: number;
}

interface ProcessingError {
  message: string;
  retryable: boolean;
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function DesignBackgroundScreen() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<'remove' | 'replace'>(
    params.mode === 'replace' ? 'replace' : 'remove',
  );

  if (mode === 'replace') {
    return <DesignBgReplaceScreen embedded onSelectRemove={() => setMode('remove')} />;
  }

  return <DesignBgRemovalScreen onSelectReplace={() => setMode('replace')} />;
}

function DesignBgRemovalScreen({ onSelectReplace }: { onSelectReplace: () => void }) {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT, secondary: CYAN } = theme;
  const s = createStyles(theme);
  const router = useRouter();
  const { getToken } = useAuth();
  const insets = useSafeAreaInsets();

  // ── State ──────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>('pick');
  const [source, setSource] = useState<SourcePhoto | null>(null);
  const [result, setResult] = useState<BgRemovalResult | null>(null);
  const [inMemoryB64, setInMemoryB64] = useState<string | null>(null);
  const [error, setError] = useState<ProcessingError | null>(null);
  const [recentResults, setRecentResults] = useState<BgRemovalResult[]>([]);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // ── Load recent results ────────────────────────────────────────────────────
  const loadRecent = useCallback(async () => {
    const all = await getResults();
    setRecentResults(all.filter(isLocalFileAvailable));
  }, []);

  useEffect(() => { loadRecent(); }, [loadRecent]);

  // ── Image picking ──────────────────────────────────────────────────────────

  async function requestPermission(type: 'library' | 'camera'): Promise<boolean> {
    if (type === 'library') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission required',
          'Please allow photo library access in your device settings.',
        );
        return false;
      }
    } else {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission required',
          'Please allow camera access in your device settings.',
        );
        return false;
      }
    }
    return true;
  }

  function validateAsset(asset: ImagePicker.ImagePickerAsset): string | null {
    const mime = asset.mimeType ?? 'image/jpeg';
    if (!ACCEPTED_TYPES.includes(mime)) {
      return `Unsupported format (${mime}). Please use PNG, JPG, JPEG, or HEIC.`;
    }
    if (!asset.base64) {
      return 'Could not read image data. Please try a different photo.';
    }
    const approxBytes = Math.ceil((asset.base64.length * 3) / 4);
    if (approxBytes > MAX_BYTES) {
      return 'This image is too large (max 8 MB). Please choose a smaller photo.';
    }
    return null;
  }

  async function pickFromLibrary() {
    if (!(await requestPermission('library'))) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.92,
      base64: true,
      exif: false,
    });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    const validationError = validateAsset(asset);
    if (validationError) {
      Alert.alert('Cannot use this image', validationError);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSource({
      uri: asset.uri,
      base64: asset.base64!,
      mime: asset.mimeType ?? 'image/jpeg',
      fileSize: Math.ceil((asset.base64!.length * 3) / 4),
    });
    setResult(null);
    setInMemoryB64(null);
    setError(null);
    setPhase('pick');
  }

  async function pickFromCamera() {
    if (!(await requestPermission('camera'))) return;
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.92,
      base64: true,
      exif: false,
    });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    const validationError = validateAsset(asset);
    if (validationError) {
      Alert.alert('Cannot use this photo', validationError);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSource({
      uri: asset.uri,
      base64: asset.base64!,
      mime: asset.mimeType ?? 'image/jpeg',
      fileSize: Math.ceil((asset.base64!.length * 3) / 4),
    });
    setResult(null);
    setInMemoryB64(null);
    setError(null);
    setPhase('pick');
  }

  // ── Background removal ─────────────────────────────────────────────────────

  async function handleRemove() {
    if (!source) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPhase('processing');
    setError(null);
    setResult(null);
    setInMemoryB64(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const token = await getToken();
      if (!token) {
        setPhase('error');
        setError({ message: 'Session expired. Please sign in again.', retryable: false });
        return;
      }

      const dataUrl = `data:${source.mime};base64,${source.base64}`;

      const resp = await fetch(`${BASE_URL}/api/bg-removal/remove`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ image: dataUrl }),
      });

      if (controller.signal.aborted) return;

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ error: 'Unknown error' }));
        const serverMsg: string = body?.error ?? 'Background removal failed.';
        setPhase('error');
        setError({
          message: resp.status === 429
            ? 'Too many requests. Please wait a minute and try again.'
            : resp.status >= 500
            ? 'The service is temporarily unavailable. Please try again shortly.'
            : serverMsg,
          retryable: resp.status !== 401 && resp.status !== 403,
        });
        return;
      }

      const data: {
        b64_json: string;
        storageKey: string | null;
        size: number;
        mime: string;
        createdAt: string;
        id: string;
      } = await resp.json();

      if (!data.b64_json) {
        setPhase('error');
        setError({ message: 'The server returned an empty result. Please try again.', retryable: true });
        return;
      }

      // Keep b64 in memory for immediate display
      setInMemoryB64(data.b64_json);

      // Persist to local file + AsyncStorage (no base64 in AsyncStorage)
      const saved = await saveResult({
        id: data.id,
        b64Json: data.b64_json,
        originalUri: source.uri,
        storageKey: data.storageKey,
        size: data.size,
        createdAt: data.createdAt,
        sourceScreen: 'design_studio',
      });

      setResult(saved);
      setPhase('result');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await loadRecent();
    } catch (err: any) {
      if (err?.name === 'AbortError') return; // user cancelled
      setPhase('error');
      const isNetwork = err?.message?.includes('fetch') || err?.message?.includes('network');
      setError({
        message: isNetwork
          ? 'Network error. Check your connection and try again.'
          : 'Something went wrong. Please try again.',
        retryable: true,
      });
    } finally {
      abortRef.current = null;
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
    setPhase(source ? 'pick' : 'pick');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function handleRetry() {
    if (source) {
      handleRemove();
    } else {
      setPhase('pick');
    }
  }

  function handleProcessAnother() {
    setSource(null);
    setResult(null);
    setInMemoryB64(null);
    setError(null);
    setPhase('pick');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  /** Bakes an erase/restore brush edit into the saved result file in place. */
  async function handleApplyRefine(dataUri: string) {
    if (!result) return;
    const b64 = dataUri.replace(/^data:image\/png;base64,/, '');
    const updated = await updateResultPixels(result.id, b64);
    if (updated) {
      setResult(updated);
      setInMemoryB64(b64);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await loadRecent();
    } else {
      Alert.alert('Could not apply edit', 'Please try again.');
    }
  }

  // ── Integrations ───────────────────────────────────────────────────────────

  /** Display URI — prefer in-memory b64 for this session, fall back to local path */
  const resultDisplayUri = inMemoryB64
    ? `data:image/png;base64,${inMemoryB64}`
    : result?.localPath ?? null;

  async function handleExportPNG() {
    if (!result || !resultDisplayUri) return;
    try {
      const MediaLibrary = await import('expo-media-library');
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Allow photo library access to export the PNG.');
        return;
      }
      let exportUri: string;
      if (inMemoryB64) {
        const outFile = new File(Paths.cache, `cutout-${result.id}.png`);
        outFile.write(inMemoryB64, { encoding: 'base64' });
        exportUri = outFile.uri;
      } else {
        // localPath is already a persistent document-dir URI — export directly
        exportUri = result.localPath;
      }
      await MediaLibrary.saveToLibraryAsync(exportUri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved', 'Transparent PNG saved to your photo library.');
    } catch {
      Alert.alert('Export failed', 'Could not save to photo library. Please try again.');
    }
  }

  async function handleSaveToBrandAssets() {
    if (!result) return;
    try {
      await createBrandAsset({
        name: `Cutout ${new Date(result.createdAt).toLocaleDateString()}`,
        type: 'photo',
        uri: result.localPath,
        tags: ['bg-removed', 'transparent', 'cutout'],
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved', 'Transparent cutout added to Brand Assets.');
    } catch {
      Alert.alert('Error', 'Could not save to Brand Assets. Please try again.');
    }
  }

  async function handleAddToDesignStudio() {
    if (!result) return;
    try {
      await createBrandAsset({
        name: `Cutout ${new Date(result.createdAt).toLocaleDateString()}`,
        type: 'graphic',
        uri: result.localPath,
        tags: ['bg-removed', 'transparent', 'design-layer'],
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Added to Design Studio',
        'Your cutout is now in Brand Assets. Open a design project and insert it as an image layer from the assets panel.',
        [
          { text: 'Open Brand Assets', onPress: () => router.push('/design-brand-assets' as never) },
          { text: 'OK' },
        ],
      );
    } catch {
      Alert.alert('Error', 'Could not add to Design Studio. Please try again.');
    }
  }

  async function handleAddToProduct() {
    if (!result) return;
    setLoadingProducts(true);
    try {
      const all = await getProducts();
      const active = all.filter((p) => p.status !== 'archived');
      if (active.length === 0) {
        Alert.alert('No Products', 'Create a product first, then add this cutout to its media gallery.');
        return;
      }
      setProducts(active);
      setShowProductPicker(true);
    } catch {
      Alert.alert('Error', 'Could not load products. Please try again.');
    } finally {
      setLoadingProducts(false);
    }
  }

  async function confirmAddToProduct(product: Product) {
    if (!result) return;
    setShowProductPicker(false);
    try {
      const newMedia: ProductMedia = {
        id: `bg-${result.id}`,
        type: 'image',
        uri: result.localPath,
        altText: 'Background removed cutout',
        isCover: false,
        sortOrder: (product.media?.length ?? 0),
        createdAt: new Date().toISOString(),
      };
      const existing = product.media ?? [];
      const updated = await updateProduct(product.id, { media: [...existing, newMedia] });
      if (updated) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Added', `Cutout added to "${product.name ?? 'product'}" media gallery.`);
      } else {
        Alert.alert('Error', 'Could not update product. Please try again.');
      }
    } catch {
      Alert.alert('Error', 'Could not add to product. Please try again.');
    }
  }

  async function handleAddToContentCreator() {
    if (!result) return;
    try {
      // Save to brand assets so Content Creator can pick it from the asset panel
      await createBrandAsset({
        name: `Cutout ${new Date(result.createdAt).toLocaleDateString()}`,
        type: 'photo',
        uri: result.localPath,
        tags: ['bg-removed', 'transparent', 'content-asset'],
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Ready for Content Creator',
        'Your cutout was saved to Brand Assets. Open Content Creator and select it from the asset picker.',
        [
          { text: 'Open Content Creator', onPress: () => router.push('/create-post' as never) },
          { text: 'OK' },
        ],
      );
    } catch {
      Alert.alert('Error', 'Could not prepare asset. Please try again.');
    }
  }

  async function handleAddToStoreBuilder() {
    if (!result) return;
    try {
      await createBrandAsset({
        name: `Cutout ${new Date(result.createdAt).toLocaleDateString()}`,
        type: 'graphic',
        uri: result.localPath,
        tags: ['bg-removed', 'transparent', 'store-asset'],
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Added to Store Builder',
        'Your cutout was saved to Brand Assets and is available in Store Builder.',
        [
          { text: 'Open Store Builder', onPress: () => router.push('/store-builder' as never) },
          { text: 'OK' },
        ],
      );
    } catch {
      Alert.alert('Error', 'Could not add to Store Builder. Please try again.');
    }
  }

  async function handleDeleteResult(id: string) {
    Alert.alert('Delete result?', 'This will remove the cached cutout from this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await deleteResult(id);
          await loadRecent();
        },
      },
    ]);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const integrationActions = [
    { icon: 'download' as const,     label: 'Export PNG',           onPress: handleExportPNG },
    { icon: 'bookmark' as const,     label: 'Brand Assets',         onPress: handleSaveToBrandAssets },
    { icon: 'layers' as const,       label: 'Design Studio',        onPress: handleAddToDesignStudio },
    { icon: 'package' as const,      label: 'Add to Product',       onPress: handleAddToProduct },
    { icon: 'send' as const,         label: 'Content Creator',      onPress: handleAddToContentCreator },
    { icon: 'shopping-bag' as const, label: 'Store Builder',        onPress: handleAddToStoreBuilder },
  ];

  return (
    <View style={[s.root, { backgroundColor: 'transparent' }]}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + SP.sm }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Feather name="arrow-left" size={ICON.sm} color={FG} />
        </TouchableOpacity>
        <View style={s.headerText}>
          <Text style={s.headerTitle}>Remove Background</Text>
          <Text style={s.headerSub}>Clean product cutouts in seconds</Text>
        </View>
      </View>

      <View style={s.modeRow}>
        <TouchableOpacity style={[s.modeButton, s.modeButtonActive]} activeOpacity={0.8}>
          <Text style={[s.modeText, s.modeTextActive]}>Remove</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.modeButton} onPress={onSelectReplace} activeOpacity={0.8}>
          <Text style={s.modeText}>Replace</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + 48 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── PICK PHASE ── */}
        {(phase === 'pick') && !source && (
          <View style={s.uploadSection}>
            {/* Library picker */}
            <TouchableOpacity style={s.uploadZone} onPress={pickFromLibrary} activeOpacity={0.85}>
              <LinearGradient
                colors={theme.glowGradient}
                style={s.uploadZoneInner}
              >
                <View style={s.uploadIconRing}>
                  <Feather name="upload" size={28} color={PURPLE} />
                </View>
                <Text style={s.uploadTitle}>Upload from Library</Text>
                <Text style={s.uploadSub}>PNG, JPG, JPEG, HEIC · Max 8 MB</Text>
              </LinearGradient>
            </TouchableOpacity>

            {/* Camera */}
            <TouchableOpacity style={s.cameraBtn} onPress={pickFromCamera} activeOpacity={0.85}>
              <Feather name="camera" size={ICON.sm} color={PURPLE} />
              <Text style={s.cameraBtnText}>Take Photo</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── SOURCE SELECTED (before or after processing) ── */}
        {source && (
          <View style={s.compareSection}>
            {phase === 'result' && resultDisplayUri ? (
              <View style={{ alignItems: 'center' }}>
                <BgRefineCanvas
                  originalUri={source.uri}
                  cutoutUri={resultDisplayUri}
                  size={SW - SP.lg * 2}
                  checkerboardStyle={{ borderWidth: 1, borderColor: PURPLE }}
                  accent={PURPLE}
                  mutedColor={MUTED}
                  fgColor={FG}
                  cardColor={CARD}
                  borderColor={BORDER}
                  onExport={handleApplyRefine}
                />
              </View>
            ) : (
              <View style={s.compareRow}>
                {/* Original */}
                <View style={s.compareCol}>
                  <Text style={s.compareLabel}>ORIGINAL</Text>
                  <View style={[s.compareFrame, { backgroundColor: SURFACE, borderColor: BORDER }]}>
                    <Image source={{ uri: source.uri }} style={s.compareImg} resizeMode="contain" />
                  </View>
                </View>

                {/* Result / Processing / Empty */}
                <View style={s.compareCol}>
                  <Text style={s.compareLabel}>CUTOUT</Text>
                  <View style={[s.compareFrame, { borderColor: BORDER, overflow: 'hidden' }]}>
                    {phase === 'processing' && <Checkerboard />}
                    {phase === 'processing' && (
                      <View style={s.processingOverlay}>
                        <ActivityIndicator size="large" color={PURPLE} />
                        <Text style={s.processingText}>Removing…</Text>
                      </View>
                    )}
                    {phase === 'error' && (
                      <View style={s.errorOverlay}>
                        <Feather name="alert-circle" size={28} color="#EF4444" />
                      </View>
                    )}
                    {phase === 'pick' && (
                      <Feather name="image" size={24} color={MUTED} />
                    )}
                  </View>
                </View>
              </View>
            )}

            {/* File info */}
            <Text style={s.fileInfo}>
              {(source.fileSize / 1024).toFixed(0)} KB · {source.mime.split('/')[1].toUpperCase()}
            </Text>

            {/* Action button(s) */}
            <View style={s.actionArea}>
              {phase === 'pick' && (
                <>
                  <TouchableOpacity style={s.primaryBtn} onPress={handleRemove} activeOpacity={0.85}>
                    <LinearGradient colors={theme.primaryGradient} style={s.primaryBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                      <Feather name="scissors" size={ICON.sm} color={theme.onAccent} />
                      <Text style={[s.primaryBtnText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Remove Background</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.ghostBtn} onPress={pickFromLibrary} activeOpacity={0.7}>
                    <Text style={s.ghostBtnText}>Choose a different photo</Text>
                  </TouchableOpacity>
                </>
              )}

              {phase === 'processing' && (
                <TouchableOpacity style={s.cancelBtn} onPress={handleCancel} activeOpacity={0.8}>
                  <Feather name="x" size={ICON.sm} color={MUTED} />
                  <Text style={s.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
              )}

              {phase === 'error' && error && (
                <>
                  <View style={s.errorBox}>
                    <Feather name="alert-circle" size={16} color="#EF4444" />
                    <Text style={s.errorText}>{error.message}</Text>
                  </View>
                  {error.retryable && (
                    <TouchableOpacity style={s.primaryBtn} onPress={handleRetry} activeOpacity={0.85}>
                      <LinearGradient colors={theme.primaryGradient} style={s.primaryBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                        <Feather name="refresh-cw" size={ICON.sm} color={theme.onAccent} />
                        <Text style={[s.primaryBtnText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Try Again</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={s.ghostBtn} onPress={pickFromLibrary} activeOpacity={0.7}>
                    <Text style={s.ghostBtnText}>Choose a different photo</Text>
                  </TouchableOpacity>
                </>
              )}

              {phase === 'result' && (
                <>
                  {/* Integration grid */}
                  <Text style={s.sectionLabel}>USE THIS CUTOUT</Text>
                  <View style={s.integrationGrid}>
                    {integrationActions.map((action) => (
                      <TouchableOpacity
                        key={action.label}
                        style={s.integrationCard}
                        onPress={action.onPress}
                        activeOpacity={0.8}
                      >
                        <View style={s.integrationIcon}>
                          <Feather name={action.icon} size={18} color={PURPLE} />
                        </View>
                        <Text style={s.integrationLabel}>{action.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <TouchableOpacity style={s.ghostBtn} onPress={handleProcessAnother} activeOpacity={0.7}>
                    <Feather name="plus" size={ICON.xs} color={MUTED} />
                    <Text style={s.ghostBtnText}>Process another image</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        )}

        {/* ── RECENT RESULTS ── */}
        {recentResults.length > 0 && (
          <View style={s.recentSection}>
            <Text style={s.recentTitle}>Recent cutouts</Text>
            {recentResults.map((r) => (
              <RecentResultRow
                key={r.id}
                result={r}
                onSelect={() => {
                  setResult(r);
                  setInMemoryB64(null);
                  setSource({ uri: r.originalUri, base64: '', mime: 'image/jpeg', fileSize: 0 });
                  setPhase('result');
                }}
                onDelete={() => handleDeleteResult(r.id)}
              />
            ))}
          </View>
        )}

        {/* Dev status banner if API URL not set */}
        {!BASE_URL && (
          <View style={s.devBanner}>
            <Feather name="alert-triangle" size={14} color="#F59E0B" />
            <Text style={s.devBannerText}>
              {'[DEV] EXPO_PUBLIC_API_BASE_URL is not set — API calls will fail.'}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* ── Product Picker Modal ── */}
      <Modal
        visible={showProductPicker}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setShowProductPicker(false)}
      >
        <View style={[s.pickerRoot, { paddingTop: insets.top + SP.md }]}>
          <View style={s.pickerHeader}>
            <Text style={s.pickerTitle}>Choose a product</Text>
            <TouchableOpacity onPress={() => setShowProductPicker(false)} activeOpacity={0.7}>
              <Feather name="x" size={ICON.sm} color={FG} />
            </TouchableOpacity>
          </View>
          <Text style={s.pickerSub}>The cutout will be added to the product's media gallery</Text>

          {loadingProducts ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={PURPLE} />
          ) : (
            <FlatList
              data={products}
              keyExtractor={(p) => p.id}
              contentContainerStyle={{ padding: SP.md }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={s.productRow}
                  onPress={() => confirmAddToProduct(item)}
                  activeOpacity={0.8}
                >
                  {item.media?.[0]?.uri ? (
                    <Image source={{ uri: item.media[0].uri }} style={s.productThumb} resizeMode="cover" />
                  ) : (
                    <View style={[s.productThumb, s.productThumbEmpty]}>
                      <Feather name="package" size={16} color={MUTED} />
                    </View>
                  )}
                  <View style={s.productInfo}>
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
    </View>
  );
}

// ─── Recent Result Row ────────────────────────────────────────────────────────

function RecentResultRow({
  result,
  onSelect,
  onDelete,
}: {
  result: BgRemovalResult;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const s = createStyles(useAppTheme().theme);
  return (
    <TouchableOpacity style={s.recentRow} onPress={onSelect} activeOpacity={0.85}>
      <View style={s.recentThumbWrap}>
        <Checkerboard />
        <Image source={{ uri: result.localPath }} style={s.recentThumb} resizeMode="contain" />
      </View>
      <View style={s.recentInfo}>
        <Text style={s.recentDate}>{new Date(result.createdAt).toLocaleDateString()}</Text>
        <Text style={s.recentSize}>{(result.size / 1024).toFixed(0)} KB · PNG</Text>
      </View>
      <TouchableOpacity style={s.recentDelete} onPress={onDelete} activeOpacity={0.7}>
        <Feather name="trash-2" size={ICON.xs} color={MUTED} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const { accent: PURPLE, accentDim: PURPLE_DIM } = theme;
  return StyleSheet.create({
  modeRow:          { flexDirection: 'row', marginHorizontal: SP.md, marginBottom: SP.sm, padding: 4, gap: 4, backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER },
  modeButton:       { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.sm },
  modeButtonActive: { backgroundColor: PURPLE_DIM, borderWidth: 1, borderColor: BORDER_ACTIVE },
  modeText:         { color: MUTED, fontFamily: FONT.medium, fontSize: FS.sm },
  modeTextActive:   { color: theme.accentLight, fontFamily: FONT.semibold },
  root:             { flex: 1 },
  scroll:           { flex: 1 },
  scrollContent:    { padding: SP.md, gap: SP.lg },

  // Header
  header:           { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingHorizontal: SP.md, paddingBottom: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE },
  backBtn:          { width: 36, height: 36, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER },
  headerText:       { flex: 1 },
  headerTitle:      { fontSize: FS.lg, fontFamily: FONT.bold, color: FG },
  headerSub:        { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 1 },

  // Upload zone
  uploadSection:    { gap: SP.sm },
  uploadZone:       { borderRadius: RADIUS.lg, overflow: 'hidden', borderWidth: 1.5, borderColor: BORDER_ACTIVE, borderStyle: 'dashed' },
  uploadZoneInner:  { alignItems: 'center', paddingVertical: 48, gap: SP.md },
  uploadIconRing:   { width: 64, height: 64, borderRadius: 32, backgroundColor: PURPLE_DIM, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: PURPLE },
  uploadTitle:      { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  uploadSub:        { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  cameraBtn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, paddingVertical: 14, borderRadius: RADIUS.md, backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER },
  cameraBtnText:    { fontSize: FS.sm, fontFamily: FONT.medium, color: PURPLE },

  // Compare
  compareSection:   { gap: SP.md },
  compareRow:       { flexDirection: 'row', gap: SP.sm },
  compareCol:       { flex: 1, gap: SP.xs },
  compareLabel:     { fontSize: FS.xs, fontFamily: FONT.bold, color: MUTED, letterSpacing: 0.8 },
  compareFrame:     { aspectRatio: 1, borderRadius: RADIUS.md, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  compareImg:       { width: '100%', height: '100%' },
  checkerboard:     {
    backgroundColor: '#CBD5C0',
    // React Native doesn't support CSS background-image.
    // The grey tone hints at transparency without a white bake-in.
  },
  processingOverlay:{ alignItems: 'center', gap: SP.sm },
  processingText:   { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  errorOverlay:     { alignItems: 'center', justifyContent: 'center' },

  fileInfo:         { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },

  // Actions
  actionArea:       { gap: SP.sm },
  primaryBtn:       { borderRadius: RADIUS.md, overflow: 'hidden' },
  primaryBtnGrad:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, paddingVertical: 15 },
  primaryBtnText:   { fontSize: FS.base, fontFamily: FONT.bold, color: '#FFF' },
  cancelBtn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, paddingVertical: 14, backgroundColor: SURFACE, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER },
  cancelBtnText:    { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  ghostBtn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.xs, paddingVertical: 12 },
  ghostBtnText:     { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },

  // Error
  errorBox:         { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: RADIUS.sm, padding: SP.md, borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)' },
  errorText:        { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: '#EF4444', lineHeight: 18 },

  // Integration grid
  sectionLabel:     { fontSize: FS.xs, fontFamily: FONT.bold, color: MUTED, letterSpacing: 0.8, marginTop: SP.xs },
  integrationGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  integrationCard:  { width: (SW - SP.md * 2 - SP.sm * 2) / 3, alignItems: 'center', gap: SP.xs, paddingVertical: SP.md, backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER },
  integrationIcon:  { width: 40, height: 40, borderRadius: 20, backgroundColor: PURPLE_DIM, alignItems: 'center', justifyContent: 'center' },
  integrationLabel: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, textAlign: 'center' },

  // Recent results
  recentSection:    { gap: SP.sm },
  recentTitle:      { fontSize: FS.sm, fontFamily: FONT.bold, color: MUTED, letterSpacing: 0.5 },
  recentRow:        { flexDirection: 'row', alignItems: 'center', gap: SP.md, backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, padding: SP.sm },
  recentThumbWrap:  { width: 56, height: 56, borderRadius: RADIUS.sm, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  recentThumb:      { width: '100%', height: '100%' },
  recentInfo:       { flex: 1, gap: 2 },
  recentDate:       { fontSize: FS.sm, fontFamily: FONT.medium, color: FG },
  recentSize:       { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  recentDelete:     { padding: SP.sm },

  // Dev banner
  devBanner:        { flexDirection: 'row', gap: SP.sm, alignItems: 'flex-start', backgroundColor: 'rgba(245,158,11,0.1)', borderRadius: RADIUS.sm, padding: SP.md, borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)' },
  devBannerText:    { flex: 1, fontSize: FS.xs, fontFamily: FONT.regular, color: '#F59E0B', lineHeight: 16 },

  // Product picker modal
  pickerRoot:       { flex: 1, backgroundColor: SURFACE },
  pickerHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingBottom: SP.sm },
  pickerTitle:      { fontSize: FS.lg, fontFamily: FONT.bold, color: FG },
  pickerSub:        { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, paddingHorizontal: SP.md, marginBottom: SP.sm },
  productRow:       { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingVertical: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE },
  productThumb:     { width: 52, height: 52, borderRadius: RADIUS.sm, backgroundColor: CARD },
  productThumbEmpty:{ alignItems: 'center', justifyContent: 'center' },
  productInfo:      { flex: 1 },
  productName:      { fontSize: FS.sm, fontFamily: FONT.medium, color: FG },
  productStatus:    { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, textTransform: 'capitalize' },
  });
};
