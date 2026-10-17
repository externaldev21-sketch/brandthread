/**
 * Pure helpers for design-export.tsx: output dimensions per size preset,
 * file names, and the one-page PDF wrapper. Kept free of React Native so they
 * can be unit tested.
 */

export type DesignExportFormat = 'png' | 'jpg' | 'tpng' | 'pdf' | 'project';
export type DesignExportSize = 'original' | 'web' | 'product' | 'story' | 'thread' | 'print';

/** Hard ceiling on either side of an export, to keep native memory sane. */
export const MAX_EXPORT_SIDE = 4096;

/**
 * Bounding box each size preset fits the canvas into (aspect ratio is always
 * preserved — the design is never stretched or cropped). `null` = canvas size;
 * `scale` multiplies the canvas size instead of fitting it into a box.
 */
const SIZE_RULES: Record<DesignExportSize, { box?: [number, number]; scale?: number }> = {
  original: {},
  web:      { box: [1200, 1200] },
  product:  { box: [2000, 2000] },
  story:    { box: [1080, 1920] },
  thread:   { box: [1080, 1350] },
  print:    { scale: 3 },
};

export function resolveExportDimensions(
  canvasWidth: number,
  canvasHeight: number,
  size: DesignExportSize,
): { width: number; height: number } {
  const cw = canvasWidth > 0 ? canvasWidth : 1080;
  const ch = canvasHeight > 0 ? canvasHeight : 1080;
  const rule = SIZE_RULES[size] ?? {};
  let factor = 1;
  if (rule.box) factor = Math.min(rule.box[0] / cw, rule.box[1] / ch);
  else if (rule.scale) factor = rule.scale;
  // Never exceed the hard ceiling, whatever the preset asked for.
  factor = Math.min(factor, MAX_EXPORT_SIDE / cw, MAX_EXPORT_SIDE / ch);
  return {
    width: Math.max(1, Math.round(cw * factor)),
    height: Math.max(1, Math.round(ch * factor)),
  };
}

export function exportExtension(format: DesignExportFormat): string {
  switch (format) {
    case 'jpg': return 'jpg';
    case 'pdf': return 'pdf';
    case 'project': return 'json';
    default: return 'png';
  }
}

/** "Summer Drop / Hoodie" → "Summer_Drop_Hoodie.png" */
export function exportFileName(projectName: string | null | undefined, format: DesignExportFormat): string {
  const slug = (projectName ?? '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'design';
  const suffix = format === 'tpng' ? '_transparent' : '';
  return `${slug}${suffix}.${exportExtension(format)}`;
}

/** A single page sized to the image, with the PNG embedded as a data URL. */
export function buildDesignPdfHtml(pngDataUrl: string, width: number, height: number): string {
  return `<!doctype html><html><head><meta charset="utf-8" />
<style>@page { size: ${width}px ${height}px; margin: 0; } html,body { margin:0; padding:0; }
img { display:block; width:${width}px; height:${height}px; }</style></head>
<body><img src="${pngDataUrl}" /></body></html>`;
}
