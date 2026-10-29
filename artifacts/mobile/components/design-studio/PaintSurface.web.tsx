/**
 * PaintSurface.web.tsx — the canvas's touch/pencil/mouse input on web.
 *
 * A transparent layer over the whole stage that forwards raw Pointer Events
 * to the shared CanvasGestureModel (lib/paint/canvasGestureModel.ts), which
 * turns them into strokes, undo/redo taps, pinch-zoom-rotate and
 * touch-and-hold eyedropper. Uses `getCoalescedEvents()` so fast strokes
 * keep every sample the hardware reported (smooth curves, not polylines),
 * and real `pressure` for pens (mouse/finger report none → simulated).
 */

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import type { CanvasGestureModel } from '@/lib/paint/canvasGestureModel';

export interface PaintSurfaceProps {
  model: CanvasGestureModel;
  enabled: boolean;
  testID?: string;
}

export default function PaintSurface({ model, enabled, testID }: PaintSurfaceProps) {
  const ref = useRef<View>(null);
  const modelRef = useRef(model);
  modelRef.current = model;

  useEffect(() => {
    const el = ref.current as unknown as HTMLElement | null;
    if (!el || !enabled) return;
    el.style.touchAction = 'none';
    (el.style as unknown as Record<string, string>).webkitUserSelect = 'none';
    el.style.userSelect = 'none';
    let raf = 0;
    const active = new Set<number>();

    const loop = () => {
      raf = 0;
      if (active.size === 0) return;
      modelRef.current.tick(performance.now());
      raf = requestAnimationFrame(loop);
    };
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    // Mice and fingers report 0 / 0.5 "pressure" that means nothing; only pens are real.
    const pressureOf = (e: PointerEvent) => (e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : -1);

    const onDown = (e: PointerEvent) => {
      if (e.button > 0) return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
      active.add(e.pointerId);
      const p = local(e);
      modelRef.current.down(e.pointerId, p.x, p.y, pressureOf(e), e.timeStamp || performance.now());
      if (!raf) raf = requestAnimationFrame(loop);
    };
    const onMove = (e: PointerEvent) => {
      if (!active.has(e.pointerId)) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const coalesced = list.map(c => ({ x: c.clientX - r.left, y: c.clientY - r.top, p: pressureOf(c), t: c.timeStamp || e.timeStamp }));
      const p = local(e);
      modelRef.current.move(e.pointerId, p.x, p.y, pressureOf(e), e.timeStamp || performance.now(), coalesced);
    };
    const onUp = (e: PointerEvent) => {
      if (!active.has(e.pointerId)) return;
      active.delete(e.pointerId);
      modelRef.current.up(e.pointerId, e.timeStamp || performance.now());
    };
    const onCancel = (e: PointerEvent) => {
      if (!active.has(e.pointerId)) return;
      active.delete(e.pointerId);
      if (active.size === 0) modelRef.current.cancel();
      else modelRef.current.up(e.pointerId, e.timeStamp || performance.now());
    };
    const noMenu = (e: Event) => e.preventDefault();

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('contextmenu', noMenu);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      // Disabled (or unmounted) mid-gesture: the pointerup will never reach
      // us, so end the gesture now instead of leaving a stroke/pinch open.
      if (active.size > 0) { active.clear(); modelRef.current.cancel(); }
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('contextmenu', noMenu);
    };
  }, [enabled]);

  return <View ref={ref} style={StyleSheet.absoluteFill} testID={testID} pointerEvents={enabled ? 'auto' : 'none'} />;
}
