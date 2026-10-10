/**
 * Received-side "typing" bubble shown at the end of a thread while the other
 * participant is composing (conv.otherTyping) — three dots pulsing in
 * sequence, the Instagram / iMessage pattern. Purely presentational.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

const DOT = 7;

export function TypingBubble({ testID = 'typing-bubble' }: { testID?: string }) {
  const colors = useColors();
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const loops = dots.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(v, { toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
          Animated.timing(v, { toValue: 0, duration: 320, easing: Easing.in(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
          Animated.delay((2 - i) * 160),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [dots]);

  return (
    <View style={styles.wrap} testID={testID} accessibilityLabel="Typing" accessibilityRole="text">
      <View style={[styles.bubble, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {dots.map((v, i) => (
          <Animated.View
            key={i}
            style={[
              styles.dot,
              {
                backgroundColor: colors.mutedForeground,
                opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
                transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }],
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'flex-start', paddingTop: 4, paddingBottom: 8 },
  bubble: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
});
