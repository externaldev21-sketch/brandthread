/**
 * Horizontal strip whose items can be re-ordered by press-and-hold, then drag.
 * Used for the selected-media tray (gallery) and the slide filmstrip (edit).
 * Tap = onPress. The dragged item follows the finger; the others slide aside
 * live so the drop position is always visible.
 */
import React, { useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

export interface ReorderStripProps<T extends { id: string }> {
  items: T[];
  itemW: number;
  itemH: number;
  gap?: number;
  padding?: number;
  renderItem: (item: T, index: number, dragging: boolean) => React.ReactNode;
  onReorder: (from: number, to: number) => void;
  onPressItem?: (item: T, index: number) => void;
  testID?: string;
  /** Scroll to keep this id visible (e.g. the most recently added). */
  focusId?: string | null;
}

export function ReorderStrip<T extends { id: string }>({
  items, itemW, itemH, gap = 8, padding = 16, renderItem, onReorder, onPressItem, testID, focusId,
}: ReorderStripProps<T>) {
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const ref = useRef<ScrollView>(null);
  const step = itemW + gap;

  React.useEffect(() => {
    if (!focusId) return;
    const idx = items.findIndex((i) => i.id === focusId);
    if (idx >= 0) ref.current?.scrollTo({ x: Math.max(0, idx * step - step), animated: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, items.length]);

  return (
    <ScrollView
      ref={ref}
      testID={testID}
      horizontal
      scrollEnabled={!drag}
      showsHorizontalScrollIndicator={false}
      style={{ height: itemH + 12, flexGrow: 0 }}
      contentContainerStyle={{ paddingHorizontal: padding, alignItems: 'center', gap }}
    >
      {items.map((item, index) => (
        <StripItem
          key={item.id}
          index={index}
          step={step}
          itemW={itemW}
          itemH={itemH}
          count={items.length}
          drag={drag}
          onDragStart={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); setDrag({ from: index, to: index }); }}
          onDragTo={(to) => setDrag((d) => (d && d.to !== to ? { ...d, to } : d))}
          onDragEnd={(to) => { setDrag(null); if (to !== index) onReorder(index, to); }}
          onPress={() => onPressItem?.(item, index)}
        >
          {renderItem(item, index, drag?.from === index)}
        </StripItem>
      ))}
    </ScrollView>
  );
}

function StripItem({ index, step, itemW, itemH, count, drag, onDragStart, onDragTo, onDragEnd, onPress, children }: {
  index: number; step: number; itemW: number; itemH: number; count: number;
  drag: { from: number; to: number } | null;
  onDragStart: () => void; onDragTo: (to: number) => void; onDragEnd: (to: number) => void; onPress: () => void;
  children: React.ReactNode;
}) {
  const dx = useSharedValue(0);
  const dragging = drag?.from === index;

  const pan = Gesture.Pan()
    .activateAfterLongPress(220)
    .onStart(() => { dx.value = 0; runOnJS(onDragStart)(); })
    .onUpdate((e) => {
      dx.value = e.translationX;
      const to = Math.max(0, Math.min(count - 1, Math.round(index + e.translationX / step)));
      runOnJS(onDragTo)(to);
    })
    .onEnd((e) => {
      const to = Math.max(0, Math.min(count - 1, Math.round(index + e.translationX / step)));
      dx.value = withSpring(0);
      runOnJS(onDragEnd)(to);
    });
  const tapGesture = Gesture.Tap().maxDuration(400).onEnd((_e, ok) => { if (ok) runOnJS(onPress)(); });
  const gesture = Gesture.Exclusive(pan, tapGesture);

  let shift = 0;
  if (drag && !dragging) {
    if (drag.from < drag.to && index > drag.from && index <= drag.to) shift = -step;
    if (drag.from > drag.to && index >= drag.to && index < drag.from) shift = step;
  }
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: dragging ? dx.value : shift }, { scale: dragging ? 1.06 : 1 }],
    zIndex: dragging ? 10 : 0,
  }), [dragging, shift]);

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[{ width: itemW, height: itemH }, style]}>
        <View style={{ flex: 1 }}>{children}</View>
      </Animated.View>
    </GestureDetector>
  );
}
