import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  useColorScheme, FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

// ─── Mock data ────────────────────────────────────────────────────────────────

const FRIENDS = [
  { id: 'f1', name: 'Maya Chen',   handle: '@mayachen',   initials: 'MC', color: '#BE185D', hasNew: true,  activity: 'saved 3 items from Vault Studio' },
  { id: 'f2', name: 'Jordan Lee',  handle: '@jordanlee',  initials: 'JL', color: '#1D4ED8', hasNew: true,  activity: 'posted a fit check' },
  { id: 'f3', name: 'Amir Patel',  handle: '@amirpatel',  initials: 'AP', color: '#0F766E', hasNew: false, activity: 'copped the NxGen hoodie' },
  { id: 'f4', name: 'Sofia Reyes', handle: '@sofiareyes', initials: 'SR', color: '#B45309', hasNew: true,  activity: 'shared her wishlist' },
  { id: 'f5', name: 'Kai Nakamura',handle: '@kainakamura',initials: 'KN', color: '#7C3AED', hasNew: false, activity: 'liked a drop from Atlas Goods' },
];

const FRIEND_POSTS = [
  {
    id: 'p1',
    friend: 'Maya Chen',
    friendInitials: 'MC',
    friendColor: '#BE185D',
    timeAgo: '1h',
    type: 'wishlist' as const,
    caption: 'Can\'t decide between these two 😩',
    items: [
      { name: 'Canvas Cargo Jacket', brand: 'Vault Studio', price: '$189', color: '#7C3AED', initials: 'VS' },
      { name: 'Micro-Fleece Jogger',  brand: 'Softwear__',   price: '$92',  color: '#BE185D', initials: 'SW' },
    ],
    likes: 14,
    comments: 6,
    liked: false,
  },
  {
    id: 'p2',
    friend: 'Jordan Lee',
    friendInitials: 'JL',
    friendColor: '#1D4ED8',
    timeAgo: '3h',
    type: 'cop' as const,
    caption: 'Finally copped 🙌 been waiting weeks for this restock.',
    items: [
      { name: 'Archive Hoodie Vol.3', brand: 'NxGen Drops', price: '$135', color: '#B45309', initials: 'NX' },
    ],
    likes: 31,
    comments: 9,
    liked: true,
  },
  {
    id: 'p3',
    friend: 'Sofia Reyes',
    friendInitials: 'SR',
    friendColor: '#B45309',
    timeAgo: '5h',
    type: 'wishlist' as const,
    caption: 'This season\'s grail list 🔥 @ me if you copped any of these',
    items: [
      { name: 'Utility Vest — Slate', brand: 'Atlas Goods', price: '$220', color: '#1D4ED8', initials: 'AG' },
      { name: 'Raw Denim Jacket',     brand: 'Coldform',    price: '$310', color: '#065F46', initials: 'CF' },
    ],
    likes: 22,
    comments: 13,
    liked: false,
  },
];

// ─── Friend post card ─────────────────────────────────────────────────────────

function FriendCard({
  post, isDark,
  onLike,
}: {
  post: typeof FRIEND_POSTS[0];
  isDark: boolean;
  onLike: (id: string) => void;
}) {
  const card   = isDark ? '#111118' : '#FFFFFF';
  const border = isDark ? '#1E1E30' : '#E8E6F0';
  const fg     = isDark ? '#F0EEFF' : '#1A1035';
  const muted  = isDark ? '#6B6B8A' : '#6D6892';
  const tagBg  = isDark ? '#1C1C2E' : '#F0EEFF';
  const tagFg  = isDark ? '#9F7AEA' : '#7C3AED';

  const typeLabel = post.type === 'cop' ? '✅ Copped' : '🔖 Wishlist';
  const typeColor = post.type === 'cop' ? '#16A34A' : tagFg;
  const typeBg    = post.type === 'cop' ? (isDark ? '#16A34A18' : '#F0FDF4') : tagBg;

  return (
    <View style={[s.card, { backgroundColor: card, borderColor: border }]}>
      {/* Header */}
      <View style={s.cardHeader}>
        <View style={[s.avatar, { backgroundColor: post.friendColor }]}>
          <Text style={s.avatarText}>{post.friendInitials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.friendName, { color: fg }]}>{post.friend}</Text>
          <Text style={[s.timeAgo, { color: muted }]}>{post.timeAgo} ago</Text>
        </View>
        <View style={[s.typePill, { backgroundColor: typeBg }]}>
          <Text style={[s.typeText, { color: typeColor }]}>{typeLabel}</Text>
        </View>
      </View>

      {/* Caption */}
      <Text style={[s.caption, { color: fg }]}>{post.caption}</Text>

      {/* Items */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10, paddingHorizontal: 14, paddingBottom: 4 }}
      >
        {post.items.map((item, i) => (
          <View key={i} style={[s.itemCard, { borderColor: item.color + '40' }]}>
            <LinearGradient
              colors={[item.color + 'CC', item.color + '44']}
              style={s.itemVisual}
            >
              <View style={[s.itemIcon, { backgroundColor: '#FFFFFF25' }]}>
                <Feather name="shopping-bag" size={18} color="#FFF" />
              </View>
            </LinearGradient>
            <View style={{ padding: 8 }}>
              <Text style={[s.itemBrand, { color: muted }]} numberOfLines={1}>{item.brand}</Text>
              <Text style={[s.itemName, { color: fg }]} numberOfLines={2}>{item.name}</Text>
              <Text style={[s.itemPrice, { color: item.color }]}>{item.price}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Actions */}
      <View style={[s.actions, { borderTopColor: border }]}>
        <TouchableOpacity
          style={s.actionBtn}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onLike(post.id); }}
          activeOpacity={0.7}
        >
          <Feather name="heart" size={18} color={post.liked ? '#EF4444' : muted} />
          <Text style={[s.actionCount, { color: muted }]}>
            {post.liked ? post.likes + 1 : post.likes}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.actionBtn} activeOpacity={0.7}>
          <Feather name="message-circle" size={18} color={muted} />
          <Text style={[s.actionCount, { color: muted }]}>{post.comments}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.actionBtn} activeOpacity={0.7}>
          <Feather name="share-2" size={18} color={muted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function FriendsScreen() {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme !== 'light';

  const [posts, setPosts] = useState(FRIEND_POSTS);

  const bg      = isDark ? '#08080F' : '#F9F9FC';
  const fg      = isDark ? '#F0EEFF' : '#1A1035';
  const muted   = isDark ? '#6B6B8A' : '#6D6892';
  const border  = isDark ? '#1E1E30' : '#E8E6F0';
  const primary = isDark ? '#9F7AEA' : '#7C3AED';

  function handleLike(id: string) {
    setPosts(prev => prev.map(p => p.id === id ? { ...p, liked: !p.liked } : p));
  }

  const newActivity = FRIENDS.filter(f => f.hasNew).length;

  return (
    <View style={[s.container, { backgroundColor: bg }]}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 16, borderBottomColor: border }]}>
        <View>
          <Text style={[s.headerTitle, { color: fg }]}>Friends</Text>
          <Text style={[s.headerSub, { color: muted }]}>{newActivity} friends active</Text>
        </View>
        <TouchableOpacity style={[s.headerBtn, { borderColor: border }]} activeOpacity={0.7}>
          <Feather name="user-plus" size={18} color={muted} />
        </TouchableOpacity>
      </View>

      {/* Friend avatars */}
      <View style={[s.avatarsRow, { borderBottomColor: border }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.avatarsScroll}
        >
          {FRIENDS.map(friend => (
            <TouchableOpacity
              key={friend.id}
              style={s.avatarItem}
              activeOpacity={0.8}
              onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
            >
              {friend.hasNew ? (
                <LinearGradient
                  colors={['#F0ABFC', '#C026D3', '#7C3AED']}
                  style={s.avatarRing}
                >
                  <View style={[s.avatarRingInner, { backgroundColor: bg }]}>
                    <View style={[s.avatarCircle, { backgroundColor: friend.color }]}>
                      <Text style={s.avatarInitials}>{friend.initials}</Text>
                    </View>
                  </View>
                </LinearGradient>
              ) : (
                <View style={[s.avatarRingViewed, { borderColor: border }]}>
                  <View style={[s.avatarCircle, { backgroundColor: friend.color }]}>
                    <Text style={s.avatarInitials}>{friend.initials}</Text>
                  </View>
                </View>
              )}
              <Text style={[s.avatarLabel, { color: muted }]} numberOfLines={1}>
                {friend.name.split(' ')[0]}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Posts */}
      <FlatList
        data={posts}
        keyExtractor={p => p.id}
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <FriendCard post={item} isDark={isDark} onLike={handleLike} />
        )}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', letterSpacing: -0.6 },
  headerSub:   { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  headerBtn:   { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },

  avatarsRow:    { borderBottomWidth: 1, height: 100 },
  avatarsScroll: { paddingHorizontal: 16, paddingVertical: 10, gap: 14, alignItems: 'center' },
  avatarItem:    { alignItems: 'center', gap: 5, width: 58 },
  avatarRing:    { width: 58, height: 58, borderRadius: 29, padding: 2.5, alignItems: 'center', justifyContent: 'center' },
  avatarRingViewed: { width: 58, height: 58, borderRadius: 29, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  avatarRingInner:  { width: 51, height: 51, borderRadius: 26, padding: 2, alignItems: 'center', justifyContent: 'center' },
  avatarCircle:     { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  avatarInitials:   { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  avatarLabel:      { fontSize: 10, fontFamily: 'Inter_500Medium', textAlign: 'center' },

  card:       { borderRadius: 20, borderWidth: 1, overflow: 'hidden' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  avatar:     { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  friendName: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  timeAgo:    { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 1 },
  typePill:   { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10 },
  typeText:   { fontSize: 11, fontFamily: 'Inter_700Bold' },

  caption: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 19, paddingHorizontal: 14, paddingBottom: 12 },

  itemCard:    { width: 130, borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  itemVisual:  { height: 90, alignItems: 'center', justifyContent: 'center' },
  itemIcon:    { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  itemBrand:   { fontSize: 10, fontFamily: 'Inter_500Medium', marginBottom: 2 },
  itemName:    { fontSize: 12, fontFamily: 'Inter_700Bold', lineHeight: 16 },
  itemPrice:   { fontSize: 13, fontFamily: 'Inter_700Bold', marginTop: 3 },

  actions:     { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 12, borderTopWidth: 1 },
  actionBtn:   { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 6 },
  actionCount: { fontSize: 13, fontFamily: 'Inter_500Medium' },
});
