/**
 * GarmentMockup — a front-view tee / hoodie in any garment colour with the
 * design's transparent PNG printed on the chest print area. Transparent
 * pixels of the artwork show the garment through (that's the point of
 * exporting without the background), and the fabric shading sits OVER the
 * print so it reads as printed on the shirt rather than floating above it.
 *
 * Pure react-native-svg + one <Image>, so it renders identically on web and
 * native and can be captured by react-native-view-shot for "Add to product".
 */

import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Svg, { ClipPath, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

export type MockupGarment = 'tshirt' | 'hoodie';

const VIEW_W = 400;
const VIEW_H = 460;

interface GarmentSpec {
  body: string;
  details: string[];
  /** Print area in view-box units (x, y, w, h) — 4500×5400-ish proportions. */
  print: { x: number; y: number; w: number; h: number };
}

const SPECS: Record<MockupGarment, GarmentSpec> = {
  tshirt: {
    body: 'M148 30 Q200 66 252 30 L322 54 L378 136 L326 166 L296 134 L298 404 Q200 416 102 404 L104 134 L74 166 L22 136 L78 54 Z',
    details: ['M154 33 Q200 74 246 33', 'M104 134 L103 156', 'M296 134 L297 156', 'M74 166 L22 136', 'M326 166 L378 136'],
    print: { x: 118, y: 96, w: 164, h: 197 },
  },
  hoodie: {
    body: 'M142 42 Q138 6 200 6 Q262 6 258 42 L320 64 L378 300 L334 314 L302 166 L304 442 Q200 456 96 442 L98 166 L66 314 L22 300 L80 64 Z',
    details: [
      'M160 46 Q200 100 240 46', 'M150 40 Q200 22 250 40',
      'M186 86 L182 150', 'M214 86 L218 150',
      'M138 330 L262 330 L282 412 L118 412 Z',
      'M98 420 L304 420',
    ],
    print: { x: 128, y: 120, w: 144, h: 172 },
  },
};

export interface GarmentMockupProps {
  garment: MockupGarment;
  color: string;
  /** Transparent PNG of the design (data URI or file URI). */
  artworkUri?: string | null;
  artworkAspect?: number; // width / height
  width: number;
  /** Rendered instead of the artwork image when there's no artwork (e.g. a vector preview). */
  fallback?: React.ReactNode;
  testID?: string;
}

function isDark(hex: string): boolean {
  const h = hex.replace('#', '').padEnd(6, '0');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b < 110;
}

export default function GarmentMockup({ garment, color, artworkUri, artworkAspect = 4500 / 5400, width, fallback, testID }: GarmentMockupProps) {
  const spec = SPECS[garment];
  const k = width / VIEW_W;
  const height = VIEW_H * k;
  const dark = isDark(color);
  const line = dark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.18)';

  // Aspect-fit the artwork inside the print area, anchored to its top (chest prints sit high).
  const pa = spec.print;
  const fitW = Math.min(pa.w, pa.h * artworkAspect);
  const fitH = fitW / artworkAspect;
  const art = { left: (pa.x + (pa.w - fitW) / 2) * k, top: pa.y * k, width: fitW * k, height: fitH * k };

  return (
    <View style={{ width, height }} testID={testID}>
      <Svg width={width} height={height} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} style={StyleSheet.absoluteFill}>
        <Path d={spec.body} fill={color} stroke={line} strokeWidth={1.4} />
      </Svg>

      <View style={[s.print, art]} pointerEvents="none" testID="mockup-print-area">
        {artworkUri ? (
          <Image source={{ uri: artworkUri }} style={StyleSheet.absoluteFill} resizeMode="contain" testID="mockup-artwork" />
        ) : fallback}
      </View>

      {/* Fabric shading + seams over the print, clipped to the garment. */}
      <Svg width={width} height={height} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <ClipPath id={`gm-clip-${garment}`}>
            <Path d={spec.body} />
          </ClipPath>
          <LinearGradient id="gm-sides" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#000" stopOpacity={0.28} />
            <Stop offset="0.22" stopColor="#000" stopOpacity={0} />
            <Stop offset="0.78" stopColor="#000" stopOpacity={0} />
            <Stop offset="1" stopColor="#000" stopOpacity={0.3} />
          </LinearGradient>
          <RadialGradient id="gm-light" cx="0.45" cy="0.32" r="0.6">
            <Stop offset="0" stopColor="#FFF" stopOpacity={dark ? 0.1 : 0.16} />
            <Stop offset="1" stopColor="#FFF" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <G clipPath={`url(#gm-clip-${garment})`}>
          <Rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill="url(#gm-sides)" />
          <Rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill="url(#gm-light)" />
          {/* soft folds */}
          <Path d="M146 300 Q160 350 154 404" stroke="#000" strokeOpacity={0.035} strokeWidth={16} fill="none" strokeLinecap="round" />
          <Path d="M256 296 Q244 350 250 404" stroke="#000" strokeOpacity={0.03} strokeWidth={18} fill="none" strokeLinecap="round" />
        </G>
        {spec.details.map((d, i) => (
          <Path key={i} d={d} stroke={line} strokeWidth={1.6} fill="none" strokeLinecap="round" />
        ))}
      </Svg>
    </View>
  );
}

const s = StyleSheet.create({
  print: { position: 'absolute' },
});
