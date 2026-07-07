import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  useColorScheme, Dimensions, Animated, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_W } = Dimensions.get('window');

// ─── Mock feed data ──────────────────────────────────────────────────────────

const FEED_ITEMS = [
  {
    id: '1',
    brand: 'Vault Studio',
    brandHandle: '@vaultstudio',
    avatar: '#7C3AED',
    avatarInitials: 'VS',
    verified: true,
    timeAgo: '2h',
    caption: 'New drop just landed 🔥 Oversized canvas jacket — limited run of 50. Grab yours before they\'re gone.',
    tags: ['streetwear', 'newdrop', 'limitededition'],
    productName: 'Canvas Cargo Jacket',
    productPrice: '$189',
    productOriginalPrice: null,
    cardColor: '#1A0A2E',
    accentColor: '#9F7AEA',
    patternColor: '#2D1060',
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
    cardColor: '#0A1F1E',
    accentColor: '#14B8A6',
    patternColor: '#0D2929',
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
    cardColor: '#1C1000',
    accentColor: '#F59E0B',
    patternColor: '#2A1A00',
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
    cardColor: '#1A0010',
    accentColor: '#EC4899',
    patternColor: '#2A0018',
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
    cardColor: '#020B1A',
    accentColor: '#3B82F6',
    patternColor: '#071226',
    likes: 975,
    comments: 58,
    shares: 29,
    saved: true,
    liked: false,
  },
];

// ─── Feed card ───────────────────────────────────────────────────────────────

function FeedCard({
  item,
  isDark,
  onLike,
  onSave,
}: {
  item: typeof FEED_ITEMS[0];
  isDark: boolean;
  onLike: (id: string) => void;
  onSave: (id: string) => void;
}) {
  const bg      = isDark ? '#111118' : '#FFFFFF';
  const border  = isDark ? '#1E1E30' : '#EDE9FE';
  const fg      = isDark ? '#F0EEFF' : '#1A1035';
  const muted   = isDark ? '#6B6B8A' : '#6D6892';
  const tagBg   = isDark ? '#1C1C2E' : '#F0EEFF';
  const tagFg   = isDark ? '#9F7AEA' : '#7C3AED';

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
          style={[styles.followBtn, { borderColor: item.accentColor }]}
          activeOpacity={0.75}
        >
          <Text style={[styles.followText, { color: item.accentColor }]}>Follow</Text>
        </TouchableOpacity>
      </View>

      {/* ─ Product visual ─ */}
      <View style={[styles.productVisual, { backgroundColor: item.cardColor }]}>
        {/* Background pattern circles */}
        <View style={[styles.patternCircle, styles.patternCircle1, { backgroundColor: item.patternColor }]} />
        <View style={[styles.patternCircle, styles.patternCircle2, { backgroundColor: item.patternColor }]} />
        {/* Product card */}
        <View style={[styles.productCard, { backgroundColor: item.patternColor, borderColor: `${item.accentColor}40` }]}>
          <View style={[styles.productIcon, { backgroundColor: `${item.accentColor}25` }]}>
            <Feather name="package" size={28} color={item.accentColor} />
          </View>
          <Text style={[styles.productCardName, { color: '#FFFFFF' }]}>{item.productName}</Text>
          <View style={styles.priceRow}>
            <Text style={[styles.productCardPrice, { color: item.accentColor }]}>{item.productPrice}</Text>
            {item.productOriginalPrice && (
              <Text style={styles.originalPrice}>{item.productOriginalPrice}</Text>
            )}
          </View>
        </View>
      </View>

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

          <TouchableOpacity style={styles.actionBtn} activeOpacity={0.7}>
            <Feather name="message-circle" size={20} color={muted} />
            <Text style={[styles.actionCount, { color: muted }]}>{item.comments}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionBtn} activeOpacity={0.7}>
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

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme !== 'light';

  const bg      = isDark ? '#08080F' : '#F8F7FF';
  const fg      = isDark ? '#F0EEFF' : '#1A1035';
  const muted   = isDark ? '#6B6B8A' : '#6D6892';
  const border  = isDark ? '#1E1E30' : '#DDD6FE';
  const primary = isDark ? '#9F7AEA' : '#7C3AED';

  const [items, setItems] = useState(FEED_ITEMS);
  const [activeFilter, setActiveFilter] = useState('For you');
  const filters = ['For you', 'Following', 'Drops', 'Pre-order', 'Trending'];

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

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      {/* ─ Header ─ */}
      <View style={[styles.header, { paddingTop: insets.top + 16, borderBottomColor: border }]}>
        <Text style={[styles.headerTitle, { color: fg }]}>Feed</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.headerIconBtn} activeOpacity={0.7}>
            <Feather name="search" size={20} color={muted} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerIconBtn} activeOpacity={0.7}>
            <Feather name="sliders" size={20} color={muted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ─ Filter pills ─ */}
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={filters}
        keyExtractor={f => f}
        contentContainerStyle={styles.filtersScroll}
        style={{ flexGrow: 0, borderBottomWidth: 1, borderBottomColor: border }}
        renderItem={({ item: filter }) => {
          const active = filter === activeFilter;
          return (
            <TouchableOpacity
              onPress={() => setActiveFilter(filter)}
              style={[
                styles.filterPill,
                active
                  ? { backgroundColor: primary }
                  : { backgroundColor: 'transparent', borderColor: border, borderWidth: 1 },
              ]}
              activeOpacity={0.75}
            >
              <Text
                style={[styles.filterText, { color: active ? '#FFFFFF' : muted }]}
                numberOfLines={1}
              >
                {filter}
              </Text>
            </TouchableOpacity>
          );
        }}
      />

      {/* ─ Feed ─ */}
      <FlatList
        data={items}
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingVertical: 12, paddingHorizontal: 16, paddingBottom: 120, gap: 16 }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <FeedCard
            item={item}
            isDark={isDark}
            onLike={handleLike}
            onSave={handleSave}
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

  filtersScroll: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  filterPill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, flexShrink: 0 },
  filterText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', flexShrink: 0 },

  card: { borderRadius: 20, borderWidth: 1, overflow: 'hidden' },

  cardHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  brandInfo: { flex: 1 },
  brandNameRow: { flexDirection: 'row', alignItems: 'center' },
  brandName: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  brandHandle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 1 },
  followBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  followText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  productVisual: {
    height: 200, alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  patternCircle: { position: 'absolute', borderRadius: 999 },
  patternCircle1: { width: 240, height: 240, top: -80, right: -60 },
  patternCircle2: { width: 160, height: 160, bottom: -60, left: -40 },
  productCard: {
    width: SCREEN_W * 0.55, padding: 18, borderRadius: 18, borderWidth: 1,
    alignItems: 'center', gap: 8,
  },
  productIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  productCardName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  productCardPrice: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  originalPrice: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#FFFFFF60', textDecorationLine: 'line-through' },

  captionBlock: { paddingHorizontal: 14, paddingBottom: 10, gap: 8 },
  caption: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
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
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
  },
  shopBtnText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
});
