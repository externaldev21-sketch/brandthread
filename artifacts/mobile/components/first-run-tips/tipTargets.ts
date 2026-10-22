/**
 * Presentation-only registry that relays a measured target rect from the
 * exact element a tip describes (e.g. a list's first row, declared deep in a
 * row component) to the <FirstRunTip> rendered at the screen root.
 *
 *   const t = useTipTargetMeasure('seller-orders', isFirstRow); // on the element
 *   <View ref={t.ref} onLayout={t.onLayout} ...>
 *   const rect = useTipTarget('seller-orders');                  // at the tip
 *
 * Measurement only: no styles, layout, or actions are touched. A disabled
 * measurer returns undefined ref/onLayout so non-target elements are unchanged.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { View } from 'react-native';
import type { TargetRect } from './types';

const rects = new Map<string, TargetRect | null>();
const listeners = new Set<() => void>();

export function setTipTarget(key: string, rect: TargetRect | null) {
  const prev = rects.get(key) ?? null;
  if (prev === rect) return;
  if (prev && rect && prev.x === rect.x && prev.y === rect.y && prev.width === rect.width && prev.height === rect.height) return;
  rects.set(key, rect);
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Current measured rect for a tip target key (null until measured). */
export function useTipTarget(key: string): TargetRect | null {
  return useSyncExternalStore(subscribe, () => rects.get(key) ?? null, () => null);
}

type Measurable = { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void };

const nodes = new Map<string, Measurable | null>();
const staticProps = new Map<string, { ref: (n: unknown) => void; onLayout: () => void }>();

function measureNode(key: string) {
  requestAnimationFrame(() => {
    nodes.get(key)?.measureInWindow?.((x, y, width, height) => {
      if (width > 0 && height > 0) setTipTarget(key, { x, y, width, height });
    });
  });
}

/**
 * Hook-free variant for render functions (e.g. FlashList renderItem helpers)
 * where hooks can't be called. Returns stable ref/onLayout for `key`.
 */
export function tipTargetProps(key: string) {
  let p = staticProps.get(key);
  if (!p) {
    p = {
      ref: (n: unknown) => {
        nodes.set(key, (n as Measurable) ?? null);
        if (!n) setTipTarget(key, null);
      },
      onLayout: () => measureNode(key),
    };
    staticProps.set(key, p);
  }
  return p;
}

/**
 * onLayout-only measurement for an element that already owns its ref (e.g. a
 * FlatList with a scroll-reset ref): reads the existing ref, adds none.
 * Handles scroll components via getNativeScrollRef/getScrollableNode hosts.
 */
export function measureTipTargetFrom(key: string, getNode: () => unknown) {
  const n = getNode() as (Measurable & { getNativeScrollRef?: () => unknown }) | null;
  const host = (n?.measureInWindow ? n : (n?.getNativeScrollRef?.() as Measurable | null)) ?? null;
  nodes.set(key, host);
  measureNode(key);
}

/** Attach to the exact element a tip describes. Pass enabled=false for non-target instances. */
export function useTipTargetMeasure(key: string, enabled = true) {
  const ref = useRef<View>(null);
  const onLayout = useCallback(() => {
    requestAnimationFrame(() => {
      (ref.current as unknown as Measurable | null)?.measureInWindow?.((x, y, width, height) => {
        if (width > 0 && height > 0) setTipTarget(key, { x, y, width, height });
      });
    });
  }, [key]);
  useEffect(() => {
    if (!enabled) return;
    return () => setTipTarget(key, null);
  }, [enabled, key]);
  return enabled ? { ref, onLayout } : { ref: undefined, onLayout: undefined };
}
