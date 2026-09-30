/**
 * SellerStudioRadialMenu — Seller Control Center
 *
 * Opened from the tab bar's Studio button (accessibilityLabel "Open Studio
 * tools"). Despite the file's historical name (kept so the tab bar's import
 * and the native device-interaction contract test don't need to change),
 * this is now its own FULL-SCREEN PAGE — not a partial sheet — that slides
 * up to cover the whole screen (fast, no bounce) and shows one destination
 * at a time as a full-bleed "cover", edge to edge, with its name and a
 * one-shot signature animation over it. Dev's words: "every icon is its own
 * screen, swipe across and feel boom boom boom."
 *
 * Consolidated down from the prior 4-column grid's ~28 destinations to the
 * ones that have NO other way into them — see MENU_EXCLUDED_IDS below for
 * the removed items and where each one's real entry point now lives.
 *
 * Layout, top to bottom:
 *  - Header (below the notch): the seller's real profile photo + store name
 *    on the left (an initials circle, matching the store name's own first
 *    letter, only when there's no photo yet; a neutral store icon — never a
 *    random letter — when there's no store name either), a compact
 *    unfilled "View store" button, and a close (X) button.
 *  - The card area: the current card's full-bleed cover fills the entire
 *    remaining width/height, edge to edge — a neighbor is visible ONLY
 *    mid-transition (the ~90ms slide between cards), never at rest, per
 *    Dev's own screenshot ("no slivers, no half-words").
 *  - The "Entering page" auto-enter fill button, pinned above the home
 *    indicator.
 *  - A row of small position dots.
 *
 * Interaction:
 *  - A horizontal drag anywhere on the card area SCRUBS through the list —
 *    every SCRUB_PX_PER_CARD (lib/studioCardCarousel.ts) of finger movement
 *    advances exactly one card, either direction, freely reversible. Each
 *    step is a quick ~90ms slide (never a bounce/spring). One strong haptic
 *    tick fires per card change, rate-limited so a very fast scrub still
 *    reads as a clean buzz rather than mush. Each card also plays its own
 *    one-shot signature micro-animation the moment it becomes current — a
 *    tiny 100ms scale-pop while the finger is flying past cards quickly, or
 *    the full ~350-450ms signature motion once the finger slows/dwells (and
 *    again on lock) — see MICRO_KIND below.
 *  - Lifting the finger after a horizontal scrub does NOT navigate
 *    (Dev's own live-testing feedback on the first cut: "too fast /
 *    accident-prone"). It LOCKS on whatever card is currently centered — a
 *    quick snap-to-center, a single firmer "landed" haptic, a subtle white
 *    ring + scale-up, and the "Entering page" button appears and fills
 *    left-to-right over EXACTLY AUTO_ENTER_MS (1.5s), opening the card the
 *    instant it completes. A plain "Cancel" text link shows just above the
 *    pill while it counts down; tapping it stops the fill and swaps the
 *    pill to a static "Continue" (tap it any time to still open). Touching/
 *    scrubbing again cancels either state immediately and continues from
 *    the locked card, arming a fresh countdown once it re-locks; a tap on
 *    the pill or a quick upward flick skips the wait and opens right away.
 *  - A downward drag (anywhere on the card area or the header) or the close
 *    (X) button dismisses the whole page without navigating, sliding it
 *    back down to reveal the screen underneath — the same rubber-band/
 *    velocity-flick feel either way.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  ReduceMotion,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@clerk/expo';
import { SHEET_EASING, SHEET_OPEN_MS, SHEET_CLOSE_MS } from '@/constants/motion';
import { StudioCoverBackdrop, StudioCoverGrain } from '@/components/StudioCardCover';

import PlanUpsellModal from '@/components/PlanUpsellModal';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { GROWTH_PLAN_ENFORCEMENT_ENABLED } from '@/lib/growthTools';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { getSetupState, completionPercent, completedRequiredTaskCount, requiredTaskCount } from '@/lib/setupStore';
import { setNextPushAnimationNone } from '@/lib/navigationAnimationOverride';
import { SCRUB_PX_PER_CARD, indexForDrag } from '@/lib/studioCardCarousel';
import { PressableScale } from '@/components/BrandthreadUI';
import { FirstRunTip } from '@/components/first-run-tips/FirstRunTip';
import { STUDIO_MENU_SCRUB_ROWS } from '@/lib/firstRunTips/content';
import {
  ALL_ITEMS,
  type ControlCenterItem,
} from '@/lib/sellerControlCenter';

export { ALL_ITEMS, SECTIONS, DEFAULT_PINNED_IDS } from '@/lib/sellerControlCenter';

// ─── Menu contents ────────────────────────────────────────────────────────────
// Dev's consolidation pass: the menu should only hold destinations with NO
// other way in. Everything below is EXCLUDED from the carousel because it
// already has a real, generally-visible entry point elsewhere — it stays
// fully reachable, just not from here (same treatment 'brand-memory' and
// 'help' already had):
//   orders          -> tab bar's own Orders tab
//   discounts       -> seller-settings' Discounts row (services/settingsCatalog.ts)
//   products        -> tab bar's own Products tab
//   post-video      -> the seller create FAB's "New post" entry
//   messages        -> the seller Profile tab's own Messages button
//   boost           -> the seller create FAB's "Start a boost" entry
//   store-preview   -> this page's OWN header "View store" button
//   subscription    -> seller-settings' Subscription row
//   store-builder   -> seller-settings' Store Builder row
//   shipping        -> seller-settings' Shipping row (and edit-profile.tsx)
//   team            -> seller-settings' Team and permissions row
//   settings        -> the seller Profile tab's gear icon (and this page's
//                      own header setup-progress bar)
//   help            -> Settings > Help & support (services/settingsCatalog.ts)
//                      — this page's own "?" icon was removed entirely
// Kept regardless (Dev-named, no matter what else is true): go-live,
// analytics, payouts, community, taxes. Kept because nothing else reaches
// them: add-product (the dashboard's own "Add product" CTA is itself part
// of the seller-setup checklist flow, not a standing always-there button —
// Dev's own call to keep this one anyway), content, finance, manufacturer,
// customers, and the six Growth/Design Studio tools (app/(tabs)/studio.tsx
// links to the same six routes but is itself unreachable — href: null in
// the tab bar, and nothing anywhere pushes to it, so it doesn't count as a
// real duplicate entry point).
const MENU_EXCLUDED_IDS = [
  'orders', 'discounts', 'products', 'messages', 'boost',
  'store-preview', 'subscription', 'store-builder', 'shipping', 'team',
  'settings', 'help',
  // Dev: "I want taxes and duties removed... Content can be removed.
  // Finance can be removed" — from THIS menu only; each still has its own
  // normal entry point elsewhere.
  'taxes', 'content', 'finance',
];
// Dev: "Make the create post one the first one" — the menu opens on
// whichever card is CARD_ORDER[0], so post-video (label "Create post")
// leads. The rest keeps its prior most-used-first order.
const CARD_ORDER = [
  'post-video', 'add-product', 'go-live', 'analytics', 'payouts', 'customers', 'community',
  'manufacturer', 'design-studio', 'mockup-to-model', 'remove-bg', 'ai-design', 'campaign-gen', 'ai-photoshoot',
];
const CARD_ITEMS: ControlCenterItem[] = CARD_ORDER
  .map((id) => ALL_ITEMS.find((item) => item.id === id))
  .filter((i): i is ControlCenterItem => !!i);
if (__DEV__) {
  // Catch a rename/typo in CARD_ORDER or MENU_EXCLUDED_IDS immediately in
  // development rather than silently dropping (or double-counting) an item.
  const accounted = new Set([...CARD_ORDER, ...MENU_EXCLUDED_IDS]);
  const missing = ALL_ITEMS.filter((item) => !accounted.has(item.id));
  if (missing.length > 0) {
    console.warn(
      '[SellerStudioRadialMenu] Item(s) not in CARD_ORDER or MENU_EXCLUDED_IDS — ' +
      'unreachable from anywhere until sorted into one of the two: ' +
      missing.map((i) => i.id).join(', '),
    );
  }
}

/** Spread into every FUNCTIONAL timing's withTiming config (the sheet's own
 *  open/close/dismiss slide, the scrub step, the lock snap, the auto-enter
 *  fill) — these govern real interaction feedback and, for the fill
 *  especially, a deliberate real-time "you can still cancel" window, not
 *  pure decoration, so they must keep their actual duration even with
 *  Reduce Motion on (otherwise a reduced-motion user gets the fill
 *  instant-completing on every release — literally the "too fast /
 *  accident-prone" bug this feature exists to fix). Per-card SIGNATURE
 *  micro-animations are the opposite case and do respect Reduce Motion
 *  (see CarouselCard's own reaction, which checks it manually) — Dev's own
 *  spec: "respects Reduce Motion (fade only)". */
const NO_REDUCE_MOTION = { reduceMotion: ReduceMotion.Never } as const;
/** Quick, no-bounce slide between cards on each scrub step or programmatic
 *  settle — matches the "quick 80-100ms slide, no bounce" spec. */
const CARD_STEP_MS = 90;
const CARD_STEP_EASING = Easing.out(Easing.cubic);
/** Minimum real time between two haptic calls, however many card-index
 *  crossings happen in between — keeps a very fast scrub a clean buzz
 *  instead of a mushy blur of overlapping vibrations. */
const MIN_HAPTIC_INTERVAL_MS = 45;
/** How many cards on each side of the current one stay mounted — not for a
 *  peek effect anymore (there is none at rest — see the card/cardSpacing
 *  sizing below), just so a neighbor is already mounted and ready the
 *  instant a fast scrub reaches it, rather than popping in mid-slide. */
const CARD_WINDOW_RADIUS = 2;
/** A scrub step slower than this many ms counts as a "dwell" — its card
 *  plays the FULL signature micro-animation. Faster than this (the finger
 *  flying past several cards) only gets the tiny scale-pop, so a fast scrub
 *  never feels noisy. */
const MICRO_DWELL_MS = 120;

/** Rubber-band resistance for dragging the page up past its resting
 *  position — a diminishing-returns curve (never a hard clamp) that
 *  asymptotically approaches -(dim*c) however far past rest the finger
 *  travels. `value` is always <= 0 here (translateY dragged negative). */
function rubberBandUp(value: number, dim = 100, c = 0.55) {
  'worklet';
  const x = -value;
  return -((x * dim * c) / (dim + c * x));
}

// ─── Per-card signature micro-animations ───────────────────────────────────────
// One short (~350-450ms), one-shot, ease-out motion per cover subject —
// built entirely from transforms/opacity on the existing icon (plus, for
// go-live only, a small extra dot + sweep), never a bespoke illustration or
// a looping/bouncy animation. See CarouselCard's own micro-animation
// reaction for how fast-vs-dwell and Reduce Motion are handled.
type MicroKind =
  | 'swing' | 'pulse-dot' | 'rise' | 'flip' | 'pop-in' | 'rotate-notch'
  | 'slide-click' | 'pie-pop' | 'turn-60' | 'nudge' | 'draw-stroke'
  | 'fade-outline' | 'snip' | 'twinkle' | 'blink' | 'target-pulse';
const MICRO_KIND: Record<string, MicroKind> = {
  'post-video': 'slide-click',   // clapper/frame slides/clicks into place
  'add-product': 'swing',        // hanger swings once and settles
  'go-live': 'pulse-dot',        // LIVE dot pulses once + lens-flare sweep
  'analytics': 'rise',           // rises from 0 into place
  'payouts': 'flip',             // coin flips once
  'community': 'pop-in',         // pops in
  'manufacturer': 'turn-60',     // gear turns 60 degrees
  'customers': 'nudge',          // people nudge together
  'design-studio': 'draw-stroke',// pen draws one stroke
  'mockup-to-model': 'fade-outline', // silhouette fades in from outline
  'remove-bg': 'snip',           // scissors snip
  'ai-design': 'twinkle',        // sparkle twinkle
  'campaign-gen': 'target-pulse',// target rings pulse inward once
  'ai-photoshoot': 'blink',      // shutter blink
};

// ─── Component ────────────────────────────────────────────────────────────────

interface SellerStudioRadialMenuProps {
  hideTrigger?: boolean;
  openRequestKey?: number;
}

export default function SellerStudioRadialMenu({
  hideTrigger = false,
  openRequestKey = 0,
}: SellerStudioRadialMenuProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerTopInset = useHeaderTopInset();
  const { height: screenHeight } = useWindowDimensions();
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { hasPlan, loading: planLoading, error: planError, retry: retryPlan } = useSubscriptionPlan();
  const api = useApi();
  const reduceMotion = useReducedMotion();

  const { userId } = useAuth();

  // Full-screen now, not a partial sheet — Dev's final layout call.
  const pageHeight = screenHeight;

  // Measured once the card area actually lays out, so cards can be sized to
  // it exactly (pixel-perfect edge-to-edge tiling — see cardSpacing below)
  // rather than approximated off the window's own width/height.
  const [cardAreaSize, setCardAreaSize] = useState({ width: 0, height: 0 });
  const cardSpacing = cardAreaSize.width;

  // translateY doubles as "distance below resting position" the whole page
  // sits at — 0 = fully open (covering the screen), pageHeight = fully
  // offscreen below.
  const translateY = useSharedValue(pageHeight);
  // Captured at the start of each drag so onUpdate computes an absolute
  // position from the gesture's cumulative translation, not a running delta.
  const dragStartY = useSharedValue(0);

  const [open, setOpen] = useState(false);
  const [upsellFeature, setUpsellFeature] = useState<string | null>(null);

  const [brandName, setBrandName] = useState<string | null>(null);
  // The seller's own account name/username — always populated by Clerk at
  // sign-up, unlike brandName (which stays null until the seller explicitly
  // names their store). Used as the header title's fallback instead of a
  // "Name your store" placeholder, per Dev's "fresh seller" screenshot.
  const [accountName, setAccountName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [setupPercent, setSetupPercent] = useState(0);
  const [setupDone, setSetupDone] = useState(0);
  const [setupTotal, setSetupTotal] = useState(0);

  // ── Store header data — refreshed each time the page opens ────────────────

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getSetupState().then((state) => {
      if (cancelled) return;
      setSetupPercent(completionPercent(state));
      setSetupDone(completedRequiredTaskCount(state));
      setSetupTotal(requiredTaskCount(state));
    });
    api.seller.getProfile().then((profile) => {
      if (cancelled) return;
      // Real store name only here — NOT merged with the account's own
      // name/username, which is a separate, always-available fallback (see
      // accountName below) rather than being silently treated as the store
      // name. `api.auth.me()`'s profile has no photo field at all, which is
      // why avatarUrl was always null before — api.seller.getProfile() is
      // the endpoint that actually carries profileImageUrl.
      setBrandName(profile?.brandName ?? null);
      setAccountName(profile?.displayName ?? profile?.username ?? null);
      setAvatarUrl(profile?.profileImageUrl ?? null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, api, userId]);

  useEffect(() => () => {
    cancelAnimation(translateY);
  }, [translateY]);

  // ── Card carousel state ─────────────────────────────────────────────────────
  // `cardIndex` is the UI-thread source of truth — a float that animates
  // (via withTiming) toward whatever integer index the current drag/tap
  // resolves to. `cardIndexJS` mirrors its ROUNDED value on the JS side,
  // updated only when it actually changes (see the reaction below), driving
  // the position dots and which cards are mounted at all — that can't be
  // driven from a worklet, unlike the per-card transform/opacity styles,
  // which read `cardIndex` directly.
  const cardIndex = useSharedValue(0);
  const gestureStartIndex = useSharedValue(0);
  const [cardIndexJS, setCardIndexJS] = useState(0);
  // 0 = no card currently "landed" (still scrubbing, or fresh open); ramps
  // to 1 the moment a horizontal release locks a card, driving that card's
  // white ring + scale-up in CarouselCard below. Reset to 0 the instant a
  // new gesture begins on the card area (see cardAreaPan.onBegin), whether
  // that's a fresh scrub or the tap/flick that opens the locked card.
  const landedPulse = useSharedValue(0);
  // ── Auto-enter fill (replaces tap-to-open as the main path) ─────────────────
  // 0→1 over AUTO_ENTER_MS the moment a card locks; its completion callback
  // opens the card exactly like a tap would.
  //   'hidden'    — no card locked, the pill/Cancel are gone.
  //   'counting'  — the fill is running; the pill reads "Entering page" and
  //                 a plain "Cancel" text link shows just above it.
  //   'cancelled' — the user tapped Cancel: the fill is stopped and reset to
  //                 empty, the pill reads "Continue" (a static tap target,
  //                 no more auto-navigate), and Cancel itself is gone (there
  //                 is nothing left to cancel).
  // Any new touch on the card area/header — a fresh scrub, or the very tap
  // that's about to open the locked card — resets this straight to
  // 'hidden', so a cancelled state never carries over to a different card;
  // landing and releasing on any card (even the same one again) always
  // starts a fresh 'counting'.
  const fillProgress = useSharedValue(0);
  const [enterState, setEnterState] = useState<'hidden' | 'counting' | 'cancelled'>('hidden');
  const [enterButtonWidth, setEnterButtonWidth] = useState(0);
  // A brief fade whenever the pill's own label text changes (counting ->
  // cancelled reads "Entering page" -> "Continue") — a lightweight
  // crossfade rather than an abrupt text swap.
  const pillContentOpacity = useSharedValue(1);
  useEffect(() => {
    if (enterState === 'hidden') return;
    pillContentOpacity.value = 0;
    pillContentOpacity.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.quad), ...NO_REDUCE_MOTION });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enterState]);

  // ── Per-card micro-animation trigger (see MICRO_KIND above) ─────────────────
  // A global "play token": microTriggerIndex names which card should play,
  // microTriggerSeq increments so that card's own reaction (in CarouselCard)
  // fires exactly once, and microFast decides tiny-pop vs full-signature.
  const microTriggerIndex = useSharedValue(-1);
  const microTriggerSeq = useSharedValue(0);
  const microFast = useSharedValue(false);
  const lastStepAtRef = useRef(0);

  useEffect(() => {
    // Reset to the first card every time the page opens fresh, so it never
    // reopens wherever a previous session happened to leave off.
    if (open) {
      cardIndex.value = 0;
      gestureStartIndex.value = 0;
      landedPulse.value = 0;
      cancelAnimation(fillProgress);
      fillProgress.value = 0;
      microTriggerIndex.value = -1;
      microTriggerSeq.value = 0;
      setEnterState('hidden');
      setCardIndexJS(0);
      lastStepAtRef.current = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fireHapticTick = useCallback(() => {
    const now = Date.now();
    if (now - lastStepAtRef.current < MIN_HAPTIC_INTERVAL_MS) {
      // Still rate-limit the physical buzz even though we always classify
      // the step's speed below — a very fast scrub should read as one
      // continuous buzz, not overlapping vibrations.
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
  }, []);

  /** The firmer, distinct-from-scrub-ticks haptic that fires once when a
   *  card locks on release — Dev's "landed" feel. */
  const fireLandedHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
  }, []);

  /** Classifies how long the finger dwelled on the PREVIOUS card before
   *  advancing to `rounded`, and arms that card's micro-animation trigger
   *  accordingly (see MICRO_DWELL_MS). JS-side because it needs a real wall-
   *  clock timestamp, same as the haptic rate-limiting above. */
  const armMicroTrigger = useCallback((rounded: number) => {
    const now = Date.now();
    const elapsed = now - lastStepAtRef.current;
    lastStepAtRef.current = now;
    microFast.value = elapsed < MICRO_DWELL_MS;
    microTriggerIndex.value = rounded;
    microTriggerSeq.value = microTriggerSeq.value + 1;
  }, [microFast, microTriggerIndex, microTriggerSeq]);

  useAnimatedReaction(
    () => Math.round(cardIndex.value),
    (rounded, previous) => {
      if (rounded === previous) return;
      runOnJS(setCardIndexJS)(rounded);
      if (previous !== null) {
        runOnJS(fireHapticTick)();
        runOnJS(armMicroTrigger)(rounded);
      }
    },
  );

  // ── Open / close ────────────────────────────────────────────────────────────
  // A single fast timeline (never a spring — a spring's overshoot/settle
  // reads as a bounce, not the "swift and fast" slide Dev asked for) shared
  // by every way the page opens or closes: the initial expand and the
  // dismiss-swipe/close-button below. Release-to-select is deliberately NOT
  // part of this timeline — see commitAndOpen below, which closes with no
  // animation at all, per spec ("sheet gone in the same frame").

  const pendingAfterRef = useRef<(() => void) | null>(null);

  const finishClose = useCallback(() => {
    setOpen(false);
    const after = pendingAfterRef.current;
    pendingAfterRef.current = null;
    after?.();
  }, []);

  const hapticDismiss = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, []);

  const expand = useCallback(() => {
    setOpen(true);
    translateY.value = pageHeight;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    translateY.value = withTiming(0, { duration: SHEET_OPEN_MS, easing: SHEET_EASING, ...NO_REDUCE_MOTION });
  }, [translateY, pageHeight]);

  useEffect(() => {
    if (openRequestKey > 0 && !open) expand();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequestKey]);

  const collapse = useCallback((after?: () => void) => {
    pendingAfterRef.current = after ?? null;
    translateY.value = withTiming(pageHeight, { duration: SHEET_CLOSE_MS, easing: SHEET_EASING, ...NO_REDUCE_MOTION }, (finished) => {
      if (finished) runOnJS(finishClose)();
    });
  }, [translateY, pageHeight, finishClose]);

  /** Cancels the enter-fill and hides the button — used by every path that
   *  closes the page WITHOUT opening a card (close button, Android back/
   *  Escape). The gesture-driven paths (a new touch on the card area or
   *  header) do the UI-thread equivalent directly in their own onBegin/
   *  onStart instead, for zero-latency cancellation. */
  const cancelEnterFill = useCallback(() => {
    cancelAnimation(fillProgress);
    fillProgress.value = 0;
    setEnterState('hidden');
  }, [fillProgress]);

  /** Release-to-select / tap-to-select: no closing animation at all — the
   *  page is just gone, in the same frame the navigation fires, per spec
   *  ("no slide, fade or delay"). */
  const commitAndOpen = useCallback((item: ControlCenterItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    cancelAnimation(translateY);
    // Every way of opening a card — a tap, an upward flick, tapping the
    // enter button, or the button's own fill completing on its own — routes
    // through here, so cancelling the fill unconditionally means it can
    // never double-fire (e.g. a tap landing right as the fill was about to
    // complete on its own).
    cancelAnimation(fillProgress);
    fillProgress.value = 0;
    setEnterState('hidden');
    setOpen(false);
    if (
      GROWTH_PLAN_ENFORCEMENT_ENABLED &&
      item.growthOnly &&
      (planLoading || !!planError || !hasPlan('growth'))
    ) {
      if (planError) retryPlan();
      setUpsellFeature(item.label);
      return;
    }
    setNextPushAnimationNone();
    router.push(item.route as never);
  }, [translateY, fillProgress, planLoading, planError, hasPlan, retryPlan, router]);

  // ── Gestures ─────────────────────────────────────────────────────────────────
  // Horizontal = scrub through cards, vertical = dismiss, near-zero movement
  // = tap-to-open. Two hard-won constraints from live web testing shaped
  // this:
  //  1. react-native-gesture-handler's web implementation (2.32.0) cannot
  //     resolve a Gesture.Race between two Gesture.Pan instances — attaching
  //     a second Pan alongside another (whether as a Race sibling, or
  //     nested in a separate GestureDetector one level up) made BOTH
  //     gestures cancel immediately on any real drag, regardless of their
  //     activeOffset/failOffset config. So scrub and dismiss are combined
  //     into ONE Gesture.Pan per detector that locks its own axis manually
  //     on the first ~10px of movement, rather than two Pans raced against
  //     each other.
  //  2. A genuine tap (zero movement) never activates a Gesture.Pan at all
  //     — it goes straight from BEGAN to FAILED without ever calling
  //     onStart/onEnd, on web or native, however its offsets are
  //     configured. So "a tap opens it" needs an actual Gesture.Tap, Raced
  //     against the combined Pan above — and that particular combination
  //     (exactly one Pan + one Tap) DOES resolve correctly on web, unlike
  //     two Pans.

  const commitAndOpenRef = useRef(commitAndOpen);
  commitAndOpenRef.current = commitAndOpen;
  const currentItemRef = useRef(CARD_ITEMS[0]);
  currentItemRef.current = CARD_ITEMS[cardIndexJS] ?? CARD_ITEMS[0];
  const openCurrentItem = useCallback(() => {
    commitAndOpenRef.current(currentItemRef.current);
  }, []);

  /** How far (in either single-axis direction) a drag must travel before its
   *  axis locks in — matches the "decide within the first ~10px" spec. */
  const AXIS_LOCK_PX = 10;
  const cardGestureAxis = useSharedValue<'none' | 'horizontal' | 'vertical'>('none');
  /** How quick/far an upward flick on the card area must be to count as the
   *  "power move" that opens instantly, rather than an ordinary slow drag up
   *  (which just rubber-bands and snaps back, same as before). Symmetric
   *  with the downward dismiss-flick threshold below. */
  const OPEN_FLICK_VELOCITY = 800;
  /** How fast the locked card snaps to dead-center on release, and how long
   *  its ring/scale "landed" pulse takes to ramp in. */
  const CARD_LOCK_MS = 100;
  /** Exactly how long the "Entering page" button takes to fill left-to-right
   *  and auto-open the locked card — a plain linear fill (no easing curve to
   *  imply acceleration/deceleration, no countdown number). Briefly lowered
   *  to 1000ms per earlier live-testing feedback, then moved back to 1500ms
   *  per Dev's follow-up after using it more ("the little timer bar... is
   *  too short... change it back to the other timer that it was at") — one
   *  named constant drives both the fill animation and the auto-navigate
   *  timing, so they can never drift apart. */
  const AUTO_ENTER_MS = 1500;

  const runDismissEnd = useCallback((e: { translationY: number; velocityY: number }) => {
    'worklet';
    const shouldClose = e.translationY > pageHeight * 0.2 || e.velocityY > 800;
    if (!shouldClose) {
      translateY.value = withTiming(0, { duration: SHEET_OPEN_MS, easing: SHEET_EASING, ...NO_REDUCE_MOTION });
      return;
    }
    runOnJS(hapticDismiss)();
    const remaining = pageHeight - translateY.value;
    const velocityMs = e.velocityY > 0 ? (remaining / e.velocityY) * 1000 : SHEET_CLOSE_MS;
    const duration = Math.min(SHEET_CLOSE_MS, Math.max(90, velocityMs));
    translateY.value = withTiming(pageHeight, { duration, easing: SHEET_EASING, ...NO_REDUCE_MOTION }, (finished) => {
      if (finished) runOnJS(finishClose)();
    });
  }, [pageHeight, translateY, hapticDismiss, finishClose]);

  // Header: dismiss-only (vertical), or a plain tap on empty header space
  // also dismisses without navigating — this detector never scrubs.
  const dismissGesture = useMemo(() => Gesture.Pan()
    .onStart(() => {
      dragStartY.value = translateY.value;
      // A swipe starting on the header should cancel any in-flight
      // enter-fill on the card area below, same as touching the card area
      // itself would (spec: "cancel and close, never navigates").
      cancelAnimation(fillProgress);
      fillProgress.value = 0;
      runOnJS(setEnterState)('hidden');
    })
    .onUpdate((e) => {
      const next = dragStartY.value + e.translationY;
      translateY.value = next >= 0 ? next : rubberBandUp(next);
    })
    .onEnd((e) => {
      runDismissEnd(e);
    }), [translateY, dragStartY, fillProgress, runDismissEnd]);

  // Card area: scrub (horizontal) or dismiss (vertical) — a single combined
  // Pan that locks its own axis, per constraint 1 above.
  const cardAreaPan = useMemo(() => Gesture.Pan()
    .onBegin(() => {
      cardGestureAxis.value = 'none';
      gestureStartIndex.value = Math.round(cardIndex.value);
      dragStartY.value = translateY.value;
      // Any new touch on the card area — a fresh scrub, or the tap/flick
      // that's about to open the locked card — clears the "landed" ring so
      // it never lingers on a card that's no longer the settled one, and
      // cancels any in-flight enter-fill immediately (spec: "if the user
      // touches/scrubs again during the fill, the fill cancels and resets
      // immediately and the carousel continues from that card").
      landedPulse.value = 0;
      cancelAnimation(fillProgress);
      fillProgress.value = 0;
      runOnJS(setEnterState)('hidden');
    })
    .onUpdate((e) => {
      if (cardGestureAxis.value === 'none') {
        if (Math.abs(e.translationX) > AXIS_LOCK_PX || Math.abs(e.translationY) > AXIS_LOCK_PX) {
          cardGestureAxis.value = Math.abs(e.translationX) >= Math.abs(e.translationY) ? 'horizontal' : 'vertical';
        }
      }
      if (cardGestureAxis.value === 'horizontal') {
        const next = indexForDrag(gestureStartIndex.value, e.translationX, CARD_ITEMS.length);
        cardIndex.value = withTiming(next, { duration: CARD_STEP_MS, easing: CARD_STEP_EASING, ...NO_REDUCE_MOTION });
      } else if (cardGestureAxis.value === 'vertical') {
        const next = dragStartY.value + e.translationY;
        translateY.value = next >= 0 ? next : rubberBandUp(next);
      }
    })
    .onEnd((e) => {
      if (cardGestureAxis.value === 'vertical') {
        // A quick, primarily-upward flick is the "power move" that opens
        // the current card instantly — same as a tap, just from a flick
        // instead. Anything else vertical (a slow drag up, or a real
        // downward swipe/flick) goes through the normal dismiss logic,
        // which itself decides close-vs-snap-back.
        const isUpwardFlick = e.velocityY < -OPEN_FLICK_VELOCITY;
        if (isUpwardFlick) {
          runOnJS(openCurrentItem)();
          return;
        }
        runDismissEnd(e);
      } else if (cardGestureAxis.value === 'horizontal') {
        // Release no longer opens the card (Dev's live-testing feedback:
        // too fast/accident-prone) — it LOCKS on whichever card is nearest
        // to center: a firm snap to dead-center plus a single "landed"
        // haptic distinct from the per-card scrub ticks, and landedPulse
        // drives that card's ring/scale-up in CarouselCard below. Opening
        // it now takes a separate tap or upward flick.
        const target = Math.round(cardIndex.value);
        cardIndex.value = withTiming(target, { duration: CARD_LOCK_MS, easing: CARD_STEP_EASING, ...NO_REDUCE_MOTION });
        landedPulse.value = withTiming(1, { duration: CARD_LOCK_MS, easing: CARD_STEP_EASING, ...NO_REDUCE_MOTION });
        runOnJS(fireLandedHaptic)();
        // A lock always plays the FULL signature animation (never the tiny
        // fast-pop), same as a genuine dwell.
        microFast.value = false;
        microTriggerIndex.value = target;
        microTriggerSeq.value = microTriggerSeq.value + 1;
        // Auto-enter: the "Entering page" button appears and fills over
        // EXACTLY AUTO_ENTER_MS; when it completes, open the card exactly
        // like a tap would. onBegin above cancels this the instant any new
        // touch starts, and commitAndOpen cancels it unconditionally on
        // every path that actually opens a card (tap, flick, or this fill
        // completing), so it can never double-fire.
        runOnJS(setEnterState)('counting');
        fillProgress.value = 0;
        fillProgress.value = withTiming(1, { duration: AUTO_ENTER_MS, easing: Easing.linear, ...NO_REDUCE_MOTION }, (finished) => {
          if (finished) runOnJS(openCurrentItem)();
        });
      }
      // axis === 'none' here means the Pan never crossed AXIS_LOCK_PX at
      // all before release — too small a movement for this Pan to have
      // even activated (see constraint 2), so it never reaches onEnd for
      // that case; the Race'd tapGesture below handles it instead.
    }), [cardIndex, gestureStartIndex, translateY, dragStartY, cardGestureAxis, landedPulse, fillProgress, microFast, microTriggerIndex, microTriggerSeq, runDismissEnd, openCurrentItem, fireLandedHaptic]);

  // A genuine tap (near-zero movement) — see constraint 2 above for why
  // this can't just be "the Pan's onEnd when its axis never locked".
  const tapGesture = useMemo(() => Gesture.Tap()
    .maxDistance(AXIS_LOCK_PX)
    .onEnd(() => {
      runOnJS(openCurrentItem)();
    }), [openCurrentItem]);

  const cardAreaGesture = useMemo(
    () => Gesture.Race(cardAreaPan, tapGesture),
    [cardAreaPan, tapGesture],
  );

  const pageAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  // The reveal itself — see the enterButton JSX below for how this width,
  // animating against a FIXED-width inner label of the same total button
  // width, produces the left-to-right white-fill/black-text-reveal effect.
  const enterFillStyle = useAnimatedStyle(() => ({
    width: fillProgress.value * enterButtonWidth,
  }));
  // Crossfades the pill's own label text on "Entering page" <-> "Continue".
  const pillContentStyle = useAnimatedStyle(() => ({
    opacity: pillContentOpacity.value,
  }));

  // ── Derived data ────────────────────────────────────────────────────────────

  const isLocked = (item: ControlCenterItem) =>
    GROWTH_PLAN_ENFORCEMENT_ENABLED && !!item.growthOnly && !planLoading && !planError && !hasPlan('growth');

  const storeIsLive = setupPercent >= 100;
  const hasStoreName = !!brandName?.trim();
  // The header title always shows something real — the store name once
  // set, the seller's own account name/username until then — never a bare
  // "Name your store" placeholder as the title itself (that's now the small
  // link below instead).
  const headerTitle = hasStoreName ? brandName!.trim() : (accountName?.trim() || null);
  const headerMonogram = (hasStoreName ? brandName : accountName)?.trim()?.[0]?.toUpperCase() ?? null;

  // ── Card renderer ────────────────────────────────────────────────────────────
  // Every mounted card (the current one plus CARD_WINDOW_RADIUS neighbors on
  // each side) renders the same full-bleed cover + icon + name; only its
  // animated position/opacity (driven by `cardIndex`, on the UI thread)
  // differ, which is what makes the transition on each scrub step a smooth
  // slide+crossfade rather than a hard content swap. Sized to `cardSpacing`
  // exactly (== the measured card-area width) so cards tile edge to edge
  // with zero gap and zero overlap at rest — a neighbor is only ever
  // visible mid-transition, never at an integer (resting) index.

  function CarouselCard({ item, itemIndex }: { item: ControlCenterItem; itemIndex: number }) {
    const locked = isLocked(item);
    const microKind = MICRO_KIND[item.id] ?? 'pop-in';
    const isGoLive = item.id === 'go-live';

    const cardStyle = useAnimatedStyle(() => {
      const distance = itemIndex - cardIndex.value;
      const absDistance = Math.abs(distance);
      // landedPulse only ever applies to whichever card is actually
      // dead-center (absDistance ~0) — a neighbor mid-scrub never gets the
      // scale-up, even while landedPulse is still ramping in from the
      // previous card's release.
      const landedBoost = absDistance < 0.01 ? landedPulse.value * 0.05 : 0;
      return {
        transform: [
          { translateX: distance * cardSpacing },
          { scale: 1 + landedBoost },
        ],
        // Fully opaque right up to the moment it stops being adjacent —
        // zero peek at rest (Dev, firm): at any integer distance >= 1 the
        // card already sits fully outside the card area (translateX ==
        // distance * cardSpacing, and cardSpacing == the card area's own
        // width), so this opacity fade only ever plays out DURING the
        // ~90ms slide between two adjacent integer positions.
        opacity: interpolate(absDistance, [0, 1], [1, 0], Extrapolation.CLAMP),
      };
    });
    // Icon + name only ever show on the card that's actually centered (or
    // very nearly there mid-scrub) — a peeking neighbor showing a clipped
    // fragment of its name read as broken in an earlier pass. Now moot at
    // rest (see cardStyle above — a neighbor isn't visible at all once
    // settled), but this still keeps text from ever appearing on a
    // partially-slid-in neighbor mid-transition.
    const contentStyle = useAnimatedStyle(() => {
      const distance = itemIndex - cardIndex.value;
      return { opacity: interpolate(Math.abs(distance), [0.32, 0.48], [1, 0], Extrapolation.CLAMP) };
    });
    // ── Signature micro-animation (see MICRO_KIND) ────────────────────────────
    const microScale = useSharedValue(1);
    const microScaleX = useSharedValue(1);
    const microScaleY = useSharedValue(1);
    const microRotate = useSharedValue(0);
    const microTranslateX = useSharedValue(0);
    const microTranslateY = useSharedValue(0);
    const microOpacity = useSharedValue(1);
    // go-live only:
    const liveDotScale = useSharedValue(0);
    const liveSweepProgress = useSharedValue(0);

    useAnimatedReaction(
      () => (microTriggerIndex.value === itemIndex ? microTriggerSeq.value : -1),
      (seq, prevSeq) => {
        if (seq === -1 || seq === prevSeq) return;
        if (reduceMotion) {
          // Reduce Motion: fade only, never a transform.
          microOpacity.value = 0.5;
          microOpacity.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.quad) });
          return;
        }
        if (microFast.value) {
          // Finger flying past several cards quickly — a tiny 100ms
          // scale-pop synced with the haptic tick, never the full motion.
          microScale.value = withSequence(
            withTiming(1.06, { duration: 50, easing: Easing.out(Easing.quad) }),
            withTiming(1, { duration: 50, easing: Easing.out(Easing.quad) }),
          );
          return;
        }
        switch (microKind) {
          case 'swing':
            microRotate.value = withSequence(
              withTiming(-10, { duration: 120, easing: Easing.out(Easing.quad) }),
              withTiming(6, { duration: 140, easing: Easing.out(Easing.quad) }),
              withTiming(0, { duration: 140, easing: Easing.out(Easing.quad) }),
            );
            break;
          case 'pulse-dot':
            liveDotScale.value = withSequence(
              withTiming(1.3, { duration: 150, easing: Easing.out(Easing.quad) }),
              withTiming(1, { duration: 150, easing: Easing.out(Easing.quad) }),
            );
            liveSweepProgress.value = 0;
            liveSweepProgress.value = withTiming(1, { duration: 380, easing: Easing.out(Easing.quad) });
            break;
          case 'rise':
            microScaleY.value = 0;
            microScaleY.value = withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) });
            break;
          case 'flip':
            microScaleX.value = withSequence(
              withTiming(0, { duration: 180, easing: Easing.out(Easing.quad) }),
              withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) }),
            );
            break;
          case 'pop-in':
            microScale.value = 0.7;
            microScale.value = withTiming(1, { duration: 350, easing: Easing.out(Easing.cubic) });
            break;
          case 'rotate-notch':
            microRotate.value = withSequence(
              withTiming(20, { duration: 200, easing: Easing.out(Easing.quad) }),
              withTiming(0, { duration: 200, easing: Easing.out(Easing.quad) }),
            );
            break;
          case 'slide-click':
            microTranslateX.value = -10;
            microTranslateX.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.quad) });
            break;
          case 'pie-pop':
            microScale.value = withSequence(
              withTiming(1.15, { duration: 180, easing: Easing.out(Easing.quad) }),
              withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) }),
            );
            break;
          case 'turn-60':
            microRotate.value = withSequence(
              withTiming(60, { duration: 220, easing: Easing.out(Easing.quad) }),
              withTiming(0, { duration: 220, easing: Easing.out(Easing.quad) }),
            );
            break;
          case 'nudge':
            microTranslateX.value = -5;
            microTranslateX.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.quad) });
            break;
          case 'draw-stroke':
            microTranslateX.value = -6;
            microTranslateY.value = -6;
            microTranslateX.value = withTiming(0, { duration: 320, easing: Easing.out(Easing.quad) });
            microTranslateY.value = withTiming(0, { duration: 320, easing: Easing.out(Easing.quad) });
            break;
          case 'fade-outline':
            microOpacity.value = 0.15;
            microScale.value = 0.92;
            microOpacity.value = withTiming(1, { duration: 380, easing: Easing.out(Easing.quad) });
            microScale.value = withTiming(1, { duration: 380, easing: Easing.out(Easing.quad) });
            break;
          case 'snip':
            microRotate.value = withSequence(
              withTiming(-14, { duration: 100, easing: Easing.out(Easing.quad) }),
              withTiming(14, { duration: 100, easing: Easing.out(Easing.quad) }),
              withTiming(0, { duration: 140, easing: Easing.out(Easing.quad) }),
            );
            break;
          case 'twinkle':
            microScale.value = withSequence(
              withTiming(1.18, { duration: 160, easing: Easing.out(Easing.quad) }),
              withTiming(1, { duration: 200, easing: Easing.out(Easing.quad) }),
            );
            break;
          case 'blink':
            microScaleY.value = withSequence(
              withTiming(0.1, { duration: 90, easing: Easing.out(Easing.quad) }),
              withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) }),
            );
            break;
          case 'target-pulse':
            microScale.value = withSequence(
              withTiming(1.18, { duration: 160, easing: Easing.out(Easing.quad) }),
              withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) }),
            );
            break;
        }
      },
    );

    const microIconStyle = useAnimatedStyle(() => ({
      opacity: microOpacity.value,
      transform: [
        { translateX: microTranslateX.value },
        { translateY: microTranslateY.value },
        { rotate: `${microRotate.value}deg` },
        { scale: microScale.value },
        { scaleX: microScaleX.value },
        { scaleY: microScaleY.value },
      ],
    }));
    const liveDotStyle = useAnimatedStyle(() => ({ transform: [{ scale: liveDotScale.value }] }));
    const liveSweepStyle = useAnimatedStyle(() => ({
      opacity: interpolate(liveSweepProgress.value, [0, 0.15, 0.85, 1], [0, 0.5, 0.5, 0], Extrapolation.CLAMP),
      transform: [
        { translateX: interpolate(liveSweepProgress.value, [0, 1], [-70, 70]) },
        { rotate: '20deg' },
      ],
    }));

    // pointerEvents="none": the whole card area's gesture (scrub/dismiss/
    // tap, composed in cardAreaGesture) handles all real touch input — an
    // individual card never receives its own touches, since which card is
    // "current" comes purely from cardIndex, not from which card a finger
    // happens to be over. accessibilityLabel/testID still identify it (for
    // a screen reader's swipe-navigation and this file's own tests / the
    // native device-interaction contract), even though a direct tap on a
    // non-center card doesn't select it the way the old grid's individual
    // pressable tiles did.
    return (
      <Animated.View
        key={item.id}
        style={[styles.card, { width: cardAreaSize.width, height: cardAreaSize.height }, cardStyle]}
        pointerEvents="none"
        accessibilityLabel={item.label}
        testID={`seller-control-center-item-${item.id}`}
      >
        <StudioCoverBackdrop />
        <Animated.View style={[styles.cardContent, contentStyle]}>
          <Animated.View style={[styles.cardIconWrap, microIconStyle]}>
            {/* Interim look until this card has real hero-art cover art
                (see PR adding StudioCoverHeroArt's bitmap manifest): a
                large, light-weight glyph sitting directly on the cover's own
                lighting — never a ring around it. Dev, explicitly: "Never
                the ring + box combo" (the old always-on medallion ring is
                already gone; the interactive "landed" ring that used to
                appear once a card locked is removed too, since the glyph
                alone is what needs to read clean right now — landedPulse
                still drives the card's own subtle scale-up on lock). */}
            <Feather name={item.icon as any} size={108} color={theme.text} style={styles.cardIconGlyph} />
            {locked && (
              <View style={styles.cardLock}>
                <Feather name="lock" size={14} color={theme.text} />
              </View>
            )}
            {isGoLive && (
              <>
                <Animated.View style={[styles.liveDot, liveDotStyle]} pointerEvents="none" />
                <Animated.View style={[styles.liveSweep, liveSweepStyle]} pointerEvents="none" />
              </>
            )}
          </Animated.View>
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.85)']}
            style={styles.cardBottomVignette}
            pointerEvents="none"
          />
          <Text style={styles.cardLabel} numberOfLines={2}>{item.label}</Text>
        </Animated.View>
      </Animated.View>
    );
  }

  const windowStart = Math.max(0, cardIndexJS - CARD_WINDOW_RADIUS);
  const windowEnd = Math.min(CARD_ITEMS.length - 1, cardIndexJS + CARD_WINDOW_RADIUS);
  const windowedItems: Array<{ item: ControlCenterItem; itemIndex: number }> = [];
  for (let i = windowStart; i <= windowEnd; i++) windowedItems.push({ item: CARD_ITEMS[i], itemIndex: i });

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <>
      {!hideTrigger && !open && (
        <Pressable
          testID="seller-studio-menu-open"
          accessibilityRole="button"
          accessibilityLabel="Open Studio tools"
          onPress={expand}
          style={({ pressed }) => [
            styles.toggle,
            { top: headerTopInset + SP.xl, backgroundColor: theme.accent, shadowColor: theme.shadowColor },
            pressed && styles.pressed,
          ]}
        >
          <Feather name="grid" size={22} color={theme.onAccent} />
        </Pressable>
      )}

      <Modal
        visible={open}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => { cancelEnterFill(); collapse(); }}
      >
        {/* The full-screen page itself — no separate backdrop layer: it
            fully covers whatever screen was behind it (Dashboard, Products,
            whichever), sliding up from/down to offscreen. Header and card
            area are SIBLING GestureDetectors, each with its own single
            Gesture.Pan (dismissGesture, cardAreaGesture) — see the block
            comment above cardAreaGesture's definition for why neither is
            ever combined with another Pan via Gesture.Race. */}
        <Animated.View
          style={[
            styles.page,
            {
              height: pageHeight,
              paddingTop: headerTopInset,
              paddingBottom: Math.max(insets.bottom, 16),
            },
            pageAnimatedStyle,
          ]}
        >
          <GestureDetector gesture={dismissGesture}>
            {/* ── Store header ──
                Always the seller's real profile photo + real store name. No
                photo yet: an initials monogram (from the store name once
                set, else the seller's own account name/username — never a
                generic bag icon, and never blank). No store name yet: the
                title falls back to the seller's own account name/username
                (always real, from Clerk) with a small tappable "Set store
                name" link underneath — never a grey placeholder AS the
                title. No "?" help icon (Settings > Help & support covers it
                — see services/settingsCatalog.ts). "View store" is a
                compact, unfilled text+icon button. A close (X) replaces the
                old swipe-only dismissal now that this is a full page, not a
                sheet with a visible "outside" to tap. */}
            <View style={styles.header}>
              <View style={styles.avatar}>
                {avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
                ) : headerMonogram ? (
                  <Text style={styles.avatarLetter}>{headerMonogram}</Text>
                ) : (
                  <Feather name="shopping-bag" size={18} color={theme.text} />
                )}
              </View>
              <View style={styles.headerTextBlock}>
                <Text style={styles.storeName} numberOfLines={1}>{headerTitle ?? 'Your store'}</Text>
                {!hasStoreName && (
                  <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); collapse(() => router.push('/settings' as never)); }}>
                    <Text style={styles.setStoreNameLink} numberOfLines={1}>Set store name</Text>
                  </Pressable>
                )}
                {!storeIsLive && setupPercent > 0 && (
                  <Pressable
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); collapse(() => router.push('/settings' as never)); }}
                    accessibilityRole="progressbar"
                    accessibilityLabel={`Store setup, ${setupDone} of ${setupTotal} steps complete`}
                    hitSlop={{ top: 6, bottom: 6, left: 0, right: 6 }}
                    style={styles.setupBarTrack}
                  >
                    <View style={[styles.setupBarFill, { width: `${setupPercent}%` }]} />
                  </Pressable>
                )}
              </View>
              <PressableScale
                onPress={() => collapse(() => router.push('/store-preview' as never))}
                accessibilityRole="button"
                accessibilityLabel="View store"
                style={styles.viewStoreBtn}
              >
                <Text style={styles.viewStoreLabel}>View store</Text>
                <Feather name="arrow-up-right" size={13} color={theme.text} />
              </PressableScale>
              <PressableScale
                onPress={() => { cancelEnterFill(); hapticDismiss(); collapse(); }}
                accessibilityRole="button"
                accessibilityLabel="Close Studio tools"
                testID="seller-studio-menu-close"
                style={styles.closeBtn}
              >
                <Feather name="x" size={20} color={theme.text} />
              </PressableScale>
            </View>
          </GestureDetector>

          {/* ── Card carousel ── */}
          <GestureDetector gesture={cardAreaGesture}>
            <View
              style={styles.cardArea}
              testID="seller-studio-card-area"
              onLayout={(e) => setCardAreaSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
            >
              {windowedItems.map(({ item, itemIndex }) => (
                <CarouselCard key={item.id} item={item} itemIndex={itemIndex} />
              ))}
              <StudioCoverGrain />
            </View>
          </GestureDetector>

          {/* ── Cancel link + auto-enter fill button ──
              Appears the instant a card locks. While 'counting', the pill
              reads "Entering page" and fills left-to-right over EXACTLY
              AUTO_ENTER_MS, opening the card when it completes; a plain
              "Cancel" text link (no background/border) sits just above it.
              Tapping Cancel stops the fill, resets it to empty, and swaps
              the pill to a static "Continue" (still tappable to open) with
              a brief crossfade — see the block comment above cardAreaPan's
              onEnd for the full cancel/skip rules. The fill "reveal" itself
              is two identical labels: a plain white-on-dark one underneath,
              and a black-on-white copy inside a width-animated, overflow-
              hidden container on top, both using the SAME fixed
              enterButtonWidth so the revealed black text lines up exactly
              with the white text it's covering rather than re-centering as
              the fill container shrinks/grows. */}
          {enterState !== 'hidden' && (
            <>
              {enterState === 'counting' && (
                <Pressable
                  testID="seller-studio-enter-cancel"
                  accessibilityRole="button"
                  accessibilityLabel="Cancel entering page"
                  onPress={() => {
                    cancelAnimation(fillProgress);
                    fillProgress.value = 0;
                    setEnterState('cancelled');
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  }}
                  hitSlop={{ top: 14, bottom: 14, left: 20, right: 20 }}
                  style={styles.cancelLink}
                >
                  <Text style={styles.cancelLinkLabel}>Cancel</Text>
                </Pressable>
              )}
              <Pressable
                testID="seller-studio-enter-button"
                accessibilityRole="button"
                accessibilityLabel={enterState === 'cancelled' ? 'Continue to page' : 'Entering page. Tap to open now.'}
                onPress={openCurrentItem}
                onLayout={(e) => setEnterButtonWidth(e.nativeEvent.layout.width)}
                style={styles.enterButton}
              >
                <Animated.Text style={[styles.enterButtonLabelBase, pillContentStyle]}>
                  {enterState === 'cancelled' ? 'Continue' : 'Entering page'}
                </Animated.Text>
                <Animated.View style={[styles.enterButtonFill, enterFillStyle]} pointerEvents="none">
                  <View style={[styles.enterButtonFillInner, { width: enterButtonWidth }]}>
                    <Animated.Text style={[styles.enterButtonLabelFilled, pillContentStyle]} numberOfLines={1}>
                      {enterState === 'cancelled' ? 'Continue' : 'Entering page'}
                    </Animated.Text>
                  </View>
                </Animated.View>
              </Pressable>
            </>
          )}

          {/* Small position dots — replaces the old "X / 16" text. */}
          <View style={styles.dotsRow} testID="seller-studio-position-dots">
            {CARD_ITEMS.map((item, i) => (
              <View key={item.id} style={[styles.dot, i === cardIndexJS && styles.dotActive]} />
            ))}
          </View>
        </Animated.View>
      </Modal>

      <PlanUpsellModal
        visible={upsellFeature !== null}
        featureName={upsellFeature ?? ''}
        requiredPlan="growth"
        onClose={() => setUpsellFeature(null)}
        onUpgrade={() => {
          setUpsellFeature(null);
          router.push('/subscription' as never);
        }}
      />

      <FirstRunTip
        id="studio-menu-scrub"
        variant="fullscreen"
        contentReady={open}
        fullscreen={{ title: 'Studio', subtitle: 'Scrub through your tools', rows: STUDIO_MENU_SCRUB_ROWS }}
      />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  toggle: {
    position: 'absolute',
    right: SP.md,
    zIndex: 1200,
    elevation: 16,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.38,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
  },
  pressed: { transform: [{ scale: 0.94 }], opacity: 0.9 },

  // The whole page — no separate backdrop layer. It fully covers whatever
  // screen was behind it (Dev's final layout call: a full-screen takeover,
  // not a partial sheet with a dimmed "outside" to show through).
  page: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    // Forced pure black regardless of the seller's chosen Appearance theme
    // (theme.background varies per preset) — the covers themselves are a
    // deliberately theme-independent black/white/silver series (see
    // StudioCardCover.tsx), so the page shell around them (header included)
    // must match exactly or a seam shows right where the header ends and
    // the first card's cover begins, whatever theme is active. Fixes Dev's
    // screenshot: "a visible seam/band between the header row (pure black)
    // and the card."
    backgroundColor: '#000000',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingHorizontal: SP.md,
    paddingTop: SP.xs,
    paddingBottom: SP.sm,
  },
  // Fixed: previously a solid grey (theme.accentDim) circle — Dev's own
  // report. Black fill + a thin silver ring reads as this app's own
  // black/white/silver identity instead of a generic filled avatar. Now
  // also the frame for the seller's real profile photo when one exists
  // (avatarImage below) — the initial/neutral-icon fallbacks only ever
  // show without a photo.
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.background,
    borderWidth: 1.5,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarLetter: { fontSize: FS.lg, fontFamily: FONT.bold, color: theme.text },
  // Vertically centered against the 44pt avatar and the header's other
  // 32pt buttons — justifyContent: 'center' rather than the default
  // flex-start, since this block's own content (one or two lines) is
  // shorter than its row siblings.
  headerTextBlock: { flex: 1, justifyContent: 'center', gap: 4 },
  storeName: { fontSize: FS.md, fontFamily: FONT.bold, color: theme.text },
  // A small secondary link, never the title itself — shown only until the
  // seller sets a real store name (the title already reads their account
  // name/username in the meantime, never a grey placeholder).
  setStoreNameLink: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.muted },
  // A thin silver progress bar replaces the old tiny "X% set up" text —
  // Dev: clean, no clutter. Tappable (opens the setup checklist), and
  // hidden entirely once setup reaches 100% (see storeIsLive in the
  // component) or before any progress has been made at all.
  setupBarTrack: {
    height: 3,
    borderRadius: 1.5,
    backgroundColor: theme.border,
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  setupBarFill: { height: '100%', backgroundColor: theme.text, borderRadius: 1.5 },
  // Compact, unfilled text+icon button — Dev's own call: the old solid
  // white pill was "too big and eye-catching". No background, a hairline
  // border only, ~32pt tall, matching the avatar's own vertical center.
  viewStoreBtn: {
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: theme.border,
  },
  viewStoreLabel: { fontSize: FS.xs, fontFamily: FONT.bold, color: theme.text },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Card carousel — one destination at a time, its own full-bleed cover
  // (StudioCoverBackdrop) filling the ENTIRE card area edge to edge, behind
  // a huge icon + name. Absolutely-positioned cards, offset purely via the
  // animated translateX/opacity in CarouselCard's own style — this View
  // itself never scrolls.
  cardArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // Sized to the measured card area exactly (width/height set inline from
  // cardAreaSize in CarouselCard) so consecutive cards tile with zero gap
  // and zero overlap at rest — no rounded corners now that this is the
  // card area's own full-bleed content, not a floating "poster" within a
  // partial sheet.
  card: {
    position: 'absolute',
    overflow: 'hidden',
  },
  // Only cardContent (icon/name/vignette) fades out per-card via
  // CarouselCard's contentStyle — StudioCoverBackdrop itself is a sibling
  // and unaffected, so a card mid-transition still shows its own cover art
  // the whole time, just without any text on it until it's centered.
  cardContent: { flex: 1, alignItems: 'center', paddingTop: SP.xxl, paddingBottom: SP.xl },
  cardIconWrap: { flex: 1, width: 132, alignItems: 'center', justifyContent: 'center' },
  // The interim per-card glyph (see the "Interim look" comment above its
  // usage) — no shadow-double/emboss treatment, which was part of what made
  // it read as a boxed UI icon rather than art sitting on the cover.
  cardIconGlyph: { opacity: 0.92 },
  // go-live's own extras — a small red "LIVE" dot and a soft diagonal
  // highlight sweep, both purely decorative (pointerEvents "none").
  liveDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#ff3b30',
    borderWidth: 1.5,
    borderColor: '#000',
  },
  liveSweep: {
    position: 'absolute',
    width: 24,
    height: 140,
    backgroundColor: '#ffffff',
  },
  cardLabel: {
    // Dropped from 24/bold — Dev: with the fill pill now the only visible
    // action, the big bottom title was reading like a second button.
    // Semibold at 20 still reads clearly as a title, not a control.
    fontSize: 20,
    fontFamily: FONT.semibold,
    color: theme.text,
    textAlign: 'center',
    letterSpacing: 0.2,
    wordWrap: 'normal',
  },
  // Sits directly behind cardLabel (painted first, in the same paddingBottom
  // footprint) so the poster-style caption stays legible over busy cover art.
  cardBottomVignette: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 96,
  },
  cardLock: {
    position: 'absolute',
    bottom: -6,
    right: -10,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Position dots — replaces the old "X / 16" text indicator.
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingTop: SP.xs,
    paddingBottom: SP.sm,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: theme.border,
  },
  dotActive: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.text },

  // Plain text link, no background/border — sits just above the pill while
  // it's counting down. theme.muted is this app's own silver token (never
  // hardcoded), so it matches across every preset.
  cancelLink: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  cancelLinkLabel: { fontSize: 14, fontFamily: FONT.medium, color: theme.muted },

  // ── Auto-enter fill button ──
  // Dev, after #525 shipped: "less bold and smaller." A compact pill sized
  // to its own label (not full width), a thin 1px hairline instead of a
  // heavy solid block, and a Medium-weight label instead of Bold — the fill
  // itself still runs the full AUTO_ENTER_MS, just reads as a subtle
  // white/silver wash behind lighter text rather than a loud CTA.
  enterButton: {
    height: 42,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: theme.border,
    alignSelf: 'center',
    paddingHorizontal: 20,
    marginTop: SP.xs,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  enterButtonLabelBase: { fontSize: FS.base, fontFamily: FONT.medium, color: theme.text, letterSpacing: 0.2 },
  enterButtonFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  enterButtonFillInner: { height: '100%', alignItems: 'center', justifyContent: 'center' },
  enterButtonLabelFilled: { fontSize: FS.base, fontFamily: FONT.medium, color: '#000000', letterSpacing: 0.2 },
});
