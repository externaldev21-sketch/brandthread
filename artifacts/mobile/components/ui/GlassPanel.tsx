/**
 * Brandthread Design System — GlassPanel
 *
 * A frosted, monochrome glass surface for floating chrome over full-bleed
 * photo/gradient backdrops (Discover hero, product stat strips) — the same
 * "glass info card" language GOAT uses over its product cutout stories.
 * Follows the same lazy `expo-blur` require as IconButton's glass variant so
 * screens that never render a GlassPanel don't pull the native blur module
 * into their bundle.
 */
import React from 'react';
import { Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { RADII } from '@/constants/radii';

export interface GlassPanelProps {
  children: React.ReactNode;
  /** Blur intensity 0-100. Defaults to a medium frost. */
  intensity?: number;
  /** 'dark' (default) reads on photo/gradient backdrops; 'light' for bright surfaces. */
  tint?: 'dark' | 'light';
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

export function GlassPanel({ children, intensity = 40, tint = 'dark', radius = RADII.sheet, style }: GlassPanelProps) {
  return (
    <View style={[{ borderRadius: radius, overflow: 'hidden' }, style]}>
      {Platform.OS !== 'android' && <GlassBlur intensity={intensity} tint={tint} style={StyleSheet.absoluteFill} />}
      <View
        style={[
          StyleSheet.absoluteFill,
          tint === 'dark' ? styles.tintDark : styles.tintLight,
        ]}
      />
      <View style={[StyleSheet.absoluteFill, styles.border, { borderRadius: radius }]} />
      {children}
    </View>
  );
}

function GlassBlur({ style, intensity, tint }: { style: StyleProp<ViewStyle>; intensity: number; tint: 'dark' | 'light' }) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BlurView } = require('expo-blur') as { BlurView: typeof import('expo-blur').BlurView };
    return <BlurView intensity={intensity} tint={tint} style={style} />;
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  tintDark: { backgroundColor: 'rgba(10,10,11,0.38)' },
  tintLight: { backgroundColor: 'rgba(255,255,255,0.55)' },
  border: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
});
