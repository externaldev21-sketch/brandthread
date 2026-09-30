/**
 * Shared "slide the floating tab bar off/on screen" primitive.
 *
 * `tabBarSlideTargetY` is the single source of truth for where the bar's
 * translateY must land: exactly `0` (resting position) or exactly
 * `offscreenY` (fully off the bottom of the screen) — never anything in
 * between, no matter how fast `hidden` flips mid-animation. Every caller
 * always re-targets `withTiming` at this function's return value (see
 * components/SellerGlobalTabBar.tsx), the same "never a bare assignment,
 * always withTiming toward a guaranteed end state" discipline
 * components/ui/BottomSheet.tsx's useSheetTransition documents for the
 * web "stuck mid-transform" bug class (#490: a transform animation froze
 * mid-way, seller profile stuck at translateX 393) — a value that is only
 * ever set via `withTiming` toward one of two fixed targets can never
 * rest anywhere else, on any platform.
 */
export function tabBarSlideTargetY(hidden: boolean, offscreenY: number): number {
  return hidden ? offscreenY : 0;
}
