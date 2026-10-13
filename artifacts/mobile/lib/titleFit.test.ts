import { describe, expect, it } from 'vitest';
import { TITLE_MIN_SCALE, titleFitScale } from './titleFit';

describe('titleFitScale', () => {
  it('keeps titles that fit at full size', () => {
    expect(titleFitScale(200, 120)).toBe(1);
    expect(titleFitScale(200, 200)).toBe(1);
  });

  it('shrinks a slightly-too-long title just enough to fit', () => {
    const scale = titleFitScale(180, 200);
    expect(scale).toBeLessThan(0.9);
    expect(scale * 200).toBeLessThanOrEqual(179);
    expect(scale).toBeGreaterThan(0.89);
  });

  it('never shrinks below the floor (the title then ellipsizes)', () => {
    expect(titleFitScale(80, 300)).toBe(TITLE_MIN_SCALE);
  });

  it('ignores unmeasured layouts', () => {
    expect(titleFitScale(0, 300)).toBe(1);
    expect(titleFitScale(200, 0)).toBe(1);
  });
});
