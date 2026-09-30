/**
 * EngagementButton — Thread action-rail micro-interaction component
 *
 * Compact in-flight, success, and error states for like, save, repost, follow.
 * - Prevents duplicate taps while request is in-flight (inflight guard)
 * - Retains optimistic state; rolls back only on confirmed failure
 * - Shows concise inline "toast" banner (FeedToast) instead of Alert
 * - Uses theme tokens exclusively (no arbitrary colors)
 * - Fully accessible: accessibilityLabel, accessibilityState, accessibilityRole
 */

import React, {
  useRef,
  useState,
  useCallback,
  useEffect,
  createContext,
  useContext,
} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Platform,
} from 'react-native';
import { Feather, FontAwesome } from '@expo/vector-icons';
import Reanimated, {
  Easing as ReanimatedEasing, useAnimatedStyle, useSharedValue, withSequence, withTiming,
} from 'react-native-reanimated';
import type { FeatherNames } from '@/lib/featherNames';
import { TickingCount } from '@/components/ui/TickingCount';
import { IconFillTransition } from '@/components/ui/IconFillTransition';
import { useHitAreaBoost } from '@/hooks/useHitAreaBoost';
import { useColors } from '@/hooks/useColors';
import {
  FONT,
  FS,
  SP,
  RADIUS,
  RED,
  SUCCESS,
  ANIM,
} from '@/lib/theme';
export { formatCount } from '@/lib/engagementUtils';

// ─── FeedToast ───────────────────────────────────────────────────────────────
// Lightweight, non-disruptive banner for engagement feedback.
// Positioned above the tab bar in the SpotlightPage's rail area.

interface ToastEntry {
  id: number;
  message: string;
  variant: 'error' | 'info';
}

interface FeedToastContextValue {
  showToast: (message: string, variant?: ToastEntry['variant']) => void;
}

export const FeedToastContext = createContext<FeedToastContextValue | null>(null);

let _toastId = 0;

export function FeedToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const showToast = useCallback(
    (message: string, variant: ToastEntry['variant'] = 'error') => {
      const id = ++_toastId;
      setToasts(prev => [...prev.slice(-1), { id, message, variant }]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 3200);
    },
    [],
  );

  return (
    <FeedToastContext.Provider value={{ showToast }}>
      {children}
      {toasts.map(t => (
        <FeedToastBanner key={t.id} entry={t} />
      ))}
    </FeedToastContext.Provider>
  );
}

function FeedToastBanner({ entry }: { entry: ToastEntry }) {
  const colors = useColors();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: ANIM.fast, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: ANIM.fast, useNativeDriver: true }),
    ]).start();
    const hide = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: ANIM.fast, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 8, duration: ANIM.fast, useNativeDriver: true }),
      ]).start();
    }, 2700);
    return () => clearTimeout(hide);
  }, []);

  const isError = entry.variant === 'error';

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[
        toastStyles.banner,
        isError ? toastStyles.errorBanner : [toastStyles.infoBanner, { backgroundColor: colors.card, borderColor: colors.border }],
        { opacity, transform: [{ translateY }] },
      ]}
      pointerEvents="none"
    >
      <Feather
        name={isError ? 'alert-circle' : 'check-circle'}
        size={14}
        color={isError ? RED : SUCCESS}
        style={{ marginRight: 6 }}
      />
      <Text style={[toastStyles.text, { color: colors.foreground }]} numberOfLines={2}>{entry.message}</Text>
    </Animated.View>
  );
}

const toastStyles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 110,
    borderRadius: RADIUS.sm,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.sm + 4,
    paddingVertical: SP.sm,
    borderWidth: 1,
    zIndex: 9999,
    elevation: 9999,
  },
  errorBanner: {
    backgroundColor: '#1a0d0d',
    borderColor: RED,
  },
  infoBanner: {},
  text: {
    flex: 1,
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    lineHeight: 17,
  },
});

// ─── useFeedToast ─────────────────────────────────────────────────────────────

export function useFeedToast() {
  const ctx = useContext(FeedToastContext);
  // Graceful fallback when provider is absent (tests / isolated usage)
  return ctx ?? { showToast: (_msg: string, _variant?: ToastEntry['variant']) => {} };
}

// ─── EngagementButton ────────────────────────────────────────────────────────

export type EngagementButtonAction = () => Promise<void>;

export interface EngagementButtonProps {
  /** Feather icon name shown in the default/active state */
  icon: FeatherNames;
  /** Feather icon name shown when active (toggled on). Defaults to icon. */
  activeIcon?: FeatherNames;
  /** Optional solid Font Awesome icon used instead of the Feather outline icon. */
  solidIcon?: React.ComponentProps<typeof FontAwesome>['name'];
  /** Formatted count label (see lib/engagementUtils#formatCount — pass its
   *  output directly, including the empty string it returns for 0).
   *  Passing a string (even "") always reserves the count row's layout
   *  space; omit the prop entirely only when this button has no count
   *  concept at all. Ignored when `value` is also passed — see below. */
  count?: string;
  /** Raw (unformatted) count. When present, the count renders through
   *  TickingCount instead of a plain Text — a Reanimated odometer-style
   *  roll plays whenever this changes (e.g. a like/save toggling the
   *  count by ±1), instead of an instant text swap. `count` is still
   *  required for accessibility/layout purposes but its string is not
   *  displayed directly in this case (TickingCount formats `value` itself
   *  so it can diff the previous/next display strings). */
  value?: number;
  /** Whether the button is in the "active" (liked/saved/reposted/following) state */
  active?: boolean;
  /** Color of the icon when active. Defaults to '#FFFFFF'. */
  activeColor?: string;
  /** Color of the icon when inactive. Defaults to '#FFFFFF'. */
  inactiveColor?: string;
  /** Accessible label, e.g. "Like, 42 likes" */
  accessibilityLabel: string;
  /** Accessible state, e.g. { checked: true } for toggle buttons */
  accessibilityState?: { checked?: boolean; busy?: boolean };
  /** Full async action to call on press. EngagementButton handles in-flight guard. */
  onPress: EngagementButtonAction;
  /** Optional long-press handler (e.g. open the "Save to…" collection sheet). Does not affect the tap animation/state. */
  onLongPress?: () => void;
  /** Extra hitSlop beyond default */
  hitSlop?: { top: number; bottom: number; left: number; right: number };
  /** Scale the icon and count (1 = default rail size) */
  iconSize?: number;
  /** Additional style for the wrapper View */
  style?: object;
  /** Animated.Value from parent for the scale animation (e.g. heart bump) */
  scaleAnim?: Animated.Value;
  /** Animated.Value (0→1) from parent, interpolated to a spin — e.g. repost's arrows morphing. */
  rotateAnim?: Animated.Value;
  /** Animated.Value from parent for a vertical drop/settle — e.g. save's bookmark. */
  translateYAnim?: Animated.Value;
  /** testID for automated tests */
  testID?: string;
  /** Plays a Reanimated 0.85 -> 1.1 -> 1 squash/overshoot/settle spring on
   *  the icon once per accepted press (i.e. once per actual like action,
   *  not on every press-down/press-up — this is separate from any general
   *  press-feedback scale a wrapping Pressable might apply). Scoped to the
   *  like button; this specific overshoot is a deliberate exception to the
   *  app's general no-bounce rule, not a violation of it.
   *  Mobbin reference: Instagram, "Liking a post" flow —
   *  https://mobbin.com/flows/44abedc0-7d76-410b-9db0-5f1f4be27414 */
  tapSpring?: boolean;
  /** Crossfades between `icon` (outline) and `solidIcon` (solid) on
   *  `active` change instead of swapping instantly — see
   *  IconFillTransition. Requires both `icon` and `solidIcon`. */
  iconFillTransition?: boolean;
}

const LIKE_SPRING_DOWN_MS = 70;
const LIKE_SPRING_UP_MS = 110;
const LIKE_SPRING_SETTLE_MS = 130;

/**
 * Self-contained rail button with:
 * - in-flight deduplication (inflight ref, never double-fires)
 * - subtle opacity pulse during pending state
 * - no count update until action resolves (optimism stays in parent EngagementState)
 * - error/success feedback via FeedToastContext when provided
 */
export function EngagementButton({
  icon,
  activeIcon,
  solidIcon,
  count,
  value,
  active = false,
  activeColor = '#FFFFFF',
  inactiveColor = '#FFFFFF',
  accessibilityLabel,
  accessibilityState,
  onPress,
  onLongPress,
  hitSlop = { top: 6, bottom: 6, left: 10, right: 10 },
  iconSize = 27,
  style,
  scaleAnim,
  rotateAnim,
  translateYAnim,
  testID,
  tapSpring = false,
  iconFillTransition = false,
}: EngagementButtonProps) {
  const inflight = useRef(false);
  const [pending, setPending] = useState(false);
  // Pads the real tap area up to 44x44 without changing the rail's tight,
  // icon-plus-count visual footprint — see useHitAreaBoost's doc comment for
  // why this (not `hitSlop` alone) is needed on web.
  const { boostStyle, onLayout: onHitAreaLayout } = useHitAreaBoost();
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseRef = useRef<Animated.CompositeAnimation | null>(null);
  // Like-icon-only spring (see `tapSpring` doc above). Reanimated shared
  // value, driven on the UI thread — independent of `pulseAnim`/`scaleAnim`
  // above, which are the classic-Animated pending-pulse and parent-driven
  // heart-burst effects respectively.
  const likeSpringScale = useSharedValue(1);
  // Deliberately NOT identityOrNone here: this transform continuously moves
  // through non-identity values before returning to identity, and on web
  // that "undefined transform key at rest" optimization can leave the last
  // real (near-but-not-exactly-1) value stuck in the DOM instead of
  // resolving to a clean identity — Reanimated's web style patcher treats
  // an `undefined` style value as "leave whatever's already applied," not
  // "clear it." RightActionRail's existing classic-Animated icon wrappers
  // (heartScale/repostScale/saveScale) already carry a plain
  // `transform: scale(1)` at rest with no ill effect, so this matches that
  // established convention instead.
  const likeSpringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: likeSpringScale.value }],
  }));

  // Pulse opacity while pending. `pulseSettled` tracks whether the pulse is
  // truly at rest (opacity===1, not pending) — text-crispness fix: the
  // rail's count/icon used to sit inside an `Animated.View` carrying
  // `opacity: pulseAnim` at ALL times, including the vast majority of the
  // button's life when it isn't pending at all (opacity pinned at the
  // identity value 1). An identity `opacity`/`transform` style still forces
  // react-native-web to promote that node to its own compositing layer (see
  // lib/animationUtils.ts), which can soften the count/icon text painted
  // inside it. `innerContent` below only renders the Animated wrapper while
  // `pulseSettled` is false.
  const [pulseSettled, setPulseSettled] = useState(true);
  useEffect(() => {
    if (pending) {
      setPulseSettled(false);
      pulseRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.45, duration: 450, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 450, useNativeDriver: true }),
        ]),
      );
      pulseRef.current.start();
    } else {
      pulseRef.current?.stop();
      pulseRef.current = null;
      Animated.timing(pulseAnim, { toValue: 1, duration: ANIM.fast, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setPulseSettled(true);
      });
    }
  }, [pending]);

  const handlePress = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    setPending(true);
    // Fires once per accepted press — before awaiting the async action, so
    // it reads as instant/optimistic like the rest of the rail's tap
    // feedback — never on the underlying Pressable's own down/up events.
    if (tapSpring) {
      likeSpringScale.value = withSequence(
        withTiming(0.85, { duration: LIKE_SPRING_DOWN_MS, easing: ReanimatedEasing.in(ReanimatedEasing.quad) }),
        withTiming(1.1, { duration: LIKE_SPRING_UP_MS, easing: ReanimatedEasing.out(ReanimatedEasing.quad) }),
        // Snaps to exactly 1 once the settle leg reports finished — guards
        // against the sub-percent residual a JS-driven, rAF-stepped easing
        // curve can otherwise leave behind at rest (seen on web).
        withTiming(1, { duration: LIKE_SPRING_SETTLE_MS, easing: ReanimatedEasing.out(ReanimatedEasing.cubic) }, (finished) => {
          'worklet';
          if (finished) likeSpringScale.value = 1;
        }),
      );
    }
    try {
      await onPress();
    } finally {
      inflight.current = false;
      setPending(false);
    }
  }, [onPress, tapSpring, likeSpringScale]);

  const displayIcon = active && activeIcon ? activeIcon : icon;
  const iconColor = active ? activeColor : inactiveColor;
  // Same subtle drop shadow as the count label below it (ebStyles.count) —
  // without it, thin-stroke glyphs like retweet/share read as washed-out
  // outlines against bright footage even at full white/opacity 1, while
  // bulkier glyphs like heart happen to still read fine unshadowed. Applying
  // it to every rail icon keeps all five visually consistent.
  let iconNode: React.ReactNode;
  if (iconFillTransition && solidIcon) {
    iconNode = (
      <IconFillTransition
        outlineName={icon}
        solidName={solidIcon}
        size={iconSize}
        active={active}
        activeColor={activeColor}
        inactiveColor={inactiveColor}
        style={ebStyles.iconShadow}
      />
    );
  } else {
    iconNode = solidIcon
      ? <FontAwesome name={solidIcon} size={iconSize} color={iconColor} style={ebStyles.iconShadow} />
      : <Feather name={displayIcon} size={iconSize} color={iconColor} style={ebStyles.iconShadow} />;
  }
  if (tapSpring) {
    iconNode = <Reanimated.View style={likeSpringStyle}>{iconNode}</Reanimated.View>;
  }

  const iconTransform: (
    | { scale: Animated.Value }
    | { rotate: Animated.AnimatedInterpolation<string> }
    | { translateY: Animated.AnimatedInterpolation<number> }
  )[] = [];
  if (scaleAnim) iconTransform.push({ scale: scaleAnim });
  if (rotateAnim) {
    iconTransform.push({ rotate: rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) });
  }
  if (translateYAnim) {
    iconTransform.push({
      translateY: translateYAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -6, 0] }),
    });
  }

  const railChildren = (
    <>
      {iconTransform.length > 0 ? (
        <Animated.View style={{ transform: iconTransform }}>
          {iconNode}
        </Animated.View>
      ) : (
        iconNode
      )}
      {value !== undefined ? (
        <TickingCount value={value} style={[ebStyles.count, { color: '#FFFFFF' }]} />
      ) : count !== undefined && (
        <Text style={[ebStyles.count, { color: '#FFFFFF' }]}>{count}</Text>
      )}
    </>
  );
  // Plain `View` (no `opacity` key at all) once the pulse is at rest, instead
  // of an `Animated.View` permanently pinned at `opacity: 1` — see
  // `pulseSettled`'s doc comment above.
  const innerContent = pulseSettled
    ? <View style={style}>{railChildren}</View>
    : <Animated.View style={[{ opacity: pulseAnim }, style]}>{railChildren}</Animated.View>;

  return (
    <TouchableOpacity
      style={[ebStyles.btn, boostStyle]}
      onLayout={onHitAreaLayout}
      activeOpacity={0.7}
      hitSlop={hitSlop}
      onPress={handlePress}
      onLongPress={onLongPress}
      disabled={pending}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: pending, ...accessibilityState }}
      testID={testID}
    >
      {innerContent}
    </TouchableOpacity>
  );
}

const ebStyles = StyleSheet.create({
  btn: { alignItems: 'center', gap: 3 },
  // Same size/weight/shadow as the rail's plain (non-EngagementButton) counts
  // — see RightActionRail's own `count` style — so every unit in the rail
  // reads as one consistent row: 12pt semibold, pure white, identical
  // shadow, whether the count is under a bright or a dark patch of video.
  //
  // TikTok-style legibility pass (still-washed-out round, live Replit
  // preview at 390x844 over the Atelier Noire runway clip's bright floor):
  // a single shadow, however strong, is a tradeoff between a soft wash that
  // disappears on bright footage and a hard ring that reads as an outline
  // on dark footage. TikTok's own treatment stacks two: a tight, dark
  // shadow that hugs the glyph edge (definition on ANY background) plus a
  // wider, softer one that reads as an ambient hold-down (the actual
  // "legible on bright video" lift). RN's `Text` shadow props
  // (textShadowColor/Offset/Radius) can only express one layer, so native
  // keeps a single strengthened shadow (0.85/radius 6, up from
  // 0.75/radius 4) — still comfortably more than #324's pass — while web
  // gets the real two-layer stack via a raw CSS `textShadow` string.
  // react-native-web forwards unrecognized style keys straight to the DOM
  // node's CSS (see components/ui/Glass.tsx's `backdropFilter` for the
  // same technique), so this reaches the browser untouched; RN's own
  // `StyleSheet.create` types don't know the property, hence the cast.
  count: Platform.select({
    web: {
      fontSize: 12, lineHeight: 15, fontFamily: FONT.semibold, textAlign: 'center',
      textShadow: '0px 1px 1px rgba(0,0,0,0.9), 0px 1px 6px rgba(0,0,0,0.55)',
    } as object,
    default: {
      fontSize: 12, lineHeight: 15, fontFamily: FONT.semibold, textAlign: 'center',
      textShadowColor: 'rgba(0,0,0,0.85)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
    },
  }),
  // Matches RightActionRail's own `iconShadow` — see that file's comment
  // for why this was strengthened again (bug-fix round: repost/save/share
  // — the thinner-stroke FontAwesome glyphs, with far less filled ink area
  // than heart/comment's bold shapes — were reading grey/washed-out
  // against a bright, high-key clip even with the previous 0.7/radius-6
  // shadow). See `count` above for the two-layer web / single-layer native
  // split this now uses.
  iconShadow: Platform.select({
    web: {
      textShadow: '0px 1px 2px rgba(0,0,0,0.9), 0px 2px 10px rgba(0,0,0,0.6)',
    } as object,
    default: {
      textShadowColor: 'rgba(0,0,0,0.85)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8,
    },
  }),
});

