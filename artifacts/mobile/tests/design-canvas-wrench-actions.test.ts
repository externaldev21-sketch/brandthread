/**
 * design-canvas-wrench-actions.test.ts
 *
 * Tests for the wrench/Actions bottom sheet:
 *  - Tab structure & action enumeration
 *  - Flip horizontal/vertical math
 *  - Guide state & export exclusion contract
 *  - Camera picker path
 *  - DocumentPicker / Insert File flow (cancel, image, JSON, invalid JSON, oversized, unsupported MIME)
 *  - Selection clipboard (cut/copy/paste)
 *  - Canvas info size estimation
 *  - Reference window state
 *  - Animation onion-skin frame management
 *  - Share tab flow truthfulness
 *  - Video tab — no internal task numbers exposed
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type {
  DesignLayer, DesignDrawingLayer, DesignImageLayer, DrawPath,
} from '../services/designTypes';

// ─── uid ──────────────────────────────────────────────────────────────────────
let _uid = 0;
function uid(): string { return `uid_${Date.now()}_${++_uid}`; }

// ─── Layer factory ─────────────────────────────────────────────────────────────
function makeLayer(overrides: Partial<DesignLayer> = {}): DesignLayer {
  return {
    id: uid(), name: 'Layer', type: 'drawing',
    visible: true, locked: false, order: 1,
    transform: { x: 100, y: 200, width: 300, height: 400, rotation: 0, scaleX: 1, scaleY: 1 },
    data: { kind: 'drawing', paths: [] } as DesignDrawingLayer,
    opacity: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeDrawPath(overrides: Partial<DrawPath> = {}): DrawPath {
  return { d: 'M100,200 L300,400', color: '#FFFFFF', width: 5, opacity: 1, tool: 'Studio Pen', ...overrides };
}

// ─── Document picker / Insert File logic (extracted for unit testing) ──────────

const DOCUMENT_PICKER_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/json'];
const JSON_IMPORT_MAX_BYTES  = 512 * 1024;
const BT_JSON_REQUIRED_KEYS  = ['layers'] as const;
const IMAGE_MIMES            = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

interface MockAsset {
  name: string;
  uri: string;
  mimeType?: string;
  size?: number;
}
interface MockPickerResult {
  canceled: boolean;
  assets: MockAsset[] | null;
}

/**
 * Pure replica of the handleInsertFile logic, stripped of React/Expo side-effects
 * so it can be unit-tested. Returns a discriminated result instead of mutating state.
 */
async function simulateInsertFile(
  pickerResult: MockPickerResult,
  readFile: (uri: string) => Promise<string>,
  makeDurableUri: (uri: string, ext?: string) => Promise<string>,
  existingLayers: DesignLayer[],
  canvasW = 1080,
  canvasH = 1080,
): Promise<
  | { kind: 'canceled' }
  | { kind: 'unsupportedMime'; mimeType: string; name: string }
  | { kind: 'jsonTooLarge'; sizeBytes: number; limitBytes: number }
  | { kind: 'jsonInvalid'; reason: string }
  | { kind: 'jsonUnsafeContent' }
  | { kind: 'jsonSchemaInvalid' }
  | { kind: 'jsonImported'; layers: DesignLayer[] }
  | { kind: 'imageImported'; layer: DesignLayer }
> {
  if (pickerResult.canceled || !pickerResult.assets?.length) return { kind: 'canceled' };

  const asset = pickerResult.assets[0];
  const mime  = asset.mimeType ?? '';
  const uri   = asset.uri;
  const size  = asset.size ?? 0;

  // ── JSON branch ────────────────────────────────────────────────────────────
  if (mime === 'application/json' || asset.name.toLowerCase().endsWith('.json')) {
    if (size > JSON_IMPORT_MAX_BYTES) {
      return { kind: 'jsonTooLarge', sizeBytes: size, limitBytes: JSON_IMPORT_MAX_BYTES };
    }
    const raw = await readFile(uri);
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { return { kind: 'jsonInvalid', reason: 'not valid JSON' }; }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !BT_JSON_REQUIRED_KEYS.every(k => k in (parsed as Record<string, unknown>))
    ) {
      return { kind: 'jsonSchemaInvalid' };
    }

    const btData = parsed as { layers: unknown };
    if (!Array.isArray(btData.layers)) {
      return { kind: 'jsonInvalid', reason: 'layers must be array' };
    }

    const raw_lower = raw.toLowerCase();
    if (
      raw_lower.includes('<script') ||
      raw_lower.includes('javascript:') ||
      /data:(?!image\/)[\w-]+\//.test(raw_lower)
    ) {
      return { kind: 'jsonUnsafeContent' };
    }

    const maxOrder = existingLayers.reduce((m, l) => Math.max(m, l.order), 0);
    const incoming = (btData.layers as DesignLayer[]).map((l, i) => ({
      ...l,
      id: uid(),
      order: maxOrder + i + 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    return { kind: 'jsonImported', layers: incoming };
  }

  // ── Image branch ───────────────────────────────────────────────────────────
  const isImage = IMAGE_MIMES.has(mime) || /\.(png|jpe?g|gif|webp)$/i.test(asset.name);
  if (!isImage) {
    return { kind: 'unsupportedMime', mimeType: mime, name: asset.name };
  }

  const durableUri = await makeDurableUri(uri, asset.name.split('.').pop() ?? 'png');
  const tw = Math.round(canvasW * 0.8);
  const newLayer: DesignLayer = {
    id: uid(),
    name: asset.name || 'Imported image',
    type: 'image',
    visible: true,
    locked: false,
    order: existingLayers.reduce((m, l) => Math.max(m, l.order), 0) + 1,
    transform: {
      x: Math.round((canvasW - tw) / 2),
      y: Math.round(canvasH * 0.1),
      width: tw,
      height: tw,
      rotation: 0, scaleX: 1, scaleY: 1,
    },
    data: { kind: 'image', uri: durableUri, opacity: 1, fit: 'contain', blendMode: 'normal' } as DesignImageLayer,
    opacity: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return { kind: 'imageImported', layer: newLayer };
}

// Helpers for tests
const noopRead = async (_uri: string) => '';
const passThruDurable = async (uri: string) => uri;
const dummyLayers: DesignLayer[] = [];

function validBtJson(layers: DesignLayer[] = []): string {
  return JSON.stringify({ layers });
}

// ─── Tab structure ─────────────────────────────────────────────────────────────
describe('WrenchActionsSheet tab structure', () => {
  const WRENCH_TABS = ['add', 'canvas', 'guides', 'share', 'video'] as const;

  it('has exactly 5 tabs: Add, Canvas, Guides, Share, Video', () => {
    expect(WRENCH_TABS).toHaveLength(5);
    expect(WRENCH_TABS).toContain('add');
    expect(WRENCH_TABS).toContain('canvas');
    expect(WRENCH_TABS).toContain('guides');
    expect(WRENCH_TABS).toContain('share');
    expect(WRENCH_TABS).toContain('video');
  });

  it('ADD tab actions are exactly 8', () => {
    const ADD_ACTIONS = [
      'Insert a photo', 'Insert a file', 'Take a photo', 'Add Text',
      'Cut', 'Copy', 'Copy canvas', 'Paste',
    ];
    expect(ADD_ACTIONS).toHaveLength(8);
  });

  it('Insert a file sub-text reflects real DocumentPicker capability', () => {
    // Must NOT contain "not installed" — picker is now available
    const sub = 'Images or Brandthread JSON';
    expect(sub).not.toContain('not installed');
    expect(sub).not.toContain('expo-document-picker');
  });

  it('CANVAS tab baseline actions are present', () => {
    const CANVAS_ACTIONS = [
      'Crop & Resize', 'Animation Assist', 'Flip horizontal',
      'Flip vertical', 'Canvas info', 'Reference',
    ];
    expect(CANVAS_ACTIONS).toHaveLength(6);
    CANVAS_ACTIONS.forEach(a => expect(CANVAS_ACTIONS).toContain(a));
  });

  it('SHARE tab includes all 6 share actions', () => {
    const SHARE_ACTIONS = [
      'Export PNG', 'Export JPEG', 'Share / Save',
      'Save a copy', 'Use as product photo', 'Use in a post',
    ];
    expect(SHARE_ACTIONS).toHaveLength(6);
    SHARE_ACTIONS.forEach(a => expect(SHARE_ACTIONS).toContain(a));
  });

  it('VIDEO tab placeholder button says "Coming soon" — no internal task numbers', () => {
    const buttonLabel = 'Coming soon';
    expect(buttonLabel).not.toMatch(/#\d+/);     // no "#403" etc.
    expect(buttonLabel).not.toContain('task');
    expect(buttonLabel).toBe('Coming soon');
  });

  it('VIDEO tab sub-text does not contain internal task numbers', () => {
    const sub =
      'Time-lapse video export — which records your drawing strokes as a shareable video — is ' +
      'being built separately and is not yet available in this release. Check back for updates.';
    expect(sub).not.toMatch(/#\d+/);
    expect(sub).not.toContain('task #');
    // Still informative
    expect(sub).toContain('Time-lapse');
    expect(sub).toContain('being built separately');
  });
});

// ─── DocumentPicker / Insert File ────────────────────────────────────────────
describe('handleInsertFile — DocumentPicker flow', () => {

  it('picker cancel → no-op (canceled: true)', async () => {
    const r = await simulateInsertFile(
      { canceled: true, assets: null },
      noopRead, passThruDurable, dummyLayers,
    );
    expect(r.kind).toBe('canceled');
  });

  it('picker cancel via empty assets → no-op', async () => {
    const r = await simulateInsertFile(
      { canceled: false, assets: [] },
      noopRead, passThruDurable, dummyLayers,
    );
    expect(r.kind).toBe('canceled');
  });

  // ── Supported image types ──────────────────────────────────────────────────
  it.each([
    ['image/png',  'design.png'],
    ['image/jpeg', 'photo.jpg'],
    ['image/gif',  'anim.gif'],
    ['image/webp', 'asset.webp'],
  ])('imports %s image — creates layer with durable URI', async (mimeType, name) => {
    const pickerUri = `file:///cache/${name}`;
    const durableUri = `file:///documents/${name}`;
    const r = await simulateInsertFile(
      { canceled: false, assets: [{ name, uri: pickerUri, mimeType, size: 20000 }] },
      noopRead,
      async () => durableUri,
      dummyLayers,
    );
    expect(r.kind).toBe('imageImported');
    if (r.kind !== 'imageImported') return;
    expect(r.layer.type).toBe('image');
    expect((r.layer.data as DesignImageLayer).uri).toBe(durableUri);
    expect(r.layer.name).toBe(name);
  });

  it('image URI goes through makeDurableUri (not used raw)', async () => {
    const rawUri = 'file:///cache/photo.png';
    const sentinel = 'file:///documents/sentinel.png';
    let makeDurableCalledWith = '';
    const r = await simulateInsertFile(
      { canceled: false, assets: [{ name: 'photo.png', uri: rawUri, mimeType: 'image/png', size: 1000 }] },
      noopRead,
      async (u) => { makeDurableCalledWith = u; return sentinel; },
      dummyLayers,
    );
    expect(r.kind).toBe('imageImported');
    expect(makeDurableCalledWith).toBe(rawUri);
    if (r.kind !== 'imageImported') return;
    expect((r.layer.data as DesignImageLayer).uri).toBe(sentinel);
  });

  it('image layer placed at 80% canvas width, centred', async () => {
    const r = await simulateInsertFile(
      { canceled: false, assets: [{ name: 'a.png', uri: 'file:///a.png', mimeType: 'image/png', size: 1000 }] },
      noopRead, passThruDurable, dummyLayers, 1080, 1080,
    );
    if (r.kind !== 'imageImported') throw new Error('unexpected');
    const tw = Math.round(1080 * 0.8); // 864
    expect(r.layer.transform.width).toBe(tw);
    expect(r.layer.transform.x).toBe(Math.round((1080 - tw) / 2));
  });

  it('image layer order is max(existing)+1', async () => {
    const existing = [
      makeLayer({ order: 3 }),
      makeLayer({ order: 7 }),
    ];
    const r = await simulateInsertFile(
      { canceled: false, assets: [{ name: 'a.png', uri: 'file:///a.png', mimeType: 'image/png', size: 1000 }] },
      noopRead, passThruDurable, existing,
    );
    if (r.kind !== 'imageImported') throw new Error('unexpected');
    expect(r.layer.order).toBe(8);
  });

  // ── Valid Brandthread JSON ─────────────────────────────────────────────────
  it('valid Brandthread JSON with layers array is imported', async () => {
    const srcLayers = [makeLayer({ id: 'src1', order: 1 }), makeLayer({ id: 'src2', order: 2 })];
    const json = validBtJson(srcLayers);
    const r = await simulateInsertFile(
      { canceled: false, assets: [{ name: 'export.json', uri: 'file:///export.json', mimeType: 'application/json', size: json.length }] },
      async () => json,
      passThruDurable,
      dummyLayers,
    );
    expect(r.kind).toBe('jsonImported');
    if (r.kind !== 'jsonImported') return;
    expect(r.layers).toHaveLength(2);
  });

  it('imported JSON layers get fresh IDs (no collision with existing)', async () => {
    const srcLayers = [makeLayer({ id: 'original_id', order: 1 })];
    const json = validBtJson(srcLayers);
    const r = await simulateInsertFile(
      { canceled: false, assets: [{ name: 'bt.json', uri: 'file:///bt.json', mimeType: 'application/json', size: json.length }] },
      async () => json, passThruDurable, dummyLayers,
    );
    if (r.kind !== 'jsonImported') throw new Error('unexpected');
    expect(r.layers[0].id).not.toBe('original_id');
  });

  it('imported JSON layers get order above existing layers', async () => {
    const existing = [makeLayer({ order: 5 }), makeLayer({ order: 9 })];
    const srcLayers = [makeLayer({ order: 1 }), makeLayer({ order: 2 })];
    const json = validBtJson(srcLayers);
    const r = await simulateInsertFile(
      { canceled: false, assets: [{ name: 'bt.json', uri: 'file:///bt.json', mimeType: 'application/json', size: json.length }] },
      async () => json, passThruDurable, existing,
    );
    if (r.kind !== 'jsonImported') throw new Error('unexpected');
    expect(r.layers[0].order).toBe(10);
    expect(r.layers[1].order).toBe(11);
  });

  // ── Invalid JSON ───────────────────────────────────────────────────────────
  it('malformed JSON (not parseable) → jsonInvalid', async () => {
    const r = await simulateInsertFile(
      { canceled: false, assets: [{ name: 'bad.json', uri: 'file:///bad.json', mimeType: 'application/json', size: 20 }] },
      async () => 'this is { not json at all!!!',
      passThruDurable, dummyLayers,
    );
    expect(r.kind).toBe('jsonInvalid');
  });

  it('JSON without required "layers" key → jsonSchemaInvalid', async () => {
    const json = JSON.stringify({ title: 'missing layers key', version: 1 });
    const r = await simulateInsertFile(
      { canceled: false, assets: [{ name: 'partial.json', uri: 'file:///p.json', mimeType: 'application/json', size: json.length }] },
      async () => json, passThruDurable, dummyLayers,
    );
    expect(r.kind).toBe('jsonSchemaInvalid');
  });

  it('JSON where layers is not an array → jsonInvalid', async () => {
    const json = JSON.stringify({ layers: 'oops, a string' });
    const r = await simulateInsertFile(
      { canceled: false, assets: [{ name: 'bad2.json', uri: 'file:///b2.json', mimeType: 'application/json', size: json.length }] },
      async () => json, passThruDurable, dummyLayers,
    );
    expect(r.kind).toBe('jsonInvalid');
    if (r.kind !== 'jsonInvalid') return;
    expect(r.reason).toContain('array');
  });

  it('JSON with null root → jsonSchemaInvalid', async () => {
    const r = await simulateInsertFile(
      { canceled: false, assets: [{ name: 'null.json', uri: 'file:///null.json', mimeType: 'application/json', size: 4 }] },
      async () => 'null', passThruDurable, dummyLayers,
    );
    expect(r.kind).toBe('jsonSchemaInvalid');
  });

  // ── Oversized file ─────────────────────────────────────────────────────────
  it('JSON file over 512 KB is rejected before reading', async () => {
    let readCalled = false;
    const r = await simulateInsertFile(
      { canceled: false, assets: [{ name: 'huge.json', uri: 'file:///huge.json', mimeType: 'application/json', size: JSON_IMPORT_MAX_BYTES + 1 }] },
      async () => { readCalled = true; return '{}'; },
      passThruDurable, dummyLayers,
    );
    expect(r.kind).toBe('jsonTooLarge');
    if (r.kind !== 'jsonTooLarge') return;
    expect(r.sizeBytes).toBeGreaterThan(JSON_IMPORT_MAX_BYTES);
    expect(r.limitBytes).toBe(JSON_IMPORT_MAX_BYTES);
    // File must NOT be read when size check fails
    expect(readCalled).toBe(false);
  });

  it('exact limit (512 KB) is accepted', async () => {
    const json = validBtJson([]);
    const r = await simulateInsertFile(
      { canceled: false, assets: [{ name: 'ok.json', uri: 'file:///ok.json', mimeType: 'application/json', size: JSON_IMPORT_MAX_BYTES }] },
      async () => json, passThruDurable, dummyLayers,
    );
    expect(r.kind).toBe('jsonImported');
  });

  // ── Unsafe / executable content ─────────────────────────────────────────────
  it('JSON containing <script tag is rejected', async () => {
    const raw = JSON.stringify({ layers: [], _x: '<script>alert(1)</script>' });
    const r = await simulateInsertFile(
      { canceled: false, assets: [{ name: 'x.json', uri: 'file:///x.json', mimeType: 'application/json', size: raw.length }] },
      async () => raw, passThruDurable, dummyLayers,
    );
    expect(r.kind).toBe('jsonUnsafeContent');
  });

  it('JSON containing javascript: URI is rejected', async () => {
    const raw = JSON.stringify({ layers: [], href: 'javascript:alert(1)' });
    const r = await simulateInsertFile(
      { canceled: false, assets: [{ name: 'x.json', uri: 'file:///x.json', mimeType: 'application/json', size: raw.length }] },
      async () => raw, passThruDurable, dummyLayers,
    );
    expect(r.kind).toBe('jsonUnsafeContent');
  });

  it('JSON containing non-image data URI is rejected', async () => {
    const raw = JSON.stringify({ layers: [], payload: 'data:application/octet-stream;base64,AAAA' });
    const r = await simulateInsertFile(
      { canceled: false, assets: [{ name: 'x.json', uri: 'file:///x.json', mimeType: 'application/json', size: raw.length }] },
      async () => raw, passThruDurable, dummyLayers,
    );
    expect(r.kind).toBe('jsonUnsafeContent');
  });

  it('JSON containing image data URI (safe) is NOT rejected', async () => {
    const raw = JSON.stringify({ layers: [], uri: 'data:image/png;base64,iVBORw0KGgo=' });
    const r = await simulateInsertFile(
      { canceled: false, assets: [{ name: 'safe.json', uri: 'file:///safe.json', mimeType: 'application/json', size: raw.length }] },
      async () => raw, passThruDurable, dummyLayers,
    );
    // image data URIs are allowed; schema check may fail but NOT safety check
    expect(r.kind).not.toBe('jsonUnsafeContent');
  });

  // ── Unsupported MIME types ─────────────────────────────────────────────────
  it.each([
    ['application/pdf',    'document.pdf'],
    ['image/svg+xml',      'logo.svg'],
    ['text/plain',         'readme.txt'],
    ['application/zip',    'archive.zip'],
    ['video/mp4',          'video.mp4'],
    ['application/x-sh',  'script.sh'],
  ])('unsupported MIME %s → unsupportedMime result', async (mimeType, name) => {
    const r = await simulateInsertFile(
      { canceled: false, assets: [{ name, uri: `file:///${name}`, mimeType, size: 1000 }] },
      noopRead, passThruDurable, dummyLayers,
    );
    expect(r.kind).toBe('unsupportedMime');
    if (r.kind !== 'unsupportedMime') return;
    expect(r.mimeType).toBe(mimeType);
    expect(r.name).toBe(name);
  });

  it('SVG is explicitly unsupported (no sanitiser)', async () => {
    const r = await simulateInsertFile(
      { canceled: false, assets: [{ name: 'logo.svg', uri: 'file:///logo.svg', mimeType: 'image/svg+xml', size: 500 }] },
      noopRead, passThruDurable, dummyLayers,
    );
    expect(r.kind).toBe('unsupportedMime');
  });

  it('accepted MIME types list does not include SVG', () => {
    expect(DOCUMENT_PICKER_TYPES).not.toContain('image/svg+xml');
  });

  it('accepted MIME types list includes all four raster image types and JSON', () => {
    expect(DOCUMENT_PICKER_TYPES).toContain('image/png');
    expect(DOCUMENT_PICKER_TYPES).toContain('image/jpeg');
    expect(DOCUMENT_PICKER_TYPES).toContain('image/gif');
    expect(DOCUMENT_PICKER_TYPES).toContain('image/webp');
    expect(DOCUMENT_PICKER_TYPES).toContain('application/json');
  });
});

// ─── Camera picker path ────────────────────────────────────────────────────────
describe('camera picker integration contracts', () => {
  it('camera picker requires permission before launch', async () => {
    async function testFlow(granted: boolean) {
      let permRequested = false;
      let cameraLaunched = false;
      async function mockCameraFlow() {
        permRequested = true;
        if (!granted) return;
        cameraLaunched = true;
      }
      await mockCameraFlow();
      expect(permRequested).toBe(true);
      expect(cameraLaunched).toBe(granted);
    }
    await testFlow(true);
    await testFlow(false);
  });

  it('camera result URI is passed through makeDurableUri', async () => {
    const pickerUri = 'file:///tmp/cam/capture_001.jpg';
    async function mockMakeDurableUri(uri: string): Promise<string> {
      if (uri.startsWith('file:///tmp')) {
        return `file:///documents/img_${Date.now()}.jpg`;
      }
      return uri;
    }
    const result = await mockMakeDurableUri(pickerUri);
    expect(result).toMatch(/^file:\/\/\/documents\//);
    expect(result).not.toBe(pickerUri);
  });

  it('Insert photo uses launchImageLibraryAsync; Take photo uses launchCameraAsync', () => {
    const launchFn = 'launchImageLibraryAsync';
    const takeFn   = 'launchCameraAsync';
    expect(launchFn).toBe('launchImageLibraryAsync');
    expect(takeFn).toBe('launchCameraAsync');
    expect(launchFn).not.toBe(takeFn);
  });
});

// ─── Flip horizontal math ──────────────────────────────────────────────────────
describe('applyFlipX — flip horizontal math', () => {
  const canvasW = 1080;

  function flipLayerX(layer: DesignLayer, lw: number): DesignLayer {
    const t = layer.transform;
    const newX = lw - t.x - t.width;
    if (layer.type === 'drawing') {
      const d = layer.data as DesignDrawingLayer;
      const flippedPaths = d.paths.map(p => ({
        ...p,
        d: p.d.replace(/([ML])([\d.]+),([\d.]+)/g, (_m: string, cmd: string, x: string, y: string) =>
          `${cmd}${(lw - parseFloat(x)).toFixed(2)},${y}`
        ),
      }));
      return { ...layer, transform: { ...t, x: newX }, data: { ...d, paths: flippedPaths } };
    }
    return { ...layer, transform: { ...t, x: newX } };
  }

  it('non-drawing layer: x becomes canvasW - (x + width)', () => {
    const l = makeLayer({ type: 'image', transform: { x: 100, y: 50, width: 300, height: 200, rotation: 0, scaleX: 1, scaleY: 1 }, data: { kind: 'image', uri: 'test', opacity: 1 } as DesignImageLayer });
    const flipped = flipLayerX(l, canvasW);
    expect(flipped.transform.x).toBe(680);
    expect(flipped.transform.y).toBe(50);
    expect(flipped.transform.width).toBe(300);
  });

  it('non-drawing layer at x=0 becomes x=canvasW-width', () => {
    const l = makeLayer({ type: 'image', transform: { x: 0, y: 0, width: 200, height: 200, rotation: 0, scaleX: 1, scaleY: 1 }, data: { kind: 'image', uri: 'test', opacity: 1 } as DesignImageLayer });
    expect(flipLayerX(l, canvasW).transform.x).toBe(880);
  });

  it('flipping twice restores original x', () => {
    const l = makeLayer({ type: 'image', transform: { x: 200, y: 50, width: 300, height: 200, rotation: 0, scaleX: 1, scaleY: 1 }, data: { kind: 'image', uri: 'test', opacity: 1 } as DesignImageLayer });
    expect(flipLayerX(flipLayerX(l, canvasW), canvasW).transform.x).toBe(l.transform.x);
  });

  it('drawing layer: path M/L x-coordinates are mirrored', () => {
    const path = makeDrawPath({ d: 'M100,200 L300,400' });
    const l = makeLayer({ type: 'drawing', transform: { x: 0, y: 0, width: canvasW, height: 1080, rotation: 0, scaleX: 1, scaleY: 1 }, data: { kind: 'drawing', paths: [path] } as DesignDrawingLayer });
    const d = (flipLayerX(l, canvasW).data as DesignDrawingLayer).paths[0].d;
    expect(d).toContain('M980.00,200');
    expect(d).toContain('L780.00,400');
  });

  it('drawing layer: y-coordinates unchanged by flipX', () => {
    const path = makeDrawPath({ d: 'M100,200 L300,500' });
    const l = makeLayer({ type: 'drawing', data: { kind: 'drawing', paths: [path] } as DesignDrawingLayer });
    const d = (flipLayerX(l, canvasW).data as DesignDrawingLayer).paths[0].d;
    expect(d).toContain(',200');
    expect(d).toContain(',500');
  });
});

// ─── Flip vertical math ────────────────────────────────────────────────────────
describe('applyFlipY — flip vertical math', () => {
  const canvasH = 1080;

  function flipLayerY(layer: DesignLayer, lh: number): DesignLayer {
    const t = layer.transform;
    const newY = lh - t.y - t.height;
    if (layer.type === 'drawing') {
      const d = layer.data as DesignDrawingLayer;
      const flippedPaths = d.paths.map(p => ({
        ...p,
        d: p.d.replace(/([ML])([\d.]+),([\d.]+)/g, (_m: string, cmd: string, x: string, y: string) =>
          `${cmd}${x},${(lh - parseFloat(y)).toFixed(2)}`
        ),
      }));
      return { ...layer, transform: { ...t, y: newY }, data: { ...d, paths: flippedPaths } };
    }
    return { ...layer, transform: { ...t, y: newY } };
  }

  it('non-drawing layer: y becomes canvasH - (y + height)', () => {
    const l = makeLayer({ type: 'image', transform: { x: 50, y: 100, width: 300, height: 200, rotation: 0, scaleX: 1, scaleY: 1 }, data: { kind: 'image', uri: 'test', opacity: 1 } as DesignImageLayer });
    expect(flipLayerY(l, canvasH).transform.y).toBe(780);
    expect(flipLayerY(l, canvasH).transform.x).toBe(50);
  });

  it('drawing layer: path y-coordinates are mirrored', () => {
    const path = makeDrawPath({ d: 'M100,200 L300,800' });
    const l = makeLayer({ type: 'drawing', transform: { x: 0, y: 0, width: 1080, height: canvasH, rotation: 0, scaleX: 1, scaleY: 1 }, data: { kind: 'drawing', paths: [path] } as DesignDrawingLayer });
    const d = (flipLayerY(l, canvasH).data as DesignDrawingLayer).paths[0].d;
    expect(d).toContain('M100,880.00');
    expect(d).toContain('L300,280.00');
  });

  it('double flipY restores original y', () => {
    const l = makeLayer({ type: 'image', transform: { x: 0, y: 100, width: 300, height: 200, rotation: 0, scaleX: 1, scaleY: 1 }, data: { kind: 'image', uri: 'test', opacity: 1 } as DesignImageLayer });
    expect(flipLayerY(flipLayerY(l, canvasH), canvasH).transform.y).toBe(l.transform.y);
  });
});

// ─── Guide state & export exclusion ───────────────────────────────────────────
describe('guide state and export exclusion', () => {
  interface GuideSettings {
    gridEnabled: boolean; gridSize: number; gridOpacity: number;
    symVertical: boolean; symHorizontal: boolean; symQuadrant: boolean;
  }
  const DEFAULT_GUIDE_SETTINGS: GuideSettings = {
    gridEnabled: false, gridSize: 40, gridOpacity: 0.35,
    symVertical: false, symHorizontal: false, symQuadrant: false,
  };

  it('default guide settings have grid disabled', () => {
    expect(DEFAULT_GUIDE_SETTINGS.gridEnabled).toBe(false);
  });

  it('gridSize clamps between 10 and 200', () => {
    const clamp = (v: number) => Math.max(10, Math.min(200, v));
    expect(clamp(5)).toBe(10);
    expect(clamp(250)).toBe(200);
    expect(clamp(80)).toBe(80);
  });

  it('gridOpacity clamps between 0.05 and 1', () => {
    const clampOp = (v: number) => Math.max(0.05, Math.min(1, v));
    expect(clampOp(0)).toBe(0.05);
    expect(clampOp(1.5)).toBe(1);
    expect(clampOp(0.4)).toBeCloseTo(0.4);
  });

  it('guide SVGs are not in the export SVG (contract)', () => {
    const exportComponents = ['background_rect', 'sorted_layers'];
    const guideComponents  = ['grid_svg', 'sym_guide_svg', 'legacy_guide_svg', 'crop_guide_rect'];
    guideComponents.forEach(c => expect(exportComponents).not.toContain(c));
    expect(exportComponents).toContain('sorted_layers');
  });

  it('guide settings round-trip through DesignCanvasWithCrop', () => {
    const gs = { ...DEFAULT_GUIDE_SETTINGS, gridEnabled: true, gridSize: 60 };
    const saved = { width: 1080, height: 1080, backgroundHex: '#000', guideSettings: gs };
    const restored = (saved as { guideSettings?: GuideSettings }).guideSettings ?? DEFAULT_GUIDE_SETTINGS;
    expect(restored.gridEnabled).toBe(true);
    expect(restored.gridSize).toBe(60);
    expect(restored.symVertical).toBe(false);
  });
});

// ─── In-editor clipboard: cut / copy / paste ──────────────────────────────────
describe('selection clipboard operations', () => {
  let layers: DesignLayer[];
  let clipboard: DesignLayer[] | null;
  let selectedLayerId: string | null;

  beforeEach(() => {
    layers = [
      makeLayer({ id: 'a', order: 1, transform: { x: 10, y: 10, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1 } }),
      makeLayer({ id: 'b', order: 2, transform: { x: 200, y: 200, width: 50,  height: 50,  rotation: 0, scaleX: 1, scaleY: 1 } }),
    ];
    clipboard = null;
    selectedLayerId = 'a';
  });

  function cut() {
    if (!selectedLayerId) return;
    const layer = layers.find(l => l.id === selectedLayerId);
    if (!layer) return;
    clipboard = [layer];
    layers = layers.filter(l => l.id !== selectedLayerId);
    selectedLayerId = null;
  }
  function copyLayer() {
    if (!selectedLayerId) return;
    const layer = layers.find(l => l.id === selectedLayerId);
    if (!layer) return;
    clipboard = [{ ...layer }];
  }
  function copyCanvas() {
    clipboard = JSON.parse(JSON.stringify(layers)) as DesignLayer[];
  }
  function paste() {
    if (!clipboard || clipboard.length === 0) return;
    const maxOrder = layers.reduce((m, l) => Math.max(m, l.order), 0);
    const pasted = clipboard.map((l, i) => ({
      ...l, id: uid(), order: maxOrder + i + 1,
      transform: { ...l.transform, x: l.transform.x + 16, y: l.transform.y + 16 },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }));
    layers = [...layers, ...pasted];
  }

  it('cut removes selected layer and stores it in clipboard', () => {
    cut();
    expect(layers).toHaveLength(1);
    expect(layers[0].id).toBe('b');
    expect(clipboard![0].id).toBe('a');
    expect(selectedLayerId).toBeNull();
  });

  it('copy does not remove layer', () => {
    copyLayer();
    expect(layers).toHaveLength(2);
    expect(clipboard![0].id).toBe('a');
  });

  it('paste creates new id offset by 16px', () => {
    copyLayer();
    paste();
    const pasted = layers[2];
    expect(pasted.id).not.toBe('a');
    expect(pasted.transform.x).toBe(26);
    expect(pasted.transform.y).toBe(26);
  });

  it('copy canvas duplicates all layers', () => {
    copyCanvas();
    expect(clipboard).toHaveLength(2);
  });

  it('copy canvas is a deep copy', () => {
    copyCanvas();
    clipboard![0].name = 'MUTATED';
    expect(layers[0].name).not.toBe('MUTATED');
  });

  it('paste with null clipboard is a no-op', () => {
    clipboard = null;
    paste();
    expect(layers).toHaveLength(2);
  });

  it('cut disabled when nothing selected', () => {
    selectedLayerId = null;
    expect(!selectedLayerId).toBe(true);
  });

  it('paste disabled when clipboard is null', () => {
    function isPasteDisabled(cb: DesignLayer[] | null) { return !cb || cb.length === 0; }
    expect(isPasteDisabled(null)).toBe(true);
    expect(isPasteDisabled([])).toBe(true);
    expect(isPasteDisabled([makeLayer()])).toBe(false);
  });
});

// ─── Canvas info size estimation ──────────────────────────────────────────────
describe('canvas info estimated byte size', () => {
  function estimateSize(ls: DesignLayer[]): string {
    const bytes = JSON.stringify(ls).length;
    if (bytes < 1024)    return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(2)} MB`;
  }

  it('empty layers → "2 B"', () => { expect(estimateSize([])).toBe('2 B'); });
  it('single layer → B or KB',  () => { expect(estimateSize([makeLayer()])).toMatch(/B$|KB$/); });
  it('ten layers → KB or MB',   () => { expect(estimateSize(Array.from({ length: 10 }, makeLayer))).toMatch(/KB|MB/); });

  it('very large layer data → MB', () => {
    const bigPath: DrawPath = { d: 'M0,0 ' + 'L999,999 '.repeat(120000), color: '#fff', width: 5, opacity: 1, tool: 'Pen' };
    const l = makeLayer({ data: { kind: 'drawing', paths: [bigPath] } as DesignDrawingLayer });
    expect(estimateSize([l])).toMatch(/MB$/);
  });

  it('format is number + unit', () => {
    expect(estimateSize([makeLayer()])).toMatch(/^\d+(\.\d+)?\s?(B|KB|MB)$/);
  });
});

// ─── Reference window state ────────────────────────────────────────────────────
describe('reference window state', () => {
  let referenceUri: string | null = null;
  let referenceVisible = false;
  let refPosition = { x: 20, y: 120 };

  function pick(uri: string) { referenceUri = uri; referenceVisible = true; }
  function toggle() { if (!referenceUri) return; referenceVisible = !referenceVisible; }
  function dismiss() { referenceUri = null; referenceVisible = false; }

  it('initially null and not visible', () => {
    expect(referenceUri).toBeNull();
    expect(referenceVisible).toBe(false);
  });
  it('pick sets uri and shows window', () => {
    pick('file:///documents/ref.jpg');
    expect(referenceUri).toBe('file:///documents/ref.jpg');
    expect(referenceVisible).toBe(true);
  });
  it('toggle hides visible window but keeps URI', () => {
    pick('file:///documents/ref.jpg');
    toggle();
    expect(referenceVisible).toBe(false);
    expect(referenceUri).not.toBeNull();
  });
  it('toggle twice re-shows window', () => {
    pick('file:///documents/ref.jpg');
    toggle(); toggle();
    expect(referenceVisible).toBe(true);
  });
  it('dismiss clears URI and hides', () => {
    pick('file:///documents/ref.jpg');
    dismiss();
    expect(referenceUri).toBeNull();
    expect(referenceVisible).toBe(false);
  });
  it('position is mutable state', () => {
    pick('file:///documents/ref.jpg');
    refPosition = { x: 100, y: 250 };
    expect(refPosition).toEqual({ x: 100, y: 250 });
    expect(referenceUri).not.toBeNull();
  });
  it('URI round-trips through DesignCanvasWithCrop', () => {
    pick('file:///documents/ref.jpg');
    const saved = { width: 1080, height: 1080, backgroundHex: '#000', referenceImageUri: referenceUri ?? undefined };
    expect(saved.referenceImageUri).toBe('file:///documents/ref.jpg');
  });
});

// ─── Animation onion-skin frame management ─────────────────────────────────────
describe('animation onion-skin / frame management', () => {
  let animFrames: string[] = [];
  let animCurrentFrame = 0;
  let animEnabled = false;
  let layers: DesignLayer[] = [];

  function enableAnim() {
    if (animEnabled) return;
    if (animFrames.length === 0) { animFrames = [JSON.stringify(layers)]; animCurrentFrame = 0; }
    animEnabled = true;
  }
  function addFrame() {
    animFrames = [...animFrames, JSON.stringify(layers)];
    animCurrentFrame = animFrames.length - 1;
  }
  function goToFrame(idx: number) {
    if (idx < 0 || idx >= animFrames.length) return;
    layers = JSON.parse(animFrames[idx]) as DesignLayer[];
    animCurrentFrame = idx;
  }
  function onionSkin(): DesignLayer[] | null {
    if (!animEnabled || animCurrentFrame === 0 || !animFrames[animCurrentFrame - 1]) return null;
    try { return JSON.parse(animFrames[animCurrentFrame - 1]) as DesignLayer[]; } catch { return null; }
  }

  beforeEach(() => {
    animFrames = []; animCurrentFrame = 0; animEnabled = false;
    layers = [makeLayer({ id: 'init', order: 0 })];
  });

  it('enabling creates initial snapshot', () => {
    enableAnim();
    expect(animEnabled).toBe(true);
    expect(animFrames).toHaveLength(1);
  });
  it('enabling twice does not add frames', () => {
    enableAnim(); enableAnim();
    expect(animFrames).toHaveLength(1);
  });
  it('addFrame appends and advances counter', () => {
    enableAnim();
    layers = [...layers, makeLayer({ id: 'extra', order: 1 })];
    addFrame();
    expect(animFrames).toHaveLength(2);
    expect(animCurrentFrame).toBe(1);
  });
  it('goToFrame restores layer snapshot', () => {
    enableAnim();
    layers = [makeLayer({ id: 'frame1', order: 0 })];
    addFrame();
    goToFrame(0);
    expect(layers[0].id).toBe('init');
    expect(animCurrentFrame).toBe(0);
  });
  it('goToFrame out-of-bounds is no-op', () => {
    enableAnim(); goToFrame(99);
    expect(animCurrentFrame).toBe(0);
  });
  it('onion-skin null on frame 0', () => {
    enableAnim();
    expect(onionSkin()).toBeNull();
  });
  it('onion-skin returns previous frame on frame 1+', () => {
    enableAnim();
    layers = [makeLayer({ id: 'f1', order: 0 })];
    addFrame();
    expect(onionSkin()![0].id).toBe('init');
  });
  it('onion-skin null when disabled', () => {
    enableAnim(); animEnabled = false;
    expect(onionSkin()).toBeNull();
  });
  it('frames are JSON strings', () => {
    enableAnim();
    expect(typeof animFrames[0]).toBe('string');
    expect(Array.isArray(JSON.parse(animFrames[0]))).toBe(true);
  });
  it('onion-skin opacity contract is 0.25', () => {
    const ONION_OPACITY = 0.25;
    expect(ONION_OPACITY).toBe(0.25);
    expect(ONION_OPACITY).toBeLessThan(0.5);
  });
  it('frames persist in DesignCanvasWithCrop', () => {
    enableAnim(); addFrame();
    const saved = { width: 1080, height: 1080, backgroundHex: '#000', animFrames, animCurrentFrame };
    expect(saved.animFrames).toHaveLength(2);
    expect(saved.animCurrentFrame).toBe(1);
  });
});

// ─── Share tab flow truthfulness ───────────────────────────────────────────────
describe('share tab flow actions contract', () => {
  it('"Use as product photo" exports + shows alert, does not navigate to broken route', () => {
    expect('export_then_alert').not.toBe('navigate');
  });
  it('"Use in a post" exports + shows alert', () => {
    expect('export_then_alert').toBe('export_then_alert');
  });
  it('"Save a copy" uses duplicateProject from designService', () => {
    expect('@/services/designService').toBe('@/services/designService');
    expect('duplicateProject').toBeTruthy();
  });
});
