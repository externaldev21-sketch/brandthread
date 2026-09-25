import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, G, Path, Pattern, Rect } from 'react-native-svg';
import { useAppTheme } from '@/contexts/AppThemeContext';

/**
 * Subtle themed backdrop for the chat screen: a soft gradient (derived from
 * the active theme's heroGradient/primaryGradient) topped with a very
 * low-contrast repeating line-art pattern of fashion motifs — a hanger, a
 * thread spool, a needle, a sneaker, and a price tag. Drawn as vector paths
 * (not a raster image) so it re-themes instantly across all 12 palettes and
 * scales cleanly to any screen size without shipping per-theme assets.
 *
 * Opacity is kept intentionally low (~4-6%) so message bubbles stay legible
 * regardless of which theme is active.
 */
export default function ChatWallpaper() {
  const { theme } = useAppTheme();
  const lineColor = theme.text;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={theme.heroGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[`${theme.background}00`, theme.background]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <Pattern id="chat-motifs" width={140} height={140} patternUnits="userSpaceOnUse">
            {/* Hanger */}
            <G opacity={0.05} stroke={lineColor} strokeWidth={1.4} fill="none" strokeLinecap="round" strokeLinejoin="round">
              <Path d="M18 18 L18 22 M8 34 L18 22 L28 34 Z M8 34 L28 34" />
            </G>
            {/* Thread spool */}
            <G opacity={0.045} stroke={lineColor} strokeWidth={1.4} fill="none" strokeLinecap="round" strokeLinejoin="round" transform="translate(88, 12)">
              <Path d="M0 0 L14 0 M0 20 L14 20 M2 0 C2 8 12 8 12 0 M2 20 C2 12 12 12 12 20" />
            </G>
            {/* Needle + thread */}
            <G opacity={0.05} stroke={lineColor} strokeWidth={1.3} fill="none" strokeLinecap="round" strokeLinejoin="round" transform="translate(20, 78)">
              <Path d="M0 26 L22 4 M18 0 A3 3 0 0 1 22 4 A3 3 0 0 1 18 8 A3 3 0 0 1 14 4 A3 3 0 0 1 18 0 Z" />
              <Path d="M-2 30 C4 34 8 24 -4 26" />
            </G>
            {/* Sneaker */}
            <G opacity={0.045} stroke={lineColor} strokeWidth={1.3} fill="none" strokeLinecap="round" strokeLinejoin="round" transform="translate(84, 92)">
              <Path d="M0 16 C0 10 4 9 9 8 C13 7 15 3 19 3 C24 3 26 8 30 9 C34 10 36 12 36 16 C36 18 34 19 30 19 L4 19 C1 19 0 18 0 16 Z" />
              <Path d="M9 8 L14 13 M19 3 L22 9" />
            </G>
            {/* Price tag */}
            <G opacity={0.05} stroke={lineColor} strokeWidth={1.3} fill="none" strokeLinecap="round" strokeLinejoin="round" transform="translate(52, 46) rotate(18)">
              <Path d="M0 6 L6 0 L16 0 L16 10 L10 16 Z" />
              <Path d="M12 4 a1.4 1.4 0 1 1 0.01 0" />
            </G>
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#chat-motifs)" />
      </Svg>
    </View>
  );
}
