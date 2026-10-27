/**
 * Fallback for the order globe where 3D can't run (Expo Go has no Skia):
 * the same solid silver land and the same activity dots (orders glowing,
 * sessions as rings) on a flat equirectangular map, with the same tap
 * popover. Static: nothing animates and no arcs fly, so it costs one SVG
 * render.
 */
import React, { memo } from 'react';
import { Pressable, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { WORLD_LAND_PATH, WORLD_VIEWBOX } from '@/lib/liveMap/worldLand';
import { HIT_SLOP } from '@/lib/liveMap/globe';
import type { GlobeActivity } from '@/lib/liveMap/liveMap';
import { GLOBE_COLORS } from './globeColors';

const LAT_TOP = 84;
const LAT_BOTTOM = -58;

/** Equirectangular point in a width × height box (same latitude band as the land outline). */
export function flatPoint(lat: number, lng: number, width: number, height: number): { x: number; y: number } {
  const clamped = Math.max(LAT_BOTTOM, Math.min(LAT_TOP, lat));
  return { x: ((lng + 180) / 360) * width, y: ((LAT_TOP - clamped) / (LAT_TOP - LAT_BOTTOM)) * height };
}

export function flatHeightFor(width: number): number {
  return Math.round((width * (LAT_TOP - LAT_BOTTOM)) / 360);
}

export function flatHitTest<T extends { lat: number; lng: number }>(points: readonly T[], width: number, height: number, x: number, y: number): T | null {
  let best: T | null = null;
  let bestDist = HIT_SLOP * HIT_SLOP + 1e-6;
  for (const point of points) {
    const p = flatPoint(point.lat, point.lng, width, height);
    const dist = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (dist < bestDist) {
      best = point;
      bestDist = dist;
    }
  }
  return best;
}

const Land = memo(function Land({ width, height }: { width: number; height: number }) {
  return (
    <G transform={`scale(${width / WORLD_VIEWBOX.width} ${height / WORLD_VIEWBOX.height})`}>
      <Path d={WORLD_LAND_PATH} fill="url(#flatLand)" fillRule="evenodd" />
    </G>
  );
});

export function FlatOrderMap({
  width,
  activities,
  selectedId,
  onSelect,
}: {
  width: number;
  activities: GlobeActivity[];
  selectedId: string | null;
  onSelect: (activity: GlobeActivity | null, x: number, y: number) => void;
}) {
  const height = flatHeightFor(width);
  const onPress = (e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    const hit = flatHitTest(activities, width, height, locationX, locationY);
    if (!hit) { onSelect(null, 0, 0); return; }
    const p = flatPoint(hit.lat, hit.lng, width, height);
    onSelect(hit, p.x, p.y);
  };
  return (
    <Pressable onPress={onPress} style={{ width, height }} testID="seller-globe-flat" accessibilityLabel="Order map">
      <View pointerEvents="none">
        <Svg width={width} height={height}>
          <Defs>
            <RadialGradient id="orderGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={`rgb(${GLOBE_COLORS.glowRgb})`} stopOpacity={0.85} />
              <Stop offset="0.35" stopColor={`rgb(${GLOBE_COLORS.glowRgb})`} stopOpacity={0.32} />
              <Stop offset="1" stopColor={`rgb(${GLOBE_COLORS.glowRgb})`} stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id="sessionGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={`rgb(${GLOBE_COLORS.sessionRgb})`} stopOpacity={0.5} />
              <Stop offset="1" stopColor={`rgb(${GLOBE_COLORS.sessionRgb})`} stopOpacity={0} />
            </RadialGradient>
            <LinearGradient id="flatLand" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={`rgb(${GLOBE_COLORS.landRgb})`} stopOpacity={0.9} />
              <Stop offset="1" stopColor={`rgb(${GLOBE_COLORS.landRgb})`} stopOpacity={0.6} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={width} height={height} fill={GLOBE_COLORS.sphereDark} />
          <Land width={width} height={height} />
          {[...activities].reverse().map((a) => {
            const p = flatPoint(a.lat, a.lng, width, height);
            const selected = a.id === selectedId;
            if (a.kind === 'session') {
              return (
                <React.Fragment key={a.id}>
                  <Circle cx={p.x} cy={p.y} r={selected ? 11 : 8} fill="url(#sessionGlow)" />
                  <Circle cx={p.x} cy={p.y} r={selected ? 3.6 : 2.8} fill="none" stroke={`rgb(${GLOBE_COLORS.glowRgb})`} strokeWidth={1.2} />
                </React.Fragment>
              );
            }
            return (
              <React.Fragment key={a.id}>
                <Circle cx={p.x} cy={p.y} r={selected ? 14 : 10} fill="url(#orderGlow)" />
                <Circle cx={p.x} cy={p.y} r={selected ? 3.6 : 2.6} fill={GLOBE_COLORS.core} />
              </React.Fragment>
            );
          })}
        </Svg>
      </View>
    </Pressable>
  );
}
