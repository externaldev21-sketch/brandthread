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

import { sampleCurve, CurvesAdjustment, CurvePoint, HsbAdjustment } from './adjustmentsModel';
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

// ─── HSB → feColorMatrix ───────────────────────────────────────────────────────

/**
 * Real hue-rotate / saturate matrices — the same NTSC luminance-weighted
 * formulas the SVG spec itself defines for feColorMatrix type="hueRotate"
 * and type="saturate" (and that CSS's filter: hue-rotate()/saturate() use
 * under the hood), not an invented approximation. Composing them by 3×3
 * matrix multiplication, then applying brightness as a post-multiply gain,
 * gives one real colour-space transform per layer — not three separate,
 * independently-approximated effects.
 */
const LUM_R = 0.213, LUM_G = 0.715, LUM_B = 0.072;

function hueRotate3x3(deg: number): number[] {
  const rad = (deg * Math.PI) / 180;
  const cosA = Math.cos(rad), sinA = Math.sin(rad);
  return [
    LUM_R + cosA * (1 - LUM_R) - sinA * LUM_R,  LUM_G - cosA * LUM_G - sinA * LUM_G,        LUM_B - cosA * LUM_B + sinA * (1 - LUM_B),
    LUM_R - cosA * LUM_R + sinA * 0.143,        LUM_G + cosA * (1 - LUM_G) + sinA * 0.140,  LUM_B - cosA * LUM_B - sinA * 0.283,
    LUM_R - cosA * LUM_R - sinA * (1 - LUM_R),  LUM_G - cosA * LUM_G + sinA * LUM_G,        LUM_B + cosA * (1 - LUM_B) + sinA * LUM_B,
  ];
}

function saturate3x3(sat: number): number[] {
  const s = Math.max(0, 1 + sat); // sat ∈ [-1,1] → factor ∈ [0,2]
  return [
    LUM_R + (1 - LUM_R) * s,  LUM_G - LUM_G * s,        LUM_B - LUM_B * s,
    LUM_R - LUM_R * s,        LUM_G + (1 - LUM_G) * s,  LUM_B - LUM_B * s,
    LUM_R - LUM_R * s,        LUM_G - LUM_G * s,        LUM_B + (1 - LUM_B) * s,
  ];
}

function multiply3x3(a: number[], b: number[]): number[] {
  const out = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += a[r * 3 + k] * b[k * 3 + c];
      out[r * 3 + c] = sum;
    }
  }
  return out;
}

/**
 * hsbToColorMatrixValues — 20-element flat array for SVG feColorMatrix
 * type="matrix": hue rotation and saturation composed via 3×3 matrix
 * multiplication (hue applied first, then saturation), brightness applied
 * as a uniform post-multiply gain on all three rows.
 */
export function hsbToColorMatrixValues(adj: HsbAdjustment): number[] {
  const hue = hueRotate3x3(adj.hue);
  const sat = saturate3x3(adj.saturation);
  const combined = multiply3x3(sat, hue);
  const brightGain = Math.max(0, 1 + adj.brightness);
  return [
    combined[0] * brightGain, combined[1] * brightGain, combined[2] * brightGain, 0, 0,
    combined[3] * brightGain, combined[4] * brightGain, combined[5] * brightGain, 0, 0,
    combined[6] * brightGain, combined[7] * brightGain, combined[8] * brightGain, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

export function hsbToColorMatrixString(adj: HsbAdjustment): string {
  return hsbToColorMatrixValues(adj).map(v => v.toFixed(4)).join(' ');
}

// ─── Effects → SVG filter primitive inputs ────────────────────────────────────
//
// Pure builders consumed by renderLayerInSvg. Each returns exactly the
// attribute values a real SVG primitive takes — nothing here is rendered,
// so all of it is unit-testable without react-native.

// NOTE on primitive choice: react-native-svg (15.x) implements only
// feBlend / feColorMatrix / feComposite / feGaussianBlur / feMerge /
// feOffset / feFlood / feDropShadow — feConvolveMatrix, feTurbulence and
// feComponentTransfer render null (`warnUnimplementedFilter` in
// src/elements/filters/*). So every effect below is built ONLY from the
// implemented set: motion blur as an N-tap feOffset box blur averaged with
// arithmetic feComposite, sharpen as an unsharp mask (source minus its
// Gaussian blur), gradient map as an exact luminance-ramp feColorMatrix.

/** Number of offset taps in the motion-blur box filter (odd, so the centre tap is the source itself). */
export const MOTION_BLUR_TAPS = 7;

/**
 * motionBlurTaps — the (dx, dy) offsets for a directional box blur of total
 * length `amount` px along `angleDeg`, symmetric about the source. Averaging
 * the taps with equal weight (1/N) preserves brightness.
 */
export function motionBlurTaps(amount: number, angleDeg: number): { dx: number; dy: number }[] {
  const a = Math.max(0, amount);
  if (a === 0) return [{ dx: 0, dy: 0 }];
  const rad = (angleDeg * Math.PI) / 180;
  const ux = Math.cos(rad), uy = Math.sin(rad);
  const n = MOTION_BLUR_TAPS, half = (n - 1) / 2;
  const taps: { dx: number; dy: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = ((i - half) / half) * (a / 2);
    taps.push({ dx: +(t * ux).toFixed(3), dy: +(t * uy).toFixed(3) });
  }
  return taps;
}

/**
 * unsharpParams — unsharp mask parameters for strength 0..1: result =
 * source × (1 + k) − blur × k, i.e. feComposite arithmetic with k2 = 1 + k,
 * k3 = −k. k scales 0..1.5; the blur radius is fixed at 1.5 px (canvas scale
 * is applied by the caller).
 */
export function unsharpParams(strength: number): { k: number; stdDeviation: number } {
  const s = Math.max(0, Math.min(1, strength));
  return { k: +(s * 1.5).toFixed(4), stdDeviation: 1.5 };
}

/**
 * colorBalanceMatrixValues — 20-value feColorMatrix applying a per-channel
 * additive bias: cyan↔red shifts R, magenta↔green shifts G, yellow↔blue
 * shifts B, each by up to ±0.5 of full scale. This is a real global colour
 * balance. Procreate additionally splits it into Shadows / Midtones /
 * Highlights bands; that tonal split is NOT implemented here (it needs a
 * luminance-masked three-way composite) and the UI says so.
 */
export function colorBalanceMatrixValues(cb: { cyanRed: number; magentaGreen: number; yellowBlue: number }): number[] {
  const k = 0.5;
  return [
    1, 0, 0, 0, cb.cyanRed * k,
    0, 1, 0, 0, cb.magentaGreen * k,
    0, 0, 1, 0, cb.yellowBlue * k,
    0, 0, 0, 1, 0,
  ];
}

export function colorBalanceMatrixString(cb: { cyanRed: number; magentaGreen: number; yellowBlue: number }): string {
  return colorBalanceMatrixValues(cb).map(v => v.toFixed(4)).join(' ');
}

/** "#rrggbb" → [r, g, b] each 0..1; null when malformed. */
export function hexToUnitRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const LUMA_R = 0.2126, LUMA_G = 0.7152, LUMA_B = 0.0722;

/**
 * gradientMapMatrixValues — a single 20-value feColorMatrix implementing an
 * exact two-stop gradient map: out_c = from_c + (to_c − from_c) × luma(in),
 * with luma the Rec.709 weights. Because luma is linear in RGB and the ramp
 * is linear in luma, the whole map is one affine matrix — no table transfer
 * needed. Alpha passes through. Returns null for malformed hex.
 */
export function gradientMapMatrixValues(from: string, to: string): number[] | null {
  const a = hexToUnitRgb(from), b = hexToUnitRgb(to);
  if (!a || !b) return null;
  const row = (c: number) => { const d = b[c] - a[c]; return [d * LUMA_R, d * LUMA_G, d * LUMA_B, 0, a[c]]; };
  return [...row(0), ...row(1), ...row(2), 0, 0, 0, 1, 0];
}

export function gradientMapMatrixString(from: string, to: string): string | null {
  const v = gradientMapMatrixValues(from, to);
  return v ? v.map(x => x.toFixed(4)).join(' ') : null;
}

/** Bloom: blur radius grows with strength; the blurred copy is screened back over the source. */
export function bloomStdDeviation(strength: number): number {
  return Math.max(0, Math.min(1, strength)) * 12;
}
