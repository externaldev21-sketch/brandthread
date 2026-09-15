/**
 * lib/designExportPolicy.ts — Single contract for all Design Studio master exports.
 *
 * ─── Philosophy ──────────────────────────────────────────────────────────────
 *
 * Every pixel that leaves the Design Studio to the outside world (gallery,
 * product listing, post, share sheet, camera roll, download) must be:
 *
 *   1. FULL-RESOLUTION — exact logical canvas or crop dimensions, no
 *      downscaling, no thumbnail cap, no display-canvas fallback.
 *
 *   2. VERIFIED — after encode, the output dimensions are asserted to equal
 *      the descriptor. A mismatch throws; silence is not acceptable.
 *
 *   3. TYPED — every downstream handoff carries a MasterExportAsset descriptor
 *      so any future upload receives exact file + metadata without a
 *      re-encode step.
 *
 * ─── Source of truth ─────────────────────────────────────────────────────────
 *
 * Dimensions come from:
 *   a) project.canvas.width / project.canvas.height  (preferred: logical canvas)
 *   b) cropRect.w / cropRect.h                       (when a crop is active)
 *
 * NEVER from canvasSize (display pixels — depends on screen density / window).
 *
 * ─── Format constants ────────────────────────────────────────────────────────
 *
 * PNG is the default master format:  lossless, alpha-capable, byte-identical
 * across platforms.  JPEG is an optional lossy alternative with a quality
 * floor and default of 0.95.
 */

// ─── Format constants ─────────────────────────────────────────────────────────

/** Default master format — always PNG unless the user explicitly chooses JPEG. */
export const DEFAULT_MASTER_FORMAT: 'png' | 'jpeg' = 'png';

/** Default JPEG quality when the user requests JPEG output. */
export const MASTER_JPEG_QUALITY = 0.95;

/** Minimum permitted JPEG quality — never go below this. */
export const MIN_JPEG_QUALITY = 0.95;

// ─── MasterDescriptor ─────────────────────────────────────────────────────────

/**
 * MasterDescriptor — the validated, immutable description of the output frame.
 *
 * Build one via `resolveMasterDescriptor` before calling `captureFullResolutionPngBase64`.
 * Pass it through every downstream helper so the URI + metadata travel together.
 */
export interface MasterDescriptor {
  /** Exact output width in pixels (integer, > 0, finite, safe). */
  readonly width: number;
  /** Exact output height in pixels (integer, > 0, finite, safe). */
  readonly height: number;
  /** X offset of the crop window in logical canvas coords (0 if no crop). */
  readonly cropX: number;
  /** Y offset of the crop window in logical canvas coords (0 if no crop). */
  readonly cropY: number;
  /** True when a crop region is active (cropX/Y may be non-zero). */
  readonly hasCrop: boolean;
}

// ─── MasterExportAsset ────────────────────────────────────────────────────────

/**
 * MasterExportAsset — the typed, immutable result of a full-resolution export.
 *
 * Downstream handoffs (product listing, post composer, share sheet, future
 * upload) receive this object.  The URI points to the already-encoded file;
 * no further resize/re-encode step is needed or permitted.
 */
export interface MasterExportAsset {
  /** Local file URI (file:// on native, data: URL on web) pointing to the
   *  already-encoded master. Do NOT re-encode. */
  readonly uri: string;
  /** MIME type of the encoded file. */
  readonly mimeType: 'image/png' | 'image/jpeg';
  /** Exact width asserted after encode. */
  readonly width: number;
  /** Exact height asserted after encode. */
  readonly height: number;
  /** Format used. */
  readonly format: 'png' | 'jpeg';
  /** True ↔ PNG (lossless). False ↔ JPEG. */
  readonly lossless: boolean;
  /** JPEG quality used (undefined for PNG). */
  readonly quality?: number;
}

// ─── Descriptor resolution ────────────────────────────────────────────────────

/**
 * ExportDimensionError — thrown when the project dimensions cannot produce a
 * valid master (non-finite, ≤ 0, fractional, or unsafe integer).
 */
export class ExportDimensionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportDimensionError';
  }
}

/**
 * resolveMasterDescriptor — derive and validate the exact output frame.
 *
 * @param canvasWidth  project.canvas.width  (logical canvas width in px)
 * @param canvasHeight project.canvas.height (logical canvas height in px)
 * @param cropRect     optional crop region (logical canvas coordinates)
 *
 * Throws ExportDimensionError for any dimension that is:
 *   – not finite (NaN, ±Infinity)
 *   – ≤ 0
 *   – not an integer (fractional logical dimensions)
 *   – not a safe integer (> Number.MAX_SAFE_INTEGER)
 *
 * Fractional dimensions are rejected. The source of truth is project.canvas,
 * not the display canvas (canvasSize).
 */
export function resolveMasterDescriptor(
  canvasWidth: number,
  canvasHeight: number,
  cropRect?: { x: number; y: number; w: number; h: number } | null,
): MasterDescriptor {
  const rawW = cropRect?.w ?? canvasWidth;
  const rawH = cropRect?.h ?? canvasHeight;
  const cropX = cropRect?.x ?? 0;
  const cropY = cropRect?.y ?? 0;

  assertDimension(canvasWidth, 'canvas width');
  assertDimension(canvasHeight, 'canvas height');
  assertDimension(rawW, 'width');
  assertDimension(rawH, 'height');
  if (!Number.isSafeInteger(cropX) || cropX < 0 ||
      !Number.isSafeInteger(cropY) || cropY < 0) {
    throw new ExportDimensionError('Export crop origin must use non-negative integer pixels.');
  }
  if (cropX + rawW > canvasWidth || cropY + rawH > canvasHeight) {
    throw new ExportDimensionError('Export crop must remain inside the logical canvas.');
  }

  return {
    width: rawW,
    height: rawH,
    cropX,
    cropY,
    hasCrop: cropRect != null,
  };
}

/** Validate a single dimension and throw ExportDimensionError if invalid. */
export function assertDimension(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new ExportDimensionError(
      `Export ${label} is not finite (got ${value}). Check project canvas settings.`,
    );
  }
  if (value <= 0) {
    throw new ExportDimensionError(
      `Export ${label} must be > 0 (got ${value}). Check project canvas settings.`,
    );
  }
  if (!Number.isSafeInteger(value)) {
    throw new ExportDimensionError(
      `Export ${label} (${value}) is not a safe integer. Maximum supported dimension is ${Number.MAX_SAFE_INTEGER}.`,
    );
  }
}

// ─── Dimension verification ───────────────────────────────────────────────────

/**
 * ExportVerificationError — thrown when post-encode dimension check fails.
 *
 * The export pipeline must fail loudly here; silent acceptance of wrong
 * dimensions would allow a downstream upload to use a mismatched file.
 */
export class ExportVerificationError extends Error {
  constructor(
    public readonly expected: { width: number; height: number },
    public readonly actual:   { width: number; height: number },
  ) {
    super(
      `Export dimension mismatch: expected ${expected.width}×${expected.height} ` +
      `but encoded output is ${actual.width}×${actual.height}. ` +
      `This may indicate a display-canvas fallback was used. Aborting.`,
    );
    this.name = 'ExportVerificationError';
  }
}

/**
 * verifyExportDimensions (web) — decode the PNG data URL into an <img> element
 * and assert naturalWidth/naturalHeight equal the descriptor.
 *
 * Returns a Promise that rejects with ExportVerificationError on mismatch.
 * The input bytes are NOT altered.
 *
 * @param dataUrl  PNG or JPEG data URL produced by the encoder.
 * @param desc     The MasterDescriptor used to drive the encode.
 */
export function verifyExportDimensionsWeb(
  dataUrl: string,
  desc: MasterDescriptor,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Only available in a real browser context.
    if (typeof window === 'undefined' || typeof window.Image === 'undefined') {
      // In non-browser environments (native, tests), skip web verification.
      resolve();
      return;
    }
    const img = new window.Image();
    img.onload = () => {
      const aw = img.naturalWidth;
      const ah = img.naturalHeight;
      if (aw !== desc.width || ah !== desc.height) {
        reject(new ExportVerificationError(
          { width: desc.width, height: desc.height },
          { width: aw, height: ah },
        ));
      } else {
        resolve();
      }
    };
    img.onerror = () =>
      reject(new Error('verifyExportDimensions: could not decode data URL for verification.'));
    img.src = dataUrl;
  });
}

/**
 * verifyExportDimensionsNative — assert that a written PNG file has the
 * expected dimensions using the React Native Image.getSize API.
 *
 * Returns a Promise that rejects with ExportVerificationError on mismatch.
 * The file bytes are NOT altered.
 *
 * @param fileUri  Local file URI (file://...) of the written PNG.
 * @param desc     The MasterDescriptor used to drive the encode.
 * @param getSize  The Image.getSize function from 'react-native' (injected for testability).
 */
export function verifyExportDimensionsNative(
  fileUri: string,
  desc: MasterDescriptor,
  getSize: (
    uri: string,
    success: (w: number, h: number) => void,
    failure: (err: unknown) => void,
  ) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    getSize(
      fileUri,
      (w, h) => {
        if (w !== desc.width || h !== desc.height) {
          reject(new ExportVerificationError(
            { width: desc.width, height: desc.height },
            { width: w, height: h },
          ));
        } else {
          resolve();
        }
      },
      (err) => reject(new Error(`verifyExportDimensionsNative: getSize failed — ${err}`)),
    );
  });
}

// ─── JPEG quality helpers ─────────────────────────────────────────────────────

/**
 * clampJpegQuality — ensure a JPEG quality value is within [MIN_JPEG_QUALITY, 1].
 * Always returns a value ≥ MIN_JPEG_QUALITY so we never silently produce
 * lower-quality output than the floor.
 */
export function clampJpegQuality(q: number): number {
  return Math.max(MIN_JPEG_QUALITY, Math.min(1, q));
}

// ─── Format label helpers (for Share UI) ─────────────────────────────────────

/**
 * pngLabel — human-readable label for the PNG export option in Share UI.
 * Format: "PNG — Lossless · {W} × {H}"
 */
export function pngLabel(desc: MasterDescriptor): string {
  return `PNG — Lossless · ${desc.width} × ${desc.height}`;
}

/**
 * jpegLabel — human-readable label for the JPEG export option in Share UI.
 * Format: "JPEG — High quality (95%) · {W} × {H}"
 */
export function jpegLabel(desc: MasterDescriptor, quality = MASTER_JPEG_QUALITY): string {
  const pct = Math.round(quality * 100);
  return `JPEG — High quality (${pct}%) · ${desc.width} × ${desc.height}`;
}

/**
 * cropDimensionLabel — concise crop summary for sub-text in Share UI.
 * Format: "{W} × {H} (cropped)" or "{W} × {H}"
 */
export function cropDimensionLabel(desc: MasterDescriptor): string {
  return desc.hasCrop
    ? `${desc.width} × ${desc.height} (cropped)`
    : `${desc.width} × ${desc.height}`;
}

