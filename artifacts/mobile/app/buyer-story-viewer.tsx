import React, { useState, useEffect, useRef, useCallback } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, Pressable, TextInput, Animated, Easing,
  Dimensions, PanResponder, StyleSheet, Alert, Modal, FlatList,
  Linking, Platform, Share,
} from 'react-native';
import { CachedImage } from '@/components/CachedImage';
import { prefetchImage } from '@/lib/prefetch';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, FontAwesome } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useColors } from '@/hooks/useColors';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useAppTheme, getOnAccentTextStyle } from '@/contexts/AppThemeContext';
import {
  BG, SURFACE, CARD, CARD_ELEVATED, BORDER,
  FG, MUTED, SUBTLE, ON_DARK,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { AppleEmoji } from '@/components/ui/AppleEmoji';
import { hapticLight, hapticSuccessAction } from '@/lib/haptics';
import { PressableScale } from '@/components/BrandthreadUI';
import { IconButton } from '@/components/ui';
import { ModalSafeArea } from '@/components/ModalSafeArea';
import {
  getStories, trackStoryView, subscribeSocial, muteUser, createOrGetConversation, sendMessage,
  MY_USER_ID, MY_NAME, MY_HANDLE, MY_INITIALS, MY_COLOR,
} from '@/services/socialService';
import {
  isPreviewInboxEnabled, getOrCreatePreviewConversationForAuthor, appendPreviewMessage, touchPreviewConversation,
} from '@/lib/previewInbox';
import { getPreviewActivityStory } from '@/lib/previewActivity';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { PREVIEW_HIGHLIGHT_ID, previewHighlightStories } from '@/lib/previewHighlights';
import { useAuth } from '@clerk/expo';
import { confirmBlock, reportHref } from '@/lib/safety';
import type { Story, StoryMedia, MessageAttachment } from '@/services/socialTypes';
import { useApi } from '@/lib/api';
import StoryGestureGuide from '@/components/social/StoryGestureGuide';
import { shouldShowStoryGestureGuide } from '@/lib/storyGestureGuideStorage';
import {
  ViewerMentionStickers, ViewerReshareCard, MentionPopover, TaggedPeopleSheet, type MentionTap,
} from '@/components/StoryMentionViewerParts';
import { taggedPeople, mentionProfileHref, type TaggedPerson } from '@/lib/storyMentionSticker';
import { reshareGradientFromBackground } from '@/lib/storyReshare';
import { advance as navAdvance, retreat as navRetreat, nextUser as navNextUser, prevUser as navPrevUser, classifyGesture } from '@/lib/storyViewerNav';

const { width: W, height: H } = Dimensions.get('window');

// Mirrors Instagram's own quick-reaction row (Mobbin: Instagram iOS story
// viewer reply screen) — same 8 emoji, in the same order: laughing-crying,
// heart-eyes, open-mouth, clap, fire, party, crying, 100. Rendered via
// <AppleEmoji> for consistent art across platforms (see that component for
// why). Emoji carry their own inherent color — not a themed accent — so
// they're exempt from the monochrome rule.
const QUICK_REACTIONS = ['😂', '😍', '😮', '👏', '🔥', '🎉', '😢', '💯'];

// Preview/demo mode (?bt_preview=buyer) has no reachable backend to answer
// api.social.storyViewers() for "my" story — reuses the same 3 seeded
// people lib/previewInboxData.ts's follow notifications already use, so
// the "Seen by" row has real-looking, consistent stacked avatars instead
// of rendering empty.
const PREVIEW_STORY_VIEWERS = [
  { userId: 'preview-seller-01', name: 'Atelier Noire', handle: '@atelier_noire', avatarUrl: null, viewedAt: new Date(Date.now() - 8 * 60_000).toISOString() },
  { userId: 'preview-seller-04', name: 'Orison', handle: '@orison', avatarUrl: null, viewedAt: new Date(Date.now() - 40 * 60_000).toISOString() },
  { userId: 'preview-seller-07', name: 'Astrae', handle: '@astrae', avatarUrl: null, viewedAt: new Date(Date.now() - 90 * 60_000).toISOString() },
];

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function StorySlideVideo({ uri, paused }: { uri: string; paused: boolean }) {
  const player = useVideoPlayer(uri, p => { p.loop = true; p.muted = false; });
  useEffect(() => {
    if (paused) player.pause();
    else player.play();
  }, [paused, player]);
  useEffect(() => () => { player.pause(); }, [player]);
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
    />
  );
}

/**
 * Preview only: the viewer's own seeded story or highlight an Activity row
 * points at (item 82), used when the real lookup finds nothing. Kept open
 * (highlights don't expire). `null` for every id outside the preview seed.
 */
function previewStory(id: string): Story | null {
  const seed = getPreviewActivityStory(id);
  if (!seed) return null;
  return {
    id: seed.id, authorId: MY_USER_ID, authorName: MY_NAME, authorHandle: MY_HANDLE,
    authorInitials: MY_INITIALS, authorColor: MY_COLOR, authorAccountType: 'buyer',
    media: [{ id: `${seed.id}-slide`, type: 'photo', backgroundColor: '#000000', duration: 5, imageUri: seed.imageUri }],
    privacy: { visibility: 'public', replyPermission: 'everyone', hiddenFromUserIds: [], closeFriendsOnly: false },
    viewers: [], repliesDisabled: false,
    createdAt: seed.createdAt, expiresAt: Date.now() + 24 * 60 * 60_000,
    likesCount: seed.likesCount,
  } as Story;
}

export default function BuyerStoryViewer() {
  const colors = useColors();
  const { theme } = useAppTheme();
  const PURPLE = colors.primary, PURPLE_DIM = colors.accent;
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const headerTopInset = useHeaderTopInset();
  const router = useRouter();
  const { storyId, allStoryIds, highlightId } = useLocalSearchParams<{ storyId: string; allStoryIds: string; highlightId?: string }>();
  // A profile highlight: its saved stories come from /highlights/:id and have no like / reply / view tracking.
  const isHighlight = !!highlightId;

  const api = useApi();
  const { userId: myUserId } = useAuth();

  const [stories, setStories] = useState<Story[]>([]);
  const [storyIdx, setStoryIdx] = useState(0);
  const [slideIdx, setSlideIdx] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isLongPressing, setIsLongPressing] = useState(false);
  const [inputText, setInputText] = useState('');
  const [replyFocused, setReplyFocused] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [viewerModalVisible, setViewerModalVisible] = useState(false);
  // Like state keyed by storyId
  const [likedSet, setLikedSet] = useState<Set<string>>(new Set());
  const [likesCounts, setLikesCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showGestureGuide, setShowGestureGuide] = useState(false);
  // Mention popover ("View profile") and the tagged-people sheet; playback is held while either is open.
  const [mentionTap, setMentionTap] = useState<MentionTap | null>(null);
  const [taggedSheetOpen, setTaggedSheetOpen] = useState(false);
  const overlayPaused = !!mentionTap || taggedSheetOpen;
  const [serverViewers, setServerViewers] = useState<Array<{ userId: string; name: string; handle: string; avatarUrl: string | null; viewedAt: string }>>([]);
  const [viewersLoading, setViewersLoading] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);
  const loadGeneration = useRef(0);
  // Blurring the reply input (e.g. web's mousedown-fires-blur-before-click)
  // would otherwise unmount the quick-reaction row before a tap on one of
  // its emoji finishes registering — a real dropped-tap bug, not just a
  // sandbox artifact. Delaying the hide lets an in-flight press land first;
  // refocusing (tapping back into the input) cancels the pending hide.
  const replyBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Same pop used by the live-stream like button (components/live/LiveOverlays.tsx)
  // — scale down then settle back with a timing ease, no spring/bounce.
  const heartPop = useRef(new Animated.Value(1)).current;

  const progress = useRef(new Animated.Value(0)).current;
  const ids = allStoryIds ? allStoryIds.split(',').filter(Boolean) : storyId ? [storyId] : [];

  const currentStory: Story | undefined = stories[storyIdx];
  const currentSlide: StoryMedia | undefined = currentStory?.media[slideIdx];

  const loadStories = useCallback(async () => {
    const generation = ++loadGeneration.current;
    if (highlightId) {
      // Demo preview only: the seeded highlight has no backend to answer.
      if (isPreviewDemoMode() && highlightId === PREVIEW_HIGHLIGHT_ID) {
        setStories(previewHighlightStories());
        setStoryIdx(0);
        setLoading(false);
        return;
      }
      try {
        const hl = await api.social.highlight(String(highlightId));
        if (loadGeneration.current !== generation) return;
        setStories((hl.stories ?? []) as Story[]);
        setStoryIdx(0);
      } catch {
        if (loadGeneration.current === generation) setStories([]);
      } finally {
        if (loadGeneration.current === generation) setLoading(false);
      }
      return;
    }
    try {
      const all = await getStories().catch(() => [] as Story[]);
      if (loadGeneration.current !== generation) return;
      const now = Date.now();
      const found = ids
        .map(id => all.find(s => s.id === id))
        .filter((s): s is Story => !!s && s.expiresAt > now);
      // Preview only: seeded stories the Activity rows point at (item 82).
      let filtered = found.length > 0
        ? found
        : ids.map(previewStory).filter((s): s is Story => !!s);
      // A story that isn't in my own feed cache (e.g. the original behind a
      // reshare credit, or a story I was tagged in) is fetched by id — signed in only.
      if (filtered.length === 0 && myUserId) {
        const fetched = await Promise.all(ids.map((id) => api.social.storyById(id).catch(() => null)));
        if (loadGeneration.current !== generation) return;
        filtered = fetched.filter((st): st is Story => !!st && st.expiresAt > now);
      }
      setStories(filtered);
      if (storyId) {
        const idx = filtered.findIndex(s => s.id === storyId);
        if (idx >= 0) setStoryIdx(idx);
      }
    } catch {
    } finally {
      if (loadGeneration.current === generation) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStories();
    if (storyId && !highlightId) {
      trackStoryView(storyId).catch(() => {});
      // Also record view server-side (fire-and-forget)
      api.social.viewStory(storyId).catch(() => {});
    }
    if (myUserId) {
      shouldShowStoryGestureGuide(myUserId).then(show => { if (show) setShowGestureGuide(true); });
    }
  }, []);

  // Seed like state from server story data
  useEffect(() => {
    if (!stories.length) return;
    const serverCounts: Record<string, number> = {};
    const serverLiked  = new Set<string>();
    stories.forEach(s => {
      serverCounts[s.id] = (s as any).likesCount ?? 0;
      if ((s as any).likedByMe) serverLiked.add(s.id);
    });
    setLikesCounts(prev => ({ ...serverCounts, ...prev }));
    setLikedSet(prev => {
      const next = new Set(prev);
      serverLiked.forEach(id => next.add(id));
      return next;
    });
  }, [stories]);

  // Prefetches viewers for a story I posted, so the bottom-left "Seen by"
  // row has real stacked avatars immediately instead of only after tapping
  // into the full viewers sheet.
  useEffect(() => {
    const isMine = (!!myUserId && currentStory?.authorId === myUserId) || currentStory?.authorId === 'me';
    if (!currentStory || !isMine || isHighlight) return;
    let cancelled = false;
    setViewersLoading(true);
    api.social.storyViewers(currentStory.id)
      .then(rows => { if (!cancelled) setServerViewers(rows.length ? rows : (!myUserId ? PREVIEW_STORY_VIEWERS : [])); })
      .catch(() => { if (!cancelled) setServerViewers(!myUserId ? PREVIEW_STORY_VIEWERS : []); })
      .finally(() => { if (!cancelled) setViewersLoading(false); });
    return () => { cancelled = true; };
  }, [currentStory?.id, myUserId]);

  const handleLike = async () => {
    if (!currentStory) return;
    const sid = currentStory.id;
    const wasLiked = likedSet.has(sid);
    if (!wasLiked) {
      heartPop.setValue(0.75);
      Animated.timing(heartPop, { toValue: 1, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
    // Optimistic update
    setLikedSet(prev => { const n = new Set(prev); wasLiked ? n.delete(sid) : n.add(sid); return n; });
    setLikesCounts(prev => ({ ...prev, [sid]: Math.max(0, (prev[sid] ?? 0) + (wasLiked ? -1 : 1)) }));
    try {
      const res = await api.social.likeStory(sid);
      setLikesCounts(prev => ({ ...prev, [sid]: res.likesCount }));
      setLikedSet(prev => { const n = new Set(prev); res.liked ? n.add(sid) : n.delete(sid); return n; });
    } catch {
      setLikedSet(prev => { const n = new Set(prev); wasLiked ? n.add(sid) : n.delete(sid); return n; });
      setLikesCounts(prev => ({ ...prev, [sid]: Math.max(0, (prev[sid] ?? 0) + (wasLiked ? 1 : -1)) }));
      Alert.alert('Could not update like', 'Try again.');
    }
  };

  useEffect(() => {
    const unsub = subscribeSocial(() => { if (!highlightId) loadStories(); });
    return unsub;
  }, []);

  const handleSendReply = async (override?: string) => {
    const text = (override ?? inputText).trim();
    if (!text || sendingReply || !currentStory) return;
    setSendingReply(true);
    // Every reply (typed or a tapped quick-reaction) carries the replied-to
    // slide as a thumbnail, IG style — see buyer-conversation.tsx's
    // 'story_reply' attachment card.
    const attachment: MessageAttachment = {
      type: 'story_reply',
      uri: currentSlide?.imageUri,
      title: 'Replied to your story',
      meta: { storyId: currentStory.id },
    };
    try {
      if (!myUserId && isPreviewInboxEnabled()) {
        // Preview/demo mode has no reachable backend — land the reply in
        // the same seeded local inbox app/(buyer)/inbox.tsx and
        // buyer-conversation.tsx already read (lib/previewInbox.ts), so the
        // flow is actually verifiable end to end without a live network.
        const conv = getOrCreatePreviewConversationForAuthor({
          authorId: currentStory.authorId,
          authorName: currentStory.authorName,
          authorHandle: currentStory.authorHandle,
          authorInitials: currentStory.authorInitials,
          authorColor: currentStory.authorColor,
        });
        const ts = Date.now();
        appendPreviewMessage(conv.id, {
          id: `preview-story-reply-${ts}`,
          conversationId: conv.id,
          fromId: 'me',
          fromName: 'You',
          fromInitials: 'Y',
          fromColor: '#F7F7FA',
          text,
          attachment,
          reactions: [],
          status: 'sent',
          ts,
          deletedForMe: false,
        });
        touchPreviewConversation(conv.id, attachment.title as string, ts);
      } else {
        const conv = await createOrGetConversation({
          type: 'buyer_to_buyer',
          participant: {
            userId: currentStory.authorId,
            name: currentStory.authorName,
            handle: currentStory.authorHandle,
            initials: currentStory.authorInitials,
            color: currentStory.authorColor,
            accountType: 'buyer',
          },
        });
        await sendMessage(conv.id, text, attachment);
      }
      if (!override) setInputText('');
      hapticSuccessAction();
    } catch {
      Alert.alert('Couldn’t send reply', 'Try again.');
    } finally {
      setSendingReply(false);
    }
  };

  const sendQuickReaction = (emoji: string) => {
    hapticLight();
    void handleSendReply(emoji);
  };

  const slideCounts = stories.map(s => s.media.length);

  const applyNav = useCallback((result: { storyIdx: number; slideIdx: number; shouldClose: boolean }) => {
    if (result.shouldClose) { goBackOr(router); return; }
    setStoryIdx(result.storyIdx);
    setSlideIdx(result.slideIdx);
  }, [router]);

  const advanceSlide = useCallback(() => {
    if (!currentStory) return;
    applyNav(navAdvance(storyIdx, slideIdx, slideCounts));
  }, [slideIdx, storyIdx, slideCounts, currentStory, applyNav]);

  const retreatSlide = useCallback(() => {
    applyNav(navRetreat(storyIdx, slideIdx, slideCounts));
  }, [slideIdx, storyIdx, slideCounts, applyNav]);

  // Swipe left/right jumps straight to the next/previous user's story reel
  // (distinct from tapping, which steps through the current user's slides).
  const goToNextUser = useCallback(() => {
    applyNav(navNextUser(storyIdx, stories.length));
  }, [storyIdx, stories.length, applyNav]);

  const goToPrevUser = useCallback(() => {
    applyNav(navPrevUser(storyIdx));
  }, [storyIdx, applyNav]);

  useEffect(() => {
    progress.setValue(0);
    if (isPaused || overlayPaused || showGestureGuide || !currentSlide) return;
    const dur = currentSlide.duration * 1000;
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: dur,
      useNativeDriver: true,
      easing: Easing.linear,
    });
    anim.start(({ finished }) => { if (finished) advanceSlide(); });
    return () => progress.stopAnimation();
  }, [storyIdx, slideIdx, isPaused, overlayPaused, showGestureGuide]);

  // Preload the next story's first slide so swiping/advancing to it feels instant.
  useEffect(() => {
    const nextStory = stories[storyIdx + 1];
    const nextSlide = nextStory?.media[0];
    if (nextSlide?.imageUri && nextSlide.type !== 'text') {
      prefetchImage(nextSlide.imageUri);
    }
  }, [storyIdx, stories]);

  // Swipe-down-to-close drag: the content follows the finger (translateY +
  // a slight shrink), then either snaps back (timing, never a spring — no
  // bounce) or finishes the dismiss with the same shrink continuing off
  // screen before actually closing.
  const dragY = useRef(new Animated.Value(0)).current;
  const isDraggingDown = useRef(false);
  const dragScale = dragY.interpolate({ inputRange: [0, H], outputRange: [1, 0.82], extrapolate: 'clamp' });
  const dragOpacity = dragY.interpolate({ inputRange: [0, H * 0.6], outputRange: [1, 0.4], extrapolate: 'clamp' });

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 12 || Math.abs(g.dy) > 12,
      onPanResponderMove: (_, g) => {
        const verticalDown = Math.abs(g.dy) > Math.abs(g.dx) && g.dy > 0;
        isDraggingDown.current = verticalDown;
        if (verticalDown) dragY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        const gesture = classifyGesture(g.dx, g.dy);
        const wasDraggingDown = isDraggingDown.current;
        isDraggingDown.current = false;
        if (wasDraggingDown) {
          if (gesture === 'close') {
            Animated.timing(dragY, { toValue: H, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true })
              .start(() => goBackOr(router));
          } else {
            Animated.timing(dragY, { toValue: 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
          }
          return;
        }
        switch (gesture) {
          case 'next-user': goToNextUser(); break;
          case 'prev-user': goToPrevUser(); break;
          case 'close': goBackOr(router); break;
        }
      },
    })
  ).current;

  if (!currentStory || !currentSlide) {
    return (
      <View style={[styles.container, styles.loadState, { paddingTop: headerTopInset }]}>
        <StatusBar style="light" />
        {loading ? (
          // A thin progress-bar-shaped skeleton instead of a bare "Loading…" line,
          // so the shape doesn't jump once the story arrives.
          <View style={styles.loadSkeletonTrack} />
        ) : (
          <>
            <Feather name="camera-off" size={40} color="rgba(255,255,255,0.3)" />
            <Text style={styles.loadText}>This story's no longer available.</Text>
          </>
        )}
        <View style={[styles.closeBtnWrap, { top: headerTopInset + SP.sm }]}>
          <IconButton name="x" onPress={() => goBackOr(router)} accessibilityLabel="Close" color={ON_DARK} variant="plain" />
        </View>
      </View>
    );
  }

  // 'me' is the preview/demo-mode author id (lib/previewStories.ts) — there's
  // no real Clerk sign-in under ?bt_preview, so myUserId alone can't tell
  // "my own story" apart from anyone else's there. Same check the story
  // options menu below already uses for the same reason.
  const isMyStory = !isHighlight && ((!!myUserId && currentStory.authorId === myUserId) || currentStory.authorId === 'me');
  const seenByCount = serverViewers.length || (currentStory as any).viewsCount || currentStory.viewers.length;

  const slidePeople = taggedPeople(currentSlide.overlays);
  const openProfile = (p: TaggedPerson) => {
    setMentionTap(null);
    setTaggedSheetOpen(false);
    router.push(mentionProfileHref(p) as never);
  };
  const openOriginal = (originalId: string) => {
    hapticLight();
    router.push(`/buyer-story-viewer?storyId=${encodeURIComponent(originalId)}&allStoryIds=${encodeURIComponent(originalId)}` as never);
  };

  const openViewersModal = async () => {
    setViewerModalVisible(true);
    if (!currentStory) return;
    setViewersLoading(true);
    try {
      const rows = await api.social.storyViewers(currentStory.id);
      setServerViewers(rows);
    } catch {
      setServerViewers([]);
    } finally {
      setViewersLoading(false);
    }
  };

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      <StatusBar hidden />

      <Animated.View style={[styles.dragShrinkLayer, { transform: [{ translateY: dragY }, { scale: dragScale }], opacity: dragOpacity }]}>

      {/* CONTENT */}
      <View style={StyleSheet.absoluteFill}>
        {/* ── Base slide ── */}
        {currentSlide.type === 'text' && (currentSlide.overlays ?? []).some(o => o.type === 'reshare_card') ? (
          <LinearGradient
            colors={reshareGradientFromBackground(currentSlide.backgroundColor)}
            style={StyleSheet.absoluteFill}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
          />
        ) : currentSlide.type === 'text' ? (
          <View style={[styles.slideContent, { backgroundColor: currentSlide.backgroundColor }]}>
            <Text style={[styles.slideText, { color: currentSlide.textColor || '#FFFFFF' }]}>
              {currentSlide.textContent}
            </Text>
          </View>
        ) : currentSlide.imageUri && currentSlide.type === 'video' ? (
          <StorySlideVideo uri={currentSlide.imageUri} paused={isPaused || overlayPaused} />
        ) : currentSlide.imageUri ? (
          <CachedImage
            source={{ uri: currentSlide.imageUri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.slideContent, { backgroundColor: currentSlide.backgroundColor || SURFACE }]}>
            <Feather
              name={currentSlide.type === 'video' ? 'video' : 'image'}
              size={80}
              color="rgba(255,255,255,0.2)"
            />
          </View>
        )}

        {/* ── Overlays (links, GIFs, positioned text) ── */}
        {(currentSlide.overlays ?? []).map(overlay => {
          if (overlay.type === 'link') {
            return (
              <Pressable
                key={overlay.id}
                style={({ pressed }) => [
                  styles.linkOverlay,
                  { left: overlay.x, top: overlay.y, opacity: pressed ? 0.82 : 1 },
                ]}
                onPress={() => {
                  hapticLight();
                  const url = overlay.linkUrl ?? '';
                  if (url) Linking.openURL(url).catch(() => {});
                }}
                accessibilityRole="link"
                accessibilityLabel={overlay.linkText || overlay.linkUrl || 'Open link'}
              >
                <Feather name="link-2" size={12} color={theme.onAccent} />
                <Text style={[styles.linkOverlayText, getOnAccentTextStyle(theme)]} numberOfLines={1}>
                  {overlay.linkText || overlay.linkUrl}
                </Text>
              </Pressable>
            );
          }
          if (overlay.type === 'gif' && overlay.gifUrl) {
            const gH = overlay.gifW && overlay.gifH
              ? 140 * (overlay.gifH / overlay.gifW)
              : 140;
            return (
              <CachedImage
                key={overlay.id}
                source={{ uri: overlay.gifUrl }}
                style={{ position: 'absolute', left: overlay.x, top: overlay.y, width: 140, height: gH }}
                contentFit="contain"
              />
            );
          }
          if (overlay.type === 'text' && overlay.text) {
            return (
              <View
                key={overlay.id}
                style={[styles.textOverlay, { left: overlay.x, top: overlay.y }]}
              >
                <Text style={{ color: overlay.color ?? '#FFF', fontSize: overlay.size ?? 24, fontFamily: FONT.bold }}>
                  {overlay.text}
                </Text>
              </View>
            );
          }
          return null;
        })}
      </View>

      {/* TAP ZONES */}
      <View style={[StyleSheet.absoluteFill, { zIndex: 5 }]} pointerEvents="box-none">
        {/* Plain Pressable, not PressableScale: these are invisible full-height
            advance/retreat/pause zones with intentionally no visual feedback
            (matching the old activeOpacity=1), so the hold-to-pause timing is
            never touched. */}
        <View style={styles.tapZoneRow}>
          <Pressable
            style={styles.tapLeft}
            onPress={retreatSlide}
            onLongPress={() => { setIsLongPressing(true); setIsPaused(true); }}
            onPressOut={() => { if (isLongPressing) { setIsPaused(false); setIsLongPressing(false); } }}
          />
          <Pressable
            style={styles.tapRight}
            onPress={advanceSlide}
            onLongPress={() => { setIsLongPressing(true); setIsPaused(true); }}
            onPressOut={() => { if (isLongPressing) { setIsPaused(false); setIsLongPressing(false); } }}
          />
        </View>
      </View>

      {/* MENTIONS + RESHARE CARD — above the tap zones so a tagged sticker (or the
          44pt square around a tiny/invisible one) and the reshare credit are tappable. */}
      <View style={[StyleSheet.absoluteFill, { zIndex: 6 }]} pointerEvents="box-none">
        <ViewerMentionStickers overlays={currentSlide.overlays ?? []} onTap={(t) => { hapticLight(); setMentionTap(t); }} />
        {(currentSlide.overlays ?? []).filter(o => o.type === 'reshare_card').map(o => (
          <ViewerReshareCard
            key={o.id}
            overlay={o}
            original={currentStory.original}
            onOpenOriginal={openOriginal}
          />
        ))}
      </View>

      {/* LEGIBILITY SCRIMS — dark gradients so progress bars, avatar, name,
          time, and the top/bottom icon row read on any photo (a plain white
          product shot included), matching Instagram's own top/bottom fade
          over the media rather than a flat tint. Non-interactive so they
          never intercept the tap zones. */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']}
        style={styles.topScrim}
      />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.6)']}
        style={styles.bottomScrim}
      />

      {/* PROGRESS BAR */}
      <View style={[styles.progressContainer, { top: headerTopInset + SP.sm }]}>
        {currentStory.media.map((_, i) => (
          <View
            key={i}
            style={styles.progressTrack}
            onLayout={trackWidth === 0 ? (e) => setTrackWidth(e.nativeEvent.layout.width) : undefined}
          >
            {slideIdx > i ? (
              <View style={styles.progressFull} />
            ) : slideIdx === i && trackWidth > 0 ? (
              // Animate `transform` (scaleX pinned to the left edge via a matching
              // translateX) instead of `width`, so this runs on the native driver
              // and never drops frames — the timer/advance logic above is untouched.
              <Animated.View
                style={[
                  styles.progressFillNative,
                  {
                    width: trackWidth,
                    transform: [
                      { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-trackWidth / 2, 0] }) },
                      { scaleX: progress },
                    ],
                  },
                ]}
              />
            ) : null}
          </View>
        ))}
      </View>

      {/* AUTHOR INFO */}
      <View style={[styles.authorRow, { top: headerTopInset + SP.sm + 3 + 12 + SP.xs }]}>
        <View style={[styles.avatar, { backgroundColor: currentStory.authorColor }]}>
          <Text style={styles.avatarText}>{currentStory.authorInitials}</Text>
        </View>
        <View style={{ marginLeft: SP.sm }}>
          <Text style={styles.authorName}>{currentStory.authorName}</Text>
          <Text style={styles.authorTime}>{timeAgo(currentStory.createdAt)}</Text>
        </View>
        <View style={{ flex: 1 }} />
        {currentSlide.productTagId && (
          <Pressable
            style={({ pressed }) => [styles.productTag, { opacity: pressed ? 0.8 : 1 }]}
            onPress={() => {
              hapticLight();
              Alert.alert(currentSlide.productTagName ?? 'Product', undefined, [
                {
                  text: 'Shop',
                  onPress: () => router.push(
                    `/thread-product-detail?productId=${encodeURIComponent(currentSlide.productTagId ?? '')}&productName=${encodeURIComponent(currentSlide.productTagName ?? '')}` as never,
                  ),
                },
                { text: 'Cancel', style: 'cancel' },
              ]);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Shop ${currentSlide.productTagName ?? 'this product'}`}
          >
            <Feather name="shopping-bag" size={ICON.sm} color={PURPLE} />
            <Text style={styles.productTagText}>{currentSlide.productTagName}</Text>
          </Pressable>
        )}
        {currentStory.authorId !== myUserId && currentStory.authorId !== 'me' ? (
          <IconButton
            name="more-horizontal"
            variant="plain"
            color={ON_DARK}
            accessibilityLabel="Story options"
            onPress={() => {
              setIsPaused(true);
              const author = { userId: currentStory.authorId, name: currentStory.authorName };
              Alert.alert(currentStory.authorName, undefined, [
                ...(slidePeople.length > 0 ? [{
                  text: 'Tagged people',
                  onPress: () => { setIsPaused(false); setTaggedSheetOpen(true); },
                }] : []),
                {
                  text: `Mute ${currentStory.authorName}`,
                  onPress: async () => {
                    await muteUser({
                      userId: currentStory.authorId,
                      name: currentStory.authorName,
                      handle: currentStory.authorHandle,
                      initials: currentStory.authorInitials,
                      color: currentStory.authorColor,
                    });
                    goBackOr(router);
                  },
                },
                {
                  text: 'Report story',
                  onPress: () => router.push(reportHref({
                    targetType: 'story',
                    targetId: currentStory.id,
                    label: `${currentStory.authorName}'s story`,
                    ownerId: currentStory.authorId,
                    ownerName: currentStory.authorName,
                  }) as never),
                },
                {
                  text: `Block ${currentStory.authorName}`,
                  style: 'destructive',
                  onPress: async () => {
                    if (await confirmBlock(author, api.social.block)) goBackOr(router);
                    else setIsPaused(false);
                  },
                },
                { text: 'Cancel', style: 'cancel', onPress: () => setIsPaused(false) },
              ]);
            }}
          />
        ) : null}
        <IconButton
          name="x"
          variant="plain"
          color={ON_DARK}
          accessibilityLabel="Close"
          onPress={() => goBackOr(router)}
        />
      </View>

      {/* TAGGED PEOPLE — bottom-left above the reply bar, only when this slide tags someone.
          Works even when every sticker is invisible. */}
      {slidePeople.length > 0 && !replyFocused ? (
        <Pressable
          style={[styles.taggedChip, { bottom: insets.bottom + SP.md + 44 + SP.md + SP.sm }]}
          onPress={() => { hapticLight(); setTaggedSheetOpen(true); }}
          accessibilityRole="button"
          accessibilityLabel={`Tagged people, ${slidePeople.length}`}
          testID="story-tagged-chip"
        >
          <Feather name="at-sign" size={ICON.sm} color={ON_DARK} />
          {slidePeople.length > 1 ? <Text style={styles.taggedChipText}>{slidePeople.length}</Text> : null}
        </Pressable>
      ) : null}

      {/* BOTTOM BAR — Mobbin: Instagram "Viewing your own story" (own) vs
          "Replying to a story" (others). The two are different enough
          (no reply/heart/send on your own story at all — viewers only)
          that they're two separate render branches, not one bar with bits
          conditionally hidden. */}
      {isMyStory ? (
        <View style={[styles.bottomBarWrap, { paddingBottom: insets.bottom + SP.md }]}>
          <View style={styles.ownStoryBar}>
            <PressableScale
              style={styles.seenByRow}
              onPress={() => { hapticLight(); openViewersModal(); }}
              accessibilityRole="button"
              accessibilityLabel={`Seen by ${seenByCount}`}
            >
              <View style={styles.seenByStack}>
                {serverViewers.slice(0, 3).map((v, i) => (
                  <View
                    key={v.userId}
                    style={[styles.seenByAvatar, { marginLeft: i === 0 ? 0 : -10, zIndex: 3 - i }]}
                  >
                    {v.avatarUrl ? (
                      <CachedImage source={{ uri: v.avatarUrl }} style={styles.seenByAvatarImg} />
                    ) : (
                      <Text style={styles.seenByInitials}>{v.name.charAt(0).toUpperCase()}</Text>
                    )}
                  </View>
                ))}
              </View>
              <Text style={styles.seenByText}>
                Seen by {seenByCount}
              </Text>
            </PressableScale>
            <View style={{ flex: 1 }} />
            <PressableScale
              onPress={() => {
                hapticLight();
                setIsPaused(true);
                Share.share({ message: `Check out my story on Brandthread` })
                  .catch(() => {})
                  .finally(() => setIsPaused(false));
              }}
              style={styles.likeBtn}
              accessibilityRole="button"
              accessibilityLabel="Share this story"
            >
              <Feather name="send" size={ICON.lg} color={ON_DARK} />
            </PressableScale>
            <PressableScale
              onPress={() => {
                hapticLight();
                setIsPaused(true);
                Alert.alert('Your story', undefined, [
                  ...(slidePeople.length > 0 ? [{
                    text: 'Tagged people',
                    onPress: () => { setIsPaused(false); setTaggedSheetOpen(true); },
                  }] : []),
                  {
                    text: 'Save to device',
                    onPress: async () => {
                      try {
                        const MediaLibrary = await import('expo-media-library');
                        const perm = await MediaLibrary.requestPermissionsAsync();
                        if (!perm.granted || !currentSlide?.imageUri) throw new Error('permission');
                        await MediaLibrary.Asset.create(currentSlide.imageUri);
                        hapticSuccessAction();
                      } catch {
                        Alert.alert('Couldn’t save', 'Check your photo library permission and try again.');
                      } finally {
                        setIsPaused(false);
                      }
                    },
                  },
                  {
                    text: 'Delete story',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        await api.social.deleteStory(currentStory.id);
                        goBackOr(router);
                      } catch {
                        Alert.alert('Couldn’t delete', 'Try again.');
                        setIsPaused(false);
                      }
                    },
                  },
                  { text: 'Cancel', style: 'cancel', onPress: () => setIsPaused(false) },
                ]);
              }}
              style={styles.likeBtn}
              accessibilityRole="button"
              accessibilityLabel="More options"
            >
              <Feather name="more-horizontal" size={ICON.lg} color={ON_DARK} />
            </PressableScale>
          </View>
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.bottomBarWrap}
          keyboardVerticalOffset={0}
        >
          {!currentStory.repliesDisabled && replyFocused && (
            <View style={styles.quickReactionRow}>
              {QUICK_REACTIONS.map(emoji => (
                <PressableScale
                  key={emoji}
                  onPress={() => sendQuickReaction(emoji)}
                  disabled={sendingReply}
                  accessibilityRole="button"
                  accessibilityLabel={`React with ${emoji}`}
                >
                  <AppleEmoji emoji={emoji} size={26} />
                </PressableScale>
              ))}
            </View>
          )}
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + SP.md }]}>
            {!currentStory.repliesDisabled ? (
              <>
                <View style={styles.replyInputPill}>
                  <TextInput
                    style={styles.replyInput}
                    value={inputText}
                    onChangeText={setInputText}
                    placeholder={`Reply to ${currentStory.authorName}…`}
                    placeholderTextColor="rgba(255,255,255,0.8)"
                    onFocus={() => {
                      if (replyBlurTimer.current) { clearTimeout(replyBlurTimer.current); replyBlurTimer.current = null; }
                      setIsPaused(true);
                      setReplyFocused(true);
                    }}
                    onBlur={() => {
                      replyBlurTimer.current = setTimeout(() => { setIsPaused(false); setReplyFocused(false); }, 200);
                    }}
                    onSubmitEditing={() => handleSendReply()}
                    returnKeyType="send"
                    editable={!sendingReply}
                  />
                </View>
                {inputText.trim().length > 0 ? (
                  // Instagram shows a text "Send" button in place of
                  // heart+share once there's text to send — not an extra
                  // icon alongside them.
                  <PressableScale
                    onPress={() => handleSendReply()}
                    style={styles.sendTextBtn}
                    disabled={sendingReply}
                    accessibilityRole="button"
                    accessibilityLabel="Send reply"
                  >
                    <Text style={styles.sendTextBtnLabel}>{sendingReply ? 'Sending…' : 'Send'}</Text>
                  </PressableScale>
                ) : (
                  <>
                    <PressableScale
                      onPress={() => { hapticLight(); handleLike(); }}
                      style={styles.likeBtn}
                      accessibilityRole="button"
                      accessibilityLabel={likedSet.has(currentStory.id) ? 'Unlike this story' : 'Like this story'}
                    >
                      <Animated.View style={{ transform: [{ scale: heartPop }] }}>
                        {likedSet.has(currentStory.id) ? (
                          <FontAwesome name="heart" size={ICON.lg} color={ON_DARK} />
                        ) : (
                          <Feather name="heart" size={ICON.lg} color={ON_DARK} />
                        )}
                      </Animated.View>
                      {(likesCounts[currentStory.id] ?? 0) > 0 && (
                        <Text style={styles.likesCountText}>
                          {likesCounts[currentStory.id]}
                        </Text>
                      )}
                    </PressableScale>
                    <PressableScale
                      onPress={() => {
                        hapticLight();
                        setIsPaused(true);
                        Share.share({ message: `Check out ${currentStory.authorName}'s story on Brandthread` })
                          .catch(() => {})
                          .finally(() => setIsPaused(false));
                      }}
                      style={styles.likeBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Share this story"
                    >
                      <Feather name="send" size={ICON.lg} color={ON_DARK} />
                    </PressableScale>
                  </>
                )}
              </>
            ) : (
              isHighlight ? null : <Text style={styles.repliesDisabled}>Replies disabled</Text>
            )}
          </View>
        </KeyboardAvoidingView>
      )}
      </Animated.View>

      <MentionPopover target={mentionTap} onClose={() => setMentionTap(null)} onViewProfile={openProfile} />
      <TaggedPeopleSheet visible={taggedSheetOpen} people={slidePeople} onClose={() => setTaggedSheetOpen(false)} onOpen={openProfile} />

      {/* VIEWER MODAL */}
      <Modal
        visible={viewerModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setViewerModalVisible(false)}
      >
        <ModalSafeArea>
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setViewerModalVisible(false)}
            accessibilityRole="button"
            accessibilityLabel="Close"
          />
          <View style={[styles.viewerModal, { paddingBottom: insets.bottom + SP.md }]}>
            <View style={styles.viewerModalHeader}>
              <Text style={styles.viewerModalTitle}>
                {serverViewers.length} {serverViewers.length === 1 ? 'viewer' : 'viewers'}
              </Text>
              <IconButton name="x" variant="plain" size={ICON.lg} color={FG} accessibilityLabel="Close" onPress={() => setViewerModalVisible(false)} />
            </View>
            <FlatList
              data={serverViewers}
              keyExtractor={item => item.userId}
              renderItem={({ item }) => (
                <View style={styles.viewerRow}>
                  <View style={[styles.viewerAvatar, { backgroundColor: PURPLE }]}>
                    <Text style={styles.viewerInitials}>{item.name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={{ marginLeft: SP.sm, flex: 1 }}>
                    <Text style={styles.viewerName}>{item.name}</Text>
                    <Text style={styles.viewerHandle}>{item.handle}</Text>
                  </View>
                  <Text style={styles.viewerTime}>{timeAgo(new Date(item.viewedAt).getTime())}</Text>
                </View>
              )}
              ListEmptyComponent={
                <Text style={styles.noViewers}>{viewersLoading ? 'Loading…' : 'No viewers yet'}</Text>
              }
            />
          </View>
        </ModalSafeArea>
      </Modal>

      {showGestureGuide && myUserId && (
        <StoryGestureGuide userId={myUserId} onDismiss={() => setShowGestureGuide(false)} />
      )}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const PURPLE = theme.accent, PURPLE_DIM = theme.accentDim;
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  dragShrinkLayer: {
    flex: 1,
    borderRadius: RADII.sheet,
    overflow: 'hidden',
  },
  slideContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  slideText: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    textAlign: 'center',
    paddingHorizontal: SP.xl,
  },
  slidePreviewText: {
    color: SUBTLE,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    marginTop: SP.md,
  },
  progressContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: SP.sm,
    paddingTop: SP.sm,
    flexDirection: 'row',
    gap: 3,
    zIndex: 10,
  },
  progressTrack: {
    flex: 1,
    height: 3,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  progressFull: {
    flex: 1,
    backgroundColor: ON_DARK,
  },
  progressFill: {
    height: '100%',
    backgroundColor: ON_DARK,
  },
  progressFillNative: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: ON_DARK,
  },
  authorRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: SP.md,
    paddingTop: SP.xs,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: ON_DARK,
    fontFamily: FONT.bold,
    fontSize: FS.sm,
  },
  authorName: {
    color: ON_DARK,
    fontFamily: FONT.semibold,
    fontSize: 14,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  authorTime: {
    // Solid grey, not an alpha-white — an alpha color washes out (and can
    // invert toward white) over a bright photo; this reads the same on any
    // background, backed by the top scrim + its own text shadow.
    color: '#D4D4D8',
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  topScrim: {
    position: 'absolute',
    left: 0, right: 0, top: 0,
    height: 120,
    zIndex: 1,
  },
  bottomScrim: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    height: 160,
    zIndex: 1,
  },
  productTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    backgroundColor: CARD_ELEVATED,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.md,
    paddingVertical: SP.xs,
    borderWidth: 1,
    borderColor: BORDER,
  },
  productTagText: {
    color: FG,
    fontSize: FS.xs,
    fontFamily: FONT.medium,
  },
  tapZoneRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: H * 0.75,
    flexDirection: 'row',
  },
  tapLeft: {
    width: '22%',
    height: '100%',
  },
  tapRight: {
    width: '78%',
    height: '100%',
  },
  bottomBarWrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  bottomBar: {
    paddingHorizontal: SP.md,
    paddingTop: SP.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
  },
  quickReactionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SP.md,
    paddingBottom: SP.sm,
  },
  // A plain transparent pill, not the shared frosted <Glass> — Dev's exact
  // ask after the glass material's blur/specular layers were reading as an
  // opaque grey blob that hid the typed text underneath it.
  replyInputPill: {
    flex: 1,
    height: 44,
    borderRadius: RADII.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    backgroundColor: 'transparent',
    justifyContent: 'center',
  },
  replyInput: {
    height: 44,
    paddingHorizontal: SP.md,
    fontSize: 15,
    fontFamily: FONT.regular,
    color: ON_DARK,
  },
  sendTextBtn: {
    paddingHorizontal: SP.sm,
    height: 44,
    justifyContent: 'center',
  },
  sendTextBtnLabel: {
    color: ON_DARK,
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
  },
  ownStoryBar: {
    paddingHorizontal: SP.md,
    paddingTop: SP.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
  },
  seenByRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  seenByStack: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: SP.xs,
  },
  seenByAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#000',
    backgroundColor: CARD_ELEVATED,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  seenByAvatarImg: {
    width: '100%',
    height: '100%',
  },
  seenByInitials: {
    color: ON_DARK,
    fontSize: 10,
    fontFamily: FONT.bold,
  },
  seenByText: {
    color: ON_DARK,
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  repliesDisabled: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    textAlign: 'center',
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  viewerModal: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: CARD,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    maxHeight: '60%',
    paddingTop: SP.md,
  },
  viewerModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingBottom: SP.md,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  viewerModalTitle: {
    flex: 1,
    color: FG,
    fontFamily: FONT.semibold,
    fontSize: FS.md,
  },
  viewerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
  },
  viewerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerInitials: {
    color: ON_DARK,
    fontFamily: FONT.bold,
    fontSize: FS.sm,
  },
  viewerName: {
    color: FG,
    fontFamily: FONT.medium,
    fontSize: FS.sm,
  },
  viewerHandle: {
    color: MUTED,
    fontSize: FS.xs,
    fontFamily: FONT.regular,
  },
  viewerTime: {
    color: SUBTLE,
    fontSize: FS.xs,
    fontFamily: FONT.regular,
  },
  noViewers: {
    color: MUTED,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    textAlign: 'center',
    padding: SP.lg,
  },
  // Overlay styles
  linkOverlay: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: `${PURPLE}E0`,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: 230,
    zIndex: 8,
  },
  linkOverlayText: {
    color: theme.onAccent,
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    flexShrink: 1,
  },
  textOverlay: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    zIndex: 8,
  },
  likeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  likesCountText: {
    color: ON_DARK,
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    minWidth: 16,
  },
  loadState: { alignItems: 'center', justifyContent: 'center', gap: SP.sm, paddingHorizontal: SP.xl },
  loadText: { color: ON_DARK, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center' },
  loadSkeletonTrack: {
    width: '60%',
    height: 3,
    borderRadius: RADII.pill,
    backgroundColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },
  closeBtnWrap: { position: 'absolute', right: SP.sm },
  taggedChip: {
    position: 'absolute', left: SP.md, zIndex: 11, minWidth: 44, height: 44, borderRadius: 22,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: SP.sm,
    backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: 'rgba(192,192,192,0.4)',
  },
  taggedChipText: { color: ON_DARK, fontSize: FS.sm, fontFamily: FONT.semibold },
  });
};
