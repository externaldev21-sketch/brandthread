/**
 * file-validator.test.ts
 *
 * Tests for lib/fileValidator.ts — strict MIME+extension pair validation
 * and magic-byte inspection for the Insert File flow.
 *
 * Covers:
 *  - MIME+extension pairs: allowlisted pairs, mismatches, missing MIME,
 *    SVG-MIME-with-any-extension, executable MIME renamed as image.
 *  - Magic bytes: PNG signature, JPEG signature, GIF signature, WebP signature,
 *    SVG-renamed-as-PNG (fails bytes), executable-renamed-as-PNG (fails bytes),
 *    file too small.
 *  - JSON byte-length: size from metadata missing/false vs actual UTF-8 bytes.
 *  - type/kind mismatch in btLayerValidator.
 */
import { describe, it, expect } from 'vitest';
import {
  validateMimeExtPair,
  validateMagicBytes,
  validateJsonByteLength,
  JSON_IMPORT_MAX_BYTES,
  MIME_EXT_PAIRS,
  ALLOWED_IMAGE_MIMES,
} from '../lib/fileValidator';
import { validateBtJson } from '../lib/btLayerValidator';

// ─── Magic byte builders ──────────────────────────────────────────────────────

function pngHeader(): Uint8Array {
  return new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a, 0,0,0,0x0d,'I'.charCodeAt(0),'H'.charCodeAt(0),'D'.charCodeAt(0),'R'.charCodeAt(0)]);
}
function jpegHeader(): Uint8Array {
  return new Uint8Array([0xff,0xd8,0xff,0xe0, 0,0x10,'J'.charCodeAt(0),'F'.charCodeAt(0),'I'.charCodeAt(0),'F'.charCodeAt(0),0,1,1,0,0,1]);
}
function gifHeader(): Uint8Array {
  // GIF89a
  return new Uint8Array([0x47,0x49,0x46,0x38,0x39,0x61, 0x10,0,0x10,0, 0,0,0, 0x2c,0,0,0,0]);
}
function webpHeader(): Uint8Array {
  // RIFF....WEBP
  const b = new Uint8Array(16);
  b[0]=0x52;b[1]=0x49;b[2]=0x46;b[3]=0x46; // RIFF
  b[4]=0x24;b[5]=0;b[6]=0;b[7]=0;          // file size (arbitrary)
  b[8]=0x57;b[9]=0x45;b[10]=0x42;b[11]=0x50; // WEBP
  return b;
}
function svgHeader(): Uint8Array {
  // SVG starts with <?xml or <svg — clearly not a PNG
  const svg = '<svg xmlns="http://www.w3.org/2000/svg">';
  return new Uint8Array([...svg.split('').map(c => c.charCodeAt(0)), ...new Array(16).fill(0)]);
}
function elfHeader(): Uint8Array {
  // ELF magic: 0x7f E L F
  return new Uint8Array([0x7f,0x45,0x4c,0x46,2,1,1,0, 0,0,0,0,0,0,0,0]);
}
function tooSmall(): Uint8Array {
  return new Uint8Array([0x89,0x50,0x4e]); // only 3 bytes
}

// ─── MIME + extension pair validation ─────────────────────────────────────────
describe('validateMimeExtPair — allowlisted pairs', () => {
  it('accepts image/png + .png', () => {
    expect(validateMimeExtPair('image/png', 'photo.png').ok).toBe(true);
  });
  it('accepts image/jpeg + .jpg', () => {
    expect(validateMimeExtPair('image/jpeg', 'photo.jpg').ok).toBe(true);
  });
  it('accepts image/jpeg + .jpeg', () => {
    expect(validateMimeExtPair('image/jpeg', 'photo.jpeg').ok).toBe(true);
  });
  it('accepts image/gif + .gif', () => {
    expect(validateMimeExtPair('image/gif', 'anim.gif').ok).toBe(true);
  });
  it('accepts image/webp + .webp', () => {
    expect(validateMimeExtPair('image/webp', 'photo.webp').ok).toBe(true);
  });
  it('accepts application/json + .json', () => {
    expect(validateMimeExtPair('application/json', 'canvas.json').ok).toBe(true);
  });
});

describe('validateMimeExtPair — MIME/extension mismatches', () => {
  it('rejects image/png with .jpg extension', () => {
    const r = validateMimeExtPair('image/png', 'photo.jpg');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/mismatch/i);
  });
  it('rejects image/jpeg with .png extension', () => {
    const r = validateMimeExtPair('image/jpeg', 'photo.png');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/mismatch/i);
  });
  it('rejects application/json with .png extension', () => {
    const r = validateMimeExtPair('application/json', 'canvas.png');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/mismatch/i);
  });
  it('rejects image/png with .json extension', () => {
    const r = validateMimeExtPair('image/png', 'canvas.json');
    expect(r.ok).toBe(false);
  });
});

describe('validateMimeExtPair — missing MIME', () => {
  it('rejects null MIME', () => {
    const r = validateMimeExtPair(null, 'photo.png');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/determined/i);
  });
  it('rejects empty string MIME', () => {
    const r = validateMimeExtPair('', 'photo.png');
    expect(r.ok).toBe(false);
  });
  it('rejects undefined MIME', () => {
    const r = validateMimeExtPair(undefined, 'photo.png');
    expect(r.ok).toBe(false);
  });
});

describe('validateMimeExtPair — SVG blocked', () => {
  it('rejects image/svg+xml with .svg extension', () => {
    const r = validateMimeExtPair('image/svg+xml', 'icon.svg');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/svg/i);
  });
  it('rejects image/svg+xml even with .png extension (renamed SVG)', () => {
    const r = validateMimeExtPair('image/svg+xml', 'photo.png');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/svg/i);
  });
  it('rejects image/svg+xml even with .jpg extension', () => {
    const r = validateMimeExtPair('image/svg+xml', 'photo.jpg');
    expect(r.ok).toBe(false);
  });
});

describe('validateMimeExtPair — executable MIMEs renamed as images', () => {
  it('rejects application/octet-stream with .png extension', () => {
    const r = validateMimeExtPair('application/octet-stream', 'evil.png');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/unsupported/i);
  });
  it('rejects application/x-executable with .jpg extension', () => {
    const r = validateMimeExtPair('application/x-executable', 'evil.jpg');
    expect(r.ok).toBe(false);
  });
  it('rejects text/html with .png extension', () => {
    const r = validateMimeExtPair('text/html', 'page.png');
    expect(r.ok).toBe(false);
  });
  it('rejects application/pdf with .png extension', () => {
    const r = validateMimeExtPair('application/pdf', 'doc.png');
    expect(r.ok).toBe(false);
  });
});

// ─── Magic byte validation ─────────────────────────────────────────────────────
describe('validateMagicBytes — correct signatures', () => {
  it('accepts valid PNG bytes for image/png', () => {
    expect(validateMagicBytes(pngHeader(), 'image/png').ok).toBe(true);
  });
  it('accepts valid JPEG bytes for image/jpeg', () => {
    expect(validateMagicBytes(jpegHeader(), 'image/jpeg').ok).toBe(true);
  });
  it('accepts valid GIF bytes for image/gif', () => {
    expect(validateMagicBytes(gifHeader(), 'image/gif').ok).toBe(true);
  });
  it('accepts valid WebP bytes for image/webp', () => {
    expect(validateMagicBytes(webpHeader(), 'image/webp').ok).toBe(true);
  });
});

describe('validateMagicBytes — wrong signatures (polyglot / rename attacks)', () => {
  it('rejects SVG bytes when claimed MIME is image/png (SVG-as-PNG attack)', () => {
    const r = validateMagicBytes(svgHeader(), 'image/png');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/content does not match|renamed|corrupted/i);
  });
  it('rejects ELF bytes when claimed MIME is image/png (executable-as-PNG attack)', () => {
    const r = validateMagicBytes(elfHeader(), 'image/png');
    expect(r.ok).toBe(false);
  });
  it('rejects ELF bytes when claimed MIME is image/jpeg', () => {
    const r = validateMagicBytes(elfHeader(), 'image/jpeg');
    expect(r.ok).toBe(false);
  });
  it('rejects PNG bytes when claimed MIME is image/jpeg', () => {
    const r = validateMagicBytes(pngHeader(), 'image/jpeg');
    expect(r.ok).toBe(false);
  });
  it('rejects JPEG bytes when claimed MIME is image/png', () => {
    const r = validateMagicBytes(jpegHeader(), 'image/png');
    expect(r.ok).toBe(false);
  });
  it('rejects SVG bytes for any image MIME', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      const r = validateMagicBytes(svgHeader(), mime);
      expect(r.ok).toBe(false);
    }
  });
});

describe('validateMagicBytes — file too small', () => {
  it('rejects when buffer has fewer than MAGIC_MIN_BYTES bytes', () => {
    const r = validateMagicBytes(tooSmall(), 'image/png');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too small/i);
  });
  it('rejects empty buffer', () => {
    const r = validateMagicBytes(new Uint8Array(0), 'image/png');
    expect(r.ok).toBe(false);
  });
});

describe('validateMagicBytes — unknown MIME', () => {
  it('rejects when no signature is registered for the claimed MIME', () => {
    const r = validateMagicBytes(pngHeader(), 'image/svg+xml');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/signature/i);
  });
});

// ─── JSON byte-length validation ──────────────────────────────────────────────
describe('validateJsonByteLength', () => {
  it('accepts JSON under the limit', () => {
    const small = JSON.stringify({ layers: [] });
    expect(validateJsonByteLength(small).ok).toBe(true);
  });
  it('accepts JSON exactly at the limit', () => {
    // Build a string of exactly JSON_IMPORT_MAX_BYTES ASCII bytes.
    const json = 'x'.repeat(JSON_IMPORT_MAX_BYTES);
    expect(validateJsonByteLength(json).ok).toBe(true);
  });
  it('rejects JSON that exceeds 512 KB by actual UTF-8 byte count', () => {
    // One byte over the limit.
    const json = 'x'.repeat(JSON_IMPORT_MAX_BYTES + 1);
    const r = validateJsonByteLength(json);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too large/i);
  });
  it('rejects large JSON even when asset.size metadata would be 0 (missing)', () => {
    // Simulates a picker that returns size=0 for the asset but the actual
    // content is huge — we measure the actual bytes after reading.
    const hugeJson = JSON.stringify({ layers: [], data: 'x'.repeat(JSON_IMPORT_MAX_BYTES) });
    const r = validateJsonByteLength(hugeJson);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too large/i);
  });
  it('counts multi-byte UTF-8 characters correctly', () => {
    // Each emoji is 4 bytes in UTF-8.  Fill to just over limit.
    const emoji = '\u{1F600}'; // 4 bytes
    const count = Math.ceil(JSON_IMPORT_MAX_BYTES / 4) + 1;
    const json = emoji.repeat(count);
    const r = validateJsonByteLength(json);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too large/i);
  });
});

// ─── btLayerValidator — type/kind mismatch ────────────────────────────────────
describe('btLayerValidator — type/kind mismatch', () => {
  function makeBaseLayer(type: string, kind: string): object {
    return {
      name: 'Test', type, visible: true, locked: false, order: 1, opacity: 1,
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1 },
      data: { kind, paths: kind === 'drawing' ? [] : undefined, uri: kind === 'image' ? 'file:///x.png' : undefined,
              content: kind === 'text' ? 'hi' : undefined, fontFamily: 'System', fontSize: 16,
              bold: false, italic: false, shape: kind === 'shape' ? 'rect' : undefined },
    };
  }

  it('rejects drawing layer where type=image but data.kind=drawing', () => {
    const r = validateBtJson(JSON.stringify({ layers: [makeBaseLayer('image', 'drawing')] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/does not match|mismatch/i);
  });

  it('rejects image layer where type=text but data.kind=image', () => {
    const r = validateBtJson(JSON.stringify({ layers: [makeBaseLayer('text', 'image')] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/does not match|mismatch/i);
  });

  it('rejects shape layer where type=drawing but data.kind=shape', () => {
    const r = validateBtJson(JSON.stringify({ layers: [makeBaseLayer('drawing', 'shape')] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/does not match|mismatch/i);
  });

  it('accepts drawing layer where type=drawing and data.kind=drawing', () => {
    const r = validateBtJson(JSON.stringify({ layers: [
      { name: 'Draw', type: 'drawing', visible: true, locked: false, order: 1, opacity: 1,
        transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1 },
        data: { kind: 'drawing', paths: [] } },
    ]}));
    expect(r.ok).toBe(true);
  });

  it('accepts image layer where type=image and data.kind=image', () => {
    const r = validateBtJson(JSON.stringify({ layers: [
      { name: 'Img', type: 'image', visible: true, locked: false, order: 1, opacity: 1,
        transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1 },
        data: { kind: 'image', uri: 'file:///img.png' } },
    ]}));
    expect(r.ok).toBe(true);
  });

  it('rejects unknown type even with matching kind', () => {
    const r = validateBtJson(JSON.stringify({ layers: [makeBaseLayer('video', 'video')] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not allowed|mismatch/i);
  });
});

// ─── ALLOWED_IMAGE_MIMES and MIME_EXT_PAIRS exports ──────────────────────────
describe('fileValidator exports', () => {
  it('ALLOWED_IMAGE_MIMES contains all four raster types', () => {
    expect(ALLOWED_IMAGE_MIMES).toContain('image/png');
    expect(ALLOWED_IMAGE_MIMES).toContain('image/jpeg');
    expect(ALLOWED_IMAGE_MIMES).toContain('image/gif');
    expect(ALLOWED_IMAGE_MIMES).toContain('image/webp');
  });
  it('ALLOWED_IMAGE_MIMES does not contain SVG', () => {
    expect(ALLOWED_IMAGE_MIMES).not.toContain('image/svg+xml');
  });
  it('MIME_EXT_PAIRS maps png to [png]', () => {
    expect(MIME_EXT_PAIRS['image/png']).toEqual(['png']);
  });
  it('MIME_EXT_PAIRS maps jpeg to [jpg, jpeg]', () => {
    expect(MIME_EXT_PAIRS['image/jpeg']).toContain('jpg');
    expect(MIME_EXT_PAIRS['image/jpeg']).toContain('jpeg');
  });
  it('JSON_IMPORT_MAX_BYTES is 512 KB', () => {
    expect(JSON_IMPORT_MAX_BYTES).toBe(512 * 1024);
  });
});
