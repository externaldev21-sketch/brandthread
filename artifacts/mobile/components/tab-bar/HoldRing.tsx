/**
 * Hold-to-switch ring for the tab bar's Profile button.
 *
 * Holding Profile draws a thin white/silver glow clockwise around the
 * button, starting at 12 o'clock; when it closes, the app switches to the
 * person's other account (see lib/holdToSwitch.ts for the timing rules and
 * account choice, and contexts/QuickAccountSwitchContext.tsx for the switch
 * itself). Letting go early retracts it fast and nothing happens; a normal
 * tap still just opens Profile.
 *
 * The ring follows the button's own rounded-rect outline (the Profile
 * "circle" is a squircle with radius.bar corners), and is drawn with a
 * Reanimated-driven strokeDashoffset, so the draw runs on the UI thread.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedProps, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Gap between the button's edge and the ring. */
const RING_OUTSET = 3;
const RING_STROKE = 2;
const GLOW_STROKE = 6;
const RING_COLOR = 'rgba(255, 255, 255, 0.96)';
const GLOW_COLOR = 'rgba(226, 232, 240, 0.32)';

/** A rounded-rect outline that starts at top-center and runs clockwise, and
 *  its exact length (for the dash). */
export function roundedRectRingPath(width: number, height: number, r: number, inset: number) {
  const x0 = inset;
  const y0 = inset;
  const x1 = width - inset;
  const y1 = height - inset;
  const rr = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
  const cx = (x0 + x1) / 2;
  const d = [
    `M ${cx} ${y0}`,
    `H ${x1 - rr}`,
    `A ${rr} ${rr} 0 0 1 ${x1} ${y0 + rr}`,
    `V ${y1 - rr}`,
    `A ${rr} ${rr} 0 0 1 ${x1 - rr} ${y1}`,
    `H ${x0 + rr}`,
    `A ${rr} ${rr} 0 0 1 ${x0} ${y1 - rr}`,
    `V ${y0 + rr}`,
    `A ${rr} ${rr} 0 0 1 ${x0 + rr} ${y0}`,
    'Z',
  ].join(' ');
  const length = 2 * ((x1 - x0) - 2 * rr) + 2 * ((y1 - y0) - 2 * rr) + 2 * Math.PI * rr;
  return { d, length };
}

export function HoldRing({ size, radius, progress }: { size: number; radius: number; progress: SharedValue<number> }) {
  const box = size + RING_OUTSET * 2 + GLOW_STROKE;
  const inset = GLOW_STROKE / 2;
  const { d, length } = roundedRectRingPath(box, box, radius + RING_OUTSET, inset);
  const dashProps = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - progress.value) }));
  const glowProps = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - progress.value) }));
  // Hidden entirely at rest, so nothing at all is drawn (not even a dot from
  // the round line cap) until a hold actually starts.
  const style = useAnimatedStyle(() => ({ opacity: progress.value > 0.001 ? 1 : 0 }));
  return (
    <Animated.View
      pointerEvents="none"
      testID="tab-bar-hold-ring"
      style={[styles.ring, { width: box, height: box, top: -(RING_OUTSET + inset), left: -(RING_OUTSET + inset) }, style]}
    >
      <Svg width={box} height={box}>
        <AnimatedPath d={d} stroke={GLOW_COLOR} strokeWidth={GLOW_STROKE} strokeLinecap="round" fill="none" strokeDasharray={`${length} ${length}`} animatedProps={glowProps} />
        <AnimatedPath d={d} stroke={RING_COLOR} strokeWidth={RING_STROKE} strokeLinecap="round" fill="none" strokeDasharray={`${length} ${length}`} animatedProps={dashProps} />
      </Svg>
    </Animated.View>
  );
}

/** What `useHoldToSwitch` (components/tab-bar/useHoldToSwitch.ts) returns —
 *  the `hold` prop of TabBarSlot/TabBarCircle. */
export type HoldToSwitch = {
  progress: SharedValue<number>;
  onPressIn: () => void;
  onPressOut: () => void;
  /** Whether the last release was a plain tap (vs. a cancelled or
   *  completed hold) — the button runs its own onPress only then. */
  releasedAsTap: () => boolean;
};


const styles = StyleSheet.create({
  ring: { position: 'absolute' },
});
