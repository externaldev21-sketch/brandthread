/**
 * Paid Promotion / Boost Flow
 * Route: /boost?id=<uuid>&paymentReturn=1  (Stripe Checkout return)
 *        /boost                             (fresh flow)
 *
 * 3-step flow (mirrors Create Ad UX):
 *   Step 1 — Post picker: choose one published video or slideshow (2+ images)
 *   Step 2 — Budget & duration: slider-only, same UX as Create Ad
 *   Step 3 — Payment: Stripe Checkout hosted page; verify via /pay/verify
 *
 * Payment lifecycle (identical to design-campaign.tsx):
 *   1. User taps "Boost post · $X" → POST /api/boosts (creates pending_payment record)
 *   2. POST /api/boosts/:id/pay   → get Checkout Session url
 *   3. WebBrowser.openAuthSessionAsync(url, returnUrl)
 *   4. Browser returns → POST /api/boosts/:id/pay/verify → activates idempotently
 *   5. Show success only after verified boost.status === 'active'
 *   6. Cancel/failed → retryable; boost stays pending_payment
 *
 * The objective field is always persisted as 'views' for schema compatibility.
 * The objective step is removed from the UI per the redesign contract.
 *
 * Selected post, budget, and duration are preserved across browser return.
 */
import React, {
  useState, useCallback, useRef, useMemo, useEffect,
} from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, PanResponder, LayoutChangeEvent,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { useApi } from '@/hooks/useApi';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  BG, CARD, CARD_ELEVATED, BORDER, FG, MUTED, SUBTLE,
  PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  SUCCESS, SUCCESS_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD,
  FONT, FS, SP, RADIUS, ICON, SHADOW_SM,
} from '@/lib/theme';
import { divideCents, formatCents } from '@/lib/money';
import {
  BOOST_BUDGET_STEPS,
  BOOST_BUDGET_MIN_CENTS,
  BOOST_BUDGET_MAX_CENTS,
  BOOST_DURATION_MIN_DAYS,
  BOOST_DURATION_MAX_DAYS,
  estimateBoostReach,
  buildBoostReturnUrl,
} from '@/services/boostService';
import { isSellerDevPreview } from '@/lib/devPreview';
import { Header } from '@/components/layout';
import { Button } from '@/components/ui/Button';

// ─── Types ────────────────────────────────────────────────────────────────────

type BoostTarget = {
  id: string;
  mediaUrl: string | null;
  mediaType: string | null;
  mediaUrls: string[] | null;
  mediaPaths: string[] | null;
  caption: string | null;
  createdAt: string;
  /** 'video' | 'slideshow' */
  mediaKind: 'video' | 'slideshow';
  imageCount: number | null;
};

type Boost = {
  id: string;
  status: string;
  budgetCents: number;
  spentCents: number;
  impressionsCount: number;
  durationDays: number;
  startsAt?: string | null;
  endsAt: string;
  estimatedReachLow: number;
  estimatedReachHigh: number;
  estimatedImpressions: number;
  paid?: boolean;
  paidAt?: string | null;
};

type Summary = {
  totalImpressions: number;
  spentCentsThisMonth: number;
  activeCount: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysRemaining(endsAt: string): number {
  const ms = new Date(endsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

function statusColor(s: string): string {
  if (s === 'active')           return SUCCESS;
  if (s === 'paused')           return ORANGE;
  if (s === 'completed')        return MUTED;
  if (s === 'cancelled')        return RED;
  if (s === 'failed')           return RED;
  if (s === 'pending_payment')  return ORANGE;
  return MUTED;
}

function statusBg(s: string): string {
  if (s === 'active')           return SUCCESS_DIM;
  if (s === 'paused')           return ORANGE_DIM;
  if (s === 'cancelled')        return RED_DIM;
  if (s === 'failed')           return RED_DIM;
  if (s === 'pending_payment')  return ORANGE_DIM;
  return 'rgba(255,255,255,0.05)';
}

function statusLabel(s: string): string {
  if (s === 'pending_payment') return 'Pending payment';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function reachProgress(b: Boost): number {
  const est = b.estimatedReachLow > 0 ? b.estimatedReachLow : b.estimatedImpressions;
  if (!est || est <= 0) return 0;
  return Math.min(1, b.impressionsCount / est);
}

// ─── Slider primitives ────────────────────────────────────────────────────────

function SnapSlider({
  value, min, max, step, onChange, accessibilityLabel,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  accessibilityLabel: string;
}) {
  const widthRef = useRef(1);

  const snap = useCallback((raw: number) => {
    const clamped = Math.max(min, Math.min(max, raw));
    return Math.round((clamped - min) / step) * step + min;
  }, [max, min, step]);

  const updateFromX = useCallback((x: number) => {
    onChange(snap(min + (Math.max(0, Math.min(widthRef.current, x)) / widthRef.current) * (max - min)));
  }, [max, min, onChange, snap]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder:  () => true,
    onPanResponderGrant:          () => { Haptics.selectionAsync(); },
    onPanResponderMove:           (_e, g) => {
      onChange(snap(value + (g.dx / widthRef.current) * (max - min)));
    },
  }), [max, min, onChange, snap, value]);

  const fraction = (value - min) / (max - min);

  return (
    <View
      style={ss.sliderTouch}
      onLayout={(e: LayoutChangeEvent) => { widthRef.current = Math.max(1, e.nativeEvent.layout.width); }}
      onTouchEnd={(e) => updateFromX(e.nativeEvent.locationX)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        onChange(snap(value + (e.nativeEvent.actionName === 'increment' ? step : -step)));
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

function BudgetStepSlider({
  value, onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const widthRef = useRef(1);
  const steps = BOOST_BUDGET_STEPS;

  const indexFromX = useCallback((x: number) => {
    const fraction = Math.max(0, Math.min(1, x / widthRef.current));
    return Math.min(steps.length - 1, Math.round(fraction * (steps.length - 1)));
  }, [steps.length]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder:  () => true,
    onPanResponderGrant:          () => { Haptics.selectionAsync(); },
    onPanResponderMove:           (_e, g) => {
      const currentIdx = steps.indexOf(value as typeof steps[number]);
      const startX = currentIdx === -1
        ? widthRef.current / 2
        : (currentIdx / (steps.length - 1)) * widthRef.current;
      const newIdx = indexFromX(startX + g.dx);
      onChange(steps[newIdx]);
    },
  }), [steps, value, indexFromX, onChange]);

  const currentIdx = steps.indexOf(value as typeof steps[number]);
  const safeIdx = currentIdx === -1 ? 0 : currentIdx;
  const fraction = safeIdx / (steps.length - 1);

  return (
    <View
      style={ss.sliderTouch}
      onLayout={(e: LayoutChangeEvent) => { widthRef.current = Math.max(1, e.nativeEvent.layout.width); }}
      onTouchEnd={(e) => {
        const idx = indexFromX(e.nativeEvent.locationX);
        onChange(steps[idx]);
        Haptics.selectionAsync();
      }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Promotion budget"
      accessibilityValue={{ min: BOOST_BUDGET_MIN_CENTS, max: BOOST_BUDGET_MAX_CENTS, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const idx = steps.indexOf(value as typeof steps[number]);
        const safeI = idx === -1 ? 0 : idx;
        if (e.nativeEvent.actionName === 'increment') onChange(steps[Math.min(steps.length - 1, safeI + 1)]);
        else onChange(steps[Math.max(0, safeI - 1)]);
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

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepDots({ total, current }: { total: number; current: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, justifyContent: 'center', marginBottom: SP.md }}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={{
            width: i === current ? 18 : 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: i <= current ? PURPLE_LIGHT : SUBTLE,
          }}
        />
      ))}
    </View>
  );
}

// ─── Post thumbnail ───────────────────────────────────────────────────────────

function PostThumbnail({ target }: { target: BoostTarget }) {
  const thumbnailUrl = target.mediaUrls?.[0] ?? target.mediaUrl;

  if (!thumbnailUrl) {
    return (
      <View style={tc.fallback}>
        <Feather name="film" size={22} color={MUTED} />
      </View>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <Image source={{ uri: thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
      <View style={tc.badgeRow}>
        {target.mediaKind === 'video' ? (
          <View style={tc.badge}>
            <Feather name="play" size={8} color="#fff" />
            <Text style={tc.badgeText}>Video</Text>
          </View>
        ) : (
          <View style={tc.badge}>
            <Feather name="grid" size={8} color="#fff" />
            <Text style={tc.badgeText}>Slideshow</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const tc = StyleSheet.create({
  fallback: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CARD_ELEVATED,
  },
  badgeRow: {
    position: 'absolute',
    top: 6,
    left: 6,
    flexDirection: 'row',
    gap: 4,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  badgeText: {
    color: '#fff',
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
  },
});

// ─── Dev preview fallback targets ────────────────────────────────────────────
// Shown only when isSellerDevPreview() is true AND the real API returns 401/error.
// No fake business metrics — just clearly-labeled placeholders for UI review.

const PREVIEW_BOOST_TARGETS: BoostTarget[] = [
  {
    id:         'preview-video-1',
    mediaUrl:   null,
    mediaType:  'video',
    mediaUrls:  null,
    mediaPaths: null,
    caption:    'Preview — Video post (eligible)',
    createdAt:  new Date(Date.now() - 86_400_000).toISOString(),
    mediaKind:  'video',
    imageCount: null,
  },
  {
    id:         'preview-slideshow-2',
    mediaUrl:   null,
    mediaType:  'image',
    mediaUrls:  null,
    mediaPaths: null,
    caption:    'Preview — Slideshow (2 images, eligible)',
    createdAt:  new Date(Date.now() - 2 * 86_400_000).toISOString(),
    mediaKind:  'slideshow',
    imageCount: 2,
  },
  {
    id:         'preview-slideshow-3',
    mediaUrl:   null,
    mediaType:  'image',
    mediaUrls:  null,
    mediaPaths: null,
    caption:    'Preview — Slideshow (4 images, eligible)',
    createdAt:  new Date(Date.now() - 3 * 86_400_000).toISOString(),
    mediaKind:  'slideshow',
    imageCount: 4,
  },
];

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 3; // Step 1: picker, Step 2: budget, Step 3: payment/success
// Steps are 0-indexed for StepDots: 0=picker, 1=budget, 2=paying (not shown as step dot)

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function BoostScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const api     = useApi();
  const params  = useLocalSearchParams<{ id?: string; paymentReturn?: string; bt_preview?: string }>();

  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 0) + 90;
  const inSellerPreview = isSellerDevPreview(
    params.bt_preview === 'buyer' ? '?bt_preview=buyer' : '?bt_preview=seller',
  );

  // ── State ─────────────────────────────────────────────────────────────────

  const [step,             setStep]             = useState<0 | 1 | 2>(0);
  const [selectedTarget,   setSelectedTarget]   = useState<BoostTarget | null>(null);
  const [targets,          setTargets]          = useState<BoostTarget[]>(
    inSellerPreview ? PREVIEW_BOOST_TARGETS : [],
  );
  const [loadingTargets,   setLoadingTargets]   = useState(!inSellerPreview);
  const [targetsError,     setTargetsError]     = useState(false);
  const [budgetCents,      setBudgetCents]      = useState(2500);
  const [durationDays,     setDurationDays]     = useState(7);

  // Pending boost record (created before Checkout)
  const [pendingBoost,     setPendingBoost]     = useState<Boost | null>(null);

  // Payment flow state
  const [creating,         setCreating]         = useState(false);
  const [paying,           setPaying]           = useState(false);
  const [verifying,        setVerifying]        = useState(false);
  const [succeeded,        setSucceeded]        = useState(false);
  const [activeBoost,      setActiveBoost]      = useState<Boost | null>(null);

  // History
  const [existing,         setExisting]         = useState<Boost[]>([]);
  const [loadingExisting,  setLoadingExisting]  = useState(!inSellerPreview);
  const [summary,          setSummary]          = useState<Summary | null>(
    inSellerPreview
      ? { totalImpressions: 0, spentCentsThisMonth: 0, activeCount: 0 }
      : null,
  );
  const [pausingId,        setPausingId]        = useState<string | null>(null);

  // Prevent double-handling the paymentReturn redirect
  const paymentReturnConsumed = useRef(false);

  const reach = useMemo(() => estimateBoostReach(budgetCents), [budgetCents]);

  // ── Data loading ─────────────────────────────────────────────────────────
  //
  // Root cause of the spinner loop: useCallback([api, ...]) + useFocusEffect
  // creates a new callback every time the api object identity changes (Clerk
  // may allocate a fresh object on userId fluctuations in the dev web preview
  // where there is no real session). useFocusEffect re-registers whenever its
  // callback reference changes, firing another load cycle that keeps loading
  // state permanently true while the screen is focused.
  //
  // Fix: store the API methods in a ref so the functions passed to useCallback
  // and useFocusEffect have NO reactive dependencies on the api object. The ref
  // is updated every render so calls always use the freshest token without
  // causing the callbacks themselves to be recreated.

  // Keep the latest api.boosts methods in a ref — updated every render,
  // read inside stable callbacks so they never go stale.
  const boostsRef = useRef(api.boosts);
  boostsRef.current = api.boosts;

  const inSellerPreviewRef = useRef(inSellerPreview);
  inSellerPreviewRef.current = inSellerPreview;

  // Direct Expo web navigation can render before a focus event is delivered.
  // Seed preview state explicitly so the screen never remains on its initial
  // loading flags while waiting for authenticated API calls it cannot make.
  useEffect(() => {
    if (!inSellerPreview) return;
    setTargets(PREVIEW_BOOST_TARGETS);
    setTargetsError(false);
    setLoadingTargets(false);
    setExisting([]);
    setLoadingExisting(false);
    setSummary({
      totalImpressions: 0,
      spentCentsThisMonth: 0,
      activeCount: 0,
    });
  }, [inSellerPreview]);

  const loadTargets = useCallback(async () => {
    setLoadingTargets(true);
    setTargetsError(false);
    try {
      const rows = await boostsRef.current.targets();
      setTargets((rows ?? []) as BoostTarget[]);
    } catch (e: any) {
      const status = e?.status ?? e?.response?.status;
      const is401  = status === 401 || String(e?.message ?? '').includes('401');
      if (inSellerPreviewRef.current) {
        // Dev web preview: 401 is expected (no token). Show labeled placeholders
        // so the post picker and budget/duration steps can be reviewed.
        // Any other error in preview also falls back to placeholders.
        setTargets(PREVIEW_BOOST_TARGETS);
        setTargetsError(false);
      } else {
        // Production / native / buyer preview: preserve real error state.
        // Show a clear auth message for 401 rather than a generic connection error.
        setTargetsError(true);
        setTargets([]);
        // Suppress the unused-variable warning — is401 is referenced here for
        // future per-code branching if needed.
        void is401;
      }
    } finally {
      setLoadingTargets(false);
    }
  // Stable: no deps — boostsRef and inSellerPreviewRef are refs, not reactive values.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadHistory = useCallback(async () => {
    setLoadingExisting(true);
    try {
      const rows = await boostsRef.current.list();
      setExisting((rows ?? []) as Boost[]);
    } catch {
      // In preview, 401 is expected — honest empty history (no fake data).
      setExisting([]);
    } finally {
      setLoadingExisting(false);
    }
  // Stable: no deps — boostsRef is a ref, not a reactive value.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // useFocusEffect callback has no reactive deps — loadTargets and loadHistory
  // are stable (empty dep arrays), and boostsRef.current is read at call time.
  // This guarantees focus fires exactly once per navigation focus event,
  // regardless of how many times useApi() returns a newly-allocated facade.
  useFocusEffect(useCallback(() => {
    if (inSellerPreviewRef.current) {
      setTargets(PREVIEW_BOOST_TARGETS);
      setTargetsError(false);
      setLoadingTargets(false);
      setExisting([]);
      setLoadingExisting(false);
      setSummary({
        totalImpressions: 0,
        spentCentsThisMonth: 0,
        activeCount: 0,
      });
      return;
    }
    loadTargets();
    loadHistory();
    boostsRef.current.summary()
      .then((s) => setSummary(s))
      .catch(() => setSummary(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  // ── Handle Checkout redirect return ──────────────────────────────────────

  useEffect(() => {
    if (params.paymentReturn !== '1' || !params.id || paymentReturnConsumed.current) return;
    paymentReturnConsumed.current = true;
    router.setParams({ paymentReturn: undefined } as never);
    void verifyPayment(params.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.paymentReturn, params.id]);

  // ── Verify payment (called after browser redirect) ────────────────────────

  const verifyPayment = useCallback(async (boostId: string) => {
    setVerifying(true);
    try {
      const result = await boostsRef.current.verify(boostId);
      const boost = result as Boost;
      if (boost.status === 'active') {
        setActiveBoost(boost);
        setSucceeded(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        loadHistory();
        boostsRef.current.summary().then((s) => setSummary(s)).catch(() => {});
      } else if (boost.status === 'pending_payment') {
        setPendingBoost(boost);
        Alert.alert(
          'Payment pending',
          "Your payment is being processed. We'll activate your boost automatically once confirmed.",
          [{ text: 'OK' }],
        );
      } else if (boost.status === 'failed') {
        setPendingBoost(boost);
        Alert.alert(
          'Payment failed',
          'Your payment could not be processed. Tap "Boost post" to try again.',
          [{ text: 'OK' }],
        );
      }
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      if (msg.includes('unpaid') || msg.includes('402')) {
        Alert.alert('Checkout cancelled', 'Your payment was not completed. You can try again.', [{ text: 'OK' }]);
      } else {
        Alert.alert('Verification failed', 'Could not confirm payment. Please check your boost status.', [{ text: 'OK' }]);
      }
    } finally {
      setVerifying(false);
    }
  // boostsRef is a ref — not reactive. loadHistory is stable (empty dep array).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadHistory]);

  // ── Navigation ────────────────────────────────────────────────────────────

  function goBack() {
    if (step === 0) { goBackOr(router); return; }
    setStep((s) => (s - 1) as 0 | 1 | 2);
    Haptics.selectionAsync();
  }

  function selectTarget(target: BoostTarget) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedTarget(target);
    setStep(1);
  }

  // ── Payment flow ──────────────────────────────────────────────────────────

  async function handleBoostPost() {
    if (!selectedTarget) {
      Alert.alert('Choose a post', 'Select the post you want to boost first.');
      return;
    }

    // Dev seller preview: never create a real boost or initiate payment.
    // Show an honest message so reviewers understand real checkout requires auth.
    if (inSellerPreview) {
      Alert.alert(
        'Preview mode',
        'Checkout requires a real seller account.\n\nSign in to a Brandthread seller account to test live payment.',
        [{ text: 'OK' }],
      );
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Step 1: Create pending boost (no charge yet)
    let boostRecord = pendingBoost;
    if (!boostRecord || boostRecord.status === 'failed') {
      setCreating(true);
      try {
        const created = await boostsRef.current.create({
          targetType:  'post',
          targetId:    selectedTarget.id,
          objective:   'views',
          budgetCents,
          durationDays,
        });
        boostRecord = created as Boost;
        setPendingBoost(boostRecord);
      } catch (e: any) {
        const msg = e?.message ?? '';
        const body = (() => { try { return JSON.parse(msg); } catch { return null; } })();
        Alert.alert('Error', body?.error ?? 'Could not create boost. Please try again.');
        return;
      } finally {
        setCreating(false);
      }
    }

    if (!boostRecord) return;

    // Step 2: Create Checkout Session and open browser
    setPaying(true);
    try {
      const returnUrl = buildBoostReturnUrl(boostRecord.id);
      const { url, paymentStatus } = await boostsRef.current.pay(boostRecord.id, returnUrl);

      // Already paid (reused session that was completed)
      if (paymentStatus === 'paid' || paymentStatus === 'no_payment_required') {
        await verifyPayment(boostRecord.id);
        return;
      }

      if (!url) {
        Alert.alert('Error', 'Could not start checkout. Please try again.');
        return;
      }

      const result = await WebBrowser.openAuthSessionAsync(url, returnUrl);

      if (result.type === 'success') {
        await verifyPayment(boostRecord.id);
        return;
      }
      if (result.type === 'cancel' || result.type === 'dismiss') {
        Alert.alert(
          'Checkout cancelled',
          'Your payment was not completed. Your boost is saved and you can try again.',
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
        msg.includes('422') || msg.includes('ineligible')
          ? 'This post is no longer eligible for boosting. Please choose another post.'
          : 'Could not start checkout. Please try again.',
        [{ text: 'OK' }],
      );
    } finally {
      setPaying(false);
    }
  }

  async function handlePause(boost: Boost) {
    const isActive = boost.status === 'active';
    const newStatus = isActive ? 'paused' : 'cancelled';
    const title     = isActive ? 'Pause Boost' : 'Cancel Boost';
    const message   = isActive
      ? 'Pause this boost? You can reactivate it later by contacting support.'
      : 'Are you sure you want to cancel this boost? This cannot be undone.';

    Alert.alert(title, message, [
      { text: 'Keep Running', style: 'cancel' },
      {
        text: title,
        style: 'destructive',
        onPress: async () => {
          setPausingId(boost.id);
          try {
            await boostsRef.current.update(boost.id, { status: newStatus as 'paused' | 'cancelled' });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setExisting((prev) =>
              prev.map((b) => b.id === boost.id ? { ...b, status: newStatus } : b),
            );
          } catch {
            Alert.alert('Error', 'Could not update the boost. Please try again.');
          } finally {
            setPausingId(null);
          }
        },
      },
    ]);
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  function renderHeader(title: string) {
    return (
      <Header
        title={title}
        onBack={goBack}
        actions={[{ icon: 'x', onPress: () => goBackOr(router), accessibilityLabel: 'Close' }]}
      />
    );
  }

  function renderSelectedTargetBanner() {
    if (!selectedTarget) return null;
    const thumbnailUrl = selectedTarget.mediaUrls?.[0] ?? selectedTarget.mediaUrl;
    return (
      <View style={s.targetBanner}>
        <View style={s.targetThumb}>
          {thumbnailUrl ? (
            <Image source={{ uri: thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: CARD_ELEVATED }]}>
              <Feather name="film" size={ICON.xs} color={MUTED} />
            </View>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.targetBannerCaption} numberOfLines={1}>
            {selectedTarget.caption || 'Untitled post'}
          </Text>
          <Text style={s.targetBannerMeta}>
            {selectedTarget.mediaKind === 'video' ? 'Video' : `Slideshow · ${selectedTarget.imageCount ?? ''} images`}
            {' · '}
            {new Date(selectedTarget.createdAt).toLocaleDateString()}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => { setSelectedTarget(null); setStep(0); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Change post"
        >
          <Text style={{ color: PURPLE_LIGHT, fontFamily: FONT.semibold, fontSize: FS.sm }}>Change</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Summary card ─────────────────────────────────────────────────────────

  function renderSummaryCard() {
    if (!summary) return null;
    return (
      <View style={s.summaryCard}>
        <View style={s.summaryItem}>
          <Text style={s.summaryValue}>{summary.activeCount}</Text>
          <Text style={s.summaryLabel}>Active boosts</Text>
        </View>
        <View style={s.summaryDivider} />
        <View style={s.summaryItem}>
          <Text style={s.summaryValue}>{formatCents(summary.spentCentsThisMonth)}</Text>
          <Text style={s.summaryLabel}>Spent this month</Text>
        </View>
        <View style={s.summaryDivider} />
        <View style={s.summaryItem}>
          <Text style={s.summaryValue}>{summary.totalImpressions.toLocaleString()}</Text>
          <Text style={s.summaryLabel}>Total impressions</Text>
        </View>
      </View>
    );
  }

  // ── History section ───────────────────────────────────────────────────────

  function renderHistory() {
    if (loadingExisting) {
      return (
        <View style={s.centeredState}>
          <ActivityIndicator color={PURPLE_LIGHT} />
        </View>
      );
    }

    const boosts = existing.filter((b) => b.status !== 'pending_payment' || b.paidAt == null);
    if (boosts.length === 0) return null;

    return (
      <View style={{ marginTop: SP.xl }}>
        <Text style={s.sectionHeading}>Past Boosts</Text>
        {boosts.map((b) => (
          <View key={b.id} style={s.historyCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm }}>
              <View style={[s.statusBadge, { backgroundColor: statusBg(b.status) }]}>
                <Text style={[s.statusBadgeText, { color: statusColor(b.status) }]}>
                  {statusLabel(b.status)}
                </Text>
              </View>
              <Text style={s.historyMeta}>
                {formatCents(b.budgetCents)} · {b.durationDays}d
              </Text>
            </View>

            {/* Reach progress */}
            <View style={{ marginBottom: SP.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={s.historyMetaSmall}>Estimated reach</Text>
                <Text style={s.historyMetaSmall}>
                  {b.impressionsCount.toLocaleString()} / {(b.estimatedReachLow || b.estimatedImpressions).toLocaleString()}
                </Text>
              </View>
              <View style={s.progressTrack}>
                <View style={[s.progressFill, { width: `${reachProgress(b) * 100}%` as any }]} />
              </View>
            </View>

            {b.status === 'active' && b.endsAt && (
              <Text style={s.historyMetaSmall}>
                {daysRemaining(b.endsAt)} day{daysRemaining(b.endsAt) !== 1 ? 's' : ''} remaining
              </Text>
            )}

            {(b.status === 'active' || b.status === 'paused') && (
              <TouchableOpacity
                style={s.pauseBtn}
                onPress={() => handlePause(b)}
                disabled={pausingId === b.id}
                accessibilityRole="button"
              >
                {pausingId === b.id ? (
                  <ActivityIndicator size="small" color={MUTED} />
                ) : (
                  <Text style={s.pauseBtnText}>
                    {b.status === 'active' ? 'Pause' : 'Cancel'}
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        ))}
      </View>
    );
  }

  // ── Step 1: Post picker ───────────────────────────────────────────────────

  function renderPicker() {
    return (
      <View style={{ flex: 1 }}>
        {renderHeader('Promote')}
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: SP.md, paddingBottom: bottomPad }}
        >
          {renderSummaryCard()}

          <Text style={s.stepHeading}>Choose a post to promote</Text>
          <Text style={s.stepSub}>
            Only your published videos and slideshows (2+ images) are eligible.
          </Text>

          {loadingTargets ? (
            <View style={s.centeredState}>
              <ActivityIndicator color={PURPLE_LIGHT} size="large" />
            </View>
          ) : targetsError ? (
            <View style={s.emptyState}>
              <Feather name="lock" size={ICON.xl} color={MUTED} />
              <Text style={s.emptyTitle}>Sign in to continue</Text>
              <Text style={s.emptyBody}>
                Your session may have expired. Sign in again to load your eligible posts.
              </Text>
              <Button label="Retry" variant="secondary" size="small" onPress={loadTargets} style={s.retryBtn} />
            </View>
          ) : targets.length === 0 ? (
            <View style={s.emptyState}>
              <Feather name="film" size={ICON.xl} color={MUTED} />
              <Text style={s.emptyTitle}>No eligible posts yet</Text>
              <Text style={s.emptyBody}>
                Publish a video or a slideshow with 2+ images, then come back to Promote.
              </Text>
              <Button label="Create a Post" variant="secondary" size="small" onPress={() => router.push('/create-post')} style={s.retryBtn} />
            </View>
          ) : (
            <View style={s.grid}>
              {targets.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={[
                    s.gridTile,
                    selectedTarget?.id === t.id && s.gridTileSelected,
                  ]}
                  onPress={() => selectTarget(t)}
                  activeOpacity={0.82}
                  accessibilityRole="button"
                  accessibilityLabel={`Promote ${t.caption || 'post'}`}
                  testID={`boost-target-${t.id}`}
                >
                  <PostThumbnail target={t} />
                  <View style={s.gridScrim} />
                  <Text style={s.gridCaption} numberOfLines={2}>
                    {t.caption || 'Untitled'}
                  </Text>
                  {selectedTarget?.id === t.id && (
                    <View style={s.gridCheck}>
                      <Feather name="check" size={12} color="#fff" />
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {renderHistory()}
        </ScrollView>
      </View>
    );
  }

  // ── Step 2: Budget & duration ─────────────────────────────────────────────

  function renderBudget() {
    const dailyCents = divideCents(budgetCents, durationDays);
    const isLoading  = creating || paying || verifying;

    return (
      <View style={{ flex: 1 }}>
        {renderHeader('Boost')}
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: SP.md, paddingBottom: bottomPad }}
        >
          <StepDots total={2} current={1} />
          {renderSelectedTargetBanner()}

          {/* Budget */}
          <View style={s.sliderCard}>
            <View style={s.sliderCardHeader}>
              <Text style={s.sliderCardLabel}>Budget</Text>
              <Text style={s.sliderCardValue}>{formatCents(budgetCents)}</Text>
            </View>
            <BudgetStepSlider value={budgetCents} onChange={setBudgetCents} />
            <View style={s.sliderCardFooter}>
              <Text style={s.sliderCardHint}>{formatCents(BOOST_BUDGET_MIN_CENTS)}</Text>
              <Text style={s.sliderCardHint}>{formatCents(BOOST_BUDGET_MAX_CENTS)}</Text>
            </View>
          </View>

          {/* Duration */}
          <View style={[s.sliderCard, { marginTop: SP.md }]}>
            <View style={s.sliderCardHeader}>
              <Text style={s.sliderCardLabel}>Duration</Text>
              <Text style={s.sliderCardValue}>{durationDays} day{durationDays !== 1 ? 's' : ''}</Text>
            </View>
            <SnapSlider
              value={durationDays}
              min={BOOST_DURATION_MIN_DAYS}
              max={BOOST_DURATION_MAX_DAYS}
              step={1}
              onChange={setDurationDays}
              accessibilityLabel="Promotion duration"
            />
            <View style={s.sliderCardFooter}>
              <Text style={s.sliderCardHint}>{BOOST_DURATION_MIN_DAYS} day</Text>
              <Text style={s.sliderCardHint}>{BOOST_DURATION_MAX_DAYS} days</Text>
            </View>
          </View>

          {/* Estimated reach */}
          <View style={s.reachCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.xs }}>
              <Feather name="users" size={ICON.xs} color={PURPLE_LIGHT} />
              <Text style={s.reachLabel}>Estimated reach</Text>
            </View>
            <Text style={s.reachValue}>
              {reach.low.toLocaleString()}–{reach.high.toLocaleString()} people
            </Text>
            <Text style={s.reachDailyBudget}>
              {formatCents(dailyCents)}/day · {formatCents(budgetCents)} total
            </Text>
            <Text style={s.reachDisclaimer}>
              Estimated reach is a planning aid based on your budget and is not a guarantee
              of impressions delivered.
            </Text>
          </View>
        </ScrollView>

        {/* Sticky bottom CTA — matches Create Ad "Create ad · $X" pattern */}
        <View style={[s.stickyBottom, { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 16) }]}>
          <TouchableOpacity
            style={[s.primaryBtn, isLoading && { opacity: 0.65 }]}
            onPress={handleBoostPost}
            disabled={isLoading}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Boost post · ${formatCents(budgetCents)}`}
            testID="boost-pay-btn"
          >
            {isLoading ? (
              <ActivityIndicator color="#000" size="small" />
            ) : (
              <>
                <Text style={s.primaryBtnText}>Boost post · {formatCents(budgetCents)}</Text>
                <Feather name="zap" size={ICON.sm} color="#000" />
              </>
            )}
          </TouchableOpacity>
          <Text style={s.paymentNote}>
            Secure payment via Stripe. You'll be redirected to complete payment.
          </Text>
        </View>
      </View>
    );
  }

  // ── Success screen ────────────────────────────────────────────────────────

  function renderSuccess() {
    const b = activeBoost;
    return (
      <View style={{ flex: 1 }}>
        {renderHeader('Promote')}
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: SP.md, paddingBottom: bottomPad, alignItems: 'center' }}
        >
          <View style={s.successIcon}>
            <Feather name="zap" size={32} color={GOLD} />
          </View>
          <Text style={s.successTitle}>Boost active!</Text>
          <Text style={s.successSub}>
            Your post is now being promoted. Check back to see how it's performing.
          </Text>

          {b && (
            <View style={[s.sliderCard, { marginTop: SP.lg, width: '100%' }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SP.sm }}>
                <Text style={s.sliderCardLabel}>Budget</Text>
                <Text style={s.sliderCardValue}>{formatCents(b.budgetCents)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SP.sm }}>
                <Text style={s.sliderCardLabel}>Duration</Text>
                <Text style={s.sliderCardValue}>{b.durationDays} days</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={s.sliderCardLabel}>Estimated reach</Text>
                <Text style={s.sliderCardValue}>
                  {(b.estimatedReachLow || 0).toLocaleString()}–{(b.estimatedReachHigh || 0).toLocaleString()}
                </Text>
              </View>
            </View>
          )}

          <Button label="Done" variant="primary" fullWidth style={{ marginTop: SP.xl }} onPress={() => goBackOr(router)} />
        </ScrollView>
      </View>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (verifying) {
    return (
      <View style={[s.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={PURPLE_LIGHT} size="large" />
        <Text style={[s.stepSub, { marginTop: SP.md, textAlign: 'center' }]}>
          Confirming payment…
        </Text>
      </View>
    );
  }

  if (succeeded) {
    return <View style={s.screen}>{renderSuccess()}</View>;
  }

  if (step === 1) {
    return <View style={s.screen}>{renderBudget()}</View>;
  }

  return <View style={s.screen}>{renderPicker()}</View>;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  // Summary card
  summaryCard: {
    flexDirection: 'row',
    backgroundColor: CARD,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.md,
    marginBottom: SP.lg,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryValue: { fontFamily: FONT.bold, fontSize: FS.lg, color: FG, marginBottom: 2 },
  summaryLabel: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED },
  summaryDivider: { width: 1, backgroundColor: BORDER },

  // Step headings
  stepHeading: { fontFamily: FONT.bold, fontSize: FS.xl, color: FG, marginBottom: SP.xs },
  stepSub:     { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, marginBottom: SP.lg, lineHeight: 20 },

  // Post grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  gridTile: {
    width: '31%',
    aspectRatio: 0.75,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    backgroundColor: CARD,
    borderWidth: 2,
    borderColor: 'transparent',
    position: 'relative',
  },
  gridTileSelected: { borderColor: PURPLE_LIGHT },
  gridScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  gridCaption: {
    position: 'absolute',
    bottom: 6,
    left: 4,
    right: 4,
    fontFamily: FONT.semibold,
    fontSize: FS.xs,
    color: '#fff',
    lineHeight: 14,
  },
  gridCheck: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: PURPLE_LIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Empty / error states
  centeredState: { alignItems: 'center', justifyContent: 'center', paddingVertical: SP.xl },
  emptyState:    { alignItems: 'center', paddingVertical: SP.xl * 1.5, gap: SP.sm },
  emptyTitle:    { fontFamily: FONT.semibold, fontSize: FS.md, color: FG },
  emptyBody:     { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, textAlign: 'center', lineHeight: 20 },
  retryBtn:      { marginTop: SP.sm },

  // Selected target banner
  targetBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.sm,
    marginBottom: SP.lg,
  },
  targetThumb: {
    width: 44,
    height: 56,
    borderRadius: RADIUS.sm,
    overflow: 'hidden',
    backgroundColor: CARD_ELEVATED,
    position: 'relative',
  },
  targetBannerCaption: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG, marginBottom: 2 },
  targetBannerMeta:    { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED },

  // Slider card
  sliderCard: {
    backgroundColor: CARD,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.md,
  },
  sliderCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP.sm },
  sliderCardLabel:  { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED },
  sliderCardValue:  { fontFamily: FONT.bold, fontSize: FS.lg, color: FG },
  sliderCardFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: SP.xs },
  sliderCardHint:   { fontFamily: FONT.regular, fontSize: FS.xs, color: SUBTLE },

  // Reach estimate card
  reachCard: {
    backgroundColor: PURPLE_DIM,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: PURPLE_LIGHT + '30',
    padding: SP.md,
    marginTop: SP.md,
  },
  reachLabel:       { fontFamily: FONT.medium, fontSize: FS.sm, color: PURPLE_LIGHT },
  reachValue:       { fontFamily: FONT.bold, fontSize: FS.xl, color: FG, marginBottom: 2 },
  reachDailyBudget: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, marginBottom: SP.sm },
  reachDisclaimer:  { fontFamily: FONT.regular, fontSize: FS.xs, color: SUBTLE, lineHeight: 16 },

  // Sticky bottom
  stickyBottom: {
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
    backgroundColor: BG,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
    backgroundColor: PURPLE_LIGHT,
    borderRadius: RADIUS.pill,
    paddingVertical: SP.md,
    paddingHorizontal: SP.xl,
    minHeight: 52,
  },
  primaryBtnText: { fontFamily: FONT.bold, fontSize: FS.md, color: '#000' },
  paymentNote:    { fontFamily: FONT.regular, fontSize: FS.xs, color: SUBTLE, textAlign: 'center', marginTop: SP.sm },

  // History
  sectionHeading: { fontFamily: FONT.bold, fontSize: FS.md, color: FG, marginBottom: SP.sm },
  historyCard: {
    backgroundColor: CARD,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.md,
    marginBottom: SP.sm,
  },
  historyMeta:      { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED },
  historyMetaSmall: { fontFamily: FONT.regular, fontSize: FS.xs, color: SUBTLE },
  statusBadge:      { borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 2 },
  statusBadgeText:  { fontFamily: FONT.semibold, fontSize: FS.xs },
  progressTrack:    { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  progressFill:     { height: 4, borderRadius: 2, backgroundColor: PURPLE_LIGHT },
  pauseBtn:         { marginTop: SP.sm, paddingVertical: SP.xs, alignItems: 'center' },
  pauseBtnText:     { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED },

  // Success
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: ORANGE_DIM,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SP.xl,
    marginBottom: SP.lg,
  },
  successTitle: { fontFamily: FONT.bold, fontSize: FS.xl * 1.2, color: FG, marginBottom: SP.sm, textAlign: 'center' },
  successSub:   { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, textAlign: 'center', lineHeight: 20 },
});
