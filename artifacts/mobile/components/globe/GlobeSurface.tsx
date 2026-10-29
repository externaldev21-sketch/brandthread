/**
 * Order globe renderer for iOS/Android: @shopify/react-native-skia (already
 * a native dependency, see components/design-studio/SkiaDrawingCanvas.tsx)
 * drawing an orthographic sphere whose land, activity dots and arcs are
 * projected on the UI thread from the shared Reanimated view, so rotation,
 * drag, pinch and arcs never wait on JavaScript.
 *
 * Land is one clipped outline path per frame (lib/liveMap/globe.ts
 * landPath), filled solid silver with a gradient and darkened at the limb.
 * Arcs are a fixed pool of ARC_SLOTS slots (lib/liveMap/arcs.ts): each slot
 * is always mounted and simply draws nothing while free.
 *
 * Skia is loaded through lib/skiaAvailability.ts: Expo Go has no Skia, so
 * there globeSurfaceMode() reports 'flat' and the caller draws the static
 * map (components/globe/FlatOrderMap.tsx) instead.
 *
 * Zoomed in, the zoom-detail layers (lib/liveMap/globeDetail.ts) draw
 * between the land and the dots, also from the shared view on the UI
 * thread: country and state/province borders as stroked paths clipped to
 * the land, and labels recorded into one SkPicture per view (Inter
 * SemiBold, loaded with useFont). At the default zoom they draw nothing.
 *
 * Web uses GlobeSurface.web.tsx (canvas 2D, same projection).
 */
import React from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { loadSkia } from '@/lib/skiaAvailability';
import { globeRadius, LAND_RING_STARTS, LAND_RINGS, landPath, projectLatLng, pulsePhase, type GlobeView } from '@/lib/liveMap/globe';
import { ARC_SLOTS, arcFrame, type ArcSlot } from '@/lib/liveMap/arcs';
import {
  COUNTRY_FONT,
  countryBorderLines,
  countryLabelTable,
  detailLevels,
  hasDetail,
  LAND_HI_ZOOM,
  landHiRings,
  labelLayout,
  linesPath,
  REGION_FONT,
  regionBorderLines,
  regionLabelTable,
} from '@/lib/liveMap/globeDetail';
import type { GlobeActivity } from '@/lib/liveMap/liveMap';
import { GLOBE_COLORS } from './globeColors';

export type GlobeSurfaceMode = 'globe' | 'flat';

export function globeSurfaceMode(): GlobeSurfaceMode {
  return loadSkia() ? 'globe' : 'flat';
}

export interface GlobeSurfaceProps {
  size: number;
  view: SharedValue<GlobeView>;
  clock: SharedValue<number>;
  /** Order and session dots (lib/liveMap/liveMap.ts globeActivities). */
  activities: GlobeActivity[];
  arcs: SharedValue<ArcSlot[]>;
  selectedId: string | null;
  /** Orders in this city just landed (socket ping): their dot flares. */
  highlightKey: string | null;
  reduceMotion: boolean;
}

// Plain arrays: copied once into the UI runtime with the worklets below.
const RINGS = Array.from(LAND_RINGS);
const STARTS = Array.from(LAND_RING_STARTS);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const INTER_SEMIBOLD = require('@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf');
const NO_PATH = 'M0 0';

/**
 * Borders, clip and labels for the zoomed-in globe, as derived values on the
 * UI thread. The detail geometry is decoded on first use, so only a screen
 * that draws a globe pays for it.
 */
function useZoomDetail(skia: any, view: SharedValue<GlobeView>, land: SharedValue<string>, size: number) {
  const hi = landHiRings();
  const cb = countryBorderLines();
  const rb = regionBorderLines();
  const countries = countryLabelTable();
  const regions = regionLabelTable();
  const hiPts = hi.pts;
  const hiStarts = hi.starts;
  const cbPts = cb.pts;
  const cbStarts = cb.starts;
  const rbPts = rb.pts;
  const rbStarts = rb.starts;
  const countryFont = skia?.useFont?.(INTER_SEMIBOLD, COUNTRY_FONT) ?? null;
  const regionFont = skia?.useFont?.(INTER_SEMIBOLD, REGION_FONT) ?? null;
  const Skia = skia?.Skia;
  const createPicture = skia?.createPicture;
  const evenOdd = skia?.FillType?.EvenOdd ?? 1;
  const strokeStyle = skia?.PaintStyle?.Stroke ?? 1;
  const roundJoin = skia?.StrokeJoin?.Round ?? 1;
  const halo = GLOBE_COLORS.labelHaloRgb;
  const ink = GLOBE_COLORS.labelInkRgb;

  const hiLand = useDerivedValue(() => (view.value.zoom > LAND_HI_ZOOM ? landPath(hiPts, hiStarts, view.value, size) : land.value));
  const levels = useDerivedValue(() => detailLevels(view.value.zoom));
  const country = useDerivedValue(() => (hasDetail(view.value.zoom) ? linesPath(cbPts, cbStarts, view.value, size) : NO_PATH));
  const region = useDerivedValue(() => (levels.value.regionBorders > 0 ? linesPath(rbPts, rbStarts, view.value, size) : NO_PATH));
  const countryOpacity = useDerivedValue(() => levels.value.countryBorders);
  const regionOpacity = useDerivedValue(() => levels.value.regionBorders);
  const clip = useDerivedValue(() => {
    if (!Skia || !hasDetail(view.value.zoom)) return Skia ? Skia.Path.Make() : null;
    const p = Skia.Path.MakeFromSVGString(hiLand.value) ?? Skia.Path.Make();
    p.setFillType(evenOdd);
    return p;
  });
  const labels = useDerivedValue(() => {
    if (!Skia || !createPicture) return null;
    return createPicture((canvas: any) => {
      if (!countryFont || !regionFont) return;
      const items = labelLayout(countries, regions, view.value, size);
      if (items.length === 0) return;
      const haloPaint = Skia.Paint();
      haloPaint.setAntiAlias(true);
      haloPaint.setStyle(strokeStyle);
      haloPaint.setStrokeWidth(2.5);
      haloPaint.setStrokeJoin(roundJoin);
      const inkPaint = Skia.Paint();
      inkPaint.setAntiAlias(true);
      for (let i = 0; i < items.length; i += 1) {
        const l = items[i];
        const font = l.font >= COUNTRY_FONT ? countryFont : regionFont;
        const x = l.x - l.width / 2;
        const y = l.y + l.font * 0.36;
        haloPaint.setColor(Skia.Color(`rgba(${halo},${(0.55 * l.alpha).toFixed(3)})`));
        canvas.drawText(l.text, x, y, haloPaint, font);
        inkPaint.setColor(Skia.Color(`rgba(${ink},${(0.9 * l.alpha).toFixed(3)})`));
        canvas.drawText(l.text, x, y, inkPaint, font);
      }
    }, { width: size, height: size });
  });
  return { hiLand, country, region, countryOpacity, regionOpacity, clip, labels };
}

function ActivityDot({
  skia,
  activity,
  index,
  view,
  clock,
  size,
  selected,
  flare,
  reduceMotion,
}: {
  skia: any;
  activity: GlobeActivity;
  index: number;
  view: SharedValue<GlobeView>;
  clock: SharedValue<number>;
  size: number;
  selected: boolean;
  flare: boolean;
  reduceMotion: boolean;
}) {
  const { Circle, Group, BlurMask } = skia;
  const { lat, lng } = activity;
  const isSession = activity.kind === 'session';
  const point = useDerivedValue(() => projectLatLng(lat, lng, view.value, size));
  const cx = useDerivedValue(() => point.value[0]);
  const cy = useDerivedValue(() => point.value[1]);
  const opacity = useDerivedValue(() => (point.value[2] > 0 ? Math.min(1, point.value[2] * 4) : 0));
  const ringR = useDerivedValue(() => 3 + pulsePhase(clock.value, index) * 13);
  const ringOpacity = useDerivedValue(() => (reduceMotion ? 0 : (1 - pulsePhase(clock.value, index)) * 0.7));
  const breathe = useDerivedValue(() => (reduceMotion ? 0.7 : 0.55 + 0.45 * Math.sin((clock.value / 1600 + index * 0.7) * Math.PI)));
  if (isSession) {
    return (
      <Group opacity={opacity}>
        <Circle cx={cx} cy={cy} r={selected ? 10 : 7} color={`rgba(${GLOBE_COLORS.sessionRgb},0.5)`} opacity={breathe}>
          <BlurMask blur={5} style="normal" />
        </Circle>
        <Circle cx={cx} cy={cy} r={selected ? 4 : 3} style="stroke" strokeWidth={1.2} color={`rgba(${GLOBE_COLORS.glowRgb},0.9)`} />
        {selected && <Circle cx={cx} cy={cy} r={8} style="stroke" strokeWidth={1.2} color={`rgba(${GLOBE_COLORS.glowRgb},0.9)`} />}
      </Group>
    );
  }
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

function Arc({ skia, slot, arcs, view, clock, size }: {
  skia: any;
  slot: number;
  arcs: SharedValue<ArcSlot[]>;
  view: SharedValue<GlobeView>;
  clock: SharedValue<number>;
  size: number;
}) {
  const { Circle, Group, Path, BlurMask } = skia;
  const frame = useDerivedValue(() => arcFrame(arcs.value[slot], clock.value, view.value, size));
  const tail = useDerivedValue(() => frame.value.tail);
  const head = useDerivedValue(() => frame.value.head);
  const alpha = useDerivedValue(() => frame.value.alpha);
  const hx = useDerivedValue(() => frame.value.hx);
  const hy = useDerivedValue(() => frame.value.hy);
  const headOpacity = useDerivedValue(() => (frame.value.headVisible ? frame.value.alpha : 0));
  const lx = useDerivedValue(() => frame.value.lx);
  const ly = useDerivedValue(() => frame.value.ly);
  const landR = useDerivedValue(() => 2 + frame.value.landing * 10);
  const landOpacity = useDerivedValue(() => (frame.value.landingVisible ? (1 - frame.value.landing) * 0.8 : 0));
  return (
    <Group>
      <Group opacity={alpha}>
        <Path path={head} style="stroke" strokeWidth={5} strokeCap="round" color={`rgba(${GLOBE_COLORS.arcRgb},0.22)`} />
        <Path path={tail} style="stroke" strokeWidth={1.2} strokeCap="round" color={`rgba(${GLOBE_COLORS.arcRgb},0.4)`} />
        <Path path={head} style="stroke" strokeWidth={1.6} strokeCap="round" color={`rgba(${GLOBE_COLORS.arcRgb},0.95)`} />
      </Group>
      <Circle cx={hx} cy={hy} r={4} color={`rgba(${GLOBE_COLORS.arcRgb},0.9)`} opacity={headOpacity}>
        <BlurMask blur={3} style="normal" />
      </Circle>
      <Circle cx={lx} cy={ly} r={landR} style="stroke" strokeWidth={1.2} color={`rgb(${GLOBE_COLORS.arcRgb})`} opacity={landOpacity} />
    </Group>
  );
}

const SLOT_INDEXES = Array.from({ length: ARC_SLOTS }, (_, i) => i);

export function GlobeSurface({ size, view, clock, arcs, activities, selectedId, highlightKey, reduceMotion }: GlobeSurfaceProps) {
  const skia = loadSkia() as any;

  const baseLand = useDerivedValue(() => landPath(RINGS, STARTS, view.value, size));
  const detail = useZoomDetail(skia, view, baseLand, size);
  // Zoomed in, the finer coastline takes over from the default one.
  const land = detail.hiLand;
  const radius = useDerivedValue(() => globeRadius(size, view.value.zoom));
  const haloR = useDerivedValue(() => radius.value * 1.06);
  // Land shading and the limb shadow follow the radius (as on web), so a
  // zoomed-in map stays lit instead of falling into the zoom-1 limb.
  const landLightC = useDerivedValue(() => ({ x: size / 2 - radius.value * 0.38, y: size / 2 - radius.value * 0.42 }));
  const landLightR = useDerivedValue(() => radius.value * 1.3);
  const limbC = useDerivedValue(() => ({ x: size / 2 - radius.value * 0.2, y: size / 2 - radius.value * 0.22 }));
  const limbR = useDerivedValue(() => radius.value * 1.15);

  if (!skia || size <= 0) return null;
  const { Canvas, Circle, Group, Path, Picture, BlurMask, RadialGradient, vec } = skia;
  const c = size / 2;

  return (
    <Canvas style={{ width: size, height: size }} pointerEvents="none">
      <Circle cx={c} cy={c} r={haloR} color={GLOBE_COLORS.haloInner}>
        <BlurMask blur={14} style="normal" />
      </Circle>
      <Circle cx={c} cy={c} r={radius}>
        <RadialGradient c={vec(c - size * 0.14, c - size * 0.16)} r={size * 0.5} colors={[GLOBE_COLORS.sphereLight, GLOBE_COLORS.sphereDark]} />
      </Circle>
      <Path path={land} fillType="evenOdd">
        <RadialGradient
          c={landLightC}
          r={landLightR}
          colors={[GLOBE_COLORS.landLit, GLOBE_COLORS.landMid, GLOBE_COLORS.landShade]}
          positions={[0, 0.5, 1]}
        />
      </Path>
      <Path path={land} style="stroke" strokeWidth={0.6} color={GLOBE_COLORS.coast} />
      <Group clip={detail.clip}>
        <Path path={detail.region} style="stroke" strokeWidth={0.6} strokeJoin="round" strokeCap="round" color={`rgba(${GLOBE_COLORS.borderRgb},0.34)`} opacity={detail.regionOpacity} />
        <Path path={detail.country} style="stroke" strokeWidth={0.85} strokeJoin="round" strokeCap="round" color={`rgba(${GLOBE_COLORS.borderRgb},0.6)`} opacity={detail.countryOpacity} />
      </Group>
      <Circle cx={c} cy={c} r={radius}>
        <RadialGradient c={limbC} r={limbR} colors={[GLOBE_COLORS.limbClear, GLOBE_COLORS.limbClear, GLOBE_COLORS.limbShadow]} positions={[0, 0.5, 1]} />
      </Circle>
      <Circle cx={c} cy={c} r={radius} style="stroke" strokeWidth={1} color={GLOBE_COLORS.rim} />
      <Picture picture={detail.labels} />
      {activities.map((activity, index) => (
        <ActivityDot
          key={activity.id}
          skia={skia}
          activity={activity}
          index={index}
          view={view}
          clock={clock}
          size={size}
          selected={activity.id === selectedId}
          flare={activity.kind === 'order' && activity.key === highlightKey}
          reduceMotion={reduceMotion}
        />
      )).reverse()}
      {!reduceMotion && SLOT_INDEXES.map((slot) => (
        <Arc key={slot} skia={skia} slot={slot} arcs={arcs} view={view} clock={clock} size={size} />
      ))}
    </Canvas>
  );
}
