/**
 * Listing photo row with press-and-hold drag to reorder (Depop / Grailed
 * "Photos" step: hold a photo, drag it, the others slide aside, first photo
 * is the cover). One light haptic when a photo is picked up, one when it is
 * dropped in a new slot. Holding and releasing without moving calls
 * `onHold` (the tile's existing actions sheet). Taps stay with the tile's own
 * touchables, so the existing tap-to-crop, remove and chevron buttons keep
 * working, and the chevrons remain the accessible way to reorder.
 *
 * Built on react-native-gesture-handler + reanimated (both already used by
 * components/create-post/ReorderStrip.tsx); both work on web.
 */
import React, { useState } from 'react';
import { ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { hapticLight } from '@/lib/haptics';
import { dropIndexFor } from '@/lib/photoOrder';

export interface ReorderablePhotoStripProps<T extends { id: string }> {
  items: T[];
  itemSize: number;
  gap: number;
  renderItem: (item: T, index: number, dragging: boolean) => React.ReactNode;
  onReorder: (from: number, to: number) => void;
  onHold?: (item: T, index: number) => void;
  /** Rendered after the photos (empty "Add photo" slots, the "+" tile). */
  trailing?: React.ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

type DragState = { from: number; to: number } | null;

export function ReorderablePhotoStrip<T extends { id: string }>({
  items, itemSize, gap, renderItem, onReorder, onHold, trailing, contentContainerStyle, testID,
}: ReorderablePhotoStripProps<T>) {
  const [drag, setDrag] = useState<DragState>(null);
  const step = itemSize + gap;

  return (
    <ScrollView
      horizontal
      scrollEnabled={!drag}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={contentContainerStyle}
      testID={testID}
    >
      {items.map((item, index) => (
        <DraggableTile
          key={item.id}
          index={index}
          count={items.length}
          step={step}
          size={itemSize}
          drag={drag}
          onPickUp={() => { hapticLight(); setDrag({ from: index, to: index }); }}
          onMove={(to) => setDrag(d => (d && d.to !== to ? { ...d, to } : d))}
          onDrop={(to, moved) => {
            setDrag(null);
            if (to !== index) { hapticLight(); onReorder(index, to); }
            else if (!moved) onHold?.(item, index);
          }}
          onCancel={() => setDrag(null)}
        >
          {renderItem(item, index, drag?.from === index)}
        </DraggableTile>
      ))}
      {trailing}
    </ScrollView>
  );
}

function DraggableTile({ index, count, step, size, drag, onPickUp, onMove, onDrop, onCancel, children }: {
  index: number; count: number; step: number; size: number; drag: DragState;
  onPickUp: () => void; onMove: (to: number) => void; onDrop: (to: number, moved: boolean) => void; onCancel: () => void;
  children: React.ReactNode;
}) {
  const dx = useSharedValue(0);
  const dragging = drag?.from === index;

  const pan = Gesture.Pan()
    .activateAfterLongPress(250)
    .onStart(() => { dx.value = 0; runOnJS(onPickUp)(); })
    .onUpdate((e) => {
      dx.value = e.translationX;
      runOnJS(onMove)(dropIndexFor(index, e.translationX, step, count));
    })
    .onEnd((e) => {
      const moved = Math.abs(e.translationX) > 8 || Math.abs(e.translationY) > 8;
      dx.value = withTiming(0, { duration: 140 });
      runOnJS(onDrop)(dropIndexFor(index, e.translationX, step, count), moved);
    })
    .onFinalize((_e, success) => {
      if (!success) { dx.value = withTiming(0, { duration: 140 }); runOnJS(onCancel)(); }
    });

  // The photos between the pick-up slot and the drop slot slide over by one
  // tile, so the drop position is always visible.
  let shift = 0;
  if (drag && !dragging) {
    if (drag.from < drag.to && index > drag.from && index <= drag.to) shift = -step;
    if (drag.from > drag.to && index >= drag.to && index < drag.from) shift = step;
  }
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: dragging ? dx.value : withTiming(shift, { duration: 140 }) }, { scale: dragging ? 1.05 : 1 }],
    zIndex: dragging ? 10 : 0,
  }), [dragging, shift]);

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ width: size, height: size }, style]}>
        <View style={{ flex: 1 }}>{children}</View>
      </Animated.View>
    </GestureDetector>
  );
}
