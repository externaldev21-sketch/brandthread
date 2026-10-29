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
 *
 * Feel (Dev's polish pass, iOS Mail / Instagram DM quality): the row tracks
 * the finger 1:1; action symbols grow in as they're revealed; crossing the
 * full-swipe threshold snaps — the outer action fills the row, its symbol
 * pops and rides the row's edge, a destructive red deepens from crimson to
 * a darker crimson, with a crisp haptic. Releases settle on springs that
 * carry the finger's velocity. An action marked `removes` gets the full
 * exit: the row slides off with momentum, then the list closes the gap with
 * a spring collapse and fade — only then does the action run.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/ui/Icon';
import { isMotionReduced } from '@/lib/reduceMotion';
import { FILL_ELEVATED, FONT } from '@/lib/theme';
import { haptics } from '@/lib/haptics';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';

export const SWIPE_ACTION_WIDTH = 74;
/** Fraction of the row a drag must pass to arm the full-swipe action. */
export const FULL_SWIPE_FRACTION = 0.55;
/** Back-swipe guard: drags that start this close to the left screen edge
 *  belong to the navigator's interactive pop, never to the row. */
const EDGE_GUARD = 24;

export type SwipeTone = 'neutral' | 'muted' | 'destructive' | 'light';

/** The destructive red: a deep, saturated crimson rather than a bright
 *  alert red, so it sits with the black/white/silver palette — and a darker
 *  crimson it deepens to once a full swipe is armed. */
export const SWIPE_DESTRUCTIVE = '#B3261E';
export const SWIPE_DESTRUCTIVE_ARMED = '#8E1B14';

/** Reveal / settle spring — barely underdamped (ratio ≈ 0.83), so an open
 *  or close lands with life but no wobble. Carries the finger's velocity. */
const REVEAL_SPRING = { stiffness: 420, damping: 34, mass: 1 } as const;
/** The arm snap: stiff and quick, a single crisp overshoot. */
const ARM_SPRING = { stiffness: 700, damping: 26, mass: 0.8 } as const;
/** The exit: slide off (momentum, no bounce), then close the gap. */
const EXIT_SPRING = { stiffness: 520, damping: 42, mass: 1, overshootClamping: true } as const;
const COLLAPSE_SPRING = { stiffness: 480, damping: 44, mass: 1, overshootClamping: true } as const;
/** The collapse starts once the row is this close to fully off-screen, so
 *  the slide and the gap closing overlap into one motion. */
const EXIT_HANDOFF_PX = 24;
/** How small a symbol starts as its button begins to show. */
const REVEAL_ICON_FROM = 0.72;
/** Symbol pop at the arm threshold. */
const ARMED_ICON_SCALE = 1.18;
/** Armed symbol's gap from the row's moving edge (Mail). */
const ARMED_ICON_GAP = 22;

/** Black/white/silver from the live Appearance theme; destructive is the
 *  one red the palette allows. `light` is white with black ink — the bag's
 *  "no red" remove. */
function toneColors(theme: AppThemePreset, tone: SwipeTone): { bg: string; fg: string } {
  switch (tone) {
    case 'muted': return { bg: FILL_ELEVATED, fg: theme.text };
    case 'destructive': return { bg: SWIPE_DESTRUCTIVE, fg: '#FFFFFF' };
    case 'light': return { bg: theme.accent, fg: theme.onAccent };
    // Silver square, black ink — Mail's grey "More", in the palette.
    default: return { bg: theme.muted, fg: theme.background };
  }
}

export interface SwipeRowAction {
  key: string;
  label: string;
  icon: IconName;
  tone?: SwipeTone;
  onPress: () => void | Promise<void>;
  accessibilityLabel?: string;
  /** The action takes the row out of the list straight away (remove, delete,
   *  clear): the row slides off and the gap collapses before `onPress` runs.
   *  Leave unset for actions that confirm first or keep the row. */
  removes?: boolean;
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
  // 0 → 1 as the full swipe arms (drives the snap, the symbol pop and the
  // red deepening); native-driven like translateX.
  const armProgress = useRef(new Animated.Value(0)).current;
  // The row's width as an Animated value, so the armed symbol can ride the
  // row's edge (translateX + width) on the native thread.
  const widthValue = useRef(new Animated.Value(390)).current;
  // The exit collapse (JS-driven: it animates height). 1 = full height.
  const collapse = useRef(new Animated.Value(1)).current;
  const rowHeight = useRef(0);
  const [collapsing, setCollapsing] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const offset = useRef(0);
  const width = useRef(390);
  const armed = useRef<Side | null>(null);
  const [armedSide, setArmedSide] = useState<Side | null>(null);
  const leadingWidth = leading.length * SWIPE_ACTION_WIDTH;
  const trailingWidth = trailing.length * SWIPE_ACTION_WIDTH;
  const nativeDriver = Platform.OS !== 'web';

  const settle = (to: number, velocity = 0, done?: () => void) => {
    offset.current = to;
    if (isMotionReduced()) { translateX.setValue(to); done?.(); return; }
    Animated.spring(translateX, { toValue: to, velocity, ...REVEAL_SPRING, useNativeDriver: nativeDriver }).start(() => done?.());
  };

  const close = () => settle(0);

  /** The full exit for a `removes` action: slide off with the finger's
   *  momentum, collapse the gap, then run the action. If the row is still
   *  mounted once the action has run (it didn't leave the list after all),
   *  it springs back into place. */
  const exitThen = (action: SwipeRowAction, side: Side, velocity = 0) => {
    const to = side === 'trailing' ? -width.current : width.current;
    offset.current = 0;
    const finish = async () => {
      try { await action.onPress(); } finally {
        setTimeout(() => {
          if (!mounted.current) return;
          translateX.setValue(0);
          armProgress.setValue(0);
          armed.current = null;
          setArmedSide(null);
          if (isMotionReduced()) { collapse.setValue(1); setCollapsing(false); return; }
          Animated.spring(collapse, { toValue: 1, ...COLLAPSE_SPRING, useNativeDriver: false }).start(() => {
            if (mounted.current) setCollapsing(false);
          });
        }, 80);
      }
    };
    if (isMotionReduced()) { void finish(); return; }
    Animated.spring(translateX, { toValue: to, velocity, ...EXIT_SPRING, restDisplacementThreshold: EXIT_HANDOFF_PX, restSpeedThreshold: 1000, useNativeDriver: nativeDriver }).start(() => {
      translateX.setValue(to);
      setCollapsing(true);
      Animated.spring(collapse, { toValue: 0, ...COLLAPSE_SPRING, restDisplacementThreshold: 0.01, restSpeedThreshold: 0.05, useNativeDriver: false }).start(() => { void finish(); });
    });
  };

  const run = (action: SwipeRowAction) => {
    if (action.removes) {
      const side: Side = actionsRef.current.trailing.some((a) => a.key === action.key) ? 'trailing' : 'leading';
      exitThen(action, side);
      return;
    }
    settle(0);
    void action.onPress();
  };

  const setArmed = (side: Side | null) => {
    if (armed.current === side) return;
    armed.current = side;
    setArmedSide(side);
    if (isMotionReduced()) armProgress.setValue(side ? 1 : 0);
    else Animated.spring(armProgress, { toValue: side ? 1 : 0, ...ARM_SPRING, useNativeDriver: nativeDriver }).start();
    // A crisp tick crossing into the armed state; a lighter one backing out.
    if (side) haptics.rigid(); else haptics.selection();
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

  // The latest actions, read at release time — so callers can pass inline
  // `leading`/`trailing` arrays without the PanResponder being rebuilt (and
  // its in-flight gesture state lost) on every parent render mid-drag.
  const actionsRef = useRef({ leading, trailing });
  actionsRef.current = { leading, trailing };

  // Whether this touch has become a horizontal swipe. A row whose content is
  // not itself pressable (e.g. a Bag line) has no deeper responder, so the
  // touch would otherwise go to an ancestor (the app root's keyboard-dismiss
  // Pressable) — and React Native only re-negotiates moves among the current
  // responder's ancestors, so the row could never claim the drag. Taking the
  // touch at start (deeper Pressables still win, they're asked first) and
  // engaging only on a clearly horizontal move fixes that; until engaged the
  // responder yields to a scroll view that asks for it.
  const engaged = useRef(false);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => { engaged.current = false; return !disabled; },
    // Capture phase: a clearly horizontal drag is taken from the row's own
    // Pressable (which claimed the touch on press-in), as UITableView does.
    onMoveShouldSetPanResponderCapture: (evt, g) => { const claim = shouldClaim(evt, g); if (claim) engaged.current = true; return claim; },
    onMoveShouldSetPanResponder: (evt, g) => { const claim = shouldClaim(evt, g); if (claim) engaged.current = true; return claim; },
    onPanResponderTerminationRequest: () => !engaged.current,
    onPanResponderMove: (evt, g) => {
      if (!engaged.current) {
        if (!shouldClaim(evt, g)) return;
        engaged.current = true;
      }
      let x = offset.current + g.dx;
      if (leadingWidth === 0) x = Math.min(0, x);
      if (trailingWidth === 0) x = Math.max(0, x);
      // Without a full swipe there's nothing past the buttons: resist there
      // (rubber band) instead of tracking 1:1.
      if (!fullSwipe) {
        if (x < -trailingWidth) x = -trailingWidth + (x + trailingWidth) * 0.3;
        if (x > leadingWidth) x = leadingWidth + (x - leadingWidth) * 0.3;
      }
      const limit = width.current;
      x = Math.max(-limit, Math.min(limit, x));
      translateX.setValue(x);
      const full = width.current * FULL_SWIPE_FRACTION;
      setArmed(fullSwipe && x <= -full && trailingWidth > 0 ? 'trailing'
        : fullSwipe && x >= full && leadingWidth > 0 ? 'leading' : null);
    },
    onPanResponderRelease: (_, g) => {
      // Taken at touch-start but never became a swipe (a tap or a vertical
      // drag on non-pressable row content): nothing to settle.
      if (!engaged.current) return;
      engaged.current = false;
      const x = offset.current + g.dx;
      const result = resolveSwipeRelease(x, g.vx, {
        width: width.current, leadingWidth, trailingWidth, fullSwipe,
      });
      // gestureState velocity is px/ms; Animated.spring takes px/s — so a
      // flick carries its momentum into the settle / exit.
      const velocity = g.vx * 1000;
      if (result.kind === 'full') {
        const { leading: lead, trailing: trail } = actionsRef.current;
        const action = result.side === 'trailing' ? trail[trail.length - 1] : lead[0];
        if (action?.removes) {
          // Stay armed (deep red, symbol riding the edge) while it slides off.
          exitThen(action, result.side, velocity);
          return;
        }
        setArmed(null);
        const to = result.side === 'trailing' ? -width.current : width.current;
        // Mail: the row slides off with the action, then the list updates.
        offset.current = 0;
        Animated.spring(translateX, { toValue: to, velocity, ...EXIT_SPRING, restDisplacementThreshold: 2, restSpeedThreshold: 2, useNativeDriver: nativeDriver }).start(() => {
          void action?.onPress();
          translateX.setValue(0);
        });
        return;
      }
      setArmed(null);
      if (result.kind === 'open') settle(result.side === 'trailing' ? -trailingWidth : leadingWidth, velocity);
      else settle(0, velocity);
    },
    onPanResponderTerminate: () => { engaged.current = false; setArmed(null); close(); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [disabled, leadingWidth, trailingWidth, fullSwipe]);

  // Symbols grow in as their side is revealed (0.72 → 1 over the buttons'
  // width), then pop past 1 when the full swipe arms.
  const trailingReveal = translateX.interpolate({
    inputRange: [-Math.max(trailingWidth, 1), 0], outputRange: [1, REVEAL_ICON_FROM], extrapolate: 'clamp',
  });
  const leadingReveal = translateX.interpolate({
    inputRange: [0, Math.max(leadingWidth, 1)], outputRange: [REVEAL_ICON_FROM, 1], extrapolate: 'clamp',
  });
  const armPop = armProgress.interpolate({ inputRange: [0, 1], outputRange: [1, ARMED_ICON_SCALE] });

  const renderButton = (action: SwipeRowAction, side: Side, full: boolean, style?: object) => {
    const tone = toneColors(theme, action.tone ?? 'neutral');
    const destructive = (action.tone ?? 'neutral') === 'destructive';
    const reveal = side === 'trailing' ? trailingReveal : leadingReveal;
    // Armed: the symbol rides the row's moving edge, ARMED_ICON_GAP away.
    const ride = full
      ? side === 'trailing'
        ? Animated.add(Animated.add(translateX, widthValue), ARMED_ICON_GAP)
        : Animated.add(translateX, -ARMED_ICON_GAP - 36)
      : 0;
    return (
      <Pressable
        key={action.key}
        style={[styles.action, { backgroundColor: tone.bg }, style]}
        onPress={() => run(action)}
        testID={`${testIDPrefix}-${action.key}-${rowId}`}
        accessibilityRole="button"
        accessibilityLabel={action.accessibilityLabel ?? action.label}
      >
        {destructive ? (
          // The red deepens to the armed crimson as the full swipe arms.
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: SWIPE_DESTRUCTIVE_ARMED, opacity: armProgress }]} />
        ) : null}
        <Animated.View
          style={[
            styles.actionInner,
            { transform: [{ translateX: ride }, { scale: full ? Animated.multiply(reveal, armPop) : reveal }] },
          ]}
        >
          <Icon name={action.icon} size={20} color={tone.fg} />
          <Text style={[styles.actionText, { color: tone.fg }]} numberOfLines={1}>{action.label}</Text>
        </Animated.View>
      </Pressable>
    );
  };

  // Panels only exist while the row is moved toward them, so a closed row
  // never shows a sliver of an action past a rounded / inset card.
  const trailingOpacity = translateX.interpolate({ inputRange: [-1, 0], outputRange: [1, 0], extrapolate: 'clamp' });
  const leadingOpacity = translateX.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' });
  const outerTrailing = trailing[trailing.length - 1];
  const outerLeading = leading[0];

  return (
    <Animated.View
      // The exit collapse: height springs to 0 with a slight fade, closing
      // the gap before the row leaves the list.
      style={collapsing ? { height: collapse.interpolate({ inputRange: [0, 1], outputRange: [0, rowHeight.current] }), opacity: collapse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }), overflow: 'hidden' } : undefined}
      testID={`${testIDPrefix}-row-${rowId}`}
    >
    <View
      style={styles.clip}
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        if (w) { width.current = w; widthValue.setValue(w); }
        if (h && !collapsing) rowHeight.current = h;
      }}
      // Screen readers get the actions without swiping.
      accessibilityActions={[...leading, ...trailing].map((a) => ({ name: a.key, label: a.accessibilityLabel ?? a.label }))}
      onAccessibilityAction={(e) => {
        const action = [...leading, ...trailing].find((a) => a.key === e.nativeEvent.actionName);
        if (action) run(action);
      }}
    >
      {leading.length > 0 ? (
        <Animated.View style={[styles.panel, styles.leadingPanel, { width: armedSide === 'leading' ? '100%' : leadingWidth, opacity: leadingOpacity }]}>
          {armedSide === 'leading' && outerLeading
            ? renderButton(outerLeading, 'leading', true, styles.fullAction)
            : leading.map((a) => renderButton(a, 'leading', false, { width: SWIPE_ACTION_WIDTH }))}
        </Animated.View>
      ) : null}
      {trailing.length > 0 ? (
        <Animated.View style={[styles.panel, styles.trailingPanel, { width: armedSide === 'trailing' ? '100%' : trailingWidth, opacity: trailingOpacity }]}>
          {armedSide === 'trailing' && outerTrailing
            ? renderButton(outerTrailing, 'trailing', true, [styles.fullAction, styles.fullActionTrailing])
            : trailing.map((a) => renderButton(a, 'trailing', false, { width: SWIPE_ACTION_WIDTH }))}
        </Animated.View>
      ) : null}
      {/* Opaque: the row is a solid sheet sliding over the actions — without
          a background the panel showed through and the row's own text drew
          over the red. Rows with their own tint (unread) still paint over it. */}
      <Animated.View style={[styles.foreground, { backgroundColor: theme.background, transform: [{ translateX }] }]} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden', position: 'relative' },
  panel: { position: 'absolute', top: 0, bottom: 0, flexDirection: 'row', zIndex: 0, elevation: 0 },
  leadingPanel: { left: 0 },
  trailingPanel: { right: 0 },
  // Web: vertical panning stays native, horizontal drags reach the
  // PanResponder — with the default `touch-action: auto` the browser claims
  // the horizontal pan and fires pointercancel, so a touch swipe never opened
  // the row on mobile web.
  foreground: { zIndex: 1, elevation: 1, ...(Platform.OS === 'web' ? ({ touchAction: 'pan-y' } as object) : null) },
  action: { alignItems: 'center', justifyContent: 'center', height: '100%', overflow: 'hidden' },
  actionInner: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  // Armed full swipe: the outermost action fills the row, its symbol riding
  // the row's moving edge (Mail) — positioned by transform from the left.
  fullAction: { flex: 1, alignItems: 'flex-start' },
  fullActionTrailing: { alignItems: 'flex-start' },
  actionText: { fontFamily: FONT.semibold, fontSize: 12 },
});
