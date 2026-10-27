/**
 * strokeRecord.ts — the persisted form of one brush / eraser / smudge stroke.
 *
 * A drawing layer's pixels are never stored as the source of truth; its
 * ordered list of stroke records is. Each record carries the raw input
 * samples plus a snapshot of every brush parameter and the stroke's seed,
 * so lib/paint/engine.ts can re-render the layer deterministically:
 *   - live, at the on-screen working resolution,
 *   - after undo/redo or reopening the project,
 *   - and at full print resolution (e.g. 4500×5400) for export.
 *
 * Records ride on the existing DrawPath (services/designTypes.ts) as its
 * `stroke` field, so projects keep their shape and older vector-only paths
 * (just an SVG `d`) are upgraded on the fly by `recordFromDrawPath`.
 */

import type { DrawPath } from '@/services/designTypes';
import { DEFAULT_BRUSH_PRESETS, type BrushMode, type BrushParams } from './brushPresets';
import type { StrokeSample } from './dabEmitter';

export interface StrokeRecord {
  v: 1;
  /**
   * paint / erase / smudge: a brush stroke.
   * fill: Procreate's "Fill Layer" (whole layer, honours alpha lock).
   * merge: a merged-down layer — its own strokes rendered into a separate
   *   surface, then composited at the merged layer's opacity + blend mode, so
   *   its eraser strokes never touch the layer it was merged into.
   */
  mode: BrushMode | 'fill' | 'merge';
  merge?: { paths: DrawPath[]; opacity: number; blendMode?: import('@/services/designTypes').BlendModeKind };
  brushId: string;
  brushName: string;
  params: BrushParams;
  /** #RRGGBB */
  color: string;
  /** Logical diameter at full pressure. */
  diameter: number;
  /** Stroke opacity (Procreate caps the whole stroke at this; overlapping dabs don't exceed it). */
  opacity: number;
  seed: number;
  /** Alpha Lock was on for the target layer when this stroke was drawn. */
  alphaLock?: boolean;
  /** Canvas long side / 1080 at the time of drawing (pressure simulation scale). */
  unitScale: number;
  /** Flat [x, y, p, t] quadruples in logical canvas px; p = -1 for no pressure. */
  pts: number[];
}

/**
 * Rounds a sample exactly the way samplesToPts stores it. The live engine
 * feeds the emitter QUANTISED samples, so the stored record replays into the
 * very same dabs (identical pixels after undo/redo, reload and export).
 */
export function quantizeSample(s: StrokeSample, t0: number): StrokeSample {
  return { x: round1(s.x), y: round1(s.y), p: s.p < 0 ? -1 : Math.round(s.p * 1000) / 1000, t: Math.round(s.t - t0) };
}

export function samplesToPts(samples: StrokeSample[]): number[] {
  const out: number[] = [];
  const t0 = samples[0]?.t ?? 0;
  for (const s of samples) {
    out.push(round1(s.x), round1(s.y), s.p < 0 ? -1 : Math.round(s.p * 1000) / 1000, Math.round(s.t - t0));
  }
  return out;
}

export function ptsToSamples(pts: number[]): StrokeSample[] {
  const out: StrokeSample[] = [];
  for (let i = 0; i + 3 < pts.length; i += 4) out.push({ x: pts[i], y: pts[i + 1], p: pts[i + 2], t: pts[i + 3] });
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Wraps a record in a DrawPath so it slots into DesignDrawingLayer.paths unchanged. */
export function drawPathFromRecord(rec: StrokeRecord): DrawPath {
  return {
    d: '',
    color: rec.mode === 'erase' ? 'erase' : rec.mode === 'smudge' ? 'smudge' : rec.mode === 'merge' ? 'merge' : rec.color,
    width: rec.diameter,
    opacity: rec.opacity,
    tool: rec.brushName,
    stroke: rec,
  };
}

const LEGACY_PARAMS: BrushParams = {
  ...DEFAULT_BRUSH_PRESETS.find(b => b.id === 'technical-pen')!.params,
  pressureSize: 0, velocitySize: 0, streamline: 0, spacing: 0.05,
};

/**
 * The record for any DrawPath: its own `stroke` if it has one, otherwise an
 * upgrade of the old vector path (`M x,y L x,y …`) into a constant-width
 * hard round stroke, which renders the way the old SVG stroke did.
 */
export function recordFromDrawPath(path: DrawPath): StrokeRecord | null {
  if (path.stroke) return path.stroke;
  const nums = (path.d ?? '').match(/-?\d*\.?\d+(?:e-?\d+)?/gi);
  if (!nums || nums.length < 2) return null;
  const pts: number[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push(parseFloat(nums[i]), parseFloat(nums[i + 1]), -1, (i / 2) * 16);
  const isErase = path.color === 'erase';
  return {
    v: 1,
    mode: isErase ? 'erase' : path.color === 'smudge' ? 'smudge' : 'paint',
    brushId: 'legacy',
    brushName: path.tool || 'Pen',
    params: LEGACY_PARAMS,
    color: isErase || path.color === 'smudge' ? '#000000' : path.color,
    diameter: Math.max(1, path.width || 4),
    opacity: isErase ? 1 : (path.opacity ?? 1),
    seed: 1,
    unitScale: 1,
    pts,
  };
}

/** A "Fill Layer" record. */
export function fillRecord(color: string, alphaLock: boolean): StrokeRecord {
  return {
    v: 1, mode: 'fill', brushId: 'fill', brushName: 'Fill', params: LEGACY_PARAMS,
    color, diameter: 1, opacity: 1, seed: 1, alphaLock, unitScale: 1, pts: [],
  };
}

/** A merged-down layer, replayed as a unit (see StrokeRecord.mode). */
export function mergeRecord(paths: DrawPath[], opacity: number, blendMode?: import('@/services/designTypes').BlendModeKind): StrokeRecord {
  return {
    v: 1, mode: 'merge', brushId: 'merge', brushName: 'Merged layer', params: LEGACY_PARAMS,
    color: '#000000', diameter: 1, opacity: 1, seed: 1, unitScale: 1, pts: [],
    merge: { paths, opacity, blendMode },
  };
}

/** Bounding box (logical px) a record can touch, padded by its diameter and scatter. */
export function recordBounds(rec: StrokeRecord): { x: number; y: number; w: number; h: number } | null {
  if (rec.pts.length < 4) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 3 < rec.pts.length; i += 4) {
    const x = rec.pts[i], y = rec.pts[i + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const pad = rec.diameter * (1 + rec.params.scatter + rec.params.jitter) + 4;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}
