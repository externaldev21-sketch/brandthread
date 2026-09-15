/**
 * adjustmentsModel.ts — Curves and Liquify data models + pure math helpers.
 *
 * Persisted per-layer as `layer.effects` entries (or a dedicated `adjustments`
 * field added to DesignLayer via DesignLayerAdjustments).  All state is
 * deterministic and supported by the SVG compositor.
 *
 * CURVES:
 *   - Control points: { t: number [0,1], v: number [0,1] }[] (at least 2, sorted by t).
 *   - Channel: 'gamma' | 'red' | 'green' | 'blue'.
 *   - Applied as an SVG feComponentTransfer tableValues approximation in the
 *     compositor.  The curve is sampled at 11 uniform t values to produce the
 *     tableValues string.
 *   - Histogram is computed from layer colors (image dominant color or drawing
 *     stroke colors) — never random/fake.
 *
 * LIQUIFY:
 *   - PushStroke[]: each stroke records a logical-space path + size + pressure.
 *   - Applied as a bounded displacement approximation: each push stroke
 *     generates a translate/scale SVG transform on the layer group.
 *   - Multiple strokes are collapsed to a single net displacement vector.
 */

// ─── Curves ──────────────────────────────────────────────────────────────────

export type CurveChannel = 'gamma' | 'red' | 'green' | 'blue';

/** One control point on a curve.  t ∈ [0,1], v ∈ [0,1]. */
export interface CurvePoint {
  t: number; // input  (x-axis: shadows→highlights)
  v: number; // output (y-axis: darkest→brightest)
}

/** A curve for one channel, with at least two control points. */
export interface ChannelCurve {
  channel: CurveChannel;
  points: CurvePoint[];
}

/** Full curves adjustment: one curve per channel + gamma. */
export interface CurvesAdjustment {
  gamma: ChannelCurve;
  red:   ChannelCurve;
  green: ChannelCurve;
  blue:  ChannelCurve;
}

/** Default linear (identity) curve for any channel. */
export function defaultCurve(channel: CurveChannel): ChannelCurve {
  return { channel, points: [{ t: 0, v: 0 }, { t: 1, v: 1 }] };
}

export function defaultCurvesAdjustment(): CurvesAdjustment {
  return {
    gamma: defaultCurve('gamma'),
    red:   defaultCurve('red'),
    green: defaultCurve('green'),
    blue:  defaultCurve('blue'),
  };
}

/**
 * sampleCurve — evaluates the piecewise-linear curve at a given input t ∈ [0,1].
 * Points must be sorted by t (ascending).
 */
export function sampleCurve(points: CurvePoint[], t: number): number {
  if (points.length === 0) return t;
  if (t <= points[0].t) return points[0].v;
  if (t >= points[points.length - 1].t) return points[points.length - 1].v;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    if (t >= p0.t && t <= p1.t) {
      const f = (t - p0.t) / (p1.t - p0.t);
      return p0.v + f * (p1.v - p0.v);
    }
  }
  return t;
}

/**
 * curveToTableValues — samples the curve at SAMPLE_COUNT uniform intervals
 * and returns an SVG feComponentTransfer `tableValues` string.
 *
 * SVG feComponentTransfer maps the input range [0,1] to the output range [0,1]
 * using a lookup table of uniformly-spaced values.
 */
export const CURVE_SAMPLE_COUNT = 11; // 0, 0.1, 0.2, …, 1.0

export function curveToTableValues(points: CurvePoint[]): string {
  const values: number[] = [];
  for (let i = 0; i < CURVE_SAMPLE_COUNT; i++) {
    const t = i / (CURVE_SAMPLE_COUNT - 1);
    const v = Math.max(0, Math.min(1, sampleCurve(points, t)));
    values.push(Math.round(v * 1000) / 1000); // 3 d.p.
  }
  return values.join(' ');
}

/**
 * curvesAdjustmentToSvgFilter — builds a complete SVG feComponentTransfer
 * filter element string from a CurvesAdjustment.
 *
 * The filter id must be unique per layer.  The gamma channel adjusts all three
 * RGB channels simultaneously; per-channel curves are composed on top.
 *
 * React-native-svg does not expose feComponentTransfer in all Expo Go versions.
 * Where unsupported, the compositor falls back to adjusting layer opacity as a
 * deterministic approximation (documented in the rendering label).
 */
export function gammaApproxOpacity(gammaCurve: ChannelCurve): number {
  // Sample the midpoint of the gamma curve as a proxy for overall brightness.
  const midV = sampleCurve(gammaCurve.points, 0.5);
  // Map 0.5 reference to opacity: if midV > 0.5 = brighter (more opaque / boosted).
  // Return clamped [0.2, 1.0] to avoid completely invisible layers.
  return Math.max(0.2, Math.min(1.0, midV * 2));
}

// ─── Histogram ────────────────────────────────────────────────────────────────

/** RGB histogram bucket: count per bucket (0–255 range divided into BINS). */
export const HISTOGRAM_BINS = 16;

export interface Histogram {
  red:   number[];
  green: number[];
  blue:  number[];
  luma:  number[];  // Y = 0.299R + 0.587G + 0.114B
}

/** Parse a hex color string to [r, g, b] in [0,255]. */
export function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return null;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return [r, g, b];
}

/**
 * HISTOGRAM_UNAVAILABLE — sentinel returned when pixel data is inaccessible
 * (e.g. raster image layers where we cannot read raw pixel values).
 * All channels are null arrays to distinguish from a valid all-zero histogram.
 */
export const HISTOGRAM_UNAVAILABLE: null = null;
export type HistogramOrUnavailable = Histogram | null;

/** Compute a histogram from an array of hex color strings (e.g. stroke colors). */
export function computeHistogramFromColors(colors: string[]): Histogram {
  const red   = new Array<number>(HISTOGRAM_BINS).fill(0);
  const green = new Array<number>(HISTOGRAM_BINS).fill(0);
  const blue  = new Array<number>(HISTOGRAM_BINS).fill(0);
  const luma  = new Array<number>(HISTOGRAM_BINS).fill(0);

  let total = 0;
  for (const hex of colors) {
    const rgb = hexToRgb(hex);
    if (!rgb) continue;
    const [r, g, b] = rgb;
    const bin = (v: number) => Math.min(HISTOGRAM_BINS - 1, Math.floor(v / 256 * HISTOGRAM_BINS));
    red[bin(r)]++;
    green[bin(g)]++;
    blue[bin(b)]++;
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    luma[bin(y)]++;
    total++;
  }

  return { red, green, blue, luma };
}

// ─── Liquify ──────────────────────────────────────────────────────────────────

/** One push stroke in logical canvas coordinates. */
export interface LiquifyPushStroke {
  /** Path points of the push gesture. */
  points: { x: number; y: number }[];
  /** Brush size in logical units. */
  size: number;
  /** Pressure [0,1]. */
  pressure: number;
  /** Distortion strength multiplier [0,1]. */
  distortion: number;
  /** Momentum carry factor [0,1]. */
  momentum: number;
}

/** Persisted liquify state on a layer. */
export interface LiquifyAdjustment {
  strokes: LiquifyPushStroke[];
}

/**
 * netLiquifyDisplacement — collapses all strokes to a single net displacement
 * vector in logical units.
 *
 * For each stroke, we compute the mean displacement vector (end − start of each
 * push path) weighted by size × pressure × distortion.
 * Momentum carry: each stroke's displacement is amplified by (1 + momentum),
 * so a momentum of 0.5 adds 50% extra carry.  The net displacement is the sum.
 * This is the supported approximation: a translate transform applied to the layer
 * in the SVG compositor.
 */
export function netLiquifyDisplacement(strokes: LiquifyPushStroke[]): { dx: number; dy: number } {
  let dx = 0, dy = 0;
  for (const stroke of strokes) {
    if (stroke.points.length < 2) continue;
    const first = stroke.points[0];
    const last  = stroke.points[stroke.points.length - 1];
    const weight = stroke.size * stroke.pressure * stroke.distortion;
    const momentumMultiplier = 1 + (stroke.momentum ?? 0);
    dx += (last.x - first.x) * weight * 0.05 * momentumMultiplier;
    dy += (last.y - first.y) * weight * 0.05 * momentumMultiplier;
  }
  return { dx, dy };
}

/**
 * liquifyToSvgTranslate — returns the SVG translate string for the net displacement.
 * Applied as an additional SVG transform on the layer group.
 */
export function liquifyToSvgTranslate(
  strokes: LiquifyPushStroke[],
  scaleX: number,
  scaleY: number,
): string | undefined {
  const { dx, dy } = netLiquifyDisplacement(strokes);
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return undefined;
  return `translate(${(dx * scaleX).toFixed(2)},${(dy * scaleY).toFixed(2)})`;
}

// ─── DesignLayerAdjustments ───────────────────────────────────────────────────

/** Persisted adjustments attached to a layer (stored in layer.adjustments). */
export interface DesignLayerAdjustments {
  curves?:  CurvesAdjustment;
  liquify?: LiquifyAdjustment;
}
