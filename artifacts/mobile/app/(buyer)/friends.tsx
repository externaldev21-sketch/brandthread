import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  FlatList, Share, Alert, Dimensions, Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_W } = Dimensions.get('window');

// ─── Mock data ────────────────────────────────────────────────────────────────

const FRIENDS = [
  { id: 'f1', name: 'Maya Chen',    handle: '@mayachen',    chatId: 'maya',   initials: 'MC', color: '#BE185D', hasNew: true  },
  { id: 'f2', name: 'Jordan Lee',   handle: '@jordanlee',   chatId: 'jordan', initials: 'JL', color: '#1D4ED8', hasNew: true  },
  { id: 'f3', name: 'Amir Patel',   handle: '@amirpatel',   chatId: 'amir',   initials: 'AP', color: '#0F766E', hasNew: false },
  { id: 'f4', name: 'Sofia Reyes',  handle: '@sofiareyes',  chatId: 'sofia',  initials: 'SR', color: '#B45309', hasNew: true  },
  { id: 'f5', name: 'Kai Nakamura', handle: '@kainakamura', chatId: 'kai',    initials: 'KN', color: '#B33F1E', hasNew: false },
];

const FRIEND_POSTS = [
  {
    id: 'p1',
    friend: 'Maya Chen',
    handle: '@mayachen',
    friendInitials: 'MC',
    friendColor: '#BE185D',
    dateLabel: 'June 28',
    tagline: 'Vault Studio · Rooftop drop',
    caption: 'Can\'t decide between these two 😩',
    gradient: ['#3A1530', '#0E0A14', '#1A0F18'] as [string, string, string],
    accent: '#EC4899',
    likes: 224,
    commentsList: ['So clean 😍', 'Get the jacket!!'],
    reposts: 2,
    liked: false,
    reposted: false,
    saved: false,
  },
  {
    id: 'p2',
    friend: 'Jordan Lee',
    handle: '@jordanlee',
    friendInitials: 'JL',
    friendColor: '#1D4ED8',
    dateLabel: 'June 26',
    tagline: 'NxGen Drops · Archive Hoodie Vol.3',
    caption: 'Finally copped 🙌 been waiting weeks for this restock.',
    gradient: ['#0B1B33', '#0A0E14', '#101826'] as [string, string, string],
    accent: '#3B82F6',
    likes: 331,
    commentsList: ['LFG 🔥', 'Been waiting on this restock forever', 'W'],
    reposts: 9,
    liked: true,
    reposted: false,
    saved: true,
  },
  {
    id: 'p3',
    friend: 'Sofia Reyes',
    handle: '@sofiareyes',
    friendInitials: 'SR',
    friendColor: '#B45309',
    dateLabel: 'June 24',
    tagline: 'Atlas Goods · Utility Vest',
    caption: 'This season\'s grail list 🔥 @ me if you copped any of these',
    gradient: ['#2B1607', '#120C08', '#1F1209'] as [string, string, string],
    accent: '#F59E0B',
    likes: 122,
    commentsList: ['Need the vest asap', 'Grail list is unmatched'],
    reposts: 13,
    liked: false,
    reposted: false,
    saved: false,
  },
];

type FriendPost = typeof FRIEND_POSTS[0];

// ─── Friend post (Instagram-style) ─────────────────────────────────────────────

function FriendCard({
  post, onLike, onSave, onRepost, onOpenComments,
}: {
  post: FriendPost;
  onLike: (id: string) => void;
  onSave: (id: string) => void;
  onRepost: (id: string) => void;
  onOpenComments: (id: string) => void;
}) {
  return (
    <View style={s.card}>
      {/* Header */}
      <View style={s.cardHeader}>
        <View style={[s.avatar, { backgroundColor: post.friendColor }]}>
          <Text style={s.avatarText}>{post.friendInitials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.friendName}>{post.friend}</Text>
          <View style={s.taglineRow}>
            <Ionicons name="bag" size={11} color="#8C8577" />
            <Text style={s.tagline} numberOfLines={1}>{post.tagline}</Text>
          </View>
        </View>
        <TouchableOpacity style={s.moreBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="more-horizontal" size={20} color="#EDE7D9" />
        </TouchableOpacity>
      </View>

      {/* Photo */}
      <LinearGradient colors={post.gradient} style={s.photo}>
        <View style={[s.photoIconRing, { borderColor: post.accent + '80' }]}>
          <Ionicons name="bag" size={30} color={post.accent} />
        </View>
      </LinearGradient>

      {/* Action row */}
      <View style={s.actions}>
        <TouchableOpacity
          style={s.actionBtn}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onLike(post.id); }}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Ionicons name={post.liked ? 'heart' : 'heart-outline'} size={25} color={post.liked ? '#EF4444' : '#EDE7D9'} />
        </TouchableOpacity>
        <TouchableOpacity
          style={s.actionBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          onPress={() => onOpenComments(post.id)}
        >
          <Ionicons name="chatbubble-outline" size={23} color="#EDE7D9" />
        </TouchableOpacity>
        <TouchableOpacity
          style={s.actionBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onRepost(post.id); }}
        >
          <Ionicons name="repeat" size={25} color={post.reposted ? post.accent : '#EDE7D9'} />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          style={s.actionBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            Share.share({ message: `${post.friend} on Brandthread: ${post.caption}` });
          }}
        >
          <Ionicons name="paper-plane-outline" size={23} color="#EDE7D9" />
        </TouchableOpacity>
        <TouchableOpacity
          style={s.actionBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSave(post.id); }}
        >
          <Ionicons name={post.saved ? 'bookmark' : 'bookmark-outline'} size={23} color="#EDE7D9" />
        </TouchableOpacity>
      </View>

      {/* Counts */}
      <View style={s.countsRow}>
        <Text style={s.countText}>{formatCount(post.liked ? post.likes + 1 : post.likes)} likes</Text>
        <Text style={s.countDot}>·</Text>
        <Text style={s.countText}>{post.commentsList.length} comments</Text>
        <Text style={s.countDot}>·</Text>
        <Text style={s.countText}>{formatCount(post.reposted ? post.reposts + 1 : post.reposts)} reposts</Text>
      </View>

      {/* Caption */}
      <Text style={s.captionRow}>
        <Text style={s.captionName}>{post.friend.split(' ')[0].toLowerCase()}_{post.friend.split(' ')[1]?.toLowerCase() ?? ''} </Text>
        {post.caption}
      </Text>
      <Text style={s.dateLabel}>{post.dateLabel}</Text>
    </View>
  );
}

function formatCount(n: number) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function FriendsScreen() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();

  const [posts, setPosts] = useState(FRIEND_POSTS);
  const [activePostId, setActivePostId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  function handleLike(id: string) {
    setPosts(prev => prev.map(p => p.id === id ? { ...p, liked: !p.liked } : p));
  }

  function handleSave(id: string) {
    setPosts(prev => prev.map(p => p.id === id ? { ...p, saved: !p.saved } : p));
  }

  function handleRepost(id: string) {
    setPosts(prev => prev.map(p => p.id === id ? { ...p, reposted: !p.reposted } : p));
  }

  function handleOpenComments(id: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActivePostId(id);
  }

  function handleSendComment() {
    if (!activePostId || !draft.trim()) return;
    setPosts(prev => prev.map(p => p.id === activePostId ? { ...p, commentsList: [...p.commentsList, draft.trim()] } : p));
    setDraft('');
  }

  const activePost = posts.find(p => p.id === activePostId) ?? null;

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="plus" size={24} color="#EDE7D9" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Friends</Text>
        <TouchableOpacity
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => Alert.alert('Find Friends', 'Connect with friends on Brandthread', [
            { text: 'Search by Username', onPress: () => {} },
            { text: 'Sync Contacts',      onPress: () => {} },
            { text: 'Cancel', style: 'cancel' },
          ])}
        >
          <Feather name="user-plus" size={22} color="#EDE7D9" />
        </TouchableOpacity>
      </View>

      {/* Stories row */}
      <View style={s.storiesRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.storiesScroll}
        >
          {/* Your story */}
          <TouchableOpacity style={s.storyItem} activeOpacity={0.8}>
            <View style={s.yourStoryRing}>
              <View style={[s.avatarCircle, { backgroundColor: '#33302A' }]}>
                <Feather name="user" size={22} color="#8C8577" />
              </View>
              <View style={s.yourStoryPlus}>
                <Feather name="plus" size={11} color="#FFFFFF" />
              </View>
            </View>
            <Text style={s.storyLabel} numberOfLines={1}>Your story</Text>
          </TouchableOpacity>

          {FRIENDS.map(friend => (
            <TouchableOpacity
              key={friend.id}
              style={s.storyItem}
              activeOpacity={0.8}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/chat/${friend.chatId}` as never); }}
            >
              {friend.hasNew ? (
                <LinearGradient
                  colors={['#F9CE34', '#EE2A7B', '#6228D7']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={s.storyRing}
                >
                  <View style={s.storyRingInner}>
                    <View style={[s.avatarCircle, { backgroundColor: friend.color }]}>
                      <Text style={s.avatarInitials}>{friend.initials}</Text>
                    </View>
                  </View>
                </LinearGradient>
              ) : (
                <View style={s.storyRingViewed}>
                  <View style={[s.avatarCircle, { backgroundColor: friend.color }]}>
                    <Text style={s.avatarInitials}>{friend.initials}</Text>
                  </View>
                </View>
              )}
              <Text style={s.storyLabel} numberOfLines={1}>
                {friend.name.split(' ')[0].toLowerCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Posts */}
      <FlatList
        data={posts}
        keyExtractor={p => p.id}
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <FriendCard post={item} onLike={handleLike} onSave={handleSave} onRepost={handleRepost} onOpenComments={handleOpenComments} />
        )}
      />

      {/* Comments sheet */}
      <Modal
        visible={!!activePost}
        transparent
        animationType="slide"
        onRequestClose={() => setActivePostId(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={s.modalBackdrop}
        >
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setActivePostId(null)} />
          <View style={[s.commentsSheet, { paddingBottom: insets.bottom + 12 }]}>
            <View style={s.commentsHandle} />
            <Text style={s.commentsTitle}>Comments</Text>
            <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
              {activePost?.commentsList.length ? activePost.commentsList.map((c, i) => (
                <View key={i} style={s.commentRow}>
                  <Text style={s.commentUser}>{activePost.friend.split(' ')[0].toLowerCase()}</Text>
                  <Text style={s.commentText}>{c}</Text>
                </View>
              )) : (
                <Text style={s.commentsEmpty}>No comments yet — be the first.</Text>
              )}
            </ScrollView>
            <View style={s.commentInputRow}>
              <TextInput
                style={s.commentInput}
                placeholder="Add a comment…"
                placeholderTextColor="#8C8577"
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={handleSendComment}
                returnKeyType="send"
              />
              <TouchableOpacity style={s.commentSendBtn} onPress={handleSendComment} activeOpacity={0.7}>
                <Feather name="send" size={17} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 10,
  },
  headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#EDE7D9', letterSpacing: -0.3 },

  storiesRow:    { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#26231D' },
  storiesScroll: { paddingHorizontal: 14, paddingVertical: 12, gap: 14, alignItems: 'flex-start' },

  storyItem:  { alignItems: 'center', gap: 5, width: 62 },
  storyRing:  { width: 62, height: 62, borderRadius: 31, padding: 2.5, alignItems: 'center', justifyContent: 'center' },
  storyRingInner: { width: 55, height: 55, borderRadius: 28, padding: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000000' },
  storyRingViewed: { width: 62, height: 62, borderRadius: 31, borderWidth: 2, borderColor: '#33302A', alignItems: 'center', justifyContent: 'center' },
  yourStoryRing: { width: 62, height: 62, alignItems: 'center', justifyContent: 'center' },
  yourStoryPlus: {
    position: 'absolute', bottom: 0, right: 0, width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#3B82F6', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#000000',
  },
  avatarCircle:   { width: 51, height: 51, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  storyLabel:     { fontSize: 10.5, fontFamily: 'Inter_500Medium', textAlign: 'center', color: '#B8B2A3' },

  card:       { marginBottom: 8 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 10 },
  moreBtn:    { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  avatar:     { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 12.5, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  friendName: { fontSize: 13.5, fontFamily: 'Inter_700Bold', color: '#EDE7D9' },
  taglineRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  tagline:    { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#8C8577', flexShrink: 1 },

  photo: { width: SCREEN_W, height: SCREEN_W * 1.05, alignItems: 'center', justifyContent: 'center' },
  photoIconRing: {
    width: 64, height: 64, borderRadius: 32, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },

  actions:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 10 },
  actionBtn: { paddingHorizontal: 6, paddingVertical: 4 },

  countsRow:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 6, gap: 6, flexWrap: 'wrap' },
  countText:  { fontSize: 12.5, fontFamily: 'Inter_600SemiBold', color: '#EDE7D9' },
  countDot:   { fontSize: 12.5, color: '#5A564C' },

  captionRow:   { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#EDE7D9', lineHeight: 18, paddingHorizontal: 14, paddingTop: 6 },
  captionName:  { fontFamily: 'Inter_700Bold' },
  dateLabel:    { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#5A564C', paddingHorizontal: 14, paddingTop: 4, paddingBottom: 4 },

  modalBackdrop:  { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000090' },
  commentsSheet:  { backgroundColor: '#151310', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 10 },
  commentsHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#33302A', alignSelf: 'center', marginBottom: 10 },
  commentsTitle:  { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#EDE7D9', textAlign: 'center', marginBottom: 12 },
  commentsEmpty:  { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#8C8577', textAlign: 'center', paddingVertical: 20 },
  commentRow:     { flexDirection: 'row', gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#26231D' },
  commentUser:    { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#EDE7D9' },
  commentText:    { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#B8B2A3', flexShrink: 1 },
  commentInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 12 },
  commentInput:   {
    flex: 1, backgroundColor: '#201D18', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 13, fontFamily: 'Inter_400Regular', color: '#EDE7D9',
  },
  commentSendBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#C94D1F', alignItems: 'center', justifyContent: 'center' },
});
