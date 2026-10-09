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
import { PanResponder, Platform, View } from 'react-native';
import Svg, { Defs, Image as SvgImage, Mask, Path, Rect } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { BG, FG } from '@/lib/theme';

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

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new window.Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('decode failed'));
    i.src = src;
  });
}

function tracePath(ctx: CanvasRenderingContext2D, d: string, k: number) {
  ctx.beginPath();
  for (const seg of d.split(' ')) {
    const [x, y] = seg.slice(1).split(',').map(Number);
    if (seg[0] === 'M') ctx.moveTo(x * k, y * k); else ctx.lineTo(x * k, y * k);
  }
}

/**
 * Web export. react-native-view-shot's web path paints an opaque white
 * background, so the PNG is composited on a canvas instead, mirroring the
 * on-screen masks: original where restore painted, under the cutout minus the
 * erase strokes.
 */
async function exportOnWeb(originalUri: string, cutoutUri: string, strokes: RefineStroke[], frameW: number, brush: number) {
  const [orig, cut] = await Promise.all([loadImg(originalUri), loadImg(cutoutUri)]);
  const W = cut.naturalWidth, H = cut.naturalHeight;
  const k = W / frameW;
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const out = mk(); const octx = out.getContext('2d')!;

  const restore = mk(); const rctx = restore.getContext('2d')!;
  rctx.drawImage(orig, 0, 0, W, H);
  const rmask = mk(); const rm = rmask.getContext('2d')!;
  rm.lineWidth = brush * k; rm.lineCap = 'round'; rm.lineJoin = 'round'; rm.strokeStyle = FG;
  for (const st of strokes.filter(x => x.tool === 'restore')) { tracePath(rm, st.d, k); rm.stroke(); }
  rctx.globalCompositeOperation = 'destination-in';
  rctx.drawImage(rmask, 0, 0);
  octx.drawImage(restore, 0, 0);

  const cutLayer = mk(); const cctx = cutLayer.getContext('2d')!;
  cctx.drawImage(cut, 0, 0, W, H);
  cctx.globalCompositeOperation = 'destination-out';
  cctx.lineWidth = brush * k; cctx.lineCap = 'round'; cctx.lineJoin = 'round'; cctx.strokeStyle = BG;
  for (const st of strokes.filter(x => x.tool === 'erase')) { tracePath(cctx, st.d, k); cctx.stroke(); }
  octx.drawImage(cutLayer, 0, 0);
  return out.toDataURL('image/png');
}

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
      if (Platform.OS === 'web') return exportOnWeb(originalUri, cutoutUri, strokes, width, brush);
      // Loaded on demand: keeps view-shot (html2canvas on web) out of the startup bundle.
      const { captureRef } = await import('react-native-view-shot');
      const uri = await captureRef(shotRef, { format: 'png', quality: 1, result: 'data-uri' });
      return uri.startsWith('data:') ? uri : `data:image/png;base64,${uri}`;
    },
  }), [originalUri, cutoutUri, strokes, width, brush]);

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
              <Rect x={0} y={0} width={width} height={height} fill={BG} />
              {restore.map((s, i) => <Path key={i} d={s.d} stroke={FG} {...strokeProps} />)}
              {live && tool === 'restore' ? <Path d={live} stroke={FG} {...strokeProps} /> : null}
            </Mask>
          </Defs>
          <SvgImage href={originalUri} x={0} y={0} width={width} height={height} preserveAspectRatio="xMidYMid slice" mask="url(#bgRestoreMask)" />
        </Svg>
        {/* Cutout layer: fully visible except where the erase brush painted */}
        <Svg width={width} height={height} style={{ position: 'absolute' }} pointerEvents="none">
          <Defs>
            <Mask id="bgEraseMask">
              <Rect x={0} y={0} width={width} height={height} fill={FG} />
              {erase.map((s, i) => <Path key={i} d={s.d} stroke={BG} {...strokeProps} />)}
              {live && tool === 'erase' ? <Path d={live} stroke={BG} {...strokeProps} /> : null}
            </Mask>
          </Defs>
          <SvgImage href={cutoutUri} x={0} y={0} width={width} height={height} preserveAspectRatio="xMidYMid slice" mask="url(#bgEraseMask)" />
        </Svg>
      </View>
    </View>
  );
});

export default BgRefineCanvas;
