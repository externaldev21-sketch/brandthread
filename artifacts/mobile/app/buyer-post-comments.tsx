/**
 * Buyer Post Comments Screen
 * TikTok-style split modal: keeps the active post media visible above a
 * half-height comment thread, with one-level reply support.
 *
 * Comments are server-backed and moderated:
 *  - Slurs and threats are refused before posting (the draft is kept so it
 *    can be edited); strong language and abuse post as "In review" and are
 *    visible only to their author until a moderator approves them.
 *  - Comments from blocked people and comments containing the viewer's muted
 *    words are filtered out by the server.
 *  - Every comment has a ⋯ menu: reply, report, block the author, or delete
 *    (author or post owner). Confirmations happen inline in the sheet.
 *
 * Interaction quality:
 *  - First-load: skeleton rows while fetching
 *  - Fetch failure: InlineError with retry (no Alert)
 *  - Posting: inline progress indicator on send button; InlineError on failure
 *  - Count sync: realCount comes from the authoritative list after a
 *    successful post (removes the optimistic tmp_ item)
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useStableCallback } from '@/hooks/useStableCallback';

import { goBackOr } from '@/lib/navigation/goBackOr';

import { View, Text, FlatList, TextInput, Modal, Pressable, PanResponder, Platform, StyleSheet, Animated, Easing, Keyboard, useWindowDimensions } from 'react-native';

import { FlashList, type FlashListRef } from '@shopify/flash-list';

import Composer from '@/components/ui/Composer';
import { KeyboardAccessoryBar, keyboardAccessoryID } from '@/components/ui/KeyboardAccessoryBar';

import { KeyboardAvoidingView, KeyboardGestureArea } from '@/components/KeyboardProviderCompat';

import { FontAwesome } from '@expo/vector-icons';

import { Icon, type IconName } from '@/components/ui/Icon';

import { useVideoPlayer, VideoView } from 'expo-video';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useRouter, useLocalSearchParams, useFocusEffect, useIsFocused } from 'expo-router';

import { useUser } from '@clerk/expo';

import { SURFACE, CARD, BORDER, FG, MUTED, SUBTLE, SUBTLE_WASH, FONT, FS, SP, RADIUS } from '@/lib/theme';

import { SHEET_EASING_BEZIER, SHEET_OPEN_MS, SHEET_CLOSE_MS } from '@/constants/motion';

import { RADII } from '@/constants/radii';

import { useAppTheme } from '@/contexts/AppThemeContext';

import { PressableScale, EmptyState } from '@/components/BrandthreadUI';

import { InlineSpinner, InlineError } from '@/components/InlineFeedback';

import { CachedImage } from '@/components/CachedImage';

import { Sheet } from '@/components/ui/BottomSheet';

import { MenuBlocks } from '@/components/ui/MenuSheet';

import { useApi } from '@/lib/api';

import { useMeaningfulVideoWatch } from '@/hooks/useMeaningfulVideoWatch';

import { apiErrorCode, apiErrorMessage, reportHref, shortRelativeTime, BLOCK_EXPLAINER } from '@/lib/safety';

import { matchesGuestMutedWords, readGuestMutedWords } from '@/lib/guestMutedWords';

import type { ThreadComment } from '@/lib/safetyTypes';
import { haptics, hapticDestructiveConfirm, haptic, hapticLight } from '@/lib/haptics';


import { bumpCommentCount } from '@/lib/commentCountBus';

import { buildPreviewComments, previewNotificationComments, PREVIEW_MENTION_PEOPLE } from '@/lib/previewComments';

import { isPreviewDemoMode } from '@/lib/devPreview';

import { MentionText } from '@/components/social/MentionText';

import { MentionSuggestionsBar } from '@/components/MentionPickerSheet';

import { activeMentionQuery, insertMentionHandle, type CommentMentionRef } from '@/lib/commentMentions';

import { getPreviewActivityForComment } from '@/lib/previewActivity';

import { AppleEmoji, QUICK_REACTION_EMOJI } from '@/lib/appleEmoji';

import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { COMMENT_SORTS, sortRoots, type CommentSort } from '@/lib/commentSort';

import { TranslationLink, useCaptionTranslation } from '@/components/translation/CaptionTranslation';

import { UnavailableScreen, isMissingParam } from '@/components/ui/UnavailableScreen';
import { CommentPhotoDraft, CommentPhotoView, useCommentPhotoDraft } from '@/components/comments/CommentPhoto';
import { createComment } from '@/services/commentMediaService';
import { isOfficialAccountId, officialAvatarUri } from '@/lib/officialAccount';

const MAX_COMMENT_LENGTH = 1000;
// Links the comment list's KeyboardGestureArea to the composer's TextInput
// (react-native-keyboard-controller, iOS) for interactive drag-to-dismiss.
const COMMENT_INPUT_NATIVE_ID = 'buyer-post-comments-input';
// iOS keyboard accessory bar (Done) for the comment composer.
const COMMENT_ACCESSORY_ID = 'buyer-post-comments-keyboard-accessory';
/** TikTok's own quick-reaction set, in TikTok's own order. */
const QUICK_EMOJI = QUICK_REACTION_EMOJI;

/**
 * Matches the server's UUID check in post-comments.ts. Preview/demo posts
 * (e.g. "preview-fashion-01") and any other non-UUID id would always 404 —
 * that's not a deleted post, so we short-circuit before the network call
 * instead of showing the scary "no longer available" error for them.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Dev-only guard for this screen: react-native-web renders
 * accessibilityRole="button" as a real <button> element, so a Pressable
 * nested inside another Pressable produces an actual invalid
 * <button><button/></button>, and React's DOM validation (validateDOMNesting)
 * logs a loud warning through console.error — easy to miss in a noisy
 * console. React calls console.error with a %s-templated format string plus
 * separate substitution args (e.g. "cannot contain a nested %s" and the
 * literal string "button" as its own arg) rather than one interpolated
 * sentence, so this checks for the phrase and the tag name as two separate
 * tokens rather than one combined string. This turns a match into a thrown
 * error while developing/testing this screen (never in production), so a
 * regression is impossible to scroll past. `tests/comments-no-dom-nesting.web.mjs`
 * asserts the same thing from a real browser for CI.
 */
const NESTED_DOM_PHRASE_RE = /cannot (?:contain a nested|be a descendant of)/i;

function useFailOnNestedButtonWarning() {
  useEffect(() => {
    if (!__DEV__ || Platform.OS !== 'web') return;
    const original = console.error;
    console.error = (...args: unknown[]) => {
      const message = args.map(String).join(' ');
      if (NESTED_DOM_PHRASE_RE.test(message) && /\bbutton\b/i.test(message)) {
        original(...args);
        throw new Error(`[buyer-post-comments] nested <button> detected: ${message}`);
      }
      original(...args);
    };
    return () => { console.error = original; };
  }, []);
}

/** Reaction state shared by root and reply rows. */
type Reaction = Pick<ThreadComment, 'likedByMe' | 'likesCount'> & { dislikedByMe?: boolean };

/** Optimistic like toggle — liking always clears an active dislike. */
export function applyOptimisticLike<T extends Reaction>(c: T, liked: boolean): T {
  return { ...c, likedByMe: liked, dislikedByMe: liked ? false : c.dislikedByMe, likesCount: Math.max(0, c.likesCount + (liked ? 1 : -1)) };
}

/** Optimistic dislike toggle — disliking removes an active like (and its count). */
export function applyOptimisticDislike<T extends Reaction>(c: T, disliked: boolean): T {
  return {
    ...c,
    dislikedByMe: disliked,
    likedByMe: disliked ? false : c.likedByMe,
    likesCount: disliked && c.likedByMe ? Math.max(0, c.likesCount - 1) : c.likesCount,
  };
}

/** Restores a row's reaction fields from a pre-mutation snapshot. */
export function restoreReaction<T extends Reaction>(c: T, snapshot: Reaction): T {
  return { ...c, likedByMe: snapshot.likedByMe, dislikedByMe: snapshot.dislikedByMe, likesCount: snapshot.likesCount };
}

/** A flattened list row: roots followed by their replies. */
type Row = ThreadComment & { isReply: boolean; parentAuthorName?: string; creatorLiked?: boolean };

/** Re-orders a flattened thread (root, its replies, next root, …) by root. */
function sortFlatRows(rows: Row[], sort: CommentSort): Row[] {
  const groups: Row[][] = [];
  for (const row of rows) {
    if (!row.isReply || groups.length === 0) groups.push([row]);
    else groups[groups.length - 1].push(row);
  }
  return sortRoots(groups.map((g) => ({ ...g[0], replies: g.slice(1), group: g })), sort)
    .flatMap((root) => root.group);
}

function flatten(roots: ThreadComment[]): Row[] {
  return roots.flatMap((root) => [
    { ...root, isReply: false },
    ...root.replies.map((reply) => ({ ...reply, isReply: true, parentAuthorName: root.author.name })),
  ]);
}

/**
 * Preview posts (ids that fail the server's UUID check) have no backing
 * server row, so their seeded/posted-to comment state lives only here,
 * keyed by postId, for the life of the app session — reopening the sheet
 * for the same preview post shows whatever was seeded plus anything posted
 * to it earlier in the session, instead of reseeding fresh every time.
 */
const previewCommentsCache = new Map<string, Row[]>();

/** A synthetic row standing in for a collapsed (or expanded) reply thread. */
interface ViewRepliesRow {
  _viewReplies: true;
  rootId: string;
  count: number;
  expanded: boolean;
}

const commentRowKey = (row: Row | ViewRepliesRow) => (isViewRepliesRow(row) ? `view-replies-${row.rootId}` : row.id);

function isViewRepliesRow(row: Row | ViewRepliesRow): row is ViewRepliesRow {
  return '_viewReplies' in row;
}

// ─── Comment skeleton row ─────────────────────────────────────────────────────

function CommentSkeletonRow() {
  const opacity = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View style={[csk.row, { opacity }]}>
      <View style={csk.avatar} />
      <View style={{ flex: 1, gap: 7 }}>
        <View style={[csk.line, { width: '40%' }]} />
        <View style={[csk.line, { width: '80%' }]} />
        <View style={[csk.line, { width: '55%' }]} />
      </View>
    </Animated.View>
  );
}

const csk = StyleSheet.create({
  row:    { flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.md, paddingVertical: SP.sm },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: SURFACE, flexShrink: 0 },
  line:   { height: 9, borderRadius: 4, backgroundColor: SURFACE },
});

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ uri, initials, size = 38, ring = true, backgroundColor, recyclingKey }: { uri?: string | null; initials: string; size?: number; ring?: boolean; backgroundColor?: string; recyclingKey?: string }) {
  const { theme } = useAppTheme();
  if (uri) {
    return <CachedImage source={{ uri }} recyclingKey={recyclingKey} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" />;
  }
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2, backgroundColor: backgroundColor ?? theme.cardElevated,
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{ color: theme.text, fontFamily: FONT.bold, fontSize: size > 34 ? FS.xs : 10 }}>{initials}</Text>
    </View>
  );
}

// ─── Like heart ───────────────────────────────────────────────────────────────
// Solid filled heart when liked, outline when not (Icon only ships an
// outline heart, so liking used to just recolor the same stroked glyph —
// FontAwesome's solid "heart" is the app-wide fallback for a filled heart,
// same as the feed's RightActionRail/EngagementButton). The container is
// taller than the icon itself with no overflow:hidden, so the pop animation
// on toggle can exceed the glyph's own bounds without being clipped at the top.

function LikeHeart({
  liked,
  count,
  onPress,
  accessibilityLabel,
  itemKey,
}: {
  liked: boolean;
  count: number;
  onPress: () => void;
  accessibilityLabel: string;
  /** The comment this heart belongs to. FlashList recycles rows, so a heart
   *  can be handed a different comment; the pop only plays for a real tap
   *  on the same comment, never because a recycled row became a liked one. */
  itemKey: string;
}) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const pop = useRef(new Animated.Value(1)).current;
  const wasLiked = useRef(liked);
  const lastKey = useRef(itemKey);

  useEffect(() => {
    const sameItem = lastKey.current === itemKey;
    lastKey.current = itemKey;
    if (sameItem && liked && !wasLiked.current) {
      Animated.sequence([
        Animated.spring(pop, { toValue: 1.35, speed: 40, bounciness: 10, useNativeDriver: true }),
        Animated.spring(pop, { toValue: 1, speed: 24, bounciness: 6, useNativeDriver: true }),
      ]).start();
    }
    wasLiked.current = liked;
  }, [liked, pop, itemKey]);

  return (
    <PressableScale
      style={s.commentLike}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      noMinHeight
    >
      <Animated.View style={[s.commentLikeIconWrap, { transform: [{ scale: pop }] }]}>
        {liked
          ? <FontAwesome name="heart" size={16} color={theme.error} />
          : <Icon name="heart" size={16} color={MUTED} />}
      </Animated.View>
      {count > 0 && (
        <Text style={[s.actionLabel, liked && { color: theme.error }]}>{count}</Text>
      )}
    </PressableScale>
  );
}

// ─── Comment Row ──────────────────────────────────────────────────────────────
// The row's own long-press-to-open-menu area (avatar + header + body text)
// is one Pressable wrapping only plain text/decoration — never another
// Pressable — and the Reply / more / like controls are separate sibling
// Pressables on the meta line below. Nothing here nests a button inside a
// button (react-native-web renders accessibilityRole="button" as a real
// <button> element, so a Pressable-in-Pressable used to produce an actual
// invalid <button><button/></button> and — because pointer events see two
// overlapping interactive elements — spurious hover/press flicker on the
// outer row whenever the cursor crossed into an inner button).

export const CommentRow = React.memo(function CommentRow({
  comment,
  highlighted = false,
  postAuthorId,
  onLike,
  onDislike,
  onReply,
  onMore,
  onPressMention,
}: {
  comment: Row;
  /** The comment a notification deep-linked to — briefly tinted. */
  highlighted?: boolean;
  postAuthorId: string;
  onLike: (comment: Row) => void;
  onDislike?: (comment: Row) => void;
  onReply: (comment: Row) => void;
  onMore: (comment: Row) => void;
  onPressMention?: (mention: CommentMentionRef) => void;
}) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const isCreator = !!postAuthorId && comment.author.userId === postAuthorId;
  /** Optimistic comments carry a tmp_ prefix — show a subtle pending indicator */
  const isPending = comment.id.startsWith('tmp_');
  const translation = useCaptionTranslation(comment.body);

  return (
    <View style={[s.commentRow, comment.isReply && s.commentRowIndented, isPending && s.commentRowPending, highlighted && s.commentRowHighlighted]} testID={highlighted ? 'comment-deep-link-highlight' : undefined}>
      <Avatar uri={isOfficialAccountId(comment.author.userId) ? (officialAvatarUri() ?? comment.author.avatarUrl) : comment.author.avatarUrl} initials={comment.author.initials} size={comment.isReply ? 26 : 32} recyclingKey={comment.id} />

      <View style={s.commentBody}>
        <PressableScale
          style={s.commentContentPress}
          accessibilityRole="button"
          accessibilityLabel={`Comment by ${comment.author.name}`}
          onLongPress={() => { if (!isPending) onMore(comment); }}
          delayLongPress={400}
          accessibilityActions={[{ name: 'longpress', label: 'Comment options' }]}
          onAccessibilityAction={() => { if (!isPending) onMore(comment); }}
          rippleEnabled={false}
          noMinHeight
        >
          {comment.pinned && !comment.isReply ? (
            <View style={s.pinnedRow} testID="comment-pinned-label">
              <Icon name="bookmark" size={10} color={MUTED} />
              <Text style={s.pinnedText}>Pinned</Text>
            </View>
          ) : null}

          <View style={s.commentHeader}>
            <Text style={s.authorName} numberOfLines={1}>{comment.author.name}</Text>
            {isCreator && <Text style={[s.creatorBadge, { color: theme.text }]}>· Creator</Text>}
            {!isCreator && comment.dayOne ? (
              <Text style={[s.creatorBadge, { color: MUTED }]} accessibilityLabel="Day 1 buyer" testID="comment-day-one">· Day 1</Text>
            ) : null}
            {isPending && <View style={s.pendingDot} />}
          </View>

          {comment.isReply && comment.parentAuthorName ? (
            <Text style={s.replyContext}>Replying to {comment.parentAuthorName}</Text>
          ) : null}

          {comment.body ? (
            <MentionText
              body={translation.text}
              mentions={comment.mentions}
              style={[s.commentText, comment.pendingReview && s.commentTextHeld]}
              onPressMention={onPressMention}
            />
          ) : null}

          {comment.creatorLiked && !isCreator ? (
            <View style={s.creatorLikedBadge}>
              <FontAwesome name="heart" size={9} color={theme.accent} />
              <Text style={[s.creatorLikedText, { color: theme.accent }]}>Creator liked</Text>
            </View>
          ) : null}

          {comment.pendingReview ? (
            <View style={s.reviewPill}>
              <Icon name="eye-off" size={11} color={theme.warning} />
              <Text style={s.reviewPillText}>In review · only you can see this</Text>
            </View>
          ) : null}
        </PressableScale>

        <TranslationLink translation={translation} style={s.translationLink} />
        {comment.media ? <CommentPhotoView media={comment.media} compact={comment.isReply} /> : null}

        {/* Time and Reply are two plain-text-height children of the same
            centered flex row — no per-item padding/margin, no minHeight box
            around either one — so they land on one shared baseline instead
            of Reply floating above Time inside its own tall tap target.
            There's no "···" here: long-press on the comment content above
            opens the same options menu. */}
        <View style={s.commentMeta}>
          <Text style={s.commentTime}>{isPending ? 'Posting…' : shortRelativeTime(comment.createdAt)}</Text>
          {!isPending && !comment.pendingReview && <Text style={s.commentTime}>·</Text>}
          {!isPending && !comment.pendingReview && (
            <PressableScale
              style={s.replyBtn}
              onPress={() => onReply(comment)}
              accessibilityRole="button"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              noMinHeight
            >
              <Text style={s.replyLabel}>Reply</Text>
            </PressableScale>
          )}
        </View>
      </View>

      {/* The heart sits in its own right-hand column, top-aligned a few
          points below the username — not sunk down to the meta row. */}
      {!isPending && !comment.pendingReview && (
        <LikeHeart
          liked={comment.likedByMe}
          count={comment.likesCount}
          onPress={() => onLike(comment)}
          accessibilityLabel={`${comment.likedByMe ? 'Unlike' : 'Like'} comment`}
          itemKey={comment.id}
        />
      )}
      {!isPending && !comment.pendingReview && onDislike && (
        <PressableScale
          style={s.commentLike}
          onPress={() => onDislike(comment)}
          accessibilityRole="button"
          accessibilityLabel={comment.dislikedByMe ? 'Remove dislike' : 'Dislike comment'}
          accessibilityState={{ selected: !!comment.dislikedByMe }}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 8 }}
          testID={`comment-dislike-${comment.id}`}
          noMinHeight
        >
          <View style={s.commentLikeIconWrap}>
            <FontAwesome name={comment.dislikedByMe ? 'thumbs-down' : 'thumbs-o-down'} size={15} color={comment.dislikedByMe ? FG : MUTED} />
          </View>
        </PressableScale>
      )}
    </View>
  );
});

// ─── View/hide replies toggle ──────────────────────────────────────────────────
// Reply threads start collapsed under their root comment (TikTok/Reels
// pattern) — this row expands or re-collapses them on tap.

function ViewRepliesButton({ count, expanded, onToggle }: { count: number; expanded: boolean; onToggle: () => void }) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  return (
    <PressableScale
      style={s.viewRepliesRow}
      onPress={() => onToggle()}
      accessibilityRole="button"
      accessibilityLabel={expanded ? 'Hide replies' : `View ${count} ${count === 1 ? 'reply' : 'replies'}`}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      noMinHeight
    >
      <View style={s.viewRepliesLine} />
      <Text style={s.viewRepliesText}>
        {expanded ? 'Hide replies' : `View ${count} ${count === 1 ? 'reply' : 'replies'}`}
      </Text>
      <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={12} color={MUTED} />
    </PressableScale>
  );
}

// ─── Comment actions sheet ────────────────────────────────────────────────────

type SheetStep = 'menu' | 'confirm-delete' | 'confirm-block';

function CommentActionsSheet({
  comment,
  onClose,
  onReply,
  onReport,
  onBlock,
  onDelete,
  canPin = false,
  onTogglePin,
}: {
  comment: Row | null;
  /** The viewer owns the post, so top-level comments can be pinned. */
  canPin?: boolean;
  onTogglePin?: (comment: Row) => void;
  onClose: () => void;
  onReply: (comment: Row) => void;
  onReport: (comment: Row) => void;
  onBlock: (comment: Row) => Promise<void>;
  onDelete: (comment: Row) => Promise<void>;
}) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const [step, setStep] = useState<SheetStep>('menu');
  const [busy, setBusy] = useState(false);
  // Keep the last comment on screen while the sheet slides away.
  const lastComment = useRef<Row | null>(comment);
  if (comment) lastComment.current = comment;
  const shown = comment ?? lastComment.current;

  useEffect(() => { setStep('menu'); setBusy(false); }, [comment?.id]);

  if (!shown) return null;
  const name = shown.author.name;

  const run = async (action: (c: Row) => Promise<void>) => {
    setBusy(true);
    try { await action(shown); } finally { setBusy(false); }
  };

  const confirming = step !== 'menu';

  return (
    <Sheet
      visible={!!comment}
      onClose={busy ? () => {} : onClose}
      headerRight="none"
      accessibilityLabel="Comment options"
      testID="comment-actions-sheet"
      primaryAction={confirming ? {
        label: step === 'confirm-block' ? 'Block' : 'Delete',
        variant: 'destructive',
        loading: busy,
        disabled: busy,
          onPress: () => { void run(step === 'confirm-block' ? onBlock : onDelete); },
      } : undefined}
      secondaryAction={confirming ? { label: 'Cancel', onPress: () => setStep('menu'), disabled: busy } : undefined}
    >
      <View style={s.sheetPreview}>
        <Avatar uri={shown.author.avatarUrl} initials={shown.author.initials} size={30} />
        <View style={{ flex: 1 }}>
          <Text style={s.sheetPreviewName}>{name}</Text>
          <Text style={s.sheetPreviewText} numberOfLines={2}>{shown.body}</Text>
        </View>
      </View>

      {!confirming ? (
        <MenuBlocks
          onClose={onClose}
          testID="comment-actions"
          sections={[
            [
              ...(!shown.pendingReview
                ? [{ key: 'reply', icon: 'corner-up-left' as const, label: 'Reply', onPress: () => onReply(shown) }]
                : []),
              ...(canPin && onTogglePin && !shown.isReply && !shown.pendingReview
                ? [{
                  key: 'pin', icon: 'bookmark' as const,
                  label: shown.pinned ? 'Unpin comment' : 'Pin comment',
                  onPress: () => onTogglePin(shown),
                }]
                : []),
            ],
            [
              ...(!shown.isMine
                ? [
                  { key: 'report', icon: 'flag' as const, label: 'Report comment', destructive: true, onPress: () => onReport(shown) },
                  { key: 'block', icon: 'slash' as const, label: `Block ${name}`, destructive: true, keepOpen: true, onPress: () => setStep('confirm-block') },
                ]
                : []),
              ...(shown.canDelete
                ? [{ key: 'delete', icon: 'trash-2' as const, label: 'Delete comment', destructive: true, keepOpen: true, onPress: () => setStep('confirm-delete') }]
                : []),
            ],
          ]}
        />
      ) : (
        <View style={s.confirmBlock}>
          <Text style={s.confirmTitle}>
            {step === 'confirm-block' ? `Block ${name}?` : 'Delete this comment?'}
          </Text>
          <Text style={s.confirmBody}>
            {step === 'confirm-block'
              ? BLOCK_EXPLAINER
              : shown.isMine
                ? 'It will be removed for everyone. This can’t be undone.'
                : 'As the post owner you can remove comments from your post. This can’t be undone.'}
          </Text>
        </View>
      )}
    </Sheet>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

type CommentsThreadInput = {
  postId: string;
  postAuthorId?: string;
  postAuthorName?: string;
  postAuthorInitials?: string;
  postAuthorColor?: string;
  postCaption?: string;
  postMediaUri?: string;
  postPosterUri?: string;
  postMediaColor1?: string;
  postMediaColor2?: string;
  postType?: string;
  /** Deep link from an Activity row / push: open on this exact comment. */
  commentId?: string;
};

/** Route entry: reads params and renders the full split-modal screen. */
export default function BuyerPostCommentsScreen() {
  const params = useLocalSearchParams<CommentsThreadInput>();
  return <CommentsThread input={params} />;
}

export interface ThreadCommentsSheetProps {
  visible: boolean;
  postId: string;
  postAuthorId?: string;
  postAuthorName?: string;
  postCaption?: string;
  onClose: () => void;
}

/**
 * Inline comments over a still-mounted, still-playing feed/viewer: the shared
 * BottomSheet (dim backdrop, grabber drag) around the same real thread the
 * route uses — no media box, no second video player. Nothing mounts or
 * loads until `visible` first turns true; the thread unmounts shortly after
 * close so a reopen refetches fresh.
 */
export function ThreadCommentsSheet({ visible, postId, postAuthorId, postAuthorName, postCaption, onClose }: ThreadCommentsSheetProps) {
  const { height } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  useEffect(() => {
    if (visible) { setMounted(true); return; }
    const t = setTimeout(() => setMounted(false), 400);
    return () => clearTimeout(t);
  }, [visible]);
  const input = useMemo<CommentsThreadInput>(
    () => ({ postId, postAuthorId, postAuthorName, postCaption }),
    [postId, postAuthorId, postAuthorName, postCaption],
  );
  if (!mounted) return null;
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      scrollable={false}
      padded={false}
      headerRight="none"
      maxHeightRatio={0.92}
      accessibilityLabel="Comments"
      testID="thread-comments-sheet"
    >
      <View style={{ height: Math.round(height * 0.7) }}>
        <CommentsThread input={input} embedded onClose={onClose} />
      </View>
    </Sheet>
  );
}

function CommentsThread({ input, embedded = false, onClose }: { input: CommentsThreadInput; embedded?: boolean; onClose?: () => void }) {
  useFailOnNestedButtonWarning();
  const { theme } = useAppTheme();
  const { height: windowHeight } = useWindowDimensions();
  const s = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const close = useStableCallback(() => { if (onClose) onClose(); else goBackOr(router); });
  const api = useApi();
  const { user } = useUser();
  const [guestMutedPhrases, setGuestMutedPhrases] = useState<string[] | null>(null);
  useEffect(() => {
    if (user?.id) {
      setGuestMutedPhrases([]);
      return;
    }
    let active = true;
    void readGuestMutedWords().then(
      (words) => { if (active) setGuestMutedPhrases(words.map((word) => word.phrase)); },
      () => { if (active) setGuestMutedPhrases(null); },
    );
    return () => { active = false; };
  }, [user?.id]);
  const isFocused = useIsFocused();

  /**
   * Sheet grows with the keyboard instead of the keyboard eating into a
   * fixed-height sheet (which used to squeeze the comment list and composer
   * down to almost nothing). The base is ~65% of the screen (TikTok/Reels
   * proportion — enough of the video stays visible above it); it can grow up
   * to 92% as the keyboard rises, and `KeyboardAvoidingView`'s own
   * padding/height behavior below shifts content back above the keyboard,
   * so the visible list area stays roughly constant instead of collapsing.
   */
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates?.height ?? 0));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);
  // Half / full detents (Instagram comments, Apple Maps): opens at half,
  // drag the grabber up for full, down from full back to half, down from
  // half to dismiss.
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(false);
  expandedRef.current = expanded;
  const sheetBaseHeight = windowHeight * (expanded ? 0.92 : 0.7);
  const sheetMaxHeight = windowHeight * 0.92;
  const sheetHeight = Math.min(sheetBaseHeight + keyboardHeight, sheetMaxHeight);

  /**
   * The sheet's height (and the media box's height, which is always
   * `windowHeight - sheetHeight`) resizes smoothly on the app's shared
   * SHEET_TIMING curve whenever the keyboard opens/closes — never an
   * instant jump, and never a spring (a spring on the media box would read
   * as the video "zooming" as it overshoots). `useNativeDriver: false` is
   * required since height can't run on the native driver, but this is a
   * once-per-keyboard-event animation, not a per-frame gesture.
   */
  const sheetHeightAnim = useRef(new Animated.Value(sheetBaseHeight)).current;
  const prevSheetHeight = useRef(sheetBaseHeight);
  const sheetEasing = useRef(Easing.bezier(...SHEET_EASING_BEZIER)).current;
  useEffect(() => {
    if (prevSheetHeight.current === sheetHeight) return;
    const opening = sheetHeight > prevSheetHeight.current;
    prevSheetHeight.current = sheetHeight;
    Animated.timing(sheetHeightAnim, {
      toValue: sheetHeight,
      duration: opening ? SHEET_OPEN_MS : SHEET_CLOSE_MS,
      easing: sheetEasing,
      useNativeDriver: false,
    }).start();
  }, [sheetHeight, sheetHeightAnim, sheetEasing]);
  const mediaAreaHeight = useMemo(
    () => Animated.subtract(windowHeight, sheetHeightAnim),
    [windowHeight, sheetHeightAnim],
  );

  // Drag-to-dismiss: the sheet follows the finger via `dragY` and springs
  // back to 0 (no overshoot — matches the app's low-bounce spring standard
  // used elsewhere, e.g. the feed's shop tab) when released above the
  // dismiss threshold, or all the way closed (navigating back) once past it.
  const dragY = useRef(new Animated.Value(0)).current;
  const DISMISS_THRESHOLD = 120;
  const dragResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dy) > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_evt, gesture) => {
        if (gesture.dy > 0) dragY.setValue(gesture.dy);
      },
      onPanResponderRelease: (_evt, gesture) => {
        if (!expandedRef.current && (gesture.dy < -40 || gesture.vy < -0.8)) {
          setExpanded(true);
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 0 }).start();
        } else if (expandedRef.current && (gesture.dy > 60 || gesture.vy > 0.8)) {
          setExpanded(false);
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 0 }).start();
        } else if (gesture.dy > DISMISS_THRESHOLD || gesture.vy > 1.2) {
          Animated.timing(dragY, { toValue: windowHeight, duration: 180, useNativeDriver: true }).start(() => close());
        } else {
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 0 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(dragY, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 0 }).start();
      },
    }),
  ).current;
  const params = input;
  const targetCommentId = typeof params.commentId === 'string' ? params.commentId : '';

  const postId = params.postId ?? '';
  const isPreviewPost = postId.length > 0 && !UUID_RE.test(postId);
  const postAuthorId = params.postAuthorId ?? '';
  const mediaUri = embedded ? '' : (params.postMediaUri ?? '');
  const posterUri = params.postPosterUri ?? '';
  const postType = params.postType ?? 'photo';
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoErrored, setVideoErrored] = useState(false);
  const mediaPlayer = useVideoPlayer(
    mediaUri && postType === 'video' ? { uri: mediaUri } : null,
    player => {
      player.loop = true;
      player.muted = true;
      player.play();
    },
  );

  useEffect(() => {
    const subscription = mediaPlayer.addListener('playingChange', ({ isPlaying }) => {
      setVideoPlaying(isPlaying);
    });
    // A broken/unreachable media URL must fall back to the poster (or the
    // plain scrim) instead of leaving an empty <video> element, which paints
    // as a flat gray rectangle on web.
    const statusSubscription = mediaPlayer.addListener('statusChange', ({ status }) => {
      setVideoErrored(status === 'error');
    });
    return () => { subscription.remove(); statusSubscription.remove(); };
  }, [mediaPlayer]);

  useFocusEffect(useCallback(() => {
    if (mediaUri && postType === 'video') mediaPlayer.play();
    return () => mediaPlayer.pause();
  }, [mediaPlayer, mediaUri, postType]));
  useMeaningfulVideoWatch(
    mediaPlayer,
    isFocused && !!user?.id && UUID_RE.test(postId) && postType === 'video' && !!mediaUri,
    () => { void api.posts.recordWatchedVideo(postId).catch(() => {}); },
  );

  const myName = user?.fullName || user?.firstName || user?.username || 'You';
  const myInitials = myName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'Y';
  const myAvatar = user?.hasImage ? user.imageUrl : null;

  const [comments, setComments] = useState<Row[]>([]);
  /** Top / Newest chips under the header, YouTube's comments sheet (#142). */
  const [sort, setSort] = useState<CommentSort>('top');
  // Sort + photo tools live behind the header options menu so the initial
  // layout matches the reference (no pill row above the list).
  const [optionsOpen, setOptionsOpen] = useState(false);
  /** Root comment ids whose reply thread is expanded (collapsed by default). */
  const [expandedRoots, setExpandedRoots] = useState<Set<string>>(new Set());
  const [meta, setMeta] = useState({ hiddenByMutedWords: 0, commentsDisabled: false, canComment: true, isPostOwner: false, nextCursor: null as string | null });
  const [inputText, setInputText] = useState('');
  const [replyingTo, setReplyingTo] = useState<Row | null>(null);
  const [sending, setSending] = useState(false);
  /** True only on the first load (no prior data) */
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  /** Error message shown inline below the count row */
  const [fetchError, setFetchError] = useState<string | null>(null);
  /** Transient post-failure message shown below the input */
  const [sendError, setSendError] = useState<string | null>(null);
  /** Shown after a comment is held by the filter. */
  const [heldNotice, setHeldNotice] = useState<string | null>(null);
  const [actionsFor, setActionsFor] = useState<Row | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const listRef = useRef<FlashListRef<Row | ViewRepliesRow>>(null);
  const inputRef = useRef<TextInput>(null);
  const hasLoadedOnce = useRef(false);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast((current) => (current === message ? null : current)), 2600);
  }, []);

  /**
   * Every write to `comments` for a preview post also mirrors into
   * `previewCommentsCache`, so a comment posted this session survives
   * closing and reopening the sheet for the same preview post (there's no
   * server row to persist it otherwise).
   */
  const setCommentsSynced = useCallback((updater: Row[] | ((prev: Row[]) => Row[])) => {
    setComments(prev => {
      const next = typeof updater === 'function' ? (updater as (p: Row[]) => Row[])(prev) : updater;
      if (isPreviewPost) previewCommentsCache.set(postId, next);
      return next;
    });
  }, [isPreviewPost, postId]);

  const load = useCallback(async () => {
    if (!postId) { setLoading(false); return; }
    if (!UUID_RE.test(postId)) {
      // Preview/demo content has no backing server post, but it still gets
      // a real comments experience: 8-15 seeded comments (persisted for the
      // session in previewCommentsCache) and a fully working composer that
      // appends locally, instead of the old locked, empty dead-end state.
      const cached = previewCommentsCache.get(postId);
      let seeded = cached ?? (isPreviewDemoMode() ? flatten(buildPreviewComments(postId, params.postAuthorName || 'the creator')) : []);
      // A seeded Activity row deep-linking to "its" comment: that comment
      // has to exist here to be scrolled to — add it on top of the seed.
      const note = targetCommentId && !seeded.some((c) => c.id === targetCommentId)
        ? getPreviewActivityForComment(targetCommentId)
        : undefined;
      if (note && note.targetId === postId) {
        seeded = [...flatten(previewNotificationComments({
          commentId: targetCommentId,
          postId,
          type: note.type,
          body: note.body,
          actorName: note.actorName || 'Someone',
          createdAt: note.createdAt,
        }, myName)), ...seeded];
      }
      if (!cached) previewCommentsCache.set(postId, seeded);
      setComments(seeded);
      setMeta({ hiddenByMutedWords: 0, commentsDisabled: false, canComment: true, isPostOwner: !!user?.id && user.id === postAuthorId, nextCursor: null });
      setFetchError(null);
      hasLoadedOnce.current = true;
      setLoading(false);
      return;
    }
    // Only show skeleton on the very first load; subsequent fetches are silent
    if (!hasLoadedOnce.current) setLoading(true);
    setFetchError(null);
    try {
      const thread = await api.comments.list(postId, undefined, sort);
      setComments(flatten(thread.comments));
      setMeta({
        hiddenByMutedWords: thread.hiddenByMutedWords,
        commentsDisabled: thread.commentsDisabled,
        canComment: thread.canComment,
        isPostOwner: !!thread.isPostOwner,
        nextCursor: thread.nextCursor,
      });
      hasLoadedOnce.current = true;
    } catch (error) {
      setFetchError(apiErrorCode(error) === 'NOT_FOUND'
        ? 'This post is no longer available.'
        : 'Could not load comments. Tap Retry to try again.');
    } finally {
      setLoading(false);
    }
  }, [api, postId, params.postAuthorName, targetCommentId, myName, user?.id, postAuthorId, sort]);

  useEffect(() => { load(); }, [load]);
  const pull = usePullToRefresh(load);

  const loadMore = useCallback(async () => {
    if (!meta.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const thread = await api.comments.list(postId, meta.nextCursor, sort);
      setComments((prev) => [...prev, ...flatten(thread.comments)]);
      setMeta((prev) => ({ ...prev, nextCursor: thread.nextCursor }));
    } catch {
      // The footer keeps its "Load more" affordance for a manual retry.
    } finally {
      setLoadingMore(false);
    }
  }, [api, loadingMore, meta.nextCursor, postId, sort]);

  const postComment = useCallback(
    (text: string, parentId?: string | null, mediaId?: string | null) => (mediaId
      ? createComment(postId, { body: text, parentId, mediaId })
      : api.comments.create(postId, text, parentId)),
    [api, postId],
  );
  const photo = useCommentPhotoDraft(showToast);

  // Row callbacks are stable (useCallback) so a like re-renders only the
  // liked row: CommentRow is memoized and the other rows' props are unchanged.
  const handleLike = useCallback(async (comment: Row) => {
    const liked = !comment.likedByMe;
    if (liked) haptic('like');
    // Optimistic update
    setCommentsSynced(prev => prev.map(c => c.id === comment.id
      ? applyOptimisticLike(c, liked)
      : c));
    if (isPreviewPost) return; // Local-only — nothing to confirm against a server.
    try {
      const result = await api.comments.like(postId, comment.id, liked);
      setCommentsSynced(prev => prev.map(c => c.id === comment.id ? { ...c, likedByMe: result.liked, dislikedByMe: result.liked ? false : c.dislikedByMe, likesCount: result.likesCount } : c));
    } catch {
      setCommentsSynced(prev => prev.map(c => c.id === comment.id ? restoreReaction(c, comment) : c));
    }
  }, [api, isPreviewPost, postId, setCommentsSynced]);

  // Dislike is server-backed only (api.comments.dislike) — same endpoint and
  // state for root and reply rows. Disliking clears an active like.
  const handleDislike = useCallback(async (comment: Row) => {
    if (isPreviewPost) return; // No server row: never fake a local-only dislike.
    const disliked = !comment.dislikedByMe;
    hapticLight();
    setCommentsSynced(prev => prev.map(c => c.id === comment.id
      ? applyOptimisticDislike(c, disliked)
      : c));
    try {
      const result = await api.comments.dislike(postId, comment.id, disliked);
      setCommentsSynced(prev => prev.map(c => c.id === comment.id ? { ...c, dislikedByMe: result.disliked, likedByMe: result.liked, likesCount: result.likesCount } : c));
    } catch {
      setCommentsSynced(prev => prev.map(c => c.id === comment.id ? restoreReaction(c, comment) : c));
    }
  }, [api, isPreviewPost, postId, setCommentsSynced]);

  const handleReply = useCallback((comment: Row) => {
    setReplyingTo(comment);
    inputRef.current?.focus();
  }, []);

  const handleCancelReply = () => {
    setReplyingTo(null);
    setInputText('');
  };

  const handleReport = (comment: Row) => {
    router.push(reportHref({
      targetType: 'comment',
      targetId: comment.id,
      label: `${comment.author.name}: “${comment.body.slice(0, 80)}”`,
      ownerId: comment.author.userId,
      ownerName: comment.author.name,
    }) as never);
  };

  const handleBlock = async (comment: Row) => {
    try {
      await api.social.block(comment.author.userId);
      setActionsFor(null);
      showToast(`${comment.author.name} is blocked`);
      await load();
    } catch (error) {
      setActionsFor(null);
      setSendError(apiErrorMessage(error, 'Could not block this account. Try again.'));
    }
  };

  const handleDelete = async (comment: Row) => {
    if (isPreviewPost) {
      // Local-only — nothing on a server to delete.
      setActionsFor(null);
      setCommentsSynced(prev => prev.filter(c => c.id !== comment.id && c.parentId !== comment.id));
      bumpCommentCount(postId, -1);
      showToast('Comment deleted');
      return;
    }
    try {
      await api.comments.remove(postId, comment.id);
      setActionsFor(null);
      setCommentsSynced(prev => prev.filter(c => c.id !== comment.id && c.parentId !== comment.id));
      bumpCommentCount(postId, -1);
      showToast('Comment deleted');
    } catch (error) {
      setActionsFor(null);
      setSendError(apiErrorMessage(error, 'Could not delete this comment. Try again.'));
    }
  };

  const handleTogglePin = async (comment: Row) => {
    const pin = !comment.pinned;
    const applyLocal = () => setCommentsSynced(prev => {
      const updated = prev.map(c => ({ ...c, pinned: c.isReply ? c.pinned : (c.id === comment.id ? pin : false) }));
      if (!pin) return updated;
      // A pinned comment leads the list; keep its replies right behind it.
      const group = updated.filter(c => c.id === comment.id || c.parentId === comment.id);
      return [...group, ...updated.filter(c => c.id !== comment.id && c.parentId !== comment.id)];
    });
    if (isPreviewPost) {
      applyLocal();
      showToast(pin ? 'Comment pinned' : 'Comment unpinned');
      return;
    }
    try {
      if (pin) await api.comments.pin(postId, comment.id); else await api.comments.unpin(postId, comment.id);
      showToast(pin ? 'Comment pinned' : 'Comment unpinned');
      await load();
    } catch (error) {
      setSendError(apiErrorMessage(error, pin ? 'Could not pin this comment. Try again.' : 'Could not unpin this comment. Try again.'));
    }
  };

  const handlePressMention = useCallback((mention: CommentMentionRef) => {
    router.push({
      pathname: '/buyer-other-profile' as never,
      params: { userId: mention.userId, handle: `@${mention.handle}` },
    } as never);
  }, [router]);

  const mentionQuery = activeMentionQuery(inputText);

  const handleSend = async () => {
    const text = inputText.trim();
    const photoDraft = photo.draft;
    const media = photo.media;
    if ((!text && !media) || sending || photo.uploading || photo.blocked) return;
    setSending(true);
    setSendError(null);
    setHeldNotice(null);
    const parent = replyingTo;
    const optimistic: Row = {
      id: `tmp_${Date.now()}`,
      postId,
      parentId: parent ? (parent.parentId ?? parent.id) : null,
      body: text,
      createdAt: new Date().toISOString(),
      author: {
        userId: user?.id ?? 'me', name: myName, handle: '', initials: myInitials,
        avatarUrl: myAvatar, accountType: null, suspended: false, deleted: false,
      },
      likesCount: 0,
      likedByMe: false,
      isMine: true,
      canDelete: true,
      pendingReview: false,
      media,
      replies: [],
      isReply: !!parent,
      parentAuthorName: parent?.author.name,
    };
    setCommentsSynced(prev => {
      if (!parent) return [optimistic, ...prev];
      const index = prev.findIndex(c => c.id === (parent.parentId ?? parent.id));
      const next = [...prev];
      next.splice(index + 1, 0, optimistic);
      return next;
    });
    // A reply posted to a currently-collapsed thread must be visible right
    // away, not hidden behind "View replies" until the user happens to tap it.
    if (parent) {
      const rootId = parent.parentId ?? parent.id;
      setExpandedRoots(prev => (prev.has(rootId) ? prev : new Set(prev).add(rootId)));
    }
    setInputText('');
    setReplyingTo(null);
    photo.clear();

    if (isPreviewPost) {
      // Local-only: no server round trip, the optimistic comment IS the
      // final comment — just drop its tmp_ id so it isn't mistaken for
      // still-in-flight, and bump the rail's count immediately.
      const finalized: Row = { ...optimistic, id: `preview-comment-${postId}-posted-${Date.now()}` };
      setCommentsSynced(prev => prev.map(c => (c.id === optimistic.id ? finalized : c)));
      bumpCommentCount(postId, 1);
      haptic('postPublished');
      setSending(false);
      return;
    }

    try {
      const created = await postComment(text, parent ? (parent.parentId ?? parent.id) : null, media?.id);
      if (created.moderation.status === 'held') {
        setHeldNotice(created.moderation.message ?? 'Your comment is in review. Only you can see it for now.');
      }
      // Successful post: remove the optimistic item and reload to get the
      // authoritative comment from the server with the real ID and count.
      setCommentsSynced(prev => prev.filter(c => c.id !== optimistic.id));
      await load();
      bumpCommentCount(postId, 1);
      haptic('postPublished');
    } catch (error) {
      // Remove optimistic item, keep the draft for editing, show inline error
      setCommentsSynced(prev => prev.filter(c => c.id !== optimistic.id));
      setInputText(text);
      setReplyingTo(parent);
      if (photoDraft && apiErrorCode(error) !== 'MEDIA_NOT_FOUND') photo.restore(photoDraft);
      const code = apiErrorCode(error);
      setSendError(
        code === 'CONTENT_REJECTED' || code === 'ACCOUNT_SUSPENDED' || code === 'BLOCKED' || code === 'COMMENTS_DISABLED' || code === 'COMMENTS_LIMITED'
          ? apiErrorMessage(error, 'This comment can’t be posted.')
          : 'Could not post comment. Tap to retry.',
      );
      haptic('error');
    } finally {
      setSending(false);
    }
  };

  /** Real comment count (excludes temp optimistic items and held comments) */
  const realCount = useMemo(
    () => comments.filter(c => !c.id.startsWith('tmp_') && !c.pendingReview).length,
    [comments],
  );

  /**
   * Reply threads render collapsed by default (TikTok/Reels pattern): each
   * root is followed either by its replies (if its id is in `expandedRoots`)
   * or by a single "View N replies" row standing in for them.
   */
  const visibleRows = useMemo(() => {
    const out: (Row | ViewRepliesRow)[] = [];
    // Real posts come back sorted by the server; preview comments live on
    // the device, so they get the same order here.
    const ordered = isPreviewPost ? sortFlatRows(comments, sort) : comments;
    const visibleComments = user?.id ? ordered : guestMutedPhrases === null ? [] : ordered.filter(
      (comment) => !matchesGuestMutedWords(comment.body, guestMutedPhrases),
    );
    let i = 0;
    while (i < visibleComments.length) {
      const row = visibleComments[i];
      if (row.isReply) { i += 1; continue; } // orphaned reply — shouldn't happen, skip defensively
      out.push(row);
      let j = i + 1;
      const replies: Row[] = [];
      while (j < visibleComments.length && visibleComments[j].isReply && visibleComments[j].parentId === row.id) {
        replies.push(visibleComments[j]);
        j += 1;
      }
      if (replies.length > 0) {
        const expanded = expandedRoots.has(row.id);
        if (expanded) out.push(...replies);
        out.push({ _viewReplies: true, rootId: row.id, count: replies.length, expanded });
      }
      i = j;
    }
    return out;
  }, [comments, expandedRoots, user?.id, guestMutedPhrases, isPreviewPost, sort]);

  const toggleReplies = useCallback((rootId: string) => {
    setExpandedRoots(prev => {
      const next = new Set(prev);
      if (next.has(rootId)) next.delete(rootId); else next.add(rootId);
      return next;
    });
  }, []);

  // ── Deep link to one comment (?commentId=, from an Activity row / push) ──
  // Instagram-style: open on that comment — its reply thread expanded if
  // it's a reply, scrolled into view, briefly highlighted. Older pages load
  // until it's found (bounded); a deleted/hidden comment just opens the
  // sheet normally.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const deepLinkDone = useRef(false);
  const deepLinkPages = useRef(0);
  useEffect(() => {
    if (!targetCommentId || deepLinkDone.current || loading) return;
    const target = comments.find((c) => c.id === targetCommentId);
    if (!target) {
      if (meta.nextCursor && !loadingMore && deepLinkPages.current < 5) {
        deepLinkPages.current += 1;
        void loadMore();
      } else if (!meta.nextCursor || deepLinkPages.current >= 5) {
        deepLinkDone.current = true;
      }
      return;
    }
    deepLinkDone.current = true;
    if (target.isReply && target.parentId) {
      const rootId = target.parentId;
      setExpandedRoots((prev) => (prev.has(rootId) ? prev : new Set(prev).add(rootId)));
    }
    setHighlightId(target.id);
  }, [comments, loadMore, loading, loadingMore, meta.nextCursor, targetCommentId]);

  const deepLinkScrolled = useRef(false);
  useEffect(() => {
    if (!highlightId || deepLinkScrolled.current) return;
    const index = visibleRows.findIndex((row) => !isViewRepliesRow(row) && row.id === highlightId);
    if (index < 0) return;
    deepLinkScrolled.current = true;
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index, viewPosition: 0.3, animated: true });
    });
  }, [highlightId, visibleRows]);
  useEffect(() => {
    if (!highlightId) return;
    const fade = setTimeout(() => setHighlightId(null), 2600);
    return () => clearTimeout(fade);
  }, [highlightId]);

  const renderCommentItem = useCallback(({ item }: { item: Row | ViewRepliesRow }) => (
    isViewRepliesRow(item) ? (
      <ViewRepliesButton count={item.count} expanded={item.expanded} onToggle={() => toggleReplies(item.rootId)} />
    ) : (
      <CommentRow
        comment={item}
        highlighted={item.id === highlightId}
        postAuthorId={postAuthorId}
        onLike={handleLike}
        onReply={handleReply}
        onMore={setActionsFor}
        onPressMention={handlePressMention}
      />
    )
  ), [highlightId, postAuthorId, handleLike, handleReply, handlePressMention, toggleReplies]);

  // Typing in the composer re-renders this screen on every keystroke. Keep
  // the list's props referentially stable so the visible comment rows (and
  // the list header) don't re-render / remount with each character.
  const onLikeStable = useStableCallback(handleLike);
  const onDislikeStable = useStableCallback(handleDislike);
  const onReplyStable = useStableCallback(handleReply);
  const onPressMentionStable = useStableCallback(handlePressMention);
  const renderCommentRow = useCallback(({ item }: { item: Row | ViewRepliesRow }) => (
    isViewRepliesRow(item) ? (
      <ViewRepliesButton count={item.count} expanded={item.expanded} onToggle={() => toggleReplies(item.rootId)} />
    ) : (
      <CommentRow
        comment={item}
        highlighted={item.id === highlightId}
        postAuthorId={postAuthorId}
        onLike={onLikeStable}
        onDislike={isPreviewPost ? undefined : onDislikeStable}
        onReply={onReplyStable}
        onMore={setActionsFor}
        onPressMention={onPressMentionStable}
      />
    )
  ), [highlightId, postAuthorId, toggleReplies, onLikeStable, onDislikeStable, isPreviewPost, onReplyStable, onPressMentionStable]);
  const listHeader = useMemo(() => (
    <>
      {loading && [0, 1, 2, 3].map(i => <CommentSkeletonRow key={i} />)}
      {!loading && fetchError ? <InlineError message={fetchError} onRetry={load} /> : null}
    </>
  ), [loading, fetchError, load]);

  const composerLocked = meta.commentsDisabled || !meta.canComment;

  // Opened directly with no post (deep link / typed route): there is no
  // media to sit above the sheet and no thread to load, so present a full
  // screen with the shared header instead of a sheet over a black void.
  if (isMissingParam(params.postId)) {
    return (
      <UnavailableScreen
        title="Comments"
        heading="Post not found"
        message="This post may have been deleted or the link may have expired."
        icon="message-circle"
        testID="buyer-post-comments-unavailable"
      />
    );
  }

  const sheetBody = (
    <>
          {/* Drag-to-dismiss handle — dragging down from here (not from the
              comment list, so it never fights list scrolling) springs the
              sheet back if released early, or slides it fully closed. */}
          {embedded ? null : (
            <View style={s.dragHandleArea} {...dragResponder.panHandlers}>
              <View style={s.dragHandle} />
            </View>
          )}
          <View style={s.header}>
            {!meta.commentsDisabled ? (
              <PressableScale
                style={s.headerSide}
                onPress={() => { hapticLight(); setOptionsOpen(true); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Comment options, sorted by ${COMMENT_SORTS.find((o) => o.id === sort)?.label ?? sort}`}
                testID="comments-options"
              >
                <Icon name="sliders" size={18} color={MUTED} />
              </PressableScale>
            ) : <View style={s.headerSide} />}
            <Text style={s.headerTitle}>
              {loading ? 'Comments' : `${realCount} comment${realCount === 1 ? '' : 's'}`}
            </Text>
            <PressableScale
              style={s.headerSide}
              onPress={close}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Close comments"
            >
              <Icon name="x" size={20} color={FG} />
            </PressableScale>
          </View>

          <KeyboardGestureArea style={{ flex: 1 }} textInputNativeID={COMMENT_INPUT_NATIVE_ID}>
          <FlashList
            ref={listRef}
            data={loading ? [] : visibleRows}
            refreshControl={pull.refreshControl}
            keyExtractor={commentRowKey}
            extraData={highlightId}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.listContent}
          ListHeaderComponent={listHeader}
          renderItem={renderCommentRow}
          ListEmptyComponent={
            !loading && !fetchError
              ? (
                <Text style={s.emptyLine} testID="comments-empty-line">
                  {meta.commentsDisabled ? 'Comments are turned off for this post.' : 'No comments yet. Start the conversation.'}
                </Text>
              )
              : null
          }
          ListFooterComponent={!loading ? (
            <View style={s.listFooter}>
              {meta.nextCursor ? (
                <PressableScale style={s.loadMore} onPress={() => loadMore()} disabled={loadingMore} accessibilityRole="button">
                  {loadingMore ? <InlineSpinner style={{ paddingVertical: 0 }} /> : <Text style={s.loadMoreText}>{sort === 'top' ? 'View more comments' : 'View older comments'}</Text>}
                </PressableScale>
              ) : null}
              {meta.hiddenByMutedWords > 0 ? (
                <PressableScale style={s.mutedNote} onPress={() => router.push('/muted-words' as never)} accessibilityRole="button">
                  <Icon name="volume-x" size={12} color={SUBTLE} />
                  <Text style={s.mutedNoteText}>
                    {meta.hiddenByMutedWords} hidden by your muted words · <Text style={{ textDecorationLine: 'underline' }}>Manage</Text>
                  </Text>
                </PressableScale>
              ) : null}
            </View>
          ) : null}
        />
          </KeyboardGestureArea>

        {toast ? (
          <View style={s.toast} pointerEvents="none" accessibilityLiveRegion="polite">
            <Icon name="check" size={14} color={theme.onAccent} />
            <Text style={s.toastText}>{toast}</Text>
          </View>
        ) : null}

        <View style={[s.inputWrap, composerLocked && { paddingBottom: Math.max(insets.bottom, SP.sm) }]}>
          {sendError ? (
            <PressableScale style={s.sendErrorBanner} onPress={() => setSendError(null)} accessibilityRole="alert">
              <Icon name="alert-circle" size={12} color={theme.error} />
              <Text style={s.sendErrorText} numberOfLines={3}>{sendError}</Text>
              <Icon name="x" size={12} color={theme.error} />
            </PressableScale>
          ) : null}
          {heldNotice ? (
            <PressableScale style={s.heldBanner} onPress={() => setHeldNotice(null)} accessibilityRole="alert">
              <Icon name="eye-off" size={12} color={theme.warning} />
              <Text style={s.heldBannerText} numberOfLines={2}>{heldNotice}</Text>
              <Icon name="x" size={12} color={MUTED} />
            </PressableScale>
          ) : null}
          {replyingTo ? (
            <View style={s.replyingBanner}>
              <Text style={s.replyingLabel} numberOfLines={1}>
                Replying to <Text style={[s.replyingName, { color: theme.text }]}>{replyingTo.author.name}</Text>
              </Text>
              <PressableScale
                onPress={() => handleCancelReply()}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                accessibilityRole="button"
                accessibilityLabel="Cancel reply"
              >
                <Icon name="x" size={14} color={MUTED} />
              </PressableScale>
            </View>
          ) : null}

          {composerLocked ? (
            <View style={s.lockedComposer}>
              {isPreviewPost ? (
                <Text style={s.lockedText}>Comments aren’t available on this post.</Text>
              ) : meta.commentsDisabled ? (
                <Text style={s.lockedText}>Comments are turned off for this post.</Text>
              ) : (
                <PressableScale style={s.signedOutRow} onPress={() => router.push('/sign-in' as never)} accessibilityRole="button" testID="comments-signed-out-composer">
                  <Icon name="user" size={32} color={MUTED} />
                  <View style={s.signedOutPill}>
                    <Text style={s.signedOutPlaceholder}>Sign in to join the conversation</Text>
                    <Text style={{ color: theme.text, fontFamily: FONT.semibold }}>Sign in</Text>
                  </View>
                </PressableScale>
              )}
            </View>
          ) : (
            <>
              {/* @mention suggestions: only while the text ends in an active
                  "@token"; reads the same mention-search API the story editor
                  uses (local demo people in preview mode, never the API). */}
              <MentionSuggestionsBar
                query={mentionQuery ?? ''}
                active={mentionQuery !== null}
                enabled={!isPreviewPost}
                demoPeople={isPreviewPost && isPreviewDemoMode() ? PREVIEW_MENTION_PEOPLE : undefined}
                onPick={(person) => {
                  setInputText(value => insertMentionHandle(value, person.username ?? person.handle));
                  inputRef.current?.focus();
                }}
              />
              {/* Bare emoji, evenly spaced across the full width, no chip
                  backgrounds — TikTok's quick-reaction row sits directly
                  above the composer with nothing else around each glyph. */}
              <View style={s.emojiRow}>
                {QUICK_EMOJI.map(emoji => (
                  <PressableScale
                    key={emoji}
                    style={s.emojiBtn}
                    onPress={() => {
                      setInputText(value => `${value}${emoji}`);
                      inputRef.current?.focus();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${emoji}`}
                    rippleEnabled={false}
                  >
                    <AppleEmoji emoji={emoji} size={24} />
                  </PressableScale>
                ))}
              </View>
              <Composer
                inputRef={inputRef}
                nativeID={COMMENT_INPUT_NATIVE_ID}
                inputAccessoryViewID={keyboardAccessoryID(COMMENT_ACCESSORY_ID)}
                value={inputText}
                onChangeText={setInputText}
                onSend={handleSend}
                busy={sending || photo.uploading}
                canSend={(inputText.trim().length > 0 || !!photo.media) && !sending && !photo.uploading && !photo.blocked}
                topSlot={photo.draft ? (
                  <CommentPhotoDraft draft={photo.draft} onRemove={() => { hapticLight(); photo.clear(); }} onRetry={photo.retry} />
                ) : null}
                placeholder={replyingTo ? `Reply to ${replyingTo.author.name}…` : 'Add comment…'}
                accessibilityLabel="Comment"
                maxLength={MAX_COMMENT_LENGTH}
                hideTabBar={false}
                style={s.composerFlush}
                leftAccessory={<Avatar uri={myAvatar} initials={myInitials} size={32} ring={false} backgroundColor="#2a2a2a" />}
                rightAccessory={(
                  <>
                    <PressableScale
                      style={s.inputTool}
                      onPress={() => {
                        setInputText(value => value.endsWith(' ') || !value ? `${value}@` : `${value} @`);
                        inputRef.current?.focus();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Mention someone"
                      testID="composer-mention"
                    >
                      <Text style={s.mentionIcon}>@</Text>
                    </PressableScale>
                    <PressableScale
                      style={s.inputTool}
                      onPress={() => inputRef.current?.focus()}
                      accessibilityRole="button"
                      accessibilityLabel="Emoji"
                      testID="composer-emoji"
                    >
                      <Icon name="smile" size={18} color={MUTED} />
                    </PressableScale>
                  </>
                )}
              />
            </>
          )}
          <KeyboardAccessoryBar nativeID={COMMENT_ACCESSORY_ID} />
        </View>
    </>
  );
  const optionsSheet = (
    <Sheet
      visible={optionsOpen}
      onClose={() => setOptionsOpen(false)}
      headerRight="none"
      accessibilityLabel="Comment options"
      testID="comments-options-sheet"
    >
      <MenuBlocks
        onClose={() => setOptionsOpen(false)}
        testID="comments-options-menu"
        sections={[
          COMMENT_SORTS.map((option) => ({
            key: `sort-${option.id}`,
            icon: sort === option.id ? ('check' as const) : ('list' as const),
            label: `Sort: ${option.label}`,
            onPress: () => {
              if (sort === option.id) return;
              haptic('select');
              setSort(option.id);
              listRef.current?.scrollToOffset({ offset: 0, animated: false });
            },
          })),
          ...(!composerLocked ? [[{
            key: 'photo',
            icon: 'image' as const,
            label: 'Add photo to comment',
            disabled: photo.uploading,
            onPress: () => { hapticLight(); void photo.pick(); },
          }]] : []),
        ]}
      />
    </Sheet>
  );
  const actionsSheet = (
      <CommentActionsSheet
        comment={actionsFor}
        onClose={() => setActionsFor(null)}
        onReply={handleReply}
        onReport={handleReport}
        onBlock={handleBlock}
        onDelete={handleDelete}
        canPin={meta.isPostOwner}
        onTogglePin={handleTogglePin}
      />
  );
  if (embedded) {
    return (
      <View style={s.sheetInner} testID="comments-sheet">
        {sheetBody}
        {actionsSheet}
        {optionsSheet}
      </View>
    );
  }

  return (
    <View style={s.overlay}>
      {/* Media lives in its own fixed box spanning screenTop → sheetTop —
          never the full screen — so the video/poster shrinks DOWN to fit
          inside it (contentFit="contain", centered) like real TikTok, instead
          of rendering at its own intrinsic pixel size (e.g. 1080x1920) inside
          a 390pt box and showing a blown-up crop. The box resizes with the
          sheet on the same non-spring SHEET_TIMING curve as the keyboard
          opens/closes — it only ever shrinks/grows in place, never zooms. */}
      <Animated.View style={[s.mediaBox, { height: mediaAreaHeight }]}>
        {mediaUri ? (
          postType === 'video' ? (
            <>
              {posterUri && (!videoPlaying || videoErrored) ? (
                <CachedImage
                  source={{ uri: posterUri }}
                  style={s.mediaFill}
                  contentFit="contain"
                  testID="comments-video-poster"
                />
              ) : null}
              {!videoErrored && (
                <VideoView
                  player={mediaPlayer}
                  style={[s.mediaFill, posterUri && !videoPlaying && { opacity: 0 }]}
                  contentFit="contain"
                  nativeControls={false}
                  testID="comments-video-preview"
                />
              )}
            </>
          ) : (
            <CachedImage source={{ uri: mediaUri }} style={s.mediaFill} contentFit="contain" />
          )
        ) : null}
        <PressableScale
          style={s.backdrop}
          activeOpacity={1}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Close comments"
          noMinHeight
        />
      </Animated.View>
      <Animated.View style={[s.sheet, { height: sheetHeightAnim, transform: [{ translateY: dragY }] }]}>
        <KeyboardAvoidingView
          style={s.sheetInner}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
          testID="comments-sheet"
        >
          {sheetBody}
        </KeyboardAvoidingView>
      </Animated.View>

      {actionsSheet}
      {optionsSheet}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  // A fixed-size box (width 100%, height screenTop→sheetTop) with
  // overflow hidden — the video/poster inside is centered and scaled DOWN
  // to fit (contentFit "contain" on mediaFill below), never cropped/zoomed
  // and never scaled up past its own resolution. No dim scrim (per the
  // owner's explicit correction) — just the media, centered.
  mediaBox: { width: '100%', overflow: 'hidden', backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  mediaFill: { width: '100%', height: '100%' },
  sheet: {
    overflow: 'hidden',
    backgroundColor: CARD,
    borderTopLeftRadius: RADII.sheet,
    borderTopRightRadius: RADII.sheet,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: BORDER,
  },
  sheetInner: { flex: 1 },

  dragHandleArea: { alignItems: 'center', paddingTop: 8, paddingBottom: 4 },
  dragHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: BORDER },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    height: 52, paddingHorizontal: SP.sm,
  },
  headerSide: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: FONT.bold, fontSize: FS.sm, color: FG },
  sortRow: { flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.md, paddingTop: 10, paddingBottom: 6 },
  sortChip: {
    height: 32, paddingHorizontal: 14, borderRadius: RADIUS.pill,
    alignItems: 'center', justifyContent: 'center', backgroundColor: SUBTLE_WASH,
  },
  sortChipOn: { backgroundColor: FG },
  sortChipText: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG },
  sortChipTextOn: { color: CARD },

  listContent: { paddingTop: 4, paddingBottom: SP.md, flexGrow: 1 },
  emptyState: { flex: 1, minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: SP.lg },
  emptyTitle: { color: FG, fontFamily: FONT.semibold, fontSize: FS.base },
  emptyText: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center' },
  listFooter: { alignItems: 'center', gap: SP.xs, paddingTop: SP.xs },
  loadMore: { paddingVertical: SP.sm, paddingHorizontal: SP.md, minHeight: 36, justifyContent: 'center' },
  loadMoreText: { color: MUTED, fontFamily: FONT.semibold, fontSize: FS.xs },
  mutedNote: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: SP.xs },
  mutedNoteText: { color: SUBTLE, fontFamily: FONT.regular, fontSize: FS.xs },

  // Comment rows
  // 8pt top + 8pt bottom = 16pt between consecutive comments (TikTok
  // spacing) — was 10+10=20pt, and the real gap used to balloon far past
  // that because PressableScale's forced 44pt minHeight boxes (now opted
  // out of via `noMinHeight` on this row's inner Pressables) inflated the
  // row's own height well beyond its actual content.
  commentRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: SP.md, paddingVertical: 8,
  },
  commentRowIndented: { paddingLeft: SP.md + 48 },
  commentRowPending: { opacity: 0.6 },
  // Deep-linked comment: a neutral light tint (monochrome), fades after ~2.6s.
  commentRowHighlighted: { backgroundColor: 'rgba(255,255,255,0.08)' },
  commentBody: { flex: 1, minWidth: 0 },
  commentHeader: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, marginBottom: 3 },
  authorName: { fontFamily: FONT.semibold, fontSize: 13, color: MUTED, flexShrink: 1 },
  creatorBadge: { fontFamily: FONT.semibold, fontSize: 13 },
  replyContext: { fontFamily: FONT.regular, fontSize: FS.xs, color: SUBTLE, marginBottom: 2 },
  commentTime: { fontFamily: FONT.regular, fontSize: 12, lineHeight: 16, color: SUBTLE },
  pendingDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: SUBTLE_WASH, marginLeft: 2 },
  commentText: { fontFamily: FONT.regular, fontSize: 15, color: FG, lineHeight: 19 },
  commentTextHeld: { color: MUTED },
  translationLink: { alignSelf: 'flex-start', marginTop: 2, color: MUTED },
  reviewPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    marginTop: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: theme.warning + '55', backgroundColor: theme.warning + '14',
  },
  reviewPillText: { color: theme.warning, fontFamily: FONT.medium, fontSize: 11 },
  pinnedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3 },
  pinnedText: { fontFamily: FONT.semibold, fontSize: 11, color: MUTED },
  creatorLikedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  creatorLikedText: { fontFamily: FONT.semibold, fontSize: 11 },
  commentContentPress: { alignItems: 'flex-start' },
  // Time and Reply are both plain, unpadded, same-size/same-lineHeight
  // children of one centered row — no minHeight tap-target box around
  // either one, which is what used to float Reply above Time. 4pt below the
  // comment text, per TikTok's own comment-row spacing.
  commentMeta: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, marginTop: 4 },
  // `noMinHeight` on the Reply Pressable itself (a wider tap area comes from
  // `hitSlop` instead) — otherwise PressableScale's forced 44pt-tall box
  // stretches this whole meta row to 44pt regardless of the 12pt text inside it.
  replyBtn: { justifyContent: 'center' },
  replyLabel: { fontFamily: FONT.regular, fontSize: 12, lineHeight: 16, color: SUBTLE },
  // Its own right-hand column, top-aligned ~4pt below the username line
  // (header line-height ~16 + 3pt header margin + 4pt gap), never sunk down
  // to the meta row. No overflow:hidden anywhere in this chain, and the icon
  // wrap is taller than the glyph itself, so the like-pop spring (which
  // briefly scales past 1.0) always has headroom instead of getting clipped.
  // `noMinHeight` on the LikeHeart Pressable itself (see LikeHeart) so this
  // column stays its actual content height instead of the row growing to
  // PressableScale's forced 44pt floor.
  commentLike: {
    width: 28, marginTop: 23, flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', gap: 2,
  },
  commentLikeIconWrap: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontFamily: FONT.regular, fontSize: 11, color: MUTED, textAlign: 'center' },
  // 8pt below the meta row above it, per TikTok's own spacing. `noMinHeight`
  // on this row's Pressable (see ViewRepliesButton) keeps this tight instead
  // of the ~60pt gap PressableScale's forced 44pt box used to create here.
  viewRepliesRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingLeft: SP.md + 48, marginTop: 8, paddingVertical: 4, minHeight: 20,
  },
  viewRepliesLine: { width: 20, height: 1, backgroundColor: '#3a3a3a' },
  viewRepliesText: { fontFamily: FONT.semibold, fontSize: FS.xs, color: MUTED },

  toast: {
    position: 'absolute', alignSelf: 'center', bottom: 150,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: theme.accent, borderRadius: RADIUS.pill, paddingHorizontal: 14, paddingVertical: 8,
  },
  toastText: { color: theme.onAccent, fontFamily: FONT.semibold, fontSize: FS.xs },

  // Input — 8pt vertical padding plus the safe area (applied via insets at
  // the call site), never a fixed larger pad.
  inputWrap: {
    borderTopWidth: 1, borderTopColor: BORDER, backgroundColor: CARD,
    paddingTop: 8, paddingHorizontal: 12,
  },
  sendErrorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: theme.error + '1A', borderRadius: RADIUS.sm,
    paddingHorizontal: SP.sm, paddingVertical: 6, marginBottom: SP.xs,
  },
  sendErrorText: { flex: 1, fontFamily: FONT.regular, fontSize: FS.xs, color: theme.error, lineHeight: 16 },
  heldBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: theme.warning + '14', borderRadius: RADIUS.sm, borderWidth: 1, borderColor: theme.warning + '40',
    paddingHorizontal: SP.sm, paddingVertical: 6, marginBottom: SP.xs,
  },
  heldBannerText: { flex: 1, fontFamily: FONT.regular, fontSize: FS.xs, color: FG, lineHeight: 16 },
  replyingBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: theme.accentDim, borderRadius: RADIUS.sm,
    paddingHorizontal: SP.sm, paddingVertical: SP.xs, marginBottom: SP.xs,
  },
  replyingLabel: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, flex: 1 },
  replyingName: { fontFamily: FONT.semibold },
  lockedComposer: { minHeight: 56, alignItems: 'center', justifyContent: 'center', paddingVertical: SP.sm },
  emptyLine: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', padding: SP.md },
  signedOutRow: { flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%' },
  signedOutPill: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: BORDER, paddingHorizontal: 14, gap: 8 },
  signedOutPlaceholder: { flex: 1, color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm },
  lockedText: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center' },
  // Bare emoji evenly spaced across the full width — no chip circle, no
  // background — sitting directly above the composer.
  emojiRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 10 },
  emojiBtn: { alignItems: 'center', justifyContent: 'center' },
  composerFlush: { paddingHorizontal: 0, paddingTop: 0, backgroundColor: CARD },
  inputTool: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  mentionIcon: { color: MUTED, fontFamily: FONT.bold, fontSize: 17, lineHeight: 20 },

  // Actions sheet
  sheetPreview: {
    flexDirection: 'row', gap: SP.sm, alignItems: 'flex-start',
    paddingTop: SP.xs, paddingBottom: SP.md,
  },
  sheetPreviewName: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm },
  sheetPreviewText: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, marginTop: 2 },
  confirmBlock: { paddingTop: SP.md, paddingBottom: SP.xs },
  confirmTitle: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.lg },
  confirmBody: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20, marginTop: 6 },
});
