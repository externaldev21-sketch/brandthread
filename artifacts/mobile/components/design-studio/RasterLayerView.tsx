/**
 * RasterLayerView.tsx (native) — shows one drawing layer's live pixels as a
 * Skia image snapshot of the paint engine's display surface, refreshed at
 * most once per frame while painting. Skia is required lazily: this view is
 * only mounted when lib/paint/platform.ts produced a Skia backend.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { PaintEngine } from '@/lib/paint/engine';

export interface RasterLayerViewProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: PaintEngine<any>;
  layerId: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export default function RasterLayerView({ engine, layerId, style, testID }: RasterLayerViewProps) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sk = require('@shopify/react-native-skia');
  const [image, setImage] = useState(() => engine.display(layerId).makeImageSnapshot());
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    let frame: number | null = null;
    setImage(engine.display(layerId).makeImageSnapshot());
    const off = engine.onDisplayChange(id => {
      if (id !== layerId || frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        setImage(engine.display(layerId).makeImageSnapshot());
      });
    });
    return () => { off(); if (frame !== null) cancelAnimationFrame(frame); };
  }, [engine, layerId]);

  return (
    <View
      style={style}
      pointerEvents="none"
      testID={testID}
      onLayout={e => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {size.w > 0 && (
        <sk.Canvas style={StyleSheet.absoluteFill}>
          <sk.Image image={image} x={0} y={0} width={size.w} height={size.h} fit="fill" />
        </sk.Canvas>
      )}
    </View>
  );
}
