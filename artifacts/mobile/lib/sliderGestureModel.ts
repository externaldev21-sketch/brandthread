/**
 * sliderGestureModel.ts — pure math for the Design Studio sidebar's
 * size/opacity sliders (app/design-canvas.tsx).
 *
 * Extracted out of the Reanimated worklets so it's plain, testable TS with
 * no dependency on 'react-native-reanimated' or 'react-native-gesture-handler'
 * — the worklets in design-canvas.tsx call these same formulas (duplicated
 * there, since Reanimated worklets must be self-contained closures that the
 * Babel plugin can extract; keeping the source of truth here and covering it
 * with unit tests still catches any change to the intended behaviour).
 */

/**
 * rubberband — iOS-style elastic overscroll/overdrag. Inside [min, max] the
 * value passes through unchanged. Past either edge, each additional unit of
 * raw drag moves the value by a shrinking amount (an asymptotic curve, never
 * reaching more than 1/resistance past the edge), so a fast, large drag past
 * 0% or 100% still gives some visible "give" instead of a hard stop.
 */
export function rubberband(value: number, min: number, max: number, resistance = 6): number {
  'worklet';
  if (value < min) return min - (min - value) / (1 + (min - value) * resistance);
  if (value > max) return max + (value - max) / (1 + (value - max) * resistance);
  return value;
}

/** Percentage (0–1) for a drag, from the value at gesture-start plus the
 * gesture's own cumulative translation, normalised by the slider's rail
 * height. This is the exact fix for the "keeps messing up/glitching" bug:
 * the old code re-derived `pct` from a fixed 0.5 baseline plus only the
 * delta since the previous move event, so it reset/jumped on every pixel of
 * movement instead of tracking smoothly from where the drag began. */
export function dragPct(startPct: number, translationY: number, railHeight: number): number {
  'worklet';
  if (railHeight <= 0) return startPct;
  return startPct - translationY / railHeight;
}

/** Rounds a clamped 0–1 fraction to the nearest 1% step (0–100, integer),
 * matching the "clamp 0-100% in 1% steps" requirement. */
export function toStepPercent(clampedPct: number): number {
  'worklet';
  return Math.round(Math.max(0, Math.min(1, clampedPct)) * 100);
}

/**
 * clampToRange — applies a [min, max] clamp (used once a drag ends, so the
 * rubber-banded overshoot always settles back to a legal value).
 */
export function clampToRange(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
