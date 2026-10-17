import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_EDGE, UPLOAD_QUALITY, fitWithin, outputFormatFor, prepareImageForUpload, uploadPlan } from '@/lib/imageUploadPrep';
import { resolveCdnBase, rewriteAssetUrl, rewriteImageSource } from '@/lib/cdnUrl';

describe('fitWithin', () => {
  it('caps the long edge and keeps the aspect ratio', () => {
    expect(fitWithin(8192, 4096)).toEqual({ width: 4096, height: 2048 });
    expect(fitWithin(6048, 8064)).toEqual({ width: 3072, height: 4096 });
    const out = fitWithin(8000, 6000);
    expect(out.width / out.height).toBeCloseTo(4 / 3, 2);
    expect(Math.max(out.width, out.height)).toBe(MAX_UPLOAD_EDGE);
  });

  it('never upscales', () => {
    expect(fitWithin(640, 480)).toEqual({ width: 640, height: 480 });
    expect(fitWithin(4096, 100)).toEqual({ width: 4096, height: 100 });
    expect(fitWithin(4032, 3024)).toEqual({ width: 4032, height: 3024 });
  });

  it('keeps every side at least 1px and passes invalid sizes through', () => {
    expect(fitWithin(40000, 2)).toEqual({ width: 4096, height: 1 });
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

describe('uploadPlan — no client re-encode for normal photos', () => {
  it('sends a 12 MP iPhone JPEG/PNG/WebP exactly as picked', () => {
    expect(uploadPlan('image/jpeg', 'file:///a.jpg', 4032, 3024)).toEqual({ reencode: false });
    expect(uploadPlan('image/png', 'file:///a.png', 1290, 2796)).toEqual({ reencode: false });
    expect(uploadPlan('image/webp', 'file:///a.webp', 3000, 3000)).toEqual({ reencode: false });
  });

  it('converts HEIC (server cannot decode it) without resizing', () => {
    expect(uploadPlan('image/heic', 'file:///a.heic', 4032, 3024)).toEqual({ reencode: true, resize: null });
  });

  it('only downscales giant 48 MP originals, to 4096, at quality 1', () => {
    expect(uploadPlan('image/jpeg', 'file:///a.jpg', 8064, 6048)).toEqual({ reencode: true, resize: { width: 4096, height: 3072 } });
    expect(UPLOAD_QUALITY).toBe(1);
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

