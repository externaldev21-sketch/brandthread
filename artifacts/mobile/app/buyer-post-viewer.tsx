/**
 * Buyer Post Viewer — full-screen post detail.
 * Receives lightweight params from the profile grid; loads real engagement
 * from socialService. Owner-only: edit caption (inline modal) and delete.
 */
import { track } from '@/lib/analytics';
import React, { useState, useEffect, useCallback } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { buildPostUrl } from '@/lib/shareLinks';
import { QuotedPostCard } from '@/components/social/QuotedPostCard';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Modal, Share, Animated, useWindowDimensions, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { haptics } from '@/lib/haptics';
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
import type { BuyerPost, Comment, PostSlide } from '@/services/socialTypes';
import { mapSlides } from '@/services/socialService';
import { PostCarousel } from '@/components/social/PostCarousel';
import { getPreviewActivityPost } from '@/lib/previewActivity';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/lib/api';
import { requestContextualPushPermission } from '@/lib/contextualPushPermission';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ModalSafeArea } from '@/components/ModalSafeArea';
import { CaptionSpans } from '@/components/social/CaptionText';
import { CaptionsOverlay, type CaptionSegment } from '@/components/social/CaptionsOverlay';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { useCaptionsPreference, useReadyCaptionTrack } from '@/lib/captions';
import { LocationTag } from '@/components/social/LocationTag';

function PostVideo({ uri, onWatched, captions }: { uri: string; onWatched?: () => void; captions?: CaptionSegment[] }) {
  const player = useVideoPlayer(uri, p => { p.loop = true; p.muted = false; p.timeUpdateEventInterval = 0.25; });
  const [currentTime, setCurrentTime] = useState(0);
  useEffect(() => {
    if (!captions) return;
    const sub = player.addListener('timeUpdate', (e: { currentTime: number }) => setCurrentTime(e.currentTime));
    return () => sub.remove();
  }, [player, captions]);
  const isFocused = useIsFocused();
  useMeaningfulVideoWatch(player, isFocused, onWatched);
  useEffect(() => {
    player.play();
    return () => { player.pause(); };
  }, [player]);
  return (
    <>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls
      />
      {captions ? <CaptionsOverlay segments={captions} currentTime={currentTime} bottomOffset={56} /> : null}
    </>
  );
}

function PostMedia({
  mediaUrl, type, mediaColor1, mediaColor2, typeIcon, onWatched, captions,
}: {
  mediaUrl?: string; type: BuyerPost['type'];
  mediaColor1: string; mediaColor2: string; typeIcon: keyof typeof Feather.glyphMap;
  onWatched?: () => void;
  captions?: CaptionSegment[];
}) {
  if (mediaUrl && type === 'video') {
    return <PostVideo uri={mediaUrl} onWatched={onWatched} captions={captions} />;
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

/** Public /api/posts/:id payload to the viewer's BuyerPost shape (display only). */
function publicPostToBuyerPost(raw: any): BuyerPost | null {
  if (!raw?.id) return null;
  const name = raw.seller?.brandName || raw.seller?.displayName || 'Brandthread member';
  const parts = String(name).trim().split(/\s+/);
  const isVideo = raw.mediaType === 'video';
  return {
    id: raw.id, authorId: raw.userId, authorName: name, authorHandle: '',
    authorInitials: (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : String(name).slice(0, 2)).toUpperCase(),
    authorColor: MY_COLOR, authorAccountType: 'buyer', feedEligibility: 'profile_only', profileVisibility: 'public',
    type: isVideo ? 'video' : raw.mediaType === 'slideshow' ? 'slideshow' : 'photo',
    caption: raw.caption ?? '', hashtags: raw.hashtags ?? [], mediaColors: [],
    mediaUrl: isVideo ? raw.mediaUrl : (raw.mediaUrls?.[0] || raw.mediaUrl || undefined),
    mediaUrls: Array.isArray(raw.mediaUrls) ? raw.mediaUrls : [],
    slides: mapSlides(raw.slides),
    aspectRatio: raw.aspectRatio,
    likesCount: Number(raw.likeCount ?? 0), commentsCount: 0, repostsCount: Number(raw.repostCount ?? 0),
    likedByMe: false, savedByMe: false, repostedByMe: false, isArchived: false, isDraft: false,
    createdAt: raw.createdAt, updatedAt: raw.updatedAt ?? raw.createdAt,
  };
}

/** Seller POSTs (and any post the buyer-social route doesn't cover) via the public post route. */
async function loadPublicPost(api: ReturnType<typeof useApi>, id: string): Promise<BuyerPost | null> {
  try {
    const p: any = await api.posts.get(id);
    if (!p?.id) return null;
    const name = p.seller?.brandName ?? p.seller?.displayName ?? 'Post';
    const urls: string[] = Array.isArray(p.mediaUrls) ? p.mediaUrls : [];
    return {
      id: p.id, authorId: p.userId, authorName: name, authorHandle: '', authorInitials: String(name).slice(0, 2).toUpperCase(),
      authorColor: '#1C1C1E', authorAccountType: 'buyer', feedEligibility: 'profile_only', profileVisibility: 'public' as any,
      type: p.mediaType ?? 'photo', caption: p.caption ?? '', hashtags: p.hashtags ?? [], mediaColors: [],
      mediaUrl: p.mediaUrl, mediaUrls: urls, slides: mapSlides(p.slides), aspectRatio: p.aspectRatio,
      likesCount: p.likeCount ?? 0, commentsCount: 0, repostsCount: p.repostCount ?? 0,
      likedByMe: false, savedByMe: false, repostedByMe: false, isArchived: false, isDraft: false,
      createdAt: p.createdAt, updatedAt: p.updatedAt ?? p.createdAt,
    };
  } catch { return null; }
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
  const captionsFlag = useFeatureFlag('autoCaptions');
  const [captionsOn, setCaptionsOn] = useCaptionsPreference();
  const fetchCaptionTracks = useCallback((id: string) => api.posts.captions(id) as Promise<{ tracks: import('@/lib/captions').CaptionTrack[] }>, [api]);
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
      found = all.find(p => p.id === params.postId) ?? await getPostById(params.postId) ?? await loadPublicPost(api, params.postId);
    } catch {
      // A failed lookup leaves the placeholder, as before — or, in the
      // preview, falls through to the seeded post below.
    }
    // Public posts opened from a hashtag page belong to people I may not be
    // friends with, so the friends-only lookups above return nothing.
    if (!found && params.postId && !params.postId.startsWith('preview-') && !getPreviewActivityPost(params.postId)) {
      try { found = publicPostToBuyerPost(await api.posts.get(params.postId)); } catch { /* keep placeholder */ }
    }
    found = found ?? previewPost(params.postId);
    if (found) {
      track('post_viewed', { post_type: found.type });
      setPost(found);
      setLiked(found.likedByMe ?? false);
      setLikeCount(found.likesCount ?? 0);
      setReposted(found.repostedByMe ?? false);
      setSaved(found.savedByMe ?? false);
      setEditCaption(found.caption);
    }
  }, [params.postId, api]);

  useEffect(() => {
    loadPost();
    if (params.postId) {
      getComments(params.postId).then(setComments).catch(() => setComments([]));
    }
  }, [loadPost, params.postId]);

  const handleLike = async () => {
    haptics.light();
    const newLiked = !liked;
    setLiked(newLiked);
    setLikeCount(c => newLiked ? c + 1 : Math.max(0, c - 1));
    if (params.postId) await likePost(params.postId);
  };

  const handleShare = async () => {
    const caption = post?.caption || params.postCaption || '';
    const handle = post?.authorHandle ? `@${post.authorHandle}` : MY_HANDLE;
    try {
      const link = post?.id ? buildPostUrl(post.id) : null;
      const message = `${handle} on Brandthread: "${caption}"`;
      await Share.share(link
        ? { message: Platform.OS === 'ios' ? message : `${message} ${link}`, url: link, title: 'Share Post' }
        : { message, title: 'Share Post' });
    } catch {}
  };

  const handleSaveCaption = async () => {
    if (!post) return;
    await updatePost(post.id, { caption: editCaption });
    setPost(prev => prev ? { ...prev, caption: editCaption } : prev);
    setEditOpen(false);
    haptics.success();
  };

  const handleDelete = async () => {
    if (!post) return;
    await deletePost(post.id);
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

  // POST carousels (and any multi-photo post) render as a 3:4 swipeable carousel.
  const viewerSlides: PostSlide[] | null = post?.slides && post.slides.length > 0
    ? post.slides
    : post && post.mediaUrls && post.mediaUrls.length > 1 && post.type !== 'video'
      ? post.mediaUrls.map((url) => ({ kind: 'photo' as const, url }))
      : null;

  const typeIcon: keyof typeof Feather.glyphMap =
    postType === 'photo' ? 'image' : postType === 'slideshow' ? 'layers' : 'video';

  const captionTrack = useReadyCaptionTrack(params.postId, postType === 'video', captionsFlag, fetchCaptionTracks);
  const overlaySegments = captionTrack && captionsOn ? captionTrack.segments : undefined;

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
        {viewerSlides ? (
          <View style={{ backgroundColor: BG }} testID="viewer-carousel">
            <PostCarousel slides={viewerSlides} width={windowWidth} dotColor={FG} dotDim={MUTED} />
          </View>
        ) : (
        <View style={s.media}>
          <PostMedia
            mediaUrl={post?.mediaUrl}
            type={postType}
            mediaColor1={mediaColor1}
            mediaColor2={mediaColor2}
            typeIcon={typeIcon}
            onWatched={post?.type === 'video' ? handleVideoWatched : undefined}
            captions={overlaySegments}
          />
        </View>
        )}

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
          <Text style={s.caption}><CaptionSpans text={caption} /></Text>
        ) : null}

        {/* Quoted original (only present on quote reposts — no layout change otherwise) */}
        {post?.quotedPost ? (
          <View style={{ paddingHorizontal: SP.md, paddingTop: SP.sm }}>
            <QuotedPostCard
              quotedPost={post.quotedPost}
              onPress={(id) => router.push(`/buyer-post-viewer?postId=${encodeURIComponent(id)}` as never)}
            />
          </View>
        ) : null}

        {post?.location ? (
          <LocationTag location={post.location} style={{ marginHorizontal: SP.md, marginTop: SP.sm }} />
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
          <TouchableOpacity accessibilityLabel="Repost" accessibilityRole="button"
            style={s.engageBtn}
            onPress={async () => {
              haptics.light();
              setReposted(prev => !prev);
              // repostPost is a toggle — call it for both directions so both are persisted
              if (params.postId) await repostPost(params.postId);
            }}
          >
            <Feather name="repeat" size={22} color={reposted ? PURPLE : FG} />
          </TouchableOpacity>
          <TouchableOpacity accessibilityLabel="Save post" accessibilityRole="button"
            style={s.engageBtn}
            onPress={async () => {
              haptics.light();
              if (!saved && params.postId) {
                setSaved(true);
                await saveItem(
                  { type: 'post', targetId: params.postId, title: caption || 'Post', accentColor: mediaColor1 },
                  { onRemoteSaved: () => { void requestContextualPushPermission(userId, api); } },
                );
              }
            }}
          >
            <Feather name="bookmark" size={22} color={saved ? PURPLE : FG} />
          </TouchableOpacity>
          {captionTrack ? (
            <TouchableOpacity
              style={s.engageBtn}
              onPress={() => { haptics.selection(); setCaptionsOn(!captionsOn); }}
              accessibilityRole="button"
              accessibilityLabel={captionsOn ? 'Turn captions off' : 'Turn captions on'}
              accessibilityState={{ selected: captionsOn }}
              testID="captions-toggle"
            >
              <Text style={{ fontFamily: FONT.bold, fontSize: FS.base, color: captionsOn ? FG : MUTED }}>CC</Text>
            </TouchableOpacity>
          ) : null}
          <View style={{ flex: 1 }} />
          {!isOwner && (
            <TouchableOpacity accessibilityLabel="Report post" accessibilityRole="button"
              style={s.engageBtn}
              onPress={() => {
                router.push(`/buyer-report?targetType=post&targetId=${params.postId ?? ''}&targetLabel=${encodeURIComponent(caption || 'Post')}&targetUserId=${post?.authorId ?? ''}` as never);
              }}
            >
              <Feather name="flag" size={22} color={FG} />
            </TouchableOpacity>
          )}
          <TouchableOpacity accessibilityLabel="Share post" accessibilityRole="button" style={s.engageBtn} onPress={handleShare}>
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

        {/* Owner-only captions (video posts, flag on) */}
        {isOwner && postType === 'video' && captionsFlag ? (
          <View style={{ paddingHorizontal: SP.md, marginTop: SP.lg }}>
            <TouchableOpacity
              style={s.captionsBtn}
              onPress={() => { router.push(`/post-captions-edit?postId=${encodeURIComponent(params.postId ?? '')}` as never); }}
              accessibilityRole="button"
              testID="edit-captions"
            >
              <Feather name="type" size={16} color={FG} />
              <Text style={s.captionsBtnText}>{captionTrack ? 'Edit captions' : 'Generate captions'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Owner-only danger zone */}
        {isOwner && (
          <View style={{ paddingHorizontal: SP.md, marginTop: SP.lg }}>
            <TouchableOpacity
              style={s.deleteBtn}
              onPress={() => setDeleteConfirm(true)}
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
  captionsBtn: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, padding: SP.md, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, justifyContent: 'center' },
  captionsBtnText: { fontFamily: FONT.medium, fontSize: FS.base, color: FG },
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
