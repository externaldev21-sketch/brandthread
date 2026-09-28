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
import React, { useMemo, useRef } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { hapticLight } from '@/lib/haptics';

export interface SwipeAction {
  key: string;
  icon: keyof typeof Feather.glyphMap;
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
}: {
  children: React.ReactNode;
  actions: SwipeAction[];
  disabled?: boolean;
}) {
  const revealWidth = actions.length * ACTION_WIDTH;
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);

  const animateTo = (toValue: number) => {
    Animated.spring(translateX, { toValue, useNativeDriver: true, damping: 22, stiffness: 240 }).start();
    openRef.current = toValue !== 0;
  };

  // True once this gesture is a horizontal swipe (vs a tap or a vertical scroll).
  const swipingRef = useRef(false);
  const isHorizontal = (dx: number, dy: number) => Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.25;

  const panResponder = useMemo(() => PanResponder.create({
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
    onPanResponderGrant: () => { swipingRef.current = false; },
    onPanResponderMove: (_, gesture) => {
      if (!swipingRef.current) {
        if (!isHorizontal(gesture.dx, gesture.dy)) return;
        swipingRef.current = true;
      }
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

  return (
    <View style={styles.clip}>
      <View style={[styles.actionsRow, { width: revealWidth }]}>
        {actions.map((action) => (
          <Pressable
            key={action.key}
            style={[styles.action, { backgroundColor: action.color, width: ACTION_WIDTH }]}
            onPress={() => { close(); action.onPress(); }}
            accessibilityRole="button"
            accessibilityLabel={action.accessibilityLabel}
          >
            <Feather name={action.icon} size={18} color={action.iconColor} />
          </Pressable>
        ))}
      </View>
      <Animated.View style={[styles.front, { transform: [{ translateX }] }]} {...panResponder.panHandlers}>
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
  front: { width: '100%' },
  actionsRow: { position: 'absolute', top: 0, right: 0, bottom: 0, flexDirection: 'row' },
  action: { alignItems: 'center', justifyContent: 'center' },
});
