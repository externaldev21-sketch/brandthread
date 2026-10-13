/**
 * Keeps the buyer bar's pill on the same curve as the capsule while the
 * capsule resizes (Home's compact mode <-> every other tab's regular mode).
 *
 * The pill lives inside the capsule, and the capsule shrinks/grows with a
 * `transform: scaleX` around its own centre. On screen the pill therefore
 * sits at `scale(t) * offset(t)` from that centre — a product of two springs,
 * which adds a q² term whose sign flips with direction: measured, the pill
 * reached 90% of its move ~50ms before the capsule when shrinking toward Home
 * but in step with it when growing away from Home. This module computes a
 * small horizontal correction (in the capsule's own, pre-scale units) that
 * makes the pill's on-screen offset a straight interpolation, on the pill's
 * own spring progress, between where it was when the glide started and where
 * it lands — so both directions are mirror images.
 *
 * Pure math (no React/Reanimated imports) so it can be unit-tested; the
 * functions are worklets so the buyer bar's animated style can call them.
 */

export type BarGeometry = {
  /** Pre-scale capsule width (the regular layout width). */
  capsuleWidth: number;
  capsulePadding: number;
  itemWidth: number;
  /** capsule scaleX at compact (mode progress 1); 1 at regular (0). */
  compactScaleX: number;
};

/** Capsule scaleX at mode progress `m` (0 regular, 1 compact). */
export function scaleAt(m: number, g: BarGeometry) {
  'worklet';
  return 1 + (g.compactScaleX - 1) * m;
}

/** Pill centre's pre-scale offset from the capsule centre at slot position x. */
export function offsetAt(x: number, g: BarGeometry) {
  'worklet';
  return g.capsulePadding + (x + 0.5) * g.itemWidth - g.capsuleWidth / 2;
}

/** The glide's start, captured whenever the pill's target changes. */
export type GlideStart = {
  /** Pill slot position when the glide started. */
  fromX: number;
  /** On-screen offset of the pill's base path (centre minus its stretch
   *  lead) from the capsule centre at that moment. */
  fromScreen: number;
  /** Capsule scaleX at that moment. */
  fromScale: number;
};

/**
 * Horizontal correction (pre-scale px) to add to the pill so that:
 * - its base path on screen is `fromScreen + (landing - fromScreen) * q`,
 *   q being the pill's own progress from `fromX` to `target`;
 * - its stretch lead (`lead`, pre-scale px, signed — the half-stretch the
 *   indicator pushes its centre ahead by) is shown at the average of the
 *   start and end capsule scale instead of the live one, which otherwise
 *   made the lead larger early in a shrink and late in a grow.
 *
 * Exactly zero whenever the capsule isn't resizing (start scale = end scale
 * = live scale), so glides between regular tabs are untouched, and zero at
 * both ends of a glide.
 */
export function pillCorrection(
  x: number, target: number, m: number, modeTarget: number, start: GlideStart, g: BarGeometry, lead: number,
) {
  'worklet';
  const span = target - start.fromX;
  const q = Math.abs(span) < 1e-6 ? 1 : Math.min(Math.max((x - start.fromX) / span, 0), 1);
  const endScale = scaleAt(modeTarget, g);
  const landing = endScale * offsetAt(target, g);
  const base = start.fromScreen + (landing - start.fromScreen) * q;
  const leadScale = (start.fromScale + endScale) / 2;
  const s = scaleAt(m, g);
  return (base + leadScale * lead) / s - offsetAt(x, g) - lead;
}

/**
 * The glide start to capture when the pill's target changes, chosen so the
 * pill doesn't move on that frame: its displayed centre (`displayedOffset`,
 * on screen, from the capsule centre) becomes the new glide's starting point.
 */
export function captureGlideStart(
  x: number, m: number, nextModeTarget: number, displayedOffset: number, lead: number, g: BarGeometry,
): GlideStart {
  'worklet';
  const s = scaleAt(m, g);
  const leadScale = (s + scaleAt(nextModeTarget, g)) / 2;
  return { fromX: x, fromScreen: displayedOffset - leadScale * lead, fromScale: s };
}
