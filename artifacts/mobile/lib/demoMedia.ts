/**
 * Demo / preview runway clips. They are NOT bundled into the app (they were
 * ~46 MB of `require()`d .mp4 files shipped in every web, iOS and OTA build
 * even though only the demo feed plays them). They live in
 * `public/demo-media/`, which Expo copies next to the web export without
 * adding them to any JS bundle, and are fetched only when a demo clip plays.
 *
 * - EXPO_PUBLIC_DEMO_MEDIA_BASE_URL (optional): a CDN folder holding the same
 *   file names; used everywhere when set.
 * - Web: same origin (`/demo-media/...`), served by the dev server, the static
 *   export and server/serve.js (with byte ranges).
 * - Native: the production web host (`https://brandthread.app/demo-media/...`).
 */
import { Platform } from 'react-native';
import type { VideoSource } from 'expo-video';

const NATIVE_DEFAULT_BASE = 'https://brandthread.app/demo-media';

export function demoMediaBaseUrl(
  platformOS: string = Platform.OS,
  override: string | undefined = process.env.EXPO_PUBLIC_DEMO_MEDIA_BASE_URL,
): string {
  const custom = override?.trim().replace(/\/+$/, '');
  if (custom) return custom;
  return platformOS === 'web' ? '/demo-media' : NATIVE_DEFAULT_BASE;
}

/** URI of runway clip `n` (1–10). */
export function demoRunwayVideoUri(n: number, base: string = demoMediaBaseUrl()): string {
  return `${base}/fashion_runway_${String(n).padStart(2, '0')}.mp4`;
}

/** The ten runway clips as video sources, in order. */
export const DEMO_RUNWAY_VIDEO_URIS: string[] = Array.from({ length: 10 }, (_, i) => demoRunwayVideoUri(i + 1));
export const DEMO_RUNWAY_VIDEO_SOURCES: VideoSource[] = DEMO_RUNWAY_VIDEO_URIS.map((uri) => ({ uri }));
