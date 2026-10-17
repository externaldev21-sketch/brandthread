import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(resolve(__dirname, '../app/buyer-post-comments.tsx'), 'utf8');

describe('comment dislike (server-backed)', () => {
  it('calls api.comments.dislike and hydrates from the server response', () => {
    expect(src).toContain('api.comments.dislike(postId, comment.id, disliked)');
    expect(src).toContain('dislikedByMe: result.disliked, likedByMe: result.liked, likesCount: result.likesCount');
  });
  it('rolls back on failure', () => {
    expect(src).toContain('restoreReaction(c, comment)');
  });
  it('never fakes a local dislike on preview posts', () => {
    expect(src).toContain('if (isPreviewPost) return; // No server row');
    expect(src).toContain('onDislike={isPreviewPost ? undefined : onDislikeStable}');
  });
  it('liking clears dislikedByMe', () => {
    expect(src).toContain('dislikedByMe: liked ? false : c.dislikedByMe');
    expect(src).toContain('applyOptimisticLike(c, liked)');
  });
  it('sheet is ~70% tall', () => {
    expect(src).toContain('windowHeight * (expanded ? 0.92 : 0.7)');
  });
  it('reference layout: options menu instead of sort pills, @ before smile, date · Reply', () => {
    expect(src).not.toContain('s.sortRow');
    expect(src).toContain('testID="comments-options"');
    expect(src).toContain("label: 'Add photo to comment'");
    expect(src.indexOf('testID="composer-mention"')).toBeLessThan(src.indexOf('testID="composer-emoji"'));
    expect(src).toContain("<Text style={s.commentTime}>·</Text>");
    expect(src).toContain('canSend={(inputText.trim().length > 0 || !!photo.media)');
  });
});
