/**
 * Brandthread Design System — Glass (Apple Liquid Glass sweep)
 *
 * ONE shared glass primitive for every "grayish transparency behind it to
 * emphasize something" surface in the app: floating chrome over photo/video
 * (capsules, pills, icon buttons), pressed/hover highlights, sheet grabbers.
 * Replaces the ad-hoc `BlurView` + flat `rgba(...)` fill each of those grew
 * independently (IconButton's `GlassBlur`, GlassPanel, SegmentedControl's
 * `glass` variant) with one backdrop that matches iOS 26's Liquid Glass:
 * clear/refractive blur, a bright specular hairline along the top edge, a
 * soft inner glow, and content still visibly moving behind it — not a flat
 * gray fill.
 *
 * Backdrop, by platform:
 * - iOS 26+: the real thing — `expo-glass-effect`'s native `GlassView`
 *   (`isLiquidGlassAvailable()` gates this so older iOS never gets an API
 *   that doesn't exist there).
 * - Older iOS / Android (SDK 31+, where `expo-blur`'s native blur is
 *   supported): `expo-blur` `BlurView` + a specular `LinearGradient` edge +
 *   a 1px translucent border, imitating the same material by hand.
 * - Android < 31 / anywhere `expo-blur` isn't available: a tuned
 *   translucent fallback (no blur) — cheap, and still reads as "glass" via
 *   the specular edge + border, just without the live refraction.
 * - Web: CSS `backdrop-filter: blur() saturate()` (same specular edge),
 *   since neither native module exists there.
 *
 * `require`s for `expo-glass-effect`/`expo-blur` are lazy, at first render —
 * same reasoning as the components this replaces: a screen that never
 * renders a `<Glass>` shouldn't pull either native module into its bundle.
 */
import React from 'react';
import { Animated, Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { RADII } from '@/constants/radii';
import { FADE_MS, PRESS_DURATION_MS, PRESS_SCALE, pressScaleAnim } from '@/constants/motion';

export type GlassVariant =
  /** Standard frosted material — the default for chrome floating over photo/video. */
  | 'regular'
  /** Lighter/more transparent — for a control that should recede, or sit over already-busy content. */
  | 'clear'
  /** `regular`'s material plus a baked-in bright highlight, for a control's
   *  resting "selected/active" look (e.g. a segmented control's indicator)
   *  rather than an animated press state. */
  | 'pressed';

/** Which side of the app's own content this glass sits over — picks the
 *  backdrop tint and specular brightness. `dark` (default) is for chrome
 *  over photo/video/gradient; `light` is for glass sitting on a bright
 *  themed surface. */
export type GlassTint = 'dark' | 'light';

export interface GlassProps {
  variant?: GlassVariant;
  tint?: GlassTint;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  /** Disables the backdrop blur/native-glass entirely, keeping only the
   *  translucent fill + specular edge — for list rows and other
   *  high-repetition contexts where a live blur per-instance would be a
   *  real performance cost (see the perf note in Glass.tsx's sweep PR). */
  noBlur?: boolean;
  pointerEvents?: ViewStyle extends { pointerEvents?: infer P } ? P : never;
  testID?: string;
}

/** Animated 0→1 value (see `usePressHighlight` below) driving a glass
 *  highlight that fades+scales in on press, replacing a flat gray flash. */
export function GlassPressHighlight({ progress, tint = 'dark', radius = RADII.pill }: { progress: Animated.Value; tint?: GlassTint; radius?: number }) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { borderRadius: radius, opacity: progress },
        tint === 'dark' ? styles.highlightDark : styles.highlightLight,
      ]}
    />
  );
}

/** Standard press handlers for a glass highlight: fades opacity 0→1 and the
 *  glass scales via `pressScaleAnim` (the app-wide critically-damped
 *  press-scale spring — see constants/motion.ts), applied to the highlight
 *  instead of a gray ripple/overlay. No bounce in either direction. */
export function useGlassPress() {
  const progress = React.useRef(new Animated.Value(0)).current;
  const scale = React.useRef(new Animated.Value(1)).current;
  const nativeDriver = Platform.OS !== 'web';
  const onPressIn = React.useCallback(() => {
    Animated.parallel([
      Animated.timing(progress, { toValue: 1, duration: PRESS_DURATION_MS, useNativeDriver: nativeDriver }),
      pressScaleAnim(scale, PRESS_SCALE),
    ]).start();
  }, [progress, scale, nativeDriver]);
  const onPressOut = React.useCallback(() => {
    Animated.parallel([
      Animated.timing(progress, { toValue: 0, duration: FADE_MS, useNativeDriver: nativeDriver }),
      pressScaleAnim(scale, 1),
    ]).start();
  }, [progress, scale, nativeDriver]);
  return { progress, scale, onPressIn, onPressOut };
}

export function Glass({ variant = 'regular', tint = 'dark', radius = RADII.pill, style, children, noBlur = false, pointerEvents, testID }: GlassProps) {
  return (
    <View testID={testID} pointerEvents={pointerEvents} style={[{ borderRadius: radius, overflow: 'hidden' }, style]}>
      <GlassBackdrop variant={variant} tint={tint} noBlur={noBlur} radius={radius} />
      <LinearGradient
        pointerEvents="none"
        colors={tint === 'dark' ? SPECULAR_DARK : SPECULAR_LIGHT}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.55 }}
        style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}
      />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: 1, borderColor: tint === 'dark' ? BORDER_DARK : BORDER_LIGHT }]} />
      {variant === 'pressed' && <GlassPressHighlight progress={ALWAYS_ON} tint={tint} radius={radius} />}
      {children}
    </View>
  );
}

// A constant Animated.Value pinned at 1, so `variant="pressed"` can reuse
// GlassPressHighlight's rendering (opacity: progress) for a static highlight
// instead of duplicating its style logic.
const ALWAYS_ON = new Animated.Value(1);

const SPECULAR_DARK = ['rgba(255,255,255,0.30)', 'rgba(255,255,255,0)'] as const;
const SPECULAR_LIGHT = ['rgba(255,255,255,0.65)', 'rgba(255,255,255,0)'] as const;
const BORDER_DARK = 'rgba(255,255,255,0.22)';
const BORDER_LIGHT = 'rgba(255,255,255,0.55)';

function GlassBackdrop({ variant, tint, noBlur, radius }: { variant: GlassVariant; tint: GlassTint; noBlur: boolean; radius: number }) {
  const clear = variant === 'clear';
  // Each backdrop layer carries the glass's own radius rather than relying
  // on the root's `overflow: hidden` alone — on web a composited ancestor
  // (e.g. a transformed tab bar) can drop that clip for backdrop-filter
  // children and leave square corners showing.
  const rounded = { borderRadius: radius, overflow: 'hidden' } as const;

  if (Platform.OS === 'ios' && !noBlur) {
    const native = requireLiquidGlass();
    if (native?.isLiquidGlassAvailable()) {
      const { GlassView } = native;
      return (
        <GlassView
          glassEffectStyle={clear ? 'clear' : 'regular'}
          style={[StyleSheet.absoluteFill, rounded]}
        />
      );
    }
  }

  if (Platform.OS === 'web') {
    // react-native-web passes unrecognized style keys straight through to
    // the DOM node's CSS, which is how `backdropFilter` reaches the browser
    // here — RN's own StyleSheet types don't know this property, hence the
    // cast.
    return (
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          rounded,
          { backgroundColor: tint === 'dark' ? 'rgba(18,18,20,0.30)' : 'rgba(255,255,255,0.38)' },
          {
            backdropFilter: `blur(${clear ? 14 : 22}px) saturate(1.6)`,
            WebkitBackdropFilter: `blur(${clear ? 14 : 22}px) saturate(1.6)`,
          } as unknown as ViewStyle,
        ]}
      />
    );
  }

  if (!noBlur) {
    const blur = requireBlurView();
    if (blur) {
      const { BlurView } = blur;
      return (
        <>
          <BlurView
            intensity={clear ? 26 : 42}
            tint={tint}
            // Real blur only on Android 12+ (dimezisBlurViewSdk31Plus falls
            // back to 'none' below that) — the perf-sensitive tier this
            // sweep's guidance calls for, not the heavier unconditional
            // dimezisBlurView method.
            experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurViewSdk31Plus' : undefined}
            style={[StyleSheet.absoluteFill, rounded]}
          />
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              rounded,
              { backgroundColor: tint === 'dark' ? `rgba(10,10,11,${clear ? 0.14 : 0.22})` : `rgba(255,255,255,${clear ? 0.20 : 0.30})` },
            ]}
          />
        </>
      );
    }
  }

  // No blur available (or explicitly opted out for a high-repetition
  // context) — the tuned translucent-only fallback. Still reads as glass
  // via the specular edge + border `Glass` layers on top of this.
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        rounded,
        { backgroundColor: tint === 'dark' ? `rgba(10,10,11,${clear ? 0.24 : 0.40})` : `rgba(255,255,255,${clear ? 0.32 : 0.50})` },
      ]}
    />
  );
}

type LiquidGlassModule = typeof import('expo-glass-effect');
let liquidGlassModule: LiquidGlassModule | null | undefined;
function requireLiquidGlass(): LiquidGlassModule | null {
  if (liquidGlassModule !== undefined) return liquidGlassModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    liquidGlassModule = require('expo-glass-effect') as LiquidGlassModule;
  } catch {
    liquidGlassModule = null;
  }
  return liquidGlassModule;
}

type BlurModule = typeof import('expo-blur');
let blurModule: BlurModule | null | undefined;
function requireBlurView(): BlurModule | null {
  if (blurModule !== undefined) return blurModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    blurModule = require('expo-blur') as BlurModule;
  } catch {
    blurModule = null;
  }
  return blurModule;
}

const styles = StyleSheet.create({
  highlightDark: { backgroundColor: 'rgba(255,255,255,0.16)' },
  highlightLight: { backgroundColor: 'rgba(255,255,255,0.40)' },
});
