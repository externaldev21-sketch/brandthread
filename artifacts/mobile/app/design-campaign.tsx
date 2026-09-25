/**
 * Brandthread Create Ad — single-page creator
 * Route: /design-campaign
 *
 * Sections (compact, scrollable — not a step wizard):
 *   1. Live ad preview — rendered the same way it appears in the buyer feed
 *   2. Product & creative — one video OR 1–5 ordered photos
 *   3. Headline & caption
 *   4. Call to action (+ product selection when required)
 *   5. Audience & reach — read-only estimated reach (no audience targeting exists server-side)
 *   6. Budget & duration — sliders + live reach estimate
 *   7. Sticky "Launch" button pinned to the bottom
 *
 * Payment flow (unchanged, same pattern as sample-detail.tsx):
 *   1. User taps "Launch · $X" → PATCH campaign with final fields → POST /pay → get checkout URL
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
 *
 * Output format: the server requires a non-empty `formats` array before pay,
 * but this UI no longer exposes a format picker — the ad is always delivered
 * for the single placement that matches this exact preview (portrait feed,
 * 4:5), so `DEFAULT_FORMATS` below is sent automatically.
 *
 * Audience targeting: `ad_campaigns` has no audience/targeting columns and the
 * route never reads any — there is nothing real to select here, so this
 * screen only surfaces the already-computed estimated reach, read-only.
 */
import React, {
  useState, useCallback, useRef, useEffect, useMemo,
} from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, Platform, TextInput,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import { useUser } from '@clerk/expo';

import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { useAppTheme, getOnAccentTextStyle } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
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
  validateMediaStage,
  validateDescriptionStage,
  validateCtaStage,
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
import { Header } from '@/components/layout';
import { InlineSlider } from '@/components/InlineSlider';

// ─── Constants ────────────────────────────────────────────────────────────────

// The server still requires a non-empty `formats` array (see route note above).
// This design shows a single, true-to-life placement, so we always send this.
const DEFAULT_FORMATS: AdFormatKind[] = ['portrait_4x5'];

/** Return URL for Stripe Checkout redirect — matches server allowlist. */
function makeReturnUrl(campaignId: string): string {
  return buildAdCampaignReturnUrl(campaignId);
}

// ─── Media thumbnail (compact picker strip) ──────────────────────────────────

function MediaThumb({
  uri, mimeType, onRemove, onMoveLeft, onMoveRight, canMoveLeft, canMoveRight, index, colors,
}: {
  uri: string; mimeType: string; onRemove: () => void;
  onMoveLeft: () => void; onMoveRight: () => void;
  canMoveLeft: boolean; canMoveRight: boolean; index: number;
  colors: ReturnType<typeof useColors>;
}) {
  const isVideo = mimeType.startsWith('video/');
  return (
    <View style={[mt.wrap, { backgroundColor: colors.card, borderColor: colors.border }]} testID={`media-thumb-${index}`}>
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
  wrap:       { width: 76, height: 76, borderRadius: RADIUS.sm, overflow: 'hidden', borderWidth: 1, position: 'relative' },
  img:        { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  videoBadge: { position: 'absolute', top: 4, left: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, paddingHorizontal: 5, paddingVertical: 2, flexDirection: 'row', alignItems: 'center', gap: 2 },
  removeBtn:  { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  reorderRow: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 4, paddingVertical: 2 },
  reorderBtn: { padding: 2 },
});

// ─── Live ad preview — the same visual language as the buyer feed card ──────
// Full-bleed media, bottom scrim, creator row + caption + a shop-style CTA
// pill, mirroring the feed's bottom-left overlay (see app/(tabs)/feed.tsx).

function AdPreviewCard({
  mediaUri, isVideo, headline, ctaText, brandName,
}: {
  mediaUri: string | null;
  isVideo: boolean;
  headline: string;
  ctaText: string | null;
  brandName: string;
}) {
  const { theme } = useAppTheme();
  const colors = useColors();
  return (
    <View style={[pv.card, { backgroundColor: colors.card, borderColor: colors.border }]} testID="ad-preview-card">
      {mediaUri ? (
        <Image source={{ uri: mediaUri }} style={pv.media} contentFit="cover" />
      ) : (
        <View style={[pv.media, pv.mediaEmpty, { backgroundColor: colors.elevated }]}>
          <Feather name="image" size={ICON.lg} color={colors.mutedForeground} />
          <Text style={[pv.emptyText, { color: colors.mutedForeground }]}>Add media to see your ad preview</Text>
        </View>
      )}

      {isVideo && mediaUri && (
        <View style={pv.videoBadge}>
          <Feather name="play" size={12} color="#fff" />
        </View>
      )}

      <View style={pv.sponsoredWrap}>
        <View style={pv.sponsoredPill}>
          <Feather name="zap" size={10} color="#fff" />
          <Text style={pv.sponsoredText}>Sponsored</Text>
        </View>
      </View>

      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.82)']}
        style={pv.scrim}
        pointerEvents="none"
      />

      <View style={pv.bottomInfo} pointerEvents="none">
        <Text style={pv.brandName} numberOfLines={1}>{brandName}</Text>
        <Text style={pv.headline} numberOfLines={2}>
          {headline || 'Your headline appears here'}
        </Text>
        {ctaText && (
          <View style={[pv.ctaPill, { backgroundColor: theme.accent }]}>
            <Text style={[pv.ctaPillText, getOnAccentTextStyle(theme)]}>{ctaText}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const pv = StyleSheet.create({
  card:          { width: '100%', aspectRatio: 4 / 5, borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden', position: 'relative' },
  media:         { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  mediaEmpty:    { alignItems: 'center', justifyContent: 'center', gap: SP.sm, paddingHorizontal: SP.xl },
  emptyText:     { fontSize: FS.sm, fontFamily: FONT.medium, textAlign: 'center' },
  videoBadge:    { position: 'absolute', top: SP.sm, right: SP.sm, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: RADIUS.pill, padding: 6 },
  sponsoredWrap: { position: 'absolute', top: SP.sm, left: SP.sm },
  sponsoredPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 4 },
  sponsoredText: { fontSize: FS.xs, fontFamily: FONT.bold, color: '#fff', letterSpacing: 0.3 },
  scrim:         { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  bottomInfo:    { position: 'absolute', left: SP.md, right: SP.md, bottom: SP.md, gap: 6 },
  brandName:     { fontSize: FS.sm, fontFamily: FONT.bold, color: '#fff' },
  headline:      { fontSize: FS.base, fontFamily: FONT.semibold, color: '#fff', lineHeight: 20 },
  ctaPill:       { alignSelf: 'flex-start', borderRadius: RADIUS.pill, paddingHorizontal: 14, paddingVertical: 8, marginTop: 2 },
  ctaPillText:   { fontSize: FS.sm, fontFamily: FONT.bold },
});

// ─── Compact section wrapper ──────────────────────────────────────────────────

function Section({
  title, subtitle, children, colors,
}: {
  title: string; subtitle?: string; children: React.ReactNode; colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={{ marginTop: SP.xl }}>
      <Text style={[sec.title, { color: colors.foreground }]}>{title}</Text>
      {subtitle && <Text style={[sec.subtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>}
      <View style={[sec.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {children}
      </View>
    </View>
  );
}

const sec = StyleSheet.create({
  title:    { fontSize: FS.base, fontFamily: FONT.bold, letterSpacing: -0.1 },
  subtitle: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2, marginBottom: SP.sm, lineHeight: 16 },
  card:     { borderRadius: RADIUS.md, borderWidth: 1, padding: SP.md, gap: SP.md },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function CreateAdScreen() {
  const router    = useRouter();
  const params    = useLocalSearchParams<{ id?: string; paymentReturn?: string }>();
  const insets    = useSafeAreaInsets();
  const api       = useApi();
  const { theme } = useAppTheme();
  const colors    = useColors();
  const { user }  = useUser();

  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 0) + 96;

  // ── Campaign state ────────────────────────────────────────────────────────
  const [campaign,  setCampaign]  = useState<AdCampaign | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  // Media
  const [localPaths, setLocalPaths] = useState<string[]>([]);
  const [localMimes, setLocalMimes] = useState<string[]>([]);
  const [localUris,  setLocalUris]  = useState<string[]>([]);
  const [mediaKind,  setMediaKind]  = useState<AdMediaKind>('photos');

  // Headline & caption
  const [headline,    setHeadline]    = useState('');
  const [description, setDescription] = useState('');

  // CTA
  const [ctaKind,   setCtaKind]   = useState<AdCtaKind | null>(null);
  const [ctaDestId, setCtaDestId] = useState<string | null>(null);

  // Budget & duration
  const [budgetCents,  setBudgetCents]  = useState(2500);
  const [durationDays, setDurationDays] = useState(7);

  // Payment state
  const [paying,    setPaying]    = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [succeeded, setSucceeded] = useState(false);

  // Products (loaded up-front since this is now a single page)
  const [products,        setProducts]        = useState<Array<{ id: string; name: string }>>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  // Prevent double-handling the paymentReturn redirect param
  const paymentReturnConsumed = useRef(false);

  const reach = useMemo(() => estimateReach(budgetCents), [budgetCents]);

  // Detect preview once at mount (stable across the component lifetime)
  const inSellerPreview = isSellerDevPreview();

  const brandName = user?.fullName || (user as any)?.username || 'Your Store';

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

  // ── Load products up-front (needed by the CTA section) ──────────────────
  useEffect(() => {
    if (products.length > 0) return;
    setLoadingProducts(true);
    api.products.list()
      .then((rows: unknown) => setProducts((rows as any[]).map((p: any) => ({ id: p.id, name: p.name }))))
      .catch(() => {})
      .finally(() => setLoadingProducts(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          'Your payment could not be processed. Tap "Launch" to try again.',
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

  // ── Launch: validate everything, save, then pay ──────────────────────────

  async function handleLaunch() {
    if (!campaign) return;

    const mediaV = validateMediaStage({ mediaObjectPaths: localPaths, mediaKind });
    if (!mediaV.valid) { Alert.alert('Incomplete', mediaV.errors.join('\n')); return; }

    const descV = validateDescriptionStage({ headline });
    if (!descV.valid) { Alert.alert('Incomplete', descV.errors.join('\n')); return; }

    const ctaV = validateCtaStage({ ctaKind: ctaKind ?? undefined, ctaDestinationId: ctaDestId ?? undefined });
    if (!ctaV.valid) { Alert.alert('Incomplete', ctaV.errors.join('\n')); return; }

    const budgetV = validateBudgetStage({ formats: DEFAULT_FORMATS, budgetCents, durationDays });
    if (!budgetV.valid) { Alert.alert('Incomplete', budgetV.errors.join('\n')); return; }

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
      const selected = CTA_OPTIONS.find((c) => c.kind === ctaKind);
      const updated = await api.adCampaigns.update(campaign.id, {
        headline,
        description: description || undefined,
        ctaKind: ctaKind!,
        ctaDestinationKind: selected?.destinationKind,
        ...(ctaDestId ? { ctaDestinationId: ctaDestId } : {}),
        formats: DEFAULT_FORMATS,
        budgetCents,
        durationDays,
      });
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
          ? 'Make sure your campaign has media, a CTA, and a budget before launching.'
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
      <Header
        title="Create Ad"
        onBack={() => router.back()}
        actions={[{ icon: 'x', onPress: () => router.back(), accessibilityLabel: 'Close' }]}
      />
    );
  }

  // ── Verifying state (post-redirect) ──────────────────────────────────────

  if (verifying) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: SP.md }}>
        <ActivityIndicator color={theme.accentLight} size="large" />
        <Text style={[styles.stageSub, { color: colors.mutedForeground }]}>Verifying your payment…</Text>
        <Text style={[styles.stageSub, { fontSize: FS.xs, color: colors.subtle, textAlign: 'center', paddingHorizontal: SP.xl }]}>
          Never activates on redirect alone — confirming with Stripe now.
        </Text>
      </View>
    );
  }

  // ── Success screen ────────────────────────────────────────────────────────

  if (succeeded) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {renderHeader()}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.xl, gap: SP.md }}>
          <View style={[styles.successIcon, { backgroundColor: colors.success + '22' }]}>
            <Feather name="check" size={32} color={colors.success} />
          </View>
          <Text style={[styles.stageHeading, { color: colors.foreground }]}>Your ad is live</Text>
          <Text style={[styles.stageSub, { textAlign: 'center', color: colors.mutedForeground }]}>
            Payment confirmed. We'll start showing it right away.
          </Text>
          <Text style={[styles.stageSub, { textAlign: 'center', color: colors.subtle, fontSize: FS.xs }]}>
            Estimated reach: {reach.low.toLocaleString()}–{reach.high.toLocaleString()} people (estimate only — not a delivered-impression guarantee).
          </Text>
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: theme.accent }]} onPress={() => router.back()}>
            <Text style={[styles.primaryBtnText, getOnAccentTextStyle(theme)]}>Back to Design Studio</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────

  if (initError) {
    const isAuthError = initError.toLowerCase().includes('sign in') || initError.toLowerCase().includes('session');
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {renderHeader()}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.xl, gap: SP.md }}>
          <Feather name={isAuthError ? 'lock' : 'alert-circle'} size={36} color={colors.destructive} />
          <Text style={[styles.stageHeading, { color: colors.foreground }]}>{isAuthError ? 'Sign in required' : 'Something went wrong'}</Text>
          <Text style={[styles.stageSub, { textAlign: 'center', color: colors.mutedForeground }]}>{initError}</Text>
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: theme.accent }]} onPress={() => { setInitError(null); router.back(); }}>
            <Text style={[styles.primaryBtnText, getOnAccentTextStyle(theme)]}>Go back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Loading skeleton ─────────────────────────────────────────────────────

  if (!campaign && loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accentLight} size="large" />
        <Text style={[styles.stageSub, { marginTop: SP.md, color: colors.mutedForeground }]}>Setting up your campaign…</Text>
      </View>
    );
  }

  const selectedCta   = CTA_OPTIONS.find((c) => c.kind === ctaKind);
  const launchDisabled = localPaths.length === 0 || !headline.trim() || !ctaKind || loading || paying;
  const budgetDollars  = budgetCents / 100;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {renderHeader()}

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: SP.md, paddingBottom: bottomPad }}
      >
        {/* 1 — Live ad preview */}
        <AdPreviewCard
          mediaUri={localUris[0] ?? null}
          isVideo={mediaKind === 'video'}
          headline={headline}
          ctaText={selectedCta?.label ?? null}
          brandName={brandName}
        />

        {/* 2 — Product & creative */}
        <Section
          title="Product & creative"
          subtitle={`One video (up to ${60}s) or 1–${MAX_PHOTOS} photos. You cannot mix video and photos.`}
          colors={colors}
        >
          <View style={{ flexDirection: 'row', gap: SP.sm }}>
            {(!localPaths.length || mediaKind === 'photos') && (
              <TouchableOpacity
                style={[styles.pickerCard, { backgroundColor: colors.elevated, borderColor: colors.border }, mediaKind === 'video' && localPaths.length > 0 && { opacity: 0.35 }]}
                onPress={() => pickMedia('photos')}
                disabled={mediaKind === 'video' && localPaths.length > 0}
                accessibilityRole="button"
                accessibilityLabel="Add photos"
                testID="pick-photos-btn"
              >
                <Feather name="image" size={ICON.md} color={theme.accentLight} />
                <Text style={[styles.pickerCardTitle, { color: colors.foreground }]}>Photos</Text>
              </TouchableOpacity>
            )}
            {(!localPaths.length || mediaKind === 'video') && (
              <TouchableOpacity
                style={[styles.pickerCard, { backgroundColor: colors.elevated, borderColor: colors.border }, mediaKind === 'photos' && localPaths.length > 0 && { opacity: 0.35 }]}
                onPress={() => pickMedia('video')}
                disabled={mediaKind === 'photos' && localPaths.length > 0}
                accessibilityRole="button"
                accessibilityLabel="Add video"
                testID="pick-video-btn"
              >
                <Feather name="video" size={ICON.md} color={theme.accentLight} />
                <Text style={[styles.pickerCardTitle, { color: colors.foreground }]}>Video</Text>
              </TouchableOpacity>
            )}
          </View>

          {localPaths.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm }}>
              {localUris.map((uri, i) => (
                <MediaThumb
                  key={`${uri}-${i}`}
                  uri={uri}
                  mimeType={localMimes[i] ?? 'image/jpeg'}
                  index={i}
                  colors={colors}
                  onRemove={() => handleRemoveMedia(i)}
                  onMoveLeft={() => handleReorder(i, 'left')}
                  onMoveRight={() => handleReorder(i, 'right')}
                  canMoveLeft={i > 0}
                  canMoveRight={i < localPaths.length - 1}
                />
              ))}
              {mediaKind === 'photos' && localPaths.length < MAX_PHOTOS && (
                <TouchableOpacity
                  style={[mt.wrap, { alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', backgroundColor: colors.elevated, borderColor: colors.border }]}
                  onPress={() => pickMedia('photos')}
                  testID="add-more-photos-btn"
                >
                  <Feather name="plus" size={20} color={colors.mutedForeground} />
                </TouchableOpacity>
              )}
            </View>
          )}

          {localPaths.length > 0 && (
            <View style={[styles.infoBox, { backgroundColor: colors.elevated, borderColor: colors.border }]}>
              <Feather name="lock" size={13} color={colors.mutedForeground} />
              <Text style={[styles.infoBoxText, { color: colors.mutedForeground }]}>Media is kept private until your campaign is verified and activated.</Text>
            </View>
          )}
        </Section>

        {/* 3 — Headline & caption */}
        <Section title="Headline & caption" colors={colors}>
          <View>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Headline</Text>
            <TextInput
              value={headline}
              onChangeText={setHeadline}
              placeholder="Short, punchy headline…"
              placeholderTextColor={colors.subtle}
              style={[styles.textInputField, { backgroundColor: colors.elevated, borderColor: colors.border, color: colors.foreground }]}
              maxLength={80}
              returnKeyType="done"
              testID="headline-input"
            />
            <Text style={[styles.charCount, { color: colors.subtle }]}>{headline.length}/80</Text>
          </View>

          <View>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
              Description <Text style={{ fontFamily: FONT.regular }}>(optional)</Text>
            </Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Brief description of your product or offer…"
              placeholderTextColor={colors.subtle}
              style={[styles.textArea, { backgroundColor: colors.elevated, borderColor: colors.border, color: colors.foreground }]}
              multiline
              maxLength={200}
              returnKeyType="done"
              testID="description-input"
            />
            <Text style={[styles.charCount, { color: colors.subtle }]}>{description.length}/200</Text>
          </View>
        </Section>

        {/* 4 — Call to action */}
        <Section title="Call to action" subtitle="Choose what happens when someone taps your ad." colors={colors}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm }}>
            {CTA_OPTIONS.map((opt) => {
              const active = ctaKind === opt.kind;
              return (
                <TouchableOpacity
                  key={opt.kind}
                  style={[
                    styles.ctaChip,
                    { backgroundColor: colors.elevated, borderColor: colors.border },
                    active && { backgroundColor: theme.accentDim, borderColor: theme.accent },
                  ]}
                  onPress={() => { Haptics.selectionAsync(); setCtaKind(opt.kind); setCtaDestId(null); }}
                  activeOpacity={0.8}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={opt.label}
                  testID={`cta-${opt.kind}`}
                >
                  {active && <Feather name="check" size={13} color={theme.accentLight} />}
                  <Text style={[styles.ctaChipText, { color: active ? colors.foreground : colors.mutedForeground }]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {selectedCta?.requiresProductSelection && (
            <View style={{ gap: SP.sm }}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Select product</Text>
              {loadingProducts ? (
                <ActivityIndicator color={theme.accentLight} style={{ margin: SP.md }} />
              ) : (
                <View style={{ gap: SP.sm }}>
                  {products.map((p) => {
                    const active = ctaDestId === p.id;
                    return (
                      <TouchableOpacity
                        key={p.id}
                        style={[styles.productRow, { backgroundColor: colors.elevated, borderColor: colors.border }, active && { backgroundColor: theme.accentDim, borderColor: theme.accent }]}
                        onPress={() => { Haptics.selectionAsync(); setCtaDestId(p.id); }}
                        testID={`product-chip-${p.id}`}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: active }}
                      >
                        <View style={[styles.ctaRadio, { borderColor: colors.mutedForeground }, active && { borderColor: theme.accentLight }]}>
                          {active && <View style={[styles.ctaRadioFill, { backgroundColor: theme.accentLight }]} />}
                        </View>
                        <Text style={[styles.productRowText, { color: active ? colors.foreground : colors.mutedForeground }]}>{p.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                  {products.length === 0 && (
                    <View style={[styles.infoBox, { backgroundColor: colors.elevated, borderColor: colors.border }]}>
                      <Feather name="alert-circle" size={13} color={colors.mutedForeground} />
                      <Text style={[styles.infoBoxText, { color: colors.mutedForeground }]}>No products found. Add products to your store first.</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          )}
        </Section>

        {/* 5 — Audience & reach (read-only — no audience targeting exists server-side) */}
        <Section title="Audience & reach" colors={colors}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm }}>
            <Feather name="users" size={16} color={colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.reachRange, { color: colors.foreground }]}>{reach.low.toLocaleString()}–{reach.high.toLocaleString()} people</Text>
              <Text style={[styles.reachDisclaimer, { color: colors.mutedForeground }]}>
                Who this will reach, estimated from your budget. Brandthread doesn't yet support choosing an audience by
                demographics or interests — every campaign reaches this general shopper pool.
              </Text>
            </View>
          </View>
        </Section>

        {/* 6 — Budget & duration */}
        <Section title="Budget & duration" subtitle="Slide to set your total spend and how long your ad runs." colors={colors}>
          <View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SP.xs }}>
              <Text style={[styles.sliderMin, { color: colors.subtle }]}>${BUDGET_MIN_CENTS / 100}</Text>
              <Text style={[styles.sliderCurrent, { color: colors.foreground }]}>${budgetDollars}</Text>
              <Text style={[styles.sliderMax, { color: colors.subtle }]}>${BUDGET_MAX_CENTS / 100}</Text>
            </View>
            <InlineSlider
              value={budgetCents}
              min={BUDGET_MIN_CENTS}
              max={BUDGET_MAX_CENTS}
              steps={BUDGET_STEPS}
              onChange={setBudgetCents}
              accessibilityLabel="Campaign budget"
              accentColor={theme.accentLight}
              trackColor={colors.border}
            />
            <Text style={[styles.sliderHint, { color: colors.subtle }]}>Whole dollars only · $5 – $1,000</Text>
          </View>

          <View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SP.xs }}>
              <Text style={[styles.sliderMin, { color: colors.subtle }]}>{DURATION_MIN_DAYS} day</Text>
              <Text style={[styles.sliderCurrent, { color: colors.foreground }]}>{durationDays} day{durationDays !== 1 ? 's' : ''}</Text>
              <Text style={[styles.sliderMax, { color: colors.subtle }]}>{DURATION_MAX_DAYS} days</Text>
            </View>
            <InlineSlider
              value={durationDays}
              min={DURATION_MIN_DAYS}
              max={DURATION_MAX_DAYS}
              step={1}
              onChange={setDurationDays}
              accessibilityLabel="Campaign duration"
              accentColor={theme.accentLight}
              trackColor={colors.border}
            />
            <Text style={[styles.sliderHint, { color: colors.subtle }]}>1 to 30 days</Text>
          </View>

          <View style={[styles.reachCard, { backgroundColor: colors.success + '14', borderColor: colors.success }]} testID="estimated-reach">
            <Feather name="trending-up" size={16} color={colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.reachLabel, { color: colors.success }]}>Estimated reach</Text>
              <Text style={[styles.reachRange, { color: colors.foreground }]}>{reach.low.toLocaleString()}–{reach.high.toLocaleString()} people</Text>
              <Text style={[styles.reachDisclaimer, { color: colors.mutedForeground }]}>
                Estimate only — based on your budget. Not a guarantee of delivered impressions.
              </Text>
            </View>
          </View>
        </Section>
      </ScrollView>

      {/* 7 — Sticky Launch button */}
      <View style={[styles.stickyBottom, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 0) + SP.md, flexDirection: 'column', gap: SP.sm }]}>
        {/* Alternate entry point: run a real ad on Meta's own platform instead of
            Brandthread's in-house boost above. Carries over whatever CTA
            destination is already selected here, mapped the same way the
            "Launch" flow does via CTA_OPTIONS' destinationKind. */}
        <TouchableOpacity
          style={[styles.metaAdsLink, { borderColor: colors.border }]}
          onPress={() => {
            const kind = selectedCta?.destinationKind === 'product' ? 'product'
              : selectedCta?.destinationKind === 'store' ? 'store'
              : undefined;
            router.push({
              pathname: '/meta-ads-setup',
              params: kind ? { promoteKind: kind, ...(ctaDestId ? { promoteRefId: ctaDestId } : {}) } : {},
            } as never);
          }}
          accessibilityRole="button"
          accessibilityLabel="Run as a Meta ad, Facebook and Instagram"
          testID="run-as-meta-ad-btn"
        >
          <Feather name="facebook" size={14} color={colors.mutedForeground} />
          <Text style={[styles.metaAdsLinkText, { color: colors.mutedForeground }]}>Run as a Meta ad (Facebook & Instagram)</Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row' }}>
          <TouchableOpacity
            style={[styles.primaryBtn, { flex: 1, backgroundColor: theme.accent }, launchDisabled && { opacity: 0.5 }]}
            onPress={handleLaunch}
            disabled={launchDisabled}
            accessibilityRole="button"
            accessibilityLabel={`Launch, ${budgetDollars} dollars`}
            testID="stage-continue-btn"
          >
            {(loading || paying) ? (
              <ActivityIndicator color={theme.onAccent} size="small" />
            ) : (
              <>
                <Feather name="zap" size={18} color={theme.onAccent} />
                <Text style={[styles.primaryBtnText, getOnAccentTextStyle(theme)]}>Launch · ${budgetDollars}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ─── Styles (color-free — theme/palette colors are applied inline above) ────

const styles = StyleSheet.create({
  stageHeading:    { fontSize: FS.xl, fontFamily: FONT.bold, marginBottom: SP.xs },
  stageSub:        { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 20 },
  fieldLabel:      { fontSize: FS.sm, fontFamily: FONT.semibold, marginBottom: SP.xs },
  pickerCard:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, borderRadius: RADIUS.md, borderWidth: 1, paddingVertical: SP.md },
  pickerCardTitle: { fontSize: FS.sm, fontFamily: FONT.semibold },
  infoBox:         { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, borderRadius: RADIUS.md, padding: SP.md, borderWidth: 1 },
  infoBoxText:     { flex: 1, fontSize: FS.xs, fontFamily: FONT.regular, lineHeight: 18 },
  textInputField:  { borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: SP.md, paddingVertical: SP.sm, fontSize: FS.base, fontFamily: FONT.regular, marginTop: SP.xs },
  charCount:       { fontSize: FS.xs, fontFamily: FONT.regular, alignSelf: 'flex-end', marginTop: 2 },
  textArea:        { borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: SP.md, paddingVertical: SP.sm, fontSize: FS.sm, fontFamily: FONT.regular, minHeight: 70, marginTop: SP.xs },
  ctaChip:         { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADIUS.pill, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9 },
  ctaChipText:     { fontSize: FS.sm, fontFamily: FONT.semibold },
  ctaRadio:        { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  ctaRadioFill:    { width: 9, height: 9, borderRadius: 5 },
  productRow:      { flexDirection: 'row', alignItems: 'center', gap: SP.md, borderRadius: RADIUS.md, borderWidth: 1, padding: SP.md },
  productRowText:  { flex: 1, fontSize: FS.base, fontFamily: FONT.medium },
  sliderMin:       { fontSize: FS.xs, fontFamily: FONT.regular },
  sliderCurrent:   { fontSize: FS.base, fontFamily: FONT.bold },
  sliderMax:       { fontSize: FS.xs, fontFamily: FONT.regular },
  sliderHint:      { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: SP.xs, textAlign: 'center' },
  reachCard:       { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, borderRadius: RADIUS.md, borderWidth: 1, padding: SP.md },
  reachLabel:      { fontSize: FS.sm, fontFamily: FONT.semibold, marginBottom: 2 },
  reachRange:      { fontSize: FS.lg, fontFamily: FONT.bold },
  reachDisclaimer: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 4, lineHeight: 16 },
  stickyBottom:    { borderTopWidth: 1, paddingHorizontal: SP.md, paddingTop: SP.sm },
  metaAdsLink:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: RADIUS.md, paddingVertical: SP.sm },
  metaAdsLinkText: { fontSize: FS.xs, fontFamily: FONT.semibold },
  primaryBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, borderRadius: RADIUS.md, paddingVertical: SP.md, paddingHorizontal: SP.lg, minHeight: 52 },
  primaryBtnText:  { fontSize: FS.base, fontFamily: FONT.bold },
  successIcon:     { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
});
