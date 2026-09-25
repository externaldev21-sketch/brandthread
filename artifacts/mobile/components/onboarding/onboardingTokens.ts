/**
 * Onboarding design tokens — type scale, 8pt spacing, motion curves and the
 * "stitch" haptic. Colors are never defined here: every screen reads them
 * from the active Brandthread theme (`useAppTheme()`), so all 12 themes keep
 * working and the thread stays the theme's own near-white `text` color.
 */
import { useCallback } from 'react';
import { Platform, type TextStyle } from 'react-native';
import { Easing, useReducedMotion } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

/** Brandthread type scale for the onboarding flow (Inter). */
export const TYPE = {
  /** One-idea hero lines: Welcome, Success. */
  display: { fontSize: 44, lineHeight: 48, fontFamily: 'Inter_700Bold', letterSpacing: -1.6 } satisfies TextStyle,
  /** Step questions — display weight, sized so two short lines fit a 375pt phone. */
  headline: { fontSize: 36, lineHeight: 40, fontFamily: 'Inter_700Bold', letterSpacing: -1.2 } satisfies TextStyle,
  title1: { fontSize: 28, lineHeight: 34, fontFamily: 'Inter_700Bold', letterSpacing: -0.7 } satisfies TextStyle,
  body: { fontSize: 15, lineHeight: 20, fontFamily: 'Inter_400Regular' } satisfies TextStyle,
  bodyStrong: { fontSize: 15, lineHeight: 20, fontFamily: 'Inter_600SemiBold' } satisfies TextStyle,
  label: { fontSize: 13, lineHeight: 18, fontFamily: 'Inter_500Medium' } satisfies TextStyle,
  caption: { fontSize: 12, lineHeight: 16, fontFamily: 'Inter_400Regular' } satisfies TextStyle,
  eyebrow: { fontSize: 11, lineHeight: 14, fontFamily: 'Inter_700Bold', letterSpacing: 2.4 } satisfies TextStyle,
} as const;

/** 8pt grid. */
export const SPACE = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 48, xxxl: 64 } as const;

export const RADIUS = { field: 18, card: 22, pill: 999 } as const;

/** Press feedback shared by every tappable surface in the flow. */
export const PRESS_SCALE = 0.97;

export const MOTION = {
  /** Thread draw-on curve: fast start, long silky settle. */
  draw: Easing.bezier(0.22, 1, 0.36, 1),
  /** Content reveal curve. */
  reveal: Easing.bezier(0.16, 1, 0.3, 1),
  welcomeDrawMs: 1500,
  progressMs: 560,
  weaveMs: 620,
  finaleDrawMs: 1700,
  staggerMs: 70,
  revealMs: 520,
} as const;

/** Thread stroke widths — hairline-crisp but visible on every theme. */
export const THREAD = { stroke: 1.5, glow: 6, glowOpacity: 0.09 } as const;

/**
 * Reduced-motion flag plus a "stitch landed" haptic tick. The tick is a
 * no-op under Reduce Motion (the stitch it pairs with doesn't animate) and
 * on web, where expo-haptics has no engine.
 */
export function useOnboardingMotion() {
  const reduceMotion = useReducedMotion();
  const stitchTick = useCallback(() => {
    if (reduceMotion || Platform.OS === 'web') return;
    Haptics.selectionAsync().catch(() => {});
  }, [reduceMotion]);
  const lightTap = useCallback(() => {
    if (Platform.OS === 'web') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, []);
  return { reduceMotion, stitchTick, lightTap };
}
