/**
 * layerFilterChain.tsx — the ONE builder of a layer's adjustment filter
 * stages, shared by the editor (app/design-canvas.tsx renderLayerInSvg) and
 * every read-only surface that composites a saved project
 * (components/DesignLayerCompositor.tsx: gallery thumbnails, preview modals,
 * the mockup preview). Both call this, so what you see on the canvas is —
 * structurally, not by copy — what exports and thumbnails show.
 *
 * Stage order: hsb → curves → colour balance → gradient map → gaussian blur →
 * motion blur → sharpen → chromatic aberration → bloom. Every stage reads the
 * previous stage's `result` and names its own (`chain(resultName)`), so adding
 * a stage never means re-wiring its neighbours. `lastResult` is the name the
 * caller feeds into any further stage of its own (the editor appends a
 * feBlend for layer blend modes).
 *
 * Only primitives react-native-svg 15 actually implements natively are used
 * (feColorMatrix / feComposite / feGaussianBlur / feOffset / feBlend) — see
 * lib/layerRenderer.ts for why feConvolveMatrix / feTurbulence /
 * feComponentTransfer are deliberately avoided.
 */
import React from 'react';
import { FeColorMatrix, FeComposite, FeGaussianBlur, FeOffset, FeBlend } from 'react-native-svg';
import type { DesignLayerAdjustments } from '@/lib/adjustmentsModel';
import { isIdentityHsb, isIdentityEffects } from '@/lib/adjustmentsModel';
import {
  hsbToColorMatrixString, curvesToColorMatrixString, isIdentityCurves,
  colorBalanceMatrixString, gradientMapMatrixString, motionBlurTaps, unsharpParams, bloomStdDeviation,
} from '@/lib/layerRenderer';

export interface AdjustmentStages {
  /** Filter primitive elements, in order; empty when nothing changes a pixel. */
  stages: React.ReactNode[];
  /** The `result` name of the final stage ('SourceGraphic' when there are none). */
  lastResult: string;
}

/** Sanitise a layer id into something legal as an SVG id fragment. */
export function safeSvgId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '_');
}

/**
 * Build the adjustment stages for a layer. `xScale` is the logical→display
 * scale so pixel-sized effects (blur radius, motion length, chromatic shift)
 * stay proportional at any render size — a 4 px blur on a 1080 px canvas is
 * the same relative blur on a 120 px thumbnail.
 */
export function buildAdjustmentStages(
  adjustments: DesignLayerAdjustments | undefined,
  xScale: number,
): AdjustmentStages {
  const stages: React.ReactNode[] = [];
  let prev = 'SourceGraphic';
  const chain = (resultName: string) => { const inName = prev; prev = resultName; return inName; };

  const hsbAdj = adjustments?.hsb;
  if (hsbAdj && !isIdentityHsb(hsbAdj)) {
    stages.push(<FeColorMatrix key="hsb" type="matrix" in={chain('hsbd')} values={hsbToColorMatrixString(hsbAdj)} result="hsbd" />);
  }

  const curvesAdj = adjustments?.curves;
  if (curvesAdj && !isIdentityCurves(curvesAdj)) {
    stages.push(<FeColorMatrix key="curves" type="matrix" in={chain('curved')} values={curvesToColorMatrixString(curvesAdj)} result="curved" />);
  }

  const fxRaw = adjustments?.effects;
  const fx = fxRaw && !isIdentityEffects(fxRaw) ? fxRaw : null;
  if (fx) {
    const cb = fx.colorBalance;
    if (cb && (cb.cyanRed || cb.magentaGreen || cb.yellowBlue)) {
      stages.push(<FeColorMatrix key="cbal" type="matrix" in={chain('cbal')} values={colorBalanceMatrixString(cb)} result="cbal" />);
    }
    // Gradient Map: one exact luminance-ramp feColorMatrix (from + (to−from)·luma),
    // blended back over the source by `mix`.
    const gm = fx.gradientMap;
    const gmMatrix = gm && gm.mix > 0 ? gradientMapMatrixString(gm.from, gm.to) : null;
    if (gm && gmMatrix) {
      const i = chain('gmap');
      stages.push(
        <React.Fragment key="gmap">
          <FeColorMatrix type="matrix" in={i} values={gmMatrix} result="gm_ramp" />
          <FeComposite in="gm_ramp" in2={i} operator="arithmetic" k1={0} k2={gm.mix} k3={1 - gm.mix} k4={0} result="gmap" />
        </React.Fragment>,
      );
    }
    if (fx.gaussianBlur) {
      stages.push(<FeGaussianBlur key="gblur" in={chain('gblur')} stdDeviation={fx.gaussianBlur * xScale} result="gblur" />);
    }
    // Motion Blur: a directional box blur built from N feOffset taps averaged
    // with equal weight via arithmetic feComposite (react-native-svg has no
    // feConvolveMatrix — see layerRenderer.ts).
    const mb = fx.motionBlur;
    if (mb && mb.amount > 0) {
      const i = chain('mblur');
      const taps = motionBlurTaps(mb.amount * xScale, mb.angle);
      const w = 1 / taps.length;
      const nodes: React.ReactNode[] = [];
      taps.forEach((t, idx) => {
        nodes.push(<FeOffset key={`mb_t${idx}`} in={i} dx={t.dx} dy={t.dy} result={`mb_t${idx}`} />);
        nodes.push(
          idx === 0
            ? <FeComposite key="mb_a0" in="mb_t0" in2="mb_t0" operator="arithmetic" k1={0} k2={w} k3={0} k4={0} result="mb_a0" />
            : <FeComposite key={`mb_a${idx}`} in={`mb_a${idx - 1}`} in2={`mb_t${idx}`} operator="arithmetic" k1={0} k2={1} k3={w} k4={0} result={idx === taps.length - 1 ? 'mblur' : `mb_a${idx}`} />,
        );
      });
      stages.push(<React.Fragment key="mblur">{nodes}</React.Fragment>);
    }
    // Sharpen: unsharp mask — source × (1 + k) − blur × k.
    if (fx.sharpen) {
      const i = chain('sharp');
      const u = unsharpParams(fx.sharpen);
      stages.push(
        <React.Fragment key="sharp">
          <FeGaussianBlur in={i} stdDeviation={u.stdDeviation * xScale} result="sh_blur" />
          <FeComposite in={i} in2="sh_blur" operator="arithmetic" k1={0} k2={1 + u.k} k3={-u.k} k4={0} result="sharp" />
        </React.Fragment>,
      );
    }
    if (fx.chromatic) {
      const d = fx.chromatic * xScale;
      const i = chain('chrom');
      stages.push(
        <React.Fragment key="chrom">
          {/* Split R / G / B, push red right and blue left, add them back. */}
          <FeColorMatrix type="matrix" in={i} values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="ca_r" />
          <FeOffset in="ca_r" dx={d} dy={0} result="ca_r_off" />
          <FeColorMatrix type="matrix" in={i} values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="ca_g" />
          <FeColorMatrix type="matrix" in={i} values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="ca_b" />
          <FeOffset in="ca_b" dx={-d} dy={0} result="ca_b_off" />
          <FeComposite in="ca_r_off" in2="ca_g" operator="arithmetic" k1={0} k2={1} k3={1} k4={0} result="ca_rg" />
          <FeComposite in="ca_rg" in2="ca_b_off" operator="arithmetic" k1={0} k2={1} k3={1} k4={0} result="chrom" />
        </React.Fragment>,
      );
    }
    if (fx.bloom) {
      const i = chain('bloom');
      stages.push(
        <React.Fragment key="bloom">
          <FeGaussianBlur in={i} stdDeviation={bloomStdDeviation(fx.bloom) * xScale} result="bl_blur" />
          <FeBlend in={i} in2="bl_blur" mode="screen" result="bloom" />
        </React.Fragment>,
      );
    }
  }

  return { stages, lastResult: prev };
}
