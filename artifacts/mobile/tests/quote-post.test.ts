import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { QUOTE_MAX_LENGTH, quoteErrorMessage, quotePostHref } from '@/lib/quotePost';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('quotePost helpers', () => {
  it('builds the composer route with a bounded preview', () => {
    const href = quotePostHref({ postId: 'abc', author: 'Nova & Co', caption: 'x'.repeat(500), thumb: 'https://img.test/a.jpg', mediaType: 'photo' });
    const url = new URL(`https://x.test${href}`);
    expect(url.pathname).toBe('/quote-post');
    expect(url.searchParams.get('postId')).toBe('abc');
    expect(url.searchParams.get('author')).toBe('Nova & Co');
    expect(url.searchParams.get('caption')).toHaveLength(280);
    expect(url.searchParams.get('thumb')).toBe('https://img.test/a.jpg');
  });

  it('drops non-http thumbnails (local/file uris)', () => {
    expect(quotePostHref({ postId: 'abc', thumb: 'file:///tmp/x.jpg' })).toBe('/quote-post?postId=abc');
  });

  it('maps server error codes to plain messages', () => {
    expect(quoteErrorMessage({ code: 'REPOSTS_DISABLED' })).toMatch(/turned off reposts/);
    expect(quoteErrorMessage({ code: 'QUOTE_TARGET_UNAVAILABLE' })).toMatch(/no longer available/);
    expect(quoteErrorMessage({ code: 'QUOTE_OF_UNAVAILABLE' })).toMatch(/no longer available/);
    expect(quoteErrorMessage(new Error('boom'))).toMatch(/Try again/);
    expect(QUOTE_MAX_LENGTH).toBe(2200);
  });
});

describe('quote UI structure', () => {
  it('quote-post screen uses the standard bare header, a caption input and a Post button', () => {
    const src = read('app/quote-post.tsx');
    expect(src).toMatch(/<ScreenHeader title="Quote" \/>/);
    expect(src).not.toMatch(/subtitle=/);
    expect(src).toMatch(/testID="quote-caption-input"/);
    expect(src).toMatch(/label="Post"/);
    expect(src).toMatch(/quotedPostId: postId/);
    // preview sessions must never hit the API
    expect(src).toMatch(/isBuyerDevPreview\(\) \|\| !isUUID\(postId\)/);
    expect(src).toMatch(/useSafeAreaInsets/);
  });

  it('is registered as a stack screen', () => {
    expect(read('app/_layout.tsx')).toMatch(/name="quote-post"/);
  });

  it('share sheet adds a Quote item only for real (uuid) posts and keeps existing items', () => {
    const src = read('components/ThreadShareSheet.tsx');
    expect(src).toMatch(/isUUID\(postId\) \? \(\s*<ShareAction\s+label="Quote"/);
    for (const label of ['Copy link', 'Messages', 'Email', 'More', 'Report', 'Not interested', 'Save video']) {
      expect(src).toContain(`label="${label}"`);
    }
  });

  it('QuotedPostCard uses RADII, has an unavailable state and no translucent overlay', () => {
    const src = read('components/social/QuotedPostCard.tsx');
    expect(src).toMatch(/RADII\.card/);
    expect(src).toMatch(/This post is unavailable/);
    expect(src).not.toMatch(/rgba\(|#[0-9a-fA-F]{8}\b/);
  });

  it('post viewer renders the card only when the post quotes something', () => {
    const src = read('app/buyer-post-viewer.tsx');
    expect(src).toMatch(/\{post\?\.quotedPost \? \(/);
    expect(src).toMatch(/<QuotedPostCard/);
  });

  it('create-post.tsx is untouched by this feature', () => {
    expect(read('app/create-post.tsx')).not.toMatch(/quotedPostId|QuotedPostCard/);
  });
});
