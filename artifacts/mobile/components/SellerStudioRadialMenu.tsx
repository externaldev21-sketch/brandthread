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
 * Layout: the current card's full-bleed cover fills the ENTIRE screen, edge
 * to edge, top to bottom — no bars, no letterboxing above/below it. The
 * header and the edge-chevron swipe hint FLOAT on top of that cover as two
 * absolutely-positioned overlays (no background of their own — legibility
 * comes from the cover's own dark vignette, same as the icon/name already
 * relied on). Header: the seller's real profile photo + store name on the
 * left (an initials circle, matching the store name's own first letter,
 * only when there's no photo yet; a neutral store icon — never a random
 * letter — when there's no store name either) and a close (X) button on the
 * right. A neighbor card is visible ONLY mid-transition (the ~90ms slide
 * between cards), never at rest, per Dev's own screenshot ("no slivers, no
 * half-words"). A thin white edge-trace draws clockwise around the WHOLE
 * SCREEN on lock (see AUTO_ENTER_MS) — inset from the physical screen edges
 * on every side, header and chevrons included, not just the area between them.
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
 *    quick snap-to-center, a single firmer "landed" haptic, and a thin white
 *    light that traces clockwise around the card's full edge starting from
 *    top-center, completing the loop in EXACTLY AUTO_ENTER_MS (1.5s) while
 *    the cover itself slowly pushes in and brightens slightly. When the
 *    trace closes, the cover zooms through (fast scale + fade) straight
 *    into the destination, with a firmer haptic than the lock tick. Dev,
 *    replacing the earlier pill/Cancel/Continue button entirely: "the
 *    button's making the page look tacky." Touching the screen anywhere, or
 *    scrubbing to another card, cancels instantly — the trace retracts and
 *    the push eases back — and continues from wherever the finger lands; a
 *    tap or a quick upward flick still skips straight to opening. Reduce
 *    Motion keeps the trace (a real timed cancel window, not decoration)
 *    but drops the push/zoom in favor of a plain fade on completion.
 *  - A downward drag (anywhere on the card area or the header) or the close
 *    (X) button dismisses the whole page without navigating, sliding it
 *    back down to reveal the screen underneath — the same rubber-band/
 *    velocity-flick feel either way.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { CachedImage } from '@/components/CachedImage';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useAnimatedProps,
  ReduceMotion,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { usePathname, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@clerk/expo';
import { SHEET_EASING, SHEET_OPEN_MS, SHEET_CLOSE_MS } from '@/constants/motion';
import { StudioCoverBackdrop, StudioCoverGrain } from '@/components/StudioCardCover';
import Svg, { Path } from 'react-native-svg';

import PlanUpsellModal from '@/components/PlanUpsellModal';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { GROWTH_PLAN_ENFORCEMENT_ENABLED } from '@/lib/growthTools';
import { SELLER_ACTIVITY_ROUTE_LIVE } from '@/lib/sellerActivityRoute';
import { useActivityUnreadCount } from '@/components/ActivityBellButton';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { setNextPushAnimationNone } from '@/lib/navigationAnimationOverride';
import { markStudioTileOpened } from '@/lib/navigation/studioReturn';
import { SCRUB_PX_PER_CARD, indexForDrag } from '@/lib/studioCardCarousel';
import { useFirstRunTip } from '@/hooks/useFirstRunTip';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { getDisplayCornerRadius, insetOutlineCornerRadius } from '@/lib/displayCornerRadius';
import { StudioEdgeChevrons, StudioSwipeCoach } from '@/components/StudioMenuHints';
import {
  ALL_ITEMS,
  type ControlCenterItem,
} from '@/lib/sellerControlCenter';
import { radius } from '@/constants/radii';

export { ALL_ITEMS, SECTIONS, DEFAULT_PINNED_IDS } from '@/lib/sellerControlCenter';
import { STUDIO_MENU_ORIGIN, subscribeStudioMenuReturn } from '@/lib/navigation/studioMenuReturn';

const AnimatedPath = Animated.createAnimatedComponent(Path);

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
  'post-video', 'add-product', 'go-live', 'analytics',
  // '/seller-activity' doesn't exist yet (see lib/sellerActivityRoute.ts) —
  // this only resolves to a real item once that flag flips, at which point
  // CARD_ITEMS below naturally picks it up right after Analytics.
  ...(SELLER_ACTIVITY_ROUTE_LIVE ? ['activity'] : []),
  'payouts', 'customers', 'community',
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
 *  edge-trace) — these govern real interaction feedback and, for the trace
 *  especially, a deliberate real-time "you can still cancel" window, not
 *  pure decoration, so they must keep their actual duration even with
 *  Reduce Motion on (otherwise a reduced-motion user gets the trace
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

/** Exactly how long the edge-trace takes to draw clockwise around a locked
 *  card, and thus how long the "cancel window" lasts before it auto-opens.
 *  A real timed interaction, not decoration — see NO_REDUCE_MOTION above. */
const AUTO_ENTER_MS = 1500;
/** How far the cover slowly pushes in while the trace is drawing (Dev:
 *  "the cover art slowly pushes in"), before the fast zoom-through burst
 *  once the trace closes. One continuous scale value spans both phases. */
const PUSH_IN_SCALE = 1.14;
/** How far the cover scales up in the fast zoom-through burst once the
 *  trace closes, alongside enterFade, right before navigating. Skipped
 *  entirely under Reduce Motion (see triggerZoomEnter). Dev: "a bit
 *  stronger" than the original 2.2 — same 220ms duration (see
 *  triggerZoomEnter), so the extra distance reads as a snappier burst, not
 *  a slower one. */
const ZOOM_THROUGH_SCALE = 2.6;
/** Duration of that zoom-through burst (and its destination fade). */
const ZOOM_BURST_MS = 220;
/** Under Reduce Motion the burst is replaced by a plain fade of this length. */
const REDUCED_MOTION_FADE_MS = 180;
/** The title's exit motion (Dev): over the LAST ~400ms of the push-in/zoom-
 *  through — i.e. starting TITLE_EXIT_MS before the destination fade
 *  completes and ending in the same frame the page disappears — the title
 *  slides up TITLE_EXIT_LIFT_PX and tremors, ramping slow→fast (amplitude
 *  TITLE_TREMOR_AMP_MIN→MAX px, frequency TITLE_TREMOR_HZ_MIN→MAX). Driven
 *  by one UI-thread shared value (labelExit, 0→1, see cardAreaPan's lock
 *  onEnd) and mapped to transforms in CarouselCard's labelPunchStyle.
 *  Reduce Motion keeps the slide, skips the tremor. */
const TITLE_EXIT_MS = 400;
const TITLE_EXIT_LIFT_PX = 12;
const TITLE_TREMOR_AMP_MIN = 1;
const TITLE_TREMOR_AMP_MAX = 2.5;
const TITLE_TREMOR_HZ_MIN = 5;
const TITLE_TREMOR_HZ_MAX = 24;
/** The edge-trace's corner radius is no longer a fixed number: it is the
 *  DEVICE's own display corner radius minus TRACE_INSET (concentric with
 *  the glass — see lib/displayCornerRadius.ts), recomputed from the window
 *  size + safe-area insets on every size change (rotation, iPad split
 *  view). Dev's bug: a fixed 28pt radius drawn 8pt inside a ~55pt iPhone
 *  corner sat outside the visible glass, so all four corners were cut off. */
/** How far the trace rectangle sits inside the card's measured bounds.
 *  Dev: live-inspected at 393x852 and found the path drawn exactly ON the
 *  card edges (x=0 and x=w), so half the stroke fell outside the Svg's own
 *  viewport and the visible half landed on the physical screen edge, where
 *  the device frame/rounded corners hid it — only the top/bottom segments
 *  (mid-screen) ever showed. Must clear strokeWidth/2 plus a margin so the
 *  full stroke paints on-screen on every edge. */
const TRACE_INSET = 8;
/** The trace stroke has no blur/glow filter — its "glow" is the plain 3px
 *  white stroke itself — so the inset only needs to clear strokeWidth/2
 *  (1.5px) with margin. If a blur is ever added, TRACE_INSET must stay
 *  >= strokeWidth/2 + the blur radius or the glow clips at the edges. */
const TRACE_STROKE_WIDTH = 3;

/** Rubber-band resistance for dragging the page up past its resting
 *  position — a diminishing-returns curve (never a hard clamp) that
 *  asymptotically approaches -(dim*c) however far past rest the finger
 *  travels. `value` is always <= 0 here (translateY dragged negative). */
function rubberBandUp(value: number, dim = 100, c = 0.55) {
  'worklet';
  const x = -value;
  return -((x * dim * c) / (dim + c * x));
}

/** Cancel = touching the screen anywhere, or scrubbing to another card
 *  (Dev): the trace retracts quickly and the push/zoom eases back, rather
 *  than a hard cut to nothing. Shared by dismissGesture.onStart and
 *  cardAreaPan.onBegin so a touch anywhere on the page does this
 *  identically. */
function retractEnter(
  traceProgress: SharedValue<number>,
  zoomScale: SharedValue<number>,
  enterFade: SharedValue<number>,
  labelPunchScale: SharedValue<number>,
  labelFlash: SharedValue<number>,
  labelExit: SharedValue<number>,
) {
  'worklet';
  cancelAnimation(traceProgress);
  cancelAnimation(zoomScale);
  cancelAnimation(enterFade);
  cancelAnimation(labelPunchScale);
  cancelAnimation(labelFlash);
  cancelAnimation(labelExit);
  traceProgress.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.quad), ...NO_REDUCE_MOTION });
  zoomScale.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) });
  enterFade.value = 0;
  labelPunchScale.value = 1;
  labelFlash.value = 0;
  // The title eases back down from wherever its exit slide had got to
  // (it only ever starts in the last TITLE_EXIT_MS, so usually from 0).
  labelExit.value = withTiming(0, { duration: 120, easing: Easing.out(Easing.quad), ...NO_REDUCE_MOTION });
}

// ─── Per-card signature micro-animations ───────────────────────────────────────
// One short (~350-450ms), one-shot, ease-out motion per cover subject —
// built entirely from transforms/opacity on the existing icon, never a
// bespoke illustration or a looping/bouncy animation. See CarouselCard's own micro-animation
// reaction for how fast-vs-dwell and Reduce Motion are handled.
type MicroKind =
  | 'swing' | 'pulse-dot' | 'rise' | 'flip' | 'pop-in' | 'rotate-notch'
  | 'slide-click' | 'pie-pop' | 'turn-60' | 'nudge' | 'draw-stroke'
  | 'fade-outline' | 'snip' | 'twinkle' | 'blink' | 'target-pulse';
const MICRO_KIND: Record<string, MicroKind> = {
  'post-video': 'slide-click',   // clapper/frame slides/clicks into place
  'add-product': 'swing',        // hanger swings once and settles
  'go-live': 'pulse-dot',        // the Go Live icon pulses once
  'analytics': 'rise',           // rises from 0 into place
  'activity': 'pop-in',          // pops in
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

/** The header's animated avatar — a moving profile picture, muted and
 *  looped, autoplaying the instant it mounts (mirrors
 *  components/profile/ProfileStoryAvatar.tsx's own AvatarVideo; not reused
 *  directly since that component brings its own story-ring/badge geometry
 *  this plain circular header avatar doesn't need). */
function HeaderAvatarVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  useEffect(() => { player.play(); }, [player]);
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
      testID="seller-studio-header-avatar-video"
    />
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface SellerStudioRadialMenuProps {
  hideTrigger?: boolean;
  openRequestKey?: number;
  /** Incrementing this while the page is open closes it — the Studio tab
   *  button toggles between this and openRequestKey depending on whether
   *  the caller currently thinks the page is open (see onOpenChange). */
  closeRequestKey?: number;
  /** Fired whenever the page's own open/closed state changes, so a parent
   *  (the tab bar) can track it without owning the state itself — used to
   *  toggle the Studio button's own label and which of
   *  openRequestKey/closeRequestKey a re-tap should bump. */
  onOpenChange?: (open: boolean) => void;
}

export default function SellerStudioRadialMenu({
  hideTrigger = false,
  openRequestKey = 0,
  closeRequestKey = 0,
  onOpenChange,
}: SellerStudioRadialMenuProps) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const headerTopInset = useHeaderTopInset();
  const { width: windowWidth, height: screenHeight } = useWindowDimensions();
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
  const resumeCardOnOpenRef = useRef(false);
  const [upsellFeature, setUpsellFeature] = useState<string | null>(null);

  const [brandName, setBrandName] = useState<string | null>(null);
  // The seller's own account name/username — always populated by Clerk at
  // sign-up, unlike brandName (which stays null until the seller explicitly
  // names their store). Used as the header title's fallback instead of a
  // "Name your store" placeholder, per Dev's "fresh seller" screenshot —
  // formatted as "@handle" when it's the bare username with no display name.
  const [accountName, setAccountName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  // A moving profile picture (any account type — see lib/api.ts's
  // avatarVideo namespace and components/profile/ProfileStoryAvatar.tsx's
  // own AvatarVideo, which this reimplements locally rather than importing
  // that component's whole story-ring geometry for a plain circle). Takes
  // priority over the static avatarUrl when set.
  const [avatarVideoUrl, setAvatarVideoUrl] = useState<string | null>(null);

  // ── Store header data — refreshed each time the page opens ────────────────

  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;

    api.seller.getProfile().then((profile) => {
      if (cancelled) return;
      // Real store name only here — NOT merged with the account's own
      // name/username, which is a separate, always-available fallback (see
      // accountName below) rather than being silently treated as the store
      // name. `api.auth.me()`'s profile has no photo field at all, which is
      // why avatarUrl was always null before — api.seller.getProfile() is
      // the endpoint that actually carries profileImageUrl.
      setBrandName(profile?.brandName ?? null);
      setAccountName(profile?.displayName?.trim() || (profile?.username ? `@${profile.username}` : null));
      setAvatarUrl(profile?.profileImageUrl ?? null);
    }).catch(() => {});
    api.avatarVideo.get().then((res) => {
      if (cancelled) return;
      setAvatarVideoUrl(res?.avatarVideoUrl ?? null);
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
  // which cards are mounted at all (and the current-item ref) — that can't be
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
  // ── Auto-enter edge-trace (replaces tap-to-open as the main path) ───────────
  // Dev, replacing the earlier pill/Cancel/Continue button entirely: "the
  // button's making the page look tacky." The moment a card locks:
  //   traceProgress  0→1 over AUTO_ENTER_MS — draws the white edge-trace
  //                  clockwise from top-center; a real timed cancel window,
  //                  not decoration, so it always runs at NO_REDUCE_MOTION.
  //   zoomScale      1 → PUSH_IN_SCALE alongside the trace (the cover
  //                  "slowly pushes in"), then PUSH_IN_SCALE → ZOOM_THROUGH_SCALE
  //                  in a fast burst once the trace closes (the "zooms
  //                  through" into the destination) — one continuous value,
  //                  never reset between the two phases.
  //   enterFade      0→1 during that same final burst — the destination
  //                  fade. Under Reduce Motion, zoomScale never moves at
  //                  all and enterFade is the ONLY completion effect (a
  //                  plain fade), per Dev's "Reduce Motion = the trace only
  //                  + fade".
  // `entering` mirrors "is a trace/zoom currently live" on the JS side,
  // purely so the trace overlay unmounts (not just fades) once a card
  // finishes or is cancelled. Any new touch on the card area/header cancels
  // all three back to their resting values (see cardAreaPan.onBegin /
  // dismissGesture.onStart) — a cancelled trace never carries over to a
  // different card; landing and releasing on any card (even the same one
  // again) always starts a fresh trace.
  const traceProgress = useSharedValue(0);
  const zoomScale = useSharedValue(1);
  const enterFade = useSharedValue(0);
  // The title's own "snap" the instant the zoom-through burst fires (see
  // triggerZoomEnter) — Dev: a quick scale punch plus a brief letter-
  // spacing tighten/brightness flash, in sync with the burst, now that the
  // label itself is rendered outside the card's scaled layer (see
  // CarouselCard below) and no longer needs to fade to avoid clipping.
  const labelPunchScale = useSharedValue(1);
  const labelFlash = useSharedValue(0);
  // The title's exit slide + tremor (see TITLE_EXIT_MS) — 0 at rest, 1 in
  // the frame the page disappears. Armed with a delay the moment a card
  // locks (cardAreaPan's onEnd) so it ends exactly with the destination
  // fade; any cancel eases it back to 0 (retractEnter).
  const labelExit = useSharedValue(0);
  // Live horizontal drag translation while scrubbing (0 when the finger is
  // up) — drives the edge chevrons' brighten/stretch (StudioEdgeChevrons).
  const scrubDragX = useSharedValue(0);
  const [entering, setEntering] = useState(false);

  // ── First-time swipe coach (StudioSwipeCoach) ──────────────────────────────
  // Shown the very first time this ACCOUNT opens the menu, through the
  // app's own first-run tips system (hooks/useFirstRunTip: seen-state is
  // user-scoped — AsyncStorage key `first_run_tips_seen:<userId>`, mirrored
  // to the server so it stays seen across devices/reinstalls — and it
  // never stacks with another tip). Replaces the earlier fullscreen
  // "Scrub through your tools" guide this component rendered OUTSIDE its
  // own Modal, where a native Modal covered it. Dismissed by a tap or the
  // user's first swipe (which still scrubs through — see tapGesture and
  // cardAreaPan below), never by a control of its own.
  // `&demo=1` preview: shows on EVERY open so Dev can see it on demand
  // (`&tips=1` also still forces it, like every other tip).
  const coachTip = useFirstRunTip('studio-menu-swipe-coach', { contentReady: open });
  const coachTipRef = useRef(coachTip);
  coachTipRef.current = coachTip;
  const coachDemoEveryOpen = isPreviewDemoMode();
  const [coachDemoDismissed, setCoachDemoDismissed] = useState(false);
  const coachVisible = open && (coachTip.visible || (coachDemoEveryOpen && !coachDemoDismissed));
  // UI-thread mirror so the gestures can decide "dismiss the coach instead
  // of opening a card" without a JS round-trip.
  const coachActive = useSharedValue(false);
  useEffect(() => { coachActive.value = coachVisible; }, [coachVisible, coachActive]);
  const dismissCoach = useCallback(() => {
    if (coachTipRef.current.visible) coachTipRef.current.dismiss();
    setCoachDemoDismissed(true);
  }, []);

  // ── Per-card micro-animation trigger (see MICRO_KIND above) ─────────────────
  // A global "play token": microTriggerIndex names which card should play,
  // microTriggerSeq increments so that card's own reaction (in CarouselCard)
  // fires exactly once, and microFast decides tiny-pop vs full-signature.
  const microTriggerIndex = useSharedValue(-1);
  const microTriggerSeq = useSharedValue(0);
  const microFast = useSharedValue(false);
  const lastStepAtRef = useRef(0);

  useEffect(() => {
    // Fresh opens start at the first card; returning from a Studio tool resumes
    // the previous selection without rearming its auto-enter timer.
    if (open) {
      if (!resumeCardOnOpenRef.current) {
        cardIndex.value = 0;
        gestureStartIndex.value = 0;
        setCardIndexJS(0);
      }
      resumeCardOnOpenRef.current = false;
      landedPulse.value = 0;
      cancelAnimation(traceProgress);
      traceProgress.value = 0;
      zoomScale.value = 1;
      enterFade.value = 0;
      labelPunchScale.value = 1;
      labelFlash.value = 0;
      labelExit.value = 0;
      scrubDragX.value = 0;
      microTriggerIndex.value = -1;
      microTriggerSeq.value = 0;
      setEntering(false);
      setCardIndexJS(0);
      setCoachDemoDismissed(false);
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

  useEffect(() => subscribeStudioMenuReturn(() => {
    resumeCardOnOpenRef.current = true;
    expand();
  }), [expand]);

  // Only a NEW request (a key that changed since this instance mounted)
  // opens the page. This component is unmounted on full-screen routes
  // (add-product, create-post, plans…) and remounted when they pop; without
  // this guard the mount-time effect saw the stale `openRequestKey > 0`
  // left over from an earlier open and expanded the menu by itself — which
  // is how "Cancel on add product dumps me on the Studio menu" happened.
  const handledOpenKeyRef = useRef(openRequestKey);
  useEffect(() => {
    if (openRequestKey === handledOpenKeyRef.current) return;
    handledOpenKeyRef.current = openRequestKey;
    if (!open) expand();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequestKey]);

  const collapse = useCallback((after?: () => void) => {
    pendingAfterRef.current = after ?? null;
    translateY.value = withTiming(pageHeight, { duration: SHEET_CLOSE_MS, easing: SHEET_EASING, ...NO_REDUCE_MOTION }, (finished) => {
      if (finished) runOnJS(finishClose)();
    });
  }, [translateY, pageHeight, finishClose]);

  /** Cancels the edge-trace/push/zoom and hides it — used by every path that
   *  closes the page WITHOUT opening a card (close button, Android back/
   *  Escape). The gesture-driven paths (a new touch on the card area or
   *  header) do the UI-thread equivalent directly in their own onBegin/
   *  onStart instead, for zero-latency cancellation. */
  const cancelEnter = useCallback(() => {
    cancelAnimation(traceProgress);
    cancelAnimation(zoomScale);
    cancelAnimation(enterFade);
    cancelAnimation(labelExit);
    traceProgress.value = 0;
    zoomScale.value = 1;
    enterFade.value = 0;
    labelExit.value = 0;
    setEntering(false);
  }, [traceProgress, zoomScale, enterFade, labelExit]);

  // Lets the Studio tab button toggle: it bumps openRequestKey when the
  // caller thinks the page is closed and closeRequestKey when it thinks the
  // page is open — onOpenChange below is what keeps that belief in sync
  // with this component's own (otherwise fully internal) `open` state.
  const handledCloseKeyRef = useRef(closeRequestKey);
  useEffect(() => {
    if (closeRequestKey === handledCloseKeyRef.current) return;
    handledCloseKeyRef.current = closeRequestKey;
    if (open) {
      cancelEnter();
      collapse();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeRequestKey]);

  useEffect(() => {
    onOpenChange?.(open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** Release-to-select / tap-to-select: no closing animation at all — the
   *  page is just gone, in the same frame the navigation fires, per spec
   *  ("no slide, fade or delay"). */
  const commitAndOpen = useCallback((item: ControlCenterItem, opts?: { skipHaptic?: boolean }) => {
    // The auto-enter path already fired its own firmer haptic when the
    // trace closed (see triggerZoomEnter) — skip this generic one there so
    // entering doesn't double-buzz. Tap/flick (which never trace) keep it.
    if (!opts?.skipHaptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    cancelAnimation(translateY);
    // Every way of opening a card — a tap, an upward flick, or the trace
    // completing on its own — routes through here, so cancelling the
    // trace/zoom unconditionally means it can never double-fire (e.g. a tap
    // landing right as the trace was about to complete on its own).
    cancelAnimation(traceProgress);
    cancelAnimation(zoomScale);
    cancelAnimation(enterFade);
    cancelAnimation(labelExit);
    traceProgress.value = 0;
    zoomScale.value = 1;
    enterFade.value = 0;
    labelExit.value = 0;
    setEntering(false);
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
    // Retain explicit legacy origin handoffs and the general pop-to-menu tracking.
    markStudioTileOpened(pathname, item.route);
    if (item.id === 'payouts') {
      router.push({ pathname: '/payouts', params: { from: STUDIO_MENU_ORIGIN } });
    } else if (item.id === 'analytics') {
      router.push({ pathname: '/(tabs)/analytics', params: { from: STUDIO_MENU_ORIGIN } });
    } else if (item.id === 'content') {
      router.push({ pathname: '/content', params: { from: STUDIO_MENU_ORIGIN } });
    } else if (item.id === 'community') {
      router.push({ pathname: '/community', params: { from: STUDIO_MENU_ORIGIN } });
    } else {
      router.push(item.route as never);
    }
  }, [translateY, traceProgress, zoomScale, enterFade, labelExit, planLoading, planError, hasPlan, retryPlan, router, pathname]);

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
  const openCurrentItem = useCallback((opts?: { skipHaptic?: boolean }) => {
    commitAndOpenRef.current(currentItemRef.current, opts);
  }, []);

  /** Fires once the edge-trace closes on its own (never on a cancel) —
   *  firmer than the lock tick, distinct from commitAndOpen's own light tap
   *  haptic (which this path skips — see commitAndOpen's skipHaptic). */
  const fireEnterHaptic = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, []);

  /** The trace closed on its own: a firmer haptic, then the fast
   *  zoom-through + fade (or, under Reduce Motion, just the fade), then
   *  navigate. Reused as the withTiming completion callback for
   *  traceProgress in cardAreaPan below. */
  const triggerZoomEnter = useCallback(() => {
    fireEnterHaptic();
    if (reduceMotion) {
      enterFade.value = withTiming(1, { duration: REDUCED_MOTION_FADE_MS, easing: Easing.linear, ...NO_REDUCE_MOTION }, (finished) => {
        if (finished) runOnJS(openCurrentItem)({ skipHaptic: true });
      });
      return;
    }
    zoomScale.value = withTiming(ZOOM_THROUGH_SCALE, { duration: ZOOM_BURST_MS, easing: Easing.in(Easing.cubic) });
    enterFade.value = withTiming(1, { duration: ZOOM_BURST_MS, easing: Easing.linear }, (finished) => {
      if (finished) runOnJS(openCurrentItem)({ skipHaptic: true });
    });
    // The title's own snap, fired in the same instant as the burst above —
    // a quick punch up then a spring settle (~180ms total), plus a brief
    // letter-spacing tighten/brightness flash (labelFlash 0→1→0) that the
    // label's own animated style below maps to letterSpacing/textShadow.
    labelPunchScale.value = withSequence(
      withTiming(1.12, { duration: 70, easing: Easing.out(Easing.quad) }),
      withSpring(1, { damping: 10, stiffness: 180, mass: 0.4 }),
    );
    labelFlash.value = withSequence(
      withTiming(1, { duration: 70, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 110, easing: Easing.in(Easing.quad) }),
    );
  }, [reduceMotion, fireEnterHaptic, zoomScale, enterFade, labelPunchScale, labelFlash, openCurrentItem]);

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
      // A swipe starting on the header counts as the first-time coach's
      // "first swipe" too.
      if (coachActive.value) {
        coachActive.value = false;
        runOnJS(dismissCoach)();
      }
      // A swipe starting on the header should cancel any in-flight
      // edge-trace on the card area below, same as touching the card area
      // itself would (spec: "cancel and close, never navigates").
      retractEnter(traceProgress, zoomScale, enterFade, labelPunchScale, labelFlash, labelExit);
      runOnJS(setEntering)(false);
    })
    .onUpdate((e) => {
      const next = dragStartY.value + e.translationY;
      translateY.value = next >= 0 ? next : rubberBandUp(next);
    })
    .onEnd((e) => {
      runDismissEnd(e);
    }), [translateY, dragStartY, coachActive, dismissCoach, traceProgress, zoomScale, enterFade, labelPunchScale, labelFlash, labelExit, runDismissEnd]);

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
      // cancels any in-flight edge-trace immediately (Dev: "touching the
      // screen anywhere... cancels" — the trace retracts and the carousel
      // continues from that card).
      landedPulse.value = 0;
      scrubDragX.value = 0;
      retractEnter(traceProgress, zoomScale, enterFade, labelPunchScale, labelFlash, labelExit);
      runOnJS(setEntering)(false);
    })
    .onUpdate((e) => {
      if (cardGestureAxis.value === 'none') {
        if (Math.abs(e.translationX) > AXIS_LOCK_PX || Math.abs(e.translationY) > AXIS_LOCK_PX) {
          cardGestureAxis.value = Math.abs(e.translationX) >= Math.abs(e.translationY) ? 'horizontal' : 'vertical';
          // The user's first real swipe is what dismisses the first-time
          // coach — and it still goes through as a normal scrub/dismiss.
          if (coachActive.value) {
            coachActive.value = false;
            runOnJS(dismissCoach)();
          }
        }
      }
      if (cardGestureAxis.value === 'horizontal') {
        scrubDragX.value = e.translationX;
        const next = indexForDrag(gestureStartIndex.value, e.translationX, CARD_ITEMS.length);
        cardIndex.value = withTiming(next, { duration: CARD_STEP_MS, easing: CARD_STEP_EASING, ...NO_REDUCE_MOTION });
      } else if (cardGestureAxis.value === 'vertical') {
        const next = dragStartY.value + e.translationY;
        translateY.value = next >= 0 ? next : rubberBandUp(next);
      }
    })
    .onEnd((e) => {
      // Finger up: the edge chevrons ease back to their resting state.
      scrubDragX.value = withTiming(0, { duration: 160, easing: Easing.out(Easing.quad), ...NO_REDUCE_MOTION });
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
        // Auto-enter: the edge-trace draws clockwise around the card over
        // EXACTLY AUTO_ENTER_MS while it slowly pushes in; when the trace
        // closes, triggerZoomEnter fires the zoom-through/fade and opens
        // the card. onBegin above cancels this the instant any new touch
        // starts, and commitAndOpen cancels it unconditionally on every
        // path that actually opens a card (tap, flick, or the trace
        // completing), so it can never double-fire.
        runOnJS(setEntering)(true);
        traceProgress.value = 0;
        traceProgress.value = withTiming(1, { duration: AUTO_ENTER_MS, easing: Easing.linear, ...NO_REDUCE_MOTION }, (finished) => {
          if (finished) runOnJS(triggerZoomEnter)();
        });
        // Reduce Motion: "the trace only + fade" — the push/zoom never
        // moves at all; triggerZoomEnter's own reduceMotion branch handles
        // the completion fade.
        if (!reduceMotion) {
          zoomScale.value = withTiming(PUSH_IN_SCALE, { duration: AUTO_ENTER_MS, easing: Easing.out(Easing.quad) });
        }
        // The title's exit (slide up + slow→fast tremor): armed now, on the
        // UI thread, to run over exactly the LAST TITLE_EXIT_MS of the whole
        // trace + burst (or trace + reduced-motion fade) — so it ends in
        // the same frame the destination fade completes and the page goes.
        // Always a real-time timing (NO_REDUCE_MOTION): under Reduce Motion
        // the slide still plays; only the tremor is dropped, in
        // labelPunchStyle. Cancelled (eased back) by retractEnter.
        const exitDelayMs = AUTO_ENTER_MS + (reduceMotion ? REDUCED_MOTION_FADE_MS : ZOOM_BURST_MS) - TITLE_EXIT_MS;
        labelExit.value = 0;
        labelExit.value = withDelay(
          exitDelayMs,
          withTiming(1, { duration: TITLE_EXIT_MS, easing: Easing.linear, ...NO_REDUCE_MOTION }),
          ReduceMotion.Never,
        );
      }
      // axis === 'none' here means the Pan never crossed AXIS_LOCK_PX at
      // all before release — too small a movement for this Pan to have
      // even activated (see constraint 2), so it never reaches onEnd for
      // that case; the Race'd tapGesture below handles it instead.
    }), [cardIndex, gestureStartIndex, translateY, dragStartY, cardGestureAxis, landedPulse, scrubDragX, coachActive, dismissCoach, traceProgress, zoomScale, enterFade, labelPunchScale, labelFlash, labelExit, reduceMotion, microFast, microTriggerIndex, microTriggerSeq, runDismissEnd, openCurrentItem, triggerZoomEnter, fireLandedHaptic]);

  // A genuine tap (near-zero movement) — see constraint 2 above for why
  // this can't just be "the Pan's onEnd when its axis never locked".
  const tapGesture = useMemo(() => Gesture.Tap()
    .maxDistance(AXIS_LOCK_PX)
    .onEnd(() => {
      // While the first-time coach is up, a tap dismisses IT — never opens
      // the card underneath by surprise.
      if (coachActive.value) {
        coachActive.value = false;
        runOnJS(dismissCoach)();
        return;
      }
      runOnJS(openCurrentItem)();
    }), [openCurrentItem, coachActive, dismissCoach]);

  const cardAreaGesture = useMemo(
    () => Gesture.Race(cardAreaPan, tapGesture),
    [cardAreaPan, tapGesture],
  );

  const pageAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // ── Edge-trace geometry ──────────────────────────────────────────────────
  // A rounded-rect path starting and ending at top-center so the stroke
  // reveal below draws clockwise from there, per Dev's spec — an SVG
  // <Rect>'s own implicit path always starts at its top-LEFT corner, which
  // is why this is a hand-built <Path> instead. Recomputed only when the
  // measured card area actually changes (see cardAreaSize/onLayout above).
  // The device's own display corner radius (lib/displayCornerRadius.ts) —
  // recomputed on every window-size / inset change (rotation, iPad split
  // view / Stage Manager) so the trace's corners stay concentric with the
  // glass and are never clipped by it, on any device or the web preview.
  const displayCornerRadius = useMemo(
    () => getDisplayCornerRadius({ width: windowWidth, height: screenHeight, insets, platform: Platform.OS }),
    [windowWidth, screenHeight, insets],
  );
  const tracePath = useMemo(() => {
    const { width: w, height: h } = cardAreaSize;
    if (w === 0 || h === 0) return { d: '', length: 0 };
    const left = TRACE_INSET;
    const top = TRACE_INSET;
    const right = w - TRACE_INSET;
    const bottom = h - TRACE_INSET;
    const r = insetOutlineCornerRadius(displayCornerRadius, TRACE_INSET, right - left, bottom - top);
    const cx = (left + right) / 2;
    const d = [
      `M ${cx} ${top}`,
      `L ${right - r} ${top}`,
      `A ${r} ${r} 0 0 1 ${right} ${top + r}`,
      `L ${right} ${bottom - r}`,
      `A ${r} ${r} 0 0 1 ${right - r} ${bottom}`,
      `L ${left + r} ${bottom}`,
      `A ${r} ${r} 0 0 1 ${left} ${bottom - r}`,
      `L ${left} ${top + r}`,
      `A ${r} ${r} 0 0 1 ${left + r} ${top}`,
      `L ${cx} ${top}`,
    ].join(' ');
    const length = 2 * (right - left - 2 * r) + 2 * (bottom - top - 2 * r) + 2 * Math.PI * r;
    return { d, length };
  }, [cardAreaSize, displayCornerRadius]);
  // strokeDasharray is the full path length (one dash spanning it exactly);
  // dashoffset shrinks from that full length to 0 as traceProgress goes
  // 0→1, revealing the stroke from its start point (top-center) clockwise.
  const traceAnimatedProps = useAnimatedProps(() => ({
    strokeDashoffset: tracePath.length * (1 - traceProgress.value),
  }));
  // The destination fade during the final zoom-through burst (or, under
  // Reduce Motion, the ONLY completion effect) — a plain white wash over
  // the card, per Dev's "Reduce Motion = the trace only + fade".
  const enterFadeStyle = useAnimatedStyle(() => ({ opacity: enterFade.value }));

  // ── Derived data ────────────────────────────────────────────────────────────

  const isLocked = (item: ControlCenterItem) =>
    GROWTH_PLAN_ENFORCEMENT_ENABLED && !!item.growthOnly && !planLoading && !planError && !hasPlan('growth');

  const hasStoreName = !!brandName?.trim();
  // The header title always shows something real — the store name once
  // set, else the seller's own display name/@handle — never a bare
  // "Name your store" placeholder, per Dev's header spec (avatar + name
  // only, no subtitle).
  const headerTitle = hasStoreName ? brandName!.trim() : (accountName?.trim() || null);
  const headerMonogram = (hasStoreName ? brandName : accountName?.replace(/^@/, ''))?.trim()?.[0]?.toUpperCase() ?? null;

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
    // Called unconditionally (every card, not just 'activity') per the
    // Rules of Hooks — only actually rendered below for the Activity card,
    // and only when there's something unread to show (Dev: "optional small
    // unread dot ... only if the activity API exposes an unread count").
    const unreadActivityCount = useActivityUnreadCount();

    const cardStyle = useAnimatedStyle(() => {
      const distance = itemIndex - cardIndex.value;
      const absDistance = Math.abs(distance);
      const isCurrent = absDistance < 0.01;
      // landedPulse only ever applies to whichever card is actually
      // dead-center (absDistance ~0) — a neighbor mid-scrub never gets the
      // scale-up, even while landedPulse is still ramping in from the
      // previous card's release. zoomScale (the edge-trace's push-in, then
      // its zoom-through burst on completion) is exactly the same rule —
      // it only ever multiplies the entering card's own scale.
      const landedBoost = isCurrent ? landedPulse.value * 0.05 : 0;
      const pushScale = isCurrent ? zoomScale.value : 1;
      return {
        transform: [
          { translateX: distance * cardSpacing },
          { scale: (1 + landedBoost) * pushScale },
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
    // The cover's own slight brighten while it pushes in (Dev: "the cover
    // art slowly pushes in and brightens slightly") — a thin white wash
    // whose opacity tracks zoomScale's own push-in range, only ever visible
    // on the entering card.
    const pushBrightenStyle = useAnimatedStyle(() => {
      const isCurrent = Math.abs(itemIndex - cardIndex.value) < 0.01;
      return {
        opacity: isCurrent ? interpolate(zoomScale.value, [1, PUSH_IN_SCALE], [0, 0.22], Extrapolation.CLAMP) : 0,
      };
    });
    // Dev (superseding #675's fade-out): the title must stay fully visible
    // and readable through the whole zoom-through burst, all the way to
    // navigation — never fade, never slide. `cardStyle`'s scale transform
    // is centered on the whole card, so content far from center (the label,
    // pinned near the bottom) would otherwise move the most as the burst
    // scales up. Fighting that with an inverse scale on a child of the
    // scaled view only cancels the SIZE change, not the position shift the
    // parent's scale imposes on an off-center child — so instead the label
    // is rendered as its own sibling layer entirely outside the scaled
    // `card` View (see the render below), tracking only the carousel's own
    // horizontal translateX, never cardStyle's scale. It is anchored to a
    // fixed spot above the bottom and genuinely never moves during the
    // burst. labelAnchorStyle below reuses `contentStyle`'s own
    // distance-based fade so a neighboring card's label still disappears
    // the same way during an ordinary scrub.
    const labelAnchorStyle = useAnimatedStyle(() => {
      const distance = itemIndex - cardIndex.value;
      return {
        transform: [{ translateX: distance * cardSpacing }],
        opacity: interpolate(Math.abs(distance), [0.32, 0.48], [1, 0], Extrapolation.CLAMP),
      };
    });
    // The title's own "snap" in sync with the zoom-through burst (see
    // triggerZoomEnter): a quick scale punch (1 → 1.12 → spring back to 1)
    // plus a brief letter-spacing tighten + brightness (glow) flash. Only
    // the entering card's own label ever plays it.
    const labelPunchStyle = useAnimatedStyle(() => {
      const isCurrent = Math.abs(itemIndex - cardIndex.value) < 0.01;
      const punch = isCurrent ? labelPunchScale.value : 1;
      const flash = isCurrent ? labelFlash.value : 0;
      // The exit motion (see TITLE_EXIT_MS): `exit` runs 0→1 over the last
      // TITLE_EXIT_MS. Slide: an ease-out lift of TITLE_EXIT_LIFT_PX. Tremor:
      // amplitude ramps linearly 1→2.5px while the frequency chirps
      // 5→24Hz — the phase is the integral of that rising frequency, so
      // the oscillation itself genuinely accelerates rather than jumping
      // between two fixed speeds. Skipped (slide only) under Reduce Motion.
      const exit = isCurrent ? labelExit.value : 0;
      const lift = -TITLE_EXIT_LIFT_PX * (1 - (1 - exit) * (1 - exit));
      let tremorX = 0;
      let tremorY = 0;
      if (!reduceMotion && exit > 0) {
        const amp = TITLE_TREMOR_AMP_MIN + (TITLE_TREMOR_AMP_MAX - TITLE_TREMOR_AMP_MIN) * exit;
        const seconds = TITLE_EXIT_MS / 1000;
        const phase = 2 * Math.PI * (
          TITLE_TREMOR_HZ_MIN * seconds * exit
          + 0.5 * (TITLE_TREMOR_HZ_MAX - TITLE_TREMOR_HZ_MIN) * seconds * exit * exit
        );
        tremorX = amp * Math.sin(phase);
        tremorY = amp * 0.5 * Math.sin(phase * 0.73 + 1.1);
      }
      return {
        transform: [
          { translateY: lift + tremorY },
          { translateX: tremorX },
          { scale: punch },
        ],
        letterSpacing: interpolate(flash, [0, 1], [0.2, -0.3]),
        textShadowRadius: interpolate(flash, [0, 1], [0, 10]),
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
            // Dev: no red anywhere on Go Live unless it's part of the cover
            // photo itself — this used to pulse a separate red dot + sweep;
            // now just a plain scale pulse on the icon, same as every other
            // "pop" style kind.
            microScale.value = withSequence(
              withTiming(1.12, { duration: 150, easing: Easing.out(Easing.quad) }),
              withTiming(1, { duration: 200, easing: Easing.out(Easing.quad) }),
            );
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
      <React.Fragment>
        <Animated.View
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
              {item.id === 'activity' && unreadActivityCount > 0 && (
                <View style={[styles.cardUnreadDot, { backgroundColor: theme.accent }]} testID="seller-control-center-activity-unread-dot" />
              )}
            </Animated.View>
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.85)']}
              style={styles.cardBottomVignette}
              pointerEvents="none"
            />
          </Animated.View>
          {/* The edge-trace's slight brighten while it pushes in — see
              pushBrightenStyle above. A sibling of cardContent (not inside
              it), so it washes the whole cover, not just the icon/name. */}
          <Animated.View style={[styles.cardBrightenWash, pushBrightenStyle]} pointerEvents="none" />
        </Animated.View>
        {/* The title, deliberately NOT inside the scaled `card` View above —
            see labelAnchorStyle's comment: this is what keeps it fully
            visible and pinned in place through the whole zoom-through
            burst, with its own independent punch/flash on top
            (labelPunchStyle). Same box/size as the card so it lines up with
            the old bottom-anchored position exactly. */}
        <Animated.View
          style={[
            styles.cardLabelLayer,
            { width: cardAreaSize.width, height: cardAreaSize.height },
            labelAnchorStyle,
          ]}
          pointerEvents="none"
        >
          <Animated.Text style={[styles.cardLabel, labelPunchStyle]} numberOfLines={2}>{item.label}</Animated.Text>
        </Animated.View>
      </React.Fragment>
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
        onRequestClose={() => { cancelEnter(); collapse(); }}
      >
        {/* Android draws the OS status bar with the app-wide StatusBar's own
            backgroundColor (see app/_layout.tsx) — without overriding it
            here too, that leaves the current theme's ordinary background
            colour showing behind the notch while this page's own background
            is pure black, a visible seam right where Dev's "no colour step"
            spec means there shouldn't be one. (iOS's `backgroundColor` prop
            is a no-op; statusBarTranslucent above already lets this page's
            own black background show straight through there.) */}
        <StatusBar backgroundColor="#000000" barStyle="light-content" animated />
        {/* The full-screen page itself — no separate backdrop layer: it
            fully covers whatever screen was behind it (Dashboard, Products,
            whichever), sliding up from/down to offscreen. Header and card
            area are SIBLING GestureDetectors, each with its own single
            Gesture.Pan (dismissGesture, cardAreaGesture) — see the block
            comment above cardAreaGesture's definition for why neither is
            ever combined with another Pan via Gesture.Race.
            Dev: the card cover must fill the ENTIRE screen edge to edge —
            no black bars above/below it — with the header and position
            hints floating ON TOP as overlays, not sharing flex space with
            the cover. So `page` itself carries no top/bottom padding
            anymore (that's what carved out the bars): the card area below
            is sized to the full page, and the header/hints are positioned
            absolutely over it instead. */}
        <Animated.View
          style={[styles.page, { height: pageHeight }, pageAnimatedStyle]}
        >
          {/* ── Card carousel — now the page's own full-bleed content,
              edge to edge, top to bottom. Rendered FIRST so the header and
              hint overlays below paint on top of it. ── */}
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
              {/* ── Edge-trace (replaces the old pill/Cancel/Continue button
                  entirely — Dev: "the button's making the page look tacky")
                  A thin white light traces clockwise around the card's full
                  edge from top-center, closing over EXACTLY AUTO_ENTER_MS —
                  see tracePath/traceAnimatedProps above for the geometry and
                  cardAreaPan's onEnd for what starts/cancels it. Always
                  mounted (never conditionally, unlike the old pill) so a
                  cancel's quick retract-to-zero is something to actually
                  see rather than an abrupt unmount; strokeDashoffset simply
                  sits at the full path length — invisible — whenever
                  traceProgress is 0. */}
              {tracePath.d !== '' && (
                <Svg
                  width={cardAreaSize.width}
                  height={cardAreaSize.height}
                  // zIndex matters here: without it, this Svg and the
                  // sibling StudioCoverGrain Svg (also absoluteFill) land in
                  // the same stacking context and the browser (confirmed on
                  // web; this governs native stacking too) renders the
                  // trace's two STRAIGHT vertical edges underneath the
                  // grain despite this Svg being later in the tree — only
                  // the arcs/horizontal edges painted on top. An explicit
                  // zIndex forces its own stacking context above the grain,
                  // fixing all four edges at once (confirmed live: without
                  // this, the trace only ever showed top+bottom).
                  style={[StyleSheet.absoluteFill, { zIndex: 1 }]}
                  pointerEvents="none"
                  testID="seller-studio-entering-trace"
                >
                  <AnimatedPath
                    d={tracePath.d}
                    stroke="#ffffff"
                    strokeWidth={TRACE_STROKE_WIDTH}
                    fill="none"
                    strokeDasharray={tracePath.length}
                    animatedProps={traceAnimatedProps}
                  />
                </Svg>
              )}
              {/* The destination fade during the zoom-through burst (or, under
                  Reduce Motion, the only completion effect at all). */}
              <Animated.View style={[styles.enterFadeWash, enterFadeStyle]} pointerEvents="none" />
              {/* Screen-reader equivalent of the visual trace — there's no
                  button anymore to carry an accessibilityLabel, so a polite
                  live-region announcement is the only way a VoiceOver/
                  TalkBack user learns a card is about to open on its own. */}
              {entering && (
                <Text style={styles.srOnly} accessibilityLiveRegion="polite" accessibilityRole="text">
                  {`Entering ${currentItemRef.current?.label ?? 'page'}`}
                </Text>
              )}
            </View>
          </GestureDetector>

          {/* ── Store header — floats on top of the full-bleed cover below,
              no background of its own (Dev: "legibility via the cover's
              existing dark vignette only, no translucent bars" — the
              cover's own gradient is already darkest at its top/bottom
              extremes, exactly where this sits). Dev's final call: the
              seller's real profile picture (animated if they set one,
              muted + looped) and their real name (store name, else display
              name/@handle — never blank, never a generic bag icon once any
              identity exists) on the left, no subtitle of any kind, and a
              close (X) on the right. Closing is swipe-down (dismissGesture,
              this same GestureDetector), the X itself, Android back
              (Modal's onRequestClose), or tapping the Studio tab button
              again (openRequestKey toggling, see the effect near the top of
              this component). */}
          <GestureDetector gesture={dismissGesture}>
            <View
              style={[styles.header, { position: 'absolute', top: headerTopInset, left: 0, right: 0 }]}
              testID="seller-studio-header"
            >
              <View style={styles.avatar}>
                {avatarVideoUrl ? (
                  <HeaderAvatarVideo uri={avatarVideoUrl} />
                ) : avatarUrl ? (
                  <CachedImage source={{ uri: avatarUrl }} style={styles.avatarImage} />
                ) : headerMonogram ? (
                  <Text style={styles.avatarLetter}>{headerMonogram}</Text>
                ) : (
                  <Feather name="shopping-bag" size={18} color={theme.text} />
                )}
              </View>
              <View style={styles.headerTextBlock}>
                <Text style={styles.storeName} numberOfLines={1}>{headerTitle ?? 'Your store'}</Text>
              </View>
              <Pressable
                onPress={() => {
                  // Under the first-time coach's scrim the X dismisses the
                  // coach first — never closes the page from under it.
                  if (coachVisible) { dismissCoach(); return; }
                  cancelEnter(); hapticDismiss(); collapse();
                }}
                accessibilityRole="button"
                accessibilityLabel="Close Studio tools"
                testID="seller-studio-menu-close"
                style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
              >
                <Feather name="x" size={20} color={theme.text} />
              </Pressable>
            </View>
          </GestureDetector>

          {/* ── Persistent swipe hint: tiny ‹ › chevrons pinned to the left/
              right screen edges at mid-height (replaces the old row of
              position dots at the bottom, now removed entirely). Reads the
              carousel's live index and drag directly on the UI thread; never
              takes a touch. See components/StudioMenuHints.tsx. ── */}
          <StudioEdgeChevrons
            cardIndex={cardIndex}
            cardCount={CARD_ITEMS.length}
            dragX={scrubDragX}
            dragPxPerCard={SCRUB_PX_PER_CARD}
            insetLeft={insets.left}
            insetRight={insets.right}
            reduceMotion={reduceMotion}
          />

          {/* ── First-time coach mark (see coachVisible above): rendered
              INSIDE the page so it sits over everything, header and X
              included; pointerEvents none, so the gestures underneath both
              dismiss it and still go through. ── */}
          <StudioSwipeCoach visible={coachVisible} reduceMotion={reduceMotion} />
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
    borderRadius: radius.sm,
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
    // Dev: fills the ENTIRE screen now, edge to edge — the header and
    // edge chevrons are separate absolutely-positioned overlays on top of
    // this (see the render below), not flex siblings carving space out of
    // it. That also means the edge-trace (sized to this View's own
    // measured bounds) now outlines the whole screen, header and chevrons
    // included, not just the space between them.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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
  // The edge-trace's own slight brighten while it pushes in — see
  // pushBrightenStyle; a plain white wash, opacity-only.
  cardBrightenWash: { ...StyleSheet.absoluteFill, backgroundColor: '#ffffff' },
  // The title's own layer, a sibling of `card` (not a child) so the card's
  // zoom-through scale never touches it — see labelAnchorStyle's comment on
  // CarouselCard. Same box, same bottom-anchored position cardLabel always
  // had inside the old cardContent (flex-end + the same paddingBottom).
  cardLabelLayer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: SP.xl,
  },
  cardLabel: {
    // Dropped from 24/bold — Dev: a large bottom title was reading like a
    // second button. The edge-trace is the subtle entry indicator instead.
    // Semibold at 20 still reads clearly as a title, not a control.
    fontSize: 20,
    fontFamily: FONT.semibold,
    color: theme.text,
    textAlign: 'center',
    letterSpacing: 0.2,
    wordWrap: 'normal',
    // textShadowRadius is animated (labelPunchStyle, the burst-sync
    // brightness flash) — color/offset stay fixed so only the radius pulse
    // reads as a glow.
    textShadowColor: '#ffffff',
    textShadowOffset: { width: 0, height: 0 },
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
  // A presence-only dot (no count) — Dev's own call for this one: "optional
  // small unread dot", not a numbered badge like ActivityBellButton's own.
  cardUnreadDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 10,
    height: 10,
    borderRadius: 5,
  },

  // The destination fade during the zoom-through burst — see enterFadeStyle.
  enterFadeWash: { ...StyleSheet.absoluteFill, backgroundColor: '#ffffff' },
  // Visually invisible but still reachable by VoiceOver/TalkBack — see the
  // live-region announcement above.
  srOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
});
