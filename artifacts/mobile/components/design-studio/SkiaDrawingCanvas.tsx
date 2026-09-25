/**
 * SkiaDrawingCanvas.tsx — GPU-accelerated freehand drawing surface built on
 * @shopify/react-native-skia.
 *
 * IMPORTANT: this file performs a STATIC import of '@shopify/react-native-skia'.
 * That import is only safe because this module is never required at the top
 * of an eagerly-evaluated screen — CanvasHost.tsx checks
 * `isSkiaAvailable()` (lib/skiaAvailability.ts) FIRST and only then does a
 * guarded `require('./SkiaDrawingCanvas')` to pull this file in. Do not
 * import this module from anywhere that isn't behind that same guard, or it
 * will crash Expo Go / web (no native Skia binding there).
 *
 * Renders committed strokes as Skia Path objects (GPU-composited) and the
 * in-progress stroke as a live-updating Path driven by a gesture-handler
 * touch stream, using lib/brushEngine.ts for smoothing + pressure/velocity
 * width so the stroke geometry logic is shared with the SVG fallback path.
 */

import React, { useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import {
  Canvas, Path, Skia, Group,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import {
  BRUSH_LIBRARY, BrushKind, StrokeInputPoint, buildStrokeStyle, averageStrokeWidth,
  catmullRomResample,
} from '@/lib/brushEngine';
import { DEFAULT_PRESSURE_CURVE, PressurePoint } from '@/lib/preferencesModel';
import type { DrawPath } from '@/services/designTypes';

export interface SkiaDrawingCanvasProps {
  width: number;
  height: number;
  paths: DrawPath[]; // already-committed strokes for the active layer
  brushKind: BrushKind;
  color: string;
  size: number;
  opacity: number;
  pressureCurve?: PressurePoint[];
  streamline?: number;
  tool: 'brush' | 'eraser' | 'smudge';
  onStrokeEnd: (path: DrawPath) => void;
  disabled?: boolean;
  /** Live pointer position (canvas-local px), for an external brush-cursor overlay. Null when not touching. */
  onLivePoint?: (pt: { x: number; y: number } | null) => void;
}

function pointsToSkiaPath(points: { x: number; y: number }[]) {
  const skPath = Skia.Path.Make();
  if (points.length === 0) return skPath;
  const resampled = catmullRomResample(points.map(p => ({ ...p, t: 0 })));
  skPath.moveTo(resampled[0].x, resampled[0].y);
  for (let i = 1; i < resampled.length; i++) {
    skPath.lineTo(resampled[i].x, resampled[i].y);
  }
  return skPath;
}

export default function SkiaDrawingCanvas({
  width, height, paths, brushKind, color, size, opacity,
  pressureCurve = DEFAULT_PRESSURE_CURVE, streamline = 0.3, tool, onStrokeEnd, disabled, onLivePoint,
}: SkiaDrawingCanvasProps) {
  const rawPointsRef = useRef<StrokeInputPoint[]>([]);
  const [livePoints, setLivePoints] = useState<{ x: number; y: number }[]>([]);
  const [liveWidth, setLiveWidth] = useState(size);

  const brush = BRUSH_LIBRARY[brushKind];

  function commitStroke() {
    const raw = rawPointsRef.current;
    if (raw.length < 1) return;
    const style = buildStrokeStyle(raw, brush, size, opacity, pressureCurve, streamline);
    const resampled = catmullRomResample(style.map(p => ({ x: p.x, y: p.y, t: 0 })));
    const d = ['M' + resampled[0].x.toFixed(2) + ',' + resampled[0].y.toFixed(2)]
      .concat(resampled.slice(1).map(p => `L${p.x.toFixed(2)},${p.y.toFixed(2)}`))
      .join(' ');
    onStrokeEnd({
      d,
      color: tool === 'eraser' ? 'erase' : tool === 'smudge' ? 'smudge' : color,
      width: averageStrokeWidth(style),
      opacity: tool === 'eraser' ? 1 : opacity,
      tool: tool,
    });
    rawPointsRef.current = [];
    setLivePoints([]);
    onLivePoint?.(null);
  }

  const pan = useMemo(() => Gesture.Pan()
    .enabled(!disabled)
    .minPointers(1)
    .maxPointers(1)
    .onStart((e) => {
      const pt: StrokeInputPoint = { x: e.x, y: e.y, t: Date.now(), force: (e as any).force };
      runOnJS((p: StrokeInputPoint) => {
        rawPointsRef.current = [p];
        setLivePoints([{ x: p.x, y: p.y }]);
        onLivePoint?.({ x: p.x, y: p.y });
      })(pt);
    })
    .onUpdate((e) => {
      const pt: StrokeInputPoint = { x: e.x, y: e.y, t: Date.now(), force: (e as any).force };
      runOnJS((p: StrokeInputPoint) => {
        rawPointsRef.current = [...rawPointsRef.current, p];
        setLivePoints(prev => [...prev, { x: p.x, y: p.y }]);
        onLivePoint?.({ x: p.x, y: p.y });
      })(pt);
    })
    .onEnd(() => {
      runOnJS(commitStroke)();
    }), [disabled, brushKind, color, size, opacity, streamline]);

  const liveSkPath = useMemo(() => pointsToSkiaPath(livePoints), [livePoints]);

  return (
    <GestureDetector gesture={pan}>
      <Canvas style={[StyleSheet.absoluteFill, { width, height }]} testID="skia-drawing-canvas">
        <Group>
          {paths.map((p, i) => {
            const isErase = p.color === 'erase';
            const skPath = Skia.Path.MakeFromSVGString(p.d);
            if (!skPath) return null;
            return (
              <Path
                key={i}
                path={skPath}
                color={isErase ? '#000000' : p.color === 'smudge' ? '#808080' : p.color}
                style="stroke"
                strokeWidth={p.width}
                strokeCap="round"
                strokeJoin="round"
                opacity={isErase ? 0 : p.opacity}
                blendMode={isErase ? 'clear' : 'srcOver'}
              />
            );
          })}
          {livePoints.length > 0 && (
            <Path
              path={liveSkPath}
              color={tool === 'eraser' ? '#000000' : color}
              style="stroke"
              strokeWidth={size}
              strokeCap="round"
              strokeJoin="round"
              opacity={tool === 'eraser' ? 0.3 : opacity}
            />
          )}
        </Group>
      </Canvas>
    </GestureDetector>
  );
}
