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

import React, { useImperativeHandle, useMemo, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { isSkiaAvailable } from '@/lib/skiaAvailability';
import SvgDrawingCanvas, { SvgDrawingCanvasProps } from './SvgDrawingCanvas';
import type { SkiaDrawingCanvasHandle } from './SkiaDrawingCanvas';
import { FONT, FS, MUTED, SP } from '@/lib/theme';

export type CanvasHostProps = SvgDrawingCanvasProps; // same prop contract for both renderers

export type CanvasRenderMode = 'skia' | 'svg';

/**
 * CanvasHostHandle — real pixel sampling for the eyedropper tool.
 * `readPixelColor` only returns a value on the Skia render path (a genuine
 * GPU-surface read via SkImage.readPixels); on the SVG fallback it returns
 * null since react-native-svg exposes no surface to read from — the caller
 * (design-canvas.tsx) falls back to its own layer-color approximation in
 * that case, per lib/colorModel's documented eyedropper contract.
 */
export interface CanvasHostHandle {
  readPixelColor(x: number, y: number): string | null;
}

/** Exposed for the host screen to show a "GPU acceleration active" indicator, if desired. */
export function getCanvasRenderMode(): CanvasRenderMode {
  return isSkiaAvailable() ? 'skia' : 'svg';
}

function CanvasHostInner(props: CanvasHostProps, ref: React.ForwardedRef<CanvasHostHandle>) {
  const mode = useMemo(getCanvasRenderMode, []);
  const skiaRef = useRef<SkiaDrawingCanvasHandle>(null);

  useImperativeHandle(ref, () => ({
    readPixelColor: (x: number, y: number) => skiaRef.current?.readPixelColor(x, y) ?? null,
  }), []);

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
    return <SkiaDrawingCanvas ref={skiaRef} {...props} />;
  }

  return <SvgDrawingCanvas {...props} />;
}

const CanvasHost = React.forwardRef(CanvasHostInner);
export default CanvasHost;

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
