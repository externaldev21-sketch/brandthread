import { describe, expect, it } from 'vitest';
import { mapMediaDims } from '@/lib/mediaFrame';

describe('mapMediaDims', () => {
  it('uses per-slide sizes for carousels and mediaDimensions for slideshows', () => {
    expect(mapMediaDims({
      slides: [{ width: 1080, height: 1440 }, { width: 720, height: 960 }], thumbnailWidth: 1080, thumbnailHeight: 1440,
    }, ['a', 'b'])).toEqual({
      mediaDims: [{ width: 1080, height: 1440 }, { width: 720, height: 960 }],
      posterDims: { width: 1080, height: 1440 },
    });
    expect(mapMediaDims({ mediaDimensions: [{ width: 1080, height: 1920 }, null] }, ['a', 'b']).mediaDims)
      .toEqual([{ width: 1080, height: 1920 }, null]);
  });

  it('uses mediaWidth/mediaHeight for a single video and the poster falls back to it', () => {
    expect(mapMediaDims({ mediaWidth: 1080, mediaHeight: 1920 }, ['v'])).toEqual({
      mediaDims: [{ width: 1080, height: 1920 }], posterDims: { width: 1080, height: 1920 },
    });
    expect(mapMediaDims({ mediaWidth: null }, ['v'])).toEqual({ mediaDims: [null], posterDims: null });
  });
});
