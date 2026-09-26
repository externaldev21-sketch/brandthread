/**
 * useScrollReset — every page-level scroll container (ScrollView, FlatList,
 * FlashList, SectionList) must land at the top whenever its route gains
 * focus: first mount, a stack push into it, going back to it, switching
 * tabs into it, or re-tapping its already-active tab. It must NOT reset when
 * an overlay/sheet/modal opens or closes on top of it, because that never
 * changes route focus — the underlying screen stays focused the whole time.
 *
 * Built on React Navigation's own focus/scroll-to-top primitives so both
 * cases (focus change, re-tap) are covered by the framework's own event
 * timing rather than a hand-rolled listener:
 *  - useFocusEffect fires as the screen becomes focused, before the user can
 *    interact with it, so the reset happens ahead of any visible scroll.
 *  - useScrollToTop wires up the "tap the active tab again" gesture that the
 *    floating tab bars already emit as a standard `tabPress` navigation event.
 *
 * Pass `enabled: false` to opt a screen out (e.g. the Threads video feed,
 * which intentionally keeps its scroll position when returning from an
 * overlay and only resets on a real tab-away-and-back focus change — which
 * this hook already limits itself to, so the feed uses the same hook as
 * everything else).
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
