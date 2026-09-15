/**
 * validate-bt-json.test.ts
 *
 * Full test coverage for the btLayerValidator strict runtime validator.
 * Tests every security invariant and all allowed/rejected layer kinds.
 */
import { describe, it, expect } from 'vitest';
import {
  validateBtJson,
  isAllowedImageUri,
  BT_MAX_LAYERS,
  BT_MAX_PATH_D,
} from '../lib/btLayerValidator';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLayer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Test Layer',
    type: 'drawing',
    visible: true,
    locked: false,
    order: 1,
    opacity: 1,
    transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1 },
    data: { kind: 'drawing', paths: [] },
    ...overrides,
  };
}

function makeJson(layers: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ layers, ...extra });
}

// ─── isAllowedImageUri ────────────────────────────────────────────────────────
describe('isAllowedImageUri', () => {
  it('allows file:/// URIs', () => {
    expect(isAllowedImageUri('file:///var/app/cache/image.png')).toBe(true);
  });
  it('allows data:image/png;base64, URIs', () => {
    expect(isAllowedImageUri('data:image/png;base64,abc123')).toBe(true);
  });
  it('allows data:image/jpeg;base64, URIs', () => {
    expect(isAllowedImageUri('data:image/jpeg;base64,abc123')).toBe(true);
  });
  it('allows data:image/gif;base64, URIs', () => {
    expect(isAllowedImageUri('data:image/gif;base64,abc')).toBe(true);
  });
  it('allows data:image/webp;base64, URIs', () => {
    expect(isAllowedImageUri('data:image/webp;base64,abc')).toBe(true);
  });
  it('allows cache:// URIs', () => {
    expect(isAllowedImageUri('cache://some/path')).toBe(true);
  });
  it('allows content:// URIs (Android)', () => {
    expect(isAllowedImageUri('content://media/external/images/1234')).toBe(true);
  });

  it('blocks SVG data URIs', () => {
    expect(isAllowedImageUri('data:image/svg+xml;base64,abc')).toBe(false);
  });
  it('blocks data:text/html URIs', () => {
    expect(isAllowedImageUri('data:text/html;base64,abc')).toBe(false);
  });
  it('blocks http:// URIs', () => {
    expect(isAllowedImageUri('http://example.com/photo.png')).toBe(false);
  });
  it('blocks https:// URIs', () => {
    expect(isAllowedImageUri('https://cdn.example.com/img.jpg')).toBe(false);
  });
  it('blocks javascript: URIs', () => {
    expect(isAllowedImageUri('javascript:alert(1)')).toBe(false);
  });
  it('blocks path traversal in file URIs', () => {
    expect(isAllowedImageUri('file:///var/../etc/passwd')).toBe(false);
  });
  it('blocks data:application/pdf URIs', () => {
    expect(isAllowedImageUri('data:application/pdf;base64,abc')).toBe(false);
  });
});

// ─── validateBtJson — top-level parsing ───────────────────────────────────────
describe('validateBtJson — parse errors', () => {
  it('rejects non-JSON', () => {
    const r = validateBtJson('not json at all');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/valid JSON/i);
  });
  it('rejects JSON array root', () => {
    const r = validateBtJson('[]');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/JSON object/i);
  });
  it('rejects JSON string root', () => {
    const r = validateBtJson('"hello"');
    expect(r.ok).toBe(false);
  });
  it('rejects object without layers field', () => {
    const r = validateBtJson(JSON.stringify({ version: 1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/layers/i);
  });
  it('rejects object with layers as non-array', () => {
    const r = validateBtJson(JSON.stringify({ layers: 'yes' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/layers/i);
  });
});

// ─── Security scan ────────────────────────────────────────────────────────────
describe('validateBtJson — security rejections', () => {
  it('rejects files containing <script', () => {
    const raw = JSON.stringify({ layers: [], note: '<script>alert(1)</script>' });
    const r = validateBtJson(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/script/i);
  });
  it('rejects files containing javascript:', () => {
    const raw = JSON.stringify({ layers: [], href: 'javascript:void(0)' });
    const r = validateBtJson(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/javascript/i);
  });
  it('rejects files with data:text/html data URI', () => {
    const raw = JSON.stringify({ layers: [], x: 'data:text/html;base64,abc' });
    const r = validateBtJson(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/disallowed data URI/i);
  });
  it('allows files with data:image/png data URI in the raw text', () => {
    const r = validateBtJson(makeJson([
      makeLayer({ data: { kind: 'drawing', paths: [] } }),
    ], { thumb: 'data:image/png;base64,abc' }));
    expect(r.ok).toBe(true);
  });
});

// ─── Layer count cap ──────────────────────────────────────────────────────────
describe('validateBtJson — layer count', () => {
  it('rejects when layer count exceeds BT_MAX_LAYERS', () => {
    const layers = Array.from({ length: BT_MAX_LAYERS + 1 }, () => makeLayer());
    const r = validateBtJson(makeJson(layers));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too many layers/i);
  });
  it('accepts exactly BT_MAX_LAYERS layers', () => {
    const layers = Array.from({ length: BT_MAX_LAYERS }, () => makeLayer());
    const r = validateBtJson(makeJson(layers));
    expect(r.ok).toBe(true);
  });
  it('accepts custom maxLayers argument', () => {
    const layers = [makeLayer(), makeLayer(), makeLayer()];
    const r = validateBtJson(makeJson(layers), 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too many layers/i);
  });
});

// ─── Drawing layer ────────────────────────────────────────────────────────────
describe('validateBtJson — drawing layer', () => {
  it('accepts a valid drawing layer with paths', () => {
    const r = validateBtJson(makeJson([makeLayer({
      data: {
        kind: 'drawing',
        paths: [{ d: 'M0,0 L10,10', color: '#fff', width: 5, opacity: 1, tool: 'Pen' }],
      },
    })]));
    expect(r.ok).toBe(true);
  });
  it('assigns fresh IDs regardless of imported ID', () => {
    const r = validateBtJson(makeJson([makeLayer({ id: 'evil-id-from-import' })]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.layers[0].id).not.toBe('evil-id-from-import');
  });
  it('rejects drawing layer with non-array paths', () => {
    const r = validateBtJson(makeJson([makeLayer({ data: { kind: 'drawing', paths: 'not-array' } })]));
    expect(r.ok).toBe(false);
  });
  it('rejects path with NaN width', () => {
    const r = validateBtJson(makeJson([makeLayer({
      data: { kind: 'drawing', paths: [{ d: 'M0,0', color: '#fff', width: NaN, opacity: 1, tool: 'Pen' }] },
    })]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/width/i);
  });
  it('rejects path with Infinity opacity', () => {
    const r = validateBtJson(makeJson([makeLayer({
      data: { kind: 'drawing', paths: [{ d: 'M0,0', color: '#fff', width: 5, opacity: Infinity, tool: 'Pen' }] },
    })]));
    expect(r.ok).toBe(false);
  });
  it('rejects overlong path d string', () => {
    const longD = 'M' + '0,0 '.repeat(Math.ceil(BT_MAX_PATH_D / 4) + 10);
    const r = validateBtJson(makeJson([makeLayer({
      data: { kind: 'drawing', paths: [{ d: longD, color: '#fff', width: 5, opacity: 1, tool: 'Pen' }] },
    })]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too long/i);
  });
});

// ─── Image layer ─────────────────────────────────────────────────────────────
describe('validateBtJson — image layer', () => {
  it('accepts a valid image layer with file:// URI', () => {
    const r = validateBtJson(makeJson([makeLayer({
      type: 'image',
      data: { kind: 'image', uri: 'file:///cache/img.png', opacity: 1, fit: 'contain', blendMode: 'normal' },
    })]));
    expect(r.ok).toBe(true);
  });
  it('blocks remote http URI', () => {
    const r = validateBtJson(makeJson([makeLayer({
      type: 'image',
      data: { kind: 'image', uri: 'https://evil.example.com/xss.png', opacity: 1 },
    })]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/disallowed/i);
  });
  it('blocks SVG data URI', () => {
    const r = validateBtJson(makeJson([makeLayer({
      type: 'image',
      data: { kind: 'image', uri: 'data:image/svg+xml;base64,PHN2Z...' },
    })]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/disallowed/i);
  });
  it('blocks javascript: URI', () => {
    const r = validateBtJson(makeJson([makeLayer({
      type: 'image',
      data: { kind: 'image', uri: 'javascript:alert(1)' },
    })]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/javascript|disallowed/i);
  });
  it('blocks path traversal URI', () => {
    const r = validateBtJson(makeJson([makeLayer({
      type: 'image',
      data: { kind: 'image', uri: 'file:///../../../etc/passwd' },
    })]));
    expect(r.ok).toBe(false);
  });
  it('blocks unknown blendMode', () => {
    const r = validateBtJson(makeJson([makeLayer({
      type: 'image',
      data: { kind: 'image', uri: 'file:///img.png', blendMode: 'evil-mode' },
    })]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/blendMode/i);
  });
});

// ─── Text layer ───────────────────────────────────────────────────────────────
describe('validateBtJson — text layer', () => {
  it('accepts valid text layer', () => {
    const r = validateBtJson(makeJson([makeLayer({
      type: 'text',
      data: { kind: 'text', content: 'Hello', fontFamily: 'System', fontSize: 24, bold: false, italic: false },
    })]));
    expect(r.ok).toBe(true);
  });
  it('rejects text with huge fontSize', () => {
    const r = validateBtJson(makeJson([makeLayer({
      type: 'text',
      data: { kind: 'text', content: 'Hi', fontFamily: 'System', fontSize: 99999 },
    })]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/fontSize/i);
  });
});

// ─── Shape layer ──────────────────────────────────────────────────────────────
describe('validateBtJson — shape layer', () => {
  it('accepts valid rect shape', () => {
    const r = validateBtJson(makeJson([makeLayer({
      type: 'shape',
      data: { kind: 'shape', shape: 'rect', strokeWidth: 2, cornerRadius: 8 },
    })]));
    expect(r.ok).toBe(true);
  });
  it('rejects unknown shape kind', () => {
    const r = validateBtJson(makeJson([makeLayer({
      type: 'shape',
      data: { kind: 'shape', shape: 'hexagon' },
    })]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/hexagon|known shape/i);
  });
});

// ─── Unknown layer kind ───────────────────────────────────────────────────────
describe('validateBtJson — unknown layer kind', () => {
  it('rejects layers with unknown kind', () => {
    const r = validateBtJson(makeJson([makeLayer({ data: { kind: 'video' } })]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not allowed/i);
  });
});

// ─── Transform validation ─────────────────────────────────────────────────────
describe('validateBtJson — transform validation', () => {
  it('rejects NaN in transform.x', () => {
    const r = validateBtJson(makeJson([makeLayer({
      transform: { x: NaN, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1 },
    })]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/transform\.x/i);
  });
  it('rejects Infinity in transform.width', () => {
    const r = validateBtJson(makeJson([makeLayer({
      transform: { x: 0, y: 0, width: Infinity, height: 100, rotation: 0, scaleX: 1, scaleY: 1 },
    })]));
    expect(r.ok).toBe(false);
  });
  it('rejects huge x (> 32768)', () => {
    const r = validateBtJson(makeJson([makeLayer({
      transform: { x: 999999, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1 },
    })]));
    expect(r.ok).toBe(false);
  });
  it('accepts negative x within bounds', () => {
    const r = validateBtJson(makeJson([makeLayer({
      transform: { x: -100, y: -100, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1 },
    })]));
    expect(r.ok).toBe(true);
  });
  it('preserves flipX/flipY from transform', () => {
    const r = validateBtJson(makeJson([makeLayer({
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, flipX: true, flipY: false },
    })]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.layers[0].transform.flipX).toBe(true);
      expect(r.layers[0].transform.flipY).toBe(false);
    }
  });
});

// ─── Malformed nested layers ──────────────────────────────────────────────────
describe('validateBtJson — malformed nested fields', () => {
  it('rejects layer with non-boolean visible', () => {
    const r = validateBtJson(makeJson([makeLayer({ visible: 'yes' })]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/visible/i);
  });
  it('rejects layer with opacity out of range', () => {
    const r = validateBtJson(makeJson([makeLayer({ opacity: 1.5 })]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/opacity/i);
  });
  it('rejects layer where data is not an object', () => {
    const r = validateBtJson(makeJson([makeLayer({ data: 'evil' })]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/data/i);
  });
  it('returns ok:false for first failing layer, not just last', () => {
    const layers = [makeLayer(), makeLayer({ visible: 'bad' }), makeLayer()];
    const r = validateBtJson(makeJson(layers));
    expect(r.ok).toBe(false);
  });
  it('accepts a mix of valid drawing + image + text + shape layers', () => {
    const r = validateBtJson(makeJson([
      makeLayer({ type: 'drawing', data: { kind: 'drawing', paths: [] } }),
      makeLayer({ type: 'image', data: { kind: 'image', uri: 'file:///img.png' } }),
      makeLayer({ type: 'text', data: { kind: 'text', content: 'Hi', fontFamily: 'System', fontSize: 16, bold: false, italic: false } }),
      makeLayer({ type: 'shape', data: { kind: 'shape', shape: 'circle' } }),
    ]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.layers).toHaveLength(4);
  });
});
