/**
 * Brandthread AI Tools — 2-step progress bar
 *
 * A thin white bar directly under the header that glides between two
 * resting points: 50% for "screen 1 of 2", 100% for "screen 2 of 2". No
 * step dots, no numbers, no "Step 1 of 2" text — Dev's explicit ask,
 * replacing the old 6-dot stepper pattern. Going back from screen 2 to
 * screen 1 glides back down to 50%, never to 0 — 50% is screen 1's own
 * resting state, not "nothing happened yet".
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

export function AiToolProgressBar({ step }: { step: 1 | 2 }) {
  const reduceMotion = useReducedMotion();
  const target = step === 1 ? 0.5 : 1;
  const widthAnim = useRef(new Animated.Value(target)).current;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: target,
      duration: reduceMotion ? 1 : 400,
      useNativeDriver: false, // animating `width` (a layout prop) can't use the native driver
    }).start();
  }, [target, reduceMotion, widthAnim]);

  return (
    <View style={s.track}>
      <Animated.View
        style={[
          s.fill,
          { width: widthAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
        ]}
      />
    </View>
  );
}

// Dev's explicit spec (follow-up screenshot review): a dedicated bar, not a
// divider line — full-width #2A2A2A track, white fill, 3px tall, flush
// (zero margin) directly under ScreenHeader. Fixed values rather than
// theme tokens because the whole AI-tools family is still pre-Appearance-
// theme monochrome (see this component's allowlist entry in
// tests/no-hardcoded-theme-color-lint.test.ts).
const s = StyleSheet.create({
  track: {
    height: 3,
    backgroundColor: '#2A2A2A',
  },
  fill: {
    height: 3,
    backgroundColor: '#FFFFFF',
  },
});
