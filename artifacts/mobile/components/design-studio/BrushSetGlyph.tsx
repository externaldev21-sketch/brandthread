/**
 * BrushSetGlyph.tsx — the little icon above each brush-set name in the
 * Brushes panel's left rail, one per Procreate set (graphite tip for
 * Sketching, pen nib for Inking, palette for Artistic, yin-yang for
 * Elements, spray can for Spraypaints …). User-made sets get the generic
 * brush stroke glyph, as in Procreate.
 */

import React from 'react';
import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';

export default function BrushSetGlyph({ set, color, size = 24 }: { set: string; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {glyph(set, color)}
    </Svg>
  );
}

function glyph(set: string, c: string) {
  switch (set) {
    case 'Sketching':
      return (
        <G>
          <Path d="M12 2.5 L17 15 H7 Z" fill={c} />
          <Path d="M12 2.5 L13.6 6.5 H10.4 Z" fill="#000" fillOpacity={0.55} />
          <Rect x={7} y={16} width={10} height={5.5} rx={1} fill={c} />
        </G>
      );
    case 'Inking':
      return (
        <G>
          <Path d="M12 2 C14.4 5.6 17.5 8.8 17.5 13 L14.6 21 H9.4 L6.5 13 C6.5 8.8 9.6 5.6 12 2 Z" fill={c} />
          <Path d="M12 9 V15.5" stroke="#000" strokeOpacity={0.6} strokeWidth={1.3} strokeLinecap="round" />
          <Circle cx={12} cy={9} r={1.4} fill="#000" fillOpacity={0.6} />
        </G>
      );
    case 'Drawing':
      return <Path d="M4 17 C6 10 9 9 10 12 C11 15 13 16 14.5 12 C16 8 18 6 20 7" stroke={c} strokeWidth={2.4} fill="none" strokeLinecap="round" />;
    case 'Painting':
      return (
        <G>
          <Rect x={10.8} y={11} width={2.4} height={11} rx={1.2} fill={c} />
          <Rect x={8.5} y={8} width={7} height={3.5} rx={0.6} fill={c} />
          <Path d="M8.5 7.5 C8.5 4 10 2.2 12 2.2 C14 2.2 15.5 4 15.5 7.5 Z" fill={c} />
        </G>
      );
    case 'Artistic':
      return (
        <G>
          <Path d="M12 2.5 C6.5 2.5 2.5 6.5 2.5 11.5 C2.5 16.5 6.6 20.5 11 20.5 C13 20.5 13.3 18.8 12.4 17.6 C11.5 16.4 12.2 14.8 14 14.8 H16.5 C19.4 14.8 21.5 12.7 21.5 10 C21.5 5.8 17.3 2.5 12 2.5 Z" fill={c} />
          <Circle cx={7.4} cy={11} r={1.6} fill="#000" fillOpacity={0.6} />
          <Circle cx={9.8} cy={6.8} r={1.6} fill="#000" fillOpacity={0.6} />
          <Circle cx={14.6} cy={6.6} r={1.6} fill="#000" fillOpacity={0.6} />
          <Circle cx={17.8} cy={10} r={1.6} fill="#000" fillOpacity={0.6} />
        </G>
      );
    case 'Calligraphy':
      return <SvgText x={12} y={18.5} fill={c} fontSize={21} fontStyle="italic" fontFamily="Georgia" textAnchor="middle">a</SvgText>;
    case 'Airbrushing':
      return (
        <G>
          <Path d="M3 11.5 H13.5 L17.5 8.5 V16.5 L13.5 13.5 H3 Z" fill={c} />
          <Rect x={8} y={5} width={4} height={5.5} rx={1} fill={c} />
          <Path d="M17.5 12.5 H21.5" stroke={c} strokeWidth={1.6} strokeLinecap="round" />
          <Path d="M6 14 V20" stroke={c} strokeWidth={1.8} strokeLinecap="round" />
        </G>
      );
    case 'Textures':
      return (
        <G>
          <Path d="M12 2.5 L21.5 12 L12 21.5 L2.5 12 Z" fill={c} />
          <Path d="M7.2 7.2 L16.8 16.8 M9.6 4.8 L19.2 14.4 M4.8 9.6 L14.4 19.2" stroke="#000" strokeOpacity={0.55} strokeWidth={1.1} />
        </G>
      );
    case 'Abstract':
      return (
        <G>
          <Path d="M12 3 L21 20 H3 Z" fill={c} />
          <Path d="M12 10 L15.7 17 H8.3 Z" fill="#000" fillOpacity={0.6} />
        </G>
      );
    case 'Charcoals':
      return (
        <G>
          <Rect x={4} y={4} width={3.6} height={16} rx={1} fill={c} />
          <Rect x={10.2} y={4} width={3.6} height={16} rx={1} fill={c} />
          <Rect x={16.4} y={4} width={3.6} height={16} rx={1} fill={c} />
        </G>
      );
    case 'Elements':
      return (
        <G>
          <Circle cx={12} cy={12} r={9.5} fill="none" stroke={c} strokeWidth={1.5} />
          <Path d="M12 2.5 A9.5 9.5 0 0 1 12 21.5 A4.75 4.75 0 0 1 12 12 A4.75 4.75 0 0 0 12 2.5 Z" fill={c} />
          <Circle cx={12} cy={7.25} r={1.4} fill={c} />
          <Circle cx={12} cy={16.75} r={1.4} fill="#000" fillOpacity={0.7} />
        </G>
      );
    case 'Spraypaints':
      return (
        <G>
          <Rect x={7.5} y={8} width={9} height={14} rx={1.6} fill={c} />
          <Rect x={9.5} y={4.5} width={5} height={3} rx={0.6} fill={c} />
          <Rect x={11} y={2} width={3.5} height={2} rx={0.4} fill={c} />
          <Circle cx={18.5} cy={3} r={0.9} fill={c} />
          <Circle cx={20.5} cy={5} r={0.9} fill={c} />
          <Circle cx={18.5} cy={6.4} r={0.9} fill={c} />
        </G>
      );
    default:
      return <Path d="M3.5 17.5 C7 9 11 7 13 10 C15 13 17 9 20.5 6" stroke={c} strokeWidth={3} fill="none" strokeLinecap="round" />;
  }
}
