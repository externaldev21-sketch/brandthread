/**
 * Structure tests for the second round of comments-sheet fixes: the
 * nested-<button> DOM warning (and the hover/press flicker it caused),
 * heart clipping/fill, Reply/Like baseline alignment, Apple-style emoji,
 * and the TikTok-style composer pill.
 *
 * `tests/comments-no-dom-nesting.web.mjs` is the live-browser proof for the
 * DOM-nesting fix; these are fast static checks that the structural changes
 * that make it true stay in place.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const comments = readFileSync(resolve(__dirname, '../app/buyer-post-comments.tsx'), 'utf8');
const appleEmoji = readFileSync(resolve(__dirname, '../lib/appleEmoji.tsx'), 'utf8');

describe('No nested <button> inside <button> in CommentRow', () => {
  it('the row itself is a plain View, not a Pressable', () => {
    const rowStart = comments.indexOf('function CommentRow(');
    const rowBody = comments.slice(rowStart, rowStart + 1200);
    expect(rowBody).toMatch(/return\s*\(\s*<View style=\{\[s\.commentRow/);
  });

  it('Reply, more-options and the like button are siblings on the meta row, not nested inside another Pressable', () => {
    const metaStart = comments.indexOf('<View style={s.commentMeta}>');
    const metaEnd = comments.indexOf('</View>', comments.indexOf('</View>', metaStart) + 1);
    const metaBlock = comments.slice(metaStart, metaEnd);
    // The content Pressable (long-press-to-open-menu) must have already
    // closed before the meta row's own Pressables open.
    const contentPressClose = comments.lastIndexOf('</PressableScale>', metaStart);
    expect(contentPressClose).toBeGreaterThan(comments.indexOf('function CommentRow('));
    expect(contentPressClose).toBeLessThan(metaStart);
    expect(metaBlock).toContain('replyBtn');
    expect(metaBlock).toContain('LikeHeart');
  });

  it('has a dev-only guard that fails loudly if React logs the nested-DOM-node warning', () => {
    expect(comments).toContain('function useFailOnNestedButtonWarning()');
    expect(comments).toContain('useFailOnNestedButtonWarning();');
    expect(comments).toContain('NESTED_DOM_PHRASE_RE');
    expect(comments).toContain('cannot (?:contain a nested|be a descendant of)');
  });
});

describe('Like heart: solid when liked, never clipped, contained pop', () => {
  it('uses Ionicons filled/outline heart instead of Feather\'s outline-only glyph', () => {
    expect(comments).toContain("import { Feather, Ionicons } from '@expo/vector-icons';");
    expect(comments).toContain("name={liked ? 'heart' : 'heart-outline'}");
  });

  it('the icon wrap has no overflow:hidden and is taller than the glyph, so the pop animation cannot clip', () => {
    expect(comments).not.toMatch(/commentLikeIconWrap:\s*\{[^}]*overflow/);
    expect(comments).toContain('commentLikeIconWrap: { width: 22, height: 22');
  });

  it('animates a bounded spring pop on like, not an unbounded/clipping transform', () => {
    expect(comments).toContain('function LikeHeart(');
    expect(comments).toContain('Animated.sequence([');
    expect(comments).toContain('toValue: 1.35');
  });
});

describe('Reply/time/like share one baseline', () => {
  it('time, Reply and the like control are all children of the same commentMeta row', () => {
    const metaStart = comments.indexOf('<View style={s.commentMeta}>');
    const nextRowStart = comments.indexOf('function ViewRepliesButton');
    const metaSection = comments.slice(metaStart, nextRowStart);
    expect(metaSection).toContain('commentTime');
    expect(metaSection).toContain('onReply(comment)');
    expect(metaSection).toContain('<LikeHeart');
  });
});

describe('Apple-style quick-reaction emoji', () => {
  it('renders the 8 TikTok quick reactions in TikTok\'s order', () => {
    expect(comments).toContain("import { AppleEmoji, QUICK_REACTION_EMOJI } from '@/lib/appleEmoji';");
    expect(comments).toContain('const QUICK_EMOJI = QUICK_REACTION_EMOJI;');
    expect(appleEmoji).toContain("['❤️', '😂', '😍', '😢', '😮', '🔥', '👏', '🙌']");
  });

  it('serves Apple-style images off native iOS instead of the OS default glyph', () => {
    expect(appleEmoji).toContain('emoji-datasource-apple');
    expect(appleEmoji).toContain("Platform.OS !== 'ios'");
  });

  it('falls back to the plain glyph if the image 404s, never a blank reaction', () => {
    expect(appleEmoji).toContain('onError={() => setFailed(true)}');
  });
});

describe('TikTok-style composer pill', () => {
  it('is a slim, dark, low-radius pill — not the old boxy full-height field', () => {
    expect(comments).toContain("backgroundColor: '#1f1f1f'");
    expect(comments).toContain('borderRadius: 20');
    expect(comments).toContain('minHeight: 38');
  });

  it('the @ and emoji tools live inside the pill, not outside it', () => {
    const shellStart = comments.indexOf('<View style={s.inputShell}>');
    const sendButtonStart = comments.indexOf('<AnimatedSendButton');
    const shellBlock = comments.slice(shellStart, sendButtonStart);
    expect(shellBlock).toContain('accessibilityLabel="Emoji"');
    expect(shellBlock).toContain('accessibilityLabel="Mention someone"');
  });

  it('the send arrow only renders once there is text to send', () => {
    expect(comments).toContain('{inputText.trim().length > 0 || sending || justSent ? (');
  });

  it('uses a 36pt avatar, matching the TikTok composer', () => {
    expect(comments).toContain('<Avatar uri={myAvatar} initials={myInitials} size={36} />');
  });
});
