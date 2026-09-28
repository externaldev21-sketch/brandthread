/**
 * TickingCount — odometer-style rolling-digit animation for engagement
 * counts (like/save), replacing an instant text swap with a vertical tick.
 *
 * Mobbin reference: TikTok, "Liking a video" flow, For You feed right
 * action bar (heart icon with its count directly beneath it — the same
 * icon+count-underneath shape RightActionRail already uses for
 * like/comment/repost/save/share) — https://mobbin.com/flows/9bcbdd97-99ab-4767-ad22-d599ea86af30
 * The count updates the instant the heart is tapped; this component is
 * what makes that update read as a roll rather than a jump-cut swap.
 *
 * Reanimated only, driven on the UI thread via useSharedValue/withTiming —
 * no new animation dependency, no spring/bounce/overscroll.
 *
 * Behavior:
 * - Formats `value` itself (via lib/engagementUtils#formatCount, the same
 *   function dev PR #224 introduced) so it can diff the previous and next
 *   *display strings*, not just the raw numbers.
 * - Common case — the formatted string's length doesn't change (e.g.
 *   "1,203" -> "1,204", "42" -> "43", "12.3K" -> "12.4K"): only the
 *   characters that actually differ roll, each independently, like a
 *   mechanical odometer digit — the old glyph slides out while the new one
 *   slides in from the direction the count is moving (up on like/save,
 *   down on unlike/unsave). Unchanged characters (e.g. the "1," in
 *   "1,203" -> "1,204") stay static.
 * - Threshold-crossing case — the formatted string's length changes (e.g.
 *   "999" -> "1,000", or the blank<->"1" edge at 0) — there's no shared
 *   per-character column to diff against, so the whole label rolls as one
 *   unit instead. Still a roll, never an instant swap.
 *
 * A single `value`-triggered change is tracked as its own bit of React
 * state (`tick` below), captured once by an effect keyed only on `value`,
 * and only cleared by this component's own completion timer. This
 * matters: a feed cell re-renders often for reasons that have nothing to
 * do with this count (video playback progress, sibling animations, …),
 * and a naive "compare against a ref updated every render" approach lets
 * one of those unrelated re-renders land mid-roll, see the ref already
 * caught up, and cut the animation short after a single frame. Keeping
 * the animated (from -> to) pair in state — changed only when `value`
 * itself changes, and only read back out, never overwritten by an
 * unrelated render — keeps the full tick on screen regardless of how many
 * other things re-render this cell while it plays.
 */
import React, { useEffect, useRef, useState } from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View } from 'react-native';
import Animated, {
  Easing, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { diffCount } from '@/lib/engagementUtils';
import { identityOrNone } from '@/lib/animationUtils';

const TICK_MS = 240;
const TICK_EASING = Easing.out(Easing.cubic);

export interface TickingCountProps {
  /** Raw count — TickingCount formats it itself (via formatCount, through
   *  diffCount) so it can diff the previous and next *display strings*
   *  character by character. */
  value: number;
  style?: StyleProp<TextStyle>;
  /** Must match the text style's lineHeight for the roll distance to land
   *  glyph-on-glyph. Defaults to the rail count style's own 15. */
  lineHeight?: number;
  testID?: string;
}

/** Old glyph slides out / new glyph slides in, over TICK_MS. Mounted only
 *  for the duration of one tick (the parent unmounts it back to a plain
 *  Text once its completion timer fires), so this only ever needs to
 *  animate once, from mount. */
function Roll({
  oldText, newText, direction, style, lineHeight,
}: {
  oldText: string; newText: string; direction: 1 | -1; style?: StyleProp<TextStyle>; lineHeight: number;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, { duration: TICK_MS, easing: TICK_EASING });
    // Mounts fresh for every distinct tick (parent keys this by from/to),
    // so a plain mount-time kickoff is correct — no dependency array needed
    // beyond running once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clamped defensively: a large frame hitch (a backgrounded tab, a heavy
  // synchronous block elsewhere) can otherwise hand an eased progress
  // value outside [0, 1] to a style computed every frame, which would
  // overshoot the glyph off past its resting position instead of just
  // holding at it.
  const outStyle = useAnimatedStyle(() => {
    'worklet';
    const p = Math.min(1, Math.max(0, progress.value));
    return {
      transform: identityOrNone([{ translateY: -direction * p * lineHeight }]),
      opacity: 1 - p,
    };
  });
  const inStyle = useAnimatedStyle(() => {
    'worklet';
    const p = Math.min(1, Math.max(0, progress.value));
    return {
      transform: identityOrNone([{ translateY: direction * lineHeight * (1 - p) }]),
      opacity: p,
    };
  });

  return (
    <View style={{ height: lineHeight, overflow: 'hidden' }}>
      <Animated.Text style={[style, styles.stacked, outStyle]}>{oldText}</Animated.Text>
      <Animated.Text style={[style, styles.stacked, inStyle]}>{newText}</Animated.Text>
    </View>
  );
}

export function TickingCount({ value, style, lineHeight = 15, testID }: TickingCountProps) {
  // The value this component is at rest showing (no roll in flight).
  const [displayed, setDisplayed] = useState(value);
  // The (from -> to) pair for an in-progress roll, or null at rest.
  const [tick, setTick] = useState<{ from: number; to: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Starts a new roll exactly when `value` itself changes — never as a
  // side effect of some other, unrelated re-render.
  useEffect(() => {
    const currentTarget = tick ? tick.to : displayed;
    if (value === currentTarget) return;
    const from = tick ? tick.to : displayed;
    if (tick) {
      // A new value arrived before the previous roll finished (rapid
      // re-taps) — settle that one instantly and start the new roll from
      // its endpoint, rather than trying to blend two rolls.
      setDisplayed(tick.to);
    }
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setTick({ from, to: value });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Clears the roll back to a plain, settled Text once TICK_MS elapses —
  // the single source of truth for "is a roll currently on screen",
  // independent of how many other times this component re-renders
  // meanwhile.
  useEffect(() => {
    if (!tick) return undefined;
    timerRef.current = setTimeout(() => {
      setDisplayed(tick.to);
      setTick(null);
      timerRef.current = null;
    }, TICK_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [tick]);

  const from = tick ? tick.from : displayed;
  const to = tick ? tick.to : displayed;
  const diff = diffCount(to, from);

  if (diff.kind === 'none') {
    return <Text style={style} testID={testID}>{diff.text}</Text>;
  }

  if (diff.kind === 'whole') {
    return (
      <View testID={testID}>
        <Roll
          key={`${diff.prevText}>${diff.text}`}
          oldText={diff.prevText} newText={diff.text} direction={diff.direction}
          style={style} lineHeight={lineHeight}
        />
      </View>
    );
  }

  return (
    <View style={styles.row} testID={testID}>
      {diff.text.split('').map((c, i) => (
        diff.diffs[i]
          ? (
            <Roll
              key={`${i}:${diff.prevText[i]}>${c}`}
              oldText={diff.prevText[i]} newText={c} direction={diff.direction}
              style={style} lineHeight={lineHeight}
            />
          )
          : <Text key={i} style={style}>{c}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  stacked: { position: 'absolute', left: 0, right: 0, textAlign: 'center' },
});
