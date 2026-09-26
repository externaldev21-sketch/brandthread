/**
 * Brandthread Design System — Motion & Haptics tokens (Phase 1)
 *
 * Canonical timing/spring values for new and migrated global-chrome
 * components. `lib/theme.ts` still exports the legacy `ANIM` timing object
 * used across many existing screens — left untouched for Phase 2 migration.
 */
import { Easing } from 'react-native-reanimated';

/** Press feedback: shrink to 0.97 over 120ms, every press-state animation
 *  used by a new/migrated component. Never scales below 1 at rest — this is
 *  the resting (unpressed) scale, never overshot past 1. */
export const PRESS_SCALE = 0.97;
export const PRESS_DURATION_MS = 120;

/** Shared open/close timeline for every bottom sheet (`useSheetTransition`,
 *  `components/ui/BottomSheet.tsx`, `SheetRise`, and any bespoke sheet) —
 *  the iOS sheet curve, `withTiming` only, never a spring: opening or
 *  closing on a spring reads as a bounce/oscillate-then-settle, which is
 *  exactly the "pops out, overshoots, settles" motion this replaced. Every
 *  sheet in the app shares this one constant so they all open/close
 *  identically. The bezier points are exported separately too, for the rare
 *  sheet (`SheetRise`) still on RN's own `Animated` rather than Reanimated —
 *  RN's `Easing.bezier` takes the same four points but isn't the same
 *  function as Reanimated's. */
export const SHEET_EASING_BEZIER = [0.32, 0.72, 0, 1] as const;
export const SHEET_EASING = Easing.bezier(...SHEET_EASING_BEZIER);
export const SHEET_OPEN_MS = 260;
export const SHEET_CLOSE_MS = 200;
export const SHEET_TIMING = {
  openMs: SHEET_OPEN_MS,
  closeMs: SHEET_CLOSE_MS,
  easing: SHEET_EASING,
} as const;
/** @deprecated kept only for the close-timeline name used by older call
 *  sites; identical to `SHEET_EASING`. */
export const SHEET_CLOSE_EASING = SHEET_EASING;
/** How far below the sheet's resting position it travels when closed —
 *  comfortably past any device's bottom inset so it's fully offscreen. */
export const SHEET_OFFSCREEN_Y = 500;

/** Sliding tab/segment indicators (e.g. the feed's top tab underline): a
 *  near-critically-damped spring (damping ratio ~1.1) so it glides to rest
 *  with no visible bounce/overshoot — sheets no longer use a spring at all
 *  (see SHEET_TIMING above), this one is unrelated to sheet motion. */
export const TAB_INDICATOR_SPRING = { damping: 30, stiffness: 260, mass: 0.7 } as const;

/** Screen push transition (Stack navigator). */
export const SCREEN_PUSH_MS = 280;
/** Cubic ease-out curve equivalent, for renderers that take bezier points. */
export const SCREEN_PUSH_EASING_BEZIER = [0.16, 1, 0.3, 1] as const;

/** Generic fade (modals, tab content swaps, toasts appearing/disappearing). */
export const FADE_MS = 180;

export const MOTION = {
  pressScale: PRESS_SCALE,
  pressDurationMs: PRESS_DURATION_MS,
  sheetTiming: SHEET_TIMING,
  screenPushMs: SCREEN_PUSH_MS,
  screenPushEasingBezier: SCREEN_PUSH_EASING_BEZIER,
  fadeMs: FADE_MS,
} as const;
