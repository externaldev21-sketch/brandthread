/**
 * Story mention viewer — plays every story that tagged me, in sequence
 * (Instagram's "mentioned you in their story" tap-through), newest first from
 * the tapped one. Opened from the Activity rail, "See all" and the
 * `story_mention` Activity row / push.
 *
 * Gestures match the regular story viewer: tap right/left for the next /
 * previous slide (rolling into the next / previous story), swipe sideways for
 * the next / previous person, hold to pause, swipe down to close. Each slide
 * runs 5s; replying (keyboard up) or holding pauses it. Showing a story
 * records the view (which dims its ring on Activity).
 *
 * Bottom bar: Reply pill → api.social.storyMentionReplyConversation (the
 * server routes it to Inbox or Requests) → sendMessage; heart; and "Add to
 * your story", which opens the composer in reshare mode.
 *
 * Params: storyId — the story to start at. The list itself is loaded here
 * (api.social.storyMentions(), or the `&demo=1` preview seed).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Animated, Dimensions, Easing, PanResponder, Platform, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { FontAwesome } from '@expo/vector-icons';
import { Icon } from '@/components/ui/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';

import { goBackOr } from '@/lib/navigation/goBackOr';
import { CachedImage } from '@/components/CachedImage';
import { PressableScale } from '@/components/BrandthreadUI';
import { IconButton } from '@/components/ui';
import { MentionStickerView, ReshareCard } from '@/components/StoryMentionSticker';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useStoryMentions } from '@/hooks/useStoryMentions';
import Composer from '@/components/ui/Composer';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, ON_DARK, RADIUS, SP, ICON } from '@/lib/theme';
import { RADII, radius } from '@/constants/radii';
import { hapticLight, hapticSuccessAction } from '@/lib/haptics';
import { prefetchImage } from '@/lib/prefetch';
import { useApi } from '@/lib/api';
import { useReportSheet } from '@/components/safety/ReportSheet';
import { ApiError } from '@/lib/networkNotice';
import { relativeTime } from '@/lib/activity';
import { sendMessage } from '@/services/socialService';
import {
  isPreviewInboxEnabled, getOrCreatePreviewConversationForAuthor, appendPreviewMessage, touchPreviewConversation,
} from '@/lib/previewInbox';
import { markPreviewStoryMentionSeen } from '@/lib/previewStoryMentions';
import { isPreviewActivityEnabled } from '@/lib/previewActivity';
import {
  atHandle, isMentionExpired, orderMentions, reshareEditorHref, startIndexFor,
} from '@/lib/storyMentionsRail';
import { advance, retreat, nextUser, prevUser, classifyGesture, type NavResult } from '@/lib/storyViewerNav';
import type { MessageAttachment, StoryMedia, StoryMentionItem, StoryOverlay } from '@/services/socialTypes';

const { height: H } = Dimensions.get('window');

/** Every slide runs this long; an unavailable story only flashes its notice. */
const SLIDE_MS = 5000;
const UNAVAILABLE_MS = 1500;
const TOAST_MS = 1600;

function SlideVideo({ uri, paused }: { uri: string; paused: boolean }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.muted = false; });
  useEffect(() => {
    if (paused) player.pause();
    else player.play();
  }, [paused, player]);
  useEffect(() => () => { player.pause(); }, [player]);
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />;
}

/** One slide's media + overlays (photo / video / text background). */
function SlideMedia({ slide, overlays, original, paused }: {
  slide: StoryMedia;
  overlays: StoryOverlay[];
  original: StoryMentionItem['story']['original'];
  paused: boolean;
}) {
  return (
    <View style={StyleSheet.absoluteFill}>
      {slide.type === 'text' ? (
        <View style={[styles.textSlide, { backgroundColor: slide.backgroundColor }]}>
          <Text style={[styles.textSlideText, { color: slide.textColor || '#FFFFFF' }]}>{slide.textContent}</Text>
        </View>
      ) : slide.imageUri && slide.type === 'video' ? (
        <SlideVideo uri={slide.imageUri} paused={paused} />
      ) : slide.imageUri ? (
        <CachedImage source={{ uri: slide.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <View style={[styles.textSlide, { backgroundColor: slide.backgroundColor || '#000000' }]} />
      )}

      {overlays.map((overlay) => {
        const transform = [{ rotate: `${overlay.rotation ?? 0}deg` }, { scale: overlay.scale ?? 1 }];
        const place = { position: 'absolute' as const, left: overlay.x, top: overlay.y, transform };
        if (overlay.type === 'mention') {
          return (
            <View key={overlay.id} style={[place, { opacity: overlay.opacity ?? 1 }]} pointerEvents="none">
              <MentionStickerView handle={overlay.mentionHandle} variant={overlay.mentionStyle} />
            </View>
          );
        }
        if (overlay.type === 'reshare_card') {
          return (
            <View key={overlay.id} style={place} pointerEvents="none">
              <ReshareCard
                imageUri={overlay.cardImageUri}
                radius={overlay.cardRadius}
                handle={original?.authorHandle}
                unavailable={!!original && !original.available}
              />
            </View>
          );
        }
        if (overlay.type === 'text' && overlay.text) {
          return (
            <View key={overlay.id} style={place} pointerEvents="none">
              <Text style={{ color: overlay.color ?? '#FFFFFF', fontSize: overlay.size ?? 24, fontFamily: FONT.bold }}>
                {overlay.text}
              </Text>
            </View>
          );
        }
        if (overlay.type === 'gif' && overlay.gifUrl) {
          const gifH = overlay.gifW && overlay.gifH ? 140 * (overlay.gifH / overlay.gifW) : 140;
          return (
            <CachedImage
              key={overlay.id}
              source={{ uri: overlay.gifUrl }}
              style={{ position: 'absolute', left: overlay.x, top: overlay.y, width: 140, height: gifH, transform }}
              contentFit="contain"
            />
          );
        }
        return null;
      })}
    </View>
  );
}

export default function StoryMentionViewerScreen() {
  const router = useRouter();
  const api = useApi();
  const { openReport } = useReportSheet();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const topInset = useHeaderTopInset();
  const { storyId } = useLocalSearchParams<{ storyId?: string }>();
  const { items, loading } = useStoryMentions();

  // The queue is fixed once loaded (newest first): a refetch on refocus must
  // not reshuffle what is playing.
  const [queue, setQueue] = useState<StoryMentionItem[] | null>(null);
  const [storyIdx, setStoryIdx] = useState(0);
  const [slideIdx, setSlideIdx] = useState(0);
  const [focused, setFocused] = useState(true);
  const [holding, setHolding] = useState(false);
  const [replyFocused, setReplyFocused] = useState(false);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  // Like state per story: what I tapped this visit, else what the server said.
  const [likedOverride, setLikedOverride] = useState<Record<string, boolean>>({});
  const [unavailable, setUnavailable] = useState<Set<string>>(() => new Set());
  const [trackWidth, setTrackWidth] = useState(0);
  const viewed = useRef(new Set<string>());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  useEffect(() => {
    if (queue !== null || loading) return;
    const ordered = orderMentions(items);
    setQueue(ordered);
    setStoryIdx(startIndexFor(ordered.map((item) => item.storyId), storyId));
  }, [items, loading, queue, storyId]);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);

  const stories = queue ?? [];
  const current: StoryMentionItem | undefined = stories[storyIdx];
  // A deep link to a story that is no longer in my mentions is unavailable.
  const missing = !!storyId && queue !== null && !queue.some((item) => item.storyId === storyId);
  const currentUnavailable = !!current && (unavailable.has(current.storyId) || isMentionExpired(current));
  const slide: StoryMedia | undefined = current?.story.media[slideIdx];
  const slideCounts = useMemo(
    () => stories.map((item) => (unavailable.has(item.storyId) || isMentionExpired(item) ? 1 : Math.max(1, item.story.media.length))),
    [stories, unavailable],
  );
  const paused = !focused || holding || replyFocused || sending;

  const close = useCallback(() => goBackOr(router), [router]);
  const applyNav = useCallback((result: NavResult) => {
    if (result.shouldClose) { close(); return; }
    setStoryIdx(result.storyIdx);
    setSlideIdx(result.slideIdx);
  }, [close]);
  const next = useCallback(() => applyNav(advance(storyIdx, slideIdx, slideCounts)), [applyNav, storyIdx, slideIdx, slideCounts]);
  const prev = useCallback(() => applyNav(retreat(storyIdx, slideIdx, slideCounts)), [applyNav, storyIdx, slideIdx, slideCounts]);
  const nextPerson = useCallback(() => applyNav(nextUser(storyIdx, stories.length)), [applyNav, storyIdx, stories.length]);
  const prevPerson = useCallback(() => applyNav(prevUser(storyIdx)), [applyNav, storyIdx]);

  // Record the view when a story is shown (marks its ring seen). A 404 means
  // it expired or was deleted under us: show the notice, then move on.
  const currentId = current?.storyId;
  useEffect(() => {
    if (!currentId || viewed.current.has(currentId) || currentUnavailable) return;
    viewed.current.add(currentId);
    if (isPreviewActivityEnabled()) { markPreviewStoryMentionSeen(currentId); return; }
    api.social.viewStory(currentId).catch((err) => {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410)) {
        setUnavailable((prevSet) => new Set(prevSet).add(currentId));
      }
    });
  }, [api, currentId, currentUnavailable]);

  // Preload the next story's first slide.
  useEffect(() => {
    const upcoming = stories[storyIdx + 1]?.story.media[0];
    if (upcoming?.imageUri && upcoming.type !== 'text') prefetchImage(upcoming.imageUri);
  }, [storyIdx, stories]);

  // ── Progress + auto-advance ────────────────────────────────────────────────
  // JS-driven (a few 3pt bars) so the value can be read back: pausing keeps
  // the bar where it is and resuming runs only the remaining time.
  const progress = useRef(new Animated.Value(0)).current;
  const progressValue = useRef(0);
  useEffect(() => {
    const id = progress.addListener(({ value }) => { progressValue.current = value; });
    return () => progress.removeListener(id);
  }, [progress]);
  const slideKey = `${storyIdx}:${slideIdx}`;
  useEffect(() => { progress.setValue(0); progressValue.current = 0; }, [progress, slideKey]);
  const nextRef = useRef(next);
  nextRef.current = next;
  useEffect(() => {
    if (!current || !slide || paused) return;
    const total = currentUnavailable ? UNAVAILABLE_MS : SLIDE_MS;
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: Math.max(0, (1 - progressValue.current) * total),
      easing: Easing.linear,
      useNativeDriver: false,
    });
    anim.start(({ finished }) => { if (finished) nextRef.current(); });
    return () => anim.stop();
  }, [progress, slideKey, paused, currentUnavailable, !!current, !!slide]);

  // ── Swipe down to close, swipe sideways for the next / previous person ─────
  const dragY = useRef(new Animated.Value(0)).current;
  const draggingDown = useRef(false);
  const scale = dragY.interpolate({ inputRange: [0, H], outputRange: [1, 0.82], extrapolate: 'clamp' });
  const opacity = dragY.interpolate({ inputRange: [0, H * 0.6], outputRange: [1, 0.4], extrapolate: 'clamp' });
  const gestureRef = useRef({ nextPerson, prevPerson, close });
  gestureRef.current = { nextPerson, prevPerson, close };
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 || Math.abs(g.dy) > 12,
    onPanResponderMove: (_, g) => {
      draggingDown.current = Math.abs(g.dy) > Math.abs(g.dx) && g.dy > 0;
      if (draggingDown.current) dragY.setValue(g.dy);
    },
    onPanResponderRelease: (_, g) => {
      const gesture = classifyGesture(g.dx, g.dy);
      const wasDown = draggingDown.current;
      draggingDown.current = false;
      if (wasDown) {
        if (gesture === 'close') {
          Animated.timing(dragY, { toValue: H, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true })
            .start(() => gestureRef.current.close());
        } else {
          Animated.timing(dragY, { toValue: 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
        }
        return;
      }
      if (gesture === 'next-user') gestureRef.current.nextPerson();
      else if (gesture === 'prev-user') gestureRef.current.prevPerson();
    },
  })).current;

  // ── Like, reply, add to story ──────────────────────────────────────────────
  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const heartPop = useRef(new Animated.Value(1)).current;
  const likedNow = useCallback((item: StoryMentionItem) => (
    likedOverride[item.storyId] ?? !!(item.story as { likedByMe?: boolean }).likedByMe
  ), [likedOverride]);
  const handleLike = useCallback(async () => {
    if (!current) return;
    const id = current.storyId;
    const wasLiked = likedNow(current);
    hapticLight();
    if (!wasLiked) {
      heartPop.setValue(0.75);
      Animated.timing(heartPop, { toValue: 1, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
    const set = (on: boolean) => setLikedOverride((prevMap) => ({ ...prevMap, [id]: on }));
    set(!wasLiked);
    if (isPreviewActivityEnabled()) return;
    try {
      const res = await api.social.likeStory(id);
      set(res.liked);
    } catch {
      set(wasLiked);
      Alert.alert('Could not update like', 'Try again.');
    }
  }, [api, current, heartPop, likedNow]);
  const isLiked = !!current && likedNow(current);

  const sendReply = useCallback(async () => {
    const message = text.trim();
    if (!message || sending || !current || currentUnavailable) return;
    setSending(true);
    const attachment: MessageAttachment = {
      type: 'story_reply',
      uri: slide?.imageUri,
      title: 'Replied to your story',
      meta: { storyId: current.storyId },
    };
    const { tagger } = current;
    try {
      if (isPreviewActivityEnabled() && isPreviewInboxEnabled()) {
        // No backend in the web preview: land the reply in the seeded local
        // inbox so the flow is verifiable end to end.
        const conv = getOrCreatePreviewConversationForAuthor({
          authorId: tagger.userId, authorName: tagger.name, authorHandle: tagger.handle,
          authorInitials: tagger.initials, authorColor: '#1C1C1E', avatarUri: tagger.avatarUrl ?? undefined,
        });
        const ts = Date.now();
        appendPreviewMessage(conv.id, {
          id: `preview-mention-reply-${ts}`, conversationId: conv.id, fromId: 'me', fromName: 'You',
          fromInitials: 'Y', fromColor: '#F7F7FA', text: message, attachment, reactions: [],
          status: 'sent', ts, deletedForMe: false,
        });
        touchPreviewConversation(conv.id, attachment.title as string, ts);
      } else {
        // The server decides Inbox vs Requests; the sender sees the same
        // "Sent" either way.
        const conv = await api.social.storyMentionReplyConversation(current.storyId);
        await sendMessage(conv.conversationId, message, attachment);
      }
      setText('');
      hapticSuccessAction();
      showToast('Sent');
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410)) {
        setUnavailable((prevSet) => new Set(prevSet).add(current.storyId));
      } else {
        Alert.alert('Couldn’t send reply', 'Try again.');
      }
    } finally {
      setSending(false);
    }
  }, [api, current, currentUnavailable, sending, showToast, slide?.imageUri, text]);

  const addToStory = useCallback(() => {
    if (!current || currentUnavailable) return;
    hapticLight();
    router.push(reshareEditorHref({
      storyId: current.storyId,
      imageUrl: slide?.imageUri ?? current.thumbnailUrl,
      handle: current.tagger.handle,
      slide: slideIdx,
    }) as never);
  }, [current, currentUnavailable, router, slide?.imageUri, slideIdx]);

  // ── Empty / loading ────────────────────────────────────────────────────────
  if (!current || !slide || missing) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: topInset }]}>
        <StatusBar hidden />
        {loading || queue === null ? (
          <View style={styles.loadingTrack} />
        ) : (
          <>
            <Icon name="slash" size={40} color="rgba(255,255,255,0.3)" />
            <Text style={styles.emptyText}>Story unavailable</Text>
          </>
        )}
        <View style={[styles.closeWrap, { top: topInset + SP.sm }]}>
          <IconButton name="x" onPress={close} accessibilityLabel="Close" color={ON_DARK} variant="plain" />
        </View>
      </View>
    );
  }

  const { tagger } = current;
  const tagName = tagger.name || atHandle(tagger.handle);
  // Long-press the header to report the story.
  const openReportSheet = () => openReport({
    targetType: 'story', targetId: current.storyId, label: `${tagName}’s story`,
    ownerId: tagger.userId, ownerName: tagName,
  });
  const slides = currentUnavailable ? 1 : current.story.media.length;
  const hasText = text.trim().length > 0;

  return (
    <View style={styles.container} {...pan.panHandlers}>
      <StatusBar hidden />
      <Animated.View style={[styles.shrinkLayer, { transform: [{ translateY: dragY }, { scale }], opacity }]}>
        {currentUnavailable ? (
          <View style={[StyleSheet.absoluteFill, styles.centered]}>
            <Icon name="slash" size={40} color="rgba(255,255,255,0.3)" />
            <Text style={styles.emptyText}>Story unavailable</Text>
          </View>
        ) : (
          <SlideMedia
            slide={slide}
            overlays={slide.overlays ?? []}
            original={current.story.original}
            paused={paused}
          />
        )}

        {/* Tap zones: left = previous, right = next, hold = pause. Plain
            Pressables with no feedback so hold-to-pause timing is untouched. */}
        <View style={[StyleSheet.absoluteFill, { zIndex: 5 }]} pointerEvents="box-none">
          <View style={styles.tapRow}>
            <Pressable
              style={styles.tapLeft}
              onPress={prev}
              onLongPress={() => setHolding(true)}
              onPressOut={() => setHolding(false)}
              accessibilityLabel="Previous"
              testID="story-mention-prev"
            />
            <Pressable
              style={styles.tapRight}
              onPress={next}
              onLongPress={() => setHolding(true)}
              onPressOut={() => setHolding(false)}
              accessibilityLabel="Next"
              testID="story-mention-next"
            />
          </View>
        </View>

        <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']} style={styles.topScrim} />
        <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.6)']} style={styles.bottomScrim} />

        {/* Progress: one segment per slide of the current story. */}
        <View style={[styles.progressRow, { top: topInset + SP.sm }]}>
          {Array.from({ length: slides }).map((_, index) => (
            <View
              key={index}
              style={styles.progressTrack}
              onLayout={trackWidth === 0 ? (e) => setTrackWidth(e.nativeEvent.layout.width) : undefined}
            >
              {slideIdx > index ? (
                <View style={styles.progressFull} />
              ) : slideIdx === index ? (
                <Animated.View
                  style={[styles.progressFill, { width: progress.interpolate({ inputRange: [0, 1], outputRange: [0, trackWidth || 1] }) }]}
                />
              ) : null}
            </View>
          ))}
        </View>

        {/* Header: who mentioned me. */}
        <View style={[styles.header, { top: topInset + SP.sm + 3 + SP.sm }]} pointerEvents="box-none">
          <View style={[styles.avatar, { backgroundColor: '#1C1C1E' }]}>
            {tagger.avatarUrl ? (
              <CachedImage source={{ uri: tagger.avatarUrl }} style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors />
            ) : (
              <Text style={styles.avatarText} allowFontScaling={false}>{tagger.initials}</Text>
            )}
          </View>
          <Pressable style={styles.headerText} onLongPress={openReportSheet} delayLongPress={400}>
            <Text style={styles.name} numberOfLines={1}>{tagName}</Text>
            <Text style={styles.sub} numberOfLines={1}>Mentioned you · {relativeTime(current.mentionedAt)}</Text>
          </Pressable>
          <IconButton name="x" onPress={close} accessibilityLabel="Close" color={ON_DARK} variant="plain" />
        </View>

        {/* Bottom bar: Add to your story, then reply + heart. */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.bottomWrap}
          keyboardVerticalOffset={0}
        >
          {toast ? (
            <View style={styles.toast} pointerEvents="none" accessibilityLiveRegion="polite">
              <Text style={styles.toastText}>{toast}</Text>
            </View>
          ) : null}
          {!replyFocused && !currentUnavailable ? (
            <View style={styles.addRow}>
              <PressableScale
                onPress={addToStory}
                style={styles.addPill}
                accessibilityRole="button"
                accessibilityLabel="Add to your story"
                testID="story-mention-add"
                noMinHeight
              >
                <Icon name="plus-circle" size={ICON.md} color={ON_DARK} />
                <Text style={styles.addLabel}>Add to your story</Text>
              </PressableScale>
            </View>
          ) : null}
          <Composer
          overMedia
            value={text}
            onChangeText={setText}
            onSend={() => { void sendReply(); }}
            canSend={hasText && !sending}
            editable={!sending && !currentUnavailable}
            placeholder={`Reply to ${tagger.name || atHandle(tagger.handle)}…`}
            accessibilityLabel="Reply"
            testID="story-mention-reply"
            hideTabBar={false}
            onFocus={() => {
              if (blurTimer.current) { clearTimeout(blurTimer.current); blurTimer.current = null; }
              setReplyFocused(true);
            }}
            onBlur={() => {
              // Delayed so a tap on Send still lands before the bar re-lays out.
              blurTimer.current = setTimeout(() => setReplyFocused(false), 200);
            }}
            rightAccessory={(
              <PressableScale
                onPress={() => { void handleLike(); }}
                style={styles.heartBtn}
                accessibilityRole="button"
                accessibilityLabel={isLiked ? 'Unlike this story' : 'Like this story'}
                testID="story-mention-like"
              >
                <Animated.View style={{ transform: [{ scale: heartPop }] }}>
                  {isLiked
                    ? <FontAwesome name="heart" size={ICON.lg} color={theme.text} />
                    : <Icon name="heart" size={ICON.lg} color={theme.text} />}
                </Animated.View>
              </PressableScale>
            )}
          />
        </KeyboardAvoidingView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  shrinkLayer: { flex: 1, borderRadius: RADII.sheet, overflow: 'hidden', backgroundColor: '#000000' },
  centered: { alignItems: 'center', justifyContent: 'center', gap: SP.md },
  emptyText: { color: 'rgba(255,255,255,0.7)', fontFamily: FONT.medium, fontSize: FS.base },
  loadingTrack: { width: 120, height: 3, borderRadius: RADIUS.pill, backgroundColor: 'rgba(255,255,255,0.3)' },
  closeWrap: { position: 'absolute', right: SP.sm, zIndex: 10 },
  textSlide: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  textSlideText: { fontSize: FS.xl, fontFamily: FONT.bold, textAlign: 'center', paddingHorizontal: SP.xl },
  tapRow: { position: 'absolute', top: 0, left: 0, right: 0, height: H * 0.7, flexDirection: 'row' },
  tapLeft: { width: '30%', height: '100%' },
  tapRight: { width: '70%', height: '100%' },
  topScrim: { position: 'absolute', left: 0, right: 0, top: 0, height: 140, zIndex: 1 },
  bottomScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 200, zIndex: 1 },
  progressRow: { position: 'absolute', left: 0, right: 0, paddingHorizontal: SP.sm, flexDirection: 'row', gap: 3, zIndex: 10 },
  progressTrack: { flex: 1, height: 3, borderRadius: RADIUS.pill, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.3)' },
  progressFull: { flex: 1, backgroundColor: ON_DARK },
  progressFill: { height: '100%', backgroundColor: ON_DARK },
  header: { position: 'absolute', left: 0, right: 0, paddingLeft: SP.md, paddingRight: SP.sm, flexDirection: 'row', alignItems: 'center', zIndex: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: ON_DARK, fontFamily: FONT.bold, fontSize: FS.sm },
  headerText: { flex: 1, marginLeft: SP.sm },
  name: { color: ON_DARK, fontFamily: FONT.semibold, fontSize: 14, textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  sub: { color: '#D4D4D8', fontFamily: FONT.regular, fontSize: FS.sm, textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  bottomWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 10 },
  toast: {
    alignSelf: 'center', marginBottom: SP.sm, paddingHorizontal: SP.md, paddingVertical: SP.sm,
    borderRadius: RADIUS.pill, backgroundColor: '#FFFFFF',
  },
  toastText: { color: '#000000', fontFamily: FONT.semibold, fontSize: FS.sm },
  addRow: { paddingHorizontal: SP.md, paddingBottom: SP.sm, flexDirection: 'row' },
  addPill: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, height: 44, paddingHorizontal: SP.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: '#FFFFFF', backgroundColor: 'rgba(0,0,0,0.45)',
  },
  addLabel: { color: ON_DARK, fontFamily: FONT.semibold, fontSize: FS.base },
  heartBtn: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
});
