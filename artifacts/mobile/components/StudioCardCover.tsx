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

/** Diagonal black-to-charcoal gradient plus a soft silver radial glow —
 *  the "deep black with soft silver light" every cover shares. */
export function StudioCoverBackdrop() {
  return (
    <>
      <LinearGradient
        colors={['#050505', '#161616', '#000000']}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="coverGlow" cx="50%" cy="34%" r="60%">
            <Stop offset="0%" stopColor="#ffffff" stopOpacity={0.18} />
            <Stop offset="55%" stopColor="#ffffff" stopOpacity={0.05} />
            <Stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx="50%" cy="34%" r="60%" fill="url(#coverGlow)" />
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
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      {GRAIN_DOTS.map((d, i) => (
        <Circle key={i} cx={`${d.x}%`} cy={`${d.y}%`} r={d.r} fill="#ffffff" opacity={d.o} />
      ))}
    </Svg>
  );
}
