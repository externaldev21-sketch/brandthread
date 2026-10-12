/**
 * Dev web preview only (`?bt_preview=buyer|seller&demo=1&banner=gif|video`):
 * a sample profile banner so the TikTok-style banner header can be reviewed
 * without a signed-in account. Never active outside the explicit demo opt-in
 * (isPreviewDemoMode is false on native, in production and without demo=1),
 * and without `banner=` the preview keeps the no-banner header.
 */
import { isPreviewDemoMode } from '@/lib/devPreview';
import type { ProfileBanner } from '@/lib/profileBannerApi';

function assetUri(module: number): string {
  try {
    // Lazy: only the demo preview ever resolves these assets.
    const { Asset } = require('expo-asset') as typeof import('expo-asset'); // eslint-disable-line @typescript-eslint/no-require-imports
    return Asset.fromModule(module).uri;
  } catch {
    return '';
  }
}

/** Which sample banner the preview URL asks for, or null (no banner). */
export function previewBannerKind(searchOverride?: string): 'gif' | 'video' | null {
  if (!isPreviewDemoMode(searchOverride)) return null;
  const search = searchOverride ?? (typeof window !== 'undefined' ? window.location.search : '');
  const kind = new URLSearchParams(search).get('banner');
  return kind === 'gif' || kind === 'video' ? kind : null;
}

/** The sample banner for a preview profile; `variant` picks a different clip for a visited profile. */
export function previewProfileBanner(variant: 'own' | 'other' = 'own', searchOverride?: string): ProfileBanner | null {
  const kind = previewBannerKind(searchOverride);
  if (!kind) return null;
  /* eslint-disable @typescript-eslint/no-require-imports */
  const poster = variant === 'own'
    ? assetUri(require('../assets/videos/fashion_runway_03.jpg'))
    : assetUri(require('../assets/videos/fashion_runway_07.jpg'));
  const video = variant === 'own'
    ? assetUri(require('../assets/videos/fashion_runway_03.mp4'))
    : assetUri(require('../assets/videos/fashion_runway_07.mp4'));
  /* eslint-enable @typescript-eslint/no-require-imports */
  if (!video) return null;
  // A GIF banner plays the MP4 the server converts it to, like production.
  return kind === 'gif'
    ? { type: 'gif', url: video, posterUrl: poster || null, gifUrl: null }
    : { type: 'video', url: video, posterUrl: poster || null };
}
