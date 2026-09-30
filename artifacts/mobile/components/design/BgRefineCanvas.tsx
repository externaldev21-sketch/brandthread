/**
 * BgRefineCanvas — Remove Background: erase / restore brush over the cutout.
 *
 * Controlled by the screen (tool, strokes and undo/redo live there so the
 * stage-corner icons and the bottom toolbar share one history). Both brushes
 * are accumulated SVG stroke paths rendered through an SVG <Mask>, so nothing
 * mutates pixels until exportPng() flattens the composition into a real
 * transparent PNG via react-native-view-shot.
 *
 * The backdrop (checkerboard / colour / blur) is drawn by the caller behind
 * this component and is deliberately NOT part of the exported PNG.
 */
import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Defs, Image as SvgImage, Mask, Path, Rect } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import * as Haptics from 'expo-haptics';

export type RefineTool = 'erase' | 'restore';
export interface RefineStroke { tool: RefineTool; d: string }

export interface BgRefineHandle {
  /** Flattens the cutout + edits into a transparent PNG data URI. */
  exportPng: () => Promise<string>;
}

interface Props {
  originalUri: string;
  cutoutUri: string;
  width: number;
  height: number;
  tool: RefineTool;
  strokes: RefineStroke[];
  onCommitStroke: (stroke: RefineStroke) => void;
}

const BRUSH_RATIO = 0.085;

const BgRefineCanvas = forwardRef<BgRefineHandle, Props>(function BgRefineCanvas(
  { originalUri, cutoutUri, width, height, tool, strokes, onCommitStroke }, ref,
) {
  const brush = Math.round(Math.min(width, height) * BRUSH_RATIO);
  const shotRef = useRef<View>(null);
  const pointsRef = useRef<string[]>([]);
  const [live, setLive] = useState<string | null>(null);
  const toolRef = useRef(tool);
  toolRef.current = tool;

  useImperativeHandle(ref, () => ({
    exportPng: async () => {
      const uri = await captureRef(shotRef, { format: 'png', quality: 1, result: 'data-uri' });
      return uri.startsWith('data:') ? uri : `data:image/png;base64,${uri}`;
    },
  }), []);

  const commit = useCallback((d: string) => {
    onCommitStroke({ tool: toolRef.current, d });
    Haptics.selectionAsync().catch(() => {});
  }, [onCommitStroke]);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt) => {
      const { locationX, locationY } = evt.nativeEvent;
      pointsRef.current = [`M${locationX.toFixed(1)},${locationY.toFixed(1)}`];
      setLive(pointsRef.current.join(' '));
    },
    onPanResponderMove: (evt) => {
      const { locationX, locationY } = evt.nativeEvent;
      pointsRef.current.push(`L${locationX.toFixed(1)},${locationY.toFixed(1)}`);
      setLive(pointsRef.current.join(' '));
    },
    onPanResponderRelease: () => {
      const pts = pointsRef.current;
      pointsRef.current = [];
      setLive(null);
      // A tap (no movement) is a dot: duplicate the point so the round cap paints.
      if (pts.length === 1) pts.push(pts[0].replace('M', 'L'));
      commit(pts.join(' '));
    },
  }), [commit]);

  const erase = strokes.filter(s => s.tool === 'erase');
  const restore = strokes.filter(s => s.tool === 'restore');
  const strokeProps = { strokeWidth: brush, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };

  return (
    <View style={{ width, height }} {...responder.panHandlers}>
      <View ref={shotRef} collapsable={false} style={{ width, height }} pointerEvents="none">
        {/* Restore layer: original shows only where the restore brush painted */}
        <Svg width={width} height={height} style={{ position: 'absolute' }} pointerEvents="none">
          <Defs>
            <Mask id="bgRestoreMask">
              <Rect x={0} y={0} width={width} height={height} fill="black" />
              {restore.map((s, i) => <Path key={i} d={s.d} stroke="white" {...strokeProps} />)}
              {live && tool === 'restore' ? <Path d={live} stroke="white" {...strokeProps} /> : null}
            </Mask>
          </Defs>
          <SvgImage href={originalUri} x={0} y={0} width={width} height={height} preserveAspectRatio="xMidYMid slice" mask="url(#bgRestoreMask)" />
        </Svg>
        {/* Cutout layer: fully visible except where the erase brush painted */}
        <Svg width={width} height={height} style={{ position: 'absolute' }} pointerEvents="none">
          <Defs>
            <Mask id="bgEraseMask">
              <Rect x={0} y={0} width={width} height={height} fill="white" />
              {erase.map((s, i) => <Path key={i} d={s.d} stroke="black" {...strokeProps} />)}
              {live && tool === 'erase' ? <Path d={live} stroke="black" {...strokeProps} /> : null}
            </Mask>
          </Defs>
          <SvgImage href={cutoutUri} x={0} y={0} width={width} height={height} preserveAspectRatio="xMidYMid slice" mask="url(#bgEraseMask)" />
        </Svg>
      </View>
    </View>
  );
});

export default BgRefineCanvas;
