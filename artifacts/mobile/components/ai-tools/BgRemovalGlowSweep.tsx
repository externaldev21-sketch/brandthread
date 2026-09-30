/**
 * Brandthread — Remove Background glow-edge sweep
 *
 * The "cool little glowy animation effect around what's getting cut off"
 * Dev asked for. Built on @shopify/react-native-skia (already used
 * elsewhere in the app — see components/design-studio/SkiaDrawingCanvas.tsx
 * — so this reuses existing GPU-canvas infra instead of adding a new one).
 *
 * Honesty note (documented here and in the PR body): this glows a
 * rounded-rect border around the photo, not the AI-detected subject's real
 * pixel contour — the /api/bg-removal/remove endpoint returns only the
 * final cutout PNG, not a separate segmentation-mask polygon we could trace
 * exactly. A glow that actually hugs the true subject silhouette would need
 * the backend to also return the alpha-mask outline, which it doesn't
 * today; flagged as a "needs backend" nice-to-have in the PR rather than
 * faked by drawing a mask-shaped path we don't actually have.
 *
 * Runs in two modes, driven entirely by `active`/`resolved` (not a fixed
 * timer) so it never finishes before the real cutout is ready:
 *  - looping glow while the request is in flight (`resolved` false)
 *  - one settle-and-fade pass once the real result lands (`resolved` true),
 *    which calls onSettled when the fade completes
 */
import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { Canvas, RoundedRect, BlurMask, Group } from '@shopify/react-native-skia';
import {
  useSharedValue, useDerivedValue, withRepeat, withTiming, withSequence,
  Easing, runOnJS, useReducedMotion, type SharedValue,
} from 'react-native-reanimated';
import { FG } from '@/lib/theme';

interface BgRemovalGlowSweepProps {
  width: number;
  height: number;
  /** True while the animation should be running (mounted + not dismissed). */
  active: boolean;
  /** True once the real API result has arrived — plays the final settle pulse then calls onSettled. */
  resolved: boolean;
  onSettled?: () => void;
}

function useDerivedInsetLength(length: number, inset: SharedValue<number>) {
  return useDerivedValue(() => length - inset.value * 2, [length]);
}

export default function BgRemovalGlowSweep({ width, height, active, resolved, onSettled }: BgRemovalGlowSweepProps) {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(0.35);
  const inset = useSharedValue(10);
  const w = useDerivedInsetLength(width, inset);
  const h = useDerivedInsetLength(height, inset);

  useEffect(() => {
    if (!active) return;
    if (reduceMotion) {
      pulse.value = 0.7;
      return;
    }
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.35, { duration: 700, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
    inset.value = withRepeat(
      withSequence(
        withTiming(4, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        withTiming(14, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduceMotion]);

  useEffect(() => {
    if (!resolved) return;
    // One settle pulse: glow brightens then fades to 0, then report done.
    pulse.value = withSequence(
      withTiming(1, { duration: reduceMotion ? 1 : 220, easing: Easing.out(Easing.ease) }),
      withTiming(0, { duration: reduceMotion ? 1 : 420, easing: Easing.in(Easing.ease) }, (finished) => {
        'worklet';
        if (finished && onSettled) runOnJS(onSettled)();
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);

  if (width <= 0 || height <= 0) return null;

  return (
    <Canvas style={[StyleSheet.absoluteFill, { width, height }]} pointerEvents="none">
      <Group>
        <RoundedRect x={inset} y={inset} width={w} height={h} r={18} color={FG} style="stroke" strokeWidth={2} opacity={pulse}>
          <BlurMask blur={14} style="solid" />
        </RoundedRect>
      </Group>
    </Canvas>
  );
}
