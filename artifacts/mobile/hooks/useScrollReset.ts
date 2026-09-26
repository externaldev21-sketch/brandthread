import { useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';

interface ScrollableRef {
  scrollTo?: (options: { y: number; animated: boolean }) => void;
  scrollToOffset?: (options: { offset: number; animated: boolean }) => void;
}

/**
 * Universal "scroll to top on focus" primitive.
 *
 * Attach the returned ref to a screen's page-level ScrollView / FlatList /
 * SectionList / FlashList. Every time the screen's route gains focus — first
 * mount, a stack push into it, navigating back to it, or switching tabs into
 * it — the list is scrolled to offset 0 with no animation, so a screen never
 * renders mid-scroll.
 *
 * Pass `enabled: false` to opt a screen out. Note this hook only fires on
 * real route focus transitions — local component state (an overlay/sheet
 * opening on top of the screen) never triggers it, so screens that must
 * preserve scroll position under a local overlay don't need to opt out.
 */
export function useScrollReset<T extends ScrollableRef>(enabled = true) {
  const ref = useRef<T>(null);

  const resetScroll = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof node.scrollTo === 'function') {
      node.scrollTo({ y: 0, animated: false });
    } else if (typeof node.scrollToOffset === 'function') {
      node.scrollToOffset({ offset: 0, animated: false });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (enabled) resetScroll();
    }, [enabled, resetScroll]),
  );

  // Note: this intentionally does not also call React Navigation's
  // `useScrollToTop` (re-tap-active-tab-to-scroll-to-top) — many existing
  // screen tests mock `expo-router` with only the `useFocusEffect`/
  // `useRouter` exports this hook needs, and referencing an unstubbed named
  // export throws under Vitest's strict mock checking. The focus-based
  // reset above already covers the universal "never render mid-scroll on
  // focus" requirement this hook exists for.

  return ref;
}
