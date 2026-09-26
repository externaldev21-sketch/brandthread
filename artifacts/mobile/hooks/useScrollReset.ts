/**
 * useScrollReset — every page-level scroll container (ScrollView, FlatList,
 * FlashList, SectionList) must land at the top whenever its route gains
 * focus: first mount, a stack push into it, going back to it, switching
 * tabs into it, or re-tapping its already-active tab.
 *
 * It must NOT reset for anything that isn't a real screen-level focus
 * change:
 *  - An overlay/sheet/modal opening or closing on top of it — that never
 *    changes route focus, the underlying screen stays focused the whole time.
 *  - Switching an IN-PAGE tab/segment (profile Posts/Tagged/Reposts/Saved,
 *    Messages Follows/Messages/Requests, Orders status chips, a search
 *    result tab, Discover's sections, …). That's local component state, not
 *    navigation, and the user's scroll position within a segment must
 *    survive switching away and back to it in the same visit.
 *
 * `useFocusEffect` only re-runs its callback on a real focus transition —
 * not on an ordinary re-render — as long as the *same hook instance* stays
 * subscribed. That's the entire trick to satisfying both rules at once:
 *
 *   ✅ CORRECT — call the hook ONCE at the screen's top level, and attach
 *   the one ref it returns to whichever scrollable is currently rendered:
 *
 *     const listRef = useScrollReset<FlatList>();
 *     return activeTab === 'posts'
 *       ? <FlatList ref={listRef} data={posts} .../>
 *       : <FlatList ref={listRef} data={tagged} .../>;
 *
 *   Switching `activeTab` swaps which list the ref points at, but the hook
 *   itself never re-subscribes, so no reset fires. app/(buyer)/inbox.tsx and
 *   app/(tabs)/orders.tsx already follow this pattern for their in-page tabs
 *   and status filters.
 *
 *   ❌ WRONG — calling this hook again inside per-tab content that mounts
 *   and unmounts as the tab changes:
 *
 *     function PostsTab() { const ref = useScrollReset<FlatList>(); ... }
 *     function TaggedTab() { const ref = useScrollReset<FlatList>(); ... }
 *     return activeTab === 'posts' ? <PostsTab /> : <TaggedTab />;
 *
 *   Each mount is a *new* hook instance, and to React Navigation a brand-new
 *   subscription that appears while the screen is already focused is
 *   indistinguishable from a real focus transition — so it fires anyway and
 *   the tab appears to "reset on every switch". There is no reliable way to
 *   tell these two cases apart from inside a freshly-mounted child with no
 *   shared state, which is exactly why the single-hook-instance pattern
 *   above is required, not just preferred.
 */
import { useCallback, useRef } from 'react';
// Routed through expo-router (which re-exports both from @react-navigation/native)
// rather than importing @react-navigation/native directly, matching every other
// screen in this app that uses useFocusEffect via expo-router.
import { useFocusEffect, useScrollToTop } from 'expo-router';
import type { FlatList, ScrollView, SectionList } from 'react-native';

type Resettable = ScrollView | FlatList<any> | SectionList<any> | { scrollTo?: any; scrollToOffset?: any; scrollToLocation?: any };

export function useScrollReset<T extends Resettable = ScrollView>(enabled = true) {
  const ref = useRef<T>(null);

  // "Re-tap the active tab" — no-op when the screen isn't inside a tab navigator.
  useScrollToTop(enabled ? (ref as any) : { current: null });

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      const node = ref.current as any;
      if (!node) return;
      if (typeof node.scrollToOffset === 'function') {
        node.scrollToOffset({ offset: 0, animated: false });
      } else if (typeof node.scrollToLocation === 'function') {
        node.scrollToLocation({ itemIndex: 0, sectionIndex: 0, viewOffset: 0, animated: false });
      } else if (typeof node.scrollTo === 'function') {
        node.scrollTo({ x: 0, y: 0, animated: false });
      }
      // Intentionally no cleanup: we only act when gaining focus, never on blur.
    }, [enabled])
  );

  return ref;
}
