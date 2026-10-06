import type { DesignLayer } from '@/services/designTypes';

/** Print sizes in mm/inches become pixels at this resolution. */
export const PRINT_DPI = 300;
const MAX_SIDE = 16384;

/**
 * Pixel size for a canvas preset's dimension label, e.g. "2048 × 2048px",
 * "210 × 297mm", '6" × 4"'. Falls back to 1080 × 1080 for anything unparseable.
 */
export function canvasPixelSize(dims: string): { width: number; height: number } {
  const m = /([\d.]+)\s*("|in|mm|px)?\s*[×x]\s*([\d.]+)\s*("|in|mm|px)?/i.exec(dims ?? '');
  if (!m) return { width: 1080, height: 1080 };
  const unit = (m[4] || m[2] || 'px').toLowerCase();
  const scale = unit === 'mm' ? PRINT_DPI / 25.4 : unit === '"' || unit === 'in' ? PRINT_DPI : 1;
  const toPx = (v: string) => Math.min(MAX_SIDE, Math.max(8, Math.round(parseFloat(v) * scale)));
  const width = toPx(m[1]);
  const height = toPx(m[3]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return { width: 1080, height: 1080 };
  return { width, height };
}

/** The first image layer of a canvas created from an imported/captured photo (same shape as the Design gallery's Photo import). */
export function buildImageLayer(opts: {
  id: string;
  name: string;
  uri: string;
  width: number;
  height: number;
  now: string;
}): DesignLayer {
  return {
    id: opts.id, name: opts.name, type: 'image',
    visible: true, locked: false, order: 0, opacity: 1,
    transform: { x: 0, y: 0, width: opts.width, height: opts.height, rotation: 0, scaleX: 1, scaleY: 1 },
    data: { kind: 'image' as const, uri: opts.uri, opacity: 1, fit: 'contain', blendMode: 'normal' },
    createdAt: opts.now, updatedAt: opts.now,
  } as DesignLayer;
}
