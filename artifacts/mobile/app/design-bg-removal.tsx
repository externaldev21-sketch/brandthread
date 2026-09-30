/**
 * Brandthread Design Studio — Remove Background
 * Route: /design-bg-removal
 *
 * Deliberately minimal, per Dev's explicit spec (this replaced an earlier,
 * much larger Photoroom-style editor plan — see the PR body): one upload
 * box → tap "Remove background" → a glowing edge-sweep while the real API
 * call runs → the cutout reveals on a dark stage → Save to camera roll.
 * No Remove/Replace mode toggle, no camera capture, no backgrounds sheet,
 * no manual refine brush — all cut per Dev's own words.
 *
 * Real backend: POST /api/bg-removal/remove (server-side OpenAI call with
 * a visual-QA pass — see PR body for the provider research). Every result
 * is still persisted server-side (GCS) via services/bgRemovalService.ts's
 * saveResult(), even though this simpler flow no longer shows a "recent
 * cutouts" list on screen — see the PR body's "Needs backend" / scope note
 * on why the data isn't thrown away even though the UI doesn't surface it.
 */
import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, Image, LayoutChangeEvent,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { isSellerDevPreview } from '@/lib/devPreview';
import { saveImageToCameraRoll } from '@/lib/aiToolMedia';
import { AiPrimaryButton, AiButtonDock } from '@/components/ai-tools/AiToolButtons';
import { CenteredToast } from '@/components/social/CenteredToast';
import Checkerboard from '@/components/design/Checkerboard';
import BgRemovalGlowSweep from '@/components/ai-tools/BgRemovalGlowSweep';
import { saveResult } from '@/services/bgRemovalService';
import { BG, CARD, BORDER, FG, MUTED, SUBTLE, RED, RED_DIM, FONT, FS, SP, RADIUS, ICON, COMP } from '@/lib/theme';

const BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/heic', 'image/heif', 'image/webp'];

type Phase = 'empty' | 'loaded' | 'processing' | 'done' | 'error';

interface SourcePhoto { uri: string; base64: string; mime: string; fileSize: number }

export default function DesignBgRemovalScreen() {
  const router = useRouter();
  const { getToken } = useAuth();
  const insets = useSafeAreaInsets();

  const [phase, setPhase] = useState<Phase>('empty');
  const [source, setSource] = useState<SourcePhoto | null>(null);
  const [resultB64, setResultB64] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function showToast(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  }

  function onStageLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setStageSize({ width, height });
  }

  async function pickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permission required', 'Please allow photo library access in your device settings.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.92,
      base64: true,
      exif: false,
    });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    const mime = asset.mimeType ?? 'image/jpeg';
    if (!ACCEPTED_TYPES.includes(mime)) {
      Alert.alert('Cannot use this image', `Unsupported format (${mime}). Please use PNG, JPG, JPEG, or HEIC.`);
      return;
    }
    if (!asset.base64) {
      Alert.alert('Cannot use this image', 'Could not read image data. Please try a different photo.');
      return;
    }
    const approxBytes = Math.ceil((asset.base64.length * 3) / 4);
    if (approxBytes > MAX_BYTES) {
      Alert.alert('Cannot use this image', 'This image is too large (max 8 MB). Please choose a smaller photo.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSource({ uri: asset.uri, base64: asset.base64, mime, fileSize: approxBytes });
    setResultB64(null);
    setErrorMsg(null);
    setPhase('loaded');
  }

  const handleRemove = useCallback(async () => {
    if (!source) return;

    // Dev seller preview: real, metered AI call — never let a signed-out
    // preview session trigger it. Same pattern as every other tool in this
    // family (see design-mockup-to-model.tsx's handleCreate()).
    if (isSellerDevPreview()) {
      Alert.alert(
        'Sign in required',
        'Removing backgrounds requires a real seller account.\n\nSign in to a Brandthread seller account to continue.',
        [{ text: 'OK' }],
      );
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPhase('processing');
    setErrorMsg(null);
    setResultB64(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const token = await getToken();
      if (!token) {
        setPhase('error');
        setErrorMsg('Session expired. Please sign in again.');
        return;
      }
      const dataUrl = `data:${source.mime};base64,${source.base64}`;
      const resp = await fetch(`${BASE_URL}/api/bg-removal/remove`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ image: dataUrl }),
      });
      if (controller.signal.aborted) return;

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ error: 'Unknown error' }));
        setPhase('error');
        setErrorMsg(
          resp.status === 429 ? 'Too many requests. Please wait a minute and try again.'
          : resp.status >= 500 ? 'The service is temporarily unavailable. Please try again shortly.'
          : (body?.error ?? 'Background removal failed.'),
        );
        return;
      }

      const data: { b64_json: string; storageKey: string | null; size: number; mime: string; createdAt: string; id: string } = await resp.json();
      if (!data.b64_json) {
        setPhase('error');
        setErrorMsg('The server returned an empty result. Please try again.');
        return;
      }

      // Real, server-persisted save (GCS-backed) even though this simpler
      // flow doesn't surface a "recent cutouts" list on screen anymore —
      // see file header note.
      await saveResult({
        id: data.id,
        b64Json: data.b64_json,
        originalUri: source.uri,
        storageKey: data.storageKey,
        size: data.size,
        createdAt: data.createdAt,
        sourceScreen: 'design_studio',
      }).catch(() => {});

      setResultB64(data.b64_json);
      // Phase flips to 'done' once the glow-sweep's settle animation
      // finishes (see onSettled below) — never before the real result is
      // actually in hand.
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setPhase('error');
      setErrorMsg(err?.message?.includes('fetch') || err?.message?.includes('network')
        ? 'Network error. Check your connection and try again.'
        : 'Something went wrong. Please try again.');
    } finally {
      abortRef.current = null;
    }
  }, [source, getToken]);

  function handleGlowSettled() {
    if (resultB64) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPhase('done');
    }
  }

  async function handleSave() {
    if (!resultB64) return;
    setSaving(true);
    const result = await saveImageToCameraRoll(`data:image/png;base64,${resultB64}`, 'cutout');
    setSaving(false);
    if (result.ok) {
      showToast('Saved to Photos');
    } else if (result.reason === 'permission') {
      Alert.alert('Permission required', 'Allow photo library access to save this image.');
    } else {
      Alert.alert('Save failed', 'Could not save to photo library. Please try again.');
    }
  }

  function handleRemoveAnother() {
    setSource(null);
    setResultB64(null);
    setErrorMsg(null);
    setPhase('empty');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function handleChangePhoto() {
    pickPhoto();
  }

  function handleRetry() {
    setPhase('loaded');
    setErrorMsg(null);
  }

  const resultUri = resultB64 ? `data:image/png;base64,${resultB64}` : null;
  const showResult = phase === 'done' && !!resultUri;

  return (
    <View style={s.root}>
      {/* No ScreenHeader here — it draws an unconditional divider line
          directly under the title, which is exactly the "jammed-divider"
          problem Dev flagged. Minimal bespoke header instead: back arrow +
          title only, no subtitle, no border. */}
      <View style={[s.header, { paddingTop: insets.top + SP.sm }]}>
        <TouchableOpacity
          onPress={() => goBackOr(router)}
          style={s.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Remove Background</Text>
        <View style={{ width: ICON.md }} />
      </View>

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
        {phase === 'empty' && (
          <TouchableOpacity style={s.uploadBox} onPress={pickPhoto} accessibilityRole="button" accessibilityLabel="Upload from library">
            <View style={s.uploadIconCircle}>
              <Feather name="upload" size={ICON.lg} color={FG} />
            </View>
            <Text style={s.uploadTitle}>Upload from library</Text>
            <Text style={s.uploadSub}>PNG, JPG, JPEG, HEIC · Max 8 MB</Text>
          </TouchableOpacity>
        )}

        {source && phase !== 'empty' && (
          <View style={s.stageBox} onLayout={onStageLayout}>
            <Checkerboard light="#141416" dark="#0A0A0B" />
            <Image
              source={{ uri: showResult ? resultUri! : source.uri }}
              style={s.stageImage}
              resizeMode="contain"
            />
            {phase === 'processing' && stageSize.width > 0 && (
              <BgRemovalGlowSweep
                width={stageSize.width}
                height={stageSize.height}
                active={phase === 'processing'}
                resolved={!!resultB64}
                onSettled={handleGlowSettled}
              />
            )}
            {phase === 'loaded' && (
              <TouchableOpacity style={s.changePhotoBtn} onPress={handleChangePhoto} accessibilityLabel="Change photo" accessibilityRole="button">
                <Feather name="refresh-cw" size={13} color="#fff" />
                <Text style={s.changePhotoText}>Change photo</Text>
              </TouchableOpacity>
            )}
            {phase === 'error' && (
              <View style={s.errorOverlay}>
                <Feather name="alert-circle" size={28} color={RED} />
                <Text style={s.errorOverlayText}>{errorMsg}</Text>
              </View>
            )}
          </View>
        )}
      </View>

      {/* This screen keeps the floating seller tab bar visible (not a
          full-screen takeover, and not deny-listed in app/_layout.tsx's
          SELLER_TAB_BAR_FULL_SCREEN_SEGMENTS), so the button dock sits
          ABOVE the tab bar's own footprint (COMP.tabBarH) — otherwise the
          Save/Remove-background button renders underneath the tab bar and
          is literally untappable, the same class of bug fixed for the AI
          chat screens in a previous PR (#433/#435). */}
      <AiButtonDock bottomInset={COMP.tabBarH + insets.bottom}>
        {phase === 'loaded' && (
          <AiPrimaryButton label="Remove background" icon="scissors" onPress={handleRemove} accessibilityLabel="Remove background" />
        )}
        {phase === 'processing' && (
          <AiPrimaryButton label="Removing background…" onPress={() => {}} disabled loading accessibilityLabel="Removing background" />
        )}
        {phase === 'done' && (
          <AiPrimaryButton label="Save" icon="download" onPress={handleSave} loading={saving} accessibilityLabel="Save to Photos" />
        )}
        {phase === 'error' && (
          <AiPrimaryButton label="Try again" icon="refresh-cw" onPress={handleRetry} accessibilityLabel="Try again" />
        )}
        {phase === 'done' && (
          <TouchableOpacity style={s.removeAnotherRow} onPress={handleRemoveAnother} accessibilityLabel="Remove another photo" accessibilityRole="button">
            <Feather name="plus" size={13} color={MUTED} />
            <Text style={s.removeAnotherText}>Remove another</Text>
          </TouchableOpacity>
        )}
      </AiButtonDock>

      <CenteredToast message={toast} />

      {!BASE_URL && (
        <View style={s.devBanner} pointerEvents="none">
          <Text style={s.devBannerText}>[DEV] EXPO_PUBLIC_API_BASE_URL is not set — API calls will fail.</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, paddingBottom: SP.md,
  },
  backBtn: { width: ICON.md, alignItems: 'flex-start', justifyContent: 'center' },
  headerTitle: { fontFamily: FONT.bold, fontSize: FS.xl, color: FG, letterSpacing: -0.3 },
  vignetteWrap: { position: 'absolute', top: 0, left: 0, right: 0, height: 420 },
  vignette: { flex: 1 },
  body: { flex: 1, paddingHorizontal: SP.lg, alignItems: 'center', justifyContent: 'center' },
  uploadBox: {
    width: '100%', aspectRatio: 1, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: BORDER,
    backgroundColor: CARD, alignItems: 'center', justifyContent: 'center', gap: SP.sm,
  },
  uploadIconCircle: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: BG, borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  uploadTitle: { fontFamily: FONT.semibold, fontSize: FS.md, color: FG },
  uploadSub: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED },
  stageBox: {
    width: '100%', aspectRatio: 1, borderRadius: RADIUS.xl, overflow: 'hidden', position: 'relative',
    borderWidth: 1, borderColor: BORDER,
  },
  stageImage: { width: '100%', height: '100%' },
  changePhotoBtn: {
    position: 'absolute', bottom: SP.sm, right: SP.sm, flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: RADIUS.pill, paddingHorizontal: SP.sm, paddingVertical: 6,
  },
  changePhotoText: { fontFamily: FONT.medium, fontSize: FS.xs, color: '#fff' },
  errorOverlay: {
    ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: SP.sm,
    backgroundColor: RED_DIM, padding: SP.lg,
  },
  errorOverlayText: { fontFamily: FONT.regular, fontSize: FS.sm, color: RED, textAlign: 'center', lineHeight: 19 },
  removeAnotherRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: SP.sm },
  removeAnotherText: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED },
  devBanner: { position: 'absolute', top: 60, left: SP.md, right: SP.md, backgroundColor: RED_DIM, borderRadius: RADIUS.sm, padding: SP.sm },
  devBannerText: { fontFamily: FONT.regular, fontSize: FS.xs, color: RED },
});
