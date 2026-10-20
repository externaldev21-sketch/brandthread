import * as Haptics from 'expo-haptics';
/**
 * Buyer Post Viewer — full-screen post detail.
 * Receives lightweight params from the profile grid; loads real engagement
 * from socialService. Owner-only: edit caption (inline modal) and delete.
 */
import { track } from '@/lib/analytics';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';


import { QuotedPostCard } from '@/components/social/QuotedPostCard';

import { View, Text, StyleSheet, TouchableOpacity, TextInput, Animated, useWindowDimensions, Pressable } from 'react-native';


import { LinearGradient } from 'expo-linear-gradient';


import { Icon, type IconName } from '@/components/ui/Icon';

import { Button } from '@/components/ui/Button';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useFocusEffect, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';

import { haptic, hapticFollow, hapticLight } from '@/lib/haptics';
import { getSellerFollowStates, setSellerFollowing, subscribeSocial } from '@/services/socialService';
import { useCommentCountDelta } from '@/lib/commentCountBus';
import { TapHeartBurst } from '@/components/buyer-feed/TapHeartBurst';

import { useVideoPlayer, VideoView } from 'expo-video';

import { useMeaningfulVideoWatch } from '@/hooks/useMeaningfulVideoWatch';

import { useColors } from '@/hooks/useColors';

import { useAppTheme } from '@/contexts/AppThemeContext';

import { CachedImage } from '@/components/CachedImage';

import { BG, SURFACE, CARD, BORDER, FG, MUTED, SUBTLE, ON_DARK, FONT, FS, SP, RADIUS, ICON, OVERLAY, CREATE_CANVAS, RED, COMP } from '@/lib/theme';

import { useExpandFromTileOverlay } from '@/components/ExpandFromTileOverlay';

import { getComments, getMyPosts, getPostById, updatePost, deletePost, MY_USER_ID, MY_COLOR, MY_INITIALS, MY_NAME, MY_HANDLE, mapSlides } from '@/services/socialService';

import type { BuyerPost, Comment, PostSlide } from '@/services/socialTypes';
import { PostCarousel } from '@/components/social/PostCarousel';
import { ParentScrollGestureScope } from '@/components/media/ParentScrollGesture';

import { getPreviewActivityPost } from '@/lib/previewActivity';

import { useAuth } from '@clerk/expo';

import { useApi } from '@/lib/api';
import { useSignInGate } from '@/hooks/useSignInGate';

import { requestContextualPushPermission } from '@/lib/contextualPushPermission';

import { ScreenHeader } from '@/components/ScreenHeader';

import { Sheet } from '@/components/ui/BottomSheet';

import { CaptionSpans } from '@/components/social/CaptionText';

import { PollCard } from '@/components/social/PollCard';
import { Snackbar } from '@/components/ui/Snackbar';
import { PostOwnerSheet } from '@/components/social/PostOwnerSheet';
import { pinPostWithReplacePrompt, unpinPost } from '@/services/postPinService';
import { CaptionsOverlay, type CaptionSegment } from '@/components/social/CaptionsOverlay';

import { useFeatureFlag } from '@/contexts/FeatureFlagContext';

import { useCaptionsPreference, useReadyCaptionTrack } from '@/lib/captions';

import { LocationTag } from '@/components/social/LocationTag';
import { emitSaveHeartEvent } from '@/lib/saved/saveHeartBus';
import { savedPostToast } from '@/lib/saved/savedPostToast';

import { TranslatableCaption } from '@/components/translation/CaptionTranslation';

import { persistPostAction, postActionPending, subscribePostEngagement, type PostAction, type PostEngagementPatch } from '@/lib/postEngagement';
import { RightActionRail } from '@/components/buyer-feed/RightActionRail';
import { ThreadShareSheet } from '@/components/ThreadShareSheet';
import { ThreadCommentsSheet } from './buyer-post-comments';
import { OFFICIAL_AVATAR_SOURCE, isOfficialAccountId } from '@/lib/officialAccount';
import { useReducedMotion } from 'react-native-reanimated';

import { UnavailableScreen, isMissingParam } from '@/components/ui/UnavailableScreen';

import { usePostFits } from '@/components/social/PostFits';

function PostVideo({ uri, onWatched, captions }: { uri: string; onWatched?: () => void; captions?: CaptionSegment[] }) {
  // Starts muted with no player chrome (less-AI pass, item 49); the small
  // speaker button turns sound on, same as PostCarousel.
  const player = useVideoPlayer(uri, p => { p.loop = true; p.muted = true; p.timeUpdateEventInterval = 0.25; });
  const [muted, setMuted] = useState(true);
  useEffect(() => { player.muted = muted; }, [muted, player]);
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
        nativeControls={false}
      />
      {captions ? <CaptionsOverlay segments={captions} currentTime={currentTime} bottomOffset={56} /> : null}
      <Pressable
        onPress={() => setMuted((m) => !m)}
        style={postVideoStyles.mute}
        accessibilityRole="button"
        accessibilityLabel={muted ? 'Unmute' : 'Mute'}
        testID="post-video-mute"
        hitSlop={8}
      >
        <Icon name={muted ? 'volume-x' : 'volume-2'} size={14} color={CREATE_CANVAS.white} />
      </Pressable>
    </>
  );
}

const postVideoStyles = StyleSheet.create({
  mute: { position: 'absolute', right: 10, bottom: 10, width: 28, height: 28, borderRadius: 14, backgroundColor: CREATE_CANVAS.black, alignItems: 'center', justifyContent: 'center' },
});

function PostMedia({
  mediaUrl, type, mediaColor1, mediaColor2, typeIcon, onWatched, captions,
}: {
  mediaUrl?: string; type: BuyerPost['type'];
  mediaColor1: string; mediaColor2: string; typeIcon: IconName;
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
        <Icon name={typeIcon} size={ICON.xl} color={MUTED} />
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
    likesCount: Number(raw.likeCount ?? 0), commentsCount: Number(raw.commentsCount ?? 0), repostsCount: Number(raw.repostCount ?? 0),
    likedByMe: raw.likedByMe === true, savedByMe: raw.savedByMe === true, repostedByMe: raw.repostedByMe === true,
    isArchived: false, isDraft: false,
    pinnedAt: raw.pinnedAt ?? null, location: raw.location ?? undefined, quotedPost: raw.quotedPost ?? undefined,
    createdAt: raw.createdAt, updatedAt: raw.updatedAt ?? raw.createdAt,
  } as BuyerPost;
}

/** Server-only extras the BuyerPost shape doesn't carry. */
type ServerExtras = { saves: number; shares: number; avatarUrl?: string; isOfficial: boolean; authorId?: string; authorAccountType?: string };
function serverExtras(raw: any): ServerExtras {
  return {
    saves: Number(raw?.savesCount ?? 0),
    shares: Number(raw?.sharesCount ?? 0),
    avatarUrl: raw?.seller?.avatarUrl || raw?.seller?.profileImageUrl || undefined,
    isOfficial: raw?.seller?.isOfficial === true || isOfficialAccountId(raw?.userId),
    authorId: raw?.userId,
    authorAccountType: raw?.seller?.accountType,
  };
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const { goToSignIn } = useSignInGate();
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
  // The lookup settled (found or not) — gates the "Post not found" state.
  const [postLoaded, setPostLoaded] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const [ownerSheetOpen, setOwnerSheetOpen] = useState(false);
  const [pinToast, setPinToast] = useState<string | null>(null);
  useEffect(() => {
    if (!pinToast) return;
    const t = setTimeout(() => setPinToast(null), 2500);
    return () => clearTimeout(t);
  }, [pinToast]);
  const togglePin = async () => {
    if (!post || pinBusy) return;
    const wasPinned = !!post.pinnedAt;
    setPinBusy(true);
    try {
      const result = wasPinned ? await unpinPost(post.id) : await pinPostWithReplacePrompt(post.id);
      if (!result) return;
      Haptics.selectionAsync();
      setPost((prev) => (prev ? { ...prev, pinnedAt: wasPinned ? null : (result.pinnedAt ?? new Date().toISOString()) } : prev));
      setPinToast(wasPinned ? 'Post unpinned' : 'Post pinned to your profile');
    } catch {
      setPinToast(wasPinned ? "Couldn't unpin. Try again." : "Couldn't pin. Try again.");
    } finally {
      setPinBusy(false);
    }
  };
  const [comments, setComments] = useState<Comment[]>([]);
  const [eng, setEng] = useState<Required<Omit<PostEngagementPatch, never>>>({
    liked: false, likes: 0, saved: false, saves: 0, reposted: false, reposts: 0, shares: 0,
  });
  const [extras, setExtras] = useState<ServerExtras | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [following, setFollowing] = useState(false);
  const followInFlight = useRef(false);
  const [burstPoint, setBurstPoint] = useState<{ x: number; y: number } | null>(null);
  const mediaTap = useRef<{ time: number; x: number; y: number } | null>(null);
  const zoomActiveRef = useRef(false);
  const zoomEndedAtRef = useRef(0);
  const actionOwner = useRef(userId);
  actionOwner.current = userId;
  const [, bumpPending] = useState(0);
  const reduceMotion = useReducedMotion() ?? false;
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
  // Pinning is checked by the server (owner + published); real posts carry the Clerk id as authorId.
  const canPin = post !== null && !post.isDraft && (isOwner || (!!userId && post.authorId === userId));
  const fits = usePostFits({ postId: params.postId, isOwner });

  const realPostId = params.postId && UUID_RE.test(params.postId) ? params.postId : null;

  const applyPost = useCallback((found: BuyerPost, ex: ServerExtras | null) => {
    setPost(found);
    setExtras(ex);
    setEng({
      liked: found.likedByMe ?? false, likes: found.likesCount ?? 0,
      reposted: found.repostedByMe ?? false, reposts: found.repostsCount ?? 0,
      saved: found.savedByMe ?? false, saves: ex?.saves ?? 0, shares: ex?.shares ?? 0,
    });
  }, []);

  const loadPost = useCallback(async () => {
    let found: BuyerPost | null = null;
    // Real posts: the server is the source of truth, so stale local
    // getMyPosts state can never override fresh engagement.
    if (realPostId) {
      try {
        const raw = await api.posts.get(realPostId);
        const mapped = publicPostToBuyerPost(raw);
        if (mapped) {
          const ex = serverExtras(raw);
          // Owner flag for my own posts: keep the local author identity.
          if (mapped.authorId === userId || mapped.authorId === MY_USER_ID) mapped.authorId = MY_USER_ID;
          track('post_viewed', { post_type: mapped.type });
          applyPost(mapped, ex);
          setEditCaption(mapped.caption);
          setPostLoaded(true);
          return;
        }
      } catch { /* fall through to friend/local lookups */ }
    }
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
      applyPost(found, null);
      setEditCaption(found.caption);
    }
    setPostLoaded(true);
  }, [params.postId, api, realPostId, userId, applyPost]);

  // Load (and reload on every refocus) so returning from another screen
  // shows fresh server engagement.
  const loadPostRef = useRef(loadPost);
  loadPostRef.current = loadPost;
  useFocusEffect(useCallback(() => {
    void loadPostRef.current();
    if (params.postId) {
      getComments(params.postId).then(setComments).catch(() => setComments([]));
    }
  }, [params.postId, userId]));

  // Cross-screen sync: successful writes from the feed/other viewers.
  useEffect(() => {
    if (!userId || !realPostId) return;
    return subscribePostEngagement(userId, (id, patch) => {
      if (id !== realPostId) return;
      setEng((prev) => ({ ...prev, ...patch }));
    });
  }, [userId, realPostId]);

  // One view per open — the same signal the main feed records, so the
  // owner's Content Analytics counts views from every surface.
  useEffect(() => {
    if (userId && realPostId) void api.posts.interact(realPostId, { type: 'view' }).catch(() => {});
  }, [api, userId, realPostId]);

  const engRef = useRef(eng);
  engRef.current = eng;
  const runAction = async (kind: PostAction) => {
    if (!realPostId) return; // preview/demo posts have no server record
    if (!userId) { goToSignIn(); return; }
    if (postActionPending(userId, realPostId, kind)) return;
    const before = engRef.current;
    const enabled = kind === 'like' ? !before.liked : kind === 'save' ? !before.saved : !before.reposted;
    const count = kind === 'like' ? before.likes : kind === 'save' ? before.saves : before.reposts;
    if (enabled && kind === 'like') haptic('like');
    if (enabled && kind === 'save') haptic('save');
    if (enabled && kind === 'repost') hapticLight();
    // Optimistic, rolled back on failure.
    setEng((prev) => ({
      ...prev,
      ...(kind === 'like' ? { liked: enabled, likes: Math.max(0, count + (enabled ? 1 : -1)) }
        : kind === 'save' ? { saved: enabled, saves: Math.max(0, count + (enabled ? 1 : -1)) }
          : { reposted: enabled, reposts: Math.max(0, count + (enabled ? 1 : -1)) }),
    }));
    bumpPending((n) => n + 1);
    try {
      const patch = await persistPostAction({
        api, account: userId, postId: realPostId, kind, enabled, count,
        title: caption || 'Post', accentColor: mediaColor1,
      });
      if (actionOwner.current !== userId) return;
      setEng((prev) => ({ ...prev, ...patch }));
      if (kind === 'save' && enabled) {
        void requestContextualPushPermission(userId, api);
        emitSaveHeartEvent({ type: 'toast', toast: savedPostToast({
          id: realPostId, caption, creator: authorName, accentColor: mediaColor1,
          contentType: postType, mediaUris: post?.mediaUrls?.length ? post.mediaUrls : post?.mediaUrl ? [post.mediaUrl] : [],
        }) });
      }
      if (kind === 'save' && !enabled) setPinToast('Removed from Saved');
      if (kind === 'repost') setPinToast(enabled ? 'Reposted' : 'Repost removed');
    } catch {
      if (actionOwner.current !== userId) return;
      setEng(current => ({ ...current, ...(kind === 'like' ? { liked: before.liked, likes: before.likes }
        : kind === 'save' ? { saved: before.saved, saves: before.saves }
        : { reposted: before.reposted, reposts: before.reposts }) }));
      setPinToast(kind === 'like' ? "Couldn't update like. Try again."
        : kind === 'save' ? (enabled ? "Couldn't save. Try again." : "Couldn't remove from saved. Try again.")
          : "Couldn't update repost. Try again.");
    } finally {
      bumpPending((n) => n + 1);
    }
  };
  const handleLike = () => runAction('like');
  const handleRepost = () => runAction('repost');
  const handleSaveToggle = () => runAction('save');
  const handleShare = () => { haptic('sheet'); setShareOpen(true); };
  const openComments = () => { haptic('sheet'); setCommentsOpen(true); };
  const actionsDisabled = !realPostId;
  const creatorId = extras?.authorId ?? (post?.authorId === MY_USER_ID ? userId : post?.authorId);
  useEffect(() => {
    let active = true;
    setFollowing(false);
    const load = async () => {
      if (!userId || !creatorId || creatorId === userId || followInFlight.current) return;
      try {
        const states = await getSellerFollowStates([creatorId]);
        if (active && actionOwner.current === userId && !followInFlight.current) setFollowing(states.get(creatorId)?.isFollowing ?? false);
      } catch { /* retain the last confirmed state on a read failure */ }
    };
    void load();
    const unsubscribe = subscribeSocial(() => { void load(); });
    return () => { active = false; unsubscribe(); };
  }, [userId, creatorId]);
  const handleFollow = async () => {
    if (!userId) { goToSignIn(); return; }
    if (!creatorId || creatorId === userId || followInFlight.current) return;
    followInFlight.current = true;
    const previous = following;
    setFollowing(!previous);
    hapticFollow(!previous);
    try {
      const result = await setSellerFollowing(creatorId, !previous);
      if (actionOwner.current === userId) setFollowing(result.isFollowing);
    } catch {
      if (actionOwner.current === userId) { setFollowing(previous); setPinToast("Couldn't follow. Try again."); }
    } finally { followInFlight.current = false; }
  };
  const openCreator = () => {
    if (!creatorId) return;
    router.push((extras?.authorAccountType === 'seller'
      ? `/buyer-seller-profile?sellerId=${encodeURIComponent(creatorId)}`
      : `/buyer-profile?userId=${encodeURIComponent(creatorId)}`) as never);
  };
  const onMediaTap = (event: { nativeEvent: { locationX: number; locationY: number } }) => {
    // Zoomed (or just reset by the carousel's own double tap): taps belong to zoom, never like.
    if (zoomActiveRef.current || Date.now() - zoomEndedAtRef.current < 400) { mediaTap.current = null; return; }
    const { locationX: x, locationY: y } = event.nativeEvent;
    const now = Date.now(), previous = mediaTap.current;
    mediaTap.current = { time: now, x, y };
    if (!previous || now - previous.time > 280 || Math.hypot(previous.x - x, previous.y - y) > 30) return;
    mediaTap.current = null;
    if (!userId) { goToSignIn(); return; }
    if (!engRef.current.liked) void handleLike();
    setBurstPoint({ x, y });
  };

  const onCarouselZoomChange = useCallback((zoomed: boolean) => {
    zoomActiveRef.current = zoomed;
    if (!zoomed) zoomEndedAtRef.current = Date.now();
  }, []);

  const handleSaveCaption = async () => {
    if (!post) return;
    await updatePost(post.id, { caption: editCaption });
    setPost(prev => prev ? { ...prev, caption: editCaption } : prev);
    setEditOpen(false);
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
      // Single photos (incl. profile-opened) use the same zoomable pager.
      : post && post.type !== 'video' && post.mediaUrl
        ? [{ kind: 'photo' as const, url: post.mediaUrl }]
        : null;
  const isSinglePhoto = !!viewerSlides && viewerSlides.length === 1 && !(post?.slides && post.slides.length > 0);

  const useRail = postType === 'video' || postType === 'slideshow' || (!!viewerSlides && !isSinglePhoto);
  const isOfficial = extras?.isOfficial ?? isOfficialAccountId(post?.authorId);
  const railPending = (k: PostAction) => !!userId && !!realPostId && postActionPending(userId, realPostId, k);
  const commentDelta = useCommentCountDelta(params.postId ?? '', post?.commentsCount ?? 0);
  const commentCount = Math.max(comments.length, post?.commentsCount ?? 0) + commentDelta;
  const rail = useRail ? (
    <RightActionRail
      creator={authorName}
      hostId={post?.authorId}
      avatarColor={authorColor}
      avatarUri={extras?.avatarUrl}
      avatarSource={isOfficial ? OFFICIAL_AVATAR_SOURCE : undefined}
      initials={authorInitials}
      engagement={{ ...eng, following }}
      commentsCount={commentCount}
      shares={eng.shares}
      saves={eng.saves}
      onOpenCreator={openCreator}
      onFollow={handleFollow}
      isSelf={isOwner}
      isOfficial={isOfficial}
      onLike={() => { if (!railPending('like')) void handleLike(); }}
      onOpenComments={openComments}
      onRepost={() => { if (!railPending('repost')) void handleRepost(); }}
      onSave={() => { if (!railPending('save')) void handleSaveToggle(); }}
      onSaveLongPress={() => {
        if (!post) return;
        const toast = savedPostToast({ id: post.id, caption, creator: authorName, contentType: postType,
          mediaUris: post.mediaUrls ?? (post.mediaUrl ? [post.mediaUrl] : []) });
        if (toast.action?.kind === 'save-to-collection') {
          emitSaveHeartEvent({ type: 'post-sheet', item: toast.action.item, thumbnailUri: toast.thumbnailUri });
        }
      }}
      onShare={handleShare}
      reduceMotion={reduceMotion}
      style={s.rail}
      testIdBase={params.postId ?? 'post'}
    />
  ) : null;

  const typeIcon: IconName =
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

  // No post id, or the lookup settled with nothing and the caller passed no
  // author to show: an honest "Post not found" with the shared header instead
  // of a made-up author ("Jordan") over an empty media box.
  if (isMissingParam(params.postId) || (postLoaded && !post && !params.postAuthorName)) {
    return (
      <UnavailableScreen
        title="Post"
        heading="Post not found"
        message="This post may have been deleted or the link may have expired."
        icon="image"
        testID="buyer-post-viewer-unavailable"
      />
    );
  }

  return (
    <View style={s.page}>
      <ScreenHeader
        title={authorName}
        onBack={() => goBackOr(router)}
        actions={[
          { icon: 'send', onPress: handleShare, accessibilityLabel: 'Share' },
          // Owner ••• sheet (Instagram): Pin to your profile / Unpin from profile.
          ...(canPin || fits.openMenu ? [{
            icon: 'more-horizontal' as const,
            onPress: canPin ? () => setOwnerSheetOpen(true) : fits.openMenu!,
            accessibilityLabel: 'More options',
          }] : []),
        ]}
      />
      {tileExpandOverlay}

      <ParentScrollGestureScope>
      <Animated.ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        style={contentOpacity ? { opacity: contentOpacity } : undefined}
      >
        {/* Media display */}
        {viewerSlides ? (
          <View style={{ backgroundColor: BG }} testID="viewer-carousel">
            <Pressable onPress={onMediaTap} accessible={false}>
              <PostCarousel slides={viewerSlides} width={windowWidth} dotColor={FG} dotDim={MUTED} postId={post?.id} mode="persistent" onZoomChange={onCarouselZoomChange} aspectRatio={post?.aspectRatio} />
              <TapHeartBurst point={burstPoint} reduceMotion={reduceMotion} />
            </Pressable>
            {rail}
          </View>
        ) : (
        <View style={[s.media, postType === 'video' && s.mediaTall]}>
          <Pressable onPress={onMediaTap} style={{ flex: 1 }} accessible={false}>
          <PostMedia
            mediaUrl={post?.mediaUrl}
            type={postType}
            mediaColor1={mediaColor1}
            mediaColor2={mediaColor2}
            typeIcon={typeIcon}
            onWatched={post?.type === 'video' ? handleVideoWatched : undefined}
            captions={overlaySegments}
          />
          <TapHeartBurst point={burstPoint} reduceMotion={reduceMotion} />
          </Pressable>
          {rail}
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
              <Icon name="edit-2" size={16} color={PURPLE} />
              <Text style={s.editBtnText}>Edit caption</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Caption */}
        {caption ? (
          <TranslatableCaption text={caption} style={s.caption} linkStyle={s.translationLink} renderText={(value) => <CaptionSpans text={value} />} />
        ) : null}

        {/* Thread poll (only present when the post has one — no layout change otherwise) */}
        {post?.id ? <PollCard postId={post.id} style={{ paddingHorizontal: SP.md, paddingTop: SP.sm }} /> : null}

        {/* Quoted original (only present on quote reposts — no layout change otherwise) */}
        {post?.quotedPost ? (
          <View style={{ paddingHorizontal: SP.md, paddingTop: SP.sm }}>
            <QuotedPostCard
              quotedPost={post.quotedPost}
              onPress={(id) => router.push(`/buyer-post-viewer?postId=${encodeURIComponent(id)}` as never)}
            />
          </View>
        ) : null}

        {fits.info}

        {post?.location ? (
          <LocationTag location={post.location} style={{ marginHorizontal: SP.md, marginTop: SP.sm }} />
        ) : null}

        {/* Timestamp */}
        {post?.createdAt ? (
          <Text style={s.timestamp}>
            {new Date(post.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
          </Text>
        ) : null}

        {/* Engagement bar — photo posts; video/slideshow use the rail above. */}
        <View style={s.engagementBar}>
          {!useRail ? (
            <>
              <TouchableOpacity style={s.engageBtn} onPress={() => { void handleLike(); }} disabled={actionsDisabled}
                accessibilityRole="button" accessibilityLabel={`${eng.liked ? 'Unlike' : 'Like'}, ${eng.likes} likes`} accessibilityState={{ checked: eng.liked, disabled: actionsDisabled }} testID="viewer-like">
                <Icon name="heart" size={22} color={eng.liked ? RED : FG} />
                <Text style={[s.engageCount, eng.liked && { color: RED }]}>{eng.likes}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.engageBtn} onPress={openComments} accessibilityRole="button" accessibilityLabel={`Comments, ${commentCount}`} testID="viewer-comments">
                <Icon name="message-circle" size={22} color={FG} />
                <Text style={s.engageCount}>{commentCount}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.engageBtn} onPress={() => { void handleRepost(); }} disabled={actionsDisabled}
                accessibilityRole="button" accessibilityLabel={eng.reposted ? 'Remove repost' : 'Repost'} accessibilityState={{ checked: eng.reposted, disabled: actionsDisabled }} testID="viewer-repost">
                <Icon name="repeat" size={22} color={eng.reposted ? PURPLE : FG} />
              </TouchableOpacity>
              <TouchableOpacity style={s.engageBtn} onPress={() => { void handleSaveToggle(); }} disabled={actionsDisabled}
                accessibilityRole="button" accessibilityLabel={eng.saved ? 'Unsave post' : 'Save post'} accessibilityState={{ checked: eng.saved, disabled: actionsDisabled }} testID="viewer-save">
                <Icon name="bookmark" size={22} color={eng.saved ? PURPLE : FG} />
              </TouchableOpacity>
            </>
          ) : null}
          {captionTrack ? (
            <TouchableOpacity
              style={s.engageBtn}
              onPress={() => {  setCaptionsOn(!captionsOn); }}
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
            <TouchableOpacity
              style={s.engageBtn}
              onPress={() => {
                router.push(`/buyer-report?targetType=post&targetId=${params.postId ?? ''}&targetLabel=${encodeURIComponent(caption || 'Post')}&targetUserId=${post?.authorId ?? ''}` as never);
              }}
              accessibilityLabel="Report post"
            >
              <Icon name="flag" size={22} color={FG} />
            </TouchableOpacity>
          )}
          {!useRail ? (
            <TouchableOpacity style={s.engageBtn} onPress={handleShare} accessibilityRole="button" accessibilityLabel="Share post" testID="viewer-share">
              <Icon name="share-2" size={22} color={FG} />
            </TouchableOpacity>
          ) : null}
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
              <Icon name="type" size={16} color={FG} />
              <Text style={s.captionsBtnText}>{captionTrack ? 'Edit captions' : 'Generate captions'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Owner-only danger zone */}
        {isOwner && (
          <View style={{ paddingHorizontal: SP.md, marginTop: SP.lg }}>
            <TouchableOpacity
              style={s.deleteBtn}
              onPress={() => { haptic('sheet'); setDeleteConfirm(true); }}
            >
              <Icon name="trash-2" size={16} color={RED} />
              <Text style={s.deleteBtnText}>Delete post</Text>
            </TouchableOpacity>
          </View>
        )}
      </Animated.ScrollView>
      </ParentScrollGestureScope>

      {/* Edit caption sheet */}
      <Sheet
        visible={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit caption"
        testID="post-edit-caption-sheet"
        primaryAction={{ label: 'Save', onPress: () => { void handleSaveCaption(); } }}
      >
        <TextInput
          style={s.captionInput}
          value={editCaption}
          onChangeText={setEditCaption}
          placeholder="Write a caption…"
          placeholderTextColor={SUBTLE}
          multiline
          autoFocus
        />
      </Sheet>

      {/* Delete confirm sheet */}
      <Sheet
        visible={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        title="Delete post?"
        testID="post-delete-sheet"
        primaryAction={{ label: 'Delete', variant: 'destructive', onPress: () => { void handleDelete(); } }}
        secondaryAction={{ label: 'Cancel', onPress: () => setDeleteConfirm(false) }}
      >
        <Text style={s.modalDesc}>This will permanently remove the post from your profile. This cannot be undone.</Text>
      </Sheet>
      <PostOwnerSheet visible={ownerSheetOpen} onClose={() => setOwnerSheetOpen(false)} pinned={!!post?.pinnedAt} onTogglePin={() => { void togglePin(); }} onFitsOptions={fits.openMenu} />
      <ThreadCommentsSheet
        visible={commentsOpen}
        postId={params.postId ?? ''}
        postAuthorId={post?.authorId}
        postAuthorName={authorName}
        postCaption={caption}
        onClose={() => setCommentsOpen(false)}
      />
      {post ? (
        <ThreadShareSheet
          visible={shareOpen}
          postId={post.id}
          creator={authorName}
          caption={caption}
          mediaUri={post.mediaUrl}
          isVideo={postType === 'video'}
          shareCount={eng.shares}
          reposted={!!eng.reposted}
          onRepost={handleRepost}
          onClose={() => setShareOpen(false)}
          onReport={() => {
            setShareOpen(false);
            router.push(`/buyer-report?targetType=post&targetId=${post.id}&targetLabel=${encodeURIComponent(caption || 'Post')}&targetUserId=${post.authorId ?? ''}` as never);
          }}
          onNotInterested={() => {
            if (!userId || !post) { setPinToast('Sign in to customize your feed.'); return; }
            const owner = userId;
            void api.posts.interact(post.id, { type: 'not_interested', value: 'video' }).then(() => {
              if (actionOwner.current === owner) {
                setShareOpen(false);
                setPinToast('Post hidden');
                router.back();
              }
            }).catch(() => {
              if (actionOwner.current === owner) setPinToast('Could not update your feed. Try again.');
            });
          }}
          onFeedback={(message) => setPinToast(message)}
        />
      ) : null}
      <Snackbar visible={!!pinToast} message={pinToast ?? ''} onDismiss={() => setPinToast(null)} />
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
  mediaTall: { aspectRatio: 9 / 16, backgroundColor: '#000' },
  rail: { right: 10, bottom: 56 },
  authorRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingTop: SP.md, gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: FONT.bold, fontSize: FS.sm, color: ON_DARK },
  authorName: { fontFamily: FONT.semibold, fontSize: FS.base, color: FG },
  authorHandle: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: SP.sm, paddingVertical: 6, borderRadius: RADIUS.sm, backgroundColor: PURPLE_DIM },
  editBtnText: { fontFamily: FONT.medium, fontSize: FS.xs, color: PURPLE },
  caption: { paddingHorizontal: SP.md, paddingTop: SP.sm, fontFamily: FONT.regular, fontSize: FS.base, color: FG, lineHeight: 22 },
  translationLink: { paddingHorizontal: SP.md, color: MUTED },
  timestamp: { paddingHorizontal: SP.md, paddingTop: SP.xs, fontFamily: FONT.regular, fontSize: FS.xs, color: SUBTLE },
  engagementBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingTop: SP.md, gap: SP.sm },
  engageBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: SP.xs },
  engageCount: { fontFamily: FONT.medium, fontSize: FS.sm, color: FG, fontVariant: ['tabular-nums'] },
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
  modalDesc: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, lineHeight: 20, marginBottom: SP.md },
  captionInput: { borderWidth: 1, borderColor: BORDER_ACTIVE, borderRadius: RADIUS.md, padding: SP.md, color: FG, fontFamily: FONT.regular, fontSize: FS.base, minHeight: 100, textAlignVertical: 'top', marginBottom: SP.md },
  });
};
