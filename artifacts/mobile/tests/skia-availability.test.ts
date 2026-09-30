import { describe, it, expect } from 'vitest';
import { loadSkia, isSkiaAvailable, __resetSkiaCacheForTests } from '../lib/skiaAvailability';

describe('skiaAvailability — guarded loader', () => {
  it('never throws when probing for the native module', () => {
    __resetSkiaCacheForTests();
    expect(() => loadSkia()).not.toThrow();
  });

  it('isSkiaAvailable returns a boolean and matches loadSkia()', () => {
    __resetSkiaCacheForTests();
    const available = isSkiaAvailable();
    expect(typeof available).toBe('boolean');
    const mod = loadSkia();
    expect(available).toBe(mod !== null);
  });

  it('caches the result across repeated calls', () => {
    __resetSkiaCacheForTests();
    const a = loadSkia();
    const b = loadSkia();
    expect(a).toBe(b);
  });

  it('treats Skia as unavailable on web when CanvasKit was never loaded (the PathBuilder crash)', () => {
    // Simulates a web runtime (require('@shopify/react-native-skia') resolves
    // the JS package there, unlike a plain Node test process) without the
    // WASM binding LoadSkiaWeb()/WithSkiaWeb() would normally attach.
    const g = globalThis as { window?: unknown; document?: unknown; CanvasKit?: unknown };
    const hadWindow = 'window' in g;
    const hadDocument = 'document' in g;
    const prevWindow = g.window;
    const prevDocument = g.document;
    delete g.CanvasKit;
    g.window = {};
    g.document = {};
    try {
      __resetSkiaCacheForTests();
      // Whatever the underlying require() resolves to in this test process,
      // the web+no-CanvasKit gate must never let it report available — this
      // is the exact condition that crashed design-canvas.tsx with
      // "Cannot read properties of undefined (reading 'PathBuilder')".
      expect(isSkiaAvailable()).toBe(false);
    } finally {
      __resetSkiaCacheForTests();
      if (hadWindow) g.window = prevWindow; else delete g.window;
      if (hadDocument) g.document = prevDocument; else delete g.document;
    }
  });
});
