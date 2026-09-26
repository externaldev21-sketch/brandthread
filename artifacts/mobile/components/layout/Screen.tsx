/**
 * Screen / ScreenScroll — the shared page containers every screen (buyer and
 * seller) should render its body through.
 *
 * What they guarantee, centrally, so no screen has to reason about it again:
 *  - Safe-area insets (notch/status bar, home indicator) are always applied.
 *  - The floating tab bar's occupied height is padded automatically, so
 *    content can never render under it — pass `withTabBarInset={false}` only
 *    for screens mounted outside the tabs (checkout, onboarding, etc).
 *  - The screen always lands scrolled to the top on focus — first mount, a
 *    push into it, coming back to it, switching tabs into it, or re-tapping
 *    its own already-active tab (see hooks/useScrollReset). Pass
 *    `resetScrollOnFocus={false}` to opt out (e.g. the Threads video feed,
 *    which keeps its position across overlays and only wants the reset on a
 *    real away-and-back tab switch — which is exactly what this already is).
 *  - Content respects `maxContentWidth` on tablet/web via useResponsive, so
 *    a single column doesn't stretch edge-to-edge on an iPad.
 *
 * `Screen` is a plain non-scrolling flex container (for screens whose body is
 * a FlatList/SectionList/FlashList — attach `useScrollReset()`'s ref to that
 * list yourself and pass the tab bar inset to its contentContainerStyle via
 * `useScreenPadding()`). `ScreenScroll` wraps a ScrollView and wires the
 * reset ref up for you.
 */
import React from 'react';
import { ScrollView, ScrollViewProps, StyleSheet, View, ViewProps, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResponsive } from '@/hooks/useResponsive';
import { useScrollReset } from '@/hooks/useScrollReset';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';

export interface ScreenPadding {
  top: number;
  bottom: number;
  horizontal: number;
  maxContentWidth: number | undefined;
}

/** Raw padding numbers for screens that manage their own scroll container (e.g. a FlatList). */
export function useScreenPadding(opts: { withTabBarInset?: boolean; withTopInset?: boolean } = {}): ScreenPadding {
  const { withTabBarInset = true, withTopInset = true } = opts;
  const insets = useSafeAreaInsets();
  const tabBarInset = useBuyerTabBarInset();
  const { gutter, maxContentWidth } = useResponsive();
  return {
    top: withTopInset ? insets.top : 0,
    bottom: withTabBarInset ? tabBarInset : insets.bottom,
    horizontal: gutter,
    maxContentWidth,
  };
}

interface ScreenProps extends ViewProps {
  /** Apply the screen side gutter to this container. Default true. */
  withGutter?: boolean;
  /** Apply the floating tab bar's occupied height as bottom padding. Default true. */
  withTabBarInset?: boolean;
  /** Apply the top safe-area inset. Default false — most screens have their own header that already does this. */
  withTopInset?: boolean;
  /** Center content and cap its width on tablet/web. Default true. */
  centerContent?: boolean;
}

export function Screen({
  style, children, withGutter = false, withTabBarInset = true, withTopInset = false, centerContent = true, ...rest
}: ScreenProps) {
  const padding = useScreenPadding({ withTabBarInset, withTopInset });
  const contentStyle: ViewStyle = {
    paddingTop: padding.top,
    paddingBottom: withTabBarInset ? padding.bottom : 0,
    paddingHorizontal: withGutter ? padding.horizontal : 0,
  };
  return (
    <View style={[styles.flex, style]} {...rest}>
      {centerContent && padding.maxContentWidth ? (
        <View style={[contentStyle, styles.centered, { maxWidth: padding.maxContentWidth }]}>{children}</View>
      ) : (
        <View style={[styles.flex, contentStyle]}>{children}</View>
      )}
    </View>
  );
}

interface ScreenScrollProps extends ScrollViewProps {
  withGutter?: boolean;
  withTabBarInset?: boolean;
  withTopInset?: boolean;
  centerContent?: boolean;
  /** Set false to opt this screen out of the scroll-to-top-on-focus behavior. */
  resetScrollOnFocus?: boolean;
  scrollRef?: React.RefObject<ScrollView>;
}

export const ScreenScroll = React.forwardRef<ScrollView, ScreenScrollProps>(function ScreenScroll(
  {
    style, contentContainerStyle, children,
    withGutter = true, withTabBarInset = true, withTopInset = false, centerContent = true,
    resetScrollOnFocus = true, scrollRef, ...rest
  },
  forwardedRef,
) {
  const padding = useScreenPadding({ withTabBarInset, withTopInset });
  const internalRef = useScrollReset<ScrollView>(resetScrollOnFocus);
  const setRefs = (node: ScrollView | null) => {
    (internalRef as React.MutableRefObject<ScrollView | null>).current = node;
    if (scrollRef) (scrollRef as React.MutableRefObject<ScrollView | null>).current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) (forwardedRef as React.MutableRefObject<ScrollView | null>).current = node;
  };

  const innerStyle: ViewStyle = {
    paddingHorizontal: withGutter ? padding.horizontal : 0,
    paddingBottom: padding.bottom,
    width: '100%',
    alignSelf: padding.maxContentWidth && centerContent ? 'center' : undefined,
    maxWidth: padding.maxContentWidth && centerContent ? padding.maxContentWidth : undefined,
  };

  return (
    <ScrollView
      ref={setRefs}
      style={[styles.flex, style]}
      contentContainerStyle={[{ paddingTop: padding.top }, innerStyle, contentContainerStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      {...rest}
    >
      {children}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { alignSelf: 'center', width: '100%' },
});
