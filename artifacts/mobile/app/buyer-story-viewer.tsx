import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, Animated, Easing,
  Dimensions, PanResponder, StyleSheet, Alert, Modal, FlatList,
  Image, Linking,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useColors } from '@/hooks/useColors';
import { useAppTheme, getOnAccentTextStyle } from '@/contexts/AppThemeContext';
import {
  BG, SURFACE, CARD, CARD_ELEVATED, BORDER,
  FG, MUTED, SUBTLE, ON_DARK,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import {
  getStories, trackStoryView, subscribeSocial, muteUser, createOrGetConversation, sendMessage,
} from '@/services/socialService';
import { useAuth } from '@clerk/expo';
import { confirmBlock, reportHref } from '@/lib/safety';
import type { Story, StoryMedia } from '@/services/socialTypes';
import { useApi } from '@/lib/api';

const { width: W, height: H } = Dimensions.get('window');

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

export default function BuyerStoryViewer() {
  const colors = useColors();
  const { theme } = useAppTheme();
  const PURPLE = colors.primary, PURPLE_DIM = colors.accent;
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { storyId, allStoryIds } = useLocalSearchParams<{ storyId: string; allStoryIds: string }>();

  const api = useApi();
  const { userId: myUserId } = useAuth();

  const [stories, setStories] = useState<Story[]>([]);
  const [storyIdx, setStoryIdx] = useState(0);
  const [slideIdx, setSlideIdx] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isLongPressing, setIsLongPressing] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [viewerModalVisible, setViewerModalVisible] = useState(false);
  // Like state keyed by storyId
  const [likedSet, setLikedSet] = useState<Set<string>>(new Set());
  const [likesCounts, setLikesCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const loadGeneration = useRef(0);

  const progress = useRef(new Animated.Value(0)).current;
  const ids = allStoryIds ? allStoryIds.split(',').filter(Boolean) : storyId ? [storyId] : [];

  const currentStory: Story | undefined = stories[storyIdx];
  const currentSlide: StoryMedia | undefined = currentStory?.media[slideIdx];

  const loadStories = useCallback(async () => {
    const generation = ++loadGeneration.current;
    try {
      const all = await getStories();
      if (loadGeneration.current !== generation) return;
      const now = Date.now();
      const filtered = ids
        .map(id => all.find(s => s.id === id))
        .filter((s): s is Story => !!s && s.expiresAt > now);
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
    if (storyId) {
      trackStoryView(storyId).catch(() => {});
      // Also record view server-side (fire-and-forget)
      api.social.viewStory(storyId).catch(() => {});
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

  const handleLike = async () => {
    if (!currentStory) return;
    const sid = currentStory.id;
    const wasLiked = likedSet.has(sid);
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
    const unsub = subscribeSocial(() => loadStories());
    return unsub;
  }, []);

  const handleSendReply = async () => {
    const text = inputText.trim();
    if (!text || sendingReply || !currentStory) return;
    setSendingReply(true);
    try {
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
      await sendMessage(conv.id, text);
      setInputText('');
      Haptics.notificationAsync?.(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('Couldn’t send reply', 'Try again.');
    } finally {
      setSendingReply(false);
    }
  };

  const advanceSlide = useCallback(() => {
    if (!currentStory) return;
    if (slideIdx < currentStory.media.length - 1) {
      setSlideIdx(i => i + 1);
    } else if (storyIdx < stories.length - 1) {
      setStoryIdx(i => i + 1);
      setSlideIdx(0);
    } else {
      router.back();
    }
  }, [slideIdx, storyIdx, stories, currentStory, router]);

  const retreatSlide = useCallback(() => {
    if (slideIdx > 0) {
      setSlideIdx(i => i - 1);
    } else if (storyIdx > 0) {
      const prevStory = stories[storyIdx - 1];
      setStoryIdx(i => i - 1);
      setSlideIdx(prevStory ? prevStory.media.length - 1 : 0);
    }
  }, [slideIdx, storyIdx, stories]);

  useEffect(() => {
    progress.setValue(0);
    if (isPaused || !currentSlide) return;
    const dur = currentSlide.duration * 1000;
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: dur,
      useNativeDriver: false,
      easing: Easing.linear,
    });
    anim.start(({ finished }) => { if (finished) advanceSlide(); });
    return () => progress.stopAnimation();
  }, [storyIdx, slideIdx, isPaused]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dy) > Math.abs(g.dx) && g.dy > 10,
      onPanResponderRelease: (_, g) => { if (g.dy > 80) router.back(); },
    })
  ).current;

  if (!currentStory || !currentSlide) {
    return <View style={[styles.container, styles.loadState]}>
      {loading ? <Text style={styles.loadText}>Loading story…</Text> : null}
    </View>;
  }

  const isMyStory = false; // Viewer perspective

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      <StatusBar hidden />

      {/* CONTENT */}
      <View style={StyleSheet.absoluteFill}>
        {/* ── Base slide ── */}
        {currentSlide.type === 'text' ? (
          <View style={[styles.slideContent, { backgroundColor: currentSlide.backgroundColor }]}>
            <Text style={[styles.slideText, { color: currentSlide.textColor || '#FFFFFF' }]}>
              {currentSlide.textContent}
            </Text>
          </View>
        ) : currentSlide.imageUri && currentSlide.type === 'video' ? (
          <StorySlideVideo uri={currentSlide.imageUri} paused={isPaused} />
        ) : currentSlide.imageUri ? (
          <Image
            source={{ uri: currentSlide.imageUri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
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
              <TouchableOpacity
                key={overlay.id}
                style={[styles.linkOverlay, { left: overlay.x, top: overlay.y }]}
                onPress={() => {
                  const url = overlay.linkUrl ?? '';
                  if (url) Linking.openURL(url).catch(() => {});
                }}
                activeOpacity={0.82}
              >
                <Feather name="link-2" size={12} color={theme.onAccent} />
                <Text style={[styles.linkOverlayText, getOnAccentTextStyle(theme)]} numberOfLines={1}>
                  {overlay.linkText || overlay.linkUrl}
                </Text>
              </TouchableOpacity>
            );
          }
          if (overlay.type === 'gif' && overlay.gifUrl) {
            const gH = overlay.gifW && overlay.gifH
              ? 140 * (overlay.gifH / overlay.gifW)
              : 140;
            return (
              <Image
                key={overlay.id}
                source={{ uri: overlay.gifUrl }}
                style={{ position: 'absolute', left: overlay.x, top: overlay.y, width: 140, height: gH }}
                resizeMode="contain"
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
        <View style={styles.tapZoneRow}>
          <TouchableOpacity
            style={styles.tapLeft}
            activeOpacity={1}
            onPress={retreatSlide}
            onLongPress={() => { setIsLongPressing(true); setIsPaused(true); }}
            onPressOut={() => { if (isLongPressing) { setIsPaused(false); setIsLongPressing(false); } }}
          />
          <TouchableOpacity
            style={styles.tapRight}
            activeOpacity={1}
            onPress={advanceSlide}
            onLongPress={() => { setIsLongPressing(true); setIsPaused(true); }}
            onPressOut={() => { if (isLongPressing) { setIsPaused(false); setIsLongPressing(false); } }}
          />
        </View>
      </View>

      {/* PROGRESS BAR */}
      <View style={[styles.progressContainer, { top: insets.top + SP.sm }]}>
        {currentStory.media.map((_, i) => (
          <View key={i} style={styles.progressTrack}>
            {slideIdx > i ? (
              <View style={styles.progressFull} />
            ) : slideIdx === i ? (
              <Animated.View
                style={[
                  styles.progressFill,
                  {
                    width: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', '100%'],
                    }),
                  },
                ]}
              />
            ) : null}
          </View>
        ))}
      </View>

      {/* AUTHOR INFO */}
      <View style={[styles.authorRow, { top: insets.top + SP.sm + 3 + 12 + SP.xs }]}>
        <View style={[styles.avatar, { backgroundColor: currentStory.authorColor }]}>
          <Text style={styles.avatarText}>{currentStory.authorInitials}</Text>
        </View>
        <View style={{ marginLeft: SP.sm }}>
          <Text style={styles.authorName}>{currentStory.authorName}</Text>
          <Text style={styles.authorTime}>{timeAgo(currentStory.createdAt)}</Text>
        </View>
        <View style={{ flex: 1 }} />
        {currentSlide.productTagId && (
          <TouchableOpacity
            style={styles.productTag}
            onPress={() =>
              Alert.alert(currentSlide.productTagName ?? 'Product', undefined, [
                {
                  text: 'Shop',
                  onPress: () => router.push(
                    `/thread-product-detail?productId=${encodeURIComponent(currentSlide.productTagId ?? '')}&productName=${encodeURIComponent(currentSlide.productTagName ?? '')}` as never,
                  ),
                },
                { text: 'Cancel', style: 'cancel' },
              ])
            }
          >
            <Feather name="shopping-bag" size={ICON.sm} color={PURPLE} />
            <Text style={styles.productTagText}>{currentSlide.productTagName}</Text>
          </TouchableOpacity>
        )}
        {currentStory.authorId !== myUserId && currentStory.authorId !== 'me' ? (
          <TouchableOpacity
            style={{ marginLeft: SP.sm, padding: SP.xs }}
            accessibilityRole="button"
            accessibilityLabel="Story options"
            onPress={() => {
              setIsPaused(true);
              const author = { userId: currentStory.authorId, name: currentStory.authorName };
              Alert.alert(currentStory.authorName, undefined, [
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
                    router.back();
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
                    if (await confirmBlock(author, api.social.block)) router.back();
                    else setIsPaused(false);
                  },
                },
                { text: 'Cancel', style: 'cancel', onPress: () => setIsPaused(false) },
              ]);
            }}
          >
            <Feather name="more-horizontal" size={ICON.md} color={ON_DARK} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* BOTTOM BAR */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + SP.md }]}>
        {!currentStory.repliesDisabled ? (
          <>
            <TextInput
              style={styles.replyInput}
              value={inputText}
              onChangeText={setInputText}
              placeholder={`Reply to ${currentStory.authorName}…`}
              placeholderTextColor="rgba(255,255,255,0.4)"
              onFocus={() => setIsPaused(true)}
              onBlur={() => setIsPaused(false)}
              onSubmitEditing={handleSendReply}
              returnKeyType="send"
              editable={!sendingReply}
            />
            {inputText.trim().length > 0 && (
              <TouchableOpacity
                onPress={handleSendReply}
                style={styles.likeBtn}
                activeOpacity={0.7}
                disabled={sendingReply}
                accessibilityRole="button"
                accessibilityLabel="Send reply"
              >
                <Feather name="send" size={ICON.md} color={sendingReply ? 'rgba(255,255,255,0.4)' : ON_DARK} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={handleLike}
              style={styles.likeBtn}
              activeOpacity={0.7}
            >
              <Feather
                name="heart"
                size={ICON.lg}
                color={likedSet.has(currentStory.id) ? '#EF4444' : ON_DARK}
                style={likedSet.has(currentStory.id) ? styles.heartFilled : undefined}
              />
              {(likesCounts[currentStory.id] ?? 0) > 0 && (
                <Text style={styles.likesCountText}>
                  {likesCounts[currentStory.id]}
                </Text>
              )}
            </TouchableOpacity>
            {isMyStory && (
              <TouchableOpacity
                style={styles.viewerBtn}
                onPress={() => setViewerModalVisible(true)}
              >
                <Feather name="eye" size={ICON.lg} color={ON_DARK} />
                <Text style={styles.viewerCount}>{currentStory.viewers.length}</Text>
              </TouchableOpacity>
            )}
          </>
        ) : (
          <Text style={styles.repliesDisabled}>Replies disabled</Text>
        )}
      </View>

      {/* VIEWER MODAL */}
      <Modal
        visible={viewerModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setViewerModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setViewerModalVisible(false)}
        />
        <View style={[styles.viewerModal, { paddingBottom: insets.bottom + SP.md }]}>
          <View style={styles.viewerModalHeader}>
            <Text style={styles.viewerModalTitle}>
              {currentStory.viewers.length} viewers
            </Text>
            <TouchableOpacity onPress={() => setViewerModalVisible(false)}>
              <Feather name="x" size={ICON.lg} color={FG} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={currentStory.viewers}
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
                <Text style={styles.viewerTime}>{timeAgo(item.viewedAt)}</Text>
              </View>
            )}
            ListEmptyComponent={
              <Text style={styles.noViewers}>No viewers yet</Text>
            }
          />
        </View>
      </Modal>
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
    fontSize: FS.base,
  },
  authorTime: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: FS.xs,
    fontFamily: FONT.regular,
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
    width: '30%',
    height: '100%',
  },
  tapRight: {
    width: '70%',
    height: '100%',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: SP.md,
    paddingTop: SP.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    zIndex: 10,
  },
  replyInput: {
    flex: 1,
    height: 44,
    backgroundColor: CARD,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: ON_DARK,
  },
  viewerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
  },
  viewerCount: {
    color: ON_DARK,
    fontSize: FS.sm,
    fontFamily: FONT.medium,
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
  heartFilled: {
    // tintColor applied via color prop above
  },
  likesCountText: {
    color: ON_DARK,
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    minWidth: 16,
  },
  loadState: { alignItems: 'center', justifyContent: 'center', gap: SP.sm },
  loadText: { color: ON_DARK, fontFamily: FONT.regular, fontSize: FS.sm },
  });
};
