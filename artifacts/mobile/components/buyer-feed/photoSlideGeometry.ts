/**
 * Geometry for slideshow Threads: each slide keeps its own aspect ratio
 * (authored ratio first, then the image's natural ratio) and is fitted
 * inside the page with "contain" — never cropped, never stretched.
 */
export type SlideRect = { left: number; top: number; width: number; height: number };

export function isValidAspect(a: unknown): a is number {
  return typeof a === 'number' && Number.isFinite(a) && a > 0;
}

/** Authored aspect wins; else natural (w/h); else undefined. */
export function resolveSlideAspect(
  authored?: number | null,
  natural?: { width?: number; height?: number } | null,
): number | undefined {
  if (isValidAspect(authored)) return authored;
  if (natural && isValidAspect(natural.width) && isValidAspect(natural.height)) return natural.width / natural.height;
  return undefined;
}

/** Largest rect of `aspect` (w/h) that fits inside the page, centred. */
export function containRect(pageWidth: number, pageHeight: number, aspect?: number): SlideRect {
  if (pageWidth <= 0 || pageHeight <= 0) return { left: 0, top: 0, width: 0, height: 0 };
  if (!isValidAspect(aspect)) return { left: 0, top: 0, width: pageWidth, height: pageHeight };
  let width = pageWidth;
  let height = pageWidth / aspect;
  if (height > pageHeight) { height = pageHeight; width = pageHeight * aspect; }
  return { left: (pageWidth - width) / 2, top: (pageHeight - height) / 2, width, height };
}
