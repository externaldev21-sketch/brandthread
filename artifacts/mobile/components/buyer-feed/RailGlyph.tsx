/**
 * Cohesive filled SVG glyph set for the buyer feed's right action rail.
 * One 24-unit viewBox, one fill language, white with a soft drop shadow
 * (a translucent offset copy underneath — works on native + web without
 * filters). No fonts/emoji.
 */
import React from 'react';
import { Platform } from 'react-native';
import Svg, { Path, G } from 'react-native-svg';

export type RailGlyphName = 'heart' | 'comment' | 'repost' | 'bookmark' | 'bookmark-outline' | 'share' | 'plus' | 'check';

const PATHS: Record<RailGlyphName, string> = {
  heart:
    'M12 21.2c-.3 0-.6-.1-.8-.3C5.6 16.3 2 13.1 2 8.9 2 5.9 4.3 3.6 7.2 3.6c1.9 0 3.6.9 4.8 2.5 1.2-1.6 2.9-2.5 4.8-2.5 2.9 0 5.2 2.3 5.2 5.3 0 4.2-3.6 7.4-9.2 12-.2.2-.5.3-.8.3z',
  comment:
    'M12 3C6.5 3 2 6.8 2 11.5c0 2.4 1.2 4.6 3.1 6.1-.2 1.4-.8 2.6-1.8 3.5-.2.2-.1.6.2.6 2.1 0 3.9-.8 5.1-1.7 1.1.3 2.2.5 3.4.5 5.5 0 10-3.8 10-8.5S17.5 3 12 3zM7.5 13a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm4.5 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm4.5 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3z',
  repost:
    'M17.3 2.3l3.9 3.6c.4.4.4 1 0 1.4l-3.9 3.6c-.6.6-1.6.1-1.6-.7V8.4H7.5c-1 0-1.8.8-1.8 1.8v1.6c0 .8-.6 1.4-1.4 1.4S3 12.6 3 11.8v-1.6C3 7.7 5 5.7 7.5 5.7h8.2V3c0-.8 1-1.3 1.6-.7zM6.7 21.7l-3.9-3.6c-.4-.4-.4-1 0-1.4l3.9-3.6c.6-.6 1.6-.1 1.6.7v1.8h8.2c1 0 1.8-.8 1.8-1.8v-1.6c0-.8.6-1.4 1.4-1.4s1.3.6 1.3 1.4v1.6c0 2.5-2 4.5-4.5 4.5H8.3V21c0 .8-1 1.3-1.6.7z',
  bookmark:
    'M6.5 2.5h11c1.1 0 2 .9 2 2v16.3c0 .8-.9 1.3-1.6.8L12 17.4l-5.9 4.2c-.7.5-1.6 0-1.6-.8V4.5c0-1.1.9-2 2-2z',
  'bookmark-outline':
    'M6.5 2.5h11c1.1 0 2 .9 2 2v16.3c0 .8-.9 1.3-1.6.8L12 17.4l-5.9 4.2c-.7.5-1.6 0-1.6-.8V4.5c0-1.1.9-2 2-2zM6.8 4.8h10.4v13.9L12 15l-5.2 3.7V4.8z',
  share:
    'M13.2 3.3l8.4 7.6c.6.6.6 1.6 0 2.2l-8.4 7.6c-.7.6-1.7.1-1.7-.8v-3.7c-4.6 0-7.6 1.3-9.8 4.6-.3.4-.9.2-.9-.3C1.6 13.8 5.2 9.3 11.5 8.6V4.1c0-.9 1-1.4 1.7-.8z',
  plus: 'M12 5.5c.7 0 1.3.6 1.3 1.3v3.9h3.9a1.3 1.3 0 010 2.6h-3.9v3.9a1.3 1.3 0 01-2.6 0v-3.9H6.8a1.3 1.3 0 010-2.6h3.9V6.8c0-.7.6-1.3 1.3-1.3z',
  check: 'M9.6 17.3c-.4 0-.7-.1-1-.4l-3.7-3.7a1.3 1.3 0 011.9-1.9l2.8 2.8 7.6-7.6a1.3 1.3 0 011.9 1.9l-8.5 8.5c-.3.3-.6.4-1 .4z',
};

export function RailGlyph({
  name, size = 32, color = '#FFFFFF', shadow = true,
}: { name: RailGlyphName; size?: number; color?: string; shadow?: boolean }) {
  const d = PATHS[name];
  const accessibility = Platform.OS === 'web'
    ? { 'aria-hidden': true }
    : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const };
  return (
    <Svg width={size} height={size} viewBox="-1 -1 26 26" {...accessibility}>
      {shadow && (
        <G>
          <Path d={d} fillRule="evenodd" fill="#000" opacity={0.18} transform="translate(0 1.4)" />
          <Path d={d} fillRule="evenodd" fill="#000" opacity={0.28} transform="translate(0 0.7)" />
        </G>
      )}
      <Path d={d} fillRule="evenodd" fill={color} />
    </Svg>
  );
}
