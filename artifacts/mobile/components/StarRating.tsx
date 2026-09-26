/**
 * Shared filled-star rating display — SVG so it stays crisp at any size,
 * with true partial fill for decimal ratings (4.6 renders as 4 full stars
 * + a star clipped to 60% fill, not rounded to a whole star).
 *
 * Previously review stars used Feather's "star" glyph, which is an OUTLINE-
 * only icon in every color — there is no filled variant — so every star
 * rendered hollow regardless of rating or color. That's the bug this
 * replaces.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useAppTheme } from '@/contexts/AppThemeContext';

// Standard 24x24 five-point star polygon.
const STAR_PATH = 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z';

function Star({ fillPct, size, color, trackColor }: { fillPct: number; size: number; color: string; trackColor: string }) {
  const pct = Math.max(0, Math.min(1, fillPct));
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 24 24" style={StyleSheet.absoluteFill}>
        <Path d={STAR_PATH} fill={trackColor} />
      </Svg>
      {pct > 0 && (
        <View style={[StyleSheet.absoluteFill, { width: `${pct * 100}%`, overflow: 'hidden' }]}>
          <Svg width={size} height={size} viewBox="0 0 24 24">
            <Path d={STAR_PATH} fill={color} />
          </Svg>
        </View>
      )}
    </View>
  );
}

export function StarRating({
  rating, size = 14, color, trackColor,
}: {
  rating: number;
  /** ~14pt in a summary context, ~12pt inline per review. */
  size?: number;
  /** Defaults to the active theme's accent, per the design system. */
  color?: string;
  trackColor?: string;
}) {
  const { theme } = useAppTheme();
  const fillColor = color ?? theme.accent;
  const emptyColor = trackColor ?? theme.borderSubtle;
  return (
    <View style={{ flexDirection: 'row', gap: 2 }} accessibilityLabel={`${rating.toFixed(1)} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} size={size} color={fillColor} trackColor={emptyColor} fillPct={rating - i} />
      ))}
    </View>
  );
}
