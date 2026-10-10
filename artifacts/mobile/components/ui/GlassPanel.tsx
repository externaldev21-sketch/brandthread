/**
 * Brandthread Design System — GlassPanel
 *
 * A floating panel (the call bar). It is a bar, not a control over media,
 * so it is drawn as one solid #1C1C1E surface — no blur, nothing showing
 * through (BRANDTHREAD_DESIGN.md "Glass": never a bar).
 *
 * Thin wrapper over `components/ui/Glass` — the app's one shared glass
 * primitive (Apple Liquid Glass sweep) — kept as its own component only so
 * existing call sites don't need to change; it no longer carries its own
 * blur/tint/border logic.
 */
import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { RADII } from '@/constants/radii';
import { Glass } from '@/components/ui/Glass';

export interface GlassPanelProps {
  children: React.ReactNode;
  /** @deprecated `Glass` doesn't expose blur intensity as a dial (its
   *  variants pick a tuned intensity per platform) — kept only so existing
   *  callers passing this don't need an edit; it's a no-op. */
  intensity?: number;
  /** 'dark' (default) reads on photo/gradient backdrops; 'light' for bright surfaces. */
  tint?: 'dark' | 'light';
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

export function GlassPanel({ children, tint = 'dark', radius = RADII.sheet, style }: GlassPanelProps) {
  return (
    <View style={[{ borderRadius: radius, overflow: 'hidden' }, style]}>
      <Glass solid tint={tint} radius={radius} style={StyleSheet.absoluteFill} />
      {children}
    </View>
  );
}
