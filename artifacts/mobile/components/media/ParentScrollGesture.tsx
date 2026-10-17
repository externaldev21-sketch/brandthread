/**
 * Native-gesture scope for a vertical parent scroller (feed FlatList, viewer
 * ScrollView). Child carousels read the parent's Gesture.Native() and declare
 * `blocksExternalGesture(parent)` on their pan + pinch, so the native scroll
 * waits for the carousel: a horizontal claim never scrolls the parent, and
 * the carousel's manual vertical failure at 10pt hands the touch back.
 */
import React, { createContext, useContext, useMemo } from 'react';
import { Gesture, GestureDetector, type NativeGesture } from 'react-native-gesture-handler';

const ParentScrollGestureContext = createContext<NativeGesture | null>(null);

export function useParentScrollGesture(): NativeGesture | null {
  return useContext(ParentScrollGestureContext);
}

export function ParentScrollGestureScope({ children }: { children: React.ReactElement }) {
  const native = useMemo(() => Gesture.Native(), []);
  return (
    <ParentScrollGestureContext.Provider value={native}>
      <GestureDetector gesture={native} touchAction="pan-y">{children}</GestureDetector>
    </ParentScrollGestureContext.Provider>
  );
}
