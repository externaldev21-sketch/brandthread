/**
 * transformModel.ts — Transform tool geometry (8-handle, uniform/freeform/distort/warp).
 *
 * All coordinates are in LOGICAL canvas space.
 *
 * Transform modes:
 *   freeform  — each handle moves independently; no aspect-ratio constraint.
 *   uniform   — corner handles preserve the original aspect ratio; edge handles
 *               scale that axis only (NOT aspect-ratio constrained).
 *   distort   — four corner control points move independently, producing a
 *               persisted skew/affine decomposition stored in DesignTransform.
 *               The compositor applies the derived matrix as an SVG transform.
 *   warp      — 3x3 mesh of control points (9 points = 4 interior, 4 edge-mid,
 *               4 corners, computed from rect).  Applied as an SVG affine
 *               approximation derived from all 9 points.
 *               Labelled "Vector/Affine Warp" because react-native-svg does not
 *               support per-pixel mesh deformation.
 *
 * Snapping is toggled by the Settings sub-panel.  When enabled, logical positions
 * are snapped to a grid of `snapGrid` px (default 8 logical units).
 *
 * ─── Affine Convention ──────────────────────────────────────────────────────
 *
 * deriveAffineFromQuad uses an absolute-source → absolute-target affine fit:
 *
 *   Source basis vectors come from the ORIGINAL rect (axis-aligned):
 *     u = (w, 0)   — the original X axis in logical space
 *     v = (0, h)   — the original Y axis in logical space
 *
 *   Target basis vectors come from AVERAGES of opposite quad edges so that
 *   ALL four corners (tl, tr, bl, br) contribute:
 *     X-basis: avg( tr−tl,  br−bl )    // mean of top-edge and bottom-edge vectors
 *     Y-basis: avg( bl−tl,  br−tr )    // mean of left-edge and right-edge vectors
 *
 *   The translation (e, f) maps the source centroid to the target centroid:
 *     source centroid: (t.x + w/2,  t.y + h/2)
 *     target centroid: mean of all 4 quad corners
 *     e = cx_target − a·cx_src − c·cy_src
 *     f = cy_target − b·cx_src − d·cy_src
 *
 *   This guarantees:
 *     • Identity quad → matrix(1,0,0,1,0,0) regardless of layer position.
 *     • Moving any corner changes the matrix (all 4 contribute).
 *     • Moving an edge handle changes 2 adjacent corners → changes matrix.
 *
 * deriveAffineFromWarpMesh consumes ALL 9 mesh points:
 *   X-basis: avg over all 3 rows of (right-column − left-column) / w
 *   Y-basis: avg over all 3 cols of (bottom-row   − top-row)    / h
 *   Translation: maps source centroid (mesh centre, row=1,col=1) to mean of
 *   all 9 target mesh points.
 */

import type { DesignTransform } from '../services/designTypes';

// ─── Handle kinds (8 + move + rotate) ────────────────────────────────────────

export type ExtHandleKind =
  | 'move'
  | 'tl' | 'tc' | 'tr'   // top-left / top-center / top-right
  | 'ml'        | 'mr'   // middle-left / middle-right
  | 'bl' | 'bc' | 'br'   // bottom-left / bottom-center / bottom-right
  | 'rotate';

export type TransformMode = 'freeform' | 'uniform' | 'distort' | 'warp';

// Minimum allowed dimension in logical units.
export const TRANSFORM_MIN_DIM = 16;

// Default snapping grid in logical units.
export const DEFAULT_SNAP_GRID = 8;

// ─── Handle position computation ─────────────────────────────────────────────

export interface HandlePosition {
  kind: ExtHandleKind;
  lx: number; // logical x
  ly: number; // logical y
}

/**
 * Compute all 8 scale/move handles from a layer transform (no rotate handle).
 * The rotate handle is only present in the SELECT tool overlay, not the
 * TRANSFORM tool. Coordinates are in LOGICAL canvas units (not display pixels).
 */
export function computeHandlePositions(t: DesignTransform): HandlePosition[] {
  const { x, y, width: w, height: h } = t;
  const cx = x + w / 2;
  const cy = y + h / 2;
  return [
    { kind: 'tl', lx: x,      ly: y      },
    { kind: 'tc', lx: cx,     ly: y      },
    { kind: 'tr', lx: x + w,  ly: y      },
    { kind: 'ml', lx: x,      ly: cy     },
    { kind: 'mr', lx: x + w,  ly: cy     },
    { kind: 'bl', lx: x,      ly: y + h  },
    { kind: 'bc', lx: cx,     ly: y + h  },
    { kind: 'br', lx: x + w,  ly: y + h  },
  ];
}

// ─── Snapping ─────────────────────────────────────────────────────────────────

export function snapValue(v: number, grid: number): number {
  return Math.round(v / grid) * grid;
}

export function maybeSnap(v: number, snap: boolean, grid = DEFAULT_SNAP_GRID): number {
  return snap ? snapValue(v, grid) : v;
}

// ─── Freeform resize ──────────────────────────────────────────────────────────

/**
 * applyFreeformHandle — computes the new transform after moving `handle`
 * by `(ddx, ddy)` in logical units from the drag-start state.
 *
 * Each handle moves the adjacent edges independently.
 */
export function applyFreeformHandle(
  orig: DesignTransform,
  handle: ExtHandleKind,
  ddx: number,
  ddy: number,
  snap = false,
  snapGrid = DEFAULT_SNAP_GRID,
): DesignTransform {
  const MIN = TRANSFORM_MIN_DIM;
  const sn = (v: number) => maybeSnap(v, snap, snapGrid);

  let { width: w, height: h } = orig;

  switch (handle) {
    case 'move':
      return { ...orig, x: sn(orig.x + ddx), y: sn(orig.y + ddy) };
    case 'tl':
      w = Math.max(MIN, orig.width  - ddx);
      h = Math.max(MIN, orig.height - ddy);
      return { ...orig, x: sn(orig.x + orig.width  - w), y: sn(orig.y + orig.height - h), width: w, height: h };
    case 'tc':
      h = Math.max(MIN, orig.height - ddy);
      return { ...orig, y: sn(orig.y + orig.height - h), height: h };
    case 'tr':
      w = Math.max(MIN, orig.width  + ddx);
      h = Math.max(MIN, orig.height - ddy);
      return { ...orig, y: sn(orig.y + orig.height - h), width: w, height: h };
    case 'ml':
      w = Math.max(MIN, orig.width  - ddx);
      return { ...orig, x: sn(orig.x + orig.width - w), width: w };
    case 'mr':
      return { ...orig, width: Math.max(MIN, orig.width + ddx) };
    case 'bl':
      w = Math.max(MIN, orig.width  - ddx);
      h = Math.max(MIN, orig.height + ddy);
      return { ...orig, x: sn(orig.x + orig.width - w), width: w, height: h };
    case 'bc':
      return { ...orig, height: Math.max(MIN, orig.height + ddy) };
    case 'br':
      return { ...orig, width: Math.max(MIN, orig.width + ddx), height: Math.max(MIN, orig.height + ddy) };
    default:
      return orig;
  }
}

// ─── Uniform resize ───────────────────────────────────────────────────────────

/**
 * applyUniformHandle — like applyFreeformHandle but corner handles preserve
 * the original aspect ratio.
 */
export function applyUniformHandle(
  orig: DesignTransform,
  handle: ExtHandleKind,
  ddx: number,
  ddy: number,
  snap = false,
  snapGrid = DEFAULT_SNAP_GRID,
): DesignTransform {
  const ratio = orig.width / Math.max(1, orig.height);
  const MIN = TRANSFORM_MIN_DIM;

  // Edge handles: scale one axis (no ratio constraint for edges)
  if (handle === 'tc' || handle === 'bc' || handle === 'ml' || handle === 'mr') {
    return applyFreeformHandle(orig, handle, ddx, ddy, snap, snapGrid);
  }

  // Move / rotate: same as freeform
  if (handle === 'move' || handle === 'rotate') {
    return applyFreeformHandle(orig, handle, ddx, ddy, snap, snapGrid);
  }

  // Corner handles: preserve ratio
  const dominant = Math.abs(ddx) > Math.abs(ddy) ? ddx : ddy;
  const sign = handle === 'tl' || handle === 'bl' ? -1 : 1;
  const newW = Math.max(MIN, orig.width  + sign * dominant);
  const newH = Math.max(MIN, newW / ratio);

  const sn = (v: number) => maybeSnap(v, snap, snapGrid);

  switch (handle) {
    case 'tl':
      return { ...orig, x: sn(orig.x + orig.width - newW), y: sn(orig.y + orig.height - newH), width: newW, height: newH };
    case 'tr':
      return { ...orig, y: sn(orig.y + orig.height - newH), width: newW, height: newH };
    case 'bl':
      return { ...orig, x: sn(orig.x + orig.width - newW), width: newW, height: newH };
    case 'br':
      return { ...orig, width: newW, height: newH };
    default:
      return orig;
  }
}

// ─── Distort (4 independent corners → affine decomposition) ──────────────────

/** Four corners of a distort quad in logical coordinates. */
export interface DistortQuad {
  tl: { x: number; y: number };
  tr: { x: number; y: number };
  bl: { x: number; y: number };
  br: { x: number; y: number };
}

/**
 * Build the default (axis-aligned) quad from a transform.
 */
export function transformToQuad(t: DesignTransform): DistortQuad {
  return {
    tl: { x: t.x,          y: t.y           },
    tr: { x: t.x + t.width, y: t.y          },
    bl: { x: t.x,           y: t.y + t.height },
    br: { x: t.x + t.width, y: t.y + t.height },
  };
}

/**
 * deriveAffineFromQuad — absolute-source → absolute-target affine fit.
 *
 * Source basis: the original axis-aligned rect (t.x, t.y, t.width, t.height).
 * Target basis: averaged opposite-edge vectors so ALL four quad corners
 *               contribute to the matrix.
 *
 * X-basis (a,b): mean of (tr−tl) and (br−bl), normalised by original width.
 * Y-basis (c,d): mean of (bl−tl) and (br−tr), normalised by original height.
 * Translation (e,f): maps source centroid → target centroid.
 *
 * Identity quad → matrix(1,0,0,1,0,0) for any layer position.
 * Every corner drag changes the matrix (all 4 contribute).
 */
export function deriveAffineFromQuad(
  orig: DesignTransform,
  quad: DistortQuad,
): string {
  const ow = orig.width  || 1;
  const oh = orig.height || 1;

  // X-basis: average of top-edge vector (tr−tl) and bottom-edge vector (br−bl)
  const topEdgeX  = quad.tr.x - quad.tl.x;
  const topEdgeY  = quad.tr.y - quad.tl.y;
  const botEdgeX  = quad.br.x - quad.bl.x;
  const botEdgeY  = quad.br.y - quad.bl.y;
  const xBasisX   = (topEdgeX + botEdgeX) / 2;  // a·ow
  const xBasisY   = (topEdgeY + botEdgeY) / 2;  // b·ow

  // Y-basis: average of left-edge vector (bl−tl) and right-edge vector (br−tr)
  const leftEdgeX  = quad.bl.x - quad.tl.x;
  const leftEdgeY  = quad.bl.y - quad.tl.y;
  const rightEdgeX = quad.br.x - quad.tr.x;
  const rightEdgeY = quad.br.y - quad.tr.y;
  const yBasisX    = (leftEdgeX + rightEdgeX) / 2;  // c·oh
  const yBasisY    = (leftEdgeY + rightEdgeY) / 2;  // d·oh

  const a = xBasisX / ow;
  const b = xBasisY / ow;
  const c = yBasisX / oh;
  const d = yBasisY / oh;

  // Source centroid (original rect centre)
  const srcCx = orig.x + ow / 2;
  const srcCy = orig.y + oh / 2;

  // Target centroid: mean of all 4 quad corners
  const tgtCx = (quad.tl.x + quad.tr.x + quad.bl.x + quad.br.x) / 4;
  const tgtCy = (quad.tl.y + quad.tr.y + quad.bl.y + quad.br.y) / 4;

  // Translation: maps source centroid to target centroid
  const e = tgtCx - a * srcCx - c * srcCy;
  const f = tgtCy - b * srcCx - d * srcCy;

  return `matrix(${a.toFixed(4)},${b.toFixed(4)},${c.toFixed(4)},${d.toFixed(4)},${e.toFixed(4)},${f.toFixed(4)})`;
}

// ─── Warp (3×3 mesh → affine approximation) ───────────────────────────────────

export type WarpMeshPoint = { row: number; col: number; x: number; y: number };

/**
 * Build the default 3×3 warp mesh from a layer transform.
 * Points are in logical canvas coordinates.
 */
export function defaultWarpMesh(t: DesignTransform): WarpMeshPoint[] {
  const { x, y, width: w, height: h } = t;
  const mesh: WarpMeshPoint[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      mesh.push({
        row, col,
        x: x + (col / 2) * w,
        y: y + (row / 2) * h,
      });
    }
  }
  return mesh;
}

/**
 * deriveAffineFromWarpMesh — consumes ALL 9 mesh points.
 *
 * X-basis (a,b): averaged right−left column differences across all 3 rows,
 *   divided by original width. Each row's (col2−col0) contributes 1/3 weight.
 *
 * Y-basis (c,d): averaged bottom−top row differences across all 3 columns,
 *   divided by original height. Each column's (row2−row0) contributes 1/3 weight.
 *
 * Translation (e,f): maps the source centre point (mesh at row=1,col=1 in the
 *   original undeformed mesh, i.e. orig.x+w/2, orig.y+h/2) to the mean
 *   (centroid) of all 9 target mesh points.
 *
 * This ensures corner, edge-midpoint, and centre nodes each affect the
 * visible approximation.
 */
export function deriveAffineFromWarpMesh(
  orig: DesignTransform,
  mesh: WarpMeshPoint[],
): string {
  const ow = orig.width  || 1;
  const oh = orig.height || 1;

  const get = (row: number, col: number): { x: number; y: number } =>
    mesh.find(p => p.row === row && p.col === col) ?? { x: 0, y: 0 };

  // X-basis: average (col2 - col0) across all 3 rows
  let xBasisX = 0, xBasisY = 0;
  for (let row = 0; row < 3; row++) {
    const right = get(row, 2);
    const left  = get(row, 0);
    xBasisX += (right.x - left.x) / 3;
    xBasisY += (right.y - left.y) / 3;
  }

  // Y-basis: average (row2 - row0) across all 3 columns
  let yBasisX = 0, yBasisY = 0;
  for (let col = 0; col < 3; col++) {
    const bot = get(2, col);
    const top = get(0, col);
    yBasisX += (bot.x - top.x) / 3;
    yBasisY += (bot.y - top.y) / 3;
  }

  // Normalise by span (col0→col2 = full width; row0→row2 = full height)
  const a = xBasisX / ow;
  const b = xBasisY / ow;
  const c = yBasisX / oh;
  const d = yBasisY / oh;

  // Source centroid: original mesh centre (row=1, col=1 = undeformed centre)
  const srcCx = orig.x + ow / 2;
  const srcCy = orig.y + oh / 2;

  // Target centroid: mean of all 9 mesh points
  let tgtCx = 0, tgtCy = 0;
  for (const p of mesh) {
    tgtCx += p.x;
    tgtCy += p.y;
  }
  tgtCx /= mesh.length;
  tgtCy /= mesh.length;

  // Translation
  const e = tgtCx - a * srcCx - c * srcCy;
  const f = tgtCy - b * srcCx - d * srcCy;

  return `matrix(${a.toFixed(4)},${b.toFixed(4)},${c.toFixed(4)},${d.toFixed(4)},${e.toFixed(4)},${f.toFixed(4)})`;
}

// ─── DesignTransform extensions for persisted distort/warp ───────────────────

/**
 * Extended transform stored in DesignTransform for distort and warp modes.
 * The compositor reads these fields and emits the corresponding SVG matrix.
 */
export interface DistortWarpTransformData {
  /** SVG matrix string derived from the quad/mesh — applied as the layer transform. */
  affineSvgMatrix?: string;
  /** Serialized DistortQuad (JSON string) — for distort mode. */
  distortQuad?: string;
  /** Serialized WarpMeshPoint[] (JSON string) — for warp mode. */
  warpMesh?: string;
}
