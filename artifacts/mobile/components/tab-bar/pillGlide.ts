/**
 * Pure math for the tab bars' gliding pill (see TabBarIndicator and
 * useTabBarActiveIndex in TabBarParts.tsx). Kept free of React/Reanimated
 * imports so it can be unit-tested directly; `currentStretch` is also a
 * worklet so the indicator's animated style can call it on the UI thread.
 */

// Liquid stretch, in slot units: 0.45 of the distance travelled, capped at
// 0.55 of a slot — the same amounts the pill has always stretched by.
export const STRETCH_PER_SLOT = 0.45;
export const MAX_STRETCH_SLOTS = 0.55;

// INDICATOR_SPRING covers ~95% of a glide by ~140ms — see
// useTabBarActiveIndex's `afterGlide`.
export const WEB_NAV_AFTER_PRESS_MS = 140;

/**
 * How far the pill is stretched right now, in slot units: zero at the start
 * of a glide, `peak` halfway, zero again on landing ((4p(1-p))² over the
 * glide's progress p — squared so the stretch has fully eased off by the
 * time the pill is ~95% of the way there). It grows and shrinks
 * continuously instead of jumping to full stretch on the press frame, which
 * is what made the old glide's leading edge leap ahead a frame before the
 * rest of the pill moved.
 */
export function currentStretch(x: number, origin: number, target: number, peak: number) {
  'worklet';
  const span = target - origin;
  if (peak <= 0 || Math.abs(span) < 1e-3) return 0;
  const p = Math.min(Math.max((x - origin) / span, 0), 1);
  const bump = 4 * p * (1 - p);
  return peak * bump * bump;
}

/**
 * Where a new glide from `from` to `index` should start its stretch curve
 * (`origin`) and how far it peaks. A redirect mid-glide in the same
 * direction keeps the pill's current stretch instead of snapping it back to
 * its resting width, by starting the new curve at the point where it already
 * equals that stretch; a reversal or a glide from rest starts a fresh curve.
 */
export function planGlide(
  from: number,
  index: number,
  previous: { origin: number; target: number; peak: number },
) {
  const peak = Math.min(Math.abs(index - from) * STRETCH_PER_SLOT, MAX_STRETCH_SLOTS);
  const current = currentStretch(from, previous.origin, previous.target, previous.peak);
  const sameDirection = Math.sign(index - from) === Math.sign(previous.target - previous.origin);
  if (current <= 0 || !sameDirection || index === from) return { origin: from, peak };
  const nextPeak = Math.max(peak, current);
  // Invert currentStretch's (4p(1-p))² for p in the first half.
  const p0 = (1 - Math.sqrt(Math.max(0, 1 - Math.sqrt(current / nextPeak)))) / 2;
  return { origin: (from - p0 * index) / (1 - p0), peak: nextPeak };
}
