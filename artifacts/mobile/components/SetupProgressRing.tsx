/**
 * SetupProgressRing — circular percent-complete indicator for the seller
 * guided-setup walkthrough. Pure SVG, no external chart dependency, themed
 * via the active AppTheme so it reads correctly across all 12 themes.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { FONT, FS } from '@/lib/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export default function SetupProgressRing({
  percent,
  size = 72,
  strokeWidth = 6,
  trackColor,
  fillColor,
  textColor,
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
  trackColor: string;
  fillColor: string;
  textColor: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: clamped,
      duration: 600,
      useNativeDriver: false,
    }).start();
  }, [anim, clamped]);

  const strokeDashoffset = anim.interpolate({
    inputRange: [0, 100],
    outputRange: [circumference, 0],
  });

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={fillColor}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference}, ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <Text style={[styles.pct, { color: textColor }]}>{Math.round(clamped)}%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pct: {
    fontFamily: FONT.bold,
    fontSize: FS.sm,
  },
});
