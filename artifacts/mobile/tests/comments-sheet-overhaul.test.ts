/**
 * Structure tests for the buyer-post-comments screen.
 *
 * History: an earlier pass root-caused a false "Post is no longer
 * available" error for non-UUID (preview/demo) post IDs, kept the video
 * full-size (not shrunk into a corner) behind the sheet with a legibility
 * scrim and `cover` fit, removed a community-guidelines footer and an emoji
 * row, and added a custom animated send button.
 *
 * A later rebuild (this file's current assertions) went further per the
 * owner's explicit spec: preview posts now get a full, real comments
 * experience (8-15 seeded comments, working local posting) instead of the
 * old "Comments aren't available on preview posts" dead end; the video
 * backdrop switched from `cover` to `contain` and the dim scrim was removed
 * entirely (the owner explicitly rejected both a scale/translate on the
 * video AND any dim overlay — the video must stay completely untouched);
 * and the emoji quick-row came back by request. The animated send button,
 * the guidelines-footer removal and the UUID/404 root-cause fix all still
 * hold from the earlier pass.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const comments = readFileSync(resolve(__dirname, '../app/buyer-post-comments.tsx'), 'utf8');

describe('False "Post is no longer available" error — root cause fix', () => {
  it('recognizes non-UUID (preview/demo) post IDs before ever calling the comments API', () => {
    expect(comments).toContain('const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;');
    expect(comments).toContain('if (!UUID_RE.test(postId)) {');
  });

  it('the scary "no longer available" copy is still reserved for a real, confirmed 404 from the server', () => {
    expect(comments).toContain("apiErrorCode(error) === 'NOT_FOUND'");
    expect(comments).toContain("'This post is no longer available.'");
  });
});

describe('Preview posts get real seeded comments, not a dead end', () => {
  it('seeds 8-15 realistic comments for preview posts instead of a locked empty state', () => {
    expect(comments).toContain('buildPreviewComments');
    expect(comments).toContain('previewCommentsCache');
    expect(comments).not.toContain('Preview content');
  });

  it('posting on a preview post appends locally and never calls the real create API', () => {
    expect(comments).toContain('if (isPreviewPost)');
    expect(comments).toContain('Local-only');
  });
});

describe('Video stays full-size and completely untouched behind the sliding sheet', () => {
  it('no longer constrains the backdrop to a fraction of the screen', () => {
    expect(comments).not.toContain("height: '50%'");
    expect(comments).toMatch(/mediaBackdrop: \{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0/);
  });

  it('renders at contain, never cropped/zoomed beyond how the feed itself framed it', () => {
    // Scoped to the media backdrop block, not the whole file — Avatar and
    // other unrelated thumbnails elsewhere in this screen legitimately use
    // "cover".
    const start = comments.indexOf('{mediaUri ? (');
    const end = comments.indexOf('style={s.backdrop}');
    const backdropBlock = comments.slice(start, end);
    expect(backdropBlock).toContain('contentFit="contain"');
    expect(backdropBlock).not.toContain('contentFit="cover"');
  });

  it('has no dim/scrim over the video — the owner explicitly rejected any darkening', () => {
    expect(comments).not.toContain('mediaScrim');
  });

  it('applies no scale or translate transform to the video when the sheet opens', () => {
    // The sheet itself may translate (drag-to-dismiss); the video backdrop must not.
    expect(comments).not.toMatch(/mediaBackdrop[\s\S]{0,200}transform/);
  });
});

describe('Drag-to-dismiss', () => {
  it('the sheet follows a drag gesture and springs back or closes on release', () => {
    expect(comments).toContain('PanResponder');
    expect(comments).toContain('dragY');
    expect(comments).toContain('DISMISS_THRESHOLD');
  });
});

describe('Composer', () => {
  it('has the quick-emoji row back', () => {
    expect(comments).toContain('QUICK_EMOJI');
    expect(comments).toContain('emojiRow');
  });

  it('removed the community-guidelines footer', () => {
    expect(comments).not.toContain('Community Guidelines');
    expect(comments).not.toContain('guidelinesHint');
  });

  it('uses a custom animated send button', () => {
    expect(comments).toContain('function AnimatedSendButton(');
    expect(comments).toContain('<AnimatedSendButton');
    expect(comments).toContain('justSent');
  });
});

describe('Collapsible reply threads', () => {
  it('replies start collapsed behind a "View N replies" toggle', () => {
    expect(comments).toContain('function ViewRepliesButton(');
    expect(comments).toContain('expandedRoots');
  });
});

describe('Rail comment count bumps immediately on post', () => {
  it('calls the shared comment-count bus after a successful/local post', () => {
    expect(comments).toContain("import { bumpCommentCount } from '@/lib/commentCountBus';");
    expect(comments).toContain('bumpCommentCount(postId');
  });
});
