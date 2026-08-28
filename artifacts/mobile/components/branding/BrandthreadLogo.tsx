/**
 * BrandthreadLogo — official reusable logo component.
 * Uses the transparent PNG at assets/images/brandthread-logo.png.
 * Drop in the real PNG to update every screen at once.
 */

import React, { useRef, useEffect } from 'react';
import { Image, View, Animated, StyleSheet } from 'react-native';
import { LOGO_SOURCE, LOGO_A11Y_LABEL } from '@/constants/branding';

interface BrandthreadLogoProps {
  /** Uniform size (width = height). Overridden by explicit width/height. */
  size?: number;
  width?: number;
  height?: number;
  opacity?: number;
  /** Fade-in entrance animation. */
  animated?: boolean;
  /** Soft theme glow halo behind the logo. */
  showGlow?: boolean;
  glowColor?: string;
  accessibilityLabel?: string;
  testID?: string;
  style?: object;
}

export default function BrandthreadLogo({
  size = 52,
  width,
  height,
  opacity = 1,
  animated = false,
  showGlow = false,
  glowColor = '#DDE2E8',
  accessibilityLabel = LOGO_A11Y_LABEL,
  testID = 'brandthread-logo',
  style,
}: BrandthreadLogoProps) {
  const w = width  ?? size;
  const h = height ?? size;

  const fadeAnim = useRef(new Animated.Value(animated ? 0 : 1)).current;

  useEffect(() => {
    if (!animated) return;
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, [animated, fadeAnim]);

  const glowSize = Math.round(Math.max(w, h) * 2.2);

  return (
    <Animated.View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.container,
        { width: w, height: h, opacity: fadeAnim },
        style,
      ]}
    >
      {showGlow && (
        <View
          style={[
            styles.glow,
            {
              width: glowSize,
              height: glowSize,
              borderRadius: glowSize / 2,
              backgroundColor: glowColor + '22',
              top: -(glowSize - h) / 2,
              left: -(glowSize - w) / 2,
            },
          ]}
        />
      )}
      <Image
        source={LOGO_SOURCE}
        style={{ width: w, height: h, opacity }}
        resizeMode="contain"
        accessible={false}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
  },
});
