/**
 * CanvasHost.tsx — chooses the GPU-accelerated Skia drawing surface when the
 * native module is available, and transparently falls back to the
 * react-native-svg PanResponder-based surface otherwise (Expo Go, web, or
 * any build without the Skia native binding linked).
 *
 * This is the ONLY place that decides whether SkiaDrawingCanvas.tsx gets
 * loaded at all — it does so via a guarded, lazy `require()` AFTER
 * confirming `isSkiaAvailable()`, so evaluating this file (and importing it
 * from the main canvas screen) never risks crashing Expo Go/web.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { isSkiaAvailable } from '@/lib/skiaAvailability';
import SvgDrawingCanvas, { SvgDrawingCanvasProps } from './SvgDrawingCanvas';
import { FONT, FS, MUTED, SP } from '@/lib/theme';

export type CanvasHostProps = SvgDrawingCanvasProps; // same prop contract for both renderers

export type CanvasRenderMode = 'skia' | 'svg';

/** Exposed for the host screen to show a "GPU acceleration active" indicator, if desired. */
export function getCanvasRenderMode(): CanvasRenderMode {
  return isSkiaAvailable() ? 'skia' : 'svg';
}

export default function CanvasHost(props: CanvasHostProps) {
  const mode = useMemo(getCanvasRenderMode, []);

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const SkiaDrawingCanvas = useMemo(() => {
    if (mode !== 'skia') return null;
    try {
      return require('./SkiaDrawingCanvas').default;
    } catch {
      return null;
    }
  }, [mode]);

  if (mode === 'skia' && SkiaDrawingCanvas) {
    return <SkiaDrawingCanvas {...props} />;
  }

  return <SvgDrawingCanvas {...props} />;
}

/** Small chrome badge — shown once, low-key, when running on the SVG fallback. */
export function RenderModeBadge({ mode }: { mode: CanvasRenderMode }) {
  if (mode === 'skia') return null;
  return (
    <View style={s.badge} pointerEvents="none">
      <Text style={s.badgeText}>Standard rendering — GPU acceleration needs a dev build</Text>
    </View>
  );
}

const s = StyleSheet.create({
  badge: {
    position: 'absolute', bottom: SP.sm, alignSelf: 'center',
    paddingHorizontal: SP.sm, paddingVertical: 4, borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  badgeText: { fontFamily: FONT.medium, fontSize: 10, color: MUTED, includeFontPadding: false },
});
