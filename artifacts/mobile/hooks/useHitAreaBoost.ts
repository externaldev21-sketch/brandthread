/**
 * useHitAreaBoost — pads a visually-small control's TOUCH area up to the
 * 44x44pt minimum comfortable target without changing its rendered size.
 *
 * Why not just `hitSlop`? `hitSlop` genuinely enlarges the tap zone on
 * native iOS/Android, but react-native-web's `Pressable`/`TouchableOpacity`
 * do not implement it at all on web — it's silently dropped, so it has zero
 * effect on the control's actual clickable area (or its measured
 * `getBoundingClientRect`) in the web build this app's audit tooling runs
 * against. `hitSlop` is still harmless to set alongside this hook (it helps
 * natively), but it cannot be the *only* fix.
 *
 * This hook instead grows the control's real border-box (which
 * `getBoundingClientRect` — and a sighted user's actual tap target, on any
 * platform — measures) via `minWidth`/`minHeight`, then cancels that growth
 * out of the surrounding layout with an equal, opposite `margin`. The net
 * effect: the element occupies exactly the same flow space it always did
 * (siblings don't shift, nothing reflows), but its own hit-testable box is
 * now at least 44x44 — invisible space around unchanged, centered visual
 * content. `minWidth`/`minHeight` (not `padding`) deliberately, so this
 * composes safely with whatever padding a call site's own style already
 * sets, instead of colliding with a `paddingHorizontal`/`paddingVertical`
 * shorthand already in that style (a later `paddingLeft`/`paddingRight` in
 * the same flattened style array replaces, rather than adds to, an earlier
 * shorthand — this sidesteps that entirely). Since there's no background or
 * border painted out to the new edge on any of this hook's call sites, the
 * extra invisible space is never visible. Only apply this to an element
 * with no explicit fixed `width`/`height` of its own — those take priority
 * over `minWidth`/`minHeight` and would suppress the boost.
 *
 * Usage:
 *   const { boostStyle, onLayout } = useHitAreaBoost();
 *   <TouchableOpacity style={[styles.btn, boostStyle]} onLayout={onLayout}>
 *
 * Measures once via `onLayout` (the pre-boost, content-driven size) and
 * never re-measures after applying the boost — re-measuring the *boosted*
 * box would read its own padding back as more "natural" size and compound
 * on every render.
 */
import { useCallback, useState } from 'react';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';

export const HIT_AREA_MIN = 44;

export interface HitAreaBoost {
  boostStyle: StyleProp<ViewStyle>;
  onLayout: (e: LayoutChangeEvent) => void;
}

export function useHitAreaBoost(min: number = HIT_AREA_MIN): HitAreaBoost {
  const [boost, setBoost] = useState<ViewStyle | undefined>(undefined);
  const [measured, setMeasured] = useState(false);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    if (measured) return; // never re-measure a box we've already boosted
    setMeasured(true);
    const { width, height } = e.nativeEvent.layout;
    const padX = Math.max(0, (min - width) / 2);
    const padY = Math.max(0, (min - height) / 2);
    if (padX === 0 && padY === 0) return;
    setBoost({
      minWidth: width + padX * 2, minHeight: height + padY * 2,
      marginLeft: -padX, marginRight: -padX, marginTop: -padY, marginBottom: -padY,
      // Centers the unchanged-size content within the now-bigger box on
      // both axes — without this, the box grows from a fixed corner/edge
      // (flex defaults to cross-axis stretch / main-axis flex-start) and
      // the visually-centered content would shift instead of staying put.
      alignItems: 'center',
      justifyContent: 'center',
    });
  }, [measured, min]);

  return { boostStyle: boost, onLayout };
}
