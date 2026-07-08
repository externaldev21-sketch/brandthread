import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TouchableWithoutFeedback,
  useColorScheme, Dimensions, Animated, Alert, Share, TextInput, Modal,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { ViewToken } from 'react-native';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ─── Mock spotlight (video) feed data ────────────────────────────────────────
// Videos are public sample clips standing in for creator-submitted footage.

const SPOTLIGHT_ITEMS = [
  {
    id: '1',
    creator: 'Vault Studio',
    handle: '@vaultstudio',
    avatarColor: '#B33F1E',
    initials: 'VS',
    verified: true,
    videoUri: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4',
    caption: 'New drop just landed 🔥 Oversized canvas jacket — limited run of 50.',
    sound: 'Original Sound · vaultstudio',
    chip: '🔥 Trending Now',
    productName: 'Canvas Cargo Jacket',
    productPrice: '$189',
    productOriginalPrice: null as string | null,
    accentColor: '#C94D1F',
    likes: 1240,
    comments: [
      { id: 'c1', user: '@dropzone', text: 'need this in black 😍' },
      { id: 'c2', user: '@street.era', text: 'copped one already' },
    ],
    reposts: 118,
    shares: 340,
  },
  {
    id: '2',
    creator: 'Meridian Co.',
    handle: '@meridianclothing',
    avatarColor: '#0F766E',
    initials: 'MC',
    verified: false,
    videoUri: 'https://test-videos.co.uk/vids/sintel/mp4/h264/720/Sintel_720_10s_1MB.mp4',
    caption: 'Clean minimalist tees now in 8 colorways. Basics shouldn\'t be boring.',
    sound: 'Original Sound · meridianclothing',
    chip: '🆕 Just Dropped',
    productName: 'Essential Relaxed Tee',
    productPrice: '$48',
    productOriginalPrice: null as string | null,
    accentColor: '#14B8A6',
    likes: 892,
    comments: [
      { id: 'c1', user: '@basics.only', text: 'the fit on this is clean' },
    ],
    reposts: 44,
    shares: 210,
  },
  {
    id: '3',
    creator: 'NXGEN',
    handle: '@nxgendrops',
    avatarColor: '#B45309',
    initials: 'NX',
    verified: true,
    videoUri: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
    caption: 'The cargo trousers everyone\'s been asking about. Back in stock 🙌',
    sound: 'Original Sound · nxgendrops',
    chip: '📦 Restocked',
    productName: 'Ripstop Cargo Trousers',
    productPrice: '$134',
    productOriginalPrice: '$160',
    accentColor: '#B98A2E',
    likes: 3410,
    comments: [
      { id: 'c1', user: '@cargofit', text: 'been waiting weeks for this restock' },
      { id: 'c2', user: '@yn.drip', text: 'link??' },
    ],
    reposts: 215,
    shares: 980,
  },
  {
    id: '4',
    creator: 'Softwear',
    handle: '@softwearstudio',
    avatarColor: '#BE185D',
    initials: 'SW',
    verified: false,
    videoUri: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4',
    caption: 'Sunday hoodies are here. 400gsm French terry, washed finish.',
    sound: 'Original Sound · softwearstudio',
    chip: '☁️ Cozy Season',
    productName: 'Sunday Washed Hoodie',
    productPrice: '$98',
    productOriginalPrice: null as string | null,
    accentColor: '#EC4899',
    likes: 2180,
    comments: [
      { id: 'c1', user: '@hoodiehoarder', text: 'the washed finish 😩' },
    ],
    reposts: 132,
    shares: 670,
  },
  {
    id: '5',
    creator: 'Atlas Goods',
    handle: '@atlasgoods',
    avatarColor: '#1D4ED8',
    initials: 'AG',
    verified: true,
    videoUri: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4',
    caption: 'Workwear inspired, streetwear executed. Built for the city.',
    sound: 'Original Sound · atlasgoods',
    chip: '🧭 New Season',
    productName: 'City Chore Coat',
    productPrice: '$215',
    productOriginalPrice: '$260',
    accentColor: '#4A6FA5',
    likes: 975,
    comments: [
      { id: 'c1', user: '@city.slate', text: 'sand or slate, which one 👀' },
    ],
    reposts: 58,
    shares: 290,
  },
];

type SpotlightItem = typeof SPOTLIGHT_ITEMS[number];
type EngagementState = {
  liked: boolean; likes: number;
  saved: boolean;
  reposted: boolean; reposts: number;
  following: boolean;
  comments: { id: string; user: string; text: string }[];
};

function initialEngagement(item: SpotlightItem): EngagementState {
  return {
    liked: false, likes: item.likes,
    saved: false,
    reposted: false, reposts: item.reposts,
    following: false,
    comments: item.comments,
  };
}

function formatCount(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0)}K`;
  return String(n);
}

// ─── Single video page ────────────────────────────────────────────────────────

function SpotlightPage({
  item, isActive, engagement, onLike, onDoubleTapLike, onSave, onRepost, onFollow, onOpenComments, onShop,
}: {
  item: SpotlightItem;
  isActive: boolean;
  engagement: EngagementState;
  onLike: (id: string) => void;
  onDoubleTapLike: (id: string) => void;
  onSave: (id: string) => void;
  onRepost: (id: string) => void;
  onFollow: (id: string) => void;
  onOpenComments: (id: string) => void;
  onShop: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();
  // Clear the floating pill tab bar (see (tabs)/_layout.tsx: bottomOffset + height 72 + margin).
  const tabBarClearance = Math.max(insets.bottom, 8) + 12 + 72 + 14;
  const player = useVideoPlayer(item.videoUri, p => { p.loop = true; p.muted = false; });
  const [paused, setPaused] = useState(false);
  const heartBurst = useRef(new Animated.Value(0)).current;
  const heartScale = useRef(new Animated.Value(1)).current;
  const lastTap = useRef(0);
  const pauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => { if (pauseTimer.current) clearTimeout(pauseTimer.current); }, []);

  React.useEffect(() => {
    if (isActive && !paused) player.play();
    else player.pause();
  }, [isActive, paused, player]);

  function burstHeart() {
    heartBurst.setValue(1);
    Animated.timing(heartBurst, { toValue: 0, duration: 700, delay: 250, useNativeDriver: true }).start();
  }

  function bumpHeart() {
    Animated.sequence([
      Animated.spring(heartScale, { toValue: 1.35, useNativeDriver: true, speed: 40 }),
      Animated.spring(heartScale, { toValue: 1, useNativeDriver: true, speed: 40 }),
    ]).start();
  }

  function handlePress() {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      lastTap.current = 0;
      if (pauseTimer.current) { clearTimeout(pauseTimer.current); pauseTimer.current = null; }
      onDoubleTapLike(item.id);
      bumpHeart();
      burstHeart();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else {
      lastTap.current = now;
      pauseTimer.current = setTimeout(() => {
        pauseTimer.current = null;
        setPaused(p => !p);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }, 290);
    }
  }

  return (
    <View style={{ width: SCREEN_W, height: SCREEN_H, backgroundColor: '#000' }}>
      <TouchableWithoutFeedback onPress={handlePress}>
        <View style={StyleSheet.absoluteFill}>
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            nativeControls={false}
          />
          {paused && (
            <View style={styles.pauseOverlay}>
              <Feather name="play" size={56} color="#FFFFFFCC" />
            </View>
          )}
          <Animated.View
            pointerEvents="none"
            style={[styles.heartBurst, {
              opacity: heartBurst,
              transform: [{ scale: heartBurst.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.5] }) }],
            }]}
          >
            <Feather name="heart" size={110} color="#FFFFFF" />
          </Animated.View>
        </View>
      </TouchableWithoutFeedback>

      {/* ─ Right action rail ─ */}
      <View style={[styles.rail, { bottom: tabBarClearance }]}>
        <TouchableOpacity activeOpacity={0.8} onPress={() => onFollow(item.id)} style={styles.railAvatarWrap}>
          <View style={[styles.railAvatar, { backgroundColor: item.avatarColor }]}>
            <Text style={styles.railAvatarText}>{item.initials}</Text>
          </View>
          {!engagement.following && (
            <View style={[styles.railFollowBadge, { backgroundColor: item.accentColor }]}>
              <Feather name="plus" size={11} color="#FFF" />
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.railBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
          onPress={() => { onLike(item.id); bumpHeart(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        >
          <Animated.View style={{ transform: [{ scale: heartScale }] }}>
            <Feather name="heart" size={30} color={engagement.liked ? '#EF4444' : '#FFFFFF'} />
          </Animated.View>
          <Text style={styles.railCount}>{formatCount(engagement.likes)}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.railBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
          onPress={() => onOpenComments(item.id)}
        >
          <Feather name="message-square" size={28} color="#FFFFFF" />
          <Text style={styles.railCount}>{formatCount(engagement.comments.length)}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.railBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
          onPress={() => {
            onRepost(item.id);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }}
        >
          <Feather name="repeat" size={27} color={engagement.reposted ? item.accentColor : '#FFFFFF'} />
          <Text style={styles.railCount}>{formatCount(engagement.reposts)}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.railBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
          onPress={() => { onSave(item.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        >
          <Feather name="bookmark" size={27} color={engagement.saved ? item.accentColor : '#FFFFFF'} />
          <Text style={styles.railCount}>Save</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.railBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
          onPress={() => onShop(item.id)}
        >
          <Feather name="shopping-bag" size={27} color="#FFFFFF" />
          <Text style={styles.railCount}>SHOP</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.railBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 10, left: 10, right: 10 }}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            Share.share({ message: `Check out ${item.productName} by ${item.creator} — ${item.productPrice} 🔥 on Brandthread` });
          }}
        >
          <Feather name="share" size={27} color="#FFFFFF" />
          <Text style={styles.railCount}>{formatCount(item.shares)}</Text>
        </TouchableOpacity>
      </View>

      {/* ─ Bottom-left overlay: chip, shop pill, creator, sound ─ */}
      <View style={[styles.bottomInfo, { bottom: tabBarClearance }]} pointerEvents="box-none">
        <View style={styles.topRowChips}>
          <View style={styles.trendChip}>
            <Text style={styles.trendChipText}>{item.chip}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.shopPill, { backgroundColor: item.accentColor }]}
          activeOpacity={0.85}
          onPress={() => onShop(item.id)}
        >
          <Feather name="shopping-bag" size={13} color="#FFF" />
          <Text style={styles.shopPillText}>
            Shop · {item.productName} {item.productPrice}
          </Text>
        </TouchableOpacity>

        <Text style={styles.caption} numberOfLines={2}>{item.caption}</Text>

        <View style={styles.creatorRow}>
          <Text style={styles.creatorName}>{item.creator}</Text>
          {item.verified && <Feather name="check-circle" size={13} color="#4FA8FF" style={{ marginLeft: 4 }} />}
        </View>
        <View style={styles.soundRow}>
          <Feather name="music" size={12} color="#FFFFFF" />
          <Text style={styles.soundText} numberOfLines={1}>{item.sound}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Comments modal ─────────────────────────────────────────────────────────

function CommentsModal({
  visible, item, onClose, onAddComment,
}: {
  visible: boolean;
  item: SpotlightItem | null;
  onClose: () => void;
  onAddComment: (id: string, text: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  if (!item) return null;

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || !item) return;
    onAddComment(item.id, trimmed);
    setText('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.commentsSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
        >
          <View style={styles.commentsHandle} />
          <Text style={styles.commentsTitle}>{item.comments.length} comments</Text>
          <ScrollView style={{ maxHeight: SCREEN_H * 0.42 }} contentContainerStyle={{ paddingBottom: 8 }}>
            {item.comments.length === 0 ? (
              <Text style={styles.commentsEmpty}>Be the first to comment.</Text>
            ) : item.comments.map(c => (
              <View key={c.id} style={styles.commentRow}>
                <Text style={styles.commentUser}>{c.user}</Text>
                <Text style={styles.commentText}>{c.text}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={styles.commentInputRow}>
            <TextInput
              style={styles.commentInput}
              placeholder="Add a comment…"
              placeholderTextColor="#8C8577"
              value={text}
              onChangeText={setText}
              onSubmitEditing={submit}
              returnKeyType="send"
            />
            <TouchableOpacity style={styles.commentSendBtn} activeOpacity={0.75} onPress={submit}>
              <Feather name="send" size={17} color="#FFF" />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const scheme = useColorScheme();
  const isDark = scheme !== 'light';

  const [engagements, setEngagements] = useState<Record<string, EngagementState>>(() => {
    const init: Record<string, EngagementState> = {};
    SPOTLIGHT_ITEMS.forEach(item => { init[item.id] = initialEngagement(item); });
    return init;
  });
  const [activeIndex, setActiveIndex] = useState(0);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [commentsFor, setCommentsFor] = useState<string | null>(null);
  const [showNotifs, setShowNotifs] = useState(false);
  const [hasUnread, setHasUnread] = useState(true);

  const displayItems = searchQuery.trim()
    ? SPOTLIGHT_ITEMS.filter(item => {
        const q = searchQuery.toLowerCase();
        return item.creator.toLowerCase().includes(q) ||
          item.handle.toLowerCase().includes(q) ||
          item.productName.toLowerCase().includes(q);
      })
    : SPOTLIGHT_ITEMS;

  function update(id: string, patch: Partial<EngagementState> | ((e: EngagementState) => Partial<EngagementState>)) {
    setEngagements(prev => {
      const cur = prev[id];
      const delta = typeof patch === 'function' ? patch(cur) : patch;
      return { ...prev, [id]: { ...cur, ...delta } };
    });
  }

  const handleLike = useCallback((id: string) => {
    update(id, e => ({ liked: !e.liked, likes: e.liked ? e.likes - 1 : e.likes + 1 }));
  }, []);

  const handleDoubleTapLike = useCallback((id: string) => {
    setEngagements(prev => {
      const e = prev[id];
      if (e.liked) return prev;
      return { ...prev, [id]: { ...e, liked: true, likes: e.likes + 1 } };
    });
  }, []);

  const handleSave = useCallback((id: string) => update(id, e => ({ saved: !e.saved })), []);
  const handleRepost = useCallback((id: string) => update(id, e => ({
    reposted: !e.reposted, reposts: e.reposted ? e.reposts - 1 : e.reposts + 1,
  })), []);
  const handleFollow = useCallback((id: string) => update(id, e => ({ following: !e.following })), []);

  const handleAddComment = useCallback((id: string, text: string) => {
    update(id, e => ({ comments: [...e.comments, { id: `c${Date.now()}`, user: '@you', text }] }));
  }, []);

  function handleShop(id: string) {
    const item = SPOTLIGHT_ITEMS.find(i => i.id === id);
    if (!item) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      item.creator,
      `${item.productName} · ${item.productPrice}${item.productOriginalPrice ? `\nWas ${item.productOriginalPrice}` : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: '🔖 Save for later', onPress: () => handleSave(id) },
        { text: '🛍️ Add to Bag', onPress: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) },
      ],
    );
  }

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].index != null) {
      setActiveIndex(viewableItems[0].index);
    }
  }).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  const commentsItem = commentsFor ? SPOTLIGHT_ITEMS.find(i => i.id === commentsFor) ?? null : null;
  const commentsEngagement = commentsFor ? engagements[commentsFor] : null;
  const commentsItemWithLive = commentsItem && commentsEngagement
    ? { ...commentsItem, comments: commentsEngagement.comments }
    : null;

  return (
    <View style={styles.container}>
      <FlatList
        data={displayItems}
        keyExtractor={item => item.id}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={SCREEN_H}
        decelerationRate="fast"
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(_, index) => ({ length: SCREEN_H, offset: SCREEN_H * index, index })}
        ListEmptyComponent={
          <View style={{ width: SCREEN_W, height: SCREEN_H, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <Feather name="search" size={32} color="#8C8577" />
            <Text style={{ fontSize: 15, fontFamily: 'Inter_500Medium', color: '#8C8577' }}>
              No results for "{searchQuery}"
            </Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <SpotlightPage
            item={item}
            isActive={index === activeIndex && !commentsFor && !showNotifs}
            engagement={engagements[item.id]}
            onLike={handleLike}
            onDoubleTapLike={handleDoubleTapLike}
            onSave={handleSave}
            onRepost={handleRepost}
            onFollow={handleFollow}
            onOpenComments={setCommentsFor}
            onShop={handleShop}
          />
        )}
      />

      {/* ─ Top bar overlay ─ */}
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
        {showSearch ? (
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search creators, products…"
              placeholderTextColor="#FFFFFF99"
              autoFocus
            />
            <TouchableOpacity
              style={styles.topIconBtn}
              activeOpacity={0.7}
              onPress={() => { setShowSearch(false); setSearchQuery(''); }}
            >
              <Feather name="x" size={20} color="#FFF" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.topRow}>
            <TouchableOpacity
              style={styles.topAvatarBtn}
              activeOpacity={0.75}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              onPress={() => { setShowNotifs(true); setHasUnread(false); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            >
              <View style={[styles.topAvatar, { backgroundColor: isDark ? '#33302A' : '#DBD3C0' }]}>
                <Feather name="user" size={16} color="#FFF" />
              </View>
              {hasUnread && <View style={styles.unreadDot} />}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.topIconBtn}
              activeOpacity={0.7}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowSearch(true); }}
            >
              <Feather name="search" size={21} color="#FFF" />
            </TouchableOpacity>

            <Text style={styles.topTitle}>Spotlight</Text>

            <TouchableOpacity
              style={styles.topIconBtn}
              activeOpacity={0.7}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                Alert.alert('Invite Friends', 'Share Brandthread with friends to earn drop invites.', [{ text: 'OK' }]);
              }}
            >
              <Feather name="user-plus" size={20} color="#FFF" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.topIconBtn}
              activeOpacity={0.7}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/story-picker' as never); }}
            >
              <Feather name="plus-square" size={21} color="#FFF" />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* ─ Notifications sheet ─ */}
      <Modal visible={showNotifs} animationType="slide" transparent onRequestClose={() => setShowNotifs(false)}>
        <View style={styles.modalBackdrop}>
          <TouchableWithoutFeedback onPress={() => setShowNotifs(false)}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <View style={[styles.commentsSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.commentsHandle} />
            <Text style={styles.commentsTitle}>Notifications</Text>
            <View style={{ gap: 14, paddingTop: 4 }}>
              <Text style={styles.notifRow}>❤️ NXGEN liked your comment on Ripstop Cargo Trousers</Text>
              <Text style={styles.notifRow}>👤 Meridian Co. started following you</Text>
              <Text style={styles.notifRow}>💬 @street.era replied to your comment</Text>
            </View>
          </View>
        </View>
      </Modal>

      <CommentsModal
        visible={!!commentsFor}
        item={commentsItemWithLive}
        onClose={() => setCommentsFor(null)}
        onAddComment={handleAddComment}
      />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },

  pauseOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  heartBurst: { position: 'absolute', top: '38%', left: '50%', marginLeft: -55, marginTop: -55 },

  rail: {
    position: 'absolute', right: 10, bottom: 116, alignItems: 'center', gap: 18,
  },
  railAvatarWrap: { alignItems: 'center', marginBottom: 4 },
  railAvatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF' },
  railAvatarText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  railFollowBadge: {
    position: 'absolute', bottom: -8, width: 19, height: 19, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#000',
  },
  railBtn: { alignItems: 'center', gap: 3 },
  railCount: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },

  bottomInfo: { position: 'absolute', left: 16, right: 84, bottom: 26, gap: 8 },
  topRowChips: { flexDirection: 'row' },
  trendChip: { alignSelf: 'flex-start', backgroundColor: '#FFFFFF26', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  trendChipText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },

  shopPill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 12, minHeight: 34, borderRadius: 17 },
  shopPillText: { fontSize: 12.5, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  caption: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#FFFFFF', lineHeight: 19 },
  creatorRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  creatorName: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  soundRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  soundText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#FFFFFFCC', flexShrink: 1 },

  topBar: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 14, paddingBottom: 8 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  topAvatarBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topAvatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  unreadDot: { position: 'absolute', top: 4, right: 4, width: 9, height: 9, borderRadius: 4.5, backgroundColor: '#EF4444', borderWidth: 1.5, borderColor: '#000' },
  topIconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: {
    flex: 1, height: 40, borderRadius: 20, borderWidth: 1, borderColor: '#FFFFFF40',
    backgroundColor: '#00000066', paddingHorizontal: 14, fontSize: 14, fontFamily: 'Inter_400Regular', color: '#FFFFFF',
  },

  modalBackdrop: { flex: 1, backgroundColor: '#00000090', justifyContent: 'flex-end' },
  commentsSheet: {
    backgroundColor: '#161412', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 10, paddingHorizontal: 18,
  },
  commentsHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#4A463D', alignSelf: 'center', marginBottom: 10 },
  commentsTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF', marginBottom: 10 },
  commentsEmpty: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#8C8577', paddingVertical: 20, textAlign: 'center' },
  commentRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#26231D' },
  commentUser: { fontSize: 12.5, fontFamily: 'Inter_700Bold', color: '#C94D1F', marginBottom: 2 },
  commentText: { fontSize: 13.5, fontFamily: 'Inter_400Regular', color: '#EDE7D9' },
  commentInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#26231D' },
  commentInput: {
    flex: 1, height: 40, borderRadius: 20, backgroundColor: '#221F1A',
    paddingHorizontal: 14, fontSize: 13.5, fontFamily: 'Inter_400Regular', color: '#FFFFFF',
  },
  commentSendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#C94D1F', alignItems: 'center', justifyContent: 'center' },

  notifRow: { fontSize: 13.5, fontFamily: 'Inter_400Regular', color: '#EDE7D9', paddingBottom: 14 },
});
