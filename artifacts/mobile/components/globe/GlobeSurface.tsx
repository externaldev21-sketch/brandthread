/**
 * Order globe renderer for iOS/Android: @shopify/react-native-skia (already
 * a native dependency, see components/design-studio/SkiaDrawingCanvas.tsx)
 * drawing an orthographic sphere whose land dots and order dots are
 * projected on the UI thread from the shared Reanimated view, so rotation,
 * drag and pinch never wait on JavaScript.
 *
 * Skia is loaded through lib/skiaAvailability.ts: Expo Go has no Skia, so
 * there globeSurfaceMode() reports 'flat' and the caller draws the static
 * dotted map (components/globe/FlatOrderMap.tsx) instead.
 *
 * Web uses GlobeSurface.web.tsx (canvas 2D, same projection).
 */
import React, { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { loadSkia } from '@/lib/skiaAvailability';
import {
  globeRadius,
  landAlpha,
  LAND_UNIT,
  projectLatLng,
  projectUnit,
  pulsePhase,
  type GlobeView,
} from '@/lib/liveMap/globe';
import type { LiveMapRecentOrder } from '@/lib/liveMap/liveMap';
import { GLOBE_COLORS } from './globeColors';

export type GlobeSurfaceMode = 'globe' | 'flat';

export function globeSurfaceMode(): GlobeSurfaceMode {
  return loadSkia() ? 'globe' : 'flat';
}

export interface GlobeSurfaceProps {
  size: number;
  view: SharedValue<GlobeView>;
  clock: SharedValue<number>;
  orders: LiveMapRecentOrder[];
  selectedId: string | null;
  /** Orders in this city just landed (socket ping): their dots flare. */
  highlightKey: string | null;
  reduceMotion: boolean;
}

/** Depth bands for land dots: one Points draw each, brighter toward the centre. */
const BANDS = [0.35, 0.7, 1.01] as const;

function OrderDot({
  skia,
  order,
  index,
  view,
  clock,
  size,
  selected,
  flare,
  reduceMotion,
}: {
  skia: any;
  order: LiveMapRecentOrder;
  index: number;
  view: SharedValue<GlobeView>;
  clock: SharedValue<number>;
  size: number;
  selected: boolean;
  flare: boolean;
  reduceMotion: boolean;
}) {
  const { Circle, Group, BlurMask } = skia;
  const { lat, lng } = order;
  const point = useDerivedValue(() => projectLatLng(lat, lng, view.value, size));
  const cx = useDerivedValue(() => point.value[0]);
  const cy = useDerivedValue(() => point.value[1]);
  const opacity = useDerivedValue(() => (point.value[2] > 0 ? Math.min(1, point.value[2] * 4) : 0));
  const ringR = useDerivedValue(() => 3 + pulsePhase(clock.value, index) * 13);
  const ringOpacity = useDerivedValue(() => (reduceMotion ? 0 : (1 - pulsePhase(clock.value, index)) * 0.7));
  const glowR = selected || flare ? 13 : 9;
  return (
    <Group opacity={opacity}>
      <Circle cx={cx} cy={cy} r={glowR} color={`rgba(${GLOBE_COLORS.glowRgb},0.55)`}>
        <BlurMask blur={6} style="normal" />
      </Circle>
      <Circle cx={cx} cy={cy} r={ringR} style="stroke" strokeWidth={1.2} color={`rgb(${GLOBE_COLORS.glowRgb})`} opacity={ringOpacity} />
      <Circle cx={cx} cy={cy} r={selected ? 4 : 2.8} color={GLOBE_COLORS.core} />
      {selected && <Circle cx={cx} cy={cy} r={8} style="stroke" strokeWidth={1.5} color={GLOBE_COLORS.core} />}
    </Group>
  );
}

export function GlobeSurface({ size, view, clock, orders, selectedId, highlightKey, reduceMotion }: GlobeSurfaceProps) {
  const skia = loadSkia() as any;
  // Plain array: copied once into the UI runtime with the worklet below.
  const land = useMemo(() => Array.from(LAND_UNIT), []);

  const bands = useDerivedValue(() => {
    const v = view.value;
    const out: Array<Array<{ x: number; y: number }>> = [[], [], []];
    for (let i = 0; i < land.length; i += 3) {
      const p = projectUnit(land[i], land[i + 1], land[i + 2], v, size);
      const z = p[2];
      if (z <= 0) continue;
      const band = z < BANDS[0] ? 0 : z < BANDS[1] ? 1 : 2;
      out[band].push({ x: p[0], y: p[1] });
    }
    return out;
  });
  const far = useDerivedValue(() => bands.value[0]);
  const mid = useDerivedValue(() => bands.value[1]);
  const near = useDerivedValue(() => bands.value[2]);
  const radius = useDerivedValue(() => globeRadius(size, view.value.zoom));
  const haloR = useDerivedValue(() => radius.value * 1.06);
  const dotWidth = useDerivedValue(() => Math.max(1.6, 2 * view.value.zoom * (size / 340)));

  if (!skia || size <= 0) return null;
  const { Canvas, Circle, Points, BlurMask, RadialGradient, vec } = skia;
  const c = size / 2;
  const hotIndex = highlightKey ? orders.findIndex((o) => o.key === highlightKey) : -1;

  return (
    <Canvas style={{ width: size, height: size }} pointerEvents="none">
      <Circle cx={c} cy={c} r={haloR} color={GLOBE_COLORS.haloInner}>
        <BlurMask blur={14} style="normal" />
      </Circle>
      <Circle cx={c} cy={c} r={radius}>
        <RadialGradient c={vec(c - size * 0.14, c - size * 0.16)} r={size * 0.5} colors={[GLOBE_COLORS.sphereLight, GLOBE_COLORS.sphereDark]} />
      </Circle>
      <Circle cx={c} cy={c} r={radius} style="stroke" strokeWidth={1} color={GLOBE_COLORS.rim} />
      <Points points={far} mode="points" strokeCap="round" strokeWidth={dotWidth} color={`rgba(${GLOBE_COLORS.landRgb},${landAlpha(0.18)})`} />
      <Points points={mid} mode="points" strokeCap="round" strokeWidth={dotWidth} color={`rgba(${GLOBE_COLORS.landRgb},${landAlpha(0.52)})`} />
      <Points points={near} mode="points" strokeCap="round" strokeWidth={dotWidth} color={`rgba(${GLOBE_COLORS.landRgb},${landAlpha(0.85)})`} />
      {orders.map((order, index) => (
        <OrderDot
          key={order.id}
          skia={skia}
          order={order}
          index={index}
          view={view}
          clock={clock}
          size={size}
          selected={order.id === selectedId}
          flare={index === hotIndex}
          reduceMotion={reduceMotion}
        />
      )).reverse()}
    </Canvas>
  );
}
