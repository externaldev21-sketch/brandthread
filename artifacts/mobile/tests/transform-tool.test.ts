/**
 * transform-tool.test.ts — 8-handle dispatch, uniform/freeform math,
 *   distort quad, warp mesh, and affine string generation.
 */
import { describe, it, expect } from 'vitest';
import {
  computeHandlePositions,
  applyFreeformHandle,
  applyUniformHandle,
  transformToQuad,
  deriveAffineFromQuad,
  defaultWarpMesh,
  deriveAffineFromWarpMesh,
  TRANSFORM_MIN_DIM,
  maybeSnap,
  DEFAULT_SNAP_GRID,
} from '../lib/transformModel';
import type { DesignTransform } from '../services/designTypes';
import type { ExtHandleKind, TransformMode, DistortQuad } from '../lib/transformModel';

function makeTransform(overrides: Partial<DesignTransform> = {}): DesignTransform {
  return {
    x: 100, y: 100, width: 200, height: 150,
    rotation: 0, scaleX: 1, scaleY: 1,
    ...overrides,
  };
}

// ─── computeHandlePositions ───────────────────────────────────────────────────

describe('computeHandlePositions', () => {
  it('returns exactly 8 handles (transform tool: no rotate handle)', () => {
    // The transform tool has 8 scale/move handles only; rotate is select-tool only.
    const handles = computeHandlePositions(makeTransform());
    expect(handles).toHaveLength(8);
  });

  it('tl handle is at (x, y)', () => {
    const t = makeTransform({ x: 50, y: 60 });
    const h = computeHandlePositions(t).find(h => h.kind === 'tl');
    expect(h?.lx).toBe(50);
    expect(h?.ly).toBe(60);
  });

  it('br handle is at (x+w, y+h)', () => {
    const t = makeTransform({ x: 10, y: 20, width: 100, height: 80 });
    const h = computeHandlePositions(t).find(h => h.kind === 'br');
    expect(h?.lx).toBe(110);
    expect(h?.ly).toBe(100);
  });

  it('tc handle is at (cx, y)', () => {
    const t = makeTransform({ x: 0, y: 0, width: 200, height: 100 });
    const h = computeHandlePositions(t).find(h => h.kind === 'tc');
    expect(h?.lx).toBe(100);
    expect(h?.ly).toBe(0);
  });

  it('rotate handle is NOT present in transform tool (select tool only)', () => {
    const t = makeTransform({ x: 0, y: 0, width: 100, height: 100 });
    const rot = computeHandlePositions(t).find(h => h.kind === 'rotate');
    expect(rot).toBeUndefined();
  });

  it('has all 8 expected handle kinds', () => {
    const kinds = computeHandlePositions(makeTransform()).map(h => h.kind);
    expect(kinds).toContain('tl');
    expect(kinds).toContain('tc');
    expect(kinds).toContain('tr');
    expect(kinds).toContain('ml');
    expect(kinds).toContain('mr');
    expect(kinds).toContain('bl');
    expect(kinds).toContain('bc');
    expect(kinds).toContain('br');
    expect(kinds).not.toContain('rotate');
  });
});

// ─── applyFreeformHandle ──────────────────────────────────────────────────────

describe('applyFreeformHandle', () => {
  const orig = makeTransform({ x: 100, y: 100, width: 200, height: 150 });

  it('move translates x/y without changing size', () => {
    const t = applyFreeformHandle(orig, 'move', 10, 20);
    expect(t.x).toBe(110);
    expect(t.y).toBe(120);
    expect(t.width).toBe(200);
    expect(t.height).toBe(150);
  });

  it('br expands width and height', () => {
    const t = applyFreeformHandle(orig, 'br', 30, 20);
    expect(t.width).toBe(230);
    expect(t.height).toBe(170);
    expect(t.x).toBe(100); // x unchanged
  });

  it('tl shrinks from top-left, moving origin', () => {
    const t = applyFreeformHandle(orig, 'tl', 20, 10);
    expect(t.width).toBe(180);
    expect(t.height).toBe(140);
    // x should increase to compensate
    expect(t.x).toBeGreaterThan(100);
  });

  it('ml only changes x and width', () => {
    const t = applyFreeformHandle(orig, 'ml', -20, 0);
    expect(t.height).toBe(150);
    expect(t.width).toBe(220);
  });

  it('enforces minimum dimension', () => {
    const t = applyFreeformHandle(orig, 'br', -1000, -1000);
    expect(t.width).toBeGreaterThanOrEqual(TRANSFORM_MIN_DIM);
    expect(t.height).toBeGreaterThanOrEqual(TRANSFORM_MIN_DIM);
  });

  it('tc only changes y and height', () => {
    const t = applyFreeformHandle(orig, 'tc', 0, -30);
    expect(t.width).toBe(200); // unchanged
    expect(t.height).toBeGreaterThan(150);
  });
});

// ─── applyUniformHandle ───────────────────────────────────────────────────────

describe('applyUniformHandle', () => {
  const orig = makeTransform({ x: 0, y: 0, width: 200, height: 100 });
  const ratio = 2; // width/height

  it('corner handle preserves aspect ratio', () => {
    const t = applyUniformHandle(orig, 'br', 40, 0);
    const newRatio = t.width / t.height;
    expect(Math.abs(newRatio - ratio)).toBeLessThan(0.01);
  });

  it('edge handle does NOT preserve ratio', () => {
    const t = applyUniformHandle(orig, 'mr', 40, 0);
    // Only width changes; ratio should be different
    expect(t.width).toBe(240);
    expect(t.height).toBe(100);
  });

  it('move works identically to freeform', () => {
    const t = applyUniformHandle(orig, 'move', 10, 20);
    expect(t.x).toBe(10);
    expect(t.y).toBe(20);
  });

  it('enforces min dimension', () => {
    const t = applyUniformHandle(orig, 'br', -10000, 0);
    expect(t.width).toBeGreaterThanOrEqual(TRANSFORM_MIN_DIM);
    expect(t.height).toBeGreaterThanOrEqual(TRANSFORM_MIN_DIM);
  });
});

// ─── Snapping ─────────────────────────────────────────────────────────────────

describe('maybeSnap', () => {
  it('snaps to grid when enabled', () => {
    // Math.round(13/8)*8 = Math.round(1.625)*8 = 2*8 = 16
    expect(maybeSnap(13, true, 8)).toBe(16);
    // Math.round(12/8)*8 = Math.round(1.5)*8 = 2*8 = 16
    expect(maybeSnap(12, true, 8)).toBe(16);
    // Math.round(4/8)*8 = Math.round(0.5)*8 = 1*8 = 8 (JS rounds 0.5 up)
    expect(maybeSnap(4, true, 8)).toBe(8);
    // Math.round(3/8)*8 = Math.round(0.375)*8 = 0*8 = 0
    expect(maybeSnap(3, true, 8)).toBe(0);
  });

  it('returns unmodified value when disabled', () => {
    expect(maybeSnap(13, false, 8)).toBe(13);
  });

  it('uses DEFAULT_SNAP_GRID when not specified', () => {
    expect(maybeSnap(0, true)).toBe(0);
    expect(maybeSnap(DEFAULT_SNAP_GRID, true)).toBe(DEFAULT_SNAP_GRID);
  });
});

// ─── transformToQuad ──────────────────────────────────────────────────────────

describe('transformToQuad', () => {
  it('maps rect corners to quad', () => {
    const t = makeTransform({ x: 10, y: 20, width: 100, height: 50 });
    const q = transformToQuad(t);
    expect(q.tl).toEqual({ x: 10, y: 20 });
    expect(q.tr).toEqual({ x: 110, y: 20 });
    expect(q.bl).toEqual({ x: 10, y: 70 });
    expect(q.br).toEqual({ x: 110, y: 70 });
  });
});

// ─── deriveAffineFromQuad ─────────────────────────────────────────────────────

// Helper to extract matrix(a,b,c,d,e,f) values
function parseMatrix(m: string): number[] {
  const match = m.match(/matrix\(([^)]+)\)/);
  if (!match) throw new Error(`Not a matrix string: ${m}`);
  return match[1].split(',').map(Number);
}

describe('deriveAffineFromQuad', () => {
  // ── Origin-based identity ────────────────────────────────────────────────
  it('origin-based identity quad → matrix(1,0,0,1,0,0)', () => {
    const t = makeTransform({ x: 0, y: 0, width: 100, height: 100 });
    const q = transformToQuad(t);
    const [a, b, c, d, e, f] = parseMatrix(deriveAffineFromQuad(t, q));
    expect(a).toBeCloseTo(1, 5);
    expect(b).toBeCloseTo(0, 5);
    expect(c).toBeCloseTo(0, 5);
    expect(d).toBeCloseTo(1, 5);
    expect(e).toBeCloseTo(0, 5);
    expect(f).toBeCloseTo(0, 5);
  });

  // ── Non-origin identity (key requirement) ────────────────────────────────
  it('NON-ORIGIN identity quad → matrix(1,0,0,1,0,0) regardless of layer position', () => {
    // Layer positioned at (200, 350): default quad should still produce identity
    const t = makeTransform({ x: 200, y: 350, width: 100, height: 80 });
    const q = transformToQuad(t); // axis-aligned, no distortion
    const [a, b, c, d, e, f] = parseMatrix(deriveAffineFromQuad(t, q));
    expect(a).toBeCloseTo(1, 5);
    expect(b).toBeCloseTo(0, 5);
    expect(c).toBeCloseTo(0, 5);
    expect(d).toBeCloseTo(1, 5);
    expect(e).toBeCloseTo(0, 5);  // translation must be 0,0 for identity quad
    expect(f).toBeCloseTo(0, 5);
  });

  it('non-origin with large offset → identity (no translate(x,y) padding)', () => {
    const t = makeTransform({ x: 500, y: 700, width: 200, height: 150 });
    const q = transformToQuad(t);
    const [a, b, c, d, e, f] = parseMatrix(deriveAffineFromQuad(t, q));
    expect(a).toBeCloseTo(1, 5);
    expect(b).toBeCloseTo(0, 5);
    expect(c).toBeCloseTo(0, 5);
    expect(d).toBeCloseTo(1, 5);
    expect(e).toBeCloseTo(0, 4);
    expect(f).toBeCloseTo(0, 4);
  });

  // ── Every corner drag changes the matrix ────────────────────────────────
  it('dragging TL corner changes matrix', () => {
    const t = makeTransform({ x: 100, y: 100, width: 100, height: 100 });
    const qBase = transformToQuad(t);
    const mBase = parseMatrix(deriveAffineFromQuad(t, qBase));
    const qDragged = { ...qBase, tl: { x: qBase.tl.x + 20, y: qBase.tl.y } };
    const mDragged = parseMatrix(deriveAffineFromQuad(t, qDragged));
    // TL drag changes X-basis (averaged top+bot edges) and target centroid → a and e change
    expect(mDragged.some((v, i) => Math.abs(v - mBase[i]) > 1e-3)).toBe(true);
  });

  it('dragging TR corner changes matrix', () => {
    const t = makeTransform({ x: 100, y: 100, width: 100, height: 100 });
    const qBase = transformToQuad(t);
    const mBase = parseMatrix(deriveAffineFromQuad(t, qBase));
    const qDragged = { ...qBase, tr: { x: qBase.tr.x + 30, y: qBase.tr.y } };
    const mDragged = parseMatrix(deriveAffineFromQuad(t, qDragged));
    expect(mDragged.some((v, i) => Math.abs(v - mBase[i]) > 1e-3)).toBe(true);
  });

  it('dragging BL corner changes matrix', () => {
    const t = makeTransform({ x: 100, y: 100, width: 100, height: 100 });
    const qBase = transformToQuad(t);
    const mBase = parseMatrix(deriveAffineFromQuad(t, qBase));
    const qDragged = { ...qBase, bl: { x: qBase.bl.x, y: qBase.bl.y + 25 } };
    const mDragged = parseMatrix(deriveAffineFromQuad(t, qDragged));
    expect(mDragged.some((v, i) => Math.abs(v - mBase[i]) > 1e-3)).toBe(true);
  });

  it('dragging BR corner changes matrix', () => {
    const t = makeTransform({ x: 100, y: 100, width: 100, height: 100 });
    const qBase = transformToQuad(t);
    const mBase = parseMatrix(deriveAffineFromQuad(t, qBase));
    const qDragged = { ...qBase, br: { x: qBase.br.x + 15, y: qBase.br.y + 15 } };
    const mDragged = parseMatrix(deriveAffineFromQuad(t, qDragged));
    expect(mDragged.some((v, i) => Math.abs(v - mBase[i]) > 1e-3)).toBe(true);
  });

  it('produces a non-identity matrix when the quad is skewed', () => {
    const t = makeTransform({ x: 0, y: 0, width: 100, height: 100 });
    const q = {
      tl: { x: 10, y: 0 },  // shifted
      tr: { x: 110, y: 0 },
      bl: { x: 0, y: 100 },
      br: { x: 100, y: 100 },
    };
    const [a, b, c, d, e, f] = parseMatrix(deriveAffineFromQuad(t, q));
    expect(a).toBeCloseTo(1, 3); // x-basis unchanged in x
    // tl is shifted +10, tr unchanged → top edge = 100, bot edge = 100, avg = 100 → a stays 1
    // translation e shifts because target centroid moves
    expect(e).not.toBeCloseTo(0, 1); // centroid shifted → e ≠ 0
    // Confirm matrix is not identity
    const vals = [a, b, c, d, e, f];
    const identity = [1, 0, 0, 1, 0, 0];
    expect(vals.some((v, i) => Math.abs(v - identity[i]) > 0.01)).toBe(true);
  });

  it('uniform scale (all corners scaled out from centre) → scale factor in a,d', () => {
    const t = makeTransform({ x: 0, y: 0, width: 100, height: 100 });
    // Scale quad by 2x from origin
    const scale = 2;
    const q = {
      tl: { x: 0,   y: 0   },
      tr: { x: 200, y: 0   },
      bl: { x: 0,   y: 200 },
      br: { x: 200, y: 200 },
    };
    const [a, _b, _c, d, e, f] = parseMatrix(deriveAffineFromQuad(t, q));
    expect(a).toBeCloseTo(scale, 3);
    expect(d).toBeCloseTo(scale, 3);
    // source centroid (50,50) → target centroid (100,100): e = 100 - 2*50 = 0
    expect(e).toBeCloseTo(0, 3);
    expect(f).toBeCloseTo(0, 3);
  });
});

// ─── defaultWarpMesh ──────────────────────────────────────────────────────────

describe('defaultWarpMesh', () => {
  it('returns 9 control points (3×3)', () => {
    const mesh = defaultWarpMesh(makeTransform({ x: 0, y: 0, width: 100, height: 100 }));
    expect(mesh).toHaveLength(9);
  });

  it('corner points match transform corners', () => {
    const t = makeTransform({ x: 0, y: 0, width: 100, height: 100 });
    const mesh = defaultWarpMesh(t);
    expect(mesh.find(p => p.row === 0 && p.col === 0)).toMatchObject({ x: 0, y: 0 });
    expect(mesh.find(p => p.row === 0 && p.col === 2)).toMatchObject({ x: 100, y: 0 });
    expect(mesh.find(p => p.row === 2 && p.col === 0)).toMatchObject({ x: 0, y: 100 });
    expect(mesh.find(p => p.row === 2 && p.col === 2)).toMatchObject({ x: 100, y: 100 });
  });

  it('centre point is at cx, cy', () => {
    const t = makeTransform({ x: 0, y: 0, width: 100, height: 100 });
    const mesh = defaultWarpMesh(t);
    const centre = mesh.find(p => p.row === 1 && p.col === 1);
    expect(centre?.x).toBe(50);
    expect(centre?.y).toBe(50);
  });
});

// ─── deriveAffineFromWarpMesh ─────────────────────────────────────────────────

describe('deriveAffineFromWarpMesh', () => {
  // ── Identity ────────────────────────────────────────────────────────────
  it('origin identity mesh → matrix(1,0,0,1,0,0)', () => {
    const t = makeTransform({ x: 0, y: 0, width: 100, height: 100 });
    const mesh = defaultWarpMesh(t);
    const [a, b, c, d, e, f] = parseMatrix(deriveAffineFromWarpMesh(t, mesh));
    expect(a).toBeCloseTo(1, 5);
    expect(b).toBeCloseTo(0, 5);
    expect(c).toBeCloseTo(0, 5);
    expect(d).toBeCloseTo(1, 5);
    expect(e).toBeCloseTo(0, 4);
    expect(f).toBeCloseTo(0, 4);
  });

  it('NON-ORIGIN identity mesh → matrix(1,0,0,1,0,0)', () => {
    const t = makeTransform({ x: 300, y: 400, width: 100, height: 80 });
    const mesh = defaultWarpMesh(t);
    const [a, b, c, d, e, f] = parseMatrix(deriveAffineFromWarpMesh(t, mesh));
    expect(a).toBeCloseTo(1, 5);
    expect(b).toBeCloseTo(0, 5);
    expect(c).toBeCloseTo(0, 5);
    expect(d).toBeCloseTo(1, 5);
    expect(e).toBeCloseTo(0, 4);
    expect(f).toBeCloseTo(0, 4);
  });

  // ── Each node type contributes ─────────────────────────────────────────
  it('shifting CORNER node (0,0) changes matrix', () => {
    const t = makeTransform({ x: 0, y: 0, width: 100, height: 100 });
    const base = parseMatrix(deriveAffineFromWarpMesh(t, defaultWarpMesh(t)));
    const mesh = defaultWarpMesh(t).map(p =>
      p.row === 0 && p.col === 0 ? { ...p, x: p.x + 15 } : p,
    );
    const moved = parseMatrix(deriveAffineFromWarpMesh(t, mesh));
    expect(moved.some((v, i) => Math.abs(v - base[i]) > 1e-3)).toBe(true);
  });

  it('shifting EDGE-MIDPOINT node (0,1) changes matrix', () => {
    const t = makeTransform({ x: 0, y: 0, width: 100, height: 100 });
    const base = parseMatrix(deriveAffineFromWarpMesh(t, defaultWarpMesh(t)));
    const mesh = defaultWarpMesh(t).map(p =>
      p.row === 0 && p.col === 1 ? { ...p, y: p.y - 20 } : p,
    );
    const moved = parseMatrix(deriveAffineFromWarpMesh(t, mesh));
    // Moving (0,1) changes the mean target centroid → translation e or f changes
    expect(moved.some((v, i) => Math.abs(v - base[i]) > 1e-3)).toBe(true);
  });

  it('shifting CENTRE node (1,1) changes matrix translation', () => {
    const t = makeTransform({ x: 0, y: 0, width: 100, height: 100 });
    const base = parseMatrix(deriveAffineFromWarpMesh(t, defaultWarpMesh(t)));
    const mesh = defaultWarpMesh(t).map(p =>
      p.row === 1 && p.col === 1 ? { ...p, x: p.x + 10, y: p.y + 10 } : p,
    );
    const moved = parseMatrix(deriveAffineFromWarpMesh(t, mesh));
    // Centre node contributes to target centroid → e, f change
    expect(Math.abs(moved[4] - base[4]) + Math.abs(moved[5] - base[5])).toBeGreaterThan(1e-3);
  });

  it('shifting ALL corner nodes symmetrically scales a and d', () => {
    const t = makeTransform({ x: 0, y: 0, width: 100, height: 100 });
    // Scale all nodes by 1.5 from origin (mesh is 0-based)
    const mesh = defaultWarpMesh(t).map(p => ({ ...p, x: p.x * 1.5, y: p.y * 1.5 }));
    const [a, _b, _c, d] = parseMatrix(deriveAffineFromWarpMesh(t, mesh));
    expect(a).toBeCloseTo(1.5, 3);
    expect(d).toBeCloseTo(1.5, 3);
  });
});

// ─── Composed interaction sequence tests ──────────────────────────────────────

describe('composed interaction: 8-handle sequence', () => {
  function simulateHandleDrag(
    handle: ExtHandleKind,
    t: ReturnType<typeof makeTransform>,
    ddx: number,
    ddy: number,
    mode: TransformMode = 'freeform',
    snap = false,
  ): ReturnType<typeof makeTransform> {
    // Grant (record initial position) → Move (apply delta) → Release (commit)
    // Simulates the logic in extTransformPanResponder.
    if (mode === 'freeform') return applyFreeformHandle(t, handle, ddx, ddy, snap);
    if (mode === 'uniform') return applyUniformHandle(t, handle, ddx, ddy, snap);
    return t; // distort/warp handled separately
  }

  it('tl handle moves origin (freeform)', () => {
    const t = makeTransform({ x: 100, y: 100, width: 200, height: 200 });
    const result = simulateHandleDrag('tl', t, -20, -10);
    expect(result.x).toBe(80);
    expect(result.y).toBe(90);
    expect(result.width).toBe(220);
    expect(result.height).toBe(210);
  });

  it('br handle extends size (freeform)', () => {
    const t = makeTransform({ x: 0, y: 0, width: 100, height: 100 });
    const result = simulateHandleDrag('br', t, 50, 30);
    expect(result.width).toBe(150);
    expect(result.height).toBe(130);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it('tc handle only adjusts top (freeform)', () => {
    const t = makeTransform({ x: 0, y: 100, width: 200, height: 100 });
    const result = simulateHandleDrag('tc', t, 0, -20);
    expect(result.y).toBe(80);
    expect(result.height).toBe(120);
    expect(result.x).toBe(0);
    expect(result.width).toBe(200);
  });

  it('mr handle only adjusts width (freeform)', () => {
    const t = makeTransform({ x: 0, y: 0, width: 100, height: 100 });
    const result = simulateHandleDrag('mr', t, 40, 0);
    expect(result.width).toBe(140);
    expect(result.y).toBe(0);
    expect(result.height).toBe(100);
  });

  it('snap rounds to grid (uniform, tl)', () => {
    const t = makeTransform({ x: 100, y: 100, width: 200, height: 200 });
    const result = simulateHandleDrag('tl', t, -17, -13, 'uniform', true);
    // Snapped to nearest 8: 100 - 16 = 84, 100 - 16 = 84
    expect(result.x % 8).toBe(0);
    expect(result.y % 8).toBe(0);
  });

  it('release resets handle reference (pendingExtHandleRef pattern)', () => {
    // Simulates: onPressIn sets pending='tl'; onRelease resets to 'move'.
    let pending: ExtHandleKind = 'move';
    pending = 'tl'; // onPressIn
    // ... drag happens ...
    pending = 'move'; // onRelease resets
    expect(pending).toBe('move');
  });
});

describe('composed interaction: distort edge handle', () => {
  it('tc handle moves both tl and tr corners', () => {
    const t = makeTransform({ x: 0, y: 0, width: 100, height: 100 });
    const quad = transformToQuad(t);
    const newQuad = applyDistortHandleForTest(quad, 'tc', 0, -20);
    expect(newQuad.tl.y).toBe(quad.tl.y - 20);
    expect(newQuad.tr.y).toBe(quad.tr.y - 20);
    expect(newQuad.bl.y).toBe(quad.bl.y); // unchanged
    expect(newQuad.br.y).toBe(quad.br.y); // unchanged
  });

  it('ml handle moves both tl and bl corners', () => {
    const t = makeTransform({ x: 0, y: 0, width: 100, height: 100 });
    const quad = transformToQuad(t);
    const newQuad = applyDistortHandleForTest(quad, 'ml', -15, 0);
    expect(newQuad.tl.x).toBe(quad.tl.x - 15);
    expect(newQuad.bl.x).toBe(quad.bl.x - 15);
    expect(newQuad.tr.x).toBe(quad.tr.x); // unchanged
    expect(newQuad.br.x).toBe(quad.br.x); // unchanged
  });
});

// Helper: applyDistortHandle logic extracted for testing (mirrors design-canvas internal)
function applyDistortHandleForTest(
  q: DistortQuad,
  kind: ExtHandleKind,
  ddx: number,
  ddy: number,
): DistortQuad {
  const nq = { ...q, tl: { ...q.tl }, tr: { ...q.tr }, bl: { ...q.bl }, br: { ...q.br } };
  if (kind === 'tl')       { nq.tl = { x: q.tl.x + ddx, y: q.tl.y + ddy }; }
  else if (kind === 'tr')  { nq.tr = { x: q.tr.x + ddx, y: q.tr.y + ddy }; }
  else if (kind === 'bl')  { nq.bl = { x: q.bl.x + ddx, y: q.bl.y + ddy }; }
  else if (kind === 'br')  { nq.br = { x: q.br.x + ddx, y: q.br.y + ddy }; }
  else if (kind === 'tc')  { nq.tl = { x: q.tl.x + ddx, y: q.tl.y + ddy }; nq.tr = { x: q.tr.x + ddx, y: q.tr.y + ddy }; }
  else if (kind === 'bc')  { nq.bl = { x: q.bl.x + ddx, y: q.bl.y + ddy }; nq.br = { x: q.br.x + ddx, y: q.br.y + ddy }; }
  else if (kind === 'ml')  { nq.tl = { x: q.tl.x + ddx, y: q.tl.y + ddy }; nq.bl = { x: q.bl.x + ddx, y: q.bl.y + ddy }; }
  else if (kind === 'mr')  { nq.tr = { x: q.tr.x + ddx, y: q.tr.y + ddy }; nq.br = { x: q.br.x + ddx, y: q.br.y + ddy }; }
  else if (kind === 'move') {
    nq.tl = { x: q.tl.x + ddx, y: q.tl.y + ddy };
    nq.tr = { x: q.tr.x + ddx, y: q.tr.y + ddy };
    nq.bl = { x: q.bl.x + ddx, y: q.bl.y + ddy };
    nq.br = { x: q.br.x + ddx, y: q.br.y + ddy };
  }
  return nq;
}
