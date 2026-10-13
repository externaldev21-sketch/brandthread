import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  STITCH_CLIP_MS, authorLabel, clipWindowAt, fitsErrorMessage, formatClipTime, stitchCaptionPrefix, stitchHref,
} from '@/lib/fits';
import { activityHref } from '@/lib/activity';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('fits helpers', () => {
  it('labels authors by handle first', () => {
    expect(authorLabel({ username: 'nova', brandName: 'Nova' })).toBe('@nova');
    expect(authorLabel({ username: null, brandName: 'Nova', displayName: 'N' })).toBe('Nova');
    expect(authorLabel(null)).toBe('');
  });

  it('pre-fills the TikTok stitch caption', () => {
    expect(stitchCaptionPrefix({ username: 'nova' })).toBe('#stitch with @nova ');
    expect(stitchCaptionPrefix(null)).toBe('#stitch ');
  });

  it('centres a 5 second window on the touch and clamps it inside the original', () => {
    expect(clipWindowAt(0, 20_000)).toEqual({ startMs: 0, endMs: STITCH_CLIP_MS });
    expect(clipWindowAt(0.5, 20_000)).toEqual({ startMs: 7_500, endMs: 12_500 });
    expect(clipWindowAt(1, 20_000)).toEqual({ startMs: 15_000, endMs: 20_000 });
    expect(clipWindowAt(0.5, 3_000)).toEqual({ startMs: 0, endMs: 3_000 });
    expect(clipWindowAt(Number.NaN, 0)).toEqual({ startMs: 0, endMs: 0 });
  });

  it('formats clip times and builds routes', () => {
    expect(formatClipTime(65_000)).toBe('1:05');
    expect(stitchHref('a b')).toBe('/stitch-post?postId=a%20b');
  });

  it('maps server codes to copy', () => {
    expect(fitsErrorMessage({ code: 'NOT_PURCHASED' }, 'x')).toMatch(/bought/);
    expect(fitsErrorMessage({ code: 'nope' }, 'fallback')).toBe('fallback');
  });

  it('opens Review from a repost request activity row', () => {
    expect(activityHref({ targetType: 'repost_request', targetId: 'r1', type: 'repost_request' } as never)).toBe('/repost-request?id=r1');
  });

  it('wires the entry points additively', () => {
    expect(read('components/ThreadShareSheet.tsx')).toContain('label="Stitch"');
    expect(read('app/buyer-product-detail.tsx')).toContain('<FitChecksStrip productId={product.id}');
    expect(read('app/buyer-post-viewer.tsx')).toContain('usePostFits(');
    const layout = read('app/_layout.tsx');
    for (const name of ['stitch-post', 'fit-check-product', 'repost-request']) expect(layout).toContain(`name="${name}"`);
  });
});
