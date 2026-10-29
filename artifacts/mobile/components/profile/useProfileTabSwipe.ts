/**
 * Swipeable profile content tabs (micro-interactions pack 2, item 31).
 *
 * A horizontal swipe across a profile's grid moves to the next / previous
 * content tab (Posts ↔ Shop ↔ Tagged …), and the tab underline tracks the
 * finger the whole way, Instagram-profile style. Released past ~22% of the
 * width (or flicked) it commits to the neighbour tab; otherwise it springs
 * back. Taps on a tab glide the same indicator.
 *
 * Mobbin reference: Instagram profile — swipe between the grid / reels /
 * tagged tabs; the indicator follows the drag.
 *
 * RN Animated + PanResponder (like components/ui/SwipeRow.tsx), so it behaves
 * the same on web. It only claims clearly horizontal drags that don't start
 * at the left screen edge, so vertical scrolling, the navigator's back
 * swipe and horizontal rails inside the header (which claim their own
 * drags first) keep working. Reduce Motion: the indicator jumps.
 */
import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, PanResponder, Platform } from 'react-native';

import { haptic } from '@/lib/haptics';
import { isMotionReduced } from '@/lib/reduceMotion';

/** Fraction of the width a drag must pass to commit to the neighbour tab. */
export const TAB_SWIPE_COMMIT = 0.22;
const EDGE_GUARD = 24;
const ND = Platform.OS !== 'web';

/** Pure: where a release lands — the neighbour index, or the current one. */
export function resolveTabSwipe(index: number, count: number, dx: number, vx: number, width: number): number {
  if (width <= 0) return index;
  const commit = Math.abs(dx) > width * TAB_SWIPE_COMMIT || Math.abs(vx) > 0.5;
  if (!commit || dx === 0) return index;
  const next = dx < 0 ? index + 1 : index - 1;
  return Math.max(0, Math.min(count - 1, next));
}

export function useProfileTabSwipe({ keys, active, onChange, width, enabled = true }: {
  keys: string[];
  active: string;
  onChange: (key: string) => void;
  width: number;
  enabled?: boolean;
}) {
  const index = Math.max(0, keys.indexOf(active));
  const position = useRef(new Animated.Value(index)).current;
  const live = useRef({ index, count: keys.length, keys, onChange, width, enabled });
  live.current = { index, count: keys.length, keys, onChange, width, enabled };

  // Taps and committed swipes glide on from wherever the indicator is.
  useEffect(() => {
    if (isMotionReduced()) { position.setValue(index); return; }
    Animated.timing(position, { toValue: index, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: ND }).start();
  }, [index, position]);

  // Same responder shape as components/ui/SwipeRow: take the touch at start
  // when nothing deeper wants it (header text, gaps between cells), engage
  // only on a clearly horizontal move, and yield to the list's scroll until
  // engaged — otherwise the app root's Pressable holds the touch and React
  // Native never asks this area about the move.
  const engaged = useRef(false);
  const responder = useMemo(() => {
    const wantsSwipe = (evt: { nativeEvent: { pageX: number } }, g: { dx: number; dy: number }) => {
      const { enabled: on, count } = live.current;
      if (!on || count < 2) return false;
      if (Math.abs(g.dx) <= 12 || Math.abs(g.dx) <= Math.abs(g.dy) * 1.6) return false;
      // Left-edge drags belong to the navigator's back swipe.
      if (g.dx > 0 && evt.nativeEvent.pageX - g.dx < EDGE_GUARD) return false;
      return true;
    };
    return PanResponder.create({
    onStartShouldSetPanResponder: () => { engaged.current = false; return live.current.enabled && live.current.count > 1; },
    onMoveShouldSetPanResponderCapture: (evt, g) => { const w = wantsSwipe(evt, g); if (w) engaged.current = true; return w; },
    onMoveShouldSetPanResponder: (evt, g) => { const w = wantsSwipe(evt, g); if (w) engaged.current = true; return w; },
    onPanResponderGrant: () => { position.stopAnimation(); },
    onPanResponderMove: (evt, g) => {
      if (!engaged.current) {
        if (!wantsSwipe(evt, g)) return;
        engaged.current = true;
      }
      const { index: i, count, width: w } = live.current;
      if (w <= 0) return;
      let p = -g.dx / w;
      // Rubber-band past the first / last tab.
      if ((i === 0 && p < 0) || (i === count - 1 && p > 0)) p *= 0.25;
      position.setValue(i + Math.max(-1, Math.min(1, p)));
    },
    onPanResponderRelease: (_evt, g) => {
      if (!engaged.current) return;
      engaged.current = false;
      const { index: i, count, keys: k, onChange: change, width: w } = live.current;
      const next = resolveTabSwipe(i, count, g.dx, g.vx, w);
      if (next !== i) {
        haptic('select');
        change(k[next]);
        return;
      }
      Animated.spring(position, { toValue: i, damping: 26, stiffness: 300, mass: 1, useNativeDriver: ND }).start();
    },
    onPanResponderTerminate: () => {
      engaged.current = false;
      Animated.spring(position, { toValue: live.current.index, damping: 26, stiffness: 300, mass: 1, useNativeDriver: ND }).start();
    },
    onPanResponderTerminationRequest: () => !engaged.current,
    });
  }, [position]);

  return { panHandlers: responder.panHandlers, position };
}
