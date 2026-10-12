import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FONT } from '@/lib/theme';

interface AiGeneratedBadgeProps {
  /** Corner of the nearest positioned parent. Default bottom-left. */
  position?: 'topLeft' | 'bottomLeft';
}

/**
 * Small solid "AI" tag marking AI-generated media (App Store 5.x / Google Play
 * AI-generated content disclosure). Place inside a container that wraps the
 * image; it pins itself to a corner and never intercepts touches.
 */
export function AiGeneratedBadge({ position = 'bottomLeft' }: AiGeneratedBadgeProps) {
  return (
    <View
      pointerEvents="none"
      accessible
      accessibilityLabel="AI-generated"
      style={[styles.badge, position === 'topLeft' ? styles.topLeft : styles.bottomLeft]}
    >
      <Text style={styles.label}>AI</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    paddingHorizontal: 6,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#C0C0C0',
  },
  topLeft: { top: 6, left: 6 },
  bottomLeft: { bottom: 6, left: 6 },
  label: { color: '#FFFFFF', fontSize: 10, lineHeight: 12, fontWeight: '600', fontFamily: FONT.semibold },
});
