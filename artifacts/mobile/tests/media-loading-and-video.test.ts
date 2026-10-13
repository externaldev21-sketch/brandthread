import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lowResPlaceholder, lowResVariantUri } from '@/lib/imageVariants';

const root = path.resolve(__dirname, '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('low-res → sharp (item 51)', () => {
  it('asks Shopify\'s CDN for a tiny copy', () => {
    expect(lowResVariantUri('https://cdn.shopify.com/s/files/1/a.jpg?v=12', { cdnBase: null }))
      .toBe('https://cdn.shopify.com/s/files/1/a.jpg?v=12&width=32');
  });
  it('uses Cloudflare resizing on our CDN only when it is turned on', () => {
    const signed = 'https://storage.googleapis.com/bucket/obj.jpg?X-Goog-Signature=abc';
    expect(lowResVariantUri(signed, { cdnBase: 'https://media.brandthread.app', cdnResizing: false })).toBeNull();
    expect(lowResVariantUri(signed, { cdnBase: 'https://media.brandthread.app', cdnResizing: true }))
      .toBe('https://media.brandthread.app/cdn-cgi/image/width=32,quality=40,format=auto/bucket/obj.jpg?X-Goog-Signature=abc');
    expect(lowResVariantUri(signed, { cdnBase: null, cdnResizing: true })).toBeNull();
  });
  it('leaves every other image alone', () => {
    expect(lowResVariantUri('https://example.com/a.jpg', { cdnBase: null })).toBeNull();
    expect(lowResVariantUri('file:///tmp/a.jpg', { cdnBase: null })).toBeNull();
    expect(lowResVariantUri('/objects/uploads/a', { cdnBase: null })).toBeNull();
    expect(lowResPlaceholder(12, { cdnBase: null })).toBeUndefined();
    expect(lowResPlaceholder({ uri: 'https://cdn.shopify.com/x.jpg' }, { cdnBase: null })).toEqual({ uri: 'https://cdn.shopify.com/x.jpg?width=32' });
  });
  it('CachedImage paints the tiny copy first unless a caller passes its own placeholder', () => {
    const cached = read('components/CachedImage.tsx');
    expect(cached).toContain('placeholder = lowResPlaceholder(source),');
    expect(cached).toContain('placeholderContentFit={contentFit}');
  });
  it('no screen shows a spinner while a photo loads', () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) { if (name !== '__tests__') walk(full, out); }
        else if (/\.tsx$/.test(name)) out.push(full);
      }
      return out;
    };
    const offenders = ['app', 'components'].flatMap((d) => walk(path.join(root, d)))
      .filter((file) => {
        const src = readFileSync(file, 'utf8');
        return /onLoad(Start|End)=/.test(src) && src.includes('ActivityIndicator');
      })
      .map((file) => path.relative(root, file));
    expect(offenders).toEqual([]);
  });
});

describe('videos play muted on their own, no play icon (item 49)', () => {
  it('the product video autoplays muted, pauses off-screen, has no play button', () => {
    const src = read('components/products/ProductVideo.tsx');
    expect(src).toContain('p.muted = true;');
    expect(src).toContain('if (focused) player.play(); else player.pause();');
    expect(src).not.toContain('name="play"');
    expect(src).not.toContain('setPlaying(true)');
  });
  it('the seller\'s video preview does the same', () => {
    const src = read('app/product-video.tsx');
    expect(src).toContain('p.muted = true;');
    expect(src).not.toContain('name="play"');
  });
  it('the post viewer starts muted with no native controls', () => {
    const src = read('app/buyer-post-viewer.tsx');
    expect(src).toContain('p.muted = true; p.timeUpdateEventInterval = 0.25;');
    expect(src).toContain('nativeControls={false}');
  });
  it.each([
    'components/social/PostGrid.tsx',
    'components/search/VideoTile.tsx',
    'components/discover/DiscoverTileView.tsx',
    'app/buyer-recently-watched.tsx',
    'app/(buyer)/friends.tsx',
  ])('no play badge on video thumbnails: %s', (file) => {
    expect(read(file)).not.toMatch(/name="play"/);
  });
});
