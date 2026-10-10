/**
 * Large titles that collapse into the compact bar on scroll (Apple HIG
 * "Navigation bars → large titles", iOS Settings / Mail).
 *
 * Usage — the screen keeps its existing ScreenHeader and list, and only
 * wires the scroll through:
 *
 *   const titleCollapse = useLargeTitleCollapse();
 *   <ScreenHeader title="Menu" collapse={titleCollapse} />
 *   <Animated.ScrollView onScroll={titleCollapse.onScroll} scrollEventThrottle={16}>
 *
 * At rest nothing changes: the header title stays exactly where it is. As
 * the list scrolls, the title slides up out of its own box 1:1 with the
 * scroll offset and a small centered title (components/ui/CollapsingTitleBar)
 * fades into the same bar. Everything is driven straight off the scroll
 * offset (native driver on device) — no spring or timing, so the title
 * tracks the finger exactly and never animates on its own.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Animated, Platform, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import {
  DEFAULT_LARGE_TITLE_THRESHOLD,
  largeTitleCollapseRanges,
  normalizeThreshold,
} from '@/lib/largeTitleCollapse';

export { largeTitleCollapseAt, largeTitleCollapseRanges } from '@/lib/largeTitleCollapse';

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;

export interface LargeTitleCollapse {
  /** Raw vertical scroll offset of the screen's list. */
  scrollY: Animated.Value;
  /** Pass to an Animated.ScrollView / Animated.FlatList / Animated.SectionList `onScroll`. */
  onScroll: (...args: unknown[]) => void;
  /** Measured large-title height = scroll distance until it is fully gone. */
  threshold: number;
  /** Header passes this to the large title's onLayout. */
  onLargeTitleLayout: (event: LayoutChangeEvent) => void;
  largeTitleStyle: {
    opacity: Animated.AnimatedInterpolation<number>;
    transform: { translateY: Animated.AnimatedInterpolation<number> }[];
  };
  compactTitleStyle: { opacity: Animated.AnimatedInterpolation<number> };
}

const USE_NATIVE_DRIVER = Platform.OS !== 'web';

export function useLargeTitleCollapse(options: { onScroll?: (event: ScrollEvent) => void } = {}): LargeTitleCollapse {
  const scrollY = useRef(new Animated.Value(0)).current;
  const [threshold, setThreshold] = useState(DEFAULT_LARGE_TITLE_THRESHOLD);

  // A screen's own scroll handler (e.g. a "back to top" check) keeps working
  // as the event's listener; read through a ref so a new closure each render
  // doesn't rebuild the native event binding.
  const listenerRef = useRef(options.onScroll);
  listenerRef.current = options.onScroll;

  const onScroll = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
      useNativeDriver: USE_NATIVE_DRIVER,
      listener: (event: ScrollEvent) => listenerRef.current?.(event),
    }) as unknown as (...args: unknown[]) => void,
    [scrollY],
  );

  const onLargeTitleLayout = useCallback((event: LayoutChangeEvent) => {
    const measured = normalizeThreshold(Math.round(event.nativeEvent.layout.height));
    setThreshold((prev) => (prev === measured ? prev : measured));
  }, []);

  const { largeTitleStyle, compactTitleStyle } = useMemo(() => {
    const r = largeTitleCollapseRanges(threshold);
    return {
      largeTitleStyle: {
        opacity: scrollY.interpolate(r.largeTitleOpacity),
        transform: [{ translateY: scrollY.interpolate(r.largeTitleTranslateY) }],
      },
      compactTitleStyle: { opacity: scrollY.interpolate(r.compactTitleOpacity) },
    };
  }, [scrollY, threshold]);

  return { scrollY, onScroll, threshold, onLargeTitleLayout, largeTitleStyle, compactTitleStyle };
}
