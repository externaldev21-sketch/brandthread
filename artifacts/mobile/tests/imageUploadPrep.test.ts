import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_EDGE, fitWithin, outputFormatFor, prepareImageForUpload } from '@/lib/imageUploadPrep';
import { resolveCdnBase, rewriteAssetUrl, rewriteImageSource } from '@/lib/cdnUrl';

describe('fitWithin', () => {
  it('caps the long edge and keeps the aspect ratio', () => {
    expect(fitWithin(4096, 2048)).toEqual({ width: 2048, height: 1024 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1536, height: 2048 });
    const out = fitWithin(4000, 3000);
    expect(out.width / out.height).toBeCloseTo(4 / 3, 2);
    expect(Math.max(out.width, out.height)).toBe(MAX_UPLOAD_EDGE);
  });

  it('never upscales', () => {
    expect(fitWithin(640, 480)).toEqual({ width: 640, height: 480 });
    expect(fitWithin(2048, 100)).toEqual({ width: 2048, height: 100 });
  });

  it('keeps every side at least 1px and passes invalid sizes through', () => {
    expect(fitWithin(20000, 2)).toEqual({ width: 2048, height: 1 });
    expect(fitWithin(0, 500)).toEqual({ width: 0, height: 500 });
  });
});

describe('outputFormatFor', () => {
  it('keeps PNG and WebP, turns camera formats into JPEG, skips GIF and non-images', () => {
    expect(outputFormatFor('image/png')).toBe('png');
    expect(outputFormatFor('image/webp')).toBe('webp');
    expect(outputFormatFor('image/jpeg')).toBe('jpeg');
    expect(outputFormatFor('image/heic')).toBe('jpeg');
    expect(outputFormatFor('image/gif')).toBeNull();
    expect(outputFormatFor('video/mp4')).toBeNull();
  });

  it('falls back to the file extension when the picker gives no mime type', () => {
    expect(outputFormatFor(null, 'file:///a/b.PNG?x=1')).toBe('png');
    expect(outputFormatFor(undefined, 'file:///a/b.gif')).toBeNull();
    expect(outputFormatFor(undefined, 'file:///a/b')).toBe('jpeg');
  });
});

describe('prepareImageForUpload', () => {
  it('fails open: returns the original image when dimensions or the manipulator are unavailable', async () => {
    const image = { uri: 'file:///photo.jpg', mimeType: 'image/jpeg' };
    // The node test platform has no image dimension API, so the helper must not throw.
    expect(await prepareImageForUpload(image)).toBe(image);
  });

  it('leaves GIFs untouched without even inspecting them', async () => {
    const image = { uri: 'file:///anim.gif', mimeType: 'image/gif' };
    expect(await prepareImageForUpload(image)).toBe(image);
  });
});

describe('cdn url rewriting', () => {
  const gcs = 'https://storage.googleapis.com/bucket/messaging/u/1.jpg';

  it('is a no-op when no base is configured', () => {
    expect(resolveCdnBase(undefined)).toBeNull();
    expect(resolveCdnBase('')).toBeNull();
    expect(rewriteAssetUrl(gcs, null)).toBe(gcs);
    const source = { uri: gcs };
    expect(rewriteImageSource(source, null)).toBe(source);
  });

  it('rewrites storage urls and keeps path and query', () => {
    expect(rewriteAssetUrl(`${gcs}?sig=1`, 'https://cdn.test')).toBe('https://cdn.test/bucket/messaging/u/1.jpg?sig=1');
    expect(rewriteImageSource({ uri: gcs, headers: { a: '1' } }, 'https://cdn.test')).toEqual({
      uri: 'https://cdn.test/bucket/messaging/u/1.jpg', headers: { a: '1' },
    });
  });

  it('leaves foreign hosts, local files, numbers and bad input alone', () => {
    const foreign = { uri: 'https://images.shopify.com/a.jpg' };
    expect(rewriteImageSource(foreign, 'https://cdn.test')).toBe(foreign);
    expect(rewriteImageSource(12, 'https://cdn.test')).toBe(12);
    expect(rewriteImageSource(null, 'https://cdn.test')).toBeNull();
    expect(rewriteAssetUrl('file:///x.jpg', 'https://cdn.test')).toBe('file:///x.jpg');
    expect(rewriteAssetUrl('not a url', 'https://cdn.test')).toBe('not a url');
  });

  it('returns the same array reference when nothing changed', () => {
    const list = [{ uri: 'https://images.shopify.com/a.jpg' }];
    expect(rewriteImageSource(list, 'https://cdn.test')).toBe(list);
  });
});

