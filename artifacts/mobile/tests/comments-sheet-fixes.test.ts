/**
 * Structure tests for the comments-sheet fixes: the nested-<button> DOM
 * warning (and the hover/press flicker it caused), heart clipping/fill,
 * the Reply/time meta-row alignment bug, Apple-style emoji, and the
 * TikTok-style composer pill.
 *
 * History: the meta row originally still misaligned Reply ~6px above Time
 * because PressableScale forces a `minHeight: COMP.minTouchTarget` (44pt)
 * box around its child, and that box's content defaults to top-aligned
 * (column flex, justifyContent: 'flex-start') — so Reply's text sat at the
 * TOP of an invisible 44pt-tall box while Time (a bare Text sibling) sat
 * centered in the row. Fixed by adding `justifyContent: 'center'` to the
 * Reply Pressable's own style and removing the "···" button from the row
 * entirely (long-press on the comment already opens the same menu). The
 * like heart also moved out of the meta row into its own right-hand column,
 * top-aligned near the comment text instead of sunk down to the meta line.
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

  it('the content Pressable (long-press-to-open-menu) closes before the meta row opens its own Pressable', () => {
    const metaStart = comments.indexOf('<View style={s.commentMeta}>');
    const contentPressClose = comments.lastIndexOf('</PressableScale>', metaStart);
    expect(contentPressClose).toBeGreaterThan(comments.indexOf('function CommentRow('));
    expect(contentPressClose).toBeLessThan(metaStart);
  });

  it('has a dev-only guard that fails loudly if React logs the nested-DOM-node warning', () => {
    expect(comments).toContain('function useFailOnNestedButtonWarning()');
    expect(comments).toContain('useFailOnNestedButtonWarning();');
    expect(comments).toContain('NESTED_DOM_PHRASE_RE');
    expect(comments).toContain('cannot (?:contain a nested|be a descendant of)');
  });
});

describe('No more "···" button in the row — long-press opens the menu', () => {
  it('the meta row has no more-options button or icon', () => {
    const metaStart = comments.indexOf('<View style={s.commentMeta}>');
    const metaEnd = comments.indexOf('</View>', metaStart);
    const metaBlock = comments.slice(metaStart, metaEnd);
    expect(metaBlock).not.toContain('more-horizontal');
    expect(metaBlock).not.toContain('moreBtn');
  });

  it('has no moreBtn style left over', () => {
    expect(comments).not.toContain('moreBtn:');
  });

  it('long-press on the comment content still opens the options menu', () => {
    const rowStart = comments.indexOf('function CommentRow(');
    const rowBody = comments.slice(rowStart, comments.indexOf('function ViewRepliesButton'));
    expect(rowBody).toContain('onLongPress={() => { if (!isPending) onMore(comment); }}');
  });
});

describe('Time and Reply share one baseline (the 6px-higher-Reply bug)', () => {
  it('the meta row centers its children with no extra per-item margin/padding', () => {
    expect(comments).toContain("commentMeta: { flexDirection: 'row', alignItems: 'center', gap: SP.md, marginTop: 5 },");
  });

  it('the Reply Pressable centers its own content instead of top-aligning inside its 44pt tap-target box', () => {
    expect(comments).toContain("replyBtn: { justifyContent: 'center' },");
  });

  it('Time and Reply use the identical font size and line height', () => {
    expect(comments).toContain('commentTime: { fontFamily: FONT.regular, fontSize: 12, lineHeight: 16, color: SUBTLE },');
    expect(comments).toContain('replyLabel: { fontFamily: FONT.regular, fontSize: 12, lineHeight: 16, color: SUBTLE },');
  });
});

describe('Like heart: its own column near the comment text, solid when liked, never clipped', () => {
  it('uses Ionicons filled/outline heart instead of Feather\'s outline-only glyph', () => {
    expect(comments).toContain("import { Feather, Ionicons } from '@expo/vector-icons';");
    expect(comments).toContain("name={liked ? 'heart' : 'heart-outline'}");
  });

  it('is a 16pt icon, not inline in the meta row', () => {
    expect(comments).toContain("Ionicons name={liked ? 'heart' : 'heart-outline'} size={16}");
    const metaStart = comments.indexOf('<View style={s.commentMeta}>');
    const metaEnd = comments.indexOf('</View>', metaStart);
    expect(comments.slice(metaStart, metaEnd)).not.toContain('LikeHeart');
  });

  it('sits in its own right-hand column, top-aligned near the comment text (not sunk to the meta row)', () => {
    const rowStart = comments.indexOf('function CommentRow(');
    const rowBody = comments.slice(rowStart, comments.indexOf('function ViewRepliesButton'));
    // <LikeHeart ...> must come after the "The heart sits in its own
    // right-hand column" comment, which itself comes after commentBody's
    // closing tag — i.e. it's a sibling of commentBody, not inside it.
    const bodyOpen = rowBody.indexOf('<View style={s.commentBody}>');
    const heartCommentIndex = rowBody.indexOf('{/* The heart sits in its own right-hand column');
    expect(heartCommentIndex).toBeGreaterThan(bodyOpen);
    const likeHeartIndex = rowBody.indexOf('<LikeHeart');
    expect(likeHeartIndex).toBeGreaterThan(heartCommentIndex);
    expect(comments).toContain('commentLike: {');
    expect(comments).toContain('marginTop: 23');
  });

  it('the icon wrap has no overflow:hidden and is taller than the glyph, so the pop animation cannot clip', () => {
    expect(comments).not.toMatch(/commentLikeIconWrap:\s*\{[^}]*overflow/);
    expect(comments).toContain('commentLikeIconWrap: { width: 20, height: 20');
  });

  it('animates a bounded spring pop on like, not an unbounded/clipping transform', () => {
    expect(comments).toContain('function LikeHeart(');
    expect(comments).toContain('Animated.sequence([');
    expect(comments).toContain('toValue: 1.35');
  });
});

describe('"View N replies" — short dash, tight spacing, chevron', () => {
  it('uses a short 20pt dash in #3a3a3a, not the old long thin border-color line', () => {
    expect(comments).toContain("viewRepliesLine: { width: 20, height: 1, backgroundColor: '#3a3a3a' },");
  });

  it('sits 6pt below the row above it, not a large default gap', () => {
    expect(comments).toContain('marginTop: 6, paddingVertical: 4');
  });

  it('has a chevron that flips with expanded state', () => {
    expect(comments).toContain("name={expanded ? 'chevron-up' : 'chevron-down'}");
  });
});

describe('Row and username/text typography', () => {
  it('row padding is 10pt vertical', () => {
    expect(comments).toMatch(/commentRow: \{[\s\S]*?paddingVertical: 10,/);
  });

  it('username is 13pt semibold gray (#8a8a8a)', () => {
    expect(comments).toContain("authorName: { fontFamily: FONT.semibold, fontSize: 13, color: '#8a8a8a'");
  });

  it('comment text is 14pt regular white with lineHeight 19', () => {
    expect(comments).toContain('commentText: { fontFamily: FONT.regular, fontSize: 14, color: FG, lineHeight: 19 },');
  });
});

describe('Header close icon is 20pt', () => {
  it('does not use the old 22pt size for the close X', () => {
    expect(comments).toContain('<Feather name="x" size={20} color={FG} />');
    expect(comments).not.toContain('<Feather name="x" size={22} color={FG} />');
  });
});

describe('Apple-style quick-reaction emoji — bare, no chip', () => {
  it('renders the 8 TikTok quick reactions in TikTok\'s order', () => {
    expect(comments).toContain("import { AppleEmoji, QUICK_REACTION_EMOJI } from '@/lib/appleEmoji';");
    expect(comments).toContain('const QUICK_EMOJI = QUICK_REACTION_EMOJI;');
    expect(appleEmoji).toContain("['❤️', '😂', '😍', '😢', '😮', '🔥', '👏', '🙌']");
  });

  it('the emoji buttons have no chip background or fixed circle size', () => {
    expect(comments).toContain("emojiBtn: { alignItems: 'center', justifyContent: 'center' },");
    expect(comments).not.toMatch(/emojiBtn:\s*\{[^}]*backgroundColor/);
  });

  it('are evenly spaced across the full width at 24pt', () => {
    expect(comments).toContain("emojiRow: { flexDirection: 'row', justifyContent: 'space-between'");
    expect(comments).toContain('<AppleEmoji emoji={emoji} size={24} />');
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
  it('is 36pt tall at rest, 18pt radius, #262626 fill, no border', () => {
    expect(comments).toContain("backgroundColor: '#262626'");
    expect(comments).toContain('borderRadius: 18');
    expect(comments).toContain('minHeight: 36');
    expect(comments).not.toMatch(/inputShell:\s*\{[^}]*borderWidth/);
  });

  it('placeholder/input text is 14pt', () => {
    expect(comments).toMatch(/input: \{[\s\S]*?fontSize: 14,/);
  });

  it('the @ and emoji tools are 18pt and live inside the pill, not outside it', () => {
    const shellStart = comments.indexOf('<View style={s.inputShell}>');
    const sendButtonStart = comments.indexOf('<AnimatedSendButton');
    const shellBlock = comments.slice(shellStart, sendButtonStart);
    expect(shellBlock).toContain('accessibilityLabel="Emoji"');
    expect(shellBlock).toContain('accessibilityLabel="Mention someone"');
    expect(shellBlock).toContain('name="smile" size={18}');
    expect(shellBlock).toContain('fontSize: 18');
  });

  it('the send arrow only renders once there is text to send', () => {
    expect(comments).toContain('{inputText.trim().length > 0 || sending || justSent ? (');
  });

  it('uses a 28pt avatar with no ring border, matching the TikTok composer', () => {
    expect(comments).toContain('<Avatar uri={myAvatar} initials={myInitials} size={28} ring={false} />');
  });

  it('the composer area uses 8pt vertical padding plus the safe area at the call site', () => {
    expect(comments).toContain('paddingTop: 8, paddingHorizontal: 12,');
    expect(comments).toContain('paddingBottom: Math.max(insets.bottom, SP.sm)');
  });
});
