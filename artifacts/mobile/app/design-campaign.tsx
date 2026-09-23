/**
 * Brandthread Create Ad — 5-step flow
 * Route: /design-campaign
 *
 * Step 1 — Media:          one video OR 1–5 ordered photos (never mixed)
 * Step 2 — Description:    headline + description fields only
 * Step 3 — Call to action: multiple-choice CTA chips; product selection lives here
 * Step 4 — Output format:  descriptive format cards with accurate aspect-ratio silhouettes; no output count
 * Step 5 — Budget & duration: slider-only budget + duration, live estimated reach, "Create ad · $X"
 *
 * Payment flow (same pattern as sample-detail.tsx):
 *   1. User taps "Create ad · $X" → POST /pay → get checkout URL
 *   2. Open Stripe Checkout in WebBrowser.openAuthSessionAsync
 *   3. Browser returns to brandthread://design-campaign/?id=&paymentReturn=1
 *   4. POST /pay/verify → server checks payment_status=paid → activates idempotently
 *   5. Show success only after verified campaign.status === 'active'
 *   6. Cancel/failed → retry without activation
 *
 * Reach estimate formula (shared with server):
 *   low  = floor(budgetCents/100 * 35)
 *   high = floor(budgetCents/100 * 65)
 * Labeled "estimate" — never reported as delivered impressions.
 */
import React, {
  useState, useCallback, useRef, useEffect, useMemo,
} from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, LayoutChangeEvent, PanResponder,
  Platform, TextInput,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';

import {
  BG, SURFACE, CARD, CARD_ELEVATED,
  BORDER, BORDER_ACTIVE, BORDER_SUBTLE,
  FG, MUTED, SUBTLE,
  PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  SUCCESS, SUCCESS_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM,
  FONT, FS, SP, RADIUS, ICON, SHADOW_SM,
} from '@/lib/theme';
import { useApi } from '@/hooks/useApi';
import {
  estimateReach,
  BUDGET_STEPS,
  BUDGET_MIN_CENTS,
  BUDGET_MAX_CENTS,
  DURATION_MIN_DAYS,
  DURATION_MAX_DAYS,
  MAX_PHOTOS,
  CTA_OPTIONS,
  AD_FORMAT_OPTIONS,
  validateMediaStage,
  validateDescriptionStage,
  validateCtaStage,
  validateFormatStage,
  validateBudgetStage,
  buildAdCampaignReturnUrl,
  validateImageFile,
  validateVideoFile,
} from '@/services/adCampaignService';
import type {
  AdCampaign,
  AdCtaKind,
  AdFormatKind,
  AdMediaKind,
} from '@/lib/api';
import { isSellerDevPreview } from '@/lib/devPreview';

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 5;
const STEP_LABELS: readonly string[] = ['Media', 'Description', 'Call to action', 'Output format', 'Budget & duration'];

/** Return URL for Stripe Checkout redirect — matches server allowlist. */
function makeReturnUrl(campaignId: string): string {
  return buildAdCampaignReturnUrl(campaignId);
}

// ─── Slider ───────────────────────────────────────────────────────────────────

function SnapSlider({
  value, min, max, step = 1, steps, onChange, accessibilityLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  steps?: readonly number[];
  onChange: (v: number) => void;
  accessibilityLabel: string;
}) {
  const widthRef = useRef(1);

  const snapValue = useCallback((raw: number): number => {
    if (steps) {
      let best = steps[0];
      let bestDist = Math.abs(raw - best);
      for (const s of steps) {
        const d = Math.abs(raw - s);
        if (d < bestDist) { best = s; bestDist = d; }
      }
      return best;
    }
    const clamped = Math.max(min, Math.min(max, raw));
    return Math.round((clamped - min) / step) * step + min;
  }, [min, max, step, steps]);

  const fractionFromValue = useCallback((v: number): number => {
    if (steps) {
      const idx = steps.indexOf(v as any);
      const safeIdx = idx === -1 ? 0 : idx;
      return safeIdx / (steps.length - 1);
    }
    return (v - min) / (max - min);
  }, [min, max, steps]);

  const indexFromX = useCallback((x: number): number => {
    if (!steps) return -1;
    const fraction = Math.max(0, Math.min(1, x / widthRef.current));
    return Math.min(steps.length - 1, Math.round(fraction * (steps.length - 1)));
  }, [steps]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder:  () => true,
    onPanResponderGrant:          () => { Haptics.selectionAsync(); },
    onPanResponderMove:           (_e, g) => {
      if (steps) {
        const currentIdx = steps.indexOf(value as any);
        const startX = currentIdx === -1
          ? widthRef.current / 2
          : (currentIdx / (steps.length - 1)) * widthRef.current;
        onChange(steps[indexFromX(startX + g.dx)]);
      } else {
        onChange(snapValue(value + (g.dx / widthRef.current) * (max - min)));
      }
    },
  }), [steps, value, max, min, snapValue, indexFromX, onChange]);

  const fraction = fractionFromValue(value);

  return (
    <View
      style={ss.sliderTouch}
      onLayout={(e: LayoutChangeEvent) => { widthRef.current = Math.max(1, e.nativeEvent.layout.width); }}
      onTouchEnd={(e) => {
        if (steps) {
          onChange(steps[indexFromX(e.nativeEvent.locationX)]);
        } else {
          onChange(snapValue(min + (e.nativeEvent.locationX / widthRef.current) * (max - min)));
        }
        Haptics.selectionAsync();
      }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (steps) {
          const idx = steps.indexOf(value as any);
          const safeI = idx === -1 ? 0 : idx;
          if (e.nativeEvent.actionName === 'increment') onChange(steps[Math.min(steps.length - 1, safeI + 1)]);
          else onChange(steps[Math.max(0, safeI - 1)]);
        } else {
          onChange(snapValue(value + (e.nativeEvent.actionName === 'increment' ? step : -step)));
        }
      }}
      {...panResponder.panHandlers}
    >
      <View style={ss.sliderTrack}>
        <View style={[ss.sliderFill, { width: `${fraction * 100}%` as any }]} />
      </View>
      <View style={[ss.sliderThumb, { left: `${fraction * 100}%` as any }]} />
    </View>
  );
}

const ss = StyleSheet.create({
  sliderTouch: { height: 44, justifyContent: 'center', position: 'relative' },
  sliderTrack: { height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.10)', overflow: 'hidden' },
  sliderFill:  { height: 5, borderRadius: 3, backgroundColor: PURPLE_LIGHT },
  sliderThumb: {
    position: 'absolute', top: 10, width: 24, height: 24, borderRadius: 12,
    marginLeft: -12, backgroundColor: '#fff',
    borderWidth: 3, borderColor: PURPLE_LIGHT,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
});

// ─── Step progress indicator ──────────────────────────────────────────────────

function StepDots({ total, current }: { total: number; current: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, justifyContent: 'center', marginBottom: SP.sm }}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={{
          width: i === current ? 18 : 5,
          height: 5, borderRadius: 3,
          backgroundColor: i < current ? PURPLE_LIGHT : i === current ? PURPLE_LIGHT : 'rgba(255,255,255,0.15)',
        }} />
      ))}
    </View>
  );
}

// ─── Aspect-ratio silhouette ─────────────────────────────────────────────────

function AspectSilhouette({ ratioW, ratioH, active }: { ratioW: number; ratioH: number; active: boolean }) {
  const maxW = 52;
  const maxH = 72;
  let w = maxW;
  let h = (ratioH / ratioW) * w;
  if (h > maxH) { h = maxH; w = (ratioW / ratioH) * h; }
  return (
    <View style={{
      width: w, height: h, borderRadius: 4,
      backgroundColor: active ? PURPLE_DIM : 'rgba(255,255,255,0.06)',
      borderWidth: 1.5,
      borderColor: active ? PURPLE_LIGHT : 'rgba(255,255,255,0.12)',
      alignItems: 'center', justifyContent: 'center',
    }}>
      {active && <Feather name="check" size={11} color={PURPLE_LIGHT} />}
    </View>
  );
}

// ─── Media thumbnail ─────────────────────────────────────────────────────────

function MediaThumb({
  uri, mimeType, onRemove, onMoveLeft, onMoveRight, canMoveLeft, canMoveRight, index,
}: {
  uri: string; mimeType: string; onRemove: () => void;
  onMoveLeft: () => void; onMoveRight: () => void;
  canMoveLeft: boolean; canMoveRight: boolean; index: number;
}) {
  const isVideo = mimeType.startsWith('video/');
  return (
    <View style={mt.wrap} testID={`media-thumb-${index}`}>
      <Image source={{ uri }} style={mt.img} contentFit="cover" />
      {isVideo && (
        <View style={mt.videoBadge}><Feather name="play" size={10} color="#fff" /></View>
      )}
      <TouchableOpacity style={mt.removeBtn} onPress={onRemove} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID={`media-remove-${index}`}>
        <Feather name="x" size={12} color="#fff" />
      </TouchableOpacity>
      <View style={mt.reorderRow}>
        <TouchableOpacity style={[mt.reorderBtn, !canMoveLeft && { opacity: 0.3 }]} onPress={onMoveLeft} disabled={!canMoveLeft}>
          <Feather name="chevron-left" size={11} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={[mt.reorderBtn, !canMoveRight && { opacity: 0.3 }]} onPress={onMoveRight} disabled={!canMoveRight}>
          <Feather name="chevron-right" size={11} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const mt = StyleSheet.create({
  wrap:       { width: 88, height: 88, borderRadius: RADIUS.sm, overflow: 'hidden', backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, position: 'relative' },
  img:        { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  videoBadge: { position: 'absolute', top: 4, left: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, paddingHorizontal: 5, paddingVertical: 2, flexDirection: 'row', alignItems: 'center', gap: 2 },
  removeBtn:  { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  reorderRow: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 4, paddingVertical: 2 },
  reorderBtn: { padding: 2 },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function CreateAdScreen() {
  const router    = useRouter();
  const params    = useLocalSearchParams<{ id?: string; paymentReturn?: string }>();
  const insets    = useSafeAreaInsets();
  const api       = useApi();

  const topPad    = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 0) + 90;

  // ── Campaign state ────────────────────────────────────────────────────────
  const [campaign,  setCampaign]  = useState<AdCampaign | null>(null);
  const [step,      setStep]      = useState(0);   // 0–4 for 5 steps
  const [loading,   setLoading]   = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  // Step 1 — Media
  const [localPaths, setLocalPaths] = useState<string[]>([]);
  const [localMimes, setLocalMimes] = useState<string[]>([]);
  const [localUris,  setLocalUris]  = useState<string[]>([]);
  const [mediaKind,  setMediaKind]  = useState<AdMediaKind>('photos');

  // Step 2 — Description
  const [headline,    setHeadline]    = useState('');
  const [description, setDescription] = useState('');

  // Step 3 — CTA
  const [ctaKind,   setCtaKind]   = useState<AdCtaKind | null>(null);
  const [ctaDestId, setCtaDestId] = useState<string | null>(null);

  // Step 4 — Formats
  const [formats, setFormats] = useState<AdFormatKind[]>([]);

  // Step 5 — Budget & duration
  const [budgetCents,  setBudgetCents]  = useState(2500);
  const [durationDays, setDurationDays] = useState(7);

  // Payment state
  const [paying,    setPaying]    = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [succeeded, setSucceeded] = useState(false);

  // Products (loaded when entering step 3 — CTA)
  const [products,        setProducts]        = useState<Array<{ id: string; name: string }>>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  // Prevent double-handling the paymentReturn redirect param
  const paymentReturnConsumed = useRef(false);

  const reach = useMemo(() => estimateReach(budgetCents), [budgetCents]);

  // Detect preview once at mount (stable across the component lifetime)
  const inSellerPreview = isSellerDevPreview();

  // ── Create draft on mount ─────────────────────────────────────────────────
  useEffect(() => {
    if (params.paymentReturn === '1' && params.id) return;

    // Dev seller preview: initialize a local draft without touching the server.
    // POST /ad-campaigns returns 401 in dev web preview (no token).
    if (inSellerPreview) {
      setCampaign({ id: 'preview-draft', status: 'draft' } as AdCampaign);
      return;
    }

    (async () => {
      setLoading(true);
      try {
        const res = await api.adCampaigns.create();
        setCampaign(res.campaign);
      } catch (e: any) {
        const status = e?.status ?? e?.response?.status;
        const is401  = status === 401 || String(e?.message ?? '').includes('401');
        setInitError(
          is401
            ? 'Your session has expired. Please sign in again to create an ad campaign.'
            : 'Could not start a new campaign. Please try again.',
        );
      } finally {
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Handle Checkout redirect return ──────────────────────────────────────
  useEffect(() => {
    if (params.paymentReturn !== '1' || !params.id || paymentReturnConsumed.current) return;
    paymentReturnConsumed.current = true;
    router.setParams({ paymentReturn: undefined } as never);
    void verifyPayment(params.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.paymentReturn, params.id]);

  // ── Load products when entering step 3 (CTA) ────────────────────────────
  useEffect(() => {
    if (step !== 2 || products.length > 0) return;
    setLoadingProducts(true);
    api.products.list()
      .then((rows: unknown) => setProducts((rows as any[]).map((p: any) => ({ id: p.id, name: p.name }))))
      .catch(() => {})
      .finally(() => setLoadingProducts(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ── Verify payment (called after browser redirect) ────────────────────────
  const verifyPayment = useCallback(async (campaignId: string) => {
    setVerifying(true);
    try {
      const res = await api.adCampaigns.verify(campaignId);
      setCampaign(res.campaign);
      if (res.campaign.status === 'active') {
        setSucceeded(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (res.campaign.status === 'pending_payment') {
        Alert.alert(
          'Payment pending',
          "Your payment is being processed. We'll activate your ad automatically once confirmed.",
          [{ text: 'OK' }],
        );
      } else if (res.campaign.status === 'failed') {
        Alert.alert(
          'Payment failed',
          'Your payment could not be processed. Tap "Create ad" to try again.',
          [{ text: 'OK' }],
        );
      }
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      if (msg.includes('unpaid') || msg.includes('402')) {
        Alert.alert('Checkout cancelled', 'Your payment was not completed. You can try again.', [{ text: 'OK' }]);
      } else {
        Alert.alert('Verification failed', 'Could not confirm payment. Please check your campaign status.', [{ text: 'OK' }]);
      }
    } finally {
      setVerifying(false);
    }
  }, [api.adCampaigns]);

  // ── Media helpers ─────────────────────────────────────────────────────────

  async function pickMedia(kind: 'photos' | 'video') {
    if (!campaign) return;

    if (localPaths.length > 0 && mediaKind !== kind) {
      Alert.alert(
        'Mixed media not allowed',
        kind === 'video' ? 'Remove your photos before adding a video.' : 'Remove your video before adding photos.',
      );
      return;
    }
    if (kind === 'video' && localPaths.length > 0) {
      Alert.alert('One video only', 'A video campaign allows exactly one video.');
      return;
    }
    if (kind === 'photos' && localPaths.length >= MAX_PHOTOS) {
      Alert.alert('Maximum reached', `You can add at most ${MAX_PHOTOS} photos.`);
      return;
    }

    let result: ImagePicker.ImagePickerResult;
    try {
      result = kind === 'video'
        ? await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Videos, allowsMultipleSelection: false, quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true, selectionLimit: MAX_PHOTOS - localPaths.length, quality: 1 });
    } catch {
      Alert.alert('Picker error', 'Could not open media library.');
      return;
    }

    if (result.canceled || !result.assets?.length) return;

    for (const asset of result.assets) {
      const mimeType = (asset as any).mimeType ?? (kind === 'video' ? 'video/mp4' : 'image/jpeg');
      const fileSize = (asset as any).fileSize ?? 0;
      const duration = (asset as any).duration ?? undefined;

      const validation = kind === 'video'
        ? validateVideoFile(mimeType, fileSize, duration != null ? duration / 1000 : undefined)
        : validateImageFile(mimeType, fileSize);

      if (!validation.valid) {
        Alert.alert('Invalid file', validation.error ?? 'This file cannot be used.');
        continue;
      }

      // Dev seller preview: keep media local; skip object-storage upload.
      if (inSellerPreview) {
        // Use the local URI as the "path" — no server round-trip.
        setLocalPaths((prev) => [...prev, asset.uri]);
        setLocalMimes((prev) => [...prev, mimeType]);
        setLocalUris((prev)  => [...prev, asset.uri]);
        setMediaKind(kind);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        continue;
      }

      setLoading(true);
      try {
        const fetchRes = await fetch(asset.uri);
        const blob = await fetchRes.blob();
        const uploadRes = await api.adCampaigns.uploadMedia(campaign.id, blob, mimeType, {
          mediaKind: kind,
          ...(kind === 'video' && duration != null ? { durationSeconds: duration / 1000 } : {}),
        });
        setLocalPaths((prev) => [...prev, uploadRes.objectPath]);
        setLocalMimes((prev) => [...prev, mimeType]);
        setLocalUris((prev)  => [...prev, asset.uri]);
        setMediaKind(kind);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch (e: any) {
        const msg = e?.message ?? '';
        Alert.alert('Upload failed', msg.includes('409') ? 'Cannot mix media types.' : 'Upload failed. Please try again.');
      } finally {
        setLoading(false);
      }
    }
  }

  async function handleRemoveMedia(index: number) {
    if (!campaign) return;

    // Dev seller preview: remove locally only — no API call.
    if (inSellerPreview) {
      setLocalPaths((prev) => { const a = [...prev]; a.splice(index, 1); return a; });
      setLocalMimes((prev) => { const a = [...prev]; a.splice(index, 1); return a; });
      setLocalUris((prev)  => { const a = [...prev]; a.splice(index, 1); return a; });
      if (localPaths.length - 1 === 0) setMediaKind('photos');
      return;
    }

    setLoading(true);
    try {
      await api.adCampaigns.removeMedia(campaign.id, index);
      setLocalPaths((prev) => { const a = [...prev]; a.splice(index, 1); return a; });
      setLocalMimes((prev) => { const a = [...prev]; a.splice(index, 1); return a; });
      setLocalUris((prev)  => { const a = [...prev]; a.splice(index, 1); return a; });
      if (localPaths.length - 1 === 0) setMediaKind('photos');
    } catch {
      Alert.alert('Error', 'Could not remove media. Try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleReorder(from: number, direction: 'left' | 'right') {
    if (!campaign) return;
    const to = direction === 'left' ? from - 1 : from + 1;
    if (to < 0 || to >= localPaths.length) return;

    // Apply local reorder first (UI responsiveness in both preview and production)
    setLocalPaths((prev) => { const a = [...prev]; [a[from], a[to]] = [a[to], a[from]]; return a; });
    setLocalMimes((prev) => { const a = [...prev]; [a[from], a[to]] = [a[to], a[from]]; return a; });
    setLocalUris((prev)  => { const a = [...prev]; [a[from], a[to]] = [a[to], a[from]]; return a; });

    // Dev seller preview: skip server reorder call.
    if (inSellerPreview) return;

    const order = Array.from({ length: localPaths.length }, (_, i) => i);
    [order[from], order[to]] = [order[to], order[from]];
    try { await api.adCampaigns.reorderMedia(campaign.id, order); } catch { /* revert not needed */ }
  }

  // ── Step navigation ───────────────────────────────────────────────────────

  function goBack() {
    if (step === 0) { router.back(); return; }
    setStep((s) => s - 1);
    Haptics.selectionAsync();
  }

  async function goNext() {
    if (!campaign) return;

    // ── Step 1: Media ──
    if (step === 0) {
      const v = validateMediaStage({ mediaObjectPaths: localPaths, mediaKind });
      if (!v.valid) { Alert.alert('Incomplete', v.errors.join('\n')); return; }
    }

    // ── Step 2: Description ──
    if (step === 1) {
      const v = validateDescriptionStage({ headline });
      if (!v.valid) { Alert.alert('Incomplete', v.errors.join('\n')); return; }
    }

    // ── Step 3: CTA — persist headline + description + CTA in one update ──
    if (step === 2) {
      const v = validateCtaStage({ ctaKind: ctaKind ?? undefined, ctaDestinationId: ctaDestId ?? undefined });
      if (!v.valid) { Alert.alert('Incomplete', v.errors.join('\n')); return; }

      // Dev seller preview: skip update API call — persist only in local state.
      if (!inSellerPreview) {
        setLoading(true);
        try {
          const selected = CTA_OPTIONS.find((c) => c.kind === ctaKind);
          const updated = await api.adCampaigns.update(campaign.id, {
            headline,
            description: description || undefined,
            ctaKind: ctaKind!,
            ctaDestinationKind: selected?.destinationKind,
            ...(ctaDestId ? { ctaDestinationId: ctaDestId } : {}),
          });
          setCampaign(updated.campaign);
        } catch {
          Alert.alert('Error', 'Could not save details. Please try again.');
          setLoading(false);
          return;
        }
        setLoading(false);
      }
    }

    // ── Step 4: Format ──
    if (step === 3) {
      const v = validateFormatStage({ formats });
      if (!v.valid) { Alert.alert('Incomplete', v.errors.join('\n')); return; }
    }

    // ── Step 5: Budget — trigger payment ──
    if (step === 4) { handlePay(); return; }

    setStep((s) => s + 1);
    Haptics.selectionAsync();
  }

  // ── Payment — Stripe Checkout Session ─────────────────────────────────────

  async function handlePay() {
    if (!campaign) return;

    const v = validateBudgetStage({ formats, budgetCents, durationDays });
    if (!v.valid) { Alert.alert('Incomplete', v.errors.join('\n')); return; }

    // Dev seller preview: never activate or charge. Show an honest sign-in alert.
    if (inSellerPreview) {
      Alert.alert(
        'Preview mode',
        'Checkout requires a real seller account.\n\nSign in to a Brandthread seller account to test live ad campaign payment.',
        [{ text: 'OK' }],
      );
      return;
    }

    setLoading(true);
    try {
      const updated = await api.adCampaigns.update(campaign.id, { formats, budgetCents, durationDays });
      setCampaign(updated.campaign);
    } catch {
      Alert.alert('Error', 'Could not save campaign settings. Please try again.');
      setLoading(false);
      return;
    }
    setLoading(false);

    setPaying(true);
    try {
      const returnUrl = makeReturnUrl(campaign.id);
      const { url, paymentStatus } = await api.adCampaigns.pay(campaign.id, returnUrl);

      if (paymentStatus === 'paid' || paymentStatus === 'no_payment_required') {
        await verifyPayment(campaign.id);
        return;
      }

      const result = await WebBrowser.openAuthSessionAsync(url, returnUrl);

      if (result.type === 'success') {
        await verifyPayment(campaign.id);
        return;
      }
      if (result.type === 'cancel' || result.type === 'dismiss') {
        Alert.alert(
          'Checkout cancelled',
          'Your payment was not completed. Your campaign is saved and you can try again.',
          [{ text: 'OK' }],
        );
        return;
      }
      Alert.alert(
        'Checkout incomplete',
        'Secure checkout did not return a payment confirmation. Please try again.',
        [{ text: 'OK' }],
      );
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      Alert.alert(
        'Payment failed',
        msg.includes('422') || msg.includes('media')
          ? 'Make sure your campaign has media, a CTA, and at least one format before paying.'
          : 'Could not start checkout. Please try again.',
        [{ text: 'OK' }],
      );
    } finally {
      setPaying(false);
    }
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  function renderHeader() {
    return (
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <TouchableOpacity onPress={goBack} style={styles.headerBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityRole="button" accessibilityLabel="Go back">
          <Feather name="arrow-left" size={20} color={FG} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Create Ad</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityRole="button" accessibilityLabel="Close">
          <Feather name="x" size={20} color={MUTED} />
        </TouchableOpacity>
      </View>
    );
  }

  // ── Step 1: Media ─────────────────────────────────────────────────────────

  function renderMedia() {
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: SP.md, paddingBottom: bottomPad }}>
        <StepDots total={TOTAL_STEPS} current={0} />
        <Text style={styles.stageHeading}>Add your media</Text>
        <Text style={styles.stageSub}>Upload one video (up to 60 s) or 1–5 photos.{'\n'}You cannot mix video and photos.</Text>

        {(!localPaths.length || mediaKind === 'photos') && (
          <TouchableOpacity
            style={[styles.pickerCard, mediaKind === 'video' && localPaths.length > 0 && { opacity: 0.35 }]}
            onPress={() => pickMedia('photos')}
            disabled={mediaKind === 'video' && localPaths.length > 0}
            accessibilityRole="button"
            accessibilityLabel="Add photos"
            testID="pick-photos-btn"
          >
            <Feather name="image" size={ICON.md} color={PURPLE_LIGHT} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.pickerCardTitle}>Add photos</Text>
              <Text style={styles.pickerCardSub}>JPEG, PNG, WebP, HEIC · max 20 MB each · up to {MAX_PHOTOS}</Text>
            </View>
            <Feather name="plus" size={ICON.sm} color={MUTED} />
          </TouchableOpacity>
        )}

        {(!localPaths.length || mediaKind === 'video') && (
          <TouchableOpacity
            style={[styles.pickerCard, { marginTop: SP.sm }, mediaKind === 'photos' && localPaths.length > 0 && { opacity: 0.35 }]}
            onPress={() => pickMedia('video')}
            disabled={mediaKind === 'photos' && localPaths.length > 0}
            accessibilityRole="button"
            accessibilityLabel="Add video"
            testID="pick-video-btn"
          >
            <Feather name="video" size={ICON.md} color={PURPLE_LIGHT} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.pickerCardTitle}>Add video</Text>
              <Text style={styles.pickerCardSub}>MP4, MOV · max 500 MB · max 60 seconds</Text>
            </View>
            <Feather name="plus" size={ICON.sm} color={MUTED} />
          </TouchableOpacity>
        )}

        {localPaths.length > 0 && (
          <View style={{ marginTop: SP.lg }}>
            <Text style={styles.sectionLabel}>{mediaKind === 'video' ? 'Video' : `Photos (${localPaths.length}/${MAX_PHOTOS})`}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginTop: SP.sm }}>
              {localUris.map((uri, i) => (
                <MediaThumb
                  key={`${uri}-${i}`}
                  uri={uri}
                  mimeType={localMimes[i] ?? 'image/jpeg'}
                  index={i}
                  onRemove={() => handleRemoveMedia(i)}
                  onMoveLeft={() => handleReorder(i, 'left')}
                  onMoveRight={() => handleReorder(i, 'right')}
                  canMoveLeft={i > 0}
                  canMoveRight={i < localPaths.length - 1}
                />
              ))}
              {mediaKind === 'photos' && localPaths.length < MAX_PHOTOS && (
                <TouchableOpacity style={[mt.wrap, { alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed' }]} onPress={() => pickMedia('photos')} testID="add-more-photos-btn">
                  <Feather name="plus" size={24} color={MUTED} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {localPaths.length > 0 && (
          <View style={[styles.infoBox, { marginTop: SP.lg }]}>
            <Feather name="lock" size={13} color={MUTED} />
            <Text style={styles.infoBoxText}>Media is kept private until your campaign is verified and activated.</Text>
          </View>
        )}
      </ScrollView>
    );
  }

  // ── Step 2: Description ───────────────────────────────────────────────────

  function renderDescription() {
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: SP.md, paddingBottom: bottomPad }} keyboardShouldPersistTaps="handled">
        <StepDots total={TOTAL_STEPS} current={1} />
        <Text style={styles.stageHeading}>Describe your ad</Text>
        <Text style={styles.stageSub}>Write a headline and an optional description for your campaign.</Text>

        <Text style={styles.sectionLabel}>Headline</Text>
        <TextInput
          value={headline}
          onChangeText={setHeadline}
          placeholder="Short, punchy headline…"
          placeholderTextColor={SUBTLE}
          style={styles.textInputField}
          maxLength={80}
          returnKeyType="done"
          testID="headline-input"
        />
        <Text style={styles.charCount}>{headline.length}/80</Text>

        <Text style={[styles.sectionLabel, { marginTop: SP.lg }]}>Description <Text style={{ fontFamily: FONT.regular, color: SUBTLE }}>(optional)</Text></Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Brief description of your product or offer…"
          placeholderTextColor={SUBTLE}
          style={styles.textArea}
          multiline
          maxLength={200}
          returnKeyType="done"
          testID="description-input"
        />
        <Text style={styles.charCount}>{description.length}/200</Text>
      </ScrollView>
    );
  }

  // ── Step 3: Call to action ────────────────────────────────────────────────

  function renderCta() {
    const selectedCta = CTA_OPTIONS.find((c) => c.kind === ctaKind);
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: SP.md, paddingBottom: bottomPad }} keyboardShouldPersistTaps="handled">
        <StepDots total={TOTAL_STEPS} current={2} />
        <Text style={styles.stageHeading}>Call to action</Text>
        <Text style={styles.stageSub}>Choose what happens when someone taps your ad.</Text>

        <View style={{ gap: SP.sm, marginTop: SP.md }}>
          {CTA_OPTIONS.map((opt) => {
            const active = ctaKind === opt.kind;
            return (
              <TouchableOpacity
                key={opt.kind}
                style={[styles.ctaCard, active && styles.ctaCardActive]}
                onPress={() => { Haptics.selectionAsync(); setCtaKind(opt.kind); setCtaDestId(null); }}
                activeOpacity={0.8}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                accessibilityLabel={opt.label}
                testID={`cta-${opt.kind}`}
              >
                <View style={[styles.ctaRadio, active && styles.ctaRadioActive]}>
                  {active && <View style={styles.ctaRadioFill} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.ctaLabel, active && styles.ctaLabelActive]}>{opt.label}</Text>
                  <Text style={styles.ctaDestKind}>
                    {opt.requiresProductSelection ? 'Links to a product' : `Links to your ${opt.destinationKind}`}
                  </Text>
                </View>
                {active && <Feather name="check" size={ICON.sm} color={PURPLE_LIGHT} />}
              </TouchableOpacity>
            );
          })}
        </View>

        {selectedCta?.requiresProductSelection && (
          <View style={{ marginTop: SP.lg }}>
            <Text style={styles.sectionLabel}>Select product</Text>
            <Text style={[styles.stageSub, { marginBottom: SP.sm }]}>Choose which product this ad promotes.</Text>
            {loadingProducts ? (
              <ActivityIndicator color={PURPLE_LIGHT} style={{ margin: SP.md }} />
            ) : (
              <View style={{ gap: SP.sm }}>
                {products.map((p) => {
                  const active = ctaDestId === p.id;
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.productRow, active && styles.productRowActive]}
                      onPress={() => { Haptics.selectionAsync(); setCtaDestId(p.id); }}
                      testID={`product-chip-${p.id}`}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: active }}
                    >
                      <View style={[styles.ctaRadio, active && styles.ctaRadioActive]}>
                        {active && <View style={styles.ctaRadioFill} />}
                      </View>
                      <Text style={[styles.productRowText, active && styles.productRowTextActive]}>{p.name}</Text>
                    </TouchableOpacity>
                  );
                })}
                {products.length === 0 && (
                  <View style={styles.infoBox}>
                    <Feather name="alert-circle" size={13} color={MUTED} />
                    <Text style={styles.infoBoxText}>No products found. Add products to your store first.</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    );
  }

  // ── Step 4: Output format ─────────────────────────────────────────────────

  function renderFormat() {
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: SP.md, paddingBottom: bottomPad }}>
        <StepDots total={TOTAL_STEPS} current={3} />
        <Text style={styles.stageHeading}>Output format</Text>
        <Text style={styles.stageSub}>Choose where your ad appears. Each card shows the exact aspect ratio for that placement.</Text>

        <View style={{ gap: SP.sm, marginTop: SP.md }}>
          {AD_FORMAT_OPTIONS.map((fmt) => {
            const active = formats.includes(fmt.kind);
            return (
              <TouchableOpacity
                key={fmt.kind}
                style={[styles.formatRow, active && styles.formatRowActive]}
                onPress={() => {
                  Haptics.selectionAsync();
                  setFormats((prev) =>
                    prev.includes(fmt.kind) ? prev.filter((f) => f !== fmt.kind) : [...prev, fmt.kind]
                  );
                }}
                activeOpacity={0.8}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: active }}
                testID={`format-${fmt.kind}`}
              >
                {/* Accurate aspect-ratio silhouette */}
                <AspectSilhouette ratioW={fmt.ratioW} ratioH={fmt.ratioH} active={active} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[styles.formatLabel, active && styles.formatLabelActive]}>{fmt.label}</Text>
                  <Text style={styles.formatDesc}>{fmt.description}</Text>
                  <Text style={styles.formatAr}>{fmt.aspectRatio} · {fmt.dims}</Text>
                </View>
                <Feather name={active ? 'check-square' : 'square'} size={ICON.sm} color={active ? PURPLE_LIGHT : MUTED} />
              </TouchableOpacity>
            );
          })}
        </View>

        {formats.length > 0 && (
          <View style={[styles.infoBox, { marginTop: SP.lg }]}>
            <Feather name="info" size={13} color={MUTED} />
            <Text style={styles.infoBoxText}>
              {formats.length} format{formats.length !== 1 ? 's' : ''} selected. Your ad will be delivered in each chosen placement.
            </Text>
          </View>
        )}
      </ScrollView>
    );
  }

  // ── Step 5: Budget & duration ─────────────────────────────────────────────

  function renderBudget() {
    const budgetDollars = budgetCents / 100;
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: SP.md, paddingBottom: bottomPad }}>
        <StepDots total={TOTAL_STEPS} current={4} />
        <Text style={styles.stageHeading}>Budget & duration</Text>
        <Text style={styles.stageSub}>Slide to set your total spend and how long your ad runs.</Text>

        {/* Budget slider */}
        <Text style={[styles.sectionLabel, { marginTop: SP.md }]}>Budget</Text>
        <View style={styles.sliderCard}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SP.xs }}>
            <Text style={styles.sliderMin}>${BUDGET_MIN_CENTS / 100}</Text>
            <Text style={styles.sliderCurrent}>${budgetDollars}</Text>
            <Text style={styles.sliderMax}>${BUDGET_MAX_CENTS / 100}</Text>
          </View>
          <SnapSlider
            value={budgetCents}
            min={BUDGET_MIN_CENTS}
            max={BUDGET_MAX_CENTS}
            steps={BUDGET_STEPS}
            onChange={setBudgetCents}
            accessibilityLabel="Campaign budget"
          />
          <Text style={styles.sliderHint}>Whole dollars only · $5 – $1,000</Text>
        </View>

        {/* Duration slider */}
        <Text style={[styles.sectionLabel, { marginTop: SP.lg }]}>Duration</Text>
        <View style={styles.sliderCard}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SP.xs }}>
            <Text style={styles.sliderMin}>{DURATION_MIN_DAYS} day</Text>
            <Text style={styles.sliderCurrent}>{durationDays} day{durationDays !== 1 ? 's' : ''}</Text>
            <Text style={styles.sliderMax}>{DURATION_MAX_DAYS} days</Text>
          </View>
          <SnapSlider
            value={durationDays}
            min={DURATION_MIN_DAYS}
            max={DURATION_MAX_DAYS}
            step={1}
            onChange={setDurationDays}
            accessibilityLabel="Campaign duration"
          />
          <Text style={styles.sliderHint}>1 to 30 days</Text>
        </View>

        {/* Live estimated reach */}
        <View style={styles.reachCard} testID="estimated-reach">
          <Feather name="users" size={16} color={SUCCESS} />
          <View style={{ flex: 1 }}>
            <Text style={styles.reachLabel}>Estimated reach</Text>
            <Text style={styles.reachRange}>{reach.low.toLocaleString()}–{reach.high.toLocaleString()} people</Text>
            <Text style={styles.reachDisclaimer}>
              Estimate only — based on your budget. Not a guarantee of delivered impressions.
            </Text>
          </View>
        </View>
      </ScrollView>
    );
  }

  // ── Verifying state (post-redirect) ──────────────────────────────────────

  if (verifying) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', gap: SP.md }}>
        <ActivityIndicator color={PURPLE_LIGHT} size="large" />
        <Text style={styles.stageSub}>Verifying your payment…</Text>
        <Text style={[styles.stageSub, { fontSize: FS.xs, color: SUBTLE, textAlign: 'center', paddingHorizontal: SP.xl }]}>
          Never activates on redirect alone — confirming with Stripe now.
        </Text>
      </View>
    );
  }

  // ── Success screen ────────────────────────────────────────────────────────

  if (succeeded) {
    return (
      <View style={{ flex: 1, backgroundColor: BG }}>
        {renderHeader()}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.xl, gap: SP.md }}>
          <View style={[styles.successIcon, { backgroundColor: SUCCESS_DIM }]}>
            <Feather name="check" size={32} color={SUCCESS} />
          </View>
          <Text style={styles.stageHeading}>Your ad is live</Text>
          <Text style={[styles.stageSub, { textAlign: 'center' }]}>
            Payment confirmed. We'll start showing it right away.
          </Text>
          <Text style={[styles.stageSub, { textAlign: 'center', color: SUBTLE, fontSize: FS.xs }]}>
            Estimated reach: {reach.low.toLocaleString()}–{reach.high.toLocaleString()} people (estimate only — not a delivered-impression guarantee).
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.back()}>
            <Text style={styles.primaryBtnText}>Back to Design Studio</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────

  if (initError) {
    const isAuthError = initError.toLowerCase().includes('sign in') || initError.toLowerCase().includes('session');
    return (
      <View style={{ flex: 1, backgroundColor: BG }}>
        {renderHeader()}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.xl, gap: SP.md }}>
          <Feather name={isAuthError ? 'lock' : 'alert-circle'} size={36} color={RED} />
          <Text style={styles.stageHeading}>{isAuthError ? 'Sign in required' : 'Something went wrong'}</Text>
          <Text style={[styles.stageSub, { textAlign: 'center' }]}>{initError}</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => { setInitError(null); router.back(); }}>
            <Text style={styles.primaryBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Loading skeleton ─────────────────────────────────────────────────────

  if (!campaign && loading) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={PURPLE_LIGHT} size="large" />
        <Text style={[styles.stageSub, { marginTop: SP.md }]}>Setting up your campaign…</Text>
      </View>
    );
  }

  // Continue button label & disabled logic
  const isLastStep = step === TOTAL_STEPS - 1;
  const ctaButtonDisabled = (step === 0 && localPaths.length === 0) || loading || paying;
  const continueLabel = isLastStep ? `Create ad · $${budgetCents / 100}` : 'Continue';

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      {renderHeader()}

      {/* Step indicator text */}
      <View style={{ paddingHorizontal: SP.md, paddingTop: SP.sm }}>
        <Text style={styles.stageTitle}>Step {step + 1} of {TOTAL_STEPS} — {STEP_LABELS[step]}</Text>
      </View>

      <View style={{ flex: 1 }}>
        {step === 0 && renderMedia()}
        {step === 1 && renderDescription()}
        {step === 2 && renderCta()}
        {step === 3 && renderFormat()}
        {step === 4 && renderBudget()}
      </View>

      {/* Sticky bottom bar */}
      <View style={[styles.stickyBottom, { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 0) + SP.md }]}>
        <TouchableOpacity
          style={[styles.primaryBtn, { flex: 1 }, ctaButtonDisabled && { opacity: 0.5 }]}
          onPress={isLastStep ? handlePay : goNext}
          disabled={ctaButtonDisabled}
          accessibilityRole="button"
          accessibilityLabel={continueLabel}
          testID="stage-continue-btn"
        >
          {(loading || paying) ? (
            <ActivityIndicator color="#000" size="small" />
          ) : (
            <Text style={styles.primaryBtnText}>{continueLabel}</Text>
          )}
          {!isLastStep && !loading && <Feather name="arrow-right" size={18} color="#000" />}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header:             { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingBottom: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER },
  headerBtn:          { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle:        { flex: 1, textAlign: 'center', fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  stageTitle:         { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, marginBottom: SP.xs },
  stageHeading:       { fontSize: FS.xl, fontFamily: FONT.bold, color: FG, marginBottom: SP.xs },
  stageSub:           { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 20 },
  sectionLabel:       { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, marginTop: SP.lg, marginBottom: SP.xs },
  pickerCard:         { flexDirection: 'row', alignItems: 'center', gap: SP.md, backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, padding: SP.md, marginTop: SP.sm },
  pickerCardTitle:    { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  pickerCardSub:      { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, lineHeight: 16 },
  infoBox:            { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, backgroundColor: CARD, borderRadius: RADIUS.md, padding: SP.md, borderWidth: 1, borderColor: BORDER_SUBTLE },
  infoBoxText:        { flex: 1, fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, lineHeight: 18 },
  textInputField:     { backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, paddingHorizontal: SP.md, paddingVertical: SP.sm, fontSize: FS.base, fontFamily: FONT.regular, color: FG, marginTop: SP.xs },
  charCount:          { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, alignSelf: 'flex-end', marginTop: 2 },
  textArea:           { backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, paddingHorizontal: SP.md, paddingVertical: SP.sm, fontSize: FS.sm, fontFamily: FONT.regular, color: FG, minHeight: 80, marginTop: SP.xs },
  ctaCard:            { flexDirection: 'row', alignItems: 'center', gap: SP.md, backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, padding: SP.md },
  ctaCardActive:      { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE },
  ctaRadio:           { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: MUTED, alignItems: 'center', justifyContent: 'center' },
  ctaRadioActive:     { borderColor: PURPLE_LIGHT },
  ctaRadioFill:       { width: 10, height: 10, borderRadius: 5, backgroundColor: PURPLE_LIGHT },
  ctaLabel:           { fontSize: FS.base, fontFamily: FONT.semibold, color: MUTED },
  ctaLabelActive:     { color: FG },
  ctaDestKind:        { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  productRow:         { flexDirection: 'row', alignItems: 'center', gap: SP.md, backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, padding: SP.md },
  productRowActive:   { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE },
  productRowText:     { flex: 1, fontSize: FS.base, fontFamily: FONT.medium, color: MUTED },
  productRowTextActive: { color: FG },
  formatRow:          { flexDirection: 'row', alignItems: 'center', gap: SP.md, backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, padding: SP.md },
  formatRowActive:    { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE },
  formatLabel:        { fontSize: FS.base, fontFamily: FONT.semibold, color: MUTED },
  formatLabelActive:  { color: FG },
  formatAr:           { fontSize: FS.xs, fontFamily: FONT.medium, color: SUBTLE },
  formatDesc:         { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  sliderCard:         { backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, padding: SP.md, marginTop: SP.sm },
  sliderMin:          { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  sliderCurrent:      { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  sliderMax:          { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  sliderHint:         { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginTop: SP.xs, textAlign: 'center' },
  reachCard:          { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, backgroundColor: SUCCESS_DIM, borderRadius: RADIUS.md, borderWidth: 1, borderColor: SUCCESS, padding: SP.md, marginTop: SP.lg },
  reachLabel:         { fontSize: FS.sm, fontFamily: FONT.semibold, color: SUCCESS, marginBottom: 2 },
  reachRange:         { fontSize: FS.lg, fontFamily: FONT.bold, color: FG },
  reachDisclaimer:    { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 4, lineHeight: 16 },
  stickyBottom:       { borderTopWidth: 1, borderTopColor: BORDER, backgroundColor: BG, paddingHorizontal: SP.md, paddingTop: SP.sm, flexDirection: 'row', gap: SP.sm },
  primaryBtn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, backgroundColor: PURPLE_LIGHT, borderRadius: RADIUS.md, paddingVertical: SP.md, paddingHorizontal: SP.lg, minHeight: 52 },
  primaryBtnText:     { fontSize: FS.base, fontFamily: FONT.bold, color: '#0A0A0B' },
  successIcon:        { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
});
