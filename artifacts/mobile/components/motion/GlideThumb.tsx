/**
 * GlideThumb — the selected-segment thumb that glides between options
 * (micro-interactions pack 2, item 18), for pill rows whose options have
 * their own measured widths (analytics PillTabs / SegmentedPills). Same
 * spring as the Dashboard's Today/7D/30D/90D range pills and the shared
 * SegmentedControl (TAB_INDICATOR_SPRING), so every selector glides alike.
 *
 * Mobbin reference: iOS UISegmentedControl / Instagram Insights date-range
 * switcher — the filled thumb slides under the labels rather than the fill
 * jump-cutting from one pill to another.
 *
 * The first measured position is snapped (never animated in from x=0), and
 * Reduce Motion snaps every change.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { TAB_INDICATOR_SPRING } from '@/constants/motion';
import { isMotionReduced } from '@/lib/reduceMotion';

type Rect = { x: number; y: number; width: number; height: number };

export function useGlideThumb(activeIndex: number) {
  const [rects, setRects] = useState<Record<number, Rect>>({});
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const w = useSharedValue(0);
  const h = useSharedValue(0);
  const placed = useRef(false);

  const setRect = useCallback((index: number, { x: lx, y: ly, width, height }: Rect) => {
    setRects(prev => {
      const p = prev[index];
      if (p && Math.abs(p.x - lx) < 0.5 && Math.abs(p.width - width) < 0.5 && Math.abs(p.y - ly) < 0.5 && Math.abs(p.height - height) < 0.5) return prev;
      return { ...prev, [index]: { x: lx, y: ly, width, height } };
    });
  }, []);
  const onItemLayout = useCallback((index: number) => (e: LayoutChangeEvent) => setRect(index, e.nativeEvent.layout), [setRect]);

  const rect = rects[activeIndex];
  useEffect(() => {
    if (!rect) return;
    if (!placed.current || isMotionReduced()) {
      placed.current = true;
      x.value = rect.x; y.value = rect.y; w.value = rect.width; h.value = rect.height;
      return;
    }
    x.value = withSpring(rect.x, TAB_INDICATOR_SPRING);
    y.value = withSpring(rect.y, TAB_INDICATOR_SPRING);
    w.value = withSpring(rect.width, TAB_INDICATOR_SPRING);
    h.value = withSpring(rect.height, TAB_INDICATOR_SPRING);
  }, [h, rect, w, x, y]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }],
    width: w.value,
    height: h.value,
  }));

  return { onItemLayout, setRect, thumbStyle, ready: !!rect };
}

/** The thumb itself — absolutely positioned under the row's options. */
export function GlideThumbView({ thumbStyle, ready, style, testID }: {
  thumbStyle: ReturnType<typeof useGlideThumb>['thumbStyle'];
  ready: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <Animated.View
      pointerEvents="none"
      testID={testID}
      style={[{ position: 'absolute', left: 0, top: 0, opacity: ready ? 1 : 0 }, style, thumbStyle]}
    />
  );
}
