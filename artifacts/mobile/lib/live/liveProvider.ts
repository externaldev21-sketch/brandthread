/**
 * THE single factory point for the live-shopping provider.
 *
 * Today:
 *   - dev web preview (`?bt_preview=buyer|seller`) → local preview provider
 *     (bundled runway clips, simulated viewers + chat, no network).
 *   - everything else → the real `/api/live/*` backend (listing, chat,
 *     viewer counts; video needs a streaming SDK — see apiLiveProvider.ts).
 *
 * To plug in a real vendor (Mux, LiveKit, Agora, Cloudflare Stream):
 * implement `LiveStreamProvider` (lib/live/types.ts) — typically by
 * extending the API provider and returning `{ kind: 'video', source: <HLS
 * playback URL> }` (Mux / Cloudflare / LiveKit egress) or a native RTC
 * renderer — and return it from `createProvider()` below. No UI changes.
 */
import { isBuyerDevPreview, isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { createApiLiveProvider } from './apiLiveProvider';
import { createPreviewLiveProvider } from './previewLiveProvider';
import type { LiveStreamProvider } from './types';

export function isLivePreviewMode(searchOverride?: string): boolean {
  return isBuyerDevPreview(searchOverride) || isSellerDevPreview(searchOverride);
}

// The preview query string is only on the URL the app booted with — expo-
// router drops it on the first push — so latch it at module load (this
// module is imported by the feed at boot, and modules evaluate once per page
// load, same as PREVIEW_ROLE in app/_layout.tsx).
const BOOT_PREVIEW = isLivePreviewMode();
// Fresh install (the default — no `&demo=1`) must never show the seeded
// PREVIEW_LIVE_STREAMS cast (fake viewer counts, scripted chat) — that's the
// same isPreviewDemoMode() opt-in every other preview module in the app
// gates its seeded content on (lib/devPreview.ts). This used to be the
// inverse: an explicit `?bt_live=empty` opt-OUT was the only way to see the
// real "nobody is live" state, so a plain `?bt_preview=buyer` always leaked
// fake live streams.
const BOOT_DEMO = BOOT_PREVIEW && isPreviewDemoMode();

function shouldUseLocalPreview(): boolean {
  return BOOT_PREVIEW || isLivePreviewMode();
}

function previewForcesEmpty(): boolean {
  return !(BOOT_DEMO || isPreviewDemoMode());
}

function createProvider(): LiveStreamProvider {
  if (shouldUseLocalPreview()) {
    // Required lazily: the media binding pulls in expo-asset and the bundled
    // runway clips, which only preview sessions need (and which unit tests
    // rendering screens that show LIVE rings can't load).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { previewLiveMedia } = require('./previewLiveMedia') as typeof import('./previewLiveMedia');
    return createPreviewLiveProvider({ media: previewLiveMedia, forceEmpty: previewForcesEmpty() });
  }
  return createApiLiveProvider();
}

let instance: LiveStreamProvider | null = null;

export function getLiveStreamProvider(): LiveStreamProvider {
  instance ??= createProvider();
  return instance;
}

/** Tests / storybook-style harnesses only. */
export function setLiveStreamProviderForTesting(provider: LiveStreamProvider | null): void {
  instance = provider;
}
