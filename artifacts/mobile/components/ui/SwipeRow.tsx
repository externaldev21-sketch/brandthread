/**
 * List-row swipe actions — reference: Apple Mail / Instagram DMs.
 *
 *  - Swipe left reveals the trailing actions (delete / hide side), swipe
 *    right the leading actions (mute / archive / read side), each a square
 *    button the full height of the row with a symbol over a short label.
 *  - A full swipe (past ~55% of the row) arms the outermost action: it
 *    stretches to fill the row with a selection tick, and letting go runs
 *    it — exactly Mail's full-swipe-to-trash.
 *  - Tapping a revealed button runs it; tapping the row or swiping back
 *    closes the actions.
 *
 * `trailing` is listed left-to-right as it appears, so its LAST action is the
 * outermost (full-swipe) one; `leading` is listed left-to-right too, so its
 * FIRST action is the outermost.
 *
 * Built on RN Animated + PanResponder so it behaves the same on web, and it
 * only claims clearly horizontal drags, so vertical list scrolling and the
 * screen-edge back swipe keep working.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/ui/Icon';
import { SPRING } from '@/constants/motion';
import { FONT } from '@/lib/theme';
import { haptics } from '@/lib/haptics';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';

export const SWIPE_ACTION_WIDTH = 74;
/** Fraction of the row a drag must pass to arm the full-swipe action. */
export const FULL_SWIPE_FRACTION = 0.55;
/** Back-swipe guard: drags that start this close to the left screen edge
 *  belong to the navigator's interactive pop, never to the row. */
const EDGE_GUARD = 24;

export type SwipeTone = 'neutral' | 'muted' | 'destructive' | 'light';

/** Black/white/silver from the live Appearance theme; destructive is the
 *  one red the palette allows. `light` is white with black ink — the bag's
 *  "no red" remove. */
function toneColors(theme: AppThemePreset, tone: SwipeTone): { bg: string; fg: string } {
  switch (tone) {
    case 'muted': return { bg: theme.card, fg: theme.text };
    case 'destructive': return { bg: theme.error, fg: theme.onAccent };
    case 'light': return { bg: theme.accent, fg: theme.onAccent };
    default: return { bg: theme.cardElevated, fg: theme.text };
  }
}

export interface SwipeRowAction {
  key: string;
  label: string;
  icon: IconName;
  tone?: SwipeTone;
  onPress: () => void | Promise<void>;
  accessibilityLabel?: string;
}

interface SwipeRowProps {
  children: React.ReactNode;
  leading?: SwipeRowAction[];
  trailing?: SwipeRowAction[];
  /** Full swipe runs the outermost action (default true). */
  fullSwipe?: boolean;
  disabled?: boolean;
  rowId: string;
  /** testID prefix for the action buttons (`<prefix>-<key>-<rowId>`). */
  testIDPrefix?: string;
}

type Side = 'leading' | 'trailing';

/** Pure: which state a release at `x` (row offset) should settle into. */
export function resolveSwipeRelease(
  x: number,
  velocityX: number,
  opts: { width: number; leadingWidth: number; trailingWidth: number; fullSwipe: boolean },
): { kind: 'close' } | { kind: 'open'; side: Side } | { kind: 'full'; side: Side } {
  const { width, leadingWidth, trailingWidth, fullSwipe } = opts;
  const full = width * FULL_SWIPE_FRACTION;
  if (fullSwipe && trailingWidth > 0 && x <= -full) return { kind: 'full', side: 'trailing' };
  if (fullSwipe && leadingWidth > 0 && x >= full) return { kind: 'full', side: 'leading' };
  const projected = x + velocityX * 120;
  if (trailingWidth > 0 && projected <= -trailingWidth / 2) return { kind: 'open', side: 'trailing' };
  if (leadingWidth > 0 && projected >= leadingWidth / 2) return { kind: 'open', side: 'leading' };
  return { kind: 'close' };
}

export default function SwipeRow({
  children, leading = [], trailing = [], fullSwipe = true, disabled = false, rowId, testIDPrefix = 'swipe',
}: SwipeRowProps) {
  const { theme } = useAppTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  const offset = useRef(0);
  const width = useRef(390);
  const armed = useRef<Side | null>(null);
  const [armedSide, setArmedSide] = useState<Side | null>(null);
  const leadingWidth = leading.length * SWIPE_ACTION_WIDTH;
  const trailingWidth = trailing.length * SWIPE_ACTION_WIDTH;
  const nativeDriver = Platform.OS !== 'web';

  const settle = (to: number, done?: () => void) => {
    offset.current = to;
    Animated.spring(translateX, { toValue: to, ...SPRING, useNativeDriver: nativeDriver }).start(() => done?.());
  };

  const close = () => settle(0);

  const run = (action: SwipeRowAction) => {
    settle(0);
    void action.onPress();
  };

  const setArmed = (side: Side | null) => {
    if (armed.current === side) return;
    armed.current = side;
    setArmedSide(side);
    if (side) haptics.selection();
  };

  const shouldClaim = (evt: { nativeEvent: { pageX: number } }, g: { dx: number; dy: number }) => {
      if (disabled) return false;
      if (Math.abs(g.dx) <= 10 || Math.abs(g.dx) <= Math.abs(g.dy) * 1.4) return false;
      // Leave left-edge drags to the interactive back swipe.
      if (offset.current === 0 && g.dx > 0 && evt.nativeEvent.pageX - g.dx < EDGE_GUARD) return false;
      if (g.dx > 0 && offset.current === 0 && leadingWidth === 0) return false;
      if (g.dx < 0 && offset.current === 0 && trailingWidth === 0) return false;
      return true;
  };

  const panResponder = useMemo(() => PanResponder.create({
    // Capture phase: a clearly horizontal drag is taken from the row's own
    // Pressable (which claimed the touch on press-in), as UITableView does.
    onMoveShouldSetPanResponderCapture: shouldClaim,
    onMoveShouldSetPanResponder: shouldClaim,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => {
      let x = offset.current + g.dx;
      if (leadingWidth === 0) x = Math.min(0, x);
      if (trailingWidth === 0) x = Math.max(0, x);
      const limit = width.current;
      x = Math.max(-limit, Math.min(limit, x));
      translateX.setValue(x);
      const full = width.current * FULL_SWIPE_FRACTION;
      setArmed(fullSwipe && x <= -full && trailingWidth > 0 ? 'trailing'
        : fullSwipe && x >= full && leadingWidth > 0 ? 'leading' : null);
    },
    onPanResponderRelease: (_, g) => {
      const x = offset.current + g.dx;
      const result = resolveSwipeRelease(x, g.vx, {
        width: width.current, leadingWidth, trailingWidth, fullSwipe,
      });
      setArmed(null);
      if (result.kind === 'full') {
        const action = result.side === 'trailing' ? trailing[trailing.length - 1] : leading[0];
        const to = result.side === 'trailing' ? -width.current : width.current;
        // Mail: the row slides off with the action, then the list updates.
        offset.current = 0;
        Animated.timing(translateX, { toValue: to, duration: 160, useNativeDriver: nativeDriver }).start(() => {
          void action?.onPress();
          translateX.setValue(0);
        });
        return;
      }
      if (result.kind === 'open') settle(result.side === 'trailing' ? -trailingWidth : leadingWidth);
      else close();
    },
    onPanResponderTerminate: () => { setArmed(null); close(); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [disabled, leadingWidth, trailingWidth, fullSwipe, leading, trailing]);

  const renderButton = (action: SwipeRowAction, style?: object) => {
    const tone = toneColors(theme, action.tone ?? 'neutral');
    return (
      <Pressable
        key={action.key}
        style={[styles.action, { backgroundColor: tone.bg }, style]}
        onPress={() => run(action)}
        testID={`${testIDPrefix}-${action.key}-${rowId}`}
        accessibilityRole="button"
        accessibilityLabel={action.accessibilityLabel ?? action.label}
      >
        <Icon name={action.icon} size={20} color={tone.fg} />
        <Text style={[styles.actionText, { color: tone.fg }]} numberOfLines={1}>{action.label}</Text>
      </Pressable>
    );
  };

  const outerTrailing = trailing[trailing.length - 1];
  const outerLeading = leading[0];

  return (
    <View
      style={styles.clip}
      onLayout={(e) => { width.current = e.nativeEvent.layout.width || width.current; }}
      // Screen readers get the actions without swiping.
      accessibilityActions={[...leading, ...trailing].map((a) => ({ name: a.key, label: a.accessibilityLabel ?? a.label }))}
      onAccessibilityAction={(e) => {
        const action = [...leading, ...trailing].find((a) => a.key === e.nativeEvent.actionName);
        if (action) run(action);
      }}
    >
      {leading.length > 0 ? (
        <View style={[styles.panel, styles.leadingPanel, { width: armedSide === 'leading' ? '100%' : leadingWidth }]}>
          {armedSide === 'leading' && outerLeading
            ? renderButton(outerLeading, styles.fullAction)
            : leading.map((a) => renderButton(a, { width: SWIPE_ACTION_WIDTH }))}
        </View>
      ) : null}
      {trailing.length > 0 ? (
        <View style={[styles.panel, styles.trailingPanel, { width: armedSide === 'trailing' ? '100%' : trailingWidth }]}>
          {armedSide === 'trailing' && outerTrailing
            ? renderButton(outerTrailing, [styles.fullAction, styles.fullActionTrailing])
            : trailing.map((a) => renderButton(a, { width: SWIPE_ACTION_WIDTH }))}
        </View>
      ) : null}
      <Animated.View style={[styles.foreground, { transform: [{ translateX }] }]} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden', position: 'relative' },
  panel: { position: 'absolute', top: 0, bottom: 0, flexDirection: 'row', zIndex: 0, elevation: 0 },
  leadingPanel: { left: 0 },
  trailingPanel: { right: 0 },
  foreground: { zIndex: 1, elevation: 1 },
  action: { alignItems: 'center', justifyContent: 'center', gap: 4, height: '100%' },
  // Armed full swipe: the outermost action fills the row, its symbol riding
  // the inner edge next to the row (Mail).
  fullAction: { flex: 1, alignItems: 'flex-start', paddingHorizontal: 24 },
  fullActionTrailing: { alignItems: 'flex-end' },
  actionText: { fontFamily: FONT.semibold, fontSize: 12 },
});
