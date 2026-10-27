/**
 * Order globe renderer for web: a plain 2D <canvas> redrawn every animation
 * frame from the same shared view the gestures and auto-rotation drive
 * (lib/liveMap/globe.ts does the projection, so drawing and tap hit-testing
 * agree). Per frame: one clipped land path (~3,500 vertices) filled with a
 * silver gradient, a limb shadow, up to 60 activity dots and ARC_SLOTS arcs,
 * comfortably 60fps on phone browsers; no WebGL/WASM to load.
 */
import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { globeRadius, LAND_RING_STARTS, LAND_RINGS, landPath, projectLatLng, pulsePhase, type GlobeView } from '@/lib/liveMap/globe';
import { arcFrame, type ArcSlot } from '@/lib/liveMap/arcs';
import type { GlobeActivity } from '@/lib/liveMap/liveMap';
import { GLOBE_COLORS } from './globeColors';

export type GlobeSurfaceMode = 'globe' | 'flat';

export function globeSurfaceMode(): GlobeSurfaceMode {
  if (typeof document === 'undefined') return 'flat';
  try {
    return document.createElement('canvas').getContext('2d') ? 'globe' : 'flat';
  } catch {
    return 'flat';
  }
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

export function GlobeSurface({ size, view, clock, arcs, activities, selectedId, highlightKey, reduceMotion }: GlobeSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef({ activities, selectedId, highlightKey, reduceMotion });
  propsRef.current = { activities, selectedId, highlightKey, reduceMotion };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || size <= 0) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    let frame = 0;

    const draw = () => {
      const v = view.value;
      const now = clock.value;
      const { activities: list, selectedId: selected, highlightKey: hot, reduceMotion: still } = propsRef.current;
      const r = globeRadius(size, v.zoom);
      const c = size / 2;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      // Atmosphere: a faint silver halo just outside the limb.
      const halo = ctx.createRadialGradient(c, c, r * 0.96, c, c, r * 1.14);
      halo.addColorStop(0, GLOBE_COLORS.haloInner);
      halo.addColorStop(1, GLOBE_COLORS.clear);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(c, c, r * 1.14, 0, Math.PI * 2);
      ctx.fill();

      // The sphere: near-black, lit from the upper left.
      const body = ctx.createRadialGradient(c - r * 0.35, c - r * 0.4, r * 0.1, c, c, r);
      body.addColorStop(0, GLOBE_COLORS.sphereLight);
      body.addColorStop(1, GLOBE_COLORS.sphereDark);
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.fill();

      // Land: solid silver continents, lit from the same side as the sphere.
      const land = new Path2D(landPath(LAND_RINGS, LAND_RING_STARTS, v, size));
      const lit = ctx.createRadialGradient(c - r * 0.38, c - r * 0.42, r * 0.05, c, c, r * 1.02);
      lit.addColorStop(0, GLOBE_COLORS.landLit);
      lit.addColorStop(0.55, GLOBE_COLORS.landMid);
      lit.addColorStop(1, GLOBE_COLORS.landShade);
      ctx.fillStyle = lit;
      ctx.fill(land, 'evenodd');
      ctx.strokeStyle = GLOBE_COLORS.coast;
      ctx.lineWidth = 0.6;
      ctx.stroke(land);

      // Limb shadow over land and sea, so the ball reads round.
      const limb = ctx.createRadialGradient(c - r * 0.2, c - r * 0.22, r * 0.55, c, c, r);
      limb.addColorStop(0, GLOBE_COLORS.limbClear);
      limb.addColorStop(1, GLOBE_COLORS.limbShadow);
      ctx.fillStyle = limb;
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = GLOBE_COLORS.rim;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Activity: sessions first (dimmer), then orders, oldest order last-drawn-first.
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const a = list[i];
        const [x, y, z] = projectLatLng(a.lat, a.lng, v, size);
        if (z <= 0) continue;
        const fade = Math.min(1, z * 4);
        const isSelected = a.id === selected;
        if (a.kind === 'session') {
          const breathe = still ? 0.7 : 0.55 + 0.45 * Math.sin((now / 1600 + i * 0.7) * Math.PI);
          const glowR = isSelected ? 12 : 9;
          const glow = ctx.createRadialGradient(x, y, 0, x, y, glowR);
          glow.addColorStop(0, `rgba(${GLOBE_COLORS.sessionRgb},${(0.6 * fade * breathe).toFixed(3)})`);
          glow.addColorStop(1, `rgba(${GLOBE_COLORS.sessionRgb},0)`);
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(x, y, glowR, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = `rgba(${GLOBE_COLORS.glowRgb},${(0.9 * fade).toFixed(3)})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(x, y, isSelected ? 4 : 3, 0, Math.PI * 2);
          ctx.stroke();
          if (isSelected) {
            ctx.beginPath();
            ctx.arc(x, y, 8, 0, Math.PI * 2);
            ctx.stroke();
          }
          continue;
        }
        const flare = hot != null && a.key === hot;
        const glowR = isSelected || flare ? 15 : 11;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, glowR);
        glow.addColorStop(0, `rgba(${GLOBE_COLORS.glowRgb},${(0.85 * fade).toFixed(3)})`);
        glow.addColorStop(0.35, `rgba(${GLOBE_COLORS.glowRgb},${(0.32 * fade).toFixed(3)})`);
        glow.addColorStop(1, `rgba(${GLOBE_COLORS.glowRgb},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, glowR, 0, Math.PI * 2);
        ctx.fill();
        if (!still) {
          const t = pulsePhase(now, i);
          ctx.strokeStyle = `rgba(${GLOBE_COLORS.glowRgb},${((1 - t) * 0.7 * fade).toFixed(3)})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(x, y, 3 + t * 13, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = GLOBE_COLORS.core;
        ctx.globalAlpha = fade;
        ctx.beginPath();
        ctx.arc(x, y, isSelected ? 4 : 2.8, 0, Math.PI * 2);
        ctx.fill();
        if (isSelected) {
          ctx.strokeStyle = GLOBE_COLORS.core;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, 8, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // Arcs: a glow pass and a thin core, the trail dimmer than the head.
      if (!still) {
        ctx.lineCap = 'round';
        for (const slot of arcs.value) {
          const f = arcFrame(slot, now, v, size);
          if (f.alpha <= 0) continue;
          {
            const tail = new Path2D(f.tail);
            const head = new Path2D(f.head);
            ctx.strokeStyle = `rgba(${GLOBE_COLORS.arcRgb},${(0.22 * f.alpha).toFixed(3)})`;
            ctx.lineWidth = 5;
            ctx.stroke(head);
            ctx.strokeStyle = `rgba(${GLOBE_COLORS.arcRgb},${(0.4 * f.alpha).toFixed(3)})`;
            ctx.lineWidth = 1.2;
            ctx.stroke(tail);
            ctx.strokeStyle = `rgba(${GLOBE_COLORS.arcRgb},${(0.95 * f.alpha).toFixed(3)})`;
            ctx.lineWidth = 1.6;
            ctx.stroke(head);
          }
          if (f.headVisible) {
            const g = ctx.createRadialGradient(f.hx, f.hy, 0, f.hx, f.hy, 7);
            g.addColorStop(0, `rgba(${GLOBE_COLORS.arcRgb},${(0.9 * f.alpha).toFixed(3)})`);
            g.addColorStop(1, `rgba(${GLOBE_COLORS.arcRgb},0)`);
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(f.hx, f.hy, 7, 0, Math.PI * 2);
            ctx.fill();
          }
          if (f.landingVisible) {
            ctx.strokeStyle = `rgba(${GLOBE_COLORS.arcRgb},${((1 - f.landing) * 0.8).toFixed(3)})`;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(f.lx, f.ly, 2 + f.landing * 10, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [size, view, clock, arcs]);

  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      {React.createElement('canvas', {
        ref: canvasRef,
        'data-testid': 'seller-globe-canvas',
        style: { width: size, height: size, display: 'block' },
      })}
    </View>
  );
}
