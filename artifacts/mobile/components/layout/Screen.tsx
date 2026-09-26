import React, { forwardRef } from 'react';
import { ScrollView, type ScrollViewProps } from 'react-native';
import { useScrollReset } from '@/hooks/useScrollReset';

export type ScreenScrollProps = ScrollViewProps & {
  /** Scroll this screen's ScrollView back to the top every time its route
   * gains focus (mount, push-into, back-to, tab-switch-into). Defaults to
   * true — pass false to opt this screen out. */
  resetScrollOnFocus?: boolean;
};

/**
 * Drop-in replacement for a page-level `ScrollView`. Wires up
 * `useScrollReset` automatically so the screen always renders scrolled to
 * the top on focus, without every screen needing to manage the ref itself.
 */
export const ScreenScroll = forwardRef<ScrollView, ScreenScrollProps>(function ScreenScroll(
  { resetScrollOnFocus = true, ...props },
  forwardedRef,
) {
  const resetRef = useScrollReset<ScrollView>(resetScrollOnFocus);

  return (
    <ScrollView
      ref={(node) => {
        (resetRef as React.MutableRefObject<ScrollView | null>).current = node;
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else if (forwardedRef) (forwardedRef as React.MutableRefObject<ScrollView | null>).current = node;
      }}
      {...props}
    />
  );
});
