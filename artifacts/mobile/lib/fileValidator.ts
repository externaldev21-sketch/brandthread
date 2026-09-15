/**
 * fileValidator.ts — strict file validation for the Insert File flow.
 *
 * Security model:
 *  1. MIME+extension must be an allowlisted *exact pair* — SVG MIME with .png
 *     name, or an executable MIME renamed to .jpg, are both rejected.
 *  2. After MIME+extension pass, the actual file magic bytes are inspected to
 *     confirm the binary matches the claimed type.  This catches polyglot files
 *     and renames (e.g. an ELF binary renamed to .png).
 *  3. JSON: read actual bytes via File.text(), compute UTF-8 byte length, and
 *     reject >512 KB regardless of asset.size metadata (which may be missing
 *     or spoofed by the picker).
 *
 * All functions are pure and testable in Vitest (no React imports).
 */

// ─── Allowed raster MIME+extension pairs ─────────────────────────────────────

/** Exact MIME → allowed lowercase extensions map. */
export const MIME_EXT_PAIRS: Record<string, string[]> = {
  'image/png':  ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/gif':  ['gif'],
  'image/webp': ['webp'],
};

/** Allowed MIME types for document picker (used as the picker filter). */
export const ALLOWED_IMAGE_MIMES = Object.keys(MIME_EXT_PAIRS);

/** JSON MIME type. */
export const JSON_MIME = 'application/json';

// ─── Magic byte signatures ────────────────────────────────────────────────────

/** Minimum bytes needed to identify any of our supported image types. */
export const MAGIC_MIN_BYTES = 12;

/**
 * Image magic-byte signatures.
 * Each entry: { mime, check: (first N bytes) → boolean }
 */
export const IMAGE_MAGIC: Array<{ mime: string; check: (b: Uint8Array) => boolean }> = [
  {
    mime: 'image/png',
    check: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    mime: 'image/jpeg',
    check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/gif',
    check: (b) =>
      b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 &&
      b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61,
  },
  {
    mime: 'image/webp',
    check: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];

// ─── Discriminated result ─────────────────────────────────────────────────────

export type ValidateOk  = { ok: true };
export type ValidateErr = { ok: false; reason: string };
export type ValidateResult = ValidateOk | ValidateErr;

function ok(): ValidateOk   { return { ok: true }; }
function err(r: string): ValidateErr { return { ok: false, reason: r }; }

// ─── MIME + extension validation ──────────────────────────────────────────────

/**
 * validateMimeExtPair — checks that (mime, filename) are an allowlisted pair.
 *
 * Rules:
 *  - Both mime and a recognized extension must be present.
 *  - mime must be in MIME_EXT_PAIRS or be JSON_MIME.
 *  - The file's extension must be in the set allowed for that MIME.
 *  - SVG MIME (image/svg+xml) is always rejected, even with a non-SVG extension.
 *  - Any mime not in the allowlist is rejected.
 */
export function validateMimeExtPair(
  mime: string | undefined | null,
  filename: string,
): ValidateResult {
  const m = (mime ?? '').trim().toLowerCase();
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

  // No MIME at all — reject; we require explicit MIME from the OS picker.
  if (!m) {
    return err(`Cannot import "${filename}": file type could not be determined. ` +
               'Only PNG, JPEG, GIF, WebP, and Brandthread JSON files are supported.');
  }

  // JSON
  if (m === JSON_MIME) {
    if (ext !== 'json') {
      return err(`MIME/extension mismatch: "${filename}" has MIME application/json but extension ".${ext}".`);
    }
    return ok();
  }

  // SVG always blocked (regardless of extension)
  if (m === 'image/svg+xml' || m.includes('svg')) {
    return err(`SVG files are not supported: "${filename}". Only raster images (PNG, JPEG, GIF, WebP) are allowed.`);
  }

  // Other image MIMEs — must be in allowlist
  const allowed = MIME_EXT_PAIRS[m];
  if (!allowed) {
    return err(`Unsupported file type: "${filename}" (${m}). Only PNG, JPEG, GIF, WebP images and Brandthread JSON are allowed.`);
  }

  // Extension must match the MIME
  if (!allowed.includes(ext)) {
    return err(`MIME/extension mismatch: "${filename}" has MIME ${m} but extension ".${ext}". ` +
               `Expected: ${allowed.map(e => `.${e}`).join(' or ')}.`);
  }

  return ok();
}

// ─── Magic byte validation ────────────────────────────────────────────────────

/**
 * validateMagicBytes — checks the first bytes of a buffer against the
 * expected magic signature for the claimed MIME type.
 *
 * @param bytes   First MAGIC_MIN_BYTES bytes of the file (or the whole file if smaller).
 * @param mime    The claimed image MIME (e.g. 'image/png').
 * @returns       ValidateResult — ok or err with a human-readable message.
 */
export function validateMagicBytes(bytes: Uint8Array, mime: string): ValidateResult {
  const m = mime.toLowerCase();
  const sig = IMAGE_MAGIC.find(s => s.mime === m);
  if (!sig) {
    return err(`No magic-byte signature registered for MIME type "${m}".`);
  }
  if (bytes.length < MAGIC_MIN_BYTES) {
    return err('File is too small to be a valid image.');
  }
  if (!sig.check(bytes)) {
    return err(
      `File content does not match its claimed type (${m}). ` +
      'The file may be renamed or corrupted.',
    );
  }
  return ok();
}

// ─── JSON byte-length gate ────────────────────────────────────────────────────

/** Maximum JSON import size in bytes (UTF-8 encoded). */
export const JSON_IMPORT_MAX_BYTES = 512 * 1024; // 512 KB

/**
 * validateJsonByteLength — computes the actual UTF-8 byte length of the raw
 * string and rejects if it exceeds JSON_IMPORT_MAX_BYTES.
 *
 * This guards against a picker that reports asset.size=0 (missing metadata)
 * or a file where asset.size was manipulated.
 */
export function validateJsonByteLength(raw: string): ValidateResult {
  // TextEncoder is available in React Native (Hermes ≥ 0.70) and all modern browsers.
  let byteLen: number;
  try {
    byteLen = new TextEncoder().encode(raw).byteLength;
  } catch {
    // Fallback: count multi-byte chars conservatively (overcount = safe).
    byteLen = 0;
    for (let i = 0; i < raw.length; i++) {
      const code = raw.charCodeAt(i);
      byteLen += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    }
  }

  if (byteLen > JSON_IMPORT_MAX_BYTES) {
    return err(
      `JSON file is too large: ${(byteLen / 1024).toFixed(0)} KB ` +
      `(limit is ${JSON_IMPORT_MAX_BYTES / 1024} KB). ` +
      'Export a smaller canvas or remove some layers before importing.',
    );
  }
  return ok();
}
