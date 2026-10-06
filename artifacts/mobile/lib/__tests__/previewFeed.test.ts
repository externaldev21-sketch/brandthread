import { describe, expect, it } from 'vitest';
import { PREVIEW_FEED_POSTS } from '../previewFeed';

describe('preview feed fixtures', () => {
  it('provides 25 unique previews and preserves the original first-ten ids and product links', () => {
    expect(PREVIEW_FEED_POSTS).toHaveLength(25);
    expect(new Set(PREVIEW_FEED_POSTS.map(post => post.id)).size).toBe(25);
    for (let index = 0; index < 10; index++) {
      const number = String(index + 1).padStart(2, '0');
      expect(PREVIEW_FEED_POSTS[index].id).toBe(`preview-fashion-${number}`);
      expect(PREVIEW_FEED_POSTS[index].productId).toBe(`preview-product-${number}`);
      expect(PREVIEW_FEED_POSTS[index].videoIndex).toBe(index);
    }
  });

  it('keeps all engagement counts nonzero and in the hundreds or higher', () => {
    for (const post of PREVIEW_FEED_POSTS) {
      expect(post.likes).toBeGreaterThanOrEqual(100);
      expect(post.commentsCount).toBeGreaterThanOrEqual(100);
      expect(post.reposts).toBeGreaterThanOrEqual(100);
      expect(post.shares).toBeGreaterThanOrEqual(100);
      expect(post.saves).toBeGreaterThanOrEqual(100);
    }
    expect(Math.max(...PREVIEW_FEED_POSTS.map(post => post.likes))).toBeGreaterThan(1_000);
    expect(Math.max(...PREVIEW_FEED_POSTS.map(post => post.saves))).toBeGreaterThan(1_000);
  });

  it('includes local comment content for each post and cycles the ten bundled clips', () => {
    for (const post of PREVIEW_FEED_POSTS) {
      expect(post.comments.length).toBeGreaterThanOrEqual(3);
      expect(post.comments.every(comment => comment.id && comment.user && comment.text)).toBe(true);
      expect(post.videoIndex).toBeGreaterThanOrEqual(0);
      expect(post.videoIndex).toBeLessThan(10);
    }
    expect(PREVIEW_FEED_POSTS[10].videoIndex).toBe(0);
    expect(PREVIEW_FEED_POSTS[24].videoIndex).toBe(4);
  });
});