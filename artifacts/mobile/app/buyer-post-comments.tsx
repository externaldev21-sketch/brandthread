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
  KeyboardAvoidingView, Platform, StyleSheet,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
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
  onLike,
  onReply,
  onDelete,
}: {
  comment: Comment;
  onLike: (id: string) => void;
  onReply: (comment: Comment) => void;
  onDelete: (id: string) => void;
}) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const isOwn = comment.authorId === MY_USER_ID;
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
          {isPending ? (
            <View style={s.pendingDot} />
          ) : (
            <Text style={s.commentTime}>{timeAgo(comment.createdAt)}</Text>
          )}
        </View>

        {/* Text */}
        <Text style={s.commentText}>{comment.text}</Text>

        {/* Actions — hidden while pending */}
        {!isPending && (
          <View style={s.commentActions}>
            <TouchableOpacity style={s.actionBtn} onPress={() => onLike(comment.id)}>
              <Feather
                name="heart"
                size={13}
                color={comment.likedByMe ? RED : MUTED}
              />
              {comment.likesCount > 0 && (
                <Text style={[s.actionLabel, comment.likedByMe && { color: RED }]}>
                  {comment.likesCount}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={s.actionBtn} onPress={() => onReply(comment)}>
              <Text style={s.replyLabel}>Reply</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
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
    postAuthorName?: string;
    postAuthorInitials?: string;
    postAuthorColor?: string;
    postCaption?: string;
    postMediaColor1?: string;
    postMediaColor2?: string;
    postType?: string;
  }>();

  const postId = params.postId ?? '';
  const authorName = params.postAuthorName ?? '';
  const authorInitials = params.postAuthorInitials ?? '?';
  const authorColor = params.postAuthorColor ?? PURPLE;
  const caption = params.postCaption ?? '';
  const mediaColor1 = params.postMediaColor1 ?? '#111113';
  const mediaColor2 = params.postMediaColor2 ?? '#0A0A0B';
  const postType = params.postType ?? 'photo';

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
    setComments(prev => [...prev, optimistic]);
    setInputText('');
    setReplyingTo(null);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);

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
    <KeyboardAvoidingView
      style={[s.container, { backgroundColor: 'transparent' }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + SP.sm }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="x" size={ICON.lg} color={FG} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Comments</Text>
        <View style={{ width: ICON.lg }} />
      </View>

      <FlatList
        ref={listRef}
        data={loading ? [] : comments}
        keyExtractor={c => c.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: SP.xl }}
        ListHeaderComponent={() => (
          <>
            {/* Post summary */}
            <View style={s.postSummary}>
              <LinearGradient
                colors={[mediaColor1, mediaColor2] as [string, string]}
                style={s.postThumb}
              >
                <Feather
                  name={postType === 'video' ? 'video' : 'image'}
                  size={20}
                  color="rgba(255,255,255,0.35)"
                />
              </LinearGradient>
              <View style={{ flex: 1 }}>
                <View style={s.postAuthorRow}>
                  <View style={[s.postAvatar, { backgroundColor: authorColor }]}>
                    <Text style={s.postAvatarText}>{authorInitials}</Text>
                  </View>
                  <Text style={s.postAuthorName}>{authorName}</Text>
                </View>
                {caption ? (
                  <Text style={s.postCaption} numberOfLines={2}>{caption}</Text>
                ) : null}
              </View>
            </View>

            {/* Divider + count */}
            <View style={s.countRow}>
              <View style={s.divider} />
              <Text style={s.countLabel}>
                {loading
                  ? '…'
                  : realCount === 0
                    ? 'No comments yet — drop the first one.'
                    : `${realCount} comment${realCount !== 1 ? 's' : ''}`}
              </Text>
              <View style={s.divider} />
            </View>

            {/* First-load skeleton */}
            {loading && (
              <View style={{ gap: 0 }}>
                {[0, 1, 2, 3].map(i => <CommentSkeletonRow key={i} />)}
              </View>
            )}

            {/* Fetch error with retry */}
            {!loading && fetchError ? (
              <InlineError
                message={fetchError}
                onRetry={load}
              />
            ) : null}
          </>
        )}
        renderItem={({ item }) => (
          <CommentRow
            comment={item}
            onLike={handleLike}
            onReply={handleReply}
            onDelete={handleDelete}
          />
        )}
        ListEmptyComponent={loading || fetchError ? null : undefined}
      />

      {/* Input area */}
      <View style={[s.inputWrap, { paddingBottom: insets.bottom + SP.sm }]}>
        {/* Send error */}
        {sendError ? (
          <TouchableOpacity
            style={s.sendErrorBanner}
            onPress={() => { setSendError(null); }}
            accessibilityRole="button"
            accessibilityLabel="Dismiss send error"
          >
            <Feather name="alert-circle" size={12} color={RED} />
            <Text style={s.sendErrorText} numberOfLines={1}>{sendError}</Text>
            <Feather name="x" size={12} color={RED} />
          </TouchableOpacity>
        ) : null}

        {/* Reply banner */}
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

        <View style={s.inputRow}>
          {/* My avatar */}
          <View style={[s.inputAvatar, { backgroundColor: MY_COLOR }]}>
            <Text style={s.inputAvatarText}>{MY_INITIALS}</Text>
          </View>

          <TextInput
            ref={inputRef}
            style={s.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder={replyingTo ? `Reply to ${replyingTo.authorName}…` : 'Add a comment…'}
            placeholderTextColor={MUTED}
            multiline
            maxLength={500}
            returnKeyType="default"
          />

          {/* Send button: spinner while sending, send icon otherwise */}
          <TouchableOpacity
            style={[s.sendBtn, (!inputText.trim() || sending) && s.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!inputText.trim() || sending}
            accessibilityRole="button"
            accessibilityLabel={sending ? 'Posting comment' : 'Send comment'}
          >
            {sending ? (
              <InlineSpinner style={{ paddingVertical: 0 }} />
            ) : (
              <Feather name="send" size={ICON.md} color={!inputText.trim() ? MUTED : PURPLE} />
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const PURPLE = theme.accent;
  const PURPLE_DIM = theme.accentDim;
  return StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headerTitle: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    color: FG,
  },

  // Post summary
  postSummary: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SP.sm,
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
  },
  postThumb: {
    width: 52,
    height: 52,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  postAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    marginBottom: 4,
  },
  postAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postAvatarText: {
    fontFamily: FONT.bold,
    fontSize: 9,
    color: ON_DARK,
  },
  postAuthorName: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    color: FG,
  },
  postCaption: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
    lineHeight: 18,
  },

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
    gap: SP.sm,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
  },
  commentRowIndented: {
    paddingLeft: SP.md + 32 + SP.sm,
  },
  commentRowPending: {
    opacity: 0.6,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    fontFamily: FONT.bold,
    fontSize: FS.xs,
    color: ON_DARK,
  },
  commentBody: { flex: 1 },

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
    marginBottom: 2,
  },
  authorName: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    color: FG,
  },
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
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: FG,
    lineHeight: 20,
  },
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
    paddingTop: SP.sm,
    paddingHorizontal: SP.md,
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
    alignItems: 'flex-end',
    gap: SP.sm,
  },
  inputAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginBottom: 4,
  },
  inputAvatarText: {
    fontFamily: FONT.bold,
    fontSize: FS.xs,
    color: ON_DARK,
  },
  input: {
    flex: 1,
    backgroundColor: CARD_ELEVATED,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: FG,
    maxHeight: 100,
    minHeight: 40,
  },
  sendBtn: { padding: SP.xs, marginBottom: 4, minWidth: 32, alignItems: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
  });
};
