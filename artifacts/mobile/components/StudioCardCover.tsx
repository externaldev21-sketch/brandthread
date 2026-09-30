/**
 * Full-bleed "album cover" backdrop shared by every Studio carousel card —
 * Dev's spec: all 16 covers should feel like ONE series, monochrome
 * black/white/silver only, built as code (gradients + a seeded grain
 * pattern) rather than any bitmap asset, so there's no stock-photo
 * licensing risk and near-zero bundle cost. Purely decorative and static:
 * neither piece re-renders per scrub frame, since only the parent card's
 * own transform/opacity (in SellerStudioRadialMenu's CarouselCard) animate.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

/** Diagonal near-black sheen plus a very soft silver radial glow — the
 *  "deep black with soft silver light" every cover shares.
 *
 *  Fixed: a visible hard-edged rectangle used to show around the glow
 *  (Dev's screenshot, "a lighter rounded box... with a visible bottom/left
 *  boundary"). Explicit width="100%" height="100%" on both `<Svg>`s below
 *  fixes a real (separate) react-native-svg-on-web sizing gap, but the
 *  actual box Dev saw turned out to be the OLD 3-stop LinearGradient's own
 *  lighter middle band (#000000 → #161616 → #000000): with only 3 stops and
 *  that much contrast between near-black shades, the transition rendered
 *  with visible 8-bit banding — a "step" that reads as a hard edge rather
 *  than a smooth sheen. Fixed by lowering the peak brightness a lot (to a
 *  value close enough to black that any residual banding is imperceptible)
 *  and adding two more stops so the ramp in and out of it is more gradual.
 *  The radial glow's own peak opacity is lowered to match, since it
 *  overlaps the same upper-middle area and was compounding the effect. */
export function StudioCoverBackdrop() {
  return (
    <>
      <LinearGradient
        colors={['#000000', '#020202', '#050505', '#020202', '#000000']}
        locations={[0, 0.3, 0.5, 0.7, 1]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="coverGlow" cx="50%" cy="34%" r="75%">
            <Stop offset="0%" stopColor="#ffffff" stopOpacity={0.09} />
            <Stop offset="35%" stopColor="#ffffff" stopOpacity={0.05} />
            <Stop offset="70%" stopColor="#ffffff" stopOpacity={0.015} />
            <Stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx="50%" cy="34%" r="75%" fill="url(#coverGlow)" />
      </Svg>
    </>
  );
}

// A tiny seeded LCG (mulberry32) rather than Math.random() — the grain
// pattern below is computed exactly once, at module load, and must stay
// stable across re-renders/reloads rather than reshuffling every time.
function mulberry32(seed: number) {
  return function next() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const GRAIN_DOT_COUNT = 130;
const GRAIN_DOTS = (() => {
  const next = mulberry32(20260930);
  return Array.from({ length: GRAIN_DOT_COUNT }, () => ({
    x: next() * 100,
    y: next() * 100,
    r: 0.3 + next() * 0.55,
    o: 0.02 + next() * 0.045,
  }));
})();

/** Shared once across the whole card area (not duplicated per card) — a
 *  single static overlay is cheaper than 16 and reads as the same grain
 *  running through every cover, reinforcing the "one series" feel. */
export function StudioCoverGrain() {
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
      {GRAIN_DOTS.map((d, i) => (
        <Circle key={i} cx={`${d.x}%`} cy={`${d.y}%`} r={d.r} fill="#ffffff" opacity={d.o} />
      ))}
    </Svg>
  );
}
