import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

/**
 * Spinning progress ring shown over media while it uploads.
 *
 * `uploadMedia()` sends the file as a single base64 POST with no byte-level
 * progress callback, so this ring is intentionally indeterminate (a
 * continuously spinning partial arc) rather than a true 0-100% fill — it
 * communicates "working" without fabricating a progress number the app
 * doesn't have.
 *
 * The rotation lives entirely on the wrapping `Animated.View`'s `transform`
 * — the arc `Circle` itself has no animated prop (its dasharray is a fixed
 * fraction of the circumference, computed once). It's rendered as a plain
 * `Circle`, not `Animated.createAnimatedComponent(Circle)`: that wrapper is
 * only needed for a component with an animated prop, and on web it also
 * injects a `collapsable` prop for native view-flattening that plain SVG
 * elements don't understand — react-native-web then forwards it straight to
 * the DOM as a boolean attribute, which React warns about (item 74 found and
 * fixed this while adding a second, more prominent use of this ring).
 */
export default function UploadRing({ size = 28, color, trackColor }: { size?: number; color: string; trackColor?: string }) {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const radius = size / 2 - 2.5;
  const circumference = 2 * Math.PI * radius;

  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate }] }]}>
        <Svg width={size} height={size}>
          {trackColor ? (
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={trackColor}
              strokeWidth={2.5}
              fill="none"
            />
          ) : null}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth={2.5}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${circumference * 0.28} ${circumference}`}
          />
        </Svg>
      </Animated.View>
    </View>
  );
}
