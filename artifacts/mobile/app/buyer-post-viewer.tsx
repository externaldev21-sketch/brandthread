/**
 * Buyer Post Viewer — full-screen post detail.
 * Receives lightweight params from the profile grid; loads real engagement
 * from socialService. Owner-only: edit caption (inline modal) and delete.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Modal, Share, Animated, useWindowDimensions, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useMeaningfulVideoWatch } from '@/hooks/useMeaningfulVideoWatch';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { CachedImage } from '@/components/CachedImage';
import {
  BG, SURFACE, CARD, BORDER, FG, MUTED, SUBTLE, ON_DARK,
  FONT, FS, SP, RADIUS, ICON, OVERLAY, RED, COMP,
} from '@/lib/theme';
import { useExpandFromTileOverlay } from '@/components/ExpandFromTileOverlay';
import {
  getComments, likePost, repostPost, saveItem, getMyPosts, getPostById, updatePost, deletePost,
  MY_USER_ID, MY_COLOR, MY_INITIALS, MY_NAME, MY_HANDLE,
} from '@/services/socialService';
import type { BuyerPost, Comment } from '@/services/socialTypes';
import { getPreviewActivityPost } from '@/lib/previewActivity';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/lib/api';
import { requestContextualPushPermission } from '@/lib/contextualPushPermission';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ModalSafeArea } from '@/components/ModalSafeArea';

function PostVideo({ uri, onWatched }: { uri: string; onWatched?: () => void }) {
  const player = useVideoPlayer(uri, p => { p.loop = true; p.muted = false; });
  const isFocused = useIsFocused();
  useMeaningfulVideoWatch(player, isFocused, onWatched);
  useEffect(() => {
    player.play();
    return () => { player.pause(); };
  }, [player]);
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls
    />
  );
}

function PostMedia({
  mediaUrl, type, mediaColor1, mediaColor2, typeIcon, onWatched,
}: {
  mediaUrl?: string; type: BuyerPost['type'];
  mediaColor1: string; mediaColor2: string; typeIcon: keyof typeof Feather.glyphMap;
  onWatched?: () => void;
}) {
  if (mediaUrl && type === 'video') {
    return <PostVideo uri={mediaUrl} onWatched={onWatched} />;
  }
  if (mediaUrl) {
    return (
      <CachedImage
        source={{ uri: mediaUrl }}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        cachePolicy="memory-disk"
        transition={150}
      />
    );
  }
  return (
    <LinearGradient colors={[mediaColor1, mediaColor2] as [string, string]} style={StyleSheet.absoluteFill}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Feather name={typeIcon} size={ICON.xl} color={MUTED} />
      </View>
    </LinearGradient>
  );
}

/**
 * Preview only: the viewer's seeded post an Activity row points at, after the
 * real lookups come back empty (item 82) — its real photo and counts rather
 * than a blank placeholder. `null` for every id outside the preview seed.
 */
function previewPost(postId: string | undefined): BuyerPost | null {
  const seed = postId ? getPreviewActivityPost(postId) : undefined;
  if (!seed) return null;
  return {
    id: seed.id, authorId: MY_USER_ID, authorName: MY_NAME, authorHandle: MY_HANDLE,
    authorInitials: MY_INITIALS, authorColor: MY_COLOR, authorAccountType: 'buyer',
    feedEligibility: 'profile_only', profileVisibility: 'public', type: 'photo',
    caption: '', hashtags: [], mediaColors: [], mediaUrl: seed.mediaUrl,
    likesCount: seed.likesCount, commentsCount: seed.commentsCount, repostsCount: seed.repostsCount,
    likedByMe: false, savedByMe: false, repostedByMe: false, isArchived: false, isDraft: false,
    createdAt: seed.createdAt, updatedAt: seed.createdAt,
  };
}

export default function BuyerPostViewer() {
  const { userId } = useAuth();
  const api = useApi();
  const colors = useColors();
  const { theme } = useAppTheme();
  const PURPLE = colors.primary, PURPLE_LIGHT = theme.accentLight, PURPLE_DIM = colors.accent, CYAN = theme.secondary, CYAN_DIM = theme.secondaryDim;
  const BORDER_ACTIVE = `${theme.accent}73`, BORDER_FOCUS = `${theme.secondary}80`;
  const GRAD_PRIMARY = theme.primaryGradient;
  const SHADOW_PURPLE = { shadowColor: theme.shadowColor, shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 };
  const s = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const router = useRouter();
  const params = useLocalSearchParams<{
    postId: string;
    postCaption: string;
    postAuthorName: string;
    postAuthorInitials: string;
    postAuthorColor: string;
    postMediaColor1: string;
    postMediaColor2: string;
    postType: string;
  }>();

  const [post, setPost] = useState<BuyerPost | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [reposted, setReposted] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editCaption, setEditCaption] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const handleVideoWatched = useCallback(() => {
    if (userId && post?.id) void api.posts.recordWatchedVideo(post.id).catch(() => {});
  }, [api, userId, post?.id]);

  // When post is null (not yet loaded or not found in my posts), assume non-owner
  // so report is visible and owner-only controls are hidden.
  const isOwner = post !== null && post.authorId === MY_USER_ID;

  const loadPost = useCallback(async () => {
    let found: BuyerPost | null = null;
    try {
      const all = await getMyPosts();
      found = all.find(p => p.id === params.postId) ?? await getPostById(params.postId);
    } catch {
      // A failed lookup leaves the placeholder, as before — or, in the
      // preview, falls through to the seeded post below.
    }
    found = found ?? previewPost(params.postId);
    if (found) {
      setPost(found);
      setLiked(found.likedByMe ?? false);
      setLikeCount(found.likesCount ?? 0);
      setReposted(found.repostedByMe ?? false);
      setSaved(found.savedByMe ?? false);
      setEditCaption(found.caption);
    }
  }, [params.postId]);

  useEffect(() => {
    loadPost();
    if (params.postId) {
      getComments(params.postId).then(setComments).catch(() => setComments([]));
    }
  }, [loadPost, params.postId]);

  // Real posts (UUID ids) engage through the API with rollback; seeded
  // preview posts keep the local store behaviour they always had.
  const realPostId = params.postId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.postId) ? params.postId : null;

  // One view per open — the same signal the main feed records, so the
  // owner's Content Analytics counts views from every surface.
  useEffect(() => {
    if (userId && realPostId) void api.posts.interact(realPostId, { type: 'view' }).catch(() => {});
  }, [api, userId, realPostId]);

  const handleLike = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const wasLiked = liked;
    const prevCount = likeCount;
    const newLiked = !liked;
    setLiked(newLiked);
    setLikeCount(c => newLiked ? c + 1 : Math.max(0, c - 1));
    if (!realPostId) {
      if (params.postId) await likePost(params.postId);
      return;
    }
    try {
      const result = await api.posts.interact(realPostId, { type: 'like', value: newLiked ? 'add' : 'remove' });
      if (typeof result?.count === 'number') setLikeCount(result.count);
    } catch {
      setLiked(wasLiked);
      setLikeCount(prevCount);
      Alert.alert('Could not update like', 'Check your connection and try again.');
    }
  };

  const handleRepost = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const wasReposted = reposted;
    setReposted(!wasReposted);
    if (!realPostId) {
      if (params.postId) await repostPost(params.postId);
      return;
    }
    try {
      const result = await api.posts.interact(realPostId, { type: 'repost', value: wasReposted ? 'remove' : undefined });
      setReposted(result?.action === 'added');
    } catch (error) {
      setReposted(wasReposted);
      Alert.alert('Could not update repost', error instanceof Error && error.message ? error.message : 'Try again.');
    }
  };

  const handleSaveToggle = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!params.postId) return;
    const wasSaved = saved;
    setSaved(!wasSaved);
    if (!realPostId) {
      if (!wasSaved) await saveItem({ type: 'post', targetId: params.postId, title: caption || 'Post', accentColor: mediaColor1 });
      return;
    }
    try {
      if (wasSaved) {
        await api.buyer.saved.remove(realPostId);
      } else {
        await api.buyer.saved.save({ type: 'post', targetId: realPostId, title: caption || 'Post', accentColor: mediaColor1 });
        void requestContextualPushPermission(userId, api);
      }
    } catch {
      setSaved(wasSaved);
      Alert.alert(wasSaved ? 'Could not remove from saved' : 'Could not save', 'Check your connection and try again.');
    }
  };

  const handleShare = async () => {
    const caption = post?.caption || params.postCaption || '';
    const handle = post?.authorHandle ? `@${post.authorHandle}` : MY_HANDLE;
    try {
      const result = await Share.share({ message: `${handle} on Brandthread: "${caption}"`, title: 'Share Post' });
      // Count the share for the owner (share count + Content Analytics) only
      // when the sheet actually shared, not on dismiss.
      const dismissed = (result as any)?.action === 'dismissedAction';
      if (realPostId && userId && !dismissed) void api.posts.interact(realPostId, { type: 'share' }).catch(() => {});
    } catch {}
  };

  const handleSaveCaption = async () => {
    if (!post) return;
    await updatePost(post.id, { caption: editCaption });
    setPost(prev => prev ? { ...prev, caption: editCaption } : prev);
    setEditOpen(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleDelete = async () => {
    if (!post) return;
    await deletePost(post.id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    goBackOr(router);
  };

  // Use params as display fallback while the async load completes
  const caption = post?.caption ?? params.postCaption ?? '';
  const authorName = post?.authorName ?? params.postAuthorName ?? MY_NAME;
  const authorInitials = post?.authorInitials ?? params.postAuthorInitials ?? MY_INITIALS;
  const authorColor = post?.authorColor ?? params.postAuthorColor ?? MY_COLOR;
  const mediaColor1 = params.postMediaColor1 ?? SURFACE;
  const mediaColor2 = params.postMediaColor2 ?? BG;
  const postType = (post?.type ?? params.postType ?? 'photo') as BuyerPost['type'];

  const typeIcon: keyof typeof Feather.glyphMap =
    postType === 'photo' ? 'image' : postType === 'slideshow' ? 'layers' : 'video';

  // Media is a full-width square right under the header — a stable enough
  // target rect to grow the tapped grid tile into without needing to
  // measure the real content (see components/ExpandFromTileOverlay).
  const { overlay: tileExpandOverlay, contentOpacity } = useExpandFromTileOverlay(params.postId, {
    x: 0,
    y: insets.top + COMP.headerH,
    width: windowWidth,
    height: windowWidth,
  });

  return (
    <View style={s.page}>
      <ScreenHeader
        title={authorName}
        onBack={() => goBackOr(router)}
        actions={[{ icon: 'send', onPress: handleShare, accessibilityLabel: 'Share' }]}
      />
      {tileExpandOverlay}

      <Animated.ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        style={contentOpacity ? { opacity: contentOpacity } : undefined}
      >
        {/* Media display */}
        <View style={s.media}>
          <PostMedia
            mediaUrl={post?.mediaUrl}
            type={postType}
            mediaColor1={mediaColor1}
            mediaColor2={mediaColor2}
            typeIcon={typeIcon}
            onWatched={post?.type === 'video' ? handleVideoWatched : undefined}
          />
        </View>

        {/* Author row */}
        <View style={s.authorRow}>
          <View style={[s.avatar, { backgroundColor: authorColor }]}>
            <Text style={s.avatarText}>{authorInitials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.authorName}>{authorName}</Text>
            {post?.authorHandle ? (
              <Text style={s.authorHandle}>{post.authorHandle}</Text>
            ) : null}
          </View>
          {isOwner && (
            <TouchableOpacity style={s.editBtn} onPress={() => { setEditOpen(true); setEditCaption(caption); }}>
              <Feather name="edit-2" size={16} color={PURPLE} />
              <Text style={s.editBtnText}>Edit caption</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Caption */}
        {caption ? (
          <Text style={s.caption}>{caption}</Text>
        ) : null}

        {/* Timestamp */}
        {post?.createdAt ? (
          <Text style={s.timestamp}>
            {new Date(post.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
          </Text>
        ) : null}

        {/* Engagement bar */}
        <View style={s.engagementBar}>
          <TouchableOpacity style={s.engageBtn} onPress={handleLike}>
            <Feather name="heart" size={22} color={liked ? RED : FG} />
            <Text style={[s.engageCount, liked && { color: RED }]}>{likeCount}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.engageBtn}
            onPress={() => {
              Haptics.selectionAsync();
              const qs = new URLSearchParams({
                postId: params.postId ?? '',
                postAuthorName: authorName,
                postAuthorInitials: authorInitials,
                postAuthorColor: authorColor,
                postCaption: caption,
                postMediaColor1: mediaColor1,
                postMediaColor2: mediaColor2,
                postType: postType,
              }).toString();
              router.push(`/buyer-post-comments?${qs}` as never);
            }}
          >
            <Feather name="message-circle" size={22} color={FG} />
            <Text style={s.engageCount}>{comments.length}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.engageBtn}
            onPress={handleRepost}
          >
            <Feather name="repeat" size={22} color={reposted ? PURPLE : FG} />
          </TouchableOpacity>
          <TouchableOpacity
            style={s.engageBtn}
            onPress={handleSaveToggle}
          >
            <Feather name="bookmark" size={22} color={saved ? PURPLE : FG} />
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          {!isOwner && (
            <TouchableOpacity
              style={s.engageBtn}
              onPress={() => {
                Haptics.selectionAsync();
                router.push(`/buyer-report?targetType=post&targetId=${params.postId ?? ''}&targetLabel=${encodeURIComponent(caption || 'Post')}&targetUserId=${post?.authorId ?? ''}` as never);
              }}
            >
              <Feather name="flag" size={22} color={FG} />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.engageBtn} onPress={handleShare}>
            <Feather name="share-2" size={22} color={FG} />
          </TouchableOpacity>
        </View>

        {/* Comments preview */}
        {comments.length > 0 && (
          <View style={s.commentsSection}>
            <Text style={s.commentsLabel}>{comments.length} comment{comments.length !== 1 ? 's' : ''}</Text>
            {comments.slice(0, 3).map(c => (
              <View key={c.id} style={s.commentRow}>
                <View style={[s.commentAvatar, { backgroundColor: c.authorColor }]}>
                  <Text style={s.commentAvatarText}>{c.authorInitials}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.commentName}>{c.authorName}</Text>
                  <Text style={s.commentText}>{c.text}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Owner-only danger zone */}
        {isOwner && (
          <View style={{ paddingHorizontal: SP.md, marginTop: SP.lg }}>
            <TouchableOpacity
              style={s.deleteBtn}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); setDeleteConfirm(true); }}
            >
              <Feather name="trash-2" size={16} color={RED} />
              <Text style={s.deleteBtnText}>Delete post</Text>
            </TouchableOpacity>
          </View>
        )}
      </Animated.ScrollView>

      {/* Edit caption modal */}
      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => setEditOpen(false)}>
        <ModalSafeArea>
          <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={() => setEditOpen(false)}>
            <TouchableOpacity activeOpacity={1} style={s.modalSheet}>
              <View style={s.modalHandle} />
              <Text style={s.modalTitle}>Edit Caption</Text>
              <TextInput
                style={s.captionInput}
                value={editCaption}
                onChangeText={setEditCaption}
                placeholder="Write a caption…"
                placeholderTextColor={SUBTLE}
                multiline
                autoFocus
              />
              <View style={s.modalActions}>
                <Button label="Cancel" variant="secondary" style={s.modalActionBtn} onPress={() => setEditOpen(false)} />
                <Button label="Save" variant="primary" style={s.modalActionBtn} onPress={handleSaveCaption} />
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </ModalSafeArea>
      </Modal>

      {/* Delete confirm modal */}
      <Modal visible={deleteConfirm} transparent animationType="fade" onRequestClose={() => setDeleteConfirm(false)}>
        <ModalSafeArea>
          <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={() => setDeleteConfirm(false)}>
            <TouchableOpacity activeOpacity={1} style={s.modalSheet}>
              <View style={s.modalHandle} />
              <Text style={s.modalTitle}>Delete post?</Text>
              <Text style={s.modalDesc}>This will permanently remove the post from your profile. This cannot be undone.</Text>
              <View style={s.modalActions}>
                <Button label="Cancel" variant="secondary" style={s.modalActionBtn} onPress={() => setDeleteConfirm(false)} />
                <Button label="Delete" variant="destructive" style={s.modalActionBtn} onPress={handleDelete} />
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </ModalSafeArea>
      </Modal>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const PURPLE = theme.accent, PURPLE_LIGHT = theme.accentLight, PURPLE_DIM = theme.accentDim, CYAN = theme.secondary, CYAN_DIM = theme.secondaryDim;
  const BORDER_ACTIVE = `${theme.accent}73`, BORDER_FOCUS = `${theme.secondary}80`;
  const SHADOW_PURPLE = { shadowColor: theme.shadowColor, shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 };
  return StyleSheet.create({
  page: { flex: 1, backgroundColor: 'transparent' },
  media: { width: '100%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  authorRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingTop: SP.md, gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: FONT.bold, fontSize: FS.sm, color: ON_DARK },
  authorName: { fontFamily: FONT.semibold, fontSize: FS.base, color: FG },
  authorHandle: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: SP.sm, paddingVertical: 6, borderRadius: RADIUS.sm, backgroundColor: PURPLE_DIM },
  editBtnText: { fontFamily: FONT.medium, fontSize: FS.xs, color: PURPLE },
  caption: { paddingHorizontal: SP.md, paddingTop: SP.sm, fontFamily: FONT.regular, fontSize: FS.base, color: FG, lineHeight: 22 },
  timestamp: { paddingHorizontal: SP.md, paddingTop: SP.xs, fontFamily: FONT.regular, fontSize: FS.xs, color: SUBTLE },
  engagementBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingTop: SP.md, gap: SP.sm },
  engageBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: SP.xs },
  engageCount: { fontFamily: FONT.medium, fontSize: FS.sm, color: FG },
  commentsSection: { paddingHorizontal: SP.md, marginTop: SP.md },
  commentsLabel: { fontFamily: FONT.semibold, fontSize: FS.sm, color: MUTED, marginBottom: SP.sm },
  commentRow: { flexDirection: 'row', gap: 8, marginBottom: SP.sm },
  commentAvatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  commentAvatarText: { fontFamily: FONT.bold, fontSize: FS.xs, color: ON_DARK },
  commentName: { fontFamily: FONT.semibold, fontSize: FS.xs, color: MUTED },
  commentText: { fontFamily: FONT.regular, fontSize: FS.sm, color: FG },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, padding: SP.md, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: RED + '44', justifyContent: 'center' },
  deleteBtnText: { fontFamily: FONT.medium, fontSize: FS.base, color: RED },
  modalBackdrop: { flex: 1, backgroundColor: OVERLAY, justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: CARD, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: SP.lg, paddingBottom: 40 },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: 'center', marginBottom: SP.md },
  modalTitle: { fontFamily: FONT.bold, fontSize: FS.lg, color: FG, marginBottom: SP.sm },
  modalDesc: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, lineHeight: 20, marginBottom: SP.md },
  captionInput: { borderWidth: 1, borderColor: BORDER_ACTIVE, borderRadius: RADIUS.md, padding: SP.md, color: FG, fontFamily: FONT.regular, fontSize: FS.base, minHeight: 100, textAlignVertical: 'top', marginBottom: SP.md },
  modalActions: { flexDirection: 'row', gap: SP.sm },
  modalActionBtn: { flex: 1 },
  });
};
