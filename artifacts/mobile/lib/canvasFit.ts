/**
 * Aspect-fit math for the design canvas artboard.
 *
 * The artboard must keep the design's aspect ratio: ONE uniform scale
 * (min of the two axis ratios) maps logical canvas pixels to display
 * points, and the scaled artboard is centred inside the available area
 * (the stage minus any reserved insets for floating chrome such as the
 * left size/opacity rail and the sub-mode bars).
 *
 * Every consumer (drawing input, transform handles, selection, crop, text
 * placement, eyedropper, Canvas Info) reads `scale` and the artboard's
 * `width`/`height`; `offsetX`/`offsetY` position the artboard View inside
 * the stage, so touch `locationX/Y` on the artboard stay artboard-local.
 */

export interface CanvasFitInsets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface CanvasFitInput {
  /** Measured stage width (display points). */
  stageW: number;
  /** Measured stage height (display points). */
  stageH: number;
  /** Logical artboard width (design pixels). */
  logicalW: number;
  /** Logical artboard height (design pixels). */
  logicalH: number;
  /** Space reserved for floating chrome / margin on each side. */
  insets?: CanvasFitInsets;
}

export interface CanvasFit {
  /** Uniform logical → display scale. 0 when the stage is unmeasured. */
  scale: number;
  /** Artboard display width (logicalW * scale). */
  width: number;
  /** Artboard display height (logicalH * scale). */
  height: number;
  /** Artboard left edge inside the stage. */
  offsetX: number;
  /** Artboard top edge inside the stage. */
  offsetY: number;
}

const EMPTY_FIT: CanvasFit = { scale: 0, width: 0, height: 0, offsetX: 0, offsetY: 0 };

export function computeCanvasFit({ stageW, stageH, logicalW, logicalH, insets }: CanvasFitInput): CanvasFit {
  const top = Math.max(0, insets?.top ?? 0);
  const right = Math.max(0, insets?.right ?? 0);
  const bottom = Math.max(0, insets?.bottom ?? 0);
  const left = Math.max(0, insets?.left ?? 0);

  const availW = stageW - left - right;
  const availH = stageH - top - bottom;
  if (!(availW > 0) || !(availH > 0) || !(logicalW > 0) || !(logicalH > 0)) return EMPTY_FIT;

  const scale = Math.min(availW / logicalW, availH / logicalH);
  const width = logicalW * scale;
  const height = logicalH * scale;
  return {
    scale,
    width,
    height,
    offsetX: left + (availW - width) / 2,
    offsetY: top + (availH - height) / 2,
  };
}

/** Display point (artboard-local) → logical design pixel. */
export function displayToLogical(fit: CanvasFit, x: number, y: number): { x: number; y: number } {
  const s = fit.scale || 1;
  return { x: x / s, y: y / s };
}
