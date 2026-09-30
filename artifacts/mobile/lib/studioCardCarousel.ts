/**
 * Studio card carousel — pure scrub math (RN-free, safe to unit-test with
 * Vitest and safe to call from a Reanimated worklet).
 *
 * The seller Studio sheet (components/SellerStudioRadialMenu.tsx) shows one
 * destination at a time as a full "card"; dragging a finger horizontally
 * scrubs through the list — every CARD_SCRUB_STEP_PX of horizontal movement
 * advances exactly one card, in either direction, clamped at both ends (this
 * is a bounded list, not an infinite wheel).
 */

/** One card step per this many px of horizontal drag. Chosen so a single
 *  full-width swipe (~360px of usable drag range on a 393pt-wide phone)
 *  comfortably covers the whole menu in one pass, and two passes for any
 *  realistic future growth of the list — see indexForDrag's own doc comment
 *  for the exact math this satisfies. */
export const CARD_SCRUB_STEP_PX = 26;

/**
 * Maps a drag's cumulative horizontal translation to the resulting card
 * index. `startIndex` is the index the gesture began from (captured once,
 * at gesture start — NOT re-read per frame, so the mapping is a pure
 * function of total drag distance from the start, not of instantaneous
 * finger position). Dragging LEFT (negative translationX) advances forward
 * through the list, matching a photo gallery's "swipe left for next"
 * convention. Clamped to [0, itemCount - 1] — this list doesn't wrap.
 *
 * Marked as a worklet so it can be called directly from a Reanimated
 * gesture callback on the UI thread; the `'worklet'` directive is an inert
 * string literal outside Reanimated's Babel plugin, so this is equally
 * fine to import and call from plain Node (Vitest) or from RN.
 */
export function indexForDrag(
  startIndex: number,
  translationX: number,
  itemCount: number,
  stepPx: number = CARD_SCRUB_STEP_PX,
): number {
  'worklet';
  if (itemCount <= 0) return 0;
  const delta = Math.round(-translationX / stepPx);
  const next = startIndex + delta;
  return Math.max(0, Math.min(itemCount - 1, next));
}

/** How far (in px) a full pass through the whole list takes at the current
 *  step size — exported so a test (or a future tuning pass) can assert a
 *  393pt-wide screen's realistic drag range actually covers `itemCount`
 *  cards in at most `maxSwipes` swipes, instead of hard-coding the math
 *  twice. */
export function dragRangeForFullList(itemCount: number, stepPx: number = CARD_SCRUB_STEP_PX): number {
  return Math.max(0, itemCount - 1) * stepPx;
}
