/**
 * selectionModel.ts — typed SelectionRegion + hit-testing for the Selection tool.
 *
 * SelectionRegion is in LOGICAL canvas coordinates (same space as DrawPath.d strings
 * and DesignTransform x/y/width/height).  Never stored in display pixels.
 *
 * Supported modes:
 *   automatic  — hit-test visible layers top-down at a tapped logical point;
 *                returns the content bounds of the topmost hit layer.
 *   rectangle  — axis-aligned rect defined by drag start/end.
 *   ellipse    — bounding box of an ellipse defined by drag start/end.
 *   freehand   — closed lasso path recorded as an array of logical points.
 *
 * The region can carry an optional feather radius (logical px) that affects
 * cut/transform softness where the renderer supports it.
 */

import type { DesignLayer, DesignDrawingLayer } from '../services/designTypes';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SelectionMode = 'automatic' | 'freehand' | 'rectangle' | 'ellipse';

/** Axis-aligned bounding rect in logical canvas coordinates. */
export interface SelectionRect {
  x: number; y: number; w: number; h: number;
}

/** A 2-D point in logical canvas coordinates. */
export interface LogicalPoint {
  x: number; y: number;
}

/** The active selection region.  All coordinates are logical canvas units. */
export type SelectionRegion =
  | { kind: 'rectangle'; rect: SelectionRect; feather: number; layerId?: string }
  | { kind: 'ellipse';   rect: SelectionRect; feather: number; layerId?: string }
  | { kind: 'freehand';  points: LogicalPoint[]; closed: boolean; feather: number; layerId?: string }
  | { kind: 'automatic'; rect: SelectionRect; layerId: string; feather: number };

/** SelectionOptions — add/subtract/invert/clear mutations. */
export type SelectionOperation = 'add' | 'subtract' | 'invert' | 'clear';

// ─── Selection geometry helpers ───────────────────────────────────────────────

/** Build a normalised SelectionRect from two drag endpoints. */
export function rectFromPoints(p1: LogicalPoint, p2: LogicalPoint): SelectionRect {
  const x = Math.min(p1.x, p2.x);
  const y = Math.min(p1.y, p2.y);
  const w = Math.abs(p2.x - p1.x);
  const h = Math.abs(p2.y - p1.y);
  return { x, y, w, h };
}

/** Returns true when a logical point lies within the given rect. */
export function pointInRect(p: LogicalPoint, r: SelectionRect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/**
 * Returns true when a logical point lies within the ellipse bounded by `r`.
 * Uses the standard ellipse equation: (dx/a)² + (dy/b)² ≤ 1.
 */
export function pointInEllipse(p: LogicalPoint, r: SelectionRect): boolean {
  const a = r.w / 2;
  const b = r.h / 2;
  if (a <= 0 || b <= 0) return false;
  const dx = p.x - (r.x + a);
  const dy = p.y - (r.y + b);
  return (dx * dx) / (a * a) + (dy * dy) / (b * b) <= 1;
}

/**
 * Point-in-polygon test using the ray-casting algorithm.
 * Works for any simple polygon; suitable for closed lasso paths.
 */
export function pointInPolygon(p: LogicalPoint, polygon: LogicalPoint[]): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  let inside = false;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect =
      (yi > p.y) !== (yj > p.y) &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
    j = i;
  }
  return inside;
}

/** Returns the bounding rect of a freehand lasso path. */
export function polygonBounds(points: LogicalPoint[]): SelectionRect {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = points[0].x, maxX = points[0].x;
  let minY = points[0].y, maxY = points[0].y;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// ─── Automatic hit-testing ────────────────────────────────────────────────────

/**
 * hitTestLayers — tests visible layers top-down (highest order first) at a
 * logical canvas point.  Returns the topmost layer whose content bounds contain
 * the point, or null if no layer is hit.
 *
 * For drawing layers the bound is the layer's transform rect (a tight bounds
 * around all recorded paths is not computed here — use the transform width/height
 * which the editor sets to the canvas size for full-canvas drawing layers, or to
 * a custom crop for imported ones).
 *
 * This is intentionally minimal hit-testing (bounds, not alpha) because we
 * cannot read pixel data from the SVG compositor without a native snapshot.
 * The layer hit gives us a well-defined bounds rect to use as the selection region.
 */
export function hitTestLayers(
  logicalPoint: LogicalPoint,
  layers: DesignLayer[],
): DesignLayer | null {
  // Sort descending by order (top-most layer first)
  const sorted = [...layers]
    .filter(l => l.visible && !l.locked)
    .sort((a, b) => b.order - a.order);

  for (const layer of sorted) {
    const t = layer.transform;
    const bounds: SelectionRect = { x: t.x, y: t.y, w: t.width, h: t.height };
    if (pointInRect(logicalPoint, bounds)) {
      return layer;
    }
  }
  return null;
}

/**
 * automaticSelection — performs the "Automatic" mode smart selection.
 * Hit-tests visible layers at the tapped logical point and returns a
 * SelectionRegion describing the hit layer's content bounds, or null.
 */
export function automaticSelection(
  logicalPoint: LogicalPoint,
  layers: DesignLayer[],
  feather = 0,
): SelectionRegion | null {
  const hit = hitTestLayers(logicalPoint, layers);
  if (!hit) return null;
  const t = hit.transform;
  return {
    kind:    'automatic',
    rect:    { x: t.x, y: t.y, w: t.width, h: t.height },
    layerId: hit.id,
    feather,
  };
}

// ─── Region containment ───────────────────────────────────────────────────────

/**
 * pointInSelection — tests whether a logical point is inside any SelectionRegion.
 * Used for cut/copy operations to determine if strokes are within the selection.
 */
export function pointInSelection(p: LogicalPoint, region: SelectionRegion): boolean {
  switch (region.kind) {
    case 'rectangle':
    case 'automatic':
      return pointInRect(p, region.rect);
    case 'ellipse':
      return pointInEllipse(p, region.rect);
    case 'freehand':
      if (!region.closed) return false;
      return pointInPolygon(p, region.points);
  }
}

// ─── Marching ants dash offset ────────────────────────────────────────────────

/** Marching-ants stroke pattern: [dash, gap] in display px. */
export const ANTS_DASH_PATTERN = [6, 4];

/** Compute current dash offset from an animating timer tick (ms). */
export function marchingAntsOffset(tickMs: number): number {
  const period = (ANTS_DASH_PATTERN[0] + ANTS_DASH_PATTERN[1]) * 2; // px per cycle
  const pxPerMs = 0.04; // slow march
  return (tickMs * pxPerMs) % period;
}

// ─── Lasso SVG path builder ───────────────────────────────────────────────────

/** Converts an array of logical points to an SVG path `d` string (scaled to display). */
export function lassoPathD(
  points: LogicalPoint[],
  scaleX: number,
  scaleY: number,
  closed: boolean,
): string {
  if (points.length === 0) return '';
  const parts: string[] = [
    `M${(points[0].x * scaleX).toFixed(1)},${(points[0].y * scaleY).toFixed(1)}`,
  ];
  for (let i = 1; i < points.length; i++) {
    parts.push(`L${(points[i].x * scaleX).toFixed(1)},${(points[i].y * scaleY).toFixed(1)}`);
  }
  if (closed) parts.push('Z');
  return parts.join(' ');
}

// ─── SVG path parsing — extract control point from a DrawPath ─────────────────

/**
 * parseSvgPathPoints — naive M/L parser; returns all coordinate pairs in the
 * path as LogicalPoint[].  Used to check if a drawing path intersects a region.
 */
export function parseSvgPathPoints(d: string): LogicalPoint[] {
  const pts: LogicalPoint[] = [];
  const re = /[ML]\s*([\d.+-]+)[,\s]+([\d.+-]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    pts.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
  }
  return pts;
}

/**
 * drawingLayerPathsInSelection — returns the subset of a drawing layer's paths
 * whose control points overlap with the selection region.
 */
export function drawingLayerPathsInSelection(
  layer: DesignLayer,
  region: SelectionRegion,
): import('../services/designTypes').DrawPath[] {
  if (layer.type !== 'drawing') return [];
  const d = layer.data as DesignDrawingLayer;
  return d.paths.filter(p => {
    const pts = parseSvgPathPoints(p.d);
    return pts.some(pt => pointInSelection(pt, region));
  });
}
