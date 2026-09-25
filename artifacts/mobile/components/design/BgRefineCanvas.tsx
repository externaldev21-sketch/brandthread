/**
 * BgRefineCanvas — Remove Background: slide-to-reveal compare + erase/restore brush.
 *
 * Compare mode: a draggable divider reveals the original photo on one side and
 * the transparent cutout (over checkerboard) on the other, like Unfold's
 * background-removal reveal.
 *
 * Refine mode: Telegram-style Erase / Restore brushes let the seller correct
 * the AI cutout by hand. Both brushes are implemented as accumulated SVG
 * stroke paths rendered through an SVG <Mask>, so nothing here mutates pixels
 * until "Done" flattens the current composition into a real PNG via
 * react-native-view-shot — that flattened URI is what Save/Download/product
 * actions use afterward.
 */
import React, { useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, PanResponder, Image as RNImage,
} from 'react-native';
import Svg, { Image as SvgImage, Mask, Rect, Path, Defs } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import Checkerboard from './Checkerboard';

type Tool = 'erase' | 'restore';
type Mode = 'compare' | 'refine';

interface Stroke {
  tool: Tool;
  d: string;
}

interface Props {
  originalUri: string;
  cutoutUri: string;
  size: number; // square frame side, in dp
  checkerboardStyle: object;
  accent: string;
  mutedColor: string;
  fgColor: string;
  cardColor: string;
  borderColor: string;
  onExport: (dataUri: string) => void;
}

const BRUSH_WIDTH = 34;

export default function BgRefineCanvas({
  originalUri, cutoutUri, size, checkerboardStyle, accent, mutedColor, fgColor, cardColor, borderColor, onExport,
}: Props) {
  const [mode, setMode] = useState<Mode>('compare');
  const [slideX, setSlideX] = useState(size / 2);
  const slideStartRef = useRef(size / 2);

  const [tool, setTool] = useState<Tool>('erase');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [liveStroke, setLiveStroke] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const shotRef = useRef<View>(null);

  // ── Compare: slide-to-reveal ──────────────────────────────────────────────
  const compareResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { slideStartRef.current = slideX; },
    onPanResponderMove: (_evt, gesture) => {
      const next = Math.max(0, Math.min(size, slideStartRef.current + gesture.dx));
      setSlideX(next);
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [size]);

  // ── Refine: erase / restore brush ─────────────────────────────────────────
  const currentPointsRef = useRef<string[]>([]);

  const brushResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt) => {
      const { locationX, locationY } = evt.nativeEvent;
      currentPointsRef.current = [`M${locationX.toFixed(1)},${locationY.toFixed(1)}`];
      setLiveStroke(currentPointsRef.current.join(' '));
    },
    onPanResponderMove: (evt) => {
      const { locationX, locationY } = evt.nativeEvent;
      currentPointsRef.current.push(`L${locationX.toFixed(1)},${locationY.toFixed(1)}`);
      setLiveStroke(currentPointsRef.current.join(' '));
    },
    onPanResponderRelease: () => {
      const d = currentPointsRef.current.join(' ');
      currentPointsRef.current = [];
      setLiveStroke(null);
      if (d.includes('L')) {
        setStrokes(prev => [...prev, { tool, d }]);
        Haptics.selectionAsync().catch(() => {});
      }
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [tool]);

  const eraseStrokes = strokes.filter(s => s.tool === 'erase');
  const restoreStrokes = strokes.filter(s => s.tool === 'restore');
  const liveEraseD = tool === 'erase' ? liveStroke : null;
  const liveRestoreD = tool === 'restore' ? liveStroke : null;

  const handleUndo = useCallback(() => {
    setStrokes(prev => prev.slice(0, -1));
  }, []);

  const handleReset = useCallback(() => {
    setStrokes([]);
  }, []);

  const handleDone = useCallback(async () => {
    if (!shotRef.current) return;
    setExporting(true);
    try {
      const uri = await captureRef(shotRef, { format: 'png', quality: 1, result: 'data-uri' });
      onExport(uri.startsWith('data:') ? uri : `data:image/png;base64,${uri}`);
      setMode('compare');
      setSlideX(size / 2);
    } catch {
      // Leave the live edit in place; the caller keeps the previous export.
    } finally {
      setExporting(false);
    }
  }, [onExport, size]);

  return (
    <View>
      {/* ── Frame ── */}
      <View
        ref={shotRef}
        collapsable={false}
        style={[
          { width: size, height: size, borderRadius: RADIUS.lg, overflow: 'hidden' },
          checkerboardStyle,
        ]}
      >
        <Checkerboard />
        {mode === 'compare' ? (
          <View style={{ width: size, height: size }} {...compareResponder.panHandlers}>
            {/* Cutout over checkerboard, full frame */}
            <RNImage source={{ uri: cutoutUri }} style={{ width: size, height: size, position: 'absolute' }} resizeMode="cover" />
            {/* Original, clipped to the left of the divider */}
            <View style={{ position: 'absolute', top: 0, left: 0, width: slideX, height: size, overflow: 'hidden' }}>
              <RNImage source={{ uri: originalUri }} style={{ width: size, height: size }} resizeMode="cover" />
            </View>
            {/* Divider handle */}
            <View style={[styles.divider, { left: slideX - 1, backgroundColor: accent }]} />
            <View style={[styles.handle, { left: slideX - 16, backgroundColor: accent }]}>
              <Feather name="chevrons-left" size={12} color="#fff" style={{ marginRight: -2 }} />
              <Feather name="chevrons-right" size={12} color="#fff" style={{ marginLeft: -2 }} />
            </View>
            <View style={styles.compareTagLeft}><Text style={styles.compareTagText}>BEFORE</Text></View>
            <View style={styles.compareTagRight}><Text style={styles.compareTagText}>AFTER</Text></View>
          </View>
        ) : (
          <View style={{ width: size, height: size }} {...brushResponder.panHandlers}>
            {/* Restore layer: reveals original only where the restore brush painted */}
            <Svg width={size} height={size} style={{ position: 'absolute' }}>
              <Defs>
                <Mask id="restoreMask">
                  <Rect x={0} y={0} width={size} height={size} fill="black" />
                  {restoreStrokes.map((s, i) => (
                    <Path key={i} d={s.d} stroke="white" strokeWidth={BRUSH_WIDTH} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  ))}
                  {liveRestoreD && (
                    <Path d={liveRestoreD} stroke="white" strokeWidth={BRUSH_WIDTH} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  )}
                </Mask>
              </Defs>
              <SvgImage href={originalUri} x={0} y={0} width={size} height={size} preserveAspectRatio="xMidYMid slice" mask="url(#restoreMask)" />
            </Svg>

            {/* Cutout layer: fully visible except where the erase brush painted */}
            <Svg width={size} height={size} style={{ position: 'absolute' }}>
              <Defs>
                <Mask id="eraseMask">
                  <Rect x={0} y={0} width={size} height={size} fill="white" />
                  {eraseStrokes.map((s, i) => (
                    <Path key={i} d={s.d} stroke="black" strokeWidth={BRUSH_WIDTH} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  ))}
                  {liveEraseD && (
                    <Path d={liveEraseD} stroke="black" strokeWidth={BRUSH_WIDTH} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  )}
                </Mask>
              </Defs>
              <SvgImage href={cutoutUri} x={0} y={0} width={size} height={size} preserveAspectRatio="xMidYMid slice" mask="url(#eraseMask)" />
            </Svg>
          </View>
        )}
      </View>

      {/* ── Mode switch ── */}
      <View style={[styles.modeSwitch, { borderColor }]}>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'compare' && { backgroundColor: cardColor }]}
          onPress={() => setMode('compare')}
        >
          <Feather name="chevrons-left" size={ICON.xs} color={mode === 'compare' ? accent : mutedColor} />
          <Text style={[styles.modeBtnText, { color: mode === 'compare' ? accent : mutedColor }]}>Compare</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'refine' && { backgroundColor: cardColor }]}
          onPress={() => setMode('refine')}
        >
          <Feather name="edit-3" size={ICON.xs} color={mode === 'refine' ? accent : mutedColor} />
          <Text style={[styles.modeBtnText, { color: mode === 'refine' ? accent : mutedColor }]}>Refine</Text>
        </TouchableOpacity>
      </View>

      {/* ── Refine toolbar ── */}
      {mode === 'refine' && (
        <View style={styles.toolbar}>
          <TouchableOpacity
            style={[styles.toolBtn, { borderColor }, tool === 'erase' && { borderColor: accent }]}
            onPress={() => setTool('erase')}
          >
            <Feather name="minus-circle" size={ICON.sm} color={tool === 'erase' ? accent : fgColor} />
            <Text style={[styles.toolBtnText, { color: tool === 'erase' ? accent : fgColor }]}>Erase</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toolBtn, { borderColor }, tool === 'restore' && { borderColor: accent }]}
            onPress={() => setTool('restore')}
          >
            <Feather name="plus-circle" size={ICON.sm} color={tool === 'restore' ? accent : fgColor} />
            <Text style={[styles.toolBtnText, { color: tool === 'restore' ? accent : fgColor }]}>Restore</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toolBtn, { borderColor }]}
            onPress={handleUndo}
            disabled={strokes.length === 0}
          >
            <Feather name="corner-up-left" size={ICON.sm} color={strokes.length === 0 ? mutedColor : fgColor} />
            <Text style={[styles.toolBtnText, { color: strokes.length === 0 ? mutedColor : fgColor }]}>Undo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toolBtn, { borderColor }]}
            onPress={handleReset}
            disabled={strokes.length === 0}
          >
            <Feather name="trash-2" size={ICON.sm} color={strokes.length === 0 ? mutedColor : fgColor} />
            <Text style={[styles.toolBtnText, { color: strokes.length === 0 ? mutedColor : fgColor }]}>Reset</Text>
          </TouchableOpacity>
        </View>
      )}

      {mode === 'refine' && (
        <TouchableOpacity
          style={[styles.doneBtn, { backgroundColor: accent }]}
          onPress={handleDone}
          disabled={exporting || strokes.length === 0}
        >
          <Feather name="check" size={ICON.sm} color="#fff" />
          <Text style={styles.doneBtnText}>{exporting ? 'Applying…' : 'Apply edits'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  divider: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
  },
  handle: {
    position: 'absolute',
    top: '50%',
    marginTop: -14,
    width: 32,
    height: 28,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  compareTagLeft: {
    position: 'absolute',
    top: SP.sm,
    left: SP.sm,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: 2,
  },
  compareTagRight: {
    position: 'absolute',
    top: SP.sm,
    right: SP.sm,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: 2,
  },
  compareTagText: {
    fontFamily: FONT.bold,
    fontSize: FS.xs,
    color: '#fff',
  },
  modeSwitch: {
    flexDirection: 'row',
    marginTop: SP.md,
    borderWidth: 1,
    borderRadius: RADIUS.pill,
    padding: 3,
    gap: 3,
    alignSelf: 'center',
  },
  modeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: SP.md,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
  },
  modeBtnText: {
    fontFamily: FONT.semibold,
    fontSize: FS.xs,
  },
  toolbar: {
    flexDirection: 'row',
    gap: SP.xs,
    marginTop: SP.md,
    justifyContent: 'center',
  },
  toolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: SP.sm,
    paddingVertical: 8,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  toolBtnText: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
  },
  doneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: SP.md,
    paddingVertical: SP.sm,
    borderRadius: RADIUS.pill,
  },
  doneBtnText: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    color: '#fff',
  },
});
