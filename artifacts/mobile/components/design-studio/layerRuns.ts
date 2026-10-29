/**
 * layerRuns.ts — how a design's layer stack splits for full-resolution
 * rendering: plain drawing layers are replayed from their stroke records by
 * the paint engine; everything else (text / image / shape, and drawing
 * layers whose look needs the SVG pipeline) is grouped into runs of
 * consecutive layers rasterised by an SVG renderer. Shared by the canvas's
 * Share Image export and the Design Export screen.
 */

import type { DesignLayer } from '@/services/designTypes';
import { buildAdjustmentStages } from './layerFilterChain';

export type LayerRun = { kind: 'drawing'; key: string; layer: DesignLayer } | { kind: 'svg'; key: string; layers: DesignLayer[] };

/**
 * A drawing layer whose look depends on the SVG pipeline — adjustments
 * (HSB, curves, blur, …), Distort / Warp / Liquify, or a clipping mask —
 * renders as an SVG image of its engine pixels so those keep applying.
 */
export function drawingNeedsSvg(l: DesignLayer): boolean {
  if (l.type !== 'drawing') return false;
  const t = l.transform;
  return buildAdjustmentStages(l.adjustments, 1).stages.length > 0
    || !!t.affineSvgMatrix
    || Math.abs(t.liquifyDx ?? 0) > 0.01 || Math.abs(t.liquifyDy ?? 0) > 0.01
    || !!l.clippingMask;
}

/** Splits the (non-template) layer stack into raster drawing layers and runs of consecutive SVG-rendered layers, bottom → top. */
export function buildLayerRuns(all: DesignLayer[]): LayerRun[] {
  const runs: LayerRun[] = [];
  for (const l of [...all].filter(x => !x.isTemplate).sort((a, b) => a.order - b.order)) {
    if (l.type === 'drawing' && !drawingNeedsSvg(l)) { runs.push({ kind: 'drawing', key: l.id, layer: l }); continue; }
    const last = runs[runs.length - 1];
    if (last && last.kind === 'svg') last.layers.push(l); else runs.push({ kind: 'svg', key: `run_${l.id}`, layers: [l] });
  }
  return runs;
}
