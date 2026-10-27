/**
 * composeExport.ts — flattens a design into one surface at full resolution.
 *
 * Drawing layers are re-rendered from their stroke records by a fresh 1:1
 * paint engine (so a 4500×5400 apparel canvas exports at 4500×5400, not at
 * the on-screen working size), one layer at a time to bound memory, then
 * composited with the layer's opacity and blend mode. Non-drawing layers
 * (text / image / shape) arrive pre-rasterised as transparent PNG "runs"
 * from the editor's SVG renderer and are composited in z-order between them.
 *
 * `background: null` leaves the canvas transparent → a PNG with real alpha,
 * exactly Procreate's "hide Background colour, then Share PNG".
 */

import type { BlendModeKind, DrawPath } from '@/services/designTypes';
import type { CompositeMode, IRect, RasterBackend } from './backend';
import { PaintEngine } from './engine';
import { drawEncodedImage } from './platform';

export type ExportItem =
  | {
      kind: 'raster';
      id: string;
      paths: DrawPath[];
      opacity: number;
      blendMode?: BlendModeKind;
      /** Layer box in logical px (drawing layers default to the full canvas). */
      box: IRect;
    }
  | {
      kind: 'image';
      /** Encoded transparent PNG already rendered at the OUTPUT size/crop. */
      uri: string;
    };

export interface ComposeOptions {
  logicalWidth: number;
  logicalHeight: number;
  /** Region of the logical canvas to export (crop). Defaults to the whole canvas. */
  crop?: IRect;
  /** Output px per logical px (1 = native resolution). */
  scale?: number;
  /** Background colour, or null for a transparent export. */
  background: string | null;
  items: ExportItem[];
}

export async function composeExport<S>(backend: RasterBackend<S>, opts: ComposeOptions): Promise<S> {
  const crop = opts.crop ?? { x: 0, y: 0, w: opts.logicalWidth, h: opts.logicalHeight };
  const k = opts.scale ?? 1;
  const outW = Math.max(1, Math.round(crop.w * k));
  const outH = Math.max(1, Math.round(crop.h * k));
  const out = backend.createSurface(outW, outH);
  if (opts.background) backend.fill(out, opts.background, { x: 0, y: 0, w: outW, h: outH });

  for (const item of opts.items) {
    if (item.kind === 'image') {
      await drawEncodedImage(backend, out, item.uri, { x: 0, y: 0, w: outW, h: outH });
      continue;
    }
    if (item.paths.length === 0 || item.opacity <= 0) continue;
    const engine = new PaintEngine(backend, opts.logicalWidth, opts.logicalHeight, { scale: k, headless: true });
    try {
      engine.sync(item.id, item.paths);
      const src = engine.content(item.id);
      const full: IRect = { x: 0, y: 0, w: engine.width, h: engine.height };
      // The raster spans the whole logical canvas; place it in the layer's box, shifted by the crop.
      const sx = item.box.w / opts.logicalWidth, sy = item.box.h / opts.logicalHeight;
      const dst: IRect = {
        x: (item.box.x - crop.x) * k,
        y: (item.box.y - crop.y) * k,
        w: engine.width * sx,
        h: engine.height * sy,
      };
      backend.draw(out, src, full, dst, item.opacity, blendToComposite(item.blendMode));
    } finally {
      engine.removeLayer(item.id);
    }
  }
  return out;
}

export function blendToComposite(mode: BlendModeKind | undefined): CompositeMode {
  switch (mode) {
    case 'multiply': case 'screen': case 'overlay': case 'darken': case 'lighten': return mode;
    default: return 'over';
  }
}

/** CSS / RN `mixBlendMode` value for a layer blend mode. */
export function cssBlend(mode: BlendModeKind | undefined): 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' {
  return (mode ?? 'normal') as 'normal';
}
