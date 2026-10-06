import React from 'react';
import Svg, { Path } from 'react-native-svg';

/**
 * "Sort" glyph (arrow-up-down). Feather has no up/down sort arrow, so this
 * draws the standard 24×24 two-arrow outline with Feather's own stroke
 * weight and round caps, so it sits next to Feather icons without looking
 * like a different icon family.
 */
export function ArrowUpDownIcon({ size = 14, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="m21 16-4 4-4-4" />
      <Path d="M17 20V4" />
      <Path d="m3 8 4-4 4 4" />
      <Path d="M7 4v16" />
    </Svg>
  );
}
