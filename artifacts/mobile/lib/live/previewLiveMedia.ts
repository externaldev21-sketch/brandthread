/**
 * Binds the pure preview live provider to the demo runway clips and the
 * seeded preview catalog. Kept separate from previewLiveProvider.ts because
 * `require('*.mp4')` / expo-asset can't be imported under vitest.
 */
import { Asset } from 'expo-asset';
import type { PreviewLiveMedia } from './previewLiveProvider';
import type { LiveProduct } from './types';
import { getPreviewCatalog } from '@/lib/previewCatalog';
import { DEMO_RUNWAY_VIDEO_URIS } from '@/lib/demoMedia';

// Runway clips are fetched on demand, not bundled (see lib/demoMedia.ts).
const VIDEO_SOURCES: string[] = DEMO_RUNWAY_VIDEO_URIS;

const POSTER_SOURCES: number[] = [
  require('../../assets/videos/fashion_runway_01.jpg'),
  require('../../assets/videos/fashion_runway_02.jpg'),
  require('../../assets/videos/fashion_runway_03.jpg'),
  require('../../assets/videos/fashion_runway_04.jpg'),
  require('../../assets/videos/fashion_runway_05.jpg'),
  require('../../assets/videos/fashion_runway_06.jpg'),
  require('../../assets/videos/fashion_runway_07.jpg'),
  require('../../assets/videos/fashion_runway_08.jpg'),
  require('../../assets/videos/fashion_runway_09.jpg'),
  require('../../assets/videos/fashion_runway_10.jpg'),
];

function posterUri(index: number): string {
  return Asset.fromModule(POSTER_SOURCES[index]).uri;
}

export const previewLiveMedia: PreviewLiveMedia = {
  video(index) {
    return {
      kind: 'video',
      // Same clip URL the Threads feed plays for its preview posts, so the
      // browser/native cache is shared.
      source: VIDEO_SOURCES[index],
      posterSource: POSTER_SOURCES[index],
      posterUri: posterUri(index),
    };
  },
  product(index): LiveProduct {
    const p = getPreviewCatalog()[index];
    return {
      productId: p.productId,
      name: p.name,
      priceCents: p.currentPriceCents,
      compareAtPriceCents: p.compareAtPriceCents,
      imageUri: p.images[0] ?? null,
      sizes: p.sizes,
      remainingUnits: p.remainingUnits,
    };
  },
  avatarUri() {
    // Preview brands use monochrome initials avatars, same as the feed rail.
    return null;
  },
};
