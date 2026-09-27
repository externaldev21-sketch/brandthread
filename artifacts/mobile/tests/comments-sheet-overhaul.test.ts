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
 *
 * Round 3: "full-size and untouched" turned out to be the bug the owner kept
 * reporting — the <video> rendered at its own intrinsic size (e.g. 1080x1920)
 * inside a 390pt-wide screen, `contain`-fit against an effectively unbounded
 * box, which reads as a blown-up, blurry, zoomed-in crop instead of showing
 * the whole subject. The fix is a correctly-sized box (screenTop → sheetTop,
 * `overflow: hidden`) that the media scales DOWN to fill, matching real
 * TikTok; see "Video sits in a fixed, correctly-sized box above the sheet"
 * below. The "no scale/translate" and "no dim scrim" intent from the
 * previous pass still holds — only the box's own size changed.
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

describe('Video sits in a fixed, correctly-sized box above the sheet — never rendered at its own intrinsic size', () => {
  it('the media box is an explicitly-sized (not full-screen/absolute) container, not a percentage-only fill', () => {
    expect(comments).toContain("mediaBox: { width: '100%', overflow: 'hidden'");
    expect(comments).not.toMatch(/mediaBox:\s*\{[^}]*position:\s*'absolute'/);
  });

  it('the video/poster inside the box is styled to fill it (width/height 100%), so it scales down to the box instead of rendering at its own pixel resolution', () => {
    expect(comments).toContain("mediaFill: { width: '100%', height: '100%' }");
    const start = comments.indexOf('<Animated.View style={[s.mediaBox');
    const end = comments.indexOf('style={s.backdrop}');
    const mediaBlock = comments.slice(start, end);
    expect(mediaBlock).toContain('s.mediaFill');
    expect(mediaBlock).not.toContain('s.mediaBackdrop');
  });

  it('renders at contain, never cropped/zoomed beyond how the feed itself framed it', () => {
    // Scoped to the media block, not the whole file — Avatar and other
    // unrelated thumbnails elsewhere in this screen legitimately use "cover".
    const start = comments.indexOf('<Animated.View style={[s.mediaBox');
    const end = comments.indexOf('style={s.backdrop}');
    const mediaBlock = comments.slice(start, end);
    expect(mediaBlock).toContain('contentFit="contain"');
    expect(mediaBlock).not.toContain('contentFit="cover"');
  });

  it('has no dim/scrim over the video — the owner explicitly rejected any darkening', () => {
    expect(comments).not.toContain('mediaScrim');
  });

  it('the media box height is driven by an Animated value tied to the sheet height, not a plain scale/translate zoom', () => {
    expect(comments).toContain('sheetHeightAnim');
    expect(comments).toContain('mediaAreaHeight');
    expect(comments).not.toMatch(/mediaBox[\s\S]{0,200}transform/);
    expect(comments).not.toMatch(/mediaFill[\s\S]{0,200}transform/);
  });

  it('resizes on the shared non-spring SHEET_TIMING curve, never a spring', () => {
    expect(comments).toContain("import { SHEET_EASING_BEZIER, SHEET_OPEN_MS, SHEET_CLOSE_MS } from '@/constants/motion';");
    expect(comments).toContain('Easing.bezier(...SHEET_EASING_BEZIER)');
    expect(comments).not.toMatch(/sheetHeightAnim[\s\S]{0,300}Animated\.spring/);
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
