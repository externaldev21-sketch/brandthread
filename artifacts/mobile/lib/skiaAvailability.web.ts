/**
 * skiaAvailability.web.ts — web build of the guarded Skia loader.
 *
 * On web, Skia is only usable after its CanvasKit WASM binary has been loaded
 * (`LoadSkiaWeb()` / `WithSkiaWeb()`), and this app never loads it, so the
 * native file (lib/skiaAvailability.ts) already reports Skia as unavailable
 * on web every time. This file gives the same answer without the
 * `require('@shopify/react-native-skia')`: Metro bundles a `require()`
 * synchronously into the calling chunk, and because this probe is shared by
 * several screens that put the whole Skia JS package (~340 KB) into the web
 * export's shared `__common` chunk, which every page downloads before its
 * first paint. Every caller already falls back to its SVG / gradient path.
 */
import type { SkiaModuleShape } from './skiaAvailability';

export type { SkiaModuleShape };

export function loadSkia(): SkiaModuleShape | null {
  return null;
}

export function isSkiaAvailable(): boolean {
  return false;
}

/** Test-only: kept for API parity with the native file; there is no cache on web. */
export function __resetSkiaCacheForTests(): void {}
