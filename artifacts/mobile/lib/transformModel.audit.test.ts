import { describe, expect, it } from 'vitest';
import type { DesignTransform } from '../services/designTypes';
import { applyFreeformHandle, applyUniformHandle, type ExtHandleKind } from './transformModel';

const t = (x: number, y: number, width: number, height: number): DesignTransform =>
  ({ x, y, width, height, rotation: 0, scaleX: 1, scaleY: 1 } as DesignTransform);

const right = (r: DesignTransform) => r.x + r.width;
const bottom = (r: DesignTransform) => r.y + r.height;

describe('transform handles with snapping keep the opposite edge anchored (audit)', () => {
  const orig = t(100, 100, 200, 200); // right = 300, bottom = 300

  for (const handle of ['tl', 'ml', 'bl'] as ExtHandleKind[]) {
    it(`freeform ${handle}: right edge stays put while the left edge snaps`, () => {
      const r = applyFreeformHandle(orig, handle, -17, -13, true);
      expect(r.x % 8).toBe(0);
      expect(right(r)).toBe(300);
    });
  }

  for (const handle of ['tl', 'tc', 'tr'] as ExtHandleKind[]) {
    it(`freeform ${handle}: bottom edge stays put while the top edge snaps`, () => {
      const r = applyFreeformHandle(orig, handle, -17, -13, true);
      expect(r.y % 8).toBe(0);
      expect(bottom(r)).toBe(300);
    });
  }

  for (const handle of ['tl', 'tr', 'bl'] as ExtHandleKind[]) {
    it(`uniform ${handle}: the opposite corner stays put`, () => {
      const r = applyUniformHandle(orig, handle, -21, -5, true);
      if (handle === 'tl' || handle === 'bl') expect(right(r)).toBe(300);
      if (handle === 'tl' || handle === 'tr') expect(bottom(r)).toBe(300);
      if (handle === 'tr' || handle === 'bl') {
        // the untouched axis origin does not move
        if (handle === 'tr') expect(r.x).toBe(100);
        if (handle === 'bl') expect(r.y).toBe(100);
      }
    });
  }

  it('without snapping nothing changes', () => {
    expect(applyFreeformHandle(orig, 'tl', -17, -13, false)).toMatchObject({ x: 83, y: 87, width: 217, height: 213 });
    expect(applyUniformHandle(orig, 'tl', -17, -13, false)).toMatchObject({ x: 83, y: 83, width: 217, height: 217 });
  });

  it('never shrinks below the minimum size when the snapped edge would cross it', () => {
    const small = t(100, 100, 20, 20); // right = 120
    const r = applyFreeformHandle(small, 'ml', 3, 0, true); // left wants 103 → snaps to 104 → width 16
    expect(r.width).toBeGreaterThanOrEqual(16);
    expect(right(r)).toBe(120);
  });
});
