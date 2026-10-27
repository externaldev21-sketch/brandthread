/**
 * Order globe renderer for web: a plain 2D <canvas> redrawn every animation
 * frame from the same shared view the gestures and auto-rotation drive
 * (lib/liveMap/globe.ts does the projection, so drawing and tap hit-testing
 * agree). ~2,200 land dots + up to 60 order dots is a few thousand fillRects
 * per frame, comfortably 60fps on phone browsers; no WebGL/WASM to load.
 */
import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import {
  globeRadius,
  landAlpha,
  LAND_DOT_COUNT,
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
  orders: LiveMapRecentOrder[];
  selectedId: string | null;
  /** Orders in this city just landed (socket ping): their dots flare. */
  highlightKey: string | null;
  reduceMotion: boolean;
}

export function GlobeSurface({ size, view, clock, orders, selectedId, highlightKey, reduceMotion }: GlobeSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef({ orders, selectedId, highlightKey, reduceMotion });
  propsRef.current = { orders, selectedId, highlightKey, reduceMotion };

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
      const { orders: list, selectedId: selected, highlightKey: hot, reduceMotion: still } = propsRef.current;
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
      ctx.strokeStyle = GLOBE_COLORS.rim;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Land: silver dot matrix, dimmer toward the limb.
      const dot = Math.max(1.1, 1.35 * v.zoom * (size / 340));
      for (let i = 0; i < LAND_DOT_COUNT; i += 1) {
        const [x, y, z] = projectUnit(LAND_UNIT[i * 3], LAND_UNIT[i * 3 + 1], LAND_UNIT[i * 3 + 2], v, size);
        if (z <= 0) continue;
        ctx.fillStyle = `rgba(${GLOBE_COLORS.landRgb},${landAlpha(z).toFixed(3)})`;
        ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
      }

      // Orders: glowing silver dots, oldest first so the newest sits on top.
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const order = list[i];
        const [x, y, z] = projectLatLng(order.lat, order.lng, v, size);
        if (z <= 0) continue;
        const fade = Math.min(1, z * 4);
        const isSelected = order.id === selected;
        const flare = hot != null && order.key === hot && i === list.findIndex((o) => o.key === hot);
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
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [size, view, clock]);

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
