/**
 * Swipe-left-to-reveal actions, generalizing `SwipeActionRow` (single action)
 * to any number of stacked action buttons — Instagram's Activity row is the
 * first caller: swiping a row left reveals a "..." button and a red trash
 * icon side by side (Mobbin: "Instagram iOS Removing a follower" flow,
 * screen 1 — https://mobbin.com/screens/c404cbe7-e8c0-4b09-904c-62ba9d1b0a71).
 *
 * `SwipeActionRow` is left as-is for its existing single-action callers;
 * this is the shared, general version for anything (now or later) that needs
 * more than one revealed button.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from '@/components/ui/Icon';
import { hapticLight } from '@/lib/haptics';

export interface SwipeAction {
  key: string;
  icon: IconName;
  color: string;
  iconColor: string;
  accessibilityLabel: string;
  onPress: () => void;
}

const ACTION_WIDTH = 56;

export default function SwipeableActions({
  children,
  actions,
  disabled = false,
  backgroundColor,
}: {
  children: React.ReactNode;
  actions: SwipeAction[];
  disabled?: boolean;
  /** Match the row surface so the action colors cannot bleed through subpixel seams. */
  backgroundColor?: string;
}) {
  const revealWidth = actions.length * ACTION_WIDTH;
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);
  // Do not mount the colored action layer while closed. Even a correctly
  // stacked front can leave a subpixel strip under a row on some renderers.
  const [actionsVisible, setActionsVisible] = useState(false);

  const animateTo = (toValue: number) => {
    openRef.current = toValue !== 0;
    Animated.spring(translateX, { toValue, useNativeDriver: true, damping: 22, stiffness: 240 }).start(({ finished }) => {
      if (finished && !openRef.current) setActionsVisible(false);
    });
  };

  // True once this gesture is a horizontal swipe (vs a tap or a vertical scroll).
  const swipingRef = useRef(false);
  const isHorizontal = (dx: number, dy: number) => Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.25;
  // Until when a click on the row content is swallowed (web): a mouse swipe
  // ends with a mouseup over the row, which the browser turns into a click on
  // whatever is under it — on Activity that's the whole-row tap target, so a
  // swipe used to open the notification instead of revealing the actions
  // (item 83). Also set when a gesture starts on an open row, which closes it.
  const suppressClickUntil = useRef(0);
  const holdClicks = () => { suppressClickUntil.current = Date.now() + 500; };

  const panResponder = useMemo(() => PanResponder.create({
    // An open row takes the touch before its content does, so tapping it
    // closes it (as in Instagram / Mail) instead of opening the row behind.
    onStartShouldSetPanResponderCapture: () => !disabled && openRef.current,
    // Claim the touch on start (bubble phase — any pressable inside the row
    // still wins its own taps first). Move-only negotiation never reaches
    // this row: app/_layout.tsx wraps every screen in a keyboard-dismiss
    // <Pressable>, which becomes the responder on touch start, and once an
    // ancestor holds it, move negotiation only consults *its* ancestors — so
    // a move-only swipe row could never open (on web or native). The row
    // only moves once the gesture is clearly horizontal, and yields to a
    // scroll view whenever it isn't.
    onStartShouldSetPanResponder: () => !disabled,
    onMoveShouldSetPanResponder: (_, gesture) =>
      !disabled && (
        (gesture.dx < -8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.25) ||
        (openRef.current && gesture.dx > 8)
      ),
    onPanResponderGrant: () => {
      swipingRef.current = false;
      if (openRef.current) holdClicks();
    },
    onPanResponderMove: (_, gesture) => {
      if (!swipingRef.current) {
        if (!isHorizontal(gesture.dx, gesture.dy)) return;
        swipingRef.current = true;
        setActionsVisible(true);
      }
      holdClicks();
      const base = openRef.current ? -revealWidth : 0;
      translateX.setValue(Math.max(-revealWidth, Math.min(0, base + gesture.dx)));
    },
    onPanResponderRelease: (_, gesture) => {
      if (!swipingRef.current) {
        // A plain tap on an open row closes it; a vertical drag leaves it be.
        if (openRef.current && Math.abs(gesture.dx) < 8 && Math.abs(gesture.dy) < 8) animateTo(0);
        return;
      }
      swipingRef.current = false;
      holdClicks();
      const base = openRef.current ? -revealWidth : 0;
      const projected = base + gesture.dx;
      if (projected <= -revealWidth / 2) {
        if (!openRef.current) hapticLight();
        animateTo(-revealWidth);
      } else {
        animateTo(0);
      }
    },
    // Hand the touch to a scroll view unless we're mid-swipe.
    onPanResponderTerminationRequest: () => !swipingRef.current,
    onPanResponderTerminate: () => {
      swipingRef.current = false;
      animateTo(openRef.current ? -revealWidth : 0);
    },
  }), [disabled, revealWidth]);

  const close = () => animateTo(0);

  // Web only (mouse): swallow the click a swipe ends with (see
  // suppressClickUntil), and keep the browser's own image drag / text
  // selection from starting, either of which ends the swipe mid-gesture.
  const isWeb = Platform?.OS === 'web';
  const frontRef = useRef<any>(null);
  useEffect(() => {
    const node = frontRef.current as { addEventListener?: Function; removeEventListener?: Function } | null;
    if (!isWeb || !node?.addEventListener) return;
    const onClick = (event: { stopPropagation(): void; preventDefault(): void }) => {
      if (Date.now() < suppressClickUntil.current) { event.stopPropagation(); event.preventDefault(); }
    };
    // react-native-web ends the gesture on a `dragstart` (an image drag) or
    // on a text selection change, both of which a mouse drag across the row
    // starts — so stop them at mousedown. Clicks and the gesture itself are
    // unaffected; form fields keep their default so they can still focus.
    const onMouseDown = (event: { target?: { tagName?: string; isContentEditable?: boolean } | null; preventDefault(): void }) => {
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable) return;
      event.preventDefault();
    };
    const onDragStart = (event: { preventDefault(): void }) => event.preventDefault();
    node.addEventListener('click', onClick, true);
    node.addEventListener('mousedown', onMouseDown, true);
    node.addEventListener('dragstart', onDragStart, true);
    return () => {
      node.removeEventListener?.('click', onClick, true);
      node.removeEventListener?.('mousedown', onMouseDown, true);
      node.removeEventListener?.('dragstart', onDragStart, true);
    };
  }, [isWeb]);

  return (
    <View style={[styles.clip, backgroundColor ? { backgroundColor } : null]}>
      {actionsVisible && (
        <View style={[styles.actionsRow, { width: revealWidth }]}>
          {actions.map((action) => (
            <Pressable
              key={action.key}
              style={[styles.action, { backgroundColor: action.color, width: ACTION_WIDTH }]}
              onPress={() => { close(); action.onPress(); }}
              accessibilityRole="button"
              accessibilityLabel={action.accessibilityLabel}
            >
              <Icon name={action.icon} size={18} color={action.iconColor} />
            </Pressable>
          ))}
        </View>
      )}
      <Animated.View ref={isWeb ? frontRef : undefined} style={[styles.front, backgroundColor ? { backgroundColor } : null, { transform: [{ translateX }] }]} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Explicit width on both the clip and the front content: without it, an
  // unconstrained `<Animated.View>` shrinks to its content's own width
  // rather than stretching to the row's full width, leaving a gap at the
  // trailing edge that let the absolutely-positioned action buttons behind
  // it show through even at rest (translateX: 0).
  clip: { overflow: 'hidden', position: 'relative', width: '100%' },
  // Explicit stacking order on web and native: at rest the opaque front
  // fully covers the colored actions, even at fractional-pixel row edges.
  front: { width: '100%', zIndex: 1 },
  actionsRow: { position: 'absolute', top: 0, right: 0, bottom: 0, flexDirection: 'row', zIndex: 0 },
  action: { alignItems: 'center', justifyContent: 'center' },
});
