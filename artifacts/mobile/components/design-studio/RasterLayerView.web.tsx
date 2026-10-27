/**
 * RasterLayerView.web.tsx — shows one drawing layer's live pixels.
 *
 * The paint engine's display surface for the layer IS an HTML canvas; this
 * view simply mounts that element (no per-frame copying — the browser
 * composites it on the GPU). Layer opacity / blend mode / visibility are
 * plain styles on the host, so they cost nothing per stroke.
 */

import React, { useLayoutEffect, useRef } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import type { PaintEngine } from '@/lib/paint/engine';

export interface RasterLayerViewProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: PaintEngine<any>;
  layerId: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export default function RasterLayerView({ engine, layerId, style, testID }: RasterLayerViewProps) {
  const ref = useRef<View>(null);
  useLayoutEffect(() => {
    const host = ref.current as unknown as HTMLElement | null;
    if (!host) return;
    const canvas = engine.display(layerId) as HTMLCanvasElement;
    Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', display: 'block', pointerEvents: 'none' });
    canvas.dataset.layerId = layerId;
    host.appendChild(canvas);
    return () => { if (canvas.parentNode === host) host.removeChild(canvas); };
  }, [engine, layerId]);
  return <View ref={ref} style={style} pointerEvents="none" testID={testID} />;
}
