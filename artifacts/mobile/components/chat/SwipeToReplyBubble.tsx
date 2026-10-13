import React, { useMemo, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { haptics } from '@/lib/haptics';
import { REPLY_THRESHOLD, clampSwipeTravel, nextCrossedState, shouldClaimSwipe } from '@/lib/swipeToReply';

interface SwipeToReplyBubbleProps {
  children: React.ReactNode;
  /** Called once, the moment the drag is released past REPLY_THRESHOLD. */
  onReply: () => void;
  disabled?: boolean;
  testID?: string;
  /** Muted/elevated theme tokens only — see the app's monochrome rule. */
  iconColor: string;
  iconBg: string;
}

/**
 * Wraps a single chat bubble (either side of the thread) with a short
 * WhatsApp/Telegram-style swipe-right gesture: dragging the bubble right
 * reveals a reply glyph behind it, fires a light haptic the instant the
 * drag crosses REPLY_THRESHOLD (not on release — that's what makes the
 * swipe itself feel responsive rather than the confirmation), and — if
 * released past the threshold — calls onReply() once. The bubble always
 * springs back to its resting position; this is the one place a quick,
 * subtle spring-back is idiomatic for a swipe-release gesture (distinct
 * from the app's "no bounce" rule for UI chrome transitions/entrances).
 */
export function SwipeToReplyBubble({
  children, onReply, disabled, testID, iconColor, iconBg,
}: SwipeToReplyBubbleProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const crossedRef = useRef(false);

  const snapBack = () => {
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      damping: 22,
      stiffness: 320,
      mass: 0.6,
    }).start();
  };

  const panResponder = useMemo(() => PanResponder.create({
    // Only claims the gesture past a clear rightward, horizontal-dominant
    // drag — a plain tap (double-tap-to-like) or a long-press (reactions/
    // actions sheet) on the bubble underneath is never intercepted.
    onMoveShouldSetPanResponder: (_, gesture) => shouldClaimSwipe(gesture.dx, gesture.dy, disabled),
    onPanResponderGrant: () => { crossedRef.current = false; },
    onPanResponderMove: (_, gesture) => {
      const dx = Math.max(0, gesture.dx);
      translateX.setValue(clampSwipeTravel(dx));
      const { crossed, fireHaptic } = nextCrossedState(dx, crossedRef.current);
      crossedRef.current = crossed;
      if (fireHaptic) haptics.selection();
    },
    onPanResponderRelease: () => {
      const crossed = crossedRef.current;
      crossedRef.current = false;
      snapBack();
      if (crossed) onReply();
    },
    onPanResponderTerminate: snapBack,
  }), [disabled, onReply]);

  const iconOpacity = translateX.interpolate({
    inputRange: [0, REPLY_THRESHOLD * 0.4, REPLY_THRESHOLD],
    outputRange: [0, 0.5, 1],
    extrapolate: 'clamp',
  });
  const iconScale = translateX.interpolate({
    inputRange: [0, REPLY_THRESHOLD * 0.4, REPLY_THRESHOLD],
    outputRange: [0.6, 0.8, 1],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.wrap} testID={testID}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.icon,
          { backgroundColor: iconBg, opacity: iconOpacity, transform: [{ scale: iconScale }] },
        ]}
      >
        <Feather name="corner-up-left" size={15} color={iconColor} />
      </Animated.View>
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
  },
  icon: {
    position: 'absolute',
    left: -34,
    top: '50%',
    marginTop: -13,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
