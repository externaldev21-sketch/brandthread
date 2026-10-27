/**
 * ProcreateToolIcons.tsx — the canvas top bar's five tool glyphs drawn to
 * match Procreate's own (paintbrush, smudge finger, eraser block, stacked
 * layers) instead of generic icon-font stand-ins. Monochrome: they take one
 * colour, so active/inactive is just FG vs MUTED like the rest of the skin.
 */

import React from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

interface GlyphProps { size?: number; color: string }

export function PaintbrushGlyph({ size = 22, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M21 3 L13.2 10.8" stroke={color} strokeWidth={2.3} strokeLinecap="round" />
      <Path d="M12.4 9.9 L14.1 11.6 L11.6 14.1 L9.9 12.4 Z" fill={color} />
      <Path d="M9.2 13.2 C7.3 13.1 5.9 14.4 5.6 16.2 C5.3 17.9 4.6 19.1 2.8 19.8 C5.7 21.2 9.6 20.8 10.8 18.6 C11.8 16.8 11.2 14.6 9.2 13.2 Z" fill={color} />
    </Svg>
  );
}

export function SmudgeGlyph({ size = 22, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M8.2 21.3 C5.6 20.6 4.1 18 4.8 15.4 L6.3 10.2 C6.6 9.3 7.5 8.8 8.4 9 C9.3 9.3 9.8 10.2 9.6 11.1 L9.2 12.6 L12.9 3.8 C13.3 2.9 14.3 2.5 15.2 2.9 C16.1 3.3 16.5 4.3 16.1 5.2 L13.9 10.5 L14.4 10.4 C15.5 10.2 16.5 10.9 16.7 12 L16.8 12.3 C17.9 12.2 18.9 12.9 19.1 14 C19.3 15 18.9 16 18 16.5 C17.6 19.6 14.8 21.9 11.6 21.7 Z"
        fill={color}
      />
    </Svg>
  );
}

export function EraserGlyph({ size = 22, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M14.6 3.2 L21 9.6 L12.4 18.2 L7.2 18.2 L3 14 Z" fill={color} />
      <Path d="M7.6 9.6 L14.2 16.2" stroke="#000000" strokeOpacity={0.45} strokeWidth={1.2} />
      <Path d="M12.6 20.6 H21" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export function LayersGlyph({ size = 22, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={8.5} y={3.5} width={12} height={12} rx={2.2} stroke={color} strokeWidth={1.8} fill="none" />
      <Rect x={3.5} y={8.5} width={12} height={12} rx={2.2} fill={color} />
    </Svg>
  );
}
