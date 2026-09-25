/**
 * SvgDrawingCanvas.tsx — react-native-svg fallback freehand drawing surface,
 * used whenever @shopify/react-native-skia is unavailable (Expo Go, web, or
 * any environment without the native module linked). Shares the exact same
 * brush geometry (lib/brushEngine.ts) as SkiaDrawingCanvas so strokes look
 * (almost) identical between the two renderers — just without GPU
 * compositing and without true per-segment variable stroke width, since
 * react-native-svg <Path> only supports a single strokeWidth per element.
 */

import React, { useRef, useState } from 'react';
import { View, PanResponder, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import {
  BRUSH_LIBRARY, BrushKind, StrokeInputPoint, buildStrokeStyle, averageStrokeWidth,
  strokeStyleToSvgPath,
} from '@/lib/brushEngine';
import { DEFAULT_PRESSURE_CURVE, PressurePoint } from '@/lib/preferencesModel';
import type { DrawPath } from '@/services/designTypes';

export interface SvgDrawingCanvasProps {
  width: number;
  height: number;
  paths: DrawPath[];
  brushKind: BrushKind;
  color: string;
  size: number;
  opacity: number;
  pressureCurve?: PressurePoint[];
  streamline?: number;
  tool: 'brush' | 'eraser' | 'smudge';
  onStrokeEnd: (path: DrawPath) => void;
  disabled?: boolean;
}

export default function SvgDrawingCanvas({
  width, height, paths, brushKind, color, size, opacity,
  pressureCurve = DEFAULT_PRESSURE_CURVE, streamline = 0.3, tool, onStrokeEnd, disabled,
}: SvgDrawingCanvasProps) {
  const rawPointsRef = useRef<StrokeInputPoint[]>([]);
  const [liveD, setLiveD] = useState('');
  const [liveWidth, setLiveWidth] = useState(size);
  const brush = BRUSH_LIBRARY[brushKind];

  function recomputeLive() {
    const style = buildStrokeStyle(rawPointsRef.current, brush, size, opacity, pressureCurve, streamline);
    setLiveD(strokeStyleToSvgPath(style));
    setLiveWidth(averageStrokeWidth(style) || size);
  }

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onPanResponderGrant: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        rawPointsRef.current = [{ x: locationX, y: locationY, t: Date.now() }];
        recomputeLive();
      },
      onPanResponderMove: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        rawPointsRef.current = [...rawPointsRef.current, { x: locationX, y: locationY, t: Date.now() }];
        recomputeLive();
      },
      onPanResponderRelease: () => {
        const raw = rawPointsRef.current;
        if (raw.length > 0) {
          const style = buildStrokeStyle(raw, brush, size, opacity, pressureCurve, streamline);
          onStrokeEnd({
            d: strokeStyleToSvgPath(style),
            color: tool === 'eraser' ? 'erase' : tool === 'smudge' ? 'smudge' : color,
            width: averageStrokeWidth(style),
            opacity: tool === 'eraser' ? 1 : opacity,
            tool,
          });
        }
        rawPointsRef.current = [];
        setLiveD('');
      },
    }),
  ).current;

  return (
    <View style={StyleSheet.absoluteFill} {...responder.panHandlers} testID="svg-drawing-canvas">
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        {paths.map((p, i) => (
          <Path
            key={i}
            d={p.d}
            stroke={p.color === 'erase' ? '#000000' : p.color === 'smudge' ? '#808080' : p.color}
            strokeWidth={p.width}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={p.color === 'erase' ? 0 : p.opacity}
          />
        ))}
        {liveD.length > 0 && (
          <Path
            d={liveD}
            stroke={tool === 'eraser' ? '#000000' : color}
            strokeWidth={liveWidth}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={tool === 'eraser' ? 0.3 : opacity}
          />
        )}
      </Svg>
    </View>
  );
}
