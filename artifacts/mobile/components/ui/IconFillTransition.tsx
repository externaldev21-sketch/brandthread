/**
 * IconFillTransition — outline-to-solid glyph crossfade for a toggled icon
 * (e.g. save/bookmark), replacing an instant icon swap with a quick fill
 * transition: the Feather outline glyph fades out while the FontAwesome
 * solid glyph fades in underneath it (and the reverse un-toggling).
 *
 * Mobbin reference: Instagram, "Saving a post" flow — the bookmark icon in
 * the feed's engagement rail fills from its outline to solid the instant a
 * post is saved, rather than cutting instantly between the two glyphs —
 * https://mobbin.com/flows/ad9c738c-9e00-4ebe-a643-06044ba582c4
 *
 * Reanimated only, driven on the UI thread via useSharedValue/withTiming —
 * no new animation dependency. Deliberately monotonic (no overshoot/bounce):
 * the 0.85 -> 1.1 -> 1 spring spec is scoped to the like icon specifically
 * (see EngagementButton's `tapSpring`), not to this fill. Opacity-only (no
 * scale) — an earlier version also animated each glyph's scale, but on web
 * that combined with the "no transform key once at rest" identity
 * optimization elsewhere in this codebase (see `identityOrNone`) to
 * occasionally strand the resting glyph at a barely-off-target scale, since
 * Reanimated's web style patcher treats an `undefined` style value as
 * "leave whatever's already applied," not "clear it." Opacity alone still
 * reads clearly as a fill and settles exactly at 0/1 every time.
 */
import React, { useEffect } from 'react';
import { StyleProp, StyleSheet, TextStyle } from 'react-native';
import { Feather, FontAwesome } from '@expo/vector-icons';
import Animated, {
  Easing, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import type { FeatherNames } from '@/lib/featherNames';

const FILL_MS = 200;
const FILL_EASING = Easing.out(Easing.cubic);

export interface IconFillTransitionProps {
  /** Feather glyph shown at rest when `active` is false. */
  outlineName: FeatherNames;
  /** FontAwesome solid glyph shown at rest when `active` is true. */
  solidName: React.ComponentProps<typeof FontAwesome>['name'];
  size: number;
  active: boolean;
  activeColor: string;
  inactiveColor: string;
  /** Shared icon style (e.g. EngagementButton's drop-shadow) applied to both glyphs. */
  style?: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * Both glyphs are mounted at all times (one at opacity 0 whenever the other
 * is fully shown), stacked so the crossfade never reflows layout. `fill`
 * tracks the active state as a single 0..1 progress value on the UI thread;
 * neither glyph ever exceeds its resting scale, so this never reads as a
 * bounce.
 */
export function IconFillTransition({
  outlineName, solidName, size, active, activeColor, inactiveColor, style, testID,
}: IconFillTransitionProps) {
  const fill = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    const target = active ? 1 : 0;
    // Snaps `fill` to the exact target once the timing animation reports
    // finished — guards against the sub-percent residual a JS-driven,
    // rAF-stepped easing curve can otherwise leave behind at rest (seen on
    // web), so the icon settles at a precise, fully-identity scale/opacity
    // rather than something imperceptibly (but measurably) short of it.
    fill.value = withTiming(target, { duration: FILL_MS, easing: FILL_EASING }, (finished) => {
      'worklet';
      if (finished) fill.value = target;
    });
  }, [active, fill]);

  const outlineStyle = useAnimatedStyle(() => ({ opacity: 1 - fill.value }));
  const solidStyle = useAnimatedStyle(() => ({ opacity: fill.value }));

  // Each glyph is wrapped in its own plain Reanimated.View (a real host
  // component on every platform, including web) that carries the animated
  // opacity/scale — rather than animating the icon component's own style
  // directly, which on web requires the wrapped component to support
  // `setNativeProps` and neither Feather nor FontAwesome (from
  // @expo/vector-icons) implement that.
  return (
    <Animated.View style={styles.stack} testID={testID}>
      <Animated.View style={outlineStyle}>
        <Feather name={outlineName} size={size} color={inactiveColor} style={style} />
      </Animated.View>
      <Animated.View style={[styles.overlay, solidStyle]}>
        <FontAwesome name={solidName} size={size} color={activeColor} style={style} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stack: { alignItems: 'center', justifyContent: 'center' },
  overlay: { position: 'absolute' },
});
