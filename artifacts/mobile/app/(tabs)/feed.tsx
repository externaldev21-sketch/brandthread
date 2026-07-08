import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, ScrollView, TouchableOpacity,
  useColorScheme, Dimensions, Animated, Alert, Share, TextInput,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_W } = Dimensions.get('window');

// Pick a readable ink/white foreground for a given flat background color.
function readableOn(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#17140F' : '#FFFFFF';
}

// ─── Mock feed data ──────────────────────────────────────────────────────────

const FEED_ITEMS = [
  {
    id: '1',
    brand: 'Vault Studio',
    brandHandle: '@vaultstudio',
    avatar: '#B33F1E',
    avatarInitials: 'VS',
    verified: true,
    timeAgo: '2h',
    caption: 'New drop just landed 🔥 Oversized canvas jacket — limited run of 50. Grab yours before they\'re gone.',
    tags: ['streetwear', 'newdrop', 'limitededition'],
    productName: 'Canvas Cargo Jacket',
    productPrice: '$189',
    productOriginalPrice: null,
    accentColor: '#C94D1F',
    likes: 1240,
    comments: 87,
    shares: 34,
    saved: false,
    liked: false,
  },
  {
    id: '2',
    brand: 'Meridian Co.',
    brandHandle: '@meridianclothing',
    avatar: '#0F766E',
    avatarInitials: 'MC',
    verified: false,
    timeAgo: '5h',
    caption: 'Clean minimalist tees now in 8 colorways. Because basics shouldn\'t be boring. Pre-order open now.',
    tags: ['minimal', 'essentials', 'preorder'],
    productName: 'Essential Relaxed Tee',
    productPrice: '$48',
    productOriginalPrice: null,
    accentColor: '#14B8A6',
    likes: 892,
    comments: 44,
    shares: 21,
    saved: true,
    liked: true,
  },
  {
    id: '3',
    brand: 'NXGEN',
    brandHandle: '@nxgendrops',
    avatar: '#B45309',
    avatarInitials: 'NX',
    verified: true,
    timeAgo: '1d',
    caption: 'The cargo trousers everyone\'s been asking about. Heavyweight ripstop, 8 pockets, tapered fit. Back in stock 🙌',
    tags: ['cargo', 'streetwear', 'restock'],
    productName: 'Ripstop Cargo Trousers',
    productPrice: '$134',
    productOriginalPrice: '$160',
    accentColor: '#B98A2E',
    likes: 3410,
    comments: 215,
    shares: 98,
    saved: false,
    liked: false,
  },
  {
    id: '4',
    brand: 'Softwear',
    brandHandle: '@softwearstudio',
    avatar: '#BE185D',
    avatarInitials: 'SW',
    verified: false,
    timeAgo: '1d',
    caption: 'Sunday hoodies are here. 400gsm French terry, dropped shoulders, washed finish. The only hoodie you\'ll need this season.',
    tags: ['hoodie', 'loungewear', 'heavyweight'],
    productName: 'Sunday Washed Hoodie',
    productPrice: '$98',
    productOriginalPrice: null,
    accentColor: '#EC4899',
    likes: 2180,
    comments: 132,
    shares: 67,
    saved: false,
    liked: false,
  },
  {
    id: '5',
    brand: 'Atlas Goods',
    brandHandle: '@atlasgoods',
    avatar: '#1D4ED8',
    avatarInitials: 'AG',
    verified: true,
    timeAgo: '2d',
    caption: 'Workwear inspired, streetwear executed. Our new chore coat is built for the city. Available now in sand and slate.',
    tags: ['workwear', 'chorejacket', 'newseason'],
    productName: 'City Chore Coat',
    productPrice: '$215',
    productOriginalPrice: '$260',
    accentColor: '#4A6FA5',
    likes: 975,
    comments: 58,
    shares: 29,
    saved: true,
    liked: false,
  },
];

// ─── Stories (followed users) ────────────────────────────────────────────────

const STORIES = [
  { id: 's1', name: 'vaultstudio',  initials: 'VS', color: '#B33F1E', viewed: false },
  { id: 's2', name: 'meridian.co',  initials: 'MC', color: '#0F766E', viewed: false },
  { id: 's3', name: 'nxgendrops',   initials: 'NX', color: '#B45309', viewed: true  },
  { id: 's4', name: 'softwear__',   initials: 'SW', color: '#BE185D', viewed: false },
  { id: 's5', name: 'atlasgoods',   initials: 'AG', color: '#1D4ED8', viewed: true  },
  { id: 's6', name: 'coldform',     initials: 'CF', color: '#065F46', viewed: false },
  { id: 's7', name: 'rawthread',    initials: 'RT', color: '#92400E', viewed: false },
];

// ─── Feed card ───────────────────────────────────────────────────────────────

function FeedCard({
  item, isDark, onLike, onSave, following, onFollow,
}: {
  item: typeof FEED_ITEMS[0];
  isDark: boolean;
  onLike: (id: string) => void;
  onSave: (id: string) => void;
  following: boolean;
  onFollow: (id: string) => void;
}) {
  const router  = useRouter();
  const bg      = isDark ? '#1B1917' : '#FFFFFF';
  const border  = isDark ? '#33302A' : '#E8E1CF';
  const fg      = isDark ? '#EDE7D9' : '#17140F';
  const muted   = isDark ? '#8C8577' : '#6E6759';
  const tagBg   = isDark ? '#201D18' : '#EDE7D9';
  const tagFg   = isDark ? '#C94D1F' : '#B33F1E';

  const heartScale = useRef(new Animated.Value(1)).current;

  function handleLike() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.sequence([
      Animated.spring(heartScale, { toValue: 1.4, useNativeDriver: true, speed: 40 }),
      Animated.spring(heartScale, { toValue: 1,   useNativeDriver: true, speed: 40 }),
    ]).start();
    onLike(item.id);
  }

  function handleSave() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSave(item.id);
  }

  return (
    <View style={[styles.card, { backgroundColor: bg, borderColor: border }]}>

      {/* ─ Brand header ─ */}
      <View style={styles.cardHeader}>
        <View style={[styles.avatar, { backgroundColor: item.avatar }]}>
          <Text style={styles.avatarText}>{item.avatarInitials}</Text>
        </View>
        <View style={styles.brandInfo}>
          <View style={styles.brandNameRow}>
            <Text style={[styles.brandName, { color: fg }]}>{item.brand}</Text>
            {item.verified && (
              <Feather name="check-circle" size={13} color={item.accentColor} style={{ marginLeft: 4 }} />
            )}
          </View>
          <Text style={[styles.brandHandle, { color: muted }]}>{item.brandHandle} · {item.timeAgo}</Text>
        </View>
        <TouchableOpacity
          style={[styles.followBtn, { borderColor: item.accentColor, backgroundColor: following ? item.accentColor : 'transparent' }]}
          activeOpacity={0.75}
          onPress={() => onFollow(item.id)}
        >
          <Text style={[styles.followText, { color: following ? '#FFF' : item.accentColor }]}>
            {following ? 'Following' : 'Follow'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ─ Product visual ─ */}
      {(() => {
        const onAccent = readableOn(item.accentColor);
        const isLight  = onAccent === '#17140F';
        return (
          <View style={[styles.productVisual, { backgroundColor: item.accentColor }]}>
            <View style={styles.productIcon}>
              <Feather name="package" size={26} color={item.accentColor} />
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={[styles.productCardName, { color: onAccent }]} numberOfLines={1}>{item.productName}</Text>
              <View style={styles.priceRow}>
                <Text style={[styles.productCardPrice, { color: onAccent }]}>{item.productPrice}</Text>
                {item.productOriginalPrice && (
                  <Text style={[styles.originalPrice, { color: isLight ? '#17140F80' : '#FFFFFFA0' }]}>{item.productOriginalPrice}</Text>
                )}
              </View>
            </View>
          </View>
        );
      })()}

      {/* ─ Caption + tags ─ */}
      <View style={styles.captionBlock}>
        <Text style={[styles.caption, { color: fg }]}>{item.caption}</Text>
        <View style={styles.tagsRow}>
          {item.tags.map(tag => (
            <View key={tag} style={[styles.tag, { backgroundColor: tagBg }]}>
              <Text style={[styles.tagText, { color: tagFg }]}>#{tag}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ─ Actions ─ */}
      <View style={[styles.actions, { borderTopColor: border }]}>
        <View style={styles.actionsLeft}>
          <TouchableOpacity style={styles.actionBtn} onPress={handleLike} activeOpacity={0.7}>
            <Animated.View style={{ transform: [{ scale: heartScale }] }}>
              <Feather
                name="heart"
                size={20}
                color={item.liked ? '#EF4444' : muted}
              />
            </Animated.View>
            <Text style={[styles.actionCount, { color: muted }]}>
              {item.liked ? item.likes + 1 : item.likes}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtn}
            activeOpacity={0.7}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              Alert.alert(`Message ${item.brand}`, `Send a DM to ${item.brandHandle}?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Message', onPress: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) },
              ]);
            }}
          >
            <Feather name="message-circle" size={20} color={muted} />
            <Text style={[styles.actionCount, { color: muted }]}>{item.comments}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtn}
            activeOpacity={0.7}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              Share.share({ message: `Check out ${item.productName} by ${item.brand} — ${item.productPrice} 🔥 on Brandthread` });
            }}
          >
            <Feather name="share-2" size={20} color={muted} />
            <Text style={[styles.actionCount, { color: muted }]}>{item.shares}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.actionsRight}>
          <TouchableOpacity style={styles.actionBtn} onPress={handleSave} activeOpacity={0.7}>
            <Feather
              name="bookmark"
              size={20}
              color={item.saved ? item.accentColor : muted}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.shopBtn, { backgroundColor: item.accentColor }]}
            activeOpacity={0.85}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              Alert.alert(
                item.brand,
                `${item.productName} · ${item.productPrice}${item.productOriginalPrice ? `\nWas ${item.productOriginalPrice}` : ''}`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: '🔖 Save for later', onPress: () => onSave(item.id) },
                  { text: '🛍️ Add to Bag', onPress: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) },
                ],
              );
            }}
          >
            <Feather name="shopping-bag" size={13} color="#FFF" />
            <Text style={styles.shopBtnText}>Shop</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function FeedScreen({ showStories = true }: { showStories?: boolean }) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme !== 'light';

  const bg      = isDark ? '#121110' : '#F2EEE3';
  const fg      = isDark ? '#EDE7D9' : '#17140F';
  const muted   = isDark ? '#8C8577' : '#6E6759';
  const border  = isDark ? '#33302A' : '#DBD3C0';
  const primary = isDark ? '#C94D1F' : '#B33F1E';

  const [items,        setItems]        = useState(FEED_ITEMS);
  const [stories,      setStories]      = useState(STORIES);
  const [followed,     setFollowed]     = useState<Record<string, boolean>>({});
  const [showSearch,   setShowSearch]   = useState(false);
  const [searchQuery,  setSearchQuery]  = useState('');
  const [followingOnly, setFollowingOnly] = useState(false);

  const displayItems = (() => {
    let result = followingOnly ? items.filter(item => !!followed[item.id]) : items;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(item =>
        item.brand.toLowerCase().includes(q) ||
        item.productName.toLowerCase().includes(q) ||
        item.tags.some(t => t.toLowerCase().includes(q)),
      );
    }
    return result;
  })();

  function handleViewStory(id: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStories(prev => prev.map(s => s.id === id ? { ...s, viewed: true } : s));
  }

  function handleLike(id: string) {
    setItems(prev => prev.map(item =>
      item.id === id ? { ...item, liked: !item.liked } : item,
    ));
  }

  function handleSave(id: string) {
    setItems(prev => prev.map(item =>
      item.id === id ? { ...item, saved: !item.saved } : item,
    ));
  }

  function handleFollow(id: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFollowed(prev => ({ ...prev, [id]: !prev[id] }));
  }

  function toggleSearch() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (showSearch) { setShowSearch(false); setSearchQuery(''); }
    else setShowSearch(true);
  }

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      {/* ─ Header ─ */}
      <View style={[styles.header, { paddingTop: insets.top + 16, borderBottomColor: border }]}>
        {showSearch ? (
          <TextInput
            style={[styles.searchBar, { color: fg, backgroundColor: isDark ? '#1D1A15' : '#E8E1CF', borderColor: border }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search brands, products…"
            placeholderTextColor={muted}
            autoFocus
          />
        ) : (
          <Text style={[styles.headerTitle, { color: fg }]}>Feed</Text>
        )}
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.headerIconBtn} activeOpacity={0.7} onPress={toggleSearch}>
            <Feather name={showSearch ? 'x' : 'search'} size={20} color={showSearch ? primary : muted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerIconBtn}
            activeOpacity={0.7}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              Alert.alert('Filter Feed', 'Show posts from:', [
                { text: 'Everyone',       onPress: () => { setFollowingOnly(false); setSearchQuery(''); } },
                { text: 'Following only', onPress: () => { setFollowingOnly(true);  setSearchQuery(''); } },
                { text: 'Cancel', style: 'cancel' },
              ]);
            }}
          >
            <Feather name="sliders" size={20} color={muted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ─ Stories row — seller/both only ─ */}
      {showStories && (
        <View style={[styles.storiesRow, { borderBottomColor: border }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.storiesScroll}
          >
            {stories.map((story) => (
              <TouchableOpacity
                key={story.id}
                onPress={() => handleViewStory(story.id)}
                activeOpacity={0.8}
                style={styles.storyItem}
              >
                {story.viewed ? (
                  <View style={[styles.storyRingViewed, { borderColor: border }]}>
                    <View style={[styles.storyAvatar, { backgroundColor: story.color }]}>
                      <Text style={styles.storyInitials}>{story.initials}</Text>
                    </View>
                  </View>
                ) : (
                  <LinearGradient
                    colors={['#D9714B', '#C1440E', '#B33F1E']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.storyRing}
                  >
                    <View style={[styles.storyAvatarInner, { backgroundColor: isDark ? '#121110' : '#F2EEE3' }]}>
                      <View style={[styles.storyAvatar, { backgroundColor: story.color }]}>
                        <Text style={styles.storyInitials}>{story.initials}</Text>
                      </View>
                    </View>
                  </LinearGradient>
                )}
                <Text style={[styles.storyName, { color: muted }]} numberOfLines={1}>
                  {story.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* ─ Feed ─ */}
      <FlatList
        data={displayItems}
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingVertical: 12, paddingHorizontal: 16, paddingBottom: 120, gap: 16 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 60, gap: 10 }}>
            <Feather name="search" size={32} color={muted} />
            <Text style={{ fontSize: 15, fontFamily: 'Inter_500Medium', color: muted }}>
              No results for "{searchQuery}"
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <FeedCard
            item={item}
            isDark={isDark}
            onLike={handleLike}
            onSave={handleSave}
            following={!!followed[item.id]}
            onFollow={handleFollow}
          />
        )}
      />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', letterSpacing: -0.6 },
  headerRight: { flexDirection: 'row', gap: 8 },
  headerIconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  searchBar: { flex: 1, height: 36, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, fontSize: 14, fontFamily: 'Inter_400Regular', marginRight: 4 },

  storiesRow:    { borderBottomWidth: 1, height: 100 },
  storiesScroll: { paddingHorizontal: 16, paddingVertical: 10, gap: 14, alignItems: 'center' },
  storyItem:     { alignItems: 'center', gap: 5, width: 62 },
  storyRing:     { width: 62, height: 62, borderRadius: 31, padding: 2.5, alignItems: 'center', justifyContent: 'center' },
  storyRingViewed: { width: 62, height: 62, borderRadius: 31, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  storyAvatarInner: { width: 55, height: 55, borderRadius: 28, padding: 2, alignItems: 'center', justifyContent: 'center' },
  storyAvatar:   { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  storyInitials: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  storyName:     { fontSize: 10, fontFamily: 'Inter_500Medium', textAlign: 'center', width: 62 },

  card: { borderRadius: 6, borderWidth: 1, overflow: 'hidden' },

  cardHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  brandInfo: { flex: 1 },
  brandNameRow: { flexDirection: 'row', alignItems: 'center' },
  brandName: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  brandHandle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 1 },
  followBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 4, borderWidth: 1 },
  followText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  productVisual: {
    flexDirection: 'row', alignItems: 'center', padding: 16,
  },
  productIcon: { width: 48, height: 48, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  productCardName: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 },
  productCardPrice: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  originalPrice: { fontSize: 12, fontFamily: 'Inter_400Regular', textDecorationLine: 'line-through' },

  captionBlock: { paddingHorizontal: 14, paddingBottom: 10, gap: 8 },
  caption: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  tagText: { fontSize: 12, fontFamily: 'Inter_500Medium' },

  actions: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1,
  },
  actionsLeft: { flexDirection: 'row', gap: 4 },
  actionsRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 6, paddingVertical: 4 },
  actionCount: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  shopBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 6,
  },
  shopBtnText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
});
