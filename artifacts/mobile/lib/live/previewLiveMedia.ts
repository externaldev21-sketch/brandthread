/**
 * Binds the pure preview live provider to the bundled runway clips and the
 * seeded preview catalog. Kept separate from previewLiveProvider.ts because
 * `require('*.mp4')` / expo-asset can't be imported under vitest.
 */
import { Asset } from 'expo-asset';
import type { PreviewLiveMedia } from './previewLiveProvider';
import type { LiveProduct } from './types';
import { getPreviewCatalog } from '@/lib/previewCatalog';

const VIDEO_SOURCES: number[] = [
  require('../../assets/videos/fashion_runway_01.mp4'),
  require('../../assets/videos/fashion_runway_02.mp4'),
  require('../../assets/videos/fashion_runway_03.mp4'),
  require('../../assets/videos/fashion_runway_04.mp4'),
  require('../../assets/videos/fashion_runway_05.mp4'),
  require('../../assets/videos/fashion_runway_06.mp4'),
  require('../../assets/videos/fashion_runway_07.mp4'),
  require('../../assets/videos/fashion_runway_08.mp4'),
  require('../../assets/videos/fashion_runway_09.mp4'),
  require('../../assets/videos/fashion_runway_10.mp4'),
];

const POSTER_SOURCES: number[] = [
  require('../../assets/videos/fashion_runway_01.png'),
  require('../../assets/videos/fashion_runway_02.png'),
  require('../../assets/videos/fashion_runway_03.png'),
  require('../../assets/videos/fashion_runway_04.png'),
  require('../../assets/videos/fashion_runway_05.png'),
  require('../../assets/videos/fashion_runway_06.png'),
  require('../../assets/videos/fashion_runway_07.png'),
  require('../../assets/videos/fashion_runway_08.png'),
  require('../../assets/videos/fashion_runway_09.png'),
  require('../../assets/videos/fashion_runway_10.png'),
];

function posterUri(index: number): string {
  return Asset.fromModule(POSTER_SOURCES[index]).uri;
}

export const previewLiveMedia: PreviewLiveMedia = {
  video(index) {
    return {
      kind: 'video',
      // Same bundled module the Threads feed plays for its preview clips, so
      // the browser/native cache is shared and a "stream" starts instantly.
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
