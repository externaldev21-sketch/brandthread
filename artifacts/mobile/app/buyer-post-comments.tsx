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
import {
  View, Text, FlatList, TextInput, Modal, Pressable, PanResponder,
  KeyboardAvoidingView, Platform, StyleSheet, Animated, Keyboard, useWindowDimensions,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useUser } from '@clerk/expo';
import {
  SURFACE, CARD, CARD_ELEVATED, BORDER,
  FG, MUTED, SUBTLE,
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { PressableScale } from '@/components/BrandthreadUI';
import { InlineSpinner, InlineError } from '@/components/InlineFeedback';
import { EmptyState } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { useApi } from '@/lib/api';
import { apiErrorCode, apiErrorMessage, reportHref, shortRelativeTime, BLOCK_EXPLAINER } from '@/lib/safety';
import type { ThreadComment } from '@/lib/safetyTypes';
import { hapticSelection, hapticLight, hapticSuccess, hapticError, hapticDestructiveConfirm } from '@/lib/haptics';
import { bumpCommentCount } from '@/lib/commentCountBus';
import { buildPreviewComments } from '@/lib/previewComments';
import { AppleEmoji, QUICK_REACTION_EMOJI } from '@/lib/appleEmoji';

const MAX_COMMENT_LENGTH = 1000;
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

/** A flattened list row: roots followed by their replies. */
type Row = ThreadComment & { isReply: boolean; parentAuthorName?: string; creatorLiked?: boolean };

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

function Avatar({ uri, initials, size = 38 }: { uri?: string | null; initials: string; size?: number }) {
  const { theme } = useAppTheme();
  if (uri) {
    return <CachedImage source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" />;
  }
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2, backgroundColor: theme.cardElevated,
      borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{ color: theme.text, fontFamily: FONT.bold, fontSize: size > 34 ? FS.xs : 10 }}>{initials}</Text>
    </View>
  );
}

// ─── Like heart ───────────────────────────────────────────────────────────────
// Solid filled heart when liked, outline when not (Feather only ships an
// outline heart, so liking used to just recolor the same stroked glyph —
// Ionicons gives us a true filled variant). The container is taller than the
// icon itself with no overflow:hidden, so the pop animation on toggle can
// exceed the glyph's own bounds without being clipped at the top.

function LikeHeart({
  liked,
  count,
  onPress,
  accessibilityLabel,
}: {
  liked: boolean;
  count: number;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const pop = useRef(new Animated.Value(1)).current;
  const wasLiked = useRef(liked);

  useEffect(() => {
    if (liked && !wasLiked.current) {
      Animated.sequence([
        Animated.spring(pop, { toValue: 1.35, speed: 40, bounciness: 10, useNativeDriver: true }),
        Animated.spring(pop, { toValue: 1, speed: 24, bounciness: 6, useNativeDriver: true }),
      ]).start();
    }
    wasLiked.current = liked;
  }, [liked, pop]);

  return (
    <PressableScale
      style={s.commentLike}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Animated.View style={[s.commentLikeIconWrap, { transform: [{ scale: pop }] }]}>
        <Ionicons name={liked ? 'heart' : 'heart-outline'} size={18} color={liked ? theme.error : MUTED} />
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

function CommentRow({
  comment,
  postAuthorId,
  onLike,
  onReply,
  onMore,
}: {
  comment: Row;
  postAuthorId: string;
  onLike: (comment: Row) => void;
  onReply: (comment: Row) => void;
  onMore: (comment: Row) => void;
}) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const isCreator = !!postAuthorId && comment.author.userId === postAuthorId;
  /** Optimistic comments carry a tmp_ prefix — show a subtle pending indicator */
  const isPending = comment.id.startsWith('tmp_');

  return (
    <View style={[s.commentRow, comment.isReply && s.commentRowIndented, isPending && s.commentRowPending]}>
      <Avatar uri={comment.author.avatarUrl} initials={comment.author.initials} size={comment.isReply ? 26 : 32} />

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
        >
          <View style={s.commentHeader}>
            <Text style={s.authorName} numberOfLines={1}>{comment.author.name}</Text>
            {isCreator && <Text style={[s.creatorBadge, { color: theme.text }]}>· Creator</Text>}
            {isPending && <View style={s.pendingDot} />}
          </View>

          {comment.isReply && comment.parentAuthorName ? (
            <Text style={s.replyContext}>Replying to {comment.parentAuthorName}</Text>
          ) : null}

          <Text style={[s.commentText, comment.pendingReview && s.commentTextHeld]}>{comment.body}</Text>

          {comment.creatorLiked && !isCreator ? (
            <View style={s.creatorLikedBadge}>
              <Ionicons name="heart" size={9} color={theme.accent} />
              <Text style={[s.creatorLikedText, { color: theme.accent }]}>Creator liked</Text>
            </View>
          ) : null}

          {comment.pendingReview ? (
            <View style={s.reviewPill}>
              <Feather name="eye-off" size={11} color={theme.warning} />
              <Text style={s.reviewPillText}>In review · only you can see this</Text>
            </View>
          ) : null}
        </PressableScale>

        {/* Time / Reply / Like sit on one shared row so they share a single
            baseline, left-aligned under the comment text above. */}
        <View style={s.commentMeta}>
          <Text style={s.commentTime}>{isPending ? 'Posting…' : shortRelativeTime(comment.createdAt)}</Text>
          {!isPending && !comment.pendingReview && (
            <PressableScale style={s.replyBtn} onPress={() => { hapticLight(); onReply(comment); }} accessibilityRole="button">
              <Text style={s.replyLabel}>Reply</Text>
            </PressableScale>
          )}
          {!isPending && (
            <PressableScale
              style={s.moreBtn}
              onPress={() => { hapticLight(); onMore(comment); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`More options for ${comment.author.name}'s comment`}
            >
              <Feather name="more-horizontal" size={16} color={MUTED} />
            </PressableScale>
          )}
          <View style={{ flex: 1 }} />
          {!isPending && !comment.pendingReview && (
            <LikeHeart
              liked={comment.likedByMe}
              count={comment.likesCount}
              onPress={() => onLike(comment)}
              accessibilityLabel={`${comment.likedByMe ? 'Unlike' : 'Like'} comment`}
            />
          )}
        </View>
      </View>
    </View>
  );
}

// ─── View/hide replies toggle ──────────────────────────────────────────────────
// Reply threads start collapsed under their root comment (TikTok/Reels
// pattern) — this row expands or re-collapses them on tap.

function ViewRepliesButton({ count, expanded, onToggle }: { count: number; expanded: boolean; onToggle: () => void }) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  return (
    <PressableScale
      style={s.viewRepliesRow}
      onPress={() => { hapticLight(); onToggle(); }}
      accessibilityRole="button"
      accessibilityLabel={expanded ? 'Hide replies' : `View ${count} ${count === 1 ? 'reply' : 'replies'}`}
    >
      <View style={s.viewRepliesLine} />
      <Text style={s.viewRepliesText}>
        {expanded ? 'Hide replies' : `View ${count} ${count === 1 ? 'reply' : 'replies'}`}
      </Text>
    </PressableScale>
  );
}

// ─── Animated send button ─────────────────────────────────────────────────────
// Tight, crisp: scales down on press, pops on send, morphs the arrow to a
// check for a beat once the comment lands.

function AnimatedSendButton({
  disabled, sending, justSent, onPress, accessibilityLabel, accentColor, onAccentColor,
}: {
  disabled: boolean;
  sending: boolean;
  justSent: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  accentColor: string;
  onAccentColor: string;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!justSent) return;
    Animated.sequence([
      Animated.spring(scale, { toValue: 1.18, speed: 40, bounciness: 10, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, speed: 30, bounciness: 6, useNativeDriver: true }),
    ]).start();
  }, [justSent, scale]);

  return (
    <PressableScale
      style={[csndBtn.root, { backgroundColor: accentColor }, disabled && csndBtn.disabled]}
      onPress={onPress}
      onPressIn={() => Animated.spring(scale, { toValue: 0.86, speed: 50, useNativeDriver: true }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1, speed: 30, bounciness: 6, useNativeDriver: true }).start()}
      disabled={disabled}
      activeOpacity={0.9}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        {sending
          ? <InlineSpinner style={{ paddingVertical: 0 }} />
          : justSent
            ? <Feather name="check" size={17} color={onAccentColor} />
            : <Feather name="arrow-up" size={18} color={onAccentColor} />}
      </Animated.View>
    </PressableScale>
  );
}

const csndBtn = StyleSheet.create({
  root: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.28 },
});

// ─── Comment actions sheet ────────────────────────────────────────────────────

type SheetStep = 'menu' | 'confirm-delete' | 'confirm-block';

function CommentActionsSheet({
  comment,
  onClose,
  onReply,
  onReport,
  onBlock,
  onDelete,
}: {
  comment: Row | null;
  onClose: () => void;
  onReply: (comment: Row) => void;
  onReport: (comment: Row) => void;
  onBlock: (comment: Row) => Promise<void>;
  onDelete: (comment: Row) => Promise<void>;
}) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<SheetStep>('menu');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setStep('menu'); setBusy(false); }, [comment?.id]);

  if (!comment) return null;
  const name = comment.author.name;

  const run = async (action: (c: Row) => Promise<void>) => {
    setBusy(true);
    try { await action(comment); } finally { setBusy(false); }
  };

  const Option = ({ icon, label, destructive, onPress }: {
    icon: keyof typeof Feather.glyphMap; label: string; destructive?: boolean; onPress: () => void;
  }) => (
    <PressableScale
      style={s.sheetOption}
      onPress={() => { hapticLight(); onPress(); }}
      accessibilityRole="button"
      activeOpacity={0.75}
    >
      <Feather name={icon} size={18} color={destructive ? theme.error : theme.text} />
      <Text style={[s.sheetOptionText, destructive && { color: theme.error }]}>{label}</Text>
    </PressableScale>
  );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.sheetScrim} onPress={onClose} accessibilityLabel="Dismiss" />
      <View style={[s.sheetCard, { paddingBottom: Math.max(insets.bottom, SP.md) }]}>
        <View style={s.sheetHandle} />
        <View style={s.sheetPreview}>
          <Avatar uri={comment.author.avatarUrl} initials={comment.author.initials} size={30} />
          <View style={{ flex: 1 }}>
            <Text style={s.sheetPreviewName}>{name}</Text>
            <Text style={s.sheetPreviewText} numberOfLines={2}>{comment.body}</Text>
          </View>
        </View>

        {step === 'menu' ? (
          <View style={s.sheetGroup}>
            {!comment.pendingReview ? (
              <Option icon="corner-up-left" label="Reply" onPress={() => { onClose(); onReply(comment); }} />
            ) : null}
            {!comment.isMine ? (
              <>
                <Option icon="flag" label="Report comment" onPress={() => { onClose(); onReport(comment); }} />
                <Option icon="slash" label={`Block ${name}`} destructive onPress={() => setStep('confirm-block')} />
              </>
            ) : null}
            {comment.canDelete ? (
              <Option icon="trash-2" label="Delete comment" destructive onPress={() => setStep('confirm-delete')} />
            ) : null}
          </View>
        ) : (
          <View style={s.confirmBlock}>
            <Text style={s.confirmTitle}>
              {step === 'confirm-block' ? `Block ${name}?` : 'Delete this comment?'}
            </Text>
            <Text style={s.confirmBody}>
              {step === 'confirm-block'
                ? BLOCK_EXPLAINER
                : comment.isMine
                  ? 'It will be removed for everyone. This can’t be undone.'
                  : 'As the post owner you can remove comments from your post. This can’t be undone.'}
            </Text>
            <PressableScale
              style={[s.confirmPrimary, { backgroundColor: theme.error }, busy && { opacity: 0.6 }]}
              disabled={busy}
              onPress={() => { hapticDestructiveConfirm(); run(step === 'confirm-block' ? onBlock : onDelete); }}
              accessibilityRole="button"
            >
              {busy
                ? <InlineSpinner style={{ paddingVertical: 0 }} />
                : <Text style={s.confirmPrimaryText}>{step === 'confirm-block' ? 'Block' : 'Delete'}</Text>}
            </PressableScale>
            <PressableScale style={s.confirmSecondary} onPress={() => { hapticLight(); setStep('menu'); }} accessibilityRole="button">
              <Text style={s.confirmSecondaryText}>Cancel</Text>
            </PressableScale>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function BuyerPostCommentsScreen() {
  useFailOnNestedButtonWarning();
  const { theme } = useAppTheme();
  const { height: windowHeight } = useWindowDimensions();
  const s = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const { user } = useUser();

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
  const sheetBaseHeight = windowHeight * 0.65;
  const sheetMaxHeight = windowHeight * 0.92;
  const sheetHeight = Math.min(sheetBaseHeight + keyboardHeight, sheetMaxHeight);

  // Drag-to-dismiss: the sheet follows the finger via `dragY` and springs
  // back to 0 (no overshoot — matches the app's low-bounce spring standard
  // used elsewhere, e.g. the feed's shop tab) when released above the
  // dismiss threshold, or all the way closed (navigating back) once past it.
  const dragY = useRef(new Animated.Value(0)).current;
  const DISMISS_THRESHOLD = 120;
  const dragResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) => gesture.dy > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_evt, gesture) => {
        if (gesture.dy > 0) dragY.setValue(gesture.dy);
      },
      onPanResponderRelease: (_evt, gesture) => {
        if (gesture.dy > DISMISS_THRESHOLD || gesture.vy > 1.2) {
          Animated.timing(dragY, { toValue: windowHeight, duration: 180, useNativeDriver: true }).start(() => router.back());
        } else {
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 0 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(dragY, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 0 }).start();
      },
    }),
  ).current;
  const params = useLocalSearchParams<{
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
  }>();

  const postId = params.postId ?? '';
  const isPreviewPost = postId.length > 0 && !UUID_RE.test(postId);
  const postAuthorId = params.postAuthorId ?? '';
  const mediaUri = params.postMediaUri ?? '';
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

  const myName = user?.fullName || user?.firstName || user?.username || 'You';
  const myInitials = myName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'Y';
  const myAvatar = user?.hasImage ? user.imageUrl : null;

  const [comments, setComments] = useState<Row[]>([]);
  /** Root comment ids whose reply thread is expanded (collapsed by default). */
  const [expandedRoots, setExpandedRoots] = useState<Set<string>>(new Set());
  const [meta, setMeta] = useState({ hiddenByMutedWords: 0, commentsDisabled: false, canComment: true, nextCursor: null as string | null });
  const [inputText, setInputText] = useState('');
  const [replyingTo, setReplyingTo] = useState<Row | null>(null);
  const [sending, setSending] = useState(false);
  const [justSent, setJustSent] = useState(false);
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

  const listRef = useRef<FlatList>(null);
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
      const seeded = cached ?? flatten(buildPreviewComments(postId, params.postAuthorName || 'the creator'));
      if (!cached) previewCommentsCache.set(postId, seeded);
      setComments(seeded);
      setMeta({ hiddenByMutedWords: 0, commentsDisabled: false, canComment: true, nextCursor: null });
      setFetchError(null);
      hasLoadedOnce.current = true;
      setLoading(false);
      return;
    }
    // Only show skeleton on the very first load; subsequent fetches are silent
    if (!hasLoadedOnce.current) setLoading(true);
    setFetchError(null);
    try {
      const thread = await api.comments.list(postId);
      setComments(flatten(thread.comments));
      setMeta({
        hiddenByMutedWords: thread.hiddenByMutedWords,
        commentsDisabled: thread.commentsDisabled,
        canComment: thread.canComment,
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
  }, [api, postId, params.postAuthorName]);

  useEffect(() => { load(); }, [load]);

  const loadMore = useCallback(async () => {
    if (!meta.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const thread = await api.comments.list(postId, meta.nextCursor);
      setComments((prev) => [...prev, ...flatten(thread.comments)]);
      setMeta((prev) => ({ ...prev, nextCursor: thread.nextCursor }));
    } catch {
      // The footer keeps its "Load more" affordance for a manual retry.
    } finally {
      setLoadingMore(false);
    }
  }, [api, loadingMore, meta.nextCursor, postId]);

  const postComment = useCallback(
    (text: string, parentId?: string | null) => api.comments.create(postId, text, parentId),
    [api, postId],
  );

  const handleLike = async (comment: Row) => {
    const liked = !comment.likedByMe;
    hapticSelection();
    // Optimistic update
    setCommentsSynced(prev => prev.map(c => c.id === comment.id
      ? { ...c, likedByMe: liked, likesCount: Math.max(0, c.likesCount + (liked ? 1 : -1)) }
      : c));
    if (isPreviewPost) return; // Local-only — nothing to confirm against a server.
    try {
      const result = await api.comments.like(postId, comment.id, liked);
      setCommentsSynced(prev => prev.map(c => c.id === comment.id ? { ...c, likedByMe: result.liked, likesCount: result.likesCount } : c));
    } catch {
      setCommentsSynced(prev => prev.map(c => c.id === comment.id ? { ...c, likedByMe: comment.likedByMe, likesCount: comment.likesCount } : c));
    }
  };

  const handleReply = (comment: Row) => {
    setReplyingTo(comment);
    inputRef.current?.focus();
  };

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
      hapticSuccess();
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

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || sending) return;
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

    if (isPreviewPost) {
      // Local-only: no server round trip, the optimistic comment IS the
      // final comment — just drop its tmp_ id so it isn't mistaken for
      // still-in-flight, and bump the rail's count immediately.
      const finalized: Row = { ...optimistic, id: `preview-comment-${postId}-posted-${Date.now()}` };
      setCommentsSynced(prev => prev.map(c => (c.id === optimistic.id ? finalized : c)));
      bumpCommentCount(postId, 1);
      hapticSuccess();
      setJustSent(true);
      setTimeout(() => setJustSent(false), 900);
      setSending(false);
      return;
    }

    try {
      const created = await postComment(text, parent ? (parent.parentId ?? parent.id) : null);
      if (created.moderation.status === 'held') {
        setHeldNotice(created.moderation.message ?? 'Your comment is in review. Only you can see it for now.');
      }
      // Successful post: remove the optimistic item and reload to get the
      // authoritative comment from the server with the real ID and count.
      setCommentsSynced(prev => prev.filter(c => c.id !== optimistic.id));
      await load();
      bumpCommentCount(postId, 1);
      hapticSuccess();
      setJustSent(true);
      setTimeout(() => setJustSent(false), 900);
    } catch (error) {
      // Remove optimistic item, keep the draft for editing, show inline error
      setCommentsSynced(prev => prev.filter(c => c.id !== optimistic.id));
      setInputText(text);
      setReplyingTo(parent);
      const code = apiErrorCode(error);
      setSendError(
        code === 'CONTENT_REJECTED' || code === 'ACCOUNT_SUSPENDED' || code === 'BLOCKED' || code === 'COMMENTS_DISABLED'
          ? apiErrorMessage(error, 'This comment can’t be posted.')
          : 'Could not post comment. Tap to retry.',
      );
      hapticError();
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
    let i = 0;
    while (i < comments.length) {
      const row = comments[i];
      if (row.isReply) { i += 1; continue; } // orphaned reply — shouldn't happen, skip defensively
      out.push(row);
      let j = i + 1;
      const replies: Row[] = [];
      while (j < comments.length && comments[j].isReply && comments[j].parentId === row.id) {
        replies.push(comments[j]);
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
  }, [comments, expandedRoots]);

  const toggleReplies = useCallback((rootId: string) => {
    setExpandedRoots(prev => {
      const next = new Set(prev);
      if (next.has(rootId)) next.delete(rootId); else next.add(rootId);
      return next;
    });
  }, []);

  const composerLocked = meta.commentsDisabled || !meta.canComment;

  return (
    <View style={s.overlay}>
      {/* The video plays at its exact normal size/position, completely
          untouched — no scale, no translate, no crop, no dim scrim. Real
          TikTok: the sheet simply slides up and covers the lower portion of
          the video from the bottom; the video itself never changes.
          contentFit="contain" (not "cover") guarantees this screen's own
          backdrop copy of the clip can never appear more cropped/zoomed
          than however the feed itself was already framing it. */}
      {mediaUri ? (
        postType === 'video' ? (
          <>
            {posterUri && (!videoPlaying || videoErrored) ? (
              <CachedImage
                source={{ uri: posterUri }}
                style={s.mediaBackdrop}
                contentFit="contain"
                testID="comments-video-poster"
              />
            ) : null}
            {!videoErrored && (
              <VideoView
                player={mediaPlayer}
                style={[s.mediaBackdrop, posterUri && !videoPlaying && { opacity: 0 }]}
                contentFit="contain"
                nativeControls={false}
                testID="comments-video-preview"
              />
            )}
          </>
        ) : (
          <CachedImage source={{ uri: mediaUri }} style={s.mediaBackdrop} contentFit="contain" />
        )
      ) : null}
      <PressableScale
        style={s.backdrop}
        activeOpacity={1}
        onPress={() => { hapticLight(); router.back(); }}
        accessibilityRole="button"
        accessibilityLabel="Close comments"
      />
      <Animated.View style={[s.sheet, { height: sheetHeight, transform: [{ translateY: dragY }] }]}>
        <KeyboardAvoidingView
          style={s.sheetInner}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
          testID="comments-sheet"
        >
          {/* Drag-to-dismiss handle — dragging down from here (not from the
              comment list, so it never fights list scrolling) springs the
              sheet back if released early, or slides it fully closed. */}
          <View style={s.dragHandleArea} {...dragResponder.panHandlers}>
            <View style={s.dragHandle} />
          </View>
          <View style={s.header}>
            <View style={s.headerSide} />
            <Text style={s.headerTitle}>
              {loading ? 'Comments' : `${realCount} comment${realCount === 1 ? '' : 's'}`}
            </Text>
            <PressableScale
              style={s.headerSide}
              onPress={() => { hapticLight(); router.back(); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Close comments"
            >
              <Feather name="x" size={22} color={FG} />
            </PressableScale>
          </View>

          <FlatList
            ref={listRef}
            data={loading ? [] : visibleRows}
            keyExtractor={row => (isViewRepliesRow(row) ? `view-replies-${row.rootId}` : row.id)}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.listContent}
          ListHeaderComponent={() => (
            <>
              {loading && [0, 1, 2, 3].map(i => <CommentSkeletonRow key={i} />)}
              {!loading && fetchError ? <InlineError message={fetchError} onRetry={load} /> : null}
            </>
          )}
          renderItem={({ item }) => (
            isViewRepliesRow(item) ? (
              <ViewRepliesButton count={item.count} expanded={item.expanded} onToggle={() => toggleReplies(item.rootId)} />
            ) : (
              <CommentRow
                comment={item}
                postAuthorId={postAuthorId}
                onLike={handleLike}
                onReply={handleReply}
                onMore={setActionsFor}
              />
            )
          )}
          ListEmptyComponent={
            !loading && !fetchError
              ? (
                <EmptyState
                  icon="message-circle"
                  title={meta.commentsDisabled ? 'Comments are off' : 'Start the conversation'}
                  description={meta.commentsDisabled ? 'The creator turned off comments for this post.' : 'Be the first to comment.'}
                  compact
                />
              )
              : null
          }
          ListFooterComponent={!loading ? (
            <View style={s.listFooter}>
              {meta.nextCursor ? (
                <PressableScale style={s.loadMore} onPress={() => { hapticLight(); loadMore(); }} disabled={loadingMore} accessibilityRole="button">
                  {loadingMore ? <InlineSpinner style={{ paddingVertical: 0 }} /> : <Text style={s.loadMoreText}>View older comments</Text>}
                </PressableScale>
              ) : null}
              {meta.hiddenByMutedWords > 0 ? (
                <PressableScale style={s.mutedNote} onPress={() => { hapticLight(); router.push('/muted-words' as never); }} accessibilityRole="button">
                  <Feather name="volume-x" size={12} color={SUBTLE} />
                  <Text style={s.mutedNoteText}>
                    {meta.hiddenByMutedWords} hidden by your muted words · <Text style={{ textDecorationLine: 'underline' }}>Manage</Text>
                  </Text>
                </PressableScale>
              ) : null}
            </View>
          ) : null}
        />

        {toast ? (
          <View style={s.toast} pointerEvents="none" accessibilityLiveRegion="polite">
            <Feather name="check" size={14} color={theme.onAccent} />
            <Text style={s.toastText}>{toast}</Text>
          </View>
        ) : null}

        <View style={[s.inputWrap, { paddingBottom: Math.max(insets.bottom, SP.sm) }]}>
          {sendError ? (
            <PressableScale style={s.sendErrorBanner} onPress={() => { hapticLight(); setSendError(null); }} accessibilityRole="alert">
              <Feather name="alert-circle" size={12} color={theme.error} />
              <Text style={s.sendErrorText} numberOfLines={3}>{sendError}</Text>
              <Feather name="x" size={12} color={theme.error} />
            </PressableScale>
          ) : null}
          {heldNotice ? (
            <PressableScale style={s.heldBanner} onPress={() => { hapticLight(); setHeldNotice(null); }} accessibilityRole="alert">
              <Feather name="eye-off" size={12} color={theme.warning} />
              <Text style={s.heldBannerText} numberOfLines={2}>{heldNotice}</Text>
              <Feather name="x" size={12} color={MUTED} />
            </PressableScale>
          ) : null}
          {replyingTo ? (
            <View style={s.replyingBanner}>
              <Text style={s.replyingLabel} numberOfLines={1}>
                Replying to <Text style={[s.replyingName, { color: theme.text }]}>{replyingTo.author.name}</Text>
              </Text>
              <PressableScale
                onPress={() => { hapticLight(); handleCancelReply(); }}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                accessibilityRole="button"
                accessibilityLabel="Cancel reply"
              >
                <Feather name="x" size={14} color={MUTED} />
              </PressableScale>
            </View>
          ) : null}

          {composerLocked ? (
            <View style={s.lockedComposer}>
              {isPreviewPost ? (
                <Text style={s.lockedText}>Comments aren’t available on preview posts.</Text>
              ) : meta.commentsDisabled ? (
                <Text style={s.lockedText}>Comments are turned off for this post.</Text>
              ) : (
                <PressableScale onPress={() => { hapticLight(); router.push('/sign-in' as never); }} accessibilityRole="button">
                  <Text style={s.lockedText}>
                    <Text style={{ color: theme.text, fontFamily: FONT.semibold }}>Sign in</Text> to join the conversation.
                  </Text>
                </PressableScale>
              )}
            </View>
          ) : (
            <>
              <View style={s.emojiRow}>
                {QUICK_EMOJI.map(emoji => (
                  <PressableScale
                    key={emoji}
                    style={s.emojiBtn}
                    onPress={() => {
                      hapticLight();
                      setInputText(value => `${value}${emoji}`);
                      inputRef.current?.focus();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${emoji}`}
                  >
                    <AppleEmoji emoji={emoji} size={20} />
                  </PressableScale>
                ))}
              </View>
              {/* TikTok's composer: a slim pill (avatar left, @ + emoji tools
                  inside the pill on the right), growing up to ~4 lines as you
                  type — never the old full-width boxy text field. The send
                  arrow only exists once there's something to send. */}
              <View style={s.inputRow}>
                <Avatar uri={myAvatar} initials={myInitials} size={36} />
                <View style={s.inputShell}>
                  <TextInput
                    ref={inputRef}
                    style={s.input}
                    value={inputText}
                    onChangeText={setInputText}
                    placeholder={replyingTo ? `Reply to ${replyingTo.author.name}…` : 'Add comment…'}
                    placeholderTextColor={MUTED}
                    multiline
                    maxLength={MAX_COMMENT_LENGTH}
                    returnKeyType="default"
                    accessibilityLabel="Comment"
                  />
                  <PressableScale
                    style={s.inputTool}
                    onPress={() => { hapticLight(); inputRef.current?.focus(); }}
                    accessibilityRole="button"
                    accessibilityLabel="Emoji"
                  >
                    <Feather name="smile" size={17} color={MUTED} />
                  </PressableScale>
                  <PressableScale
                    style={s.inputTool}
                    onPress={() => {
                      hapticLight();
                      setInputText(value => value.endsWith(' ') || !value ? `${value}@` : `${value} @`);
                      inputRef.current?.focus();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Mention someone"
                  >
                    <Text style={s.mentionIcon}>@</Text>
                  </PressableScale>
                </View>
                {inputText.trim().length > 0 || sending || justSent ? (
                  <AnimatedSendButton
                    disabled={!inputText.trim() || sending}
                    sending={sending}
                    justSent={justSent}
                    onPress={handleSend}
                    accessibilityLabel={sending ? 'Posting comment' : 'Send comment'}
                    accentColor={theme.accent}
                    onAccentColor={theme.onAccent}
                  />
                ) : null}
              </View>
            </>
          )}
        </View>
        </KeyboardAvoidingView>
      </Animated.View>

      <CommentActionsSheet
        comment={actionsFor}
        onClose={() => setActionsFor(null)}
        onReply={handleReply}
        onReport={handleReport}
        onBlock={handleBlock}
        onDelete={handleDelete}
      />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  // Full-size, in its normal position, completely untouched — no scale, no
  // translate, no crop, and (per the owner's explicit correction) no dim
  // scrim either. The sheet simply slides up and covers the lower portion
  // of the video from the bottom; the video underneath never changes.
  mediaBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#000' },
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
    height: 52, paddingHorizontal: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  headerSide: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: FONT.bold, fontSize: FS.sm, color: FG },

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
  commentRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: SP.md, paddingVertical: 10,
  },
  commentRowIndented: { paddingLeft: SP.md + 48 },
  commentRowPending: { opacity: 0.6 },
  commentBody: { flex: 1, minWidth: 0 },
  commentHeader: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, marginBottom: 3 },
  authorName: { fontFamily: FONT.medium, fontSize: 13, color: MUTED, flexShrink: 1 },
  creatorBadge: { fontFamily: FONT.semibold, fontSize: 13 },
  replyContext: { fontFamily: FONT.regular, fontSize: FS.xs, color: SUBTLE, marginBottom: 2 },
  commentTime: { fontFamily: FONT.regular, fontSize: 12, color: SUBTLE },
  pendingDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: SUBTLE, marginLeft: 2 },
  commentText: { fontFamily: FONT.medium, fontSize: 14, color: FG, lineHeight: 19 },
  commentTextHeld: { color: MUTED },
  reviewPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    marginTop: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: theme.warning + '55', backgroundColor: theme.warning + '14',
  },
  reviewPillText: { color: theme.warning, fontFamily: FONT.medium, fontSize: 11 },
  creatorLikedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  creatorLikedText: { fontFamily: FONT.semibold, fontSize: 11 },
  commentContentPress: { alignItems: 'flex-start' },
  commentMeta: { flexDirection: 'row', alignItems: 'center', gap: SP.md, marginTop: 5 },
  replyBtn: { paddingVertical: 2, paddingRight: SP.xs },
  moreBtn: { paddingVertical: 2, paddingHorizontal: 2 },
  // No overflow:hidden anywhere in this chain, and the icon wrap is taller
  // than the glyph itself, so the like-pop spring (which briefly scales past
  // 1.0) always has headroom instead of getting its top clipped.
  commentLike: { minHeight: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  commentLikeIconWrap: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontFamily: FONT.regular, fontSize: 12, color: MUTED, textAlign: 'center' },
  replyLabel: { fontFamily: FONT.medium, fontSize: 12, color: MUTED },
  viewRepliesRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingLeft: SP.md + 48, paddingVertical: 8, minHeight: 32,
  },
  viewRepliesLine: { width: 24, height: 1, backgroundColor: BORDER },
  viewRepliesText: { fontFamily: FONT.semibold, fontSize: FS.xs, color: MUTED },

  toast: {
    position: 'absolute', alignSelf: 'center', bottom: 150,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: theme.accent, borderRadius: RADIUS.pill, paddingHorizontal: 14, paddingVertical: 8,
  },
  toastText: { color: theme.onAccent, fontFamily: FONT.semibold, fontSize: FS.xs },

  // Input
  inputWrap: {
    borderTopWidth: 1, borderTopColor: BORDER, backgroundColor: CARD,
    paddingTop: 6, paddingHorizontal: 12,
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
  lockedText: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center' },
  emojiRow: { flexDirection: 'row', gap: 6, paddingBottom: 8 },
  emojiBtn: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    backgroundColor: CARD_ELEVATED,
  },
  emojiText: { fontSize: 17 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingBottom: 6 },
  // TikTok's composer pill: single-line height 36-40, radius 20, a subtle
  // dark fill and no heavy border — never the old boxy full-height field.
  inputShell: {
    flex: 1, minHeight: 38, maxHeight: 94, flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1f1f1f', borderRadius: 20, paddingLeft: 14, paddingRight: 4,
  },
  input: {
    flex: 1, paddingHorizontal: 0, paddingVertical: 9, fontFamily: FONT.regular,
    fontSize: 15, color: FG, maxHeight: 86, minHeight: 20,
  },
  inputTool: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  mentionIcon: { color: MUTED, fontFamily: FONT.bold, fontSize: 19, lineHeight: 21 },

  // Actions sheet
  sheetScrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.55)' }, // theme-exempt: matches components/ui/BottomSheet.tsx's backdrop
  sheetCard: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: theme.card, borderTopLeftRadius: RADII.sheet, borderTopRightRadius: RADII.sheet,
    borderWidth: 1, borderBottomWidth: 0, borderColor: theme.border, paddingHorizontal: SP.md,
  },
  sheetHandle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border, marginTop: SP.sm, marginBottom: SP.md },
  sheetPreview: {
    flexDirection: 'row', gap: SP.sm, alignItems: 'flex-start',
    paddingBottom: SP.md, borderBottomWidth: 1, borderBottomColor: theme.borderSubtle,
  },
  sheetPreviewName: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm },
  sheetPreviewText: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, marginTop: 2 },
  sheetGroup: { paddingVertical: SP.xs },
  sheetOption: { flexDirection: 'row', alignItems: 'center', gap: SP.md, minHeight: 52 },
  sheetOptionText: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.base },
  confirmBlock: { paddingTop: SP.md, paddingBottom: SP.xs },
  confirmTitle: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.lg },
  confirmBody: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20, marginTop: 6 },
  confirmPrimary: { marginTop: SP.lg, height: 50, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  confirmPrimaryText: { color: '#1A0A0A', fontFamily: FONT.bold, fontSize: FS.base },
  confirmSecondary: { height: 48, alignItems: 'center', justifyContent: 'center' },
  confirmSecondaryText: { color: theme.muted, fontFamily: FONT.semibold, fontSize: FS.base },
});
