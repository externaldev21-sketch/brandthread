/**
 * skiaAvailability.ts — guarded, lazy loader for @shopify/react-native-skia.
 *
 * @shopify/react-native-skia is a native module NOT available in Expo Go (it
 * requires a custom dev client / native build). Importing it directly at the
 * top of a module that also needs to run in Expo Go or on web would crash the
 * app the moment that module is evaluated, even behind a runtime `if`.
 *
 * This module isolates the import behind `require()` inside a try/catch, so
 * evaluating THIS file never throws — only calling `loadSkia()` attempts the
 * native module resolution, and that attempt is itself guarded.
 *
 * Usage:
 *   const skia = loadSkia();
 *   if (skia) { ... use skia.Skia, skia.Canvas, skia.Path, useTouchHandler ... }
 *   else { ... fall back to the SVG PanResponder renderer ... }
 */

/* eslint-disable @typescript-eslint/no-var-requires */

export interface SkiaModuleShape {
  Skia: any;
  Canvas: any;
  Path: any;
  Group: any;
  useCanvasRef: any;
  useTouchHandler?: any;
  Circle: any;
  Rect: any;
  Paint: any;
  BlendMode: any;
  ColorMatrix?: any;
  ImageFormat?: any;
}

let cached: SkiaModuleShape | null | undefined; // undefined = not yet attempted

/**
 * loadSkia — attempts to require the native Skia module. Returns null (never
 * throws) when the native module is not present, e.g.:
 *   - running in Expo Go (no custom dev client)
 *   - running on web (no react-native-skia web binding is guaranteed here)
 *   - any other environment where the native TurboModule isn't linked
 *
 * The result is cached for the lifetime of the JS runtime (native module
 * availability cannot change without a full app reload anyway).
 */
export function loadSkia(): SkiaModuleShape | null {
  if (cached !== undefined) return cached;
  try {
    // Deliberately NOT a static top-level `import` — a static import would be
    // hoisted and evaluated at module-load time, which is exactly what we
    // must avoid in an Expo Go / web context.
    // eslint-disable-next-line import/no-extraneous-dependencies
    const mod = require('@shopify/react-native-skia');
    if (!mod || !mod.Skia || !mod.Canvas) {
      cached = null;
      return null;
    }
    cached = mod as SkiaModuleShape;
    return cached;
  } catch (err) {
    cached = null;
    return null;
  }
}

/** Synchronous capability check without forcing a load (loadSkia is already cheap/cached, but this reads intent more clearly at call sites). */
export function isSkiaAvailable(): boolean {
  return loadSkia() !== null;
}

/** Test-only: reset the cache (native availability can't change at runtime, but unit tests may want to re-probe). */
export function __resetSkiaCacheForTests(): void {
  cached = undefined;
}
