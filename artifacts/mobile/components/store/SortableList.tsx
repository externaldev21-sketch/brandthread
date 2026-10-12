/**
 * Drag to reorder (Stan Store's product list): fixed-height rows; press and
 * drag a row's handle, the others slide out of the way, and the new order is
 * reported on release. Built on gesture-handler + reanimated (no new
 * dependency). Each row also gets move up / move down accessibility actions.
 */
import React, { useLayoutEffect } from 'react';
import { View } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';

import { dropIndex } from '@/lib/storeBlocks';

export interface SortableRowProps<T> {
  item: T;
  index: number;
  /** Attach to the drag handle: <DragHandle gesture={drag}>…</DragHandle>. */
  drag: GestureType;
  /** Move this row to another index (screen-reader actions). */
  move: (to: number) => void;
}

/** The part of a row you press to drag it. */
export function DragHandle({ gesture, children }: { gesture: GestureType; children: React.ReactElement }) {
  return <GestureDetector gesture={gesture}>{children}</GestureDetector>;
}

interface Props<T> {
  items: readonly T[];
  keyOf: (item: T) => string;
  rowHeight: number;
  gap?: number;
  renderRow: (props: SortableRowProps<T>) => React.ReactNode;
  onReorder: (from: number, to: number) => void;
  testID?: string;
}

function Row<T>({ item, index, count, step, dragging, dragY, renderRow, onReorder }: {
  item: T; index: number; count: number; step: number;
  dragging: SharedValue<number>; dragY: SharedValue<number>;
  renderRow: Props<T>['renderRow']; onReorder: Props<T>['onReorder'];
}) {
  const pan: GestureType = Gesture.Pan()
    .minDistance(0)
    .onStart(() => { dragging.value = index; dragY.value = 0; })
    .onUpdate((e) => { dragY.value = e.translationY; })
    .onEnd(() => {
      const to = dropIndex(index, dragY.value, step, count);
      // Rows hold their shifted places until the new order renders (the list
      // clears the drag then), so nothing jumps back for a frame.
      if (to !== index) runOnJS(onReorder)(index, to);
      else { dragging.value = -1; dragY.value = 0; }
    })
    .onFinalize((_e, success) => { if (!success) { dragging.value = -1; dragY.value = 0; } });

  const style = useAnimatedStyle(() => {
    const from = dragging.value;
    if (from === index) return { transform: [{ translateY: dragY.value }, { scale: 1.02 }], zIndex: 10, opacity: 0.95 };
    if (from < 0) return { transform: [{ translateY: 0 }, { scale: 1 }], zIndex: 0, opacity: 1 };
    const to = dropIndex(from, dragY.value, step, count);
    const shift = from < index && index <= to ? -step : to <= index && index < from ? step : 0;
    return { transform: [{ translateY: withTiming(shift, { duration: 140 }) }, { scale: 1 }], zIndex: 0, opacity: 1 };
  });

  return (
    <Animated.View style={style}>
      {renderRow({ item, index, drag: pan, move: (to) => { if (to >= 0 && to < count) onReorder(index, to); } })}
    </Animated.View>
  );
}

export function SortableList<T>({ items, keyOf, rowHeight, gap = 0, renderRow, onReorder, testID }: Props<T>) {
  const dragging = useSharedValue(-1);
  const dragY = useSharedValue(0);
  const step = rowHeight + gap;
  const order = items.map(keyOf).join('|');
  // The new order has rendered: clear the drag.
  useLayoutEffect(() => { dragging.value = -1; dragY.value = 0; }, [order, dragging, dragY]);
  return (
    <View style={{ gap }} testID={testID}>
      {items.map((item, index) => (
        <Row
          key={keyOf(item)}
          item={item}
          index={index}
          count={items.length}
          step={step}
          dragging={dragging}
          dragY={dragY}
          renderRow={renderRow}
          onReorder={onReorder}
        />
      ))}
    </View>
  );
}
