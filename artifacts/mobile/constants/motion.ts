/**
 * Brandthread Design System — Motion & Haptics tokens (Phase 1)
 *
 * Canonical timing/spring values for new and migrated global-chrome
 * components. `lib/theme.ts` still exports the legacy `ANIM` timing object
 * used across many existing screens — left untouched for Phase 2 migration.
 */

/** Press feedback: shrink to 0.97 over 120ms, every press-state animation
 *  used by a new/migrated component. Never scales below 1 at rest — this is
 *  the resting (unpressed) scale, never overshot past 1. */
export const PRESS_SCALE = 0.97;
export const PRESS_DURATION_MS = 120;

/** Sheets (BottomSheet, action sheets) spring in with this feel. */
export const SHEET_SPRING = { damping: 20, stiffness: 220 } as const;

/** Sliding tab/segment indicators (e.g. the feed's top tab underline): a
 *  near-critically-damped spring (damping ratio ~1.1) so it glides to rest
 *  with no visible bounce/overshoot, unlike SHEET_SPRING (ratio ~0.67, tuned
 *  for a springier sheet entrance rather than a precise indicator). */
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
  sheetSpring: SHEET_SPRING,
  screenPushMs: SCREEN_PUSH_MS,
  screenPushEasingBezier: SCREEN_PUSH_EASING_BEZIER,
  fadeMs: FADE_MS,
} as const;
