/**
 * Compact sticky header for the scroll-away (video) profile header: once
 * the top bar has scrolled off, a solid bar with the handle/name fades in
 * under the status bar, so the page never shows content (or a cover's
 * ghost text) scrolling raw under the clock. Optional left/right slots
 * keep back / ••• reachable on other people's profiles.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, SP } from '@/lib/theme';

/** Bar height below the safe-area top inset. */
export const PROFILE_STICKY_HEADER_HEIGHT = 44;

export function ProfileStickyHeader({
  visible,
  topPad,
  title,
  left,
  right,
  testID = 'profile-sticky-header',
}: {
  visible: boolean;
  topPad: number;
  title: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: visible ? 1 : 0, duration: 160, useNativeDriver: true }).start();
  }, [opacity, visible]);

  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      style={[
        styles.bar,
        { paddingTop: topPad, height: topPad + PROFILE_STICKY_HEADER_HEIGHT, backgroundColor: theme.background, borderColor: theme.border, opacity },
      ]}
      testID={testID}
    >
      <View style={styles.inner}>
        <View style={[styles.side, styles.sideLeft]}>{left}</View>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{title}</Text>
        <View style={[styles.side, styles.sideRight]}>{right}</View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', top: 0, left: 0, right: 0, borderBottomWidth: StyleSheet.hairlineWidth, zIndex: 5 },
  inner: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, gap: SP.sm },
  side: { width: 64, flexDirection: 'row', alignItems: 'center', gap: 16 },
  sideLeft: { justifyContent: 'flex-start' },
  sideRight: { justifyContent: 'flex-end' },
  title: { flex: 1, textAlign: 'center', fontFamily: FONT.bold, fontSize: 16, letterSpacing: -0.2 },
});
