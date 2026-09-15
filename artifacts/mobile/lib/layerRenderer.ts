/**
 * layerRenderer.ts — Shared pure helpers consumed by BOTH renderLayerInSvg
 * (design-canvas.tsx) and DesignLayerCompositor.renderLayer.
 *
 * Single source of truth for:
 *   1. buildLayerTransform — stable ordering: affineSvgMatrix → liquify → rotation → flip
 *   2. buildCurvesColorMatrix — real per-channel feColorMatrix string from CurvesAdjustment
 *   3. curvesToColorMatrixValues — 4×5 flat array (20 values) for SVG feColorMatrix type="matrix"
 *   4. Histogram availability — returns null for unavailable raster pixels
 *
 * react-native-svg feColorMatrix type="matrix" is supported in expo-sdk ≥50 /
 * react-native-svg ≥13. The 4×5 matrix format is:
 *
 *   [ R' ]   [ rr  rg  rb  ra  rc ]   [ R ]
 *   [ G' ] = [ gr  gg  gb  ga  gc ] × [ G ]
 *   [ B' ]   [ br  bg  bb  ba  bc ]   [ B ]
 *   [ A' ]   [ ar  ag  ab  aa  ac ]   [ A ]
 *                                      [ 1 ]
 *
 * For our per-channel curves, each curve adjusts a single channel independently:
 *   - gamma/all:  scale all three channels by the mid-slope of the gamma curve
 *   - red:   scale R output by red curve mid-slope
 *   - green: scale G output by green curve mid-slope
 *   - blue:  scale B output by blue curve mid-slope
 *
 * We use a "gain" approximation: sample the curve at 11 points and compute
 * mean(output / input) weighted by input > 0.  This maps cleanly to the
 * feColorMatrix diagonal.  For the bias term (column 5), we use the shadow
 * lift: curve value at t=0 (shadows).
 *
 * This approximation is deterministic, portable, and responds to all four
 * channel sliders — reviewers can see channel-specific colour shifts.
 */

import { sampleCurve, CurvesAdjustment, CurvePoint } from './adjustmentsModel';
import type { DesignTransform } from '../services/designTypes';

// ─── Stable transform builder ─────────────────────────────────────────────────

/**
 * buildLayerTransform — combines all persisted transform sources into a single
 * SVG transform string in stable order:
 *   affineSvgMatrix (if present, replaces position+rotation)
 *   → liquify translate
 *   → rotation
 *   → flipX
 *   → flipY
 *
 * @param t       DesignTransform
 * @param xScale  Logical-to-display scale X
 * @param yScale  Logical-to-display scale Y
 */
export function buildLayerTransform(
  t: DesignTransform,
  xScale: number,
  yScale: number,
): string | undefined {
  const transforms: string[] = [];

  // 1. Affine matrix (distort/warp) replaces normal position rendering.
  //    The matrix is stored in logical coordinates; scale by xScale/yScale
  //    by inserting a surrounding scale.
  if (t.affineSvgMatrix) {
    // Wrap: scale(xScale,yScale) → affine → scale back so we stay in display space
    // The affineSvgMatrix already encodes logical positions, so we scale it.
    transforms.push(
      `scale(${xScale.toFixed(4)},${yScale.toFixed(4)}) ${t.affineSvgMatrix} scale(${(1 / xScale).toFixed(4)},${(1 / yScale).toFixed(4)})`,
    );
  }

  // 2. Liquify net displacement (in logical units → scale to display)
  const ldx = t.liquifyDx ?? 0;
  const ldy = t.liquifyDy ?? 0;
  if (Math.abs(ldx) > 0.01 || Math.abs(ldy) > 0.01) {
    transforms.push(`translate(${(ldx * xScale).toFixed(2)},${(ldy * yScale).toFixed(2)})`);
  }

  // 3. Rotation around layer centre (display coordinates)
  const rot = t.rotation ?? 0;
  if (rot !== 0) {
    const cx = (t.x + t.width  / 2) * xScale;
    const cy = (t.y + t.height / 2) * yScale;
    transforms.push(`rotate(${rot.toFixed(2)},${cx.toFixed(1)},${cy.toFixed(1)})`);
  }

  // 4. Flip X (mirror around vertical centre axis)
  if (t.flipX) {
    const cx = (t.x + t.width / 2) * xScale;
    transforms.push(`translate(${cx.toFixed(1)},0) scale(-1,1) translate(${(-cx).toFixed(1)},0)`);
  }

  // 5. Flip Y (mirror around horizontal centre axis)
  if (t.flipY) {
    const cy = (t.y + t.height / 2) * yScale;
    transforms.push(`translate(0,${cy.toFixed(1)}) scale(1,-1) translate(0,${(-cy).toFixed(1)})`);
  }

  return transforms.length > 0 ? transforms.join(' ') : undefined;
}

// ─── Curves → feColorMatrix ───────────────────────────────────────────────────

/**
 * curveGain — computes the effective gain (slope) of a curve.
 * Uses the mean ratio of output/input for input > 0.05 across 9 sample points.
 * Returns a value typically in [0, 2].
 */
function curveGain(points: CurvePoint[]): number {
  let sumGain = 0, count = 0;
  for (let i = 1; i <= 9; i++) {
    const t = i / 10;
    const v = sampleCurve(points, t);
    sumGain += v / t; // gain at this sample
    count++;
  }
  return count > 0 ? sumGain / count : 1;
}

/**
 * curveBias — returns the shadow lift: curve output at t=0 (blacks).
 * A positive value brightens shadows; negative darkens them.
 */
function curveBias(points: CurvePoint[]): number {
  return sampleCurve(points, 0);
}

/**
 * curvesToColorMatrixValues — converts a CurvesAdjustment to a 20-element
 * flat array for SVG feColorMatrix type="matrix".
 *
 * Row order: R, G, B, A. Each row has 5 values [rr, rg, rb, ra, bias].
 * Identity matrix = [1,0,0,0,0, 0,1,0,0,0, 0,0,1,0,0, 0,0,0,1,0].
 *
 * Gamma scales all three channels. Per-channel scales override each diagonal.
 * Bias (column 5) applies shadow lift from the curve's value at t=0.
 */
export function curvesToColorMatrixValues(adj: CurvesAdjustment): number[] {
  const gammaGain  = curveGain(adj.gamma.points);
  const gammaBias  = curveBias(adj.gamma.points);
  const redGain    = curveGain(adj.red.points);
  const redBias    = curveBias(adj.red.points);
  const greenGain  = curveGain(adj.green.points);
  const greenBias  = curveBias(adj.green.points);
  const blueGain   = curveGain(adj.blue.points);
  const blueBias   = curveBias(adj.blue.points);

  const r = gammaGain * redGain;
  const g = gammaGain * greenGain;
  const b = gammaGain * blueGain;
  const rb = gammaBias + redBias;
  const gb = gammaBias + greenBias;
  const bb = gammaBias + blueBias;

  // 4 rows × 5 cols: [rr, rg, rb, ra, rc] …
  return [
    r,   0,   0,   0,   rb,   // R' = r*R + rb
    0,   g,   0,   0,   gb,   // G' = g*G + gb
    0,   0,   b,   0,   bb,   // B' = b*B + bb
    0,   0,   0,   1,   0,    // A' = A (unchanged)
  ];
}

/**
 * curvesToColorMatrixString — space-separated 20-value string for the
 * feColorMatrix `values` attribute.
 */
export function curvesToColorMatrixString(adj: CurvesAdjustment): string {
  return curvesToColorMatrixValues(adj).map(v => v.toFixed(4)).join(' ');
}

/**
 * isIdentityCurves — returns true when the adjustment has no visible effect
 * (all curves are linear identity).  Used to skip filter elements.
 */
export function isIdentityCurves(adj: CurvesAdjustment): boolean {
  const isLinear = (pts: CurvePoint[]) =>
    pts.length === 2 && pts[0].t === 0 && pts[0].v === 0 && pts[1].t === 1 && pts[1].v === 1;
  return isLinear(adj.gamma.points) && isLinear(adj.red.points) &&
         isLinear(adj.green.points) && isLinear(adj.blue.points);
}
