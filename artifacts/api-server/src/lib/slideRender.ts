/**
 * Photo slide rendering for compose-slideshow (and the quality benchmark):
 * sharp orients + fills a 1080-wide canvas with lanczos3, ffmpeg (in the
 * route) draws any text on the lossless frame, and sharp does the single
 * JPEG encode.
 */
import sharp from "sharp";

// Output canvases per post aspect ratio (the client pre-crops each slide to the
// chosen ratio; compose fills the canvas, cropping any rounding slack). Every
// canvas is 1080 wide — full-screen sharp on a 3x iPhone, same as Instagram.
export const SLIDE_CANVAS: Record<string, { w: number; h: number }> = {
  "9:16": { w: 1080, h: 1920 },
  "3:4": { w: 1080, h: 1440 },
  "4:5": { w: 1080, h: 1350 },
  "1:1": { w: 1080, h: 1080 },
};
// Canvas widths overlay font sizes were authored against before the canvases
// went to 1080; text is scaled by (new / old) so it keeps its size on the slide.
export const LEGACY_SLIDE_WIDTH: Record<string, number> = { "9:16": 720, "3:4": 810, "4:5": 864, "1:1": 1080 };
/** Profile-grid tile width (3 columns on a 3x phone ≈ 390–430 px). */
export const SLIDE_THUMB_WIDTH = 540;
/** Final JPEG settings: one encode, no chroma subsampling so text/edges stay crisp. */
// libjpeg, not mozjpeg: mozjpeg's trellis quantisation smooths fabric texture and
// grain (SSIM 0.75 vs 0.93 at the same "q90" on a 12 MP phone photo).
export const SLIDE_JPEG = { quality: 92, chromaSubsampling: "4:4:4", optimiseCoding: true } as const;

/**
 * Orient + fill one slide onto its canvas (lanczos3), lossless PNG out. The
 * only lossy step of the whole slide pipeline is the final JPEG encode.
 */
export async function renderSlideBase(input: Buffer | string, canvas: { w: number; h: number }): Promise<Buffer> {
  return sharp(input, { failOn: "none" })
    .rotate()
    .resize(canvas.w, canvas.h, { fit: "cover", position: "centre", kernel: "lanczos3" })
    .removeAlpha()
    .png({ compressionLevel: 1 })
    .toBuffer();
}

/** Final slide JPEG + grid thumbnail from a rendered PNG frame. */
export async function encodeSlide(png: Buffer, canvas: { w: number; h: number }): Promise<{ slide: Buffer; thumb: Buffer }> {
  const slide = await sharp(png).jpeg(SLIDE_JPEG).toBuffer();
  const thumb = await sharp(png)
    .resize(SLIDE_THUMB_WIDTH, Math.round((SLIDE_THUMB_WIDTH * canvas.h) / canvas.w), { fit: "cover", kernel: "lanczos3" })
    .jpeg({ quality: 88, optimiseCoding: true })
    .toBuffer();
  return { slide, thumb };
}

