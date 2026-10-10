/**
 * GarmentSilhouette — clean chrome/silver product silhouettes used as the
 * tappable starting points on the AI Design empty state. Pure SVG (no network,
 * no generated imagery), silver-gradient fill on black, per the black/white/
 * silver palette.
 */
import React from 'react';
import Svg, { Defs, LinearGradient, Stop, Path } from 'react-native-svg';
import type { GarmentType } from '@/services/designTypes';

export type SilhouetteGarment = Extract<
  GarmentType, 'hoodie' | 'tshirt' | 'sweatshirt' | 'jacket' | 'sweatpants' | 'shorts' | 'denim' | 'hat' | 'bag'
>;

interface Shape {
  /** Filled silhouette. */
  body: string;
  /** Thin detail strokes (hood, zip, pockets, seams). */
  detail?: string[];
}

const SHAPES: Record<SilhouetteGarment, Shape> = {
  tshirt: {
    body: 'M31 14 L12 25 L21 40 L30 35 L30 86 L70 86 L70 35 L79 40 L88 25 L69 14 Q60 24 50 24 Q40 24 31 14 Z',
    detail: ['M31 14 Q40 24 50 24 Q60 24 69 14'],
  },
  hoodie: {
    body: 'M33 20 L11 32 L14 66 L27 63 L28 88 L72 88 L73 63 L86 66 L89 32 L67 20 Q50 34 33 20 Z',
    detail: [
      'M33 20 Q34 6 50 6 Q66 6 67 20',
      'M42 28 L42 44 M58 28 L58 44',
      'M36 66 L64 66 L61 80 L39 80 Z',
      'M30 36 L28 64 M70 36 L72 64',
    ],
  },
  sweatshirt: {
    body: 'M33 16 L11 29 L14 66 L27 63 L28 88 L72 88 L73 63 L86 66 L89 29 L67 16 Q50 26 33 16 Z',
    detail: ['M38 17 Q50 30 62 17', 'M28 80 L72 80', 'M30 32 L28 64 M70 32 L72 64'],
  },
  jacket: {
    body: 'M32 13 L10 27 L14 72 L27 69 L28 88 L72 88 L73 69 L86 72 L90 27 L68 13 L50 27 Z',
    detail: ['M50 27 L50 88', 'M32 13 L42 30 M68 13 L58 30', 'M33 62 L43 62 M57 62 L67 62', 'M29 34 L27 68 M71 34 L73 68'],
  },
  sweatpants: {
    body: 'M30 10 L70 10 L76 90 L56 90 L50 40 L44 90 L24 90 Z',
    detail: ['M30 18 L70 18', 'M25 76 L45 76 M55 76 L75 76'],
  },
  shorts: {
    body: 'M26 18 L74 18 L81 70 L55 70 L50 40 L45 70 L19 70 Z',
    detail: ['M26 26 L74 26'],
  },
  denim: {
    body: 'M30 10 L70 10 L76 90 L55 90 L50 42 L45 90 L24 90 Z',
    detail: ['M30 18 L70 18', 'M50 18 L50 42', 'M34 22 Q38 30 38 34'],
  },
  hat: {
    body: 'M19 60 Q19 26 50 26 Q81 26 81 60 Z M19 60 L81 60 Q98 64 94 71 Q70 68 50 68 Q28 68 19 62 Z',
    detail: ['M50 26 L50 60', 'M50 26 Q34 32 30 60 M50 26 Q66 32 70 60'],
  },
  bag: {
    body: 'M25 34 L75 34 L79 88 L21 88 Z',
    detail: ['M38 34 Q38 12 50 12 Q62 12 62 34'],
  },
};

export function GarmentSilhouette({ garment, size = 64 }: { garment: SilhouetteGarment; size?: number }) {
  const shape = SHAPES[garment];
  const id = `chrome-${garment}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="0.35" stopColor="#B8B8B8" />
          <Stop offset="0.55" stopColor="#F2F2F2" />
          <Stop offset="1" stopColor="#6E6E6E" />
        </LinearGradient>
      </Defs>
      <Path d={shape.body} fill={`url(#${id})`} stroke="#E6E6E6" strokeWidth={1} strokeLinejoin="round" />
      {shape.detail?.map((d) => (
        <Path key={d} d={d} fill="none" stroke="#3A3A3A" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </Svg>
  );
}

export const GARMENT_TILES: { key: SilhouetteGarment; label: string }[] = [
  { key: 'hoodie', label: 'Hoodie' },
  { key: 'tshirt', label: 'T-shirt' },
  { key: 'sweatshirt', label: 'Sweatshirt' },
  { key: 'jacket', label: 'Jacket' },
  { key: 'sweatpants', label: 'Sweatpants' },
  { key: 'shorts', label: 'Shorts' },
  { key: 'denim', label: 'Denim' },
  { key: 'hat', label: 'Cap' },
  { key: 'bag', label: 'Tote' },
];
