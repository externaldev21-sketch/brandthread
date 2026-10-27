/**
 * PaintSurface.tsx (native) — canvas input on iOS/Android.
 *
 * react-native-gesture-handler's manual gesture reports every touch (id,
 * position) for multi-finger tracking; touches are forwarded to the shared
 * CanvasGestureModel, which decides stroke vs undo/redo tap vs pinch vs
 * touch-and-hold eyedropper (lib/paint/canvasGestureModel.ts). The web
 * build uses PaintSurface.web.tsx (Pointer Events) instead.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import type { CanvasGestureModel } from '@/lib/paint/canvasGestureModel';

export interface PaintSurfaceProps {
  model: CanvasGestureModel;
  enabled: boolean;
  testID?: string;
}

type T = { id: number; x: number; y: number };

export default function PaintSurface({ model, enabled, testID }: PaintSurfaceProps) {
  const modelRef = useRef(model);
  modelRef.current = model;
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (tickRef.current) clearInterval(tickRef.current); }, []);

  const handlers = useMemo(() => {
    const now = () => Date.now();
    return {
      down: (ts: T[]) => {
        for (const t of ts) modelRef.current.down(t.id, t.x, t.y, -1, now());
        if (!tickRef.current) tickRef.current = setInterval(() => modelRef.current.tick(Date.now()), 50);
      },
      move: (ts: T[]) => { for (const t of ts) modelRef.current.move(t.id, t.x, t.y, -1, now()); },
      up: (ts: T[], remaining: number) => {
        for (const t of ts) modelRef.current.up(t.id, now());
        if (remaining === 0 && tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      },
      cancel: () => {
        modelRef.current.cancel();
        if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      },
    };
  }, []);

  const gesture = useMemo(() => Gesture.Manual()
    .enabled(enabled)
    .onTouchesDown((e, manager) => {
      manager.activate();
      runOnJS(handlers.down)(e.changedTouches.map(t => ({ id: t.id, x: t.x, y: t.y })));
    })
    .onTouchesMove((e) => {
      runOnJS(handlers.move)(e.changedTouches.map(t => ({ id: t.id, x: t.x, y: t.y })));
    })
    .onTouchesUp((e, manager) => {
      runOnJS(handlers.up)(e.changedTouches.map(t => ({ id: t.id, x: t.x, y: t.y })), e.numberOfTouches);
      if (e.numberOfTouches === 0) manager.end();
    })
    .onTouchesCancelled((_e, manager) => {
      runOnJS(handlers.cancel)();
      manager.fail();
    }), [enabled, handlers]);

  return (
    <GestureDetector gesture={gesture}>
      <View style={StyleSheet.absoluteFill} testID={testID} collapsable={false} />
    </GestureDetector>
  );
}
