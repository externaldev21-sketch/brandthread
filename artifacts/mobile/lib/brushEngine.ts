/**
 * brushEngine.ts — brush library + stroke geometry.
 *
 * Pure-TS, renderer-agnostic: produces smoothed point lists and per-segment
 * width profiles that both the Skia path builder (SkiaDrawingCanvas) and the
 * SVG fallback renderer can turn into a stroke. This module does not touch
 * React Native / Skia APIs so it is fully unit-testable.
 */

import { PressurePoint, samplePressureCurve } from './preferencesModel';

// ─── Brush kinds ──────────────────────────────────────────────────────────────

export type BrushKind =
  | 'pencil' | 'ink' | 'marker' | 'airbrush' | 'paint' | 'texture' | 'spray' | 'halftone';

export type ToolKind = BrushKind | 'smudge' | 'eraser';

export interface BrushDefinition {
  kind: BrushKind;
  label: string;
  /** Base opacity multiplier applied per-stroke (0..1). */
  baseOpacity: number;
  /** Edge softness: 0 = hard edge, 1 = fully feathered. Approximated via opacity falloff. */
  softness: number;
  /** How much velocity affects width: 0 = no effect, 1 = strong taper on fast strokes. */
  velocitySensitivity: number;
  /** How much pressure affects width: 0 = constant width, 1 = full pressure-curve range. */
  pressureSensitivity: number;
  /** Stroke jitter/scatter amount (spray/texture/halftone use this to place dabs). */
  scatter: number;
  /** Spacing between dabs as a fraction of brush size (airbrush/spray/texture/halftone). */
  dabSpacing: number;
  /** Whether the brush is dab-based (discrete stamped dots) vs. continuous stroke path. */
  isDabBased: boolean;
}

export const BRUSH_LIBRARY: Record<BrushKind, BrushDefinition> = {
  pencil:   { kind: 'pencil',   label: 'Pencil',   baseOpacity: 0.85, softness: 0.05, velocitySensitivity: 0.2, pressureSensitivity: 0.6, scatter: 0,    dabSpacing: 0,    isDabBased: false },
  ink:      { kind: 'ink',      label: 'Ink',      baseOpacity: 1.0,  softness: 0,    velocitySensitivity: 0.5, pressureSensitivity: 0.8, scatter: 0,    dabSpacing: 0,    isDabBased: false },
  marker:   { kind: 'marker',   label: 'Marker',   baseOpacity: 0.9,  softness: 0.1,  velocitySensitivity: 0.1, pressureSensitivity: 0.3, scatter: 0,    dabSpacing: 0,    isDabBased: false },
  airbrush: { kind: 'airbrush', label: 'Airbrush', baseOpacity: 0.4,  softness: 0.9,  velocitySensitivity: 0.1, pressureSensitivity: 0.5, scatter: 0.15, dabSpacing: 0.12, isDabBased: true  },
  paint:    { kind: 'paint',    label: 'Paint',    baseOpacity: 1.0,  softness: 0.2,  velocitySensitivity: 0.6, pressureSensitivity: 0.9, scatter: 0,    dabSpacing: 0,    isDabBased: false },
  texture:  { kind: 'texture',  label: 'Texture',  baseOpacity: 0.8,  softness: 0.4,  velocitySensitivity: 0.3, pressureSensitivity: 0.6, scatter: 0.3,  dabSpacing: 0.2,  isDabBased: true  },
  spray:    { kind: 'spray',    label: 'Spray',    baseOpacity: 0.6,  softness: 0.6,  velocitySensitivity: 0.2, pressureSensitivity: 0.4, scatter: 0.6,  dabSpacing: 0.05, isDabBased: true  },
  halftone: { kind: 'halftone', label: 'Halftone', baseOpacity: 1.0,  softness: 0,    velocitySensitivity: 0.2, pressureSensitivity: 0.7, scatter: 0.1,  dabSpacing: 0.25, isDabBased: true  },
};

export const BRUSH_KINDS: BrushKind[] = Object.keys(BRUSH_LIBRARY) as BrushKind[];

// ─── Stroke input points ──────────────────────────────────────────────────────

export interface StrokeInputPoint {
  x: number;
  y: number;
  /** ms timestamp, used for velocity + streamline smoothing. */
  t: number;
  /** Raw touch force [0,1] if available. */
  force?: number;
}

export interface StrokeStylePoint {
  x: number;
  y: number;
  /** Effective brush width (logical units) at this point. */
  width: number;
  /** Effective opacity at this point [0,1]. */
  opacity: number;
}

// ─── Streamline smoothing ─────────────────────────────────────────────────────

/**
 * movingAverageSmooth — simple windowed moving-average smoothing of raw input
 * points. `strength` in [0,1]: 0 = no smoothing (pass-through), 1 = maximum
 * (window = 5). Endpoints are preserved so strokes don't shrink at start/end.
 */
export function movingAverageSmooth(points: StrokeInputPoint[], strength: number): StrokeInputPoint[] {
  if (points.length < 3 || strength <= 0) return points;
  const window = Math.max(1, Math.round(strength * 4)); // 0..4 neighbors each side
  const out: StrokeInputPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    if (i === 0 || i === points.length - 1) {
      out.push(points[i]);
      continue;
    }
    let sx = 0, sy = 0, n = 0;
    for (let k = -window; k <= window; k++) {
      const idx = i + k;
      if (idx < 0 || idx >= points.length) continue;
      sx += points[idx].x;
      sy += points[idx].y;
      n++;
    }
    out.push({ ...points[i], x: sx / n, y: sy / n });
  }
  return out;
}

/**
 * catmullRomResample — fits a Catmull-Rom spline through the (already
 * streamline-smoothed) input points and resamples it at a fixed number of
 * segments per input span, producing a visually smooth curve without losing
 * the original point count's overall shape. Returns points only (no width).
 */
export function catmullRomResample(
  points: StrokeInputPoint[],
  segmentsPerSpan = 4,
): { x: number; y: number }[] {
  if (points.length < 3) return points.map(p => ({ x: p.x, y: p.y }));
  const out: { x: number; y: number }[] = [];
  const get = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    for (let s = 0; s < segmentsPerSpan; s++) {
      const t = s / segmentsPerSpan;
      const t2 = t * t, t3 = t2 * t;
      const x = 0.5 * (
        2 * p1.x + (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
      );
      const y = 0.5 * (
        2 * p1.y + (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
      );
      out.push({ x, y });
    }
  }
  out.push({ x: points[points.length - 1].x, y: points[points.length - 1].y });
  return out;
}

// ─── Width/opacity profile ────────────────────────────────────────────────────

/** Euclidean distance-per-ms velocity between two timed points, in logical units/ms. */
function pointVelocity(a: StrokeInputPoint, b: StrokeInputPoint): number {
  const dt = Math.max(1, b.t - a.t);
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  return dist / dt;
}

/**
 * buildStrokeStyle — combines pressure (via the user's pressure curve) and
 * velocity into a per-point width + opacity profile for a brush.
 *
 * - pressureSensitivity blends the brush's base size toward the pressure-curve
 *   sampled multiplier.
 * - velocitySensitivity tapers width down on fast movement (a real pen taper),
 *   clamped so a stroke never disappears entirely (min 25% width).
 */
export function buildStrokeStyle(
  rawPoints: StrokeInputPoint[],
  brush: BrushDefinition,
  baseSize: number,
  baseOpacity: number,
  pressureCurve: PressurePoint[],
  streamline = 0.3,
): StrokeStylePoint[] {
  if (rawPoints.length === 0) return [];
  const smoothed = movingAverageSmooth(rawPoints, streamline);

  // Estimate a max velocity for normalization (avoids a magic constant that
  // doesn't scale with device/sampling rate): use the stroke's own 90th
  // percentile speed, with a sane floor.
  const velocities: number[] = [];
  for (let i = 1; i < smoothed.length; i++) velocities.push(pointVelocity(smoothed[i - 1], smoothed[i]));
  const sortedV = [...velocities].sort((a, b) => a - b);
  const p90 = sortedV.length ? sortedV[Math.floor(sortedV.length * 0.9)] : 0;
  const maxV = Math.max(0.05, p90);

  return smoothed.map((pt, i) => {
    const pressureMul = samplePressureCurve(pressureCurve, pt.force);
    const sizeFromPressure = baseSize * (1 - brush.pressureSensitivity + brush.pressureSensitivity * pressureMul);

    const v = i > 0 ? pointVelocity(smoothed[i - 1], pt) : 0;
    const vNorm = Math.min(1, v / maxV);
    const velocityTaper = 1 - brush.velocitySensitivity * vNorm * 0.75; // never below 25%
    const width = Math.max(0.5, sizeFromPressure * velocityTaper);

    const opacity = Math.max(0, Math.min(1, baseOpacity * brush.baseOpacity * (1 - brush.softness * 0.3)));

    return { x: pt.x, y: pt.y, width, opacity };
  });
}

// ─── SVG path builder (fallback renderer) ─────────────────────────────────────

/**
 * strokeStyleToSvgPath — builds an SVG `d` path string through the style
 * points (Catmull-Rom smoothed), suitable for a single stroke with the given
 * average width. react-native-svg strokes render with a single strokeWidth,
 * so the per-point width profile is collapsed to an average — variable-width
 * strokes require the Skia path builder for true per-segment width.
 */
export function strokeStyleToSvgPath(points: StrokeStylePoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
  const resampled = catmullRomResample(points.map(p => ({ x: p.x, y: p.y, t: 0 })));
  const parts = [`M${resampled[0].x.toFixed(2)},${resampled[0].y.toFixed(2)}`];
  for (let i = 1; i < resampled.length; i++) {
    parts.push(`L${resampled[i].x.toFixed(2)},${resampled[i].y.toFixed(2)}`);
  }
  return parts.join(' ');
}

export function averageStrokeWidth(points: StrokeStylePoint[]): number {
  if (points.length === 0) return 1;
  return points.reduce((s, p) => s + p.width, 0) / points.length;
}

// ─── Dab placement (spray / airbrush / texture / halftone) ───────────────────

export interface Dab {
  x: number; y: number; radius: number; opacity: number;
}

/**
 * Deterministic pseudo-random generator (mulberry32) seeded per-stroke so dab
 * scatter is stable/reproducible for a given stroke (needed for tests and for
 * redo to reproduce the exact same rendering).
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * buildDabs — for dab-based brushes (airbrush/spray/texture/halftone), places
 * discrete dabs along the stroke path spaced by `dabSpacing * width`, each
 * scattered by up to `scatter * width` from the path.
 */
export function buildDabs(points: StrokeStylePoint[], brush: BrushDefinition, seed = 1): Dab[] {
  if (!brush.isDabBased || points.length === 0) return [];
  const rand = mulberry32(seed);
  const dabs: Dab[] = [];
  let distSinceLastDab = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const spacing = Math.max(1, brush.dabSpacing * p.width * 10);
    if (i > 0) {
      distSinceLastDab += Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y);
    }
    if (i === 0 || distSinceLastDab >= spacing) {
      distSinceLastDab = 0;
      const scatterR = brush.scatter * p.width * 2;
      const angle = rand() * Math.PI * 2;
      const mag = rand() * scatterR;
      dabs.push({
        x: p.x + Math.cos(angle) * mag,
        y: p.y + Math.sin(angle) * mag,
        radius: p.width / 2 * (0.6 + rand() * 0.4),
        opacity: p.opacity * (0.5 + rand() * 0.5),
      });
    }
  }
  return dabs;
}

// ─── Quick-shape recognition (hold at stroke end to snap to a clean shape) ───

export type QuickShapeKind = 'line' | 'rect' | 'circle' | null;

/**
 * detectQuickShape — very lightweight heuristic shape recognizer used for the
 * "hold briefly at the end of a drawn stroke" quick-shape gesture:
 *   - line: start/end are far apart and the path stays close to that line
 *   - circle: the path is closed (start ≈ end) and roughly equidistant from
 *     its centroid (low radius variance)
 *   - rect: the path is closed and its bounding box area is close to the
 *     polygon's shoelace area (i.e. it traces close to its own bbox)
 */
export function detectQuickShape(points: { x: number; y: number }[]): QuickShapeKind {
  if (points.length < 4) return null;
  const start = points[0];
  const end = points[points.length - 1];
  const closed = Math.hypot(end.x - start.x, end.y - start.y) < Math.max(20, bboxDiag(points) * 0.08);

  if (!closed) {
    // Straight-line test: max perpendicular deviation from the start-end chord.
    const chordLen = Math.hypot(end.x - start.x, end.y - start.y);
    if (chordLen < 10) return null;
    let maxDev = 0;
    for (const p of points) {
      const dev = perpendicularDistance(p, start, end);
      if (dev > maxDev) maxDev = dev;
    }
    if (maxDev / chordLen < 0.06) return 'line';
    return null;
  }

  // Closed shape: decide rect vs circle. Rect is checked first (tighter,
  // more specific test) since a circle's shoelace/bbox ratio (~0.785, from
  // pi*r^2 / (2r)^2) can otherwise be confused with a loose rect threshold.
  const bbox = polygonBbox(points);
  const bboxArea = bbox.w * bbox.h;
  const shoelace = Math.abs(shoelaceArea(points));
  if (bboxArea > 0 && shoelace / bboxArea > 0.9) return 'rect';

  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  const radii = points.map(p => Math.hypot(p.x - cx, p.y - cy));
  const meanR = radii.reduce((a, b) => a + b, 0) / radii.length;
  const variance = radii.reduce((s, r) => s + (r - meanR) ** 2, 0) / radii.length;
  const relStd = meanR > 0 ? Math.sqrt(variance) / meanR : 1;
  if (relStd < 0.18) return 'circle';

  return null;
}

function bboxDiag(points: { x: number; y: number }[]): number {
  const b = polygonBbox(points);
  return Math.hypot(b.w, b.h);
}

function polygonBbox(points: { x: number; y: number }[]) {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function shoelaceArea(points: { x: number; y: number }[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function perpendicularDistance(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x) / len;
}

/** Snap a detected quick-shape to a clean SVG path in the original point-cloud's coordinate space. */
export function quickShapeToSvgPath(kind: QuickShapeKind, points: { x: number; y: number }[]): string {
  if (!kind || points.length === 0) return '';
  const bbox = polygonBbox(points);
  switch (kind) {
    case 'line': {
      const a = points[0], b = points[points.length - 1];
      return `M${a.x.toFixed(2)},${a.y.toFixed(2)} L${b.x.toFixed(2)},${b.y.toFixed(2)}`;
    }
    case 'rect':
      return `M${bbox.x.toFixed(2)},${bbox.y.toFixed(2)} H${(bbox.x + bbox.w).toFixed(2)} V${(bbox.y + bbox.h).toFixed(2)} H${bbox.x.toFixed(2)} Z`;
    case 'circle': {
      const cx = bbox.x + bbox.w / 2, cy = bbox.y + bbox.h / 2, r = Math.max(bbox.w, bbox.h) / 2;
      return `M${(cx - r).toFixed(2)},${cy.toFixed(2)} A${r.toFixed(2)},${r.toFixed(2)} 0 1,0 ${(cx + r).toFixed(2)},${cy.toFixed(2)} A${r.toFixed(2)},${r.toFixed(2)} 0 1,0 ${(cx - r).toFixed(2)},${cy.toFixed(2)} Z`;
    }
    default:
      return '';
  }
}
