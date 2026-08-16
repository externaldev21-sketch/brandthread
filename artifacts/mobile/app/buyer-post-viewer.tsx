/**
 * Buyer Post Viewer — full-screen post detail.
 * Receives lightweight params from the profile grid; loads real engagement
 * from socialService. Owner-only: edit caption (inline modal) and delete.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Modal, Share,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  BG, SURFACE, CARD, BORDER, BORDER_ACTIVE, FG, MUTED, SUBTLE, PURPLE, PURPLE_DIM, ON_DARK,
  GRAD_PRIMARY, FONT, FS, SP, RADIUS, ICON, OVERLAY, RED,
} from '@/lib/theme';
import {
  getComments, likePost, repostPost, saveItem, getMyPosts, updatePost, deletePost,
  MY_USER_ID, MY_COLOR, MY_INITIALS, MY_NAME, MY_HANDLE,
} from '@/services/socialService';
import type { BuyerPost, Comment } from '@/services/socialTypes';

export default function BuyerPostViewer() {
  const insets = useSafeAreaInsets();
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

  // When post is null (not yet loaded or not found in my posts), assume non-owner
  // so report is visible and owner-only controls are hidden.
  const isOwner = post !== null && post.authorId === MY_USER_ID;

  const loadPost = useCallback(async () => {
    const all = await getMyPosts();
    const found = all.find(p => p.id === params.postId);
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
      getComments(params.postId).then(setComments);
    }
  }, [loadPost, params.postId]);

  const handleLike = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newLiked = !liked;
    setLiked(newLiked);
    setLikeCount(c => newLiked ? c + 1 : Math.max(0, c - 1));
    if (params.postId) await likePost(params.postId);
  };

  const handleShare = async () => {
    const caption = post?.caption || params.postCaption || '';
    const handle = post?.authorHandle ? `@${post.authorHandle}` : MY_HANDLE;
    try {
      await Share.share({ message: `${handle} on Brandthread: "${caption}"`, title: 'Share Post' });
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
    router.back();
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

  return (
    <View style={[s.page, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={21} color={FG} />
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{authorName}</Text>
        <TouchableOpacity style={s.iconBtn} onPress={handleShare}>
          <Feather name="send" size={20} color={FG} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {/* Media display */}
        <LinearGradient
          colors={[mediaColor1, mediaColor2] as [string, string]}
          style={s.media}
        >
          <Feather name={typeIcon} size={ICON.xl} color={MUTED} />
        </LinearGradient>

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
            <Feather name="heart" size={22} color={liked ? '#F472B6' : FG} />
            <Text style={[s.engageCount, liked && { color: '#F472B6' }]}>{likeCount}</Text>
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
            onPress={async () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setReposted(prev => !prev);
              // repostPost is a toggle — call it for both directions so both are persisted
              if (params.postId) await repostPost(params.postId);
            }}
          >
            <Feather name="repeat" size={22} color={reposted ? PURPLE : FG} />
          </TouchableOpacity>
          <TouchableOpacity
            style={s.engageBtn}
            onPress={async () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              if (!saved && params.postId) {
                setSaved(true);
                await saveItem({ type: 'post', targetId: params.postId, title: caption || 'Post', accentColor: mediaColor1 });
              }
            }}
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
      </ScrollView>

      {/* Edit caption modal */}
      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => setEditOpen(false)}>
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
              <TouchableOpacity style={s.modalCancel} onPress={() => setEditOpen(false)}>
                <Text style={s.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.modalSave} onPress={handleSaveCaption}>
                <Text style={s.modalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Delete confirm modal */}
      <Modal visible={deleteConfirm} transparent animationType="fade" onRequestClose={() => setDeleteConfirm(false)}>
        <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={() => setDeleteConfirm(false)}>
          <TouchableOpacity activeOpacity={1} style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>Delete post?</Text>
            <Text style={s.modalDesc}>This will permanently remove the post from your profile. This cannot be undone.</Text>
            <View style={s.modalActions}>
              <TouchableOpacity style={s.modalCancel} onPress={() => setDeleteConfirm(false)}>
                <Text style={s.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modalSave, { backgroundColor: RED + '22' }]} onPress={handleDelete}>
                <Text style={[s.modalSaveText, { color: RED }]}>Delete</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: BG },
  header: { height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: FG, fontFamily: FONT.bold, fontSize: FS.md },
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
  commentAvatarText: { fontFamily: FONT.bold, fontSize: 10, color: ON_DARK },
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
  modalCancel: { flex: 1, paddingVertical: 14, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, alignItems: 'center' },
  modalCancelText: { fontFamily: FONT.medium, fontSize: FS.base, color: MUTED },
  modalSave: { flex: 1, paddingVertical: 14, borderRadius: RADIUS.md, backgroundColor: PURPLE, alignItems: 'center' },
  modalSaveText: { fontFamily: FONT.bold, fontSize: FS.base, color: ON_DARK },
});
