import { describe, expect, it } from 'vitest';
import { CARD_SCRUB_STEP_PX, dragRangeForFullList, indexForDrag } from './studioCardCarousel';

describe('indexForDrag — px-to-index scrub mapping', () => {
  it('stays put at zero drag', () => {
    expect(indexForDrag(3, 0, 16)).toBe(3);
  });

  it('dragging left (negative translationX) advances forward through the list', () => {
    expect(indexForDrag(0, -CARD_SCRUB_STEP_PX, 16)).toBe(1);
    expect(indexForDrag(0, -CARD_SCRUB_STEP_PX * 5, 16)).toBe(5);
  });

  it('dragging right (positive translationX) goes backward', () => {
    expect(indexForDrag(5, CARD_SCRUB_STEP_PX, 16)).toBe(4);
    expect(indexForDrag(5, CARD_SCRUB_STEP_PX * 5, 16)).toBe(0);
  });

  it('rounds to the nearest step rather than always flooring/ceiling', () => {
    // Just past the halfway point of one step should round up to the next index.
    expect(indexForDrag(0, -(CARD_SCRUB_STEP_PX * 0.6), 16)).toBe(1);
    // Just short of halfway should still round down to the same index.
    expect(indexForDrag(0, -(CARD_SCRUB_STEP_PX * 0.4), 16)).toBe(0);
  });

  it('clamps at the start of the list — never negative', () => {
    expect(indexForDrag(0, CARD_SCRUB_STEP_PX * 100, 16)).toBe(0);
  });

  it('clamps at the end of the list — never past itemCount - 1', () => {
    expect(indexForDrag(15, -CARD_SCRUB_STEP_PX * 100, 16)).toBe(15);
  });

  it('reverses direction cleanly when the finger changes direction mid-drag (pure function of total translation, not path)', () => {
    // Drag forward 3 steps, then back 1 — net translation is what matters.
    const forward3 = -CARD_SCRUB_STEP_PX * 3;
    const backTo2 = forward3 + CARD_SCRUB_STEP_PX;
    expect(indexForDrag(0, forward3, 16)).toBe(3);
    expect(indexForDrag(0, backTo2, 16)).toBe(2);
  });

  it('a single full-width swipe on a 393pt screen covers the whole list in at most two passes', () => {
    // A believable full-width drag range: roughly the screen width, minus
    // some margin for where a thumb can realistically start/end a drag.
    const REALISTIC_DRAG_RANGE_PX = 360;
    for (const itemCount of [10, 16, 20, 24]) {
      const fullRange = dragRangeForFullList(itemCount);
      const swipesNeeded = Math.ceil(fullRange / REALISTIC_DRAG_RANGE_PX);
      expect(swipesNeeded, `itemCount=${itemCount} needed ${swipesNeeded} swipes`).toBeLessThanOrEqual(2);
    }
  });

  it('handles an empty list without throwing', () => {
    expect(indexForDrag(0, -1000, 0)).toBe(0);
  });
});
