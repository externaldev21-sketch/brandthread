/**
 * Fallback for the order globe where 3D can't run (Expo Go has no Skia):
 * the same dot-matrix land and the same glowing silver order dots on a flat
 * equirectangular map, with the same tap popover. Static: nothing animates,
 * so it costs one SVG render.
 */
import React, { memo, useMemo } from 'react';
import { Pressable, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { GLOBE_LAND_DOTS } from '@/lib/liveMap/globeLand';
import { HIT_SLOP } from '@/lib/liveMap/globe';
import type { LiveMapRecentOrder } from '@/lib/liveMap/liveMap';
import { GLOBE_COLORS } from './globeColors';

const LAT_TOP = 84;
const LAT_BOTTOM = -58;

/** Equirectangular point in a width × height box (same latitude band as the land data). */
export function flatPoint(lat: number, lng: number, width: number, height: number): { x: number; y: number } {
  const clamped = Math.max(LAT_BOTTOM, Math.min(LAT_TOP, lat));
  return { x: ((lng + 180) / 360) * width, y: ((LAT_TOP - clamped) / (LAT_TOP - LAT_BOTTOM)) * height };
}

export function flatHeightFor(width: number): number {
  return Math.round((width * (LAT_TOP - LAT_BOTTOM)) / 360);
}

export function flatHitTest(orders: readonly LiveMapRecentOrder[], width: number, height: number, x: number, y: number): LiveMapRecentOrder | null {
  let best: LiveMapRecentOrder | null = null;
  let bestDist = HIT_SLOP * HIT_SLOP + 1e-6;
  for (const order of orders) {
    const p = flatPoint(order.lat, order.lng, width, height);
    const dist = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (dist < bestDist) {
      best = order;
      bestDist = dist;
    }
  }
  return best;
}

const Land = memo(function Land({ width, height }: { width: number; height: number }) {
  const dots = useMemo(() => {
    const out: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < GLOBE_LAND_DOTS.length; i += 2) out.push(flatPoint(GLOBE_LAND_DOTS[i] / 10, GLOBE_LAND_DOTS[i + 1] / 10, width, height));
    return out;
  }, [width, height]);
  return (
    <>
      {dots.map((p, i) => (
        <Rect key={i} x={p.x - 0.7} y={p.y - 0.7} width={1.4} height={1.4} fill={`rgba(${GLOBE_COLORS.landRgb},0.55)`} />
      ))}
    </>
  );
});

export function FlatOrderMap({
  width,
  orders,
  selectedId,
  onSelect,
}: {
  width: number;
  orders: LiveMapRecentOrder[];
  selectedId: string | null;
  onSelect: (order: LiveMapRecentOrder | null, x: number, y: number) => void;
}) {
  const height = flatHeightFor(width);
  const onPress = (e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    const hit = flatHitTest(orders, width, height, locationX, locationY);
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
          </Defs>
          <Rect x={0} y={0} width={width} height={height} fill={GLOBE_COLORS.sphereDark} />
          <Land width={width} height={height} />
          {[...orders].reverse().map((order) => {
            const p = flatPoint(order.lat, order.lng, width, height);
            const selected = order.id === selectedId;
            return (
              <React.Fragment key={order.id}>
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
