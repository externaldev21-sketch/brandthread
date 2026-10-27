/**
 * brushPreview.ts — renders a brush's stroke-preview swatch with the REAL
 * paint engine (the same dabs, tip, grain and pressure response the canvas
 * uses), as a PNG data URI for the Brushes panel rows and the Size HUD.
 *
 * The preview stroke is Procreate's: a gentle S-curve drawn with a pressure
 * swell (light → full → light) so tapering brushes show their taper.
 */

import { brushDiameter, type BrushParams } from './brushPresets';
import { PaintEngine } from './engine';
import { encodeSurface, getPlatformBackend } from './platform';
import { drawPathFromRecord, samplesToPts, type StrokeRecord } from './strokeRecord';
import type { StrokeSample } from './dabEmitter';

export const PREVIEW_W = 320;
export const PREVIEW_H = 72;

const cache = new Map<string, string>();

function previewSamples(w: number, h: number): StrokeSample[] {
  const out: StrokeSample[] = [];
  const n = 70;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = w * 0.08 + t * w * 0.84;
    const y = h * 0.5 + Math.sin(t * Math.PI * 2) * h * 0.2;
    const p = Math.sin(t * Math.PI) * 0.9 + 0.1;
    out.push({ x, y, p, t: i * 14 });
  }
  return out;
}

/** Preview diameter in the 320×72 preview space: big brushes clamp so the swatch stays readable. */
function previewDiameter(params: BrushParams): number {
  return Math.max(4, Math.min(34, brushDiameter(params, 0.55, 1080) * 0.75));
}

/** PNG data URI of `params` painted in `color` on transparency, or null without a raster backend. */
export function renderBrushPreview(key: string, params: BrushParams, color: string, scale = 2): string | null {
  const cacheKey = `${key}|${color}|${scale}|${JSON.stringify(params)}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const backend = getPlatformBackend();
  if (!backend) return null;
  const engine = new PaintEngine(backend, PREVIEW_W, PREVIEW_H, { scale, headless: true });
  try {
    const rec: StrokeRecord = {
      v: 1, mode: 'paint', brushId: key, brushName: key, params,
      color, diameter: previewDiameter(params), opacity: 1, seed: 1234, unitScale: 1,
      pts: samplesToPts(previewSamples(PREVIEW_W, PREVIEW_H)),
    };
    engine.sync('preview', [drawPathFromRecord(rec)]);
    const uri = encodeSurface(backend, engine.content('preview'), { format: 'png' });
    if (cache.size > 300) cache.clear();
    cache.set(cacheKey, uri);
    return uri;
  } catch {
    return null;
  } finally {
    engine.removeLayer('preview');
  }
}

/**
 * One dab of the brush at an on-screen diameter (px) — the Size HUD's live
 * preview, so a charcoal shows a charcoal dab and an airbrush a soft cloud,
 * not a generic circle.
 */
export function renderBrushDab(key: string, params: BrushParams, color: string, diameterPx: number): string | null {
  const d = Math.max(2, Math.round(diameterPx));
  const cacheKey = `dab|${key}|${color}|${d}|${JSON.stringify(params)}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const backend = getPlatformBackend();
  if (!backend) return null;
  const size = d + 6;
  const engine = new PaintEngine(backend, size, size, { scale: 2, headless: true });
  try {
    const rec: StrokeRecord = {
      v: 1, mode: 'paint', brushId: key, brushName: key,
      // A single, full-pressure dab: no scatter/jitter so it sits centred.
      params: { ...params, scatter: 0, jitter: 0, sizeJitter: 0, opacityJitter: 0, count: 1, particleSize: 1, taperStart: 0, pressureOpacity: 0, flow: Math.max(params.flow, 0.6) },
      color, diameter: d, opacity: 1, seed: 7, unitScale: 1,
      pts: samplesToPts([{ x: size / 2, y: size / 2, p: 1, t: 0 }]),
    };
    engine.sync('dab', [drawPathFromRecord(rec)]);
    const uri = encodeSurface(backend, engine.content('dab'), { format: 'png' });
    if (cache.size > 300) cache.clear();
    cache.set(cacheKey, uri);
    return uri;
  } catch {
    return null;
  } finally {
    engine.removeLayer('dab');
  }
}
