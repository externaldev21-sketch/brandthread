import { radius as ControlRadius } from '@/constants/radii';
/**
 * Brandthread Design Studio — Remove Background
 * Route: /design-bg-removal
 *
 * One screen, no steps: pick a photo (stage, recent strip or the pinned
 * button) and removal starts right away. While it runs the stage sparkles
 * (components/ai-tools/BgRemovalGlowSweep.tsx: silver glitter while working,
 * the background dissolving to the checkerboard, a silver glisten on the
 * cutout's edge), then the same screen offers backdrop swatches, Save, Share,
 * Use (as a product photo) and Refine, the optional erase/restore brush.
 *
 * Real backend: POST /api/bg-removal/remove, which runs a self-hosted matting
 * model (BiRefNet) on the seller's own pixels — a true cutout with a soft
 * alpha edge, not an AI redraw. Every result is also kept on device via
 * services/bgRemovalService.ts saveResult().
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, Image, FlatList, Platform, Alert, LayoutChangeEvent,
  Modal, ActivityIndicator, TouchableOpacity,
} from 'react-native';
import Animated, {
  Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import { useAuth } from '@clerk/expo';
import { Icon, type IconName } from '@/components/ui/Icon';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets, SafeAreaProvider } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/BrandthreadUI';
import { useHideTabBar } from '@/lib/tabBarVisibility';
import Checkerboard from '@/components/design/Checkerboard';
import BgRefineCanvas, { type BgRefineHandle, type RefineStroke, type RefineTool } from '@/components/design/BgRefineCanvas';
import BgRemovalGlowSweep from '@/components/ai-tools/BgRemovalGlowSweep';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useRouter } from 'expo-router';
import { isSellerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';
import { saveImageToCameraRoll } from '@/lib/aiToolMedia';
import { pickImageOnWeb, fileToPickedImage } from '@/lib/webFilePicker';
import { makeDemoCutout } from '@/lib/demoCutout';
import { saveResult } from '@/services/bgRemovalService';
import { AI_CREDITS_ALERT_COPY, classifyAiCreditsError, surfaceAiCreditsError } from '@/lib/aiCreditsError';
import { BG, FG, MUTED, SUBTLE, CARD, BORDER, RED, FONT, FS, SP, RADIUS, ICON, COMP } from '@/lib/theme';
import { getMediaLibrary, mediaLibraryUnavailableMessage } from '@/lib/mediaLibraryCompat';
import { shareImage } from '@/lib/aiToolMedia';
import { getProducts, updateProduct } from '@/services/productService';
import type { Product } from '@/services/productTypes';

import { AiGeneratedBadge } from '@/components/AiGeneratedBadge';

const BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/heic', 'image/heif', 'image/webp'];
const STAGE_PAD = 14;
const CORNER_RESERVE = 44; // room above the photo for the undo/redo icons
const SILVER = '#C0C0C0';

type Phase = 'empty' | 'loaded' | 'processing' | 'done';
type Backdrop = 'transparent' | 'white' | 'black' | 'silver' | 'blur';
const BACKDROPS: { key: Backdrop; label: string }[] = [
  { key: 'transparent', label: 'Transparent' },
  { key: 'white', label: 'White' },
  { key: 'black', label: 'Black' },
  { key: 'silver', label: 'Silver' },
  { key: 'blur', label: 'Blur' },
];
const SOLID: Partial<Record<Backdrop, string>> = { white: '#FFFFFF', black: '#000000', silver: SILVER };

interface SourcePhoto { uri: string; base64: string; mime: string; w: number; h: number }
interface RecentPhoto { key: string; uri: string; assetId?: string }

function sizeOf(uri: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => Image.getSize(uri, (w, h) => resolve({ w, h }), reject));
}

// ── Drop zone ────────────────────────────────────────────────────────────────

function DropZone({ onPress }: { onPress: () => void }) {
  const reduce = useReducedMotion();
  const sheen = useSharedValue(0);
  const ring = useSharedValue(0);
  const twinkle = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    sheen.value = withRepeat(withSequence(withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.quad) }), withDelay(900, withTiming(0, { duration: 0 }))), -1, false);
    ring.value = withRepeat(withTiming(1, { duration: 2800, easing: Easing.out(Easing.quad) }), -1, false);
    twinkle.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [reduce, sheen, ring, twinkle]);
  const sheenStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -260 + sheen.value * 760 }, { rotate: '18deg' }] }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: 0.5 * (1 - ring.value), transform: [{ scale: 1 + ring.value * 0.9 }] }));
  const ring2Style = useAnimatedStyle(() => { const r = (ring.value + 0.5) % 1; return { opacity: 0.5 * (1 - r), transform: [{ scale: 1 + r * 0.9 }] }; });
  const t1 = useAnimatedStyle(() => ({ opacity: 0.25 + twinkle.value * 0.75, transform: [{ scale: 0.6 + twinkle.value * 0.5 }] }));
  const t2 = useAnimatedStyle(() => ({ opacity: 1 - twinkle.value * 0.75, transform: [{ scale: 1.1 - twinkle.value * 0.5 }] }));

  return (
    <Pressable onPress={onPress} style={s.fill} accessibilityRole="button" accessibilityLabel="Tap to choose a photo" testID="bg-removal-dropzone">
      <View style={s.dropInner}>
        <LinearGradient colors={['#141416', '#050506', '#101012']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <Animated.View pointerEvents="none" style={[s.sheen, sheenStyle]}>
          <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.10)', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[s.twinkle, { top: '18%', left: '16%' }, t1]}><Icon name="star" size={10} color={FG} /></Animated.View>
        <Animated.View pointerEvents="none" style={[s.twinkle, { top: '30%', right: '14%' }, t2]}><Icon name="star" size={14} color={SILVER} /></Animated.View>
        <Animated.View pointerEvents="none" style={[s.twinkle, { bottom: '20%', left: '22%' }, t2]}><Icon name="star" size={8} color={SILVER} /></Animated.View>
        <Animated.View pointerEvents="none" style={[s.twinkle, { bottom: '26%', right: '20%' }, t1]}><Icon name="star" size={11} color={FG} /></Animated.View>
        <View style={s.dropCenter}>
          <Animated.View style={[s.dropRing, ringStyle]} />
          <Animated.View style={[s.dropRing, ring2Style]} />
          <View style={s.dropIcon}>
            <Icon name="upload" size={ICON.xl} color={FG} />
          </View>
        </View>
        <Text style={s.dropCaption}>Tap to choose a photo</Text>
      </View>
    </Pressable>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function DesignBgRemovalScreen() {
  const router = useRouter();
  const { getToken } = useAuth();
  const insets = useSafeAreaInsets();
  useHideTabBar();

  const [phase, setPhase] = useState<Phase>('empty');
  const [source, setSource] = useState<SourcePhoto | null>(null);
  const [cutoutUri, setCutoutUri] = useState<string | null>(null);
  const [sweepDone, setSweepDone] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [recent, setRecent] = useState<RecentPhoto[]>([]);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [backdrop, setBackdrop] = useState<Backdrop>('transparent');

  // Edit history: applied refinements (data URIs) + in-session brush strokes.
  const [history, setHistory] = useState<string[]>([]);
  const [hIndex, setHIndex] = useState(0);
  const [refining, setRefining] = useState(false);
  const [tool, setTool] = useState<RefineTool>('erase');
  const [strokes, setStrokes] = useState<RefineStroke[]>([]);
  const [redo, setRedo] = useState<RefineStroke[]>([]);
  const [applying, setApplying] = useState(false);

  // "Use": set the cutout as a product's cover photo.
  const [productPicker, setProductPicker] = useState<{ products: Product[]; uri: string } | null>(null);
  const [usingProduct, setUsingProduct] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const runRemovalRef = useRef<((src: SourcePhoto) => void) | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refineRef = useRef<BgRefineHandle>(null);
  const canvasRef = useRef<View>(null);

  useEffect(() => () => { abortRef.current?.abort(); if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  // Native: the user's real library feeds the strip. Web has no library API, so
  // the strip starts with just the "+" tile and gains the photos picked here.
  useEffect(() => {
    const MediaLibrary = getMediaLibrary();
    if (!MediaLibrary) return;
    let cancelled = false;
    (async () => {
      try {
        const perm = await MediaLibrary.requestPermissionsAsync();
        if (!perm.granted) return;
        const page = await MediaLibrary.getAssetsAsync({
          mediaType: ['photo'], sortBy: [[MediaLibrary.SortBy.creationTime, false]], first: 30,
        });
        if (!cancelled) setRecent(page.assets.map(a => ({ key: a.id, uri: a.uri, assetId: a.id })));
      } catch { /* no access — the "+" tile still opens the system picker */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const cutout = history[hIndex] ?? cutoutUri;
  const photoRect = useMemo(() => {
    const aw = Math.max(0, stage.w - STAGE_PAD * 2);
    const ah = Math.max(0, stage.h - STAGE_PAD * 2 - CORNER_RESERVE);
    if (!source || aw <= 0 || ah <= 0) return { w: 0, h: 0 };
    const k = Math.min(aw / source.w, ah / source.h);
    return { w: Math.round(source.w * k), h: Math.round(source.h * k) };
  }, [source, stage]);

  function onStageLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setStage({ w: width, h: height });
  }

  const loadPhoto = useCallback(async (p: { uri: string; base64: string; mime: string }, key?: string) => {
    if (!ACCEPTED_TYPES.includes(p.mime)) {
      Alert.alert('Cannot use this image', 'Use a PNG, JPEG, HEIC or WebP photo.');
      return;
    }
    if (Math.ceil((p.base64.length * 3) / 4) > MAX_BYTES) {
      Alert.alert('Cannot use this image', 'This image is too large (max 8 MB).');
      return;
    }
    try {
      const { w, h } = await sizeOf(p.uri);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSource({ ...p, w, h });
      setCutoutUri(null); setHistory([]); setHIndex(0); setStrokes([]); setRedo([]);
      setRefining(false); setSweepDone(false); setBackdrop('transparent'); setErrorMsg(null);
      setPhase('loaded');
      if (Platform.OS === 'web') {
        setRecent(prev => [{ key: key ?? `${Date.now()}`, uri: p.uri }, ...prev.filter(r => r.uri !== p.uri)].slice(0, 20));
      }
      // One screen, no extra tap: removal starts as soon as the photo is in.
      runRemovalRef.current?.({ ...p, w, h });
    } catch {
      Alert.alert('Cannot use this image', 'Could not read image data. Please try a different photo.');
    }
  }, []);

  // IMPORTANT (web): the picker must open synchronously inside the tap — no
  // `await` before pickImageOnWeb(), or the browser drops the user activation.
  const pickPhoto = useCallback(() => {
    if (Platform.OS === 'web') {
      pickImageOnWeb().then(async (file) => {
        if (!file) return;
        try { await loadPhoto(await fileToPickedImage(file)); }
        catch { Alert.alert('Cannot use this image', 'Could not read image data. Please try a different photo.'); }
      });
      return;
    }
    (async () => {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.92, base64: true, exif: false });
      if (res.canceled || !res.assets[0]) return;
      const a = res.assets[0];
      if (!a.base64) { Alert.alert('Cannot use this image', 'Could not read image data. Please try a different photo.'); return; }
      await loadPhoto({ uri: a.uri, base64: a.base64, mime: a.mimeType ?? 'image/jpeg' });
    })();
  }, [loadPhoto]);

  const pickRecent = useCallback(async (item: RecentPhoto) => {
    if (phase === 'processing' || refining) return;
    if (Platform.OS === 'web' || !item.assetId) {
      // Session photo on web: re-read the stored data URI.
      const base64 = item.uri.slice(item.uri.indexOf(',') + 1);
      const mime = item.uri.slice(5, item.uri.indexOf(';'));
      await loadPhoto({ uri: item.uri, base64, mime }, item.key);
      return;
    }
    try {
      const MediaLibrary = getMediaLibrary();
      if (!MediaLibrary) throw new Error('Photo library unavailable');
      const info = await MediaLibrary.getAssetInfoAsync(item.assetId);
      const { manipulateAsync, SaveFormat } = await import('expo-image-manipulator');
      const out = await manipulateAsync(info.localUri ?? item.uri, [{ resize: { width: 2048 } }], { compress: 0.92, format: SaveFormat.JPEG, base64: true });
      if (!out.base64) throw new Error('no data');
      await loadPhoto({ uri: out.uri, base64: out.base64, mime: 'image/jpeg' }, item.key);
    } catch {
      Alert.alert('Cannot use this image', 'Could not read image data. Please try a different photo.');
    }
  }, [loadPhoto, phase, refining]);

  const runRemoval = useCallback(async (src: SourcePhoto) => {
    abortRef.current?.abort(); // a newer photo replaces any removal still running
    setErrorMsg(null);

    const demo = isSellerDevPreview() && isPreviewDemoMode();
    // Signed-out preview must never reach the protected, metered API.
    if (isSellerDevPreview() && !demo) {
      setErrorMsg('Sign in to a seller account to remove backgrounds.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPhase('processing');
    setSweepDone(false);
    setCutoutUri(null);

    const controller = new AbortController();
    abortRef.current = controller;
    const fail = (msg: string) => {
      if (controller.signal.aborted) return;
      setPhase('loaded'); setErrorMsg(msg);
    };

    try {
      if (demo) {
        const [uri] = await Promise.all([makeDemoCutout(src.uri), new Promise(r => setTimeout(r, 1400))]);
        if (controller.signal.aborted) return;
        setCutoutUri(uri);
        return;
      }
      if (isSellerDevPreview()) {
        return fail('Background removal is unavailable in the signed-out seller preview.');
      }
      const token = await getToken();
      if (!token) return fail('Session expired. Please sign in again.');
      const resp = await fetch(`${BASE_URL}/api/bg-removal/remove`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ image: `data:${src.mime};base64,${src.base64}` }),
      });
      if (controller.signal.aborted) return;
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ error: 'Unknown error' }));
        const creditsKind = classifyAiCreditsError(resp.status, JSON.stringify(body ?? {}));
        if (creditsKind === 'insufficient_credits') {
          surfaceAiCreditsError('insufficient_credits');
          return fail('Not enough AI credits. Add credits to keep removing backgrounds.');
        }
        // Per-user daily cap (429 user_daily_cap) and global cap (503) get
        // the credit gate's own copy, not the generic rate-limit line.
        if (creditsKind) return fail(AI_CREDITS_ALERT_COPY[creditsKind].message);
        return fail(
          resp.status === 429 ? 'Too many requests. Please wait a minute and try again.'
          : resp.status >= 500 ? 'The service is temporarily unavailable. Please try again shortly.'
          : (typeof body?.error === 'string' ? body.error : 'Background removal failed. Please try again.'),
        );
      }
      const data: { b64_json: string; storageKey: string | null; size: number; createdAt: string; id: string } = await resp.json();
      if (!data.b64_json) return fail('The server returned an empty result. Please try again.');
      await saveResult({
        id: data.id, b64Json: data.b64_json, originalUri: src.uri, storageKey: data.storageKey,
        size: data.size, createdAt: data.createdAt, sourceScreen: 'design_studio',
      }).catch(() => {});
      setCutoutUri(`data:image/png;base64,${data.b64_json}`);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      fail(err?.message?.includes('fetch') || err?.message?.includes('network')
        ? 'Network error. Check your connection and try again.'
        : 'Something went wrong. Please try again.');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [getToken]);
  runRemovalRef.current = runRemoval;

  const handleRetry = useCallback(() => {
    if (source && phase === 'loaded') runRemoval(source);
  }, [source, phase, runRemoval]);

  const handleSettled = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSweepDone(true);
    setPhase('done');
  }, []);

  // The sweep reports done through state so `cutoutUri` seeds the history once.
  useEffect(() => {
    if (phase === 'done' && cutoutUri && history.length === 0) { setHistory([cutoutUri]); setHIndex(0); }
  }, [phase, cutoutUri, history.length]);

  /** The image as shown: the transparent cutout, or flattened onto the chosen backdrop. */
  async function finishedImage(): Promise<string | null> {
    if (!cutout) return null;
    if (backdrop === 'transparent' || !canvasRef.current) return cutout;
    // Loaded on demand: keeps view-shot (html2canvas on web) out of the startup bundle.
    const { captureRef } = await import('react-native-view-shot');
    const shot = await captureRef(canvasRef, { format: 'png', quality: 1, result: 'data-uri' });
    return shot.startsWith('data:') ? shot : `data:image/png;base64,${shot}`;
  }

  async function handleShare() {
    try {
      const uri = await finishedImage();
      if (uri) await shareImage(uri, 'cutout');
    } catch {
      Alert.alert('Share failed', 'Could not prepare this image. Please try again.');
    }
  }

  async function handleUse() {
    if (usingProduct) return;
    setUsingProduct(true);
    try {
      const uri = await finishedImage();
      if (!uri) return;
      const active = (await getProducts()).filter(p => p.status !== 'archived');
      if (active.length === 0) {
        Alert.alert('No products yet', 'Create a product first, then use this cutout as its photo.');
        return;
      }
      setProductPicker({ products: active, uri });
    } catch {
      Alert.alert("Couldn't load products", 'Please try again.');
    } finally {
      setUsingProduct(false);
    }
  }

  async function confirmUse(product: Product) {
    const uri = productPicker?.uri;
    setProductPicker(null);
    if (!uri) return;
    const existing = product.media ?? [];
    const updated = await updateProduct(product.id, {
      media: [...existing, { id: `cutout-${Date.now()}`, type: 'image', uri, altText: 'Product photo, background removed', isCover: true, sortOrder: existing.length, createdAt: new Date().toISOString() }],
    }).catch(() => null);
    if (updated) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Done', `"${product.name ?? 'Product'}" now uses this cutout as its cover photo.`);
    } else {
      Alert.alert("Couldn't update product", 'Please try again.');
    }
  }

  async function handleSave() {
    if (!cutout || saving) return;
    setSaving(true);
    try {
      const uri = (await finishedImage()) ?? cutout;
      const result = await saveImageToCameraRoll(uri, 'cutout');
      if (result.ok) {
        setSaved(true);
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaved(false), 1800);
      } else if (result.reason === 'permission') {
        Alert.alert('Permission required', 'Allow photo library access to save this image.');
      } else if (result.reason === 'unavailable') {
        Alert.alert('Unavailable', mediaLibraryUnavailableMessage());
      } else {
        Alert.alert('Save failed', 'Could not save to photo library. Please try again.');
      }
    } catch {
      Alert.alert('Save failed', 'Could not save to photo library. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleApplyRefine() {
    if (strokes.length === 0) { setRefining(false); return; }
    setApplying(true);
    try {
      const png = await refineRef.current!.exportPng();
      setHistory(h => [...h.slice(0, hIndex + 1), png]);
      setHIndex(i => i + 1);
      setStrokes([]); setRedo([]); setRefining(false);
    } catch {
      setErrorMsg('Could not apply your edits. Please try again.');
    } finally {
      setApplying(false);
    }
  }

  const canUndo = refining ? strokes.length > 0 : hIndex > 0;
  const canRedo = refining ? redo.length > 0 : hIndex < history.length - 1;
  function undo() {
    if (refining) {
      setStrokes(prev => { const last = prev[prev.length - 1]; if (last) setRedo(r => [...r, last]); return prev.slice(0, -1); });
    } else setHIndex(i => Math.max(0, i - 1));
  }
  function redoFn() {
    if (refining) {
      setRedo(prev => { const last = prev[prev.length - 1]; if (last) setStrokes(st => [...st, last]); return prev.slice(0, -1); });
    } else setHIndex(i => Math.min(history.length - 1, i + 1));
  }

  const bottomPad = insets.bottom + SP.md;
  const showStrip = true;
  const stripLocked = phase === 'processing' || refining;
  const editing = phase === 'done';

  // ── Stage content ──
  function renderBackdrop() {
    if (backdrop === 'transparent') return <Checkerboard />;
    if (backdrop === 'blur' && source) {
      return <Image source={{ uri: source.uri }} blurRadius={28} resizeMode="cover" style={s.blurBg} />;
    }
    return <View style={[StyleSheet.absoluteFill, { backgroundColor: SOLID[backdrop] ?? BG }]} />;
  }

  let stageBody: React.ReactNode = null;
  if (phase === 'empty') {
    stageBody = <DropZone onPress={pickPhoto} />;
  } else if (source && photoRect.w > 0) {
    const frame = { width: photoRect.w, height: photoRect.h };
    if (phase === 'loaded') {
      stageBody = (
        <View style={s.fillCenter} testID="bg-removal-stage">
          <Image source={{ uri: source.uri }} style={[frame, s.photoRound]} resizeMode="cover" />
        </View>
      );
    } else if (phase === 'processing' || (phase === 'done' && !sweepDone)) {
      stageBody = (
        <View style={[frame, s.photoRound, s.clip]}>
          <BgRemovalGlowSweep width={photoRect.w} height={photoRect.h} originalUri={source.uri} cutoutUri={cutoutUri} onSettled={handleSettled} />
        </View>
      );
    } else if (cutout) {
      stageBody = refining ? (
        <View style={[frame, s.photoRound, s.clip]}>
          {renderBackdrop()}
          <BgRefineCanvas
            ref={refineRef}
            originalUri={source.uri}
            cutoutUri={cutout}
            width={photoRect.w}
            height={photoRect.h}
            tool={tool}
            strokes={strokes}
            onCommitStroke={(st) => { setStrokes(p => [...p, st]); setRedo([]); }}
          />
          <AiGeneratedBadge />
        </View>
      ) : (
        <View style={s.fillCenter} testID="bg-removal-stage">
          <View ref={canvasRef} collapsable={false} style={[frame, s.photoRound, s.clip]}>
            {renderBackdrop()}
            <Image source={{ uri: cutout }} style={frame} resizeMode="cover" />
            <AiGeneratedBadge />
          </View>
        </View>
      );
    }
  }

  return (
    <View style={s.root}>
      <ScreenHeader title="Remove background" onBack={() => goBackOr(router)} divider={false} />

      {/* Radial vignette/spotlight atmosphere behind the stage — Dev's
          "make the layout look cooler" ask, kept subtle. */}
      <View style={s.vignetteWrap} pointerEvents="none">
        <LinearGradient
          colors={['rgba(255,255,255,0.06)', 'rgba(0,0,0,0)']}
          style={s.vignette}
          start={{ x: 0.5, y: 0.15 }}
          end={{ x: 0.5, y: 0.75 }}
        />
      </View>

      <View style={s.body}>
        <View style={s.frameOuter}>
          <LinearGradient
            colors={['rgba(255,255,255,0.6)', 'rgba(192,192,192,0.14)', 'rgba(255,255,255,0.4)']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={[s.frameInner, phase !== 'empty' && { paddingTop: CORNER_RESERVE }]} onLayout={onStageLayout}>
            {stageBody}
            {editing ? (
              <View style={s.corner}>
                <CornerBtn icon="corner-up-left" label="Undo" disabled={!canUndo} onPress={undo} />
                <CornerBtn icon="corner-up-right" label="Redo" disabled={!canRedo} onPress={redoFn} />
              </View>
            ) : null}
            {errorMsg ? (
              <View style={s.errorPill} pointerEvents="none"><Text style={s.errorText}>{errorMsg}</Text></View>
            ) : null}
          </View>
        </View>

        {showStrip ? (
          <FlatList
            horizontal
            data={recent}
            keyExtractor={(r) => r.key}
            showsHorizontalScrollIndicator={false}
            style={s.stripList}
            contentContainerStyle={s.strip}
            // One picker per phase: before a photo, the "Choose a photo"
            // button (the drop zone is its empty state); after, this + tile.
            // The stage itself isn't a hidden second "replace" target.
            ListHeaderComponent={phase === 'empty' ? null : (
              <PressableScale onPress={pickPhoto} style={[s.tile, s.tilePlus]} accessibilityRole="button" accessibilityLabel="Add photo" testID="bg-removal-add-photo" disabled={stripLocked}>
                <Icon name="plus" size={ICON.lg} color={FG} />
              </PressableScale>
            )}
            renderItem={({ item }) => (
              <PressableScale onPress={() => pickRecent(item)} style={[s.tile, source?.uri === item.uri && s.tileActive]} accessibilityRole="button" accessibilityLabel="Use this photo" disabled={stripLocked}>
                <Image source={{ uri: item.uri }} style={s.tileImg} resizeMode="cover" />
              </PressableScale>
            )}
          />
        ) : null}
      </View>

      <View style={[s.dock, { paddingBottom: bottomPad }]}>
        {phase === 'empty' && (
          <Pill label="Choose a photo" onPress={pickPhoto} testID="bg-removal-choose" />
        )}
        {(phase === 'processing' || (phase === 'done' && !sweepDone)) && (
          <View style={[s.pill, s.pillWorking]} accessibilityRole="progressbar" accessibilityLabel="Removing background" testID="bg-removal-working">
            <ActivityIndicator size="small" color={FG} />
            <Text style={[s.pillText, { color: FG }]}>Removing background…</Text>
          </View>
        )}
        {phase === 'loaded' && (
          <Pill
            label={errorMsg ? 'Try again' : 'Remove background'}
            onPress={handleRetry}
            testID="bg-removal-run"
          />
        )}
        {editing && !refining && (
          <View style={s.group}>
            <View style={s.swatches}>
              {BACKDROPS.map(b => (
                <Swatch key={b.key} kind={b.key} label={b.label} active={backdrop === b.key} onPress={() => { Haptics.selectionAsync().catch(() => {}); setBackdrop(b.key); }} />
              ))}
            </View>
            <View style={s.grid}>
              <ActionCell icon="edit-3" label="Refine" onPress={() => setRefining(true)} testID="bg-removal-refine" />
              <ActionCell icon="share" label="Share" onPress={handleShare} testID="bg-removal-share" />
              <ActionCell icon="package" label="Use" onPress={handleUse} busy={usingProduct} testID="bg-removal-use" accessibilityLabel="Use as product photo" />
            </View>
            <Pressable onPress={handleSave} style={({ pressed }) => [s.cell, s.cellSolid, s.saveRow, saving && s.dim, pressed && s.pressed]} accessibilityRole="button" accessibilityLabel="Save" testID="bg-removal-save">
              <Icon name={saved ? 'check' : 'download'} size={ICON.sm} color={BG} />
              <Text style={[s.cellText, { color: BG }]}>{saved ? 'Saved' : 'Save'}</Text>
            </Pressable>
          </View>
        )}
        {editing && refining && (
          <View style={s.group}>
            <View style={s.grid}>
              <ToolBtn icon="minus-circle" label="Erase" active={tool === 'erase'} onPress={() => setTool('erase')} />
              <ToolBtn icon="plus-circle" label="Restore" active={tool === 'restore'} onPress={() => setTool('restore')} />
            </View>
            <PressableScale onPress={handleApplyRefine} disabled={applying} style={[s.pill, applying && s.dim]} accessibilityRole="button" accessibilityLabel="Done" testID="bg-removal-refine-done">
              <Text style={s.pillText}>Done</Text>
            </PressableScale>
          </View>
        )}
      </View>

      <Modal
        visible={!!productPicker}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setProductPicker(null)}
      >
        <SafeAreaProvider style={s.pickerRoot}>
          <ScreenHeader title="Use as product photo" variant="modal" onBack={() => setProductPicker(null)} />
          <Text style={s.pickerSub}>The cutout becomes the product's cover photo.</Text>
          <FlatList
            data={productPicker?.products ?? []}
            keyExtractor={p => p.id}
            contentContainerStyle={{ padding: SP.md }}
            renderItem={({ item }) => (
              <TouchableOpacity style={s.productRow} onPress={() => confirmUse(item)} activeOpacity={0.82} accessibilityRole="button" accessibilityLabel={`Use for ${item.name}`}>
                {item.media?.[0]?.uri ? (
                  <Image source={{ uri: item.media[0].uri }} style={s.productThumb} resizeMode="cover" />
                ) : (
                  <View style={[s.productThumb, s.productThumbEmpty]}><Icon name="package" size={ICON.md} color={SUBTLE} /></View>
                )}
                <Text style={s.productName} numberOfLines={1}>{item.name || 'Untitled product'}</Text>
                <Icon name="chevron-right" size={ICON.xs} color={MUTED} />
              </TouchableOpacity>
            )}
          />
        </SafeAreaProvider>
      </Modal>
    </View>
  );
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function ActionCell({ icon, label, onPress, busy, testID, accessibilityLabel }: {
  icon: IconName; label: string; onPress: () => void; busy?: boolean; testID?: string; accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [s.cell, s.cellOutline, s.cellCompact, busy && s.dim, pressed && s.pressed]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ busy: !!busy }}
      testID={testID}
    >
      {busy ? <ActivityIndicator size="small" color={FG} /> : <Icon name={icon} size={ICON.sm} color={FG} />}
      <Text style={s.cellText} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function Pill({ label, onPress, disabled, testID }: { label: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  return (
    <PressableScale
      onPress={() => { if (!disabled) onPress(); }}
      style={[s.pill, disabled && s.pillDisabled]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
    >
      <Text style={s.pillText}>{label}</Text>
    </PressableScale>
  );
}

function CornerBtn({ icon, label, disabled, onPress }: { icon: IconName; label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <PressableScale onPress={() => { if (!disabled) onPress(); }} style={[s.cornerBtn, disabled && s.cornerDisabled]} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} testID={`bg-removal-${label.toLowerCase()}`}>
      <Icon name={icon} size={ICON.sm} color={FG} />
    </PressableScale>
  );
}

function ToolBtn({ icon, label, active, onPress }: { icon: IconName; label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.cell, active ? s.cellSolid : s.cellOutline, pressed && s.pressed]} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }}>
      <Icon name={icon} size={ICON.sm} color={active ? BG : FG} />
      <Text style={[s.cellText, active && { color: BG }]}>{label}</Text>
    </Pressable>
  );
}

function Swatch({ kind, label, active, onPress }: { kind: Backdrop; label: string; active: boolean; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} style={[s.swatchRing, active && s.swatchRingActive]} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }} hitSlop={6} noMinHeight>
      <View style={s.swatch}>
        {kind === 'transparent' && (
          <>
            <Checkerboard tile={5} />
          </>
        )}
        {kind === 'white' && <View style={[StyleSheet.absoluteFill, { backgroundColor: '#FFFFFF' }]} />}
        {kind === 'black' && <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000000' }]} />}
        {kind === 'silver' && <LinearGradient colors={['#E6E6E6', '#9A9A9A']} style={StyleSheet.absoluteFill} />}
        {kind === 'blur' && (
          <>
            <LinearGradient colors={['#6E6E6E', '#D8D8D8', '#4A4A4A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <View style={s.swatchIcon}><Icon name="droplet" size={12} color={FG} /></View>
          </>
        )}
      </View>
    </PressableScale>
  );
}

const PHOTO_R = RADIUS.lg;
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  vignetteWrap: { position: 'absolute', top: 0, left: 0, right: 0, height: 420 },
  vignette: { flex: 1 },
  body: { flex: 1, paddingHorizontal: SP.md, paddingTop: SP.xs },
  frameOuter: { flex: 1, borderRadius: RADIUS.xl, padding: 1, overflow: 'hidden' },
  frameInner: { flex: 1, borderRadius: RADIUS.xl - 1, backgroundColor: '#050506', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  fill: { ...StyleSheet.absoluteFill },
  fillCenter: { alignItems: 'center', justifyContent: 'center' },
  clip: { overflow: 'hidden' },
  photoRound: { borderRadius: PHOTO_R, overflow: 'hidden' },
  blurBg: { position: 'absolute', left: -20, top: -20, right: -20, bottom: -20 },

  dropInner: { flex: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  sheen: { position: 'absolute', top: -120, bottom: -120, width: 120 },
  twinkle: { position: 'absolute' },
  dropCenter: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center' },
  dropCaption: { marginTop: SP.sm, fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED, textAlign: 'center' },
  dropRing: { position: 'absolute', width: 84, height: 84, borderRadius: 42, borderWidth: 1, borderColor: SILVER },
  dropIcon: {
    width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#0B0B0C', borderWidth: 1, borderColor: 'rgba(255,255,255,0.55)',
  },

  corner: { position: 'absolute', top: SP.sm, right: SP.sm, flexDirection: 'row', gap: SP.xs },
  cornerBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: BG, borderWidth: 1, borderColor: BORDER },
  cornerDisabled: { opacity: 0.4 },
  errorPill: {
    position: 'absolute', left: SP.md, right: SP.md, bottom: SP.md, alignItems: 'center',
    backgroundColor: BG, borderRadius: RADIUS.md, borderWidth: 1, borderColor: RED, paddingVertical: SP.sm, paddingHorizontal: SP.md,
  },
  errorText: { fontFamily: FONT.medium, fontSize: FS.sm, color: RED, textAlign: 'center', lineHeight: 19 },

  stripList: { flexGrow: 0, marginTop: SP.sm },
  strip: { gap: SP.sm, paddingVertical: 2 },
  tile: { width: 60, height: 60, borderRadius: RADIUS.md, overflow: 'hidden', borderWidth: 1, borderColor: BORDER, backgroundColor: '#0B0B0C' },
  tilePlus: { alignItems: 'center', justifyContent: 'center' },
  tileActive: { borderColor: FG, borderWidth: 2 },
  tileImg: { width: '100%', height: '100%' },

  dock: { paddingHorizontal: SP.md, paddingTop: SP.md },
  group: { gap: SP.sm },
  grid: { flexDirection: 'row', gap: SP.sm },
  cell: { flex: 1, height: COMP.buttonH, borderRadius: ControlRadius.md, paddingHorizontal: SP.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm },
  cellOutline: { borderWidth: 1, borderColor: BORDER, backgroundColor: BG },
  cellSolid: { backgroundColor: FG, borderWidth: 1, borderColor: FG },
  cellText: { fontFamily: FONT.semibold, fontSize: FS.md, color: FG },
  pill: { height: COMP.buttonH, borderRadius: ControlRadius.md, backgroundColor: FG, alignItems: 'center', justifyContent: 'center' },
  pillDisabled: { opacity: 0.4 },
  pillWorking: { flexDirection: 'row', gap: SP.sm, backgroundColor: BG, borderWidth: 1, borderColor: BORDER },
  cellCompact: { paddingHorizontal: SP.sm, gap: SP.xs },
  saveRow: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },
  pickerRoot: { flex: 1, backgroundColor: BG },
  pickerSub: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, padding: SP.md, paddingTop: SP.sm, paddingBottom: 0 },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER },
  productThumb: { width: 44, height: 44, borderRadius: RADIUS.sm },
  productThumbEmpty: { backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' },
  productName: { flex: 1, fontFamily: FONT.medium, fontSize: FS.sm, color: FG },
  pillText: { fontFamily: FONT.semibold, fontSize: FS.md, color: BG },
  swatches: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.xs, height: 44 },
  swatchRing: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  swatchRingActive: { borderColor: FG },
  swatch: { width: 30, height: 30, borderRadius: 15, overflow: 'hidden', borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  swatchIcon: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.6 },
  pressed: { opacity: 0.85 },
});
