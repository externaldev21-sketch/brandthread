/**
 * Unit tests for lib/transformModel.ts — the Transform tool's handle-drag
 * geometry (computeHandlePositions, applyFreeformHandle, applyUniformHandle,
 * transformToQuad, deriveAffineFromQuad, defaultWarpMesh,
 * deriveAffineFromWarpMesh). This is the math that resize/rotate handles on
 * a selected canvas object actually run — covering it closes the gap in
 * Dev's P0 ask for "transform-math unit tests" alongside the Playwright
 * select→resize→rotate interaction test in e2e/design-canvas-select-resize.spec.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  computeHandlePositions, applyFreeformHandle, applyUniformHandle,
  transformToQuad, deriveAffineFromQuad, defaultWarpMesh, deriveAffineFromWarpMesh,
  snapValue, maybeSnap, TRANSFORM_MIN_DIM,
} from '../lib/transformModel';
import type { DesignTransform } from '../services/designTypes';

function makeTransform(overrides: Partial<DesignTransform> = {}): DesignTransform {
  return { x: 100, y: 50, width: 200, height: 100, rotation: 0, scaleX: 1, scaleY: 1, ...overrides };
}

describe('computeHandlePositions', () => {
  it('places all 8 handles at the correct logical corners/edges/midpoints', () => {
    const t = makeTransform();
    const handles = computeHandlePositions(t);
    const byKind = Object.fromEntries(handles.map(h => [h.kind, h]));

    expect(byKind.tl).toEqual({ kind: 'tl', lx: 100, ly: 50 });
    expect(byKind.tr).toEqual({ kind: 'tr', lx: 300, ly: 50 });
    expect(byKind.bl).toEqual({ kind: 'bl', lx: 100, ly: 150 });
    expect(byKind.br).toEqual({ kind: 'br', lx: 300, ly: 150 });
    expect(byKind.tc).toEqual({ kind: 'tc', lx: 200, ly: 50 });
    expect(byKind.bc).toEqual({ kind: 'bc', lx: 200, ly: 150 });
    expect(byKind.ml).toEqual({ kind: 'ml', lx: 100, ly: 100 });
    expect(byKind.mr).toEqual({ kind: 'mr', lx: 300, ly: 100 });
    expect(handles).toHaveLength(8);
  });

  it('has no rotate handle (rotate lives on the Select tool overlay, not Transform)', () => {
    const handles = computeHandlePositions(makeTransform());
    expect(handles.some(h => h.kind === 'rotate')).toBe(false);
  });
});

describe('applyFreeformHandle', () => {
  it('move: translates x/y by (ddx, ddy) without changing size', () => {
    const t = makeTransform();
    const out = applyFreeformHandle(t, 'move', 15, -20);
    expect(out).toEqual({ ...t, x: 115, y: 30 });
  });

  it('br (bottom-right): grows width/height by (ddx, ddy), x/y unchanged', () => {
    const t = makeTransform();
    const out = applyFreeformHandle(t, 'br', 30, 40);
    expect(out.x).toBe(t.x);
    expect(out.y).toBe(t.y);
    expect(out.width).toBe(230);
    expect(out.height).toBe(140);
  });

  it('tl (top-left): shrinks from the top-left, keeping the opposite (br) corner fixed', () => {
    const t = makeTransform(); // br corner at (300, 150)
    const out = applyFreeformHandle(t, 'tl', 20, 10);
    expect(out.width).toBe(180);
    expect(out.height).toBe(90);
    expect(out.x + out.width).toBeCloseTo(t.x + t.width, 10);  // br.x fixed
    expect(out.y + out.height).toBeCloseTo(t.y + t.height, 10); // br.y fixed
  });

  it('tr: resizes width from the right edge and height from the top, keeping bl fixed', () => {
    const t = makeTransform(); // bl corner at (100, 150)
    const out = applyFreeformHandle(t, 'tr', 25, 15);
    expect(out.width).toBe(225);
    expect(out.height).toBe(85);
    expect(out.x).toBe(t.x); // left edge unchanged
    expect(out.y + out.height).toBeCloseTo(t.y + t.height, 10); // bl.y fixed
  });

  it('bl: resizes width from the left edge and height from the bottom, keeping tr fixed', () => {
    const t = makeTransform(); // tr corner at (300, 50)
    const out = applyFreeformHandle(t, 'bl', -25, 20);
    expect(out.width).toBe(225);
    expect(out.height).toBe(120);
    expect(out.x + out.width).toBeCloseTo(t.x + t.width, 10); // tr.x fixed
    expect(out.y).toBe(t.y); // top edge unchanged
  });

  it('edge handles (tc/bc/ml/mr) only affect their own axis', () => {
    const t = makeTransform();
    expect(applyFreeformHandle(t, 'tc', 999, 10).width).toBe(t.width); // x-ignored
    expect(applyFreeformHandle(t, 'bc', 999, 10).width).toBe(t.width);
    expect(applyFreeformHandle(t, 'ml', 10, 999).height).toBe(t.height); // y-ignored
    expect(applyFreeformHandle(t, 'mr', 10, 999).height).toBe(t.height);
  });

  it('never shrinks a dimension below TRANSFORM_MIN_DIM, regardless of how far the handle is dragged', () => {
    const t = makeTransform({ width: 20, height: 20 });
    const out = applyFreeformHandle(t, 'br', -1000, -1000);
    expect(out.width).toBe(TRANSFORM_MIN_DIM);
    expect(out.height).toBe(TRANSFORM_MIN_DIM);
  });

  it('snaps the resulting position (x/y) to the grid when snap is enabled — dimensions (width/height) are deliberately NOT snapped, only the edges that move relative to a fixed opposite corner are', () => {
    const t = makeTransform({ x: 103, y: 51, width: 197, height: 99 });
    // tl moves x/y to keep the opposite (br) corner fixed — those are the
    // values that get snapped.
    const out = applyFreeformHandle(t, 'tl', 13, 7, true, 8);
    expect(out.x % 8).toBe(0);
    expect(out.y % 8).toBe(0);
    // Unsnapped control (snap disabled): x/y are NOT multiples of 8 in general.
    const unsnapped = applyFreeformHandle(t, 'tl', 13, 7, false, 8);
    expect(unsnapped.x % 8).not.toBe(0);
  });

  it('a handle kind with no freeform case (rotate, handled elsewhere) returns the original transform unchanged', () => {
    const t = makeTransform();
    expect(applyFreeformHandle(t, 'rotate', 10, 10)).toBe(t);
  });
});

describe('applyUniformHandle', () => {
  it('corner drag preserves the original aspect ratio', () => {
    const t = makeTransform({ width: 200, height: 100 }); // 2:1
    const out = applyUniformHandle(t, 'br', 50, 5); // dominant = 50 (|50|>|5|)
    expect(out.width / out.height).toBeCloseTo(t.width / t.height, 6);
  });

  it('uses the larger-magnitude axis of the drag as the dominant direction, and applies that magnitude to width directly (height then derives from the preserved ratio)', () => {
    const t = makeTransform({ width: 200, height: 100 }); // ratio 2:1
    const byX = applyUniformHandle(t, 'br', 40, 1);  // |ddx|>|ddy| -> dominant = 40
    const byY = applyUniformHandle(t, 'br', 1, 40);  // |ddy|>|ddx| -> dominant = 40
    // Both produce the same width, since the dominant magnitude (40) is the
    // same in both cases — only the SELECTION of which axis is dominant
    // differs, not the small non-dominant axis's own value.
    expect(byX.width).toBeCloseTo(240, 6);
    expect(byY.width).toBeCloseTo(240, 6);
    expect(byX.height).toBeCloseTo(120, 6); // 240 / ratio(2)
    expect(byY.height).toBeCloseTo(120, 6);

    // A larger ddy now genuinely changes the outcome vs. a small ddy.
    const smallDomY = applyUniformHandle(t, 'br', 1, 5);
    expect(smallDomY.width).toBeCloseTo(205, 6);
  });

  it('tl/bl use a negative sign so dragging the left corners outward still grows the box', () => {
    const t = makeTransform({ width: 200, height: 100 });
    const outTl = applyUniformHandle(t, 'tl', -40, -5); // dragging up-left = outward = grows
    expect(outTl.width).toBeGreaterThan(t.width);
    expect(outTl.height).toBeGreaterThan(t.height);
  });

  it('edge handles (tc/bc/ml/mr) fall back to freeform behaviour (no ratio constraint)', () => {
    const t = makeTransform({ width: 200, height: 100 });
    const out = applyUniformHandle(t, 'mr', 50, 0);
    expect(out).toEqual(applyFreeformHandle(t, 'mr', 50, 0));
  });

  it('move/rotate fall back to freeform behaviour', () => {
    const t = makeTransform();
    expect(applyUniformHandle(t, 'move', 5, 5)).toEqual(applyFreeformHandle(t, 'move', 5, 5));
  });

  it('never shrinks below TRANSFORM_MIN_DIM even for corner (ratio-preserving) drags', () => {
    const t = makeTransform({ width: 20, height: 20 });
    const out = applyUniformHandle(t, 'br', -1000, -1000);
    expect(out.width).toBeGreaterThanOrEqual(TRANSFORM_MIN_DIM);
    expect(out.height).toBeGreaterThanOrEqual(TRANSFORM_MIN_DIM);
  });
});

describe('transformToQuad', () => {
  it('builds the axis-aligned quad matching the transform rect exactly', () => {
    const t = makeTransform();
    const q = transformToQuad(t);
    expect(q.tl).toEqual({ x: 100, y: 50 });
    expect(q.tr).toEqual({ x: 300, y: 50 });
    expect(q.bl).toEqual({ x: 100, y: 150 });
    expect(q.br).toEqual({ x: 300, y: 150 });
  });
});

describe('deriveAffineFromQuad', () => {
  it('an untouched (identity) quad always derives to the identity matrix, regardless of layer position', () => {
    const t1 = makeTransform({ x: 0, y: 0 });
    const t2 = makeTransform({ x: 500, y: 900 });
    expect(deriveAffineFromQuad(t1, transformToQuad(t1))).toBe('matrix(1.0000,0.0000,0.0000,1.0000,0.0000,0.0000)');
    expect(deriveAffineFromQuad(t2, transformToQuad(t2))).toBe('matrix(1.0000,0.0000,0.0000,1.0000,0.0000,0.0000)');
  });

  it('moving a single corner changes the matrix (all 4 corners contribute)', () => {
    const t = makeTransform();
    const quad = transformToQuad(t);
    const identity = deriveAffineFromQuad(t, quad);
    const moved = { ...quad, tl: { x: quad.tl.x - 30, y: quad.tl.y - 10 } };
    const distorted = deriveAffineFromQuad(t, moved);
    expect(distorted).not.toBe(identity);
  });

  it('moving an edge handle (two adjacent corners) also changes the matrix', () => {
    const t = makeTransform();
    const quad = transformToQuad(t);
    const identity = deriveAffineFromQuad(t, quad);
    // Simulate dragging the top edge down 20px — both tl and tr move.
    const moved = {
      ...quad,
      tl: { x: quad.tl.x, y: quad.tl.y + 20 },
      tr: { x: quad.tr.x, y: quad.tr.y + 20 },
    };
    expect(deriveAffineFromQuad(t, moved)).not.toBe(identity);
  });

  it('a pure uniform scale of the quad (all corners scaled from center) produces a pure-scale matrix (no skew terms)', () => {
    const t = makeTransform({ x: 0, y: 0, width: 200, height: 100 });
    const cx = 100, cy = 50;
    const scale = 1.5;
    const scaled = {
      tl: { x: cx + (0 - cx) * scale,   y: cy + (0 - cy) * scale },
      tr: { x: cx + (200 - cx) * scale, y: cy + (0 - cy) * scale },
      bl: { x: cx + (0 - cx) * scale,   y: cy + (100 - cy) * scale },
      br: { x: cx + (200 - cx) * scale, y: cy + (100 - cy) * scale },
    };
    const matrix = deriveAffineFromQuad(t, scaled);
    const [a, b, c, d] = matrix.replace('matrix(', '').replace(')', '').split(',').map(Number);
    expect(a).toBeCloseTo(scale, 3);
    expect(d).toBeCloseTo(scale, 3);
    expect(b).toBeCloseTo(0, 3); // no skew
    expect(c).toBeCloseTo(0, 3);
  });
});

describe('defaultWarpMesh', () => {
  it('produces a 3x3 = 9 point mesh evenly covering the transform rect', () => {
    const t = makeTransform({ x: 0, y: 0, width: 200, height: 100 });
    const mesh = defaultWarpMesh(t);
    expect(mesh).toHaveLength(9);
    const corner = (row: number, col: number) => mesh.find(p => p.row === row && p.col === col)!;
    expect(corner(0, 0)).toMatchObject({ x: 0, y: 0 });
    expect(corner(0, 2)).toMatchObject({ x: 200, y: 0 });
    expect(corner(2, 0)).toMatchObject({ x: 0, y: 100 });
    expect(corner(2, 2)).toMatchObject({ x: 200, y: 100 });
    expect(corner(1, 1)).toMatchObject({ x: 100, y: 50 }); // dead center
  });
});

describe('deriveAffineFromWarpMesh', () => {
  it('an untouched (default) mesh derives to the identity matrix', () => {
    const t = makeTransform();
    const mesh = defaultWarpMesh(t);
    expect(deriveAffineFromWarpMesh(t, mesh)).toBe('matrix(1.0000,0.0000,0.0000,1.0000,0.0000,0.0000)');
  });

  it('dragging a single mesh point changes the derived matrix', () => {
    const t = makeTransform();
    const mesh = defaultWarpMesh(t);
    const identity = deriveAffineFromWarpMesh(t, mesh);
    const warped = mesh.map(p => (p.row === 1 && p.col === 1) ? { ...p, x: p.x + 40, y: p.y - 15 } : p);
    expect(deriveAffineFromWarpMesh(t, warped)).not.toBe(identity);
  });

  it('a pure uniform scale of all 9 mesh points produces a pure-scale matrix', () => {
    const t = makeTransform({ x: 0, y: 0, width: 200, height: 100 });
    const mesh = defaultWarpMesh(t);
    const cx = 100, cy = 50, scale = 2;
    const scaled = mesh.map(p => ({
      ...p,
      x: cx + (p.x - cx) * scale,
      y: cy + (p.y - cy) * scale,
    }));
    const matrix = deriveAffineFromWarpMesh(t, scaled);
    const [a, b, c, d] = matrix.replace('matrix(', '').replace(')', '').split(',').map(Number);
    expect(a).toBeCloseTo(scale, 3);
    expect(d).toBeCloseTo(scale, 3);
    expect(b).toBeCloseTo(0, 3);
    expect(c).toBeCloseTo(0, 3);
  });
});

describe('snapValue / maybeSnap', () => {
  it('snapValue rounds to the nearest multiple of grid', () => {
    expect(snapValue(101, 8)).toBe(104);
    expect(snapValue(99, 8)).toBe(96);
    expect(snapValue(100, 10)).toBe(100);
  });

  it('maybeSnap only snaps when enabled', () => {
    expect(maybeSnap(101, false, 8)).toBe(101);
    expect(maybeSnap(101, true, 8)).toBe(104);
  });
});
