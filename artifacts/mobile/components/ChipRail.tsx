/**
 * Horizontally swipeable filter-chip row (Instagram / TikTok filter chips):
 *
 * - Finger drag scrolls the row with native momentum; no scroll indicator.
 * - Snaps so a chip's leading edge lands on the 16px page gutter
 *   (native: `snapToOffsets` + fast deceleration; web: CSS scroll-snap).
 * - First chip sits on the 16px gutter, the last one has 16px trailing room.
 * - Tapping a chip selects it and scrolls it into view (centred, clamped).
 * - Web preview: touch scrolls natively; a mouse drag scrolls too (with a
 *   short momentum glide) and never counts as a tap on the chip under it.
 *
 * Only the chip row scrolls — it lives in the fixed list header, below the
 * search bar and its two buttons, which do not move.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { FilterChip } from '@/components/BrandthreadUI';
import { SP } from '@/lib/theme';
import { CHIP_RAIL_GUTTER, chipCenterOffset, chipSnapOffsets, visibleChipCount } from '@/lib/sellerLists/chipRailGeometry';

export { chipCenterOffset, chipSnapOffsets, visibleChipCount };

export interface ChipRailChip {
  key: string;
  label: string;
  active: boolean;
  count?: number;
  onPress: () => void;
}

const GUTTER = CHIP_RAIL_GUTTER; // = SP.md
const DRAG_SLOP = 4;

export function ChipRail({ chips, style, testID = 'chip-rail' }: { chips: ChipRailChip[]; style?: ViewStyle; testID?: string }) {
  const scrollRef = useRef<ScrollView>(null);
  const layoutsRef = useRef<Record<string, { x: number; width: number }>>({});
  const [snapOffsets, setSnapOffsets] = useState<number[]>([]);
  const viewportWidthRef = useRef(0);
  const contentWidthRef = useRef(0);
  const scrollXRef = useRef(0);

  const recomputeSnaps = useCallback(() => {
    const ordered = chips.map((c) => layoutsRef.current[c.key]).filter(Boolean) as { x: number; width: number }[];
    if (ordered.length === chips.length) setSnapOffsets(chipSnapOffsets(ordered));
  }, [chips]);

  const scrollChipIntoView = useCallback((key: string) => {
    const layout = layoutsRef.current[key];
    if (!layout || viewportWidthRef.current === 0) return;
    const x = chipCenterOffset(layout, viewportWidthRef.current, contentWidthRef.current);
    if (Math.abs(x - scrollXRef.current) < 1) return;
    scrollRef.current?.scrollTo({ x, animated: true });
  }, []);

  // ── Web: mouse drag-to-scroll (touch already scrolls natively) ──────────
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = (scrollRef.current as unknown as { getScrollableNode?: () => HTMLElement })?.getScrollableNode?.();
    if (!node) return;
    let pointerId = -1;
    let startX = 0;
    let startLeft = 0;
    let dragging = false;
    let moved = false;
    let suppressClick = false;
    let lastX = 0;
    let lastT = 0;
    let velocity = 0; // px per ms, in scroll direction
    let glide = 0;

    const stopGlide = () => { if (glide) cancelAnimationFrame(glide); glide = 0; };
    const restoreSnap = () => { node.style.scrollSnapType = ''; node.style.cursor = ''; };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      stopGlide();
      dragging = true;
      moved = false;
      pointerId = e.pointerId;
      startX = lastX = e.clientX;
      lastT = performance.now();
      startLeft = node.scrollLeft;
      velocity = 0;
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) > DRAG_SLOP) {
        moved = true;
        // Snap would fight every scrollLeft write; it is restored on release
        // and the browser then settles on the nearest chip.
        node.style.scrollSnapType = 'none';
        node.style.cursor = 'grabbing';
      }
      if (!moved) return;
      e.preventDefault();
      node.scrollLeft = startLeft - dx;
      const now = performance.now();
      const dt = Math.max(1, now - lastT);
      velocity = 0.8 * ((lastX - e.clientX) / dt) + 0.2 * velocity;
      lastX = e.clientX;
      lastT = now;
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointerId) return;
      dragging = false;
      if (!moved) return;
      suppressClick = true;
      let v = velocity * 16; // px per frame
      const step = () => {
        if (Math.abs(v) < 0.5) { glide = 0; restoreSnap(); return; }
        node.scrollLeft += v;
        v *= 0.92;
        glide = requestAnimationFrame(step);
      };
      glide = requestAnimationFrame(step);
    };
    // A drag that ends over a chip must not also select it.
    const onClickCapture = (e: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      e.stopPropagation();
      e.preventDefault();
    };

    node.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    node.addEventListener('click', onClickCapture, true);
    return () => {
      stopGlide();
      node.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      node.removeEventListener('click', onClickCapture, true);
    };
  }, []);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      decelerationRate="fast"
      snapToOffsets={Platform.OS === 'web' ? undefined : snapOffsets}
      snapToStart
      snapToEnd
      scrollEventThrottle={16}
      onScroll={(e) => { scrollXRef.current = e.nativeEvent.contentOffset.x; }}
      onLayout={(e: LayoutChangeEvent) => { viewportWidthRef.current = e.nativeEvent.layout.width; }}
      onContentSizeChange={(w) => { contentWidthRef.current = w; }}
      style={[Platform.OS === 'web' ? (webRailStyle as ViewStyle) : null, style]}
      contentContainerStyle={styles.row}
      testID={testID}
    >
      {chips.map((chip) => (
        <View
          key={chip.key}
          collapsable={false}
          testID={`${testID}-${chip.key}`}
          // react-native-web drops aria-selected on role=button, so expose the
          // active chip as data-chip-active for the web e2e checks.
          {...(Platform.OS === 'web' ? ({ dataSet: { chipActive: String(chip.active) } } as object) : null)}
          style={Platform.OS === 'web' ? (webChipStyle as ViewStyle) : undefined}
          onLayout={(e: LayoutChangeEvent) => {
            const { x, width } = e.nativeEvent.layout;
            layoutsRef.current[chip.key] = { x, width };
            recomputeSnaps();
          }}
        >
          <FilterChip
            label={chip.label}
            active={chip.active}
            count={visibleChipCount(chip.count)}
            onPress={() => {
              chip.onPress();
              scrollChipIntoView(chip.key);
            }}
          />
        </View>
      ))}
    </ScrollView>
  );
}

// CSS-only properties (react-native-web passes them through to the DOM).
const webRailStyle = { scrollSnapType: 'x proximity', scrollPaddingLeft: GUTTER, scrollPaddingRight: GUTTER, overscrollBehaviorX: 'contain' };
const webChipStyle = { scrollSnapAlign: 'start' };

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: GUTTER,
    paddingBottom: SP.sm,
    paddingTop: 2,
    gap: SP.sm,
    alignItems: 'center',
  },
});
