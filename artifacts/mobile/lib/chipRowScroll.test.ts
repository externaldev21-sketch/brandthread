import { describe, expect, it } from 'vitest';
import { chipCenterOffset } from './chipRowScroll';

describe('chipCenterOffset', () => {
  it('returns 0 when the row fits on screen', () => {
    expect(chipCenterOffset({ x: 200, width: 60 }, 393, 380)).toBe(0);
  });

  it('centres a chip in the middle of a long row', () => {
    // chip centre at 530 → offset 530 - 196.5 = 333.5 → 334
    expect(chipCenterOffset({ x: 500, width: 60 }, 393, 1200)).toBe(334);
  });

  it('never scrolls before the start (first chip keeps its 16pt inset)', () => {
    expect(chipCenterOffset({ x: 16, width: 60 }, 393, 1200)).toBe(0);
  });

  it('clamps to the end so the last chip sits fully in view', () => {
    // content 1200, viewport 393 → max 807
    expect(chipCenterOffset({ x: 1120, width: 64 }, 393, 1200)).toBe(807);
  });

  it('handles an unmeasured viewport', () => {
    expect(chipCenterOffset({ x: 500, width: 60 }, 0, 1200)).toBe(0);
  });
});
