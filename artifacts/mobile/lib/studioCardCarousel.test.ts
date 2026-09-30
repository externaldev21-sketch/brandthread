import { describe, expect, it } from 'vitest';
import { SCRUB_PX_PER_CARD, dragRangeForFullList, indexForDrag } from './studioCardCarousel';

describe('indexForDrag — px-to-index scrub mapping', () => {
  it('stays put at zero drag', () => {
    expect(indexForDrag(3, 0, 16)).toBe(3);
  });

  it('dragging left (negative translationX) advances forward through the list', () => {
    expect(indexForDrag(0, -SCRUB_PX_PER_CARD, 16)).toBe(1);
    expect(indexForDrag(0, -SCRUB_PX_PER_CARD * 5, 16)).toBe(5);
  });

  it('dragging right (positive translationX) goes backward', () => {
    expect(indexForDrag(5, SCRUB_PX_PER_CARD, 16)).toBe(4);
    expect(indexForDrag(5, SCRUB_PX_PER_CARD * 5, 16)).toBe(0);
  });

  it('rounds to the nearest step rather than always flooring/ceiling', () => {
    // Just past the halfway point of one step should round up to the next index.
    expect(indexForDrag(0, -(SCRUB_PX_PER_CARD * 0.6), 16)).toBe(1);
    // Just short of halfway should still round down to the same index.
    expect(indexForDrag(0, -(SCRUB_PX_PER_CARD * 0.4), 16)).toBe(0);
  });

  it('clamps at the start of the list — never negative', () => {
    expect(indexForDrag(0, SCRUB_PX_PER_CARD * 100, 16)).toBe(0);
  });

  it('clamps at the end of the list — never past itemCount - 1', () => {
    expect(indexForDrag(15, -SCRUB_PX_PER_CARD * 100, 16)).toBe(15);
  });

  it('reverses direction cleanly when the finger changes direction mid-drag (pure function of total translation, not path)', () => {
    // Drag forward 3 steps, then back 1 — net translation is what matters.
    const forward3 = -SCRUB_PX_PER_CARD * 3;
    const backTo2 = forward3 + SCRUB_PX_PER_CARD;
    expect(indexForDrag(0, forward3, 16)).toBe(3);
    expect(indexForDrag(0, backTo2, 16)).toBe(2);
  });

  it('a single full-width swipe on a 393pt screen covers the whole list in at most two passes', () => {
    // A believable full-width drag range: roughly the screen width, minus
    // some margin for where a thumb can realistically start/end a drag.
    const REALISTIC_DRAG_RANGE_PX = 360;
    // Raised from 26 to 32 px/card per Dev's live-testing feedback ("a tiny
    // bit too fast"), which trims how much future list growth still fits in
    // two passes — 20 (comfortable headroom over today's real 16) is the
    // ceiling this now guarantees; 24 would need a third pass.
    for (const itemCount of [10, 16, 20]) {
      const fullRange = dragRangeForFullList(itemCount);
      const swipesNeeded = Math.ceil(fullRange / REALISTIC_DRAG_RANGE_PX);
      expect(swipesNeeded, `itemCount=${itemCount} needed ${swipesNeeded} swipes`).toBeLessThanOrEqual(2);
    }
  });

  it('handles an empty list without throwing', () => {
    expect(indexForDrag(0, -1000, 0)).toBe(0);
  });
});
