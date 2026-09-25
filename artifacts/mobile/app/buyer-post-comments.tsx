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
  View, Text, FlatList, TouchableOpacity, TextInput, Modal, Pressable,
  KeyboardAvoidingView, Platform, StyleSheet, Animated,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useUser } from '@clerk/expo';
import * as Haptics from 'expo-haptics';
import {
  SURFACE, CARD, CARD_ELEVATED, BORDER,
  FG, MUTED, SUBTLE, RED,
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { InlineSpinner, InlineError } from '@/components/InlineFeedback';
import { EmptyState } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { useApi } from '@/lib/api';
import { apiErrorCode, apiErrorMessage, reportHref, shortRelativeTime, BLOCK_EXPLAINER } from '@/lib/safety';
import type { ThreadComment } from '@/lib/safetyTypes';

const MAX_COMMENT_LENGTH = 1000;

/**
 * Matches the server's UUID check in post-comments.ts. Preview/demo posts
 * (e.g. "preview-fashion-01") and any other non-UUID id would always 404 —
 * that's not a deleted post, so we short-circuit before the network call
 * instead of showing the scary "no longer available" error for them.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A flattened list row: roots followed by their replies. */
type Row = ThreadComment & { isReply: boolean; parentAuthorName?: string };

function flatten(roots: ThreadComment[]): Row[] {
  return roots.flatMap((root) => [
    { ...root, isReply: false },
    ...root.replies.map((reply) => ({ ...reply, isReply: true, parentAuthorName: root.author.name })),
  ]);
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

// ─── Comment Row ──────────────────────────────────────────────────────────────

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
    <TouchableOpacity
      style={[s.commentRow, comment.isReply && s.commentRowIndented, isPending && s.commentRowPending]}
      activeOpacity={0.8}
      onLongPress={() => { if (!isPending) onMore(comment); }}
      delayLongPress={400}
      accessibilityActions={[{ name: 'longpress', label: 'Comment options' }]}
      onAccessibilityAction={() => { if (!isPending) onMore(comment); }}
    >
      <Avatar uri={comment.author.avatarUrl} initials={comment.author.initials} size={comment.isReply ? 30 : 38} />

      <View style={s.commentBody}>
        <View style={s.commentHeader}>
          <Text style={s.authorName} numberOfLines={1}>{comment.author.name}</Text>
          {isCreator && <Text style={[s.creatorBadge, { color: theme.text }]}>· Creator</Text>}
          {isPending && <View style={s.pendingDot} />}
        </View>

        {comment.isReply && comment.parentAuthorName ? (
          <Text style={s.replyContext}>Replying to {comment.parentAuthorName}</Text>
        ) : null}

        <Text style={[s.commentText, comment.pendingReview && s.commentTextHeld]}>{comment.body}</Text>

        {comment.pendingReview ? (
          <View style={s.reviewPill}>
            <Feather name="eye-off" size={11} color={theme.warning} />
            <Text style={s.reviewPillText}>In review · only you can see this</Text>
          </View>
        ) : null}

        <View style={s.commentMeta}>
          <Text style={s.commentTime}>{isPending ? 'Posting…' : shortRelativeTime(comment.createdAt)}</Text>
          {!isPending && !comment.pendingReview && (
            <TouchableOpacity style={s.replyBtn} onPress={() => onReply(comment)} accessibilityRole="button">
              <Text style={s.replyLabel}>Reply</Text>
            </TouchableOpacity>
          )}
          {!isPending && (
            <TouchableOpacity
              style={s.moreBtn}
              onPress={() => onMore(comment)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`More options for ${comment.author.name}'s comment`}
            >
              <Feather name="more-horizontal" size={16} color={MUTED} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {!isPending && !comment.pendingReview && (
        <TouchableOpacity
          style={s.commentLike}
          onPress={() => onLike(comment)}
          accessibilityRole="button"
          accessibilityLabel={`${comment.likedByMe ? 'Unlike' : 'Like'} comment`}
        >
          <Feather name="heart" size={19} color={comment.likedByMe ? RED : MUTED} />
          {comment.likesCount > 0 && (
            <Text style={[s.actionLabel, comment.likedByMe && { color: RED }]}>
              {comment.likesCount}
            </Text>
          )}
        </TouchableOpacity>
      )}
    </TouchableOpacity>
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
    <TouchableOpacity
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
    </TouchableOpacity>
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
    <TouchableOpacity style={s.sheetOption} onPress={onPress} accessibilityRole="button" activeOpacity={0.75}>
      <Feather name={icon} size={18} color={destructive ? theme.error : theme.text} />
      <Text style={[s.sheetOptionText, destructive && { color: theme.error }]}>{label}</Text>
    </TouchableOpacity>
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
            <TouchableOpacity
              style={[s.confirmPrimary, { backgroundColor: theme.error }, busy && { opacity: 0.6 }]}
              disabled={busy}
              onPress={() => run(step === 'confirm-block' ? onBlock : onDelete)}
              accessibilityRole="button"
            >
              {busy
                ? <InlineSpinner style={{ paddingVertical: 0 }} />
                : <Text style={s.confirmPrimaryText}>{step === 'confirm-block' ? 'Block' : 'Delete'}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={s.confirmSecondary} onPress={() => setStep('menu')} accessibilityRole="button">
              <Text style={s.confirmSecondaryText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function BuyerPostCommentsScreen() {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const { user } = useUser();
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
    return () => subscription.remove();
  }, [mediaPlayer]);

  useFocusEffect(useCallback(() => {
    if (mediaUri && postType === 'video') mediaPlayer.play();
    return () => mediaPlayer.pause();
  }, [mediaPlayer, mediaUri, postType]));

  const myName = user?.fullName || user?.firstName || user?.username || 'You';
  const myInitials = myName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'Y';
  const myAvatar = user?.hasImage ? user.imageUrl : null;

  const [comments, setComments] = useState<Row[]>([]);
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

  const load = useCallback(async () => {
    if (!postId) { setLoading(false); return; }
    if (!UUID_RE.test(postId)) {
      // Preview/demo content has no server-side post to fetch comments for.
      // This is not a deletion, so it never shows the "no longer available"
      // error — just a quiet, non-alarming empty state with a locked composer.
      setComments([]);
      setMeta({ hiddenByMutedWords: 0, commentsDisabled: true, canComment: false, nextCursor: null });
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
  }, [api, postId]);

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
    Haptics.selectionAsync();
    // Optimistic update
    setComments(prev => prev.map(c => c.id === comment.id
      ? { ...c, likedByMe: liked, likesCount: Math.max(0, c.likesCount + (liked ? 1 : -1)) }
      : c));
    try {
      const result = await api.comments.like(postId, comment.id, liked);
      setComments(prev => prev.map(c => c.id === comment.id ? { ...c, likedByMe: result.liked, likesCount: result.likesCount } : c));
    } catch {
      setComments(prev => prev.map(c => c.id === comment.id ? { ...c, likedByMe: comment.likedByMe, likesCount: comment.likesCount } : c));
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(`${comment.author.name} is blocked`);
      await load();
    } catch (error) {
      setActionsFor(null);
      setSendError(apiErrorMessage(error, 'Could not block this account. Try again.'));
    }
  };

  const handleDelete = async (comment: Row) => {
    try {
      await api.comments.remove(postId, comment.id);
      setActionsFor(null);
      setComments(prev => prev.filter(c => c.id !== comment.id && c.parentId !== comment.id));
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
    setComments(prev => {
      if (!parent) return [optimistic, ...prev];
      const index = prev.findIndex(c => c.id === (parent.parentId ?? parent.id));
      const next = [...prev];
      next.splice(index + 1, 0, optimistic);
      return next;
    });
    setInputText('');
    setReplyingTo(null);

    try {
      const created = await postComment(text, parent ? (parent.parentId ?? parent.id) : null);
      if (created.moderation.status === 'held') {
        setHeldNotice(created.moderation.message ?? 'Your comment is in review. Only you can see it for now.');
      }
      // Successful post: remove the optimistic item and reload to get the
      // authoritative comment from the server with the real ID and count.
      setComments(prev => prev.filter(c => c.id !== optimistic.id));
      await load();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setJustSent(true);
      setTimeout(() => setJustSent(false), 900);
    } catch (error) {
      // Remove optimistic item, keep the draft for editing, show inline error
      setComments(prev => prev.filter(c => c.id !== optimistic.id));
      setInputText(text);
      setReplyingTo(parent);
      const code = apiErrorCode(error);
      setSendError(
        code === 'CONTENT_REJECTED' || code === 'ACCOUNT_SUSPENDED' || code === 'BLOCKED' || code === 'COMMENTS_DISABLED'
          ? apiErrorMessage(error, 'This comment can’t be posted.')
          : 'Could not post comment. Tap to retry.',
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSending(false);
    }
  };

  /** Real comment count (excludes temp optimistic items and held comments) */
  const realCount = useMemo(
    () => comments.filter(c => !c.id.startsWith('tmp_') && !c.pendingReview).length,
    [comments],
  );

  const composerLocked = meta.commentsDisabled || !meta.canComment;

  return (
    <View style={s.overlay}>
      {mediaUri ? (
        postType === 'video' ? (
          <>
            {posterUri && !videoPlaying ? (
              <CachedImage
                source={{ uri: posterUri }}
                style={s.mediaBackdrop}
                contentFit="cover"
                testID="comments-video-poster"
              />
            ) : null}
            <VideoView
              player={mediaPlayer}
              style={[s.mediaBackdrop, posterUri && !videoPlaying && { opacity: 0 }]}
              contentFit="cover"
              nativeControls={false}
              testID="comments-video-preview"
            />
          </>
        ) : (
          <CachedImage source={{ uri: mediaUri }} style={s.mediaBackdrop} contentFit="cover" />
        )
      ) : null}
      <View style={s.mediaScrim} pointerEvents="none" />
      <TouchableOpacity
        style={s.backdrop}
        activeOpacity={1}
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Close comments"
      />
      <KeyboardAvoidingView
        style={s.sheet}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
        testID="comments-sheet"
      >
        <View style={s.header}>
          <View style={s.headerSide} />
          <Text style={s.headerTitle}>
            {loading ? 'Comments' : `${realCount} comment${realCount === 1 ? '' : 's'}`}
          </Text>
          <TouchableOpacity
            style={s.headerSide}
            onPress={() => router.back()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Close comments"
          >
            <Feather name="x" size={22} color={FG} />
          </TouchableOpacity>
        </View>

        <FlatList
          ref={listRef}
          data={loading ? [] : comments}
          keyExtractor={comment => comment.id}
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
            <CommentRow
              comment={item}
              postAuthorId={postAuthorId}
              onLike={handleLike}
              onReply={handleReply}
              onMore={setActionsFor}
            />
          )}
          ListEmptyComponent={
            !loading && !fetchError
              ? (
                <EmptyState
                  icon="message-circle"
                  title={isPreviewPost ? 'Preview content' : meta.commentsDisabled ? 'Comments are off' : 'Start the conversation'}
                  description={isPreviewPost
                    ? 'Comments aren’t available on preview posts.'
                    : meta.commentsDisabled ? 'The creator turned off comments for this post.' : 'Be the first to comment.'}
                  compact
                />
              )
              : null
          }
          ListFooterComponent={!loading ? (
            <View style={s.listFooter}>
              {meta.nextCursor ? (
                <TouchableOpacity style={s.loadMore} onPress={loadMore} disabled={loadingMore} accessibilityRole="button">
                  {loadingMore ? <InlineSpinner style={{ paddingVertical: 0 }} /> : <Text style={s.loadMoreText}>View older comments</Text>}
                </TouchableOpacity>
              ) : null}
              {meta.hiddenByMutedWords > 0 ? (
                <TouchableOpacity style={s.mutedNote} onPress={() => router.push('/muted-words' as never)} accessibilityRole="button">
                  <Feather name="volume-x" size={12} color={SUBTLE} />
                  <Text style={s.mutedNoteText}>
                    {meta.hiddenByMutedWords} hidden by your muted words · <Text style={{ textDecorationLine: 'underline' }}>Manage</Text>
                  </Text>
                </TouchableOpacity>
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
            <TouchableOpacity style={s.sendErrorBanner} onPress={() => setSendError(null)} accessibilityRole="alert">
              <Feather name="alert-circle" size={12} color={RED} />
              <Text style={s.sendErrorText} numberOfLines={3}>{sendError}</Text>
              <Feather name="x" size={12} color={RED} />
            </TouchableOpacity>
          ) : null}
          {heldNotice ? (
            <TouchableOpacity style={s.heldBanner} onPress={() => setHeldNotice(null)} accessibilityRole="alert">
              <Feather name="eye-off" size={12} color={theme.warning} />
              <Text style={s.heldBannerText} numberOfLines={2}>{heldNotice}</Text>
              <Feather name="x" size={12} color={MUTED} />
            </TouchableOpacity>
          ) : null}
          {replyingTo ? (
            <View style={s.replyingBanner}>
              <Text style={s.replyingLabel} numberOfLines={1}>
                Replying to <Text style={[s.replyingName, { color: theme.text }]}>{replyingTo.author.name}</Text>
              </Text>
              <TouchableOpacity onPress={handleCancelReply} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Feather name="x" size={14} color={MUTED} />
              </TouchableOpacity>
            </View>
          ) : null}

          {composerLocked ? (
            <View style={s.lockedComposer}>
              {isPreviewPost ? (
                <Text style={s.lockedText}>Comments aren’t available on preview posts.</Text>
              ) : meta.commentsDisabled ? (
                <Text style={s.lockedText}>Comments are turned off for this post.</Text>
              ) : (
                <TouchableOpacity onPress={() => router.push('/sign-in' as never)} accessibilityRole="button">
                  <Text style={s.lockedText}>
                    <Text style={{ color: theme.text, fontFamily: FONT.semibold }}>Sign in</Text> to join the conversation.
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <>
              <View style={s.inputRow}>
                <Avatar uri={myAvatar} initials={myInitials} />
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
                  <TouchableOpacity
                    style={s.inputTool}
                    onPress={() => {
                      setInputText(value => value.endsWith(' ') || !value ? `${value}@` : `${value} @`);
                      inputRef.current?.focus();
                    }}
                    accessibilityLabel="Mention someone"
                  >
                    <Text style={s.mentionIcon}>@</Text>
                  </TouchableOpacity>
                </View>
                <AnimatedSendButton
                  disabled={!inputText.trim() || sending}
                  sending={sending}
                  justSent={justSent}
                  onPress={handleSend}
                  accessibilityLabel={sending ? 'Posting comment' : 'Send comment'}
                  accentColor={theme.accent}
                  onAccentColor={theme.onAccent}
                />
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>

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
  // Full-size, in its normal position — the sheet slides over it, it never
  // shrinks or relocates into a corner.
  mediaBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  mediaScrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    height: '58%',
    overflow: 'hidden',
    backgroundColor: CARD,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: BORDER,
  },

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
  commentTime: { fontFamily: FONT.regular, fontSize: FS.xs, color: SUBTLE },
  pendingDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: SUBTLE, marginLeft: 2 },
  commentText: { fontFamily: FONT.medium, fontSize: 14, color: FG, lineHeight: 19 },
  commentTextHeld: { color: MUTED },
  reviewPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    marginTop: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: theme.warning + '55', backgroundColor: theme.warning + '14',
  },
  reviewPillText: { color: theme.warning, fontFamily: FONT.medium, fontSize: 11 },
  commentMeta: { flexDirection: 'row', alignItems: 'center', gap: SP.md, marginTop: 5 },
  replyBtn: { paddingVertical: 2, paddingRight: SP.xs },
  moreBtn: { paddingVertical: 2, paddingHorizontal: 2 },
  commentLike: { width: 38, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 2 },
  actionLabel: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, textAlign: 'center' },
  replyLabel: { fontFamily: FONT.medium, fontSize: FS.xs, color: MUTED },

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
    backgroundColor: 'rgba(248,113,113,0.1)', borderRadius: RADIUS.sm,
    paddingHorizontal: SP.sm, paddingVertical: 6, marginBottom: SP.xs,
  },
  sendErrorText: { flex: 1, fontFamily: FONT.regular, fontSize: FS.xs, color: RED, lineHeight: 16 },
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
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 6 },
  inputShell: {
    flex: 1, minHeight: 42, maxHeight: 96, flexDirection: 'row', alignItems: 'center',
    backgroundColor: CARD_ELEVATED, borderRadius: 21, paddingLeft: 12, paddingRight: 4,
  },
  input: {
    flex: 1, paddingHorizontal: 0, paddingVertical: 9, fontFamily: FONT.regular,
    fontSize: FS.sm, color: FG, maxHeight: 88, minHeight: 42,
  },
  inputTool: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  mentionIcon: { color: FG, fontFamily: FONT.bold, fontSize: 22, lineHeight: 24 },

  // Actions sheet
  sheetScrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheetCard: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: theme.card, borderTopLeftRadius: 22, borderTopRightRadius: 22,
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
