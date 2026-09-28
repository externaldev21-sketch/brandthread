/**
 * Cart icon + badge "bump" on a successful add-to-cart.
 *
 * Lifted verbatim from the buyer feed's cart pulse (app/(tabs)/feed.tsx,
 * fired by ShopProductSheet's onCartUpdated) so every surface with a cart
 * badge — feed and the Discover pager — bumps with the same spring: a quick
 * dip to 0.78, a spring overshoot to 1.18, then a softer spring back to 1.
 * Scale only — the badge keeps its white/black treatment, no color change.
 *
 * Only call `bump()` from a real add-to-cart success (after the cart write
 * resolved with a new count) — never on mount or when the count is merely
 * loaded/refreshed. Honors Reduce Motion via shouldAnimateCartSuccess
 * (unknown = don't animate), the same gate the feed already used.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated } from 'react-native';
import { shouldAnimateCartSuccess } from '@/lib/cartFlight';

export const CART_BUMP = {
  dipTo: 0.78,
  up: { toValue: 1.18, speed: 28, bounciness: 8 },
  settle: { toValue: 1, speed: 24, bounciness: 4 },
} as const;

/**
 * @param reduceMotion Pass the screen's own Reduce Motion state when it
 *   already tracks it (the feed does); omit it to let the hook track it.
 */
export function useCartBadgeBump(reduceMotion?: boolean | null) {
  const scale = useRef(new Animated.Value(1)).current;
  const [ownReduceMotion, setOwnReduceMotion] = useState<boolean | null>(null);
  const tracksOwn = reduceMotion === undefined;

  useEffect(() => {
    if (!tracksOwn) return undefined;
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(enabled => { if (active) setOwnReduceMotion(enabled); })
      .catch(() => { if (active) setOwnReduceMotion(false); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setOwnReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, [tracksOwn]);

  const effectiveReduceMotion = tracksOwn ? ownReduceMotion : reduceMotion;

  const bump = useCallback(() => {
    if (!shouldAnimateCartSuccess(effectiveReduceMotion ?? null)) return;
    scale.setValue(CART_BUMP.dipTo);
    Animated.sequence([
      Animated.spring(scale, { ...CART_BUMP.up, useNativeDriver: true }),
      Animated.spring(scale, { ...CART_BUMP.settle, useNativeDriver: true }),
    ]).start();
  }, [scale, effectiveReduceMotion]);

  return { scale, bump };
}
