/**
 * designExportPresets — the Format and Size choices on /design-export and the
 * pure geometry behind them.
 *
 * Every size resolves to exact integer output pixels. When the preset's
 * aspect ratio differs from the canvas, the whole design is fitted (never
 * cropped) and centred; the margin is filled with the canvas background, or
 * left transparent for Transparent PNG.
 */

export type DesignExportFormatId = 'png' | 'jpg' | 'tpng' | 'pdf';
export type DesignExportSizeId = 'original' | 'web' | 'product' | 'story' | 'thread' | 'print';

export interface DesignExportFormat {
  id: DesignExportFormatId;
  label: string;
  desc: string;
  /** File extension written to disk / used for the download name. */
  ext: 'png' | 'jpg' | 'pdf';
  mimeType: 'image/png' | 'image/jpeg' | 'application/pdf';
  /** Paint the canvas background behind the layers. */
  includeBackground: boolean;
  /** PDF goes through expo-print, which has no browser implementation. */
  nativeOnly: boolean;
}

export const DESIGN_EXPORT_FORMATS: readonly DesignExportFormat[] = [
  { id: 'png',  label: 'PNG',             desc: 'Lossless, with canvas background',  ext: 'png', mimeType: 'image/png',       includeBackground: true,  nativeOnly: false },
  { id: 'jpg',  label: 'JPEG',            desc: 'High quality, smaller file size',   ext: 'jpg', mimeType: 'image/jpeg',      includeBackground: true,  nativeOnly: false },
  { id: 'tpng', label: 'Transparent PNG', desc: 'Lossless, no background fill',      ext: 'png', mimeType: 'image/png',       includeBackground: false, nativeOnly: false },
  { id: 'pdf',  label: 'PDF',             desc: 'Single page sized to the export',   ext: 'pdf', mimeType: 'application/pdf', includeBackground: true,  nativeOnly: true },
];

export interface DesignExportSize {
  id: DesignExportSizeId;
  label: string;
  /** Fixed output frame, or a target long edge that keeps the canvas ratio. */
  frame: { kind: 'canvas' } | { kind: 'fixed'; width: number; height: number } | { kind: 'longEdge'; px: number };
  note?: string;
}

export const DESIGN_EXPORT_SIZES: readonly DesignExportSize[] = [
  { id: 'original', label: 'Original',     frame: { kind: 'canvas' } },
  { id: 'web',      label: 'Web',          frame: { kind: 'longEdge', px: 1200 } },
  { id: 'product',  label: 'Product Page', frame: { kind: 'fixed', width: 2000, height: 2000 } },
  { id: 'story',    label: 'Story',        frame: { kind: 'fixed', width: 1080, height: 1920 } },
  { id: 'thread',   label: 'Thread Post',  frame: { kind: 'fixed', width: 1080, height: 1350 } },
  { id: 'print',    label: 'Print',        frame: { kind: 'longEdge', px: 3600 }, note: '12 in long edge at 300 DPI' },
];

export function getExportFormat(id: DesignExportFormatId): DesignExportFormat {
  return DESIGN_EXPORT_FORMATS.find(f => f.id === id) ?? DESIGN_EXPORT_FORMATS[0];
}

export function getExportSize(id: DesignExportSizeId): DesignExportSize {
  return DESIGN_EXPORT_SIZES.find(s => s.id === id) ?? DESIGN_EXPORT_SIZES[0];
}

function canvasDims(canvasWidth: number, canvasHeight: number): { cw: number; ch: number } {
  const cw = Number.isFinite(canvasWidth) && canvasWidth > 0 ? canvasWidth : 1080;
  const ch = Number.isFinite(canvasHeight) && canvasHeight > 0 ? canvasHeight : 1080;
  return { cw, ch };
}

/** Exact integer output pixels for a size preset applied to a canvas. */
export function resolveExportPixels(
  sizeId: DesignExportSizeId,
  canvasWidth: number,
  canvasHeight: number,
): { width: number; height: number } {
  const { cw, ch } = canvasDims(canvasWidth, canvasHeight);
  const { frame } = getExportSize(sizeId);
  if (frame.kind === 'fixed') return { width: frame.width, height: frame.height };
  if (frame.kind === 'canvas') return { width: Math.max(1, Math.round(cw)), height: Math.max(1, Math.round(ch)) };
  const scale = frame.px / Math.max(cw, ch);
  return { width: Math.max(1, Math.round(cw * scale)), height: Math.max(1, Math.round(ch * scale)) };
}

/**
 * SVG viewBox (in canvas units) that fits the whole canvas inside an output
 * frame of `outW × outH`, centred. Painting a background rect over this box
 * fills the letterbox margin too.
 */
export function fitCanvasViewBox(
  canvasWidth: number,
  canvasHeight: number,
  outW: number,
  outH: number,
): { x: number; y: number; width: number; height: number } {
  const { cw, ch } = canvasDims(canvasWidth, canvasHeight);
  const scale = Math.min(outW / cw, outH / ch);
  const width = outW / scale;
  const height = outH / scale;
  return { x: -(width - cw) / 2, y: -(height - ch) / 2, width, height };
}

/** Download / file name: "<project>_<size>.<ext>" with filesystem-safe characters. */
export function exportFileName(projectName: string, sizeId: DesignExportSizeId, format: DesignExportFormat): string {
  const slug = (projectName || 'design').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'design';
  return `${slug}_${sizeId}.${format.ext}`;
}
