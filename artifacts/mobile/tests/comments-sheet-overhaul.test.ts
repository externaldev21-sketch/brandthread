/**
 * Structure tests for the buyer-post-comments overhaul:
 *  - root-caused false "Post is no longer available" error for non-UUID
 *    (preview/demo) post IDs, which always 404 server-side regardless of
 *    whether anything was ever deleted
 *  - full-size video behind the sheet instead of shrinking it into the top
 *  - removed the community-guidelines footer and emoji row
 *  - redesigned, animated send button
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

  it('never shows the deleted-post error for preview content — a quiet, distinct message instead', () => {
    expect(comments).toContain('isPreviewPost');
    expect(comments).toContain('Comments aren’t available on preview posts.');
    // The scary copy is still reserved for a real, confirmed 404 from the server.
    expect(comments).toContain("apiErrorCode(error) === 'NOT_FOUND'");
    expect(comments).toContain("'This post is no longer available.'");
  });
});

describe('Video stays full-size behind the sliding sheet', () => {
  it('no longer constrains the backdrop to the top half of the screen', () => {
    expect(comments).not.toContain("height: '50%'");
    expect(comments).toMatch(/mediaBackdrop: \{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 \}/);
  });

  it('renders the video at cover, not letterboxed/contained into a corner', () => {
    expect(comments).toContain('contentFit="cover"');
  });

  it('keeps a legibility scrim so the sheet stays readable over bright footage', () => {
    expect(comments).toContain('mediaScrim');
  });
});

describe('Composer redesign', () => {
  it('removed the quick-emoji row', () => {
    expect(comments).not.toContain('QUICK_EMOJIS');
    expect(comments).not.toContain('emojiRow');
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
