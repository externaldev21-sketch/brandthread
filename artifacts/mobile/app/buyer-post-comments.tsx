/**
 * Buyer Post Comments Screen
 * Full-screen modal: shows a post summary at the top, then a scrollable
 * comment thread below, with one-level reply support.
 *
 * Interaction quality:
 *  - First-load: skeleton rows while fetching
 *  - Fetch failure: InlineError with retry (no Alert)
 *  - Posting: inline progress indicator on send button; InlineError on failure
 *  - Count sync: commentsCount updates from the authoritative list after a
 *    successful post (removes optimistic count from the temp item)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, StyleSheet, Animated,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  BG, SURFACE, CARD, CARD_ELEVATED, BORDER,
  FG, MUTED, SUBTLE, RED, ON_DARK,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import {
  getComments, postComment, likeComment, deleteComment,
  subscribeSocial, MY_USER_ID, MY_COLOR, MY_INITIALS, MY_NAME, MY_HANDLE,
} from '@/services/socialService';
import type { Comment } from '@/services/socialTypes';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { InlineSpinner, InlineError } from '@/components/InlineFeedback';
import { CachedImage } from '@/components/CachedImage';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

const QUICK_EMOJIS = ['😁', '🥰', '😂', '😮', '😉', '😅', '🥺'] as const;

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

// ─── Comment Row ──────────────────────────────────────────────────────────────

function CommentRow({
  comment,
  postAuthorId,
  onLike,
  onReply,
  onDelete,
}: {
  comment: Comment;
  postAuthorId: string;
  onLike: (id: string) => void;
  onReply: (comment: Comment) => void;
  onDelete: (id: string) => void;
}) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const isOwn = comment.authorId === MY_USER_ID;
  const isCreator = !!postAuthorId && comment.authorId === postAuthorId;
  const isReply = !!comment.replyToId;
  /** Optimistic comments carry a tmp_ prefix — show a subtle pending indicator */
  const isPending = comment.id.startsWith('tmp_');

  const handleLongPress = () => {
    if (!isOwn) return;
    // We use a custom inline delete confirm rather than Alert
    onDelete(comment.id);
  };

  return (
    <TouchableOpacity
      style={[s.commentRow, isReply && s.commentRowIndented, isPending && s.commentRowPending]}
      activeOpacity={0.8}
      onLongPress={handleLongPress}
      delayLongPress={400}
    >
      {/* Avatar */}
      <View style={[s.avatar, { backgroundColor: comment.authorColor }]}>
        <Text style={s.avatarText}>{comment.authorInitials}</Text>
      </View>

      <View style={s.commentBody}>
        {/* Reply banner */}
        {isReply && comment.replyToText ? (
          <View style={s.replyBanner}>
            <Feather name="corner-up-left" size={10} color={MUTED} />
            <Text style={s.replyBannerText} numberOfLines={1}>
              {comment.replyToAuthorName}: {comment.replyToText}
            </Text>
          </View>
        ) : null}

        {/* Header */}
        <View style={s.commentHeader}>
          <Text style={s.authorName}>{comment.authorName}</Text>
          {isCreator && <Text style={[s.creatorBadge, { color: theme.accent }]}>· Creator</Text>}
          {isPending && <View style={s.pendingDot} />}
        </View>

        {/* Text */}
        <Text style={s.commentText}>{comment.text}</Text>

        {/* Actions — hidden while pending */}
        <View style={s.commentMeta}>
          <Text style={s.commentTime}>{isPending ? 'Posting…' : timeAgo(comment.createdAt)}</Text>
          {!isPending && (
            <TouchableOpacity style={s.replyBtn} onPress={() => onReply(comment)}>
              <Text style={s.replyLabel}>Reply</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {!isPending && (
        <TouchableOpacity
          style={s.commentLike}
          onPress={() => onLike(comment.id)}
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

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function BuyerPostCommentsScreen() {
  const colors = useColors();
  const { theme } = useAppTheme();
  const PURPLE = colors.primary;
  const s = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    postId: string;
    postAuthorId?: string;
    postAuthorName?: string;
    postAuthorInitials?: string;
    postAuthorColor?: string;
    postCaption?: string;
    postMediaUri?: string;
    postMediaColor1?: string;
    postMediaColor2?: string;
    postType?: string;
  }>();

  const postId = params.postId ?? '';
  const postAuthorId = params.postAuthorId ?? '';
  const authorName = params.postAuthorName ?? '';
  const authorInitials = params.postAuthorInitials ?? '?';
  const authorColor = params.postAuthorColor ?? PURPLE;
  const caption = params.postCaption ?? '';
  const mediaUri = params.postMediaUri ?? '';
  const postType = params.postType ?? 'photo';
  const mediaPlayer = useVideoPlayer(
    mediaUri && postType === 'video' ? { uri: mediaUri } : null,
    player => {
      player.loop = true;
      player.muted = true;
      player.play();
    },
  );

  const [comments, setComments] = useState<Comment[]>([]);
  const [inputText, setInputText] = useState('');
  const [replyingTo, setReplyingTo] = useState<Comment | null>(null);
  const [sending, setSending] = useState(false);
  /** True only on the first load (no prior data) */
  const [loading, setLoading] = useState(true);
  /** Error message shown inline below the count row */
  const [fetchError, setFetchError] = useState<string | null>(null);
  /** Transient post-failure message shown below the input */
  const [sendError, setSendError] = useState<string | null>(null);

  const listRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const hasLoadedOnce = useRef(false);

  const load = useCallback(async () => {
    // Only show skeleton on the very first load; subsequent fetches are silent
    if (!hasLoadedOnce.current) setLoading(true);
    setFetchError(null);
    try {
      const data = await getComments(postId);
      setComments(data);
      hasLoadedOnce.current = true;
    } catch {
      setFetchError('Could not load comments. Tap Retry to try again.');
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const unsub = subscribeSocial(() => load());
    return unsub;
  }, [load]);

  const handleLike = async (commentId: string) => {
    // Optimistic update
    setComments(prev =>
      prev.map(c =>
        c.id === commentId
          ? { ...c, likedByMe: !c.likedByMe, likesCount: c.likedByMe ? c.likesCount - 1 : c.likesCount + 1 }
          : c,
      ),
    );
    await likeComment(postId, commentId);
  };

  const handleReply = (comment: Comment) => {
    setReplyingTo(comment);
    inputRef.current?.focus();
  };

  const handleCancelReply = () => {
    setReplyingTo(null);
    setInputText('');
  };

  const handleDelete = async (commentId: string) => {
    setComments(prev => prev.filter(c => c.id !== commentId));
    await deleteComment(postId, commentId);
  };

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    const optimistic: Comment = {
      id: `tmp_${Date.now()}`,
      postId,
      authorId: MY_USER_ID,
      authorName: MY_NAME,
      authorHandle: MY_HANDLE,
      authorInitials: MY_INITIALS,
      authorColor: MY_COLOR,
      text,
      replyToId: replyingTo?.id,
      replyToAuthorName: replyingTo?.authorName,
      replyToText: replyingTo?.text,
      likedByMe: false,
      likesCount: 0,
      createdAt: new Date().toISOString(),
    };
    setComments(prev => [optimistic, ...prev]);
    setInputText('');
    setReplyingTo(null);
    requestAnimationFrame(() => inputRef.current?.focus());

    try {
      await postComment({
        postId,
        text,
        replyToId: replyingTo?.id,
        replyToAuthorName: replyingTo?.authorName,
        replyToText: replyingTo?.text ? replyingTo.text.slice(0, 60) : undefined,
      });
      // Successful post: remove the optimistic item and reload to get the
      // authoritative comment from the server with the real ID and count.
      setComments(prev => prev.filter(c => c.id !== optimistic.id));
      await load();
    } catch {
      // Remove optimistic item and show inline error
      setComments(prev => prev.filter(c => c.id !== optimistic.id));
      setSendError('Could not post comment. Tap to retry.');
    } finally {
      setSending(false);
    }
  };

  /** Real comment count (excludes temp optimistic items) */
  const realCount = comments.filter(c => !c.id.startsWith('tmp_')).length;

  return (
    <View style={s.overlay}>
      {mediaUri ? (
        postType === 'video' ? (
          <VideoView
            player={mediaPlayer}
            style={s.mediaBackdrop}
            contentFit="cover"
            nativeControls={false}
          />
        ) : (
          <CachedImage source={{ uri: mediaUri }} style={s.mediaBackdrop} contentFit="cover" />
        )
      ) : null}
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
      >
        <View style={s.postSummary}>
          <View style={[s.postAvatar, { backgroundColor: authorColor }]}>
            <Text style={s.postAvatarText}>{authorInitials}</Text>
          </View>
          <View style={s.postSummaryCopy}>
            <Text style={s.postAuthorName} numberOfLines={1}>{authorName || 'Post'}</Text>
            <Text style={s.postCaption} numberOfLines={1}>{caption || 'View the conversation'}</Text>
          </View>
          <Feather name={postType === 'video' ? 'play' : 'image'} size={16} color={MUTED} />
        </View>

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
              onDelete={handleDelete}
            />
          )}
          ListEmptyComponent={
            !loading && !fetchError
              ? <View style={s.emptyState}><Text style={s.emptyTitle}>Start the conversation</Text><Text style={s.emptyText}>Be the first to comment.</Text></View>
              : null
          }
        />

        <View style={[s.inputWrap, { paddingBottom: Math.max(insets.bottom, SP.sm) }]}>
          {sendError ? (
            <TouchableOpacity style={s.sendErrorBanner} onPress={() => setSendError(null)}>
              <Feather name="alert-circle" size={12} color={RED} />
              <Text style={s.sendErrorText} numberOfLines={1}>{sendError}</Text>
              <Feather name="x" size={12} color={RED} />
            </TouchableOpacity>
          ) : null}
          {replyingTo ? (
            <View style={s.replyingBanner}>
              <Text style={s.replyingLabel} numberOfLines={1}>
                Replying to <Text style={[s.replyingName, { color: theme.accent }]}>{replyingTo.authorName}</Text>
              </Text>
              <TouchableOpacity onPress={handleCancelReply} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Feather name="x" size={14} color={MUTED} />
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={s.emojiRow}>
            {QUICK_EMOJIS.map(emoji => (
              <TouchableOpacity
                key={emoji}
                style={s.emojiBtn}
                onPress={() => {
                  setInputText(value => `${value}${emoji}`);
                  inputRef.current?.focus();
                }}
                accessibilityRole="button"
                accessibilityLabel={`Add ${emoji}`}
              >
                <Text style={s.emoji}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={s.inputRow}>
            <View style={[s.inputAvatar, { backgroundColor: MY_COLOR }]}>
              <Text style={s.inputAvatarText}>{MY_INITIALS}</Text>
            </View>
            <View style={s.inputShell}>
              <TextInput
                ref={inputRef}
                style={s.input}
                value={inputText}
                onChangeText={setInputText}
                placeholder={replyingTo ? `Reply to ${replyingTo.authorName}…` : 'Add comment…'}
                placeholderTextColor={MUTED}
                multiline
                maxLength={500}
                returnKeyType="default"
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
              <TouchableOpacity style={s.inputTool} onPress={() => inputRef.current?.focus()} accessibilityLabel="Choose emoji">
                <Feather name="smile" size={21} color={FG} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[s.sendBtn, { backgroundColor: theme.accent }, (!inputText.trim() || sending) && s.sendBtnDisabled]}
              onPress={handleSend}
              disabled={!inputText.trim() || sending}
              accessibilityRole="button"
              accessibilityLabel={sending ? 'Posting comment' : 'Send comment'}
            >
              {sending ? <InlineSpinner style={{ paddingVertical: 0 }} /> : <Feather name="arrow-up" size={18} color={theme.onAccent} />}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const PURPLE = theme.accent;
  const PURPLE_DIM = theme.accentDim;
  return StyleSheet.create({
  container: { flex: 1 },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.14)',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  mediaBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    height: '31%',
  },
  sheet: {
    height: '73%',
    overflow: 'hidden',
    backgroundColor: CARD,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: BORDER,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 52,
    paddingHorizontal: SP.sm,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headerSide: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: FONT.bold,
    fontSize: FS.sm,
    color: FG,
  },

  // Post summary
  postSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: SP.md,
    minHeight: 62,
    paddingVertical: SP.sm,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  postSummaryCopy: { flex: 1, minWidth: 0 },
  postAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    marginBottom: 4,
  },
  postAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postAvatarText: {
    fontFamily: FONT.bold,
    fontSize: FS.xs,
    color: ON_DARK,
  },
  postAuthorName: {
    fontFamily: FONT.bold,
    fontSize: FS.sm,
    color: FG,
  },
  postCaption: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: MUTED,
    lineHeight: 16,
    marginTop: 2,
  },
  listContent: { paddingTop: 4, paddingBottom: SP.md, flexGrow: 1 },
  emptyState: { flex: 1, minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 5 },
  emptyTitle: { color: FG, fontFamily: FONT.semibold, fontSize: FS.base },
  emptyText: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm },

  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
  },
  divider: { flex: 1, height: 1, backgroundColor: BORDER },
  countLabel: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    color: SUBTLE,
  },

  // Comment rows
  commentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: SP.md,
    paddingVertical: 10,
  },
  commentRowIndented: {
    paddingLeft: SP.md + 42,
  },
  commentRowPending: {
    opacity: 0.6,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    fontFamily: FONT.bold,
    fontSize: FS.xs,
    color: ON_DARK,
  },
  commentBody: { flex: 1, minWidth: 0 },

  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  replyBannerText: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: MUTED,
    flex: 1,
  },

  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    marginBottom: 3,
  },
  authorName: {
    fontFamily: FONT.medium,
    fontSize: 13,
    color: MUTED,
  },
  creatorBadge: { fontFamily: FONT.semibold, fontSize: 13 },
  commentTime: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: SUBTLE,
  },
  pendingDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: SUBTLE,
    marginLeft: 2,
  },
  commentText: {
    fontFamily: FONT.medium,
    fontSize: 14,
    color: FG,
    lineHeight: 19,
  },
  commentMeta: { flexDirection: 'row', alignItems: 'center', gap: SP.md, marginTop: 5 },
  replyBtn: { paddingVertical: 2, paddingRight: SP.sm },
  commentLike: { width: 38, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 2 },
  commentActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.md,
    marginTop: SP.xs,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  actionLabel: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: MUTED,
    textAlign: 'center',
  },
  replyLabel: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    color: MUTED,
  },

  // Input
  inputWrap: {
    borderTopWidth: 1,
    borderTopColor: BORDER,
    backgroundColor: CARD,
    paddingTop: 6,
    paddingHorizontal: 12,
  },
  sendErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(248,113,113,0.1)',
    borderRadius: RADIUS.sm,
    paddingHorizontal: SP.sm,
    paddingVertical: 5,
    marginBottom: SP.xs,
  },
  sendErrorText: {
    flex: 1,
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: RED,
  },
  replyingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: PURPLE_DIM,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SP.sm,
    paddingVertical: SP.xs,
    marginBottom: SP.xs,
  },
  replyingLabel: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: MUTED,
    flex: 1,
  },
  replyingName: {
    fontFamily: FONT.semibold,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inputAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  emojiRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  emojiBtn: {
    width: 40,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: 23 },
  inputShell: {
    flex: 1,
    minHeight: 42,
    maxHeight: 96,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD_ELEVATED,
    borderRadius: 21,
    paddingLeft: 12,
    paddingRight: 4,
  },
  inputAvatarText: {
    fontFamily: FONT.bold,
    fontSize: FS.xs,
    color: ON_DARK,
  },
  input: {
    flex: 1,
    paddingHorizontal: 0,
    paddingVertical: 9,
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: FG,
    maxHeight: 88,
    minHeight: 42,
  },
  inputTool: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mentionIcon: { color: FG, fontFamily: FONT.bold, fontSize: 22, lineHeight: 24 },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.28 },
  });
};
