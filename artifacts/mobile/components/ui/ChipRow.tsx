/**
 * Brandthread Design System — ChipRow
 *
 * The one horizontally swipeable row for filter chips / status tabs / range
 * pills at the top of a screen. It only owns the *row*: the chips you pass as
 * children keep their own look, so dropping a ChipRow around an existing row
 * changes nothing visually except that it scrolls instead of clipping.
 *
 * Reference: Instagram filter chips (music sheet: For you / Trending / Saved,
 * https://mobbin.com/screens/f85f7bca-4c5c-4535-8c91-dc966ab36d6a) — the row
 * bleeds to the screen edge, content is inset 16pt on both ends so the last
 * chip can always be scrolled fully into view, no scroll indicator, native
 * momentum, and the tapped chip glides to the centre.
 *
 *   <ChipRow selectedIndex={i} bleed={16}>
 *     {FILTERS.map((f) => <Chip key={f.key} … />)}
 *   </ChipRow>
 *
 * - `selectedIndex` changes → the chip is scrolled into view (centred where
 *   possible). On mount / when coming back to a remounted screen it jumps
 *   there without animating, so the selected chip is always visible.
 * - `hapticOnSelect` (default true) fires `hapticSelection` when the
 *   selection changes. Pass `false` when the chips already buzz on press
 *   (`Chip`, `FilterChip`) so one tap never fires two haptics.
 * - `bleed` cancels a parent's horizontal padding so the row reaches the
 *   screen edge while its content keeps the 16pt inset.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { hapticSelection } from '@/lib/haptics';
import { chipCenterOffset, type ChipFrame } from '@/lib/chipRowScroll';

export interface ChipRowProps extends Omit<ScrollViewProps, 'horizontal' | 'children' | 'style' | 'contentContainerStyle'> {
  children: React.ReactNode;
  /** Index (among the rendered children) of the selected chip, if any. */
  selectedIndex?: number;
  /** Additive: drawn first inside the scrolling content, under the chips
   *  (e.g. a gliding selection thumb) — not counted as a chip. */
  underlay?: React.ReactNode;
  /** Additive: each chip's frame in the scrolling content's coordinates. */
  onChipLayout?: (index: number, frame: { x: number; y: number; width: number; height: number }) => void;
  /** Leading/trailing content inset. Defaults to the 16pt screen gutter. */
  inset?: number;
  /** Space between chips. Defaults to 8. */
  gap?: number;
  /** Negative horizontal margin to escape a padded parent (usually 16). */
  bleed?: number;
  hapticOnSelect?: boolean;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

export function ChipRow({
  children,
  selectedIndex,
  underlay,
  onChipLayout,
  inset = 16,
  gap = 8,
  bleed = 0,
  hapticOnSelect = true,
  style,
  contentContainerStyle,
  testID,
  onLayout,
  onContentSizeChange,
  ...scrollProps
}: ChipRowProps) {
  const scrollRef = useRef<ScrollView>(null);
  const frames = useRef<Record<number, ChipFrame>>({});
  const viewportWidth = useRef(0);
  const contentWidth = useRef(0);
  const didInitialScroll = useRef(false);
  const lastSelected = useRef(selectedIndex);

  const scrollToSelected = useCallback((animated: boolean) => {
    if (selectedIndex == null || selectedIndex < 0) return false;
    const frame = frames.current[selectedIndex];
    if (!frame || !viewportWidth.current || !contentWidth.current) return false;
    const x = chipCenterOffset(frame, viewportWidth.current, contentWidth.current);
    scrollRef.current?.scrollTo({ x, animated });
    return true;
  }, [selectedIndex]);

  // First paint: jump (no animation) once everything has been measured.
  const tryInitialScroll = useCallback(() => {
    if (didInitialScroll.current) return;
    if (scrollToSelected(false)) didInitialScroll.current = true;
  }, [scrollToSelected]);

  useEffect(() => {
    if (lastSelected.current === selectedIndex) return;
    lastSelected.current = selectedIndex;
    if (hapticOnSelect && selectedIndex != null && selectedIndex >= 0) hapticSelection();
    if (didInitialScroll.current) scrollToSelected(true);
    else tryInitialScroll();
  }, [selectedIndex, hapticOnSelect, scrollToSelected, tryInitialScroll]);

  const onViewportLayout = useCallback((e: LayoutChangeEvent) => {
    viewportWidth.current = e.nativeEvent.layout.width;
    tryInitialScroll();
    onLayout?.(e);
  }, [tryInitialScroll, onLayout]);

  const onContentSize = useCallback((w: number, h: number) => {
    contentWidth.current = w;
    tryInitialScroll();
    onContentSizeChange?.(w, h);
  }, [tryInitialScroll, onContentSizeChange]);

  const items = React.Children.toArray(children).filter(Boolean);

  return (
    <ScrollView
      {...scrollProps}
      ref={scrollRef}
      horizontal
      testID={testID}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      decelerationRate="normal"
      alwaysBounceHorizontal={false}
      keyboardShouldPersistTaps="handled"
      scrollsToTop={false}
      onLayout={onViewportLayout}
      onContentSizeChange={onContentSize}
      style={[styles.row, bleed ? { marginHorizontal: -bleed } : null, style]}
      contentContainerStyle={[styles.content, { paddingHorizontal: inset, gap }, contentContainerStyle]}
    >
      {underlay}
      {items.map((child, index) => (
        <View
          key={(child as React.ReactElement).key ?? index}
          onLayout={(e) => {
            const { x, y, width, height } = e.nativeEvent.layout;
            frames.current[index] = { x, width };
            onChipLayout?.(index, { x, y, width, height });
            if (index === selectedIndex) tryInitialScroll();
          }}
        >
          {child}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // flexGrow 0 keeps a horizontal ScrollView from stretching vertically in a
  // flex column (and from collapsing to 0 height on web).
  row: { flexGrow: 0, flexShrink: 0 },
  content: { flexDirection: 'row', alignItems: 'center' },
});
