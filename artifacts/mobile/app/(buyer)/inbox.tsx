import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, ScrollView, TouchableOpacity,
  TextInput, Alert, StyleSheet, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, SURFACE, FONT, FS, SP, RADIUS, COMP, ICON,
  GRAD_PRIMARY,
} from '@/lib/theme';
import {
  getConversations, getStories, markConversationRead, archiveConversation,
  subscribeSocial, MY_USER_ID, MY_COLOR, MY_INITIALS, MY_NAME,
  getNotifications,
} from '@/services/socialService';
import type { Conversation, Story } from '@/services/socialTypes';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function getParticipant(conv: Conversation) {
  return conv.participants[0];
}

// ─── Segment tabs ─────────────────────────────────────────────────────────────

const TABS = ['All', 'Friends', 'Sellers', 'Orders', 'Requests', 'Archived'] as const;
type Tab = typeof TABS[number];

const EMPTY_MESSAGES: Record<Tab, { icon: keyof typeof Feather.glyphMap; title: string; subtitle: string }> = {
  All:      { icon: 'message-circle', title: 'No conversations yet',     subtitle: 'Start a conversation' },
  Friends:  { icon: 'message-circle', title: 'No friend messages',       subtitle: 'Message a friend to get started' },
  Sellers:  { icon: 'message-circle', title: 'No seller conversations',  subtitle: 'Message a brand to get started' },
  Orders:   { icon: 'package',        title: 'No order messages',         subtitle: 'Order messages will appear here' },
  Requests: { icon: 'mail',           title: 'No message requests',       subtitle: 'Requests from new senders appear here' },
  Archived: { icon: 'archive',        title: 'No archived conversations', subtitle: 'Archived chats appear here' },
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function InboxScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);

  const loadData = useCallback(async () => {
    const [convs, strs, notifs] = await Promise.all([
      getConversations(),
      getStories(),
      getNotifications(),
    ]);
    setConversations(convs);
    setStories(strs);
    setUnreadNotifCount(notifs.filter(n => !n.isRead).length);
  }, []);

  useFocusEffect(useCallback(() => {
    loadData();
  }, [loadData]));

  useEffect(() => {
    const unsub = subscribeSocial(() => { loadData(); });
    return unsub;
  }, [loadData]);

  // ── Filter logic ────────────────────────────────────────────────────────────

  const filteredConvs = conversations.filter(conv => {
    // Tab filter
    let tabMatch = false;
    switch (activeTab) {
      case 'All':      tabMatch = !conv.isArchived; break;
      case 'Friends':  tabMatch = conv.type === 'buyer_to_buyer' && !conv.isArchived && !conv.isRequest; break;
      case 'Sellers':  tabMatch = (conv.type === 'buyer_to_seller' || conv.type === 'buyer_to_seller_product') && !conv.isArchived && !conv.isRequest; break;
      case 'Orders':   tabMatch = conv.type === 'buyer_to_seller_order' && !conv.isArchived; break;
      case 'Requests': tabMatch = conv.isRequest === true && !conv.isArchived; break;
      case 'Archived': tabMatch = conv.isArchived === true; break;
    }
    if (!tabMatch) return false;
    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const participant = getParticipant(conv);
      return participant?.name.toLowerCase().includes(q) || participant?.handle.toLowerCase().includes(q);
    }
    return true;
  });

  const myStories = stories.filter(s => s.authorId === MY_USER_ID);
  const otherStories = stories.filter(s => s.authorId !== MY_USER_ID);
  const allStoryIds = stories.map(s => s.id);

  // ── Handlers ────────────────────────────────────────────────────────────────

  function openConversation(conv: Conversation) {
    markConversationRead(conv.id);
    router.push(`/buyer-conversation?id=${conv.id}` as never);
  }

  function longPressConversation(conv: Conversation) {
    Alert.alert('Options', undefined, [
      { text: 'Archive', onPress: () => archiveConversation(conv.id), style: 'destructive' },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function openCompose() {
    Alert.alert(
      'New Conversation',
      'Start a conversation with:',
      [{ text: 'Cancel', style: 'cancel' }],
    );
  }

  // ── Render helpers ──────────────────────────────────────────────────────────

  function renderConvRow({ item: conv }: { item: Conversation }) {
    const participant = getParticipant(conv);
    if (!participant) return null;
    const isUnread = conv.unreadCount > 0;

    return (
      <TouchableOpacity
        style={s.convRow}
        onPress={() => openConversation(conv)}
        onLongPress={() => longPressConversation(conv)}
        activeOpacity={0.75}
      >
        {/* Avatar with unread dot */}
        <View style={s.avatarContainer}>
          <View style={[s.avatar48, { backgroundColor: participant.color }]}>
            <Text style={s.avatarInitials}>{participant.initials}</Text>
          </View>
          {isUnread && <View style={s.unreadDot} />}
        </View>

        {/* Center content */}
        <View style={s.convCenter}>
          <View style={s.convNameRow}>
            <Text
              style={[s.convName, { fontFamily: isUnread ? FONT.bold : FONT.semibold }]}
              numberOfLines={1}
            >
              {participant.name}
            </Text>
            {conv.lastMessageTs ? (
              <Text style={s.convTime}>{timeAgo(conv.lastMessageTs)}</Text>
            ) : null}
          </View>
          {conv.contextOrderNumber ? (
            <View style={s.orderPill}>
              <Text style={s.orderPillText}>{conv.contextOrderNumber}</Text>
            </View>
          ) : null}
          <Text
            style={[s.convPreview, isUnread && { color: FG }]}
            numberOfLines={1}
          >
            {conv.lastMessage ?? 'No messages yet'}
          </Text>
        </View>

        {/* Trailing */}
        {isUnread ? (
          <View style={s.unreadBadge}>
            <Text style={s.unreadBadgeText}>{conv.unreadCount > 99 ? '99+' : conv.unreadCount}</Text>
          </View>
        ) : (
          <Feather name="camera" size={ICON.sm} color={MUTED} />
        )}
      </TouchableOpacity>
    );
  }

  function renderEmptyState() {
    const { icon, title, subtitle } = EMPTY_MESSAGES[activeTab];
    return (
      <View style={s.emptyState}>
        <Feather name={icon} size={48} color={MUTED} />
        <Text style={s.emptyTitle}>{title}</Text>
        <Text style={s.emptySubtitle}>{subtitle}</Text>
      </View>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + SP.sm }]}>
        <Text style={s.headerTitle}>Inbox</Text>
        <View style={s.headerRight}>
          {/* Notifications bell */}
          <TouchableOpacity
            style={s.headerIconBtn}
            onPress={() => router.push('/buyer-notifications' as never)}
            activeOpacity={0.7}
          >
            <Feather name="bell" size={ICON.lg} color={FG} />
            {unreadNotifCount > 0 && (
              <View style={s.notifBadge}>
                <Text style={s.notifBadgeText}>
                  {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          {/* Compose */}
          <TouchableOpacity
            style={s.headerIconBtn}
            onPress={openCompose}
            activeOpacity={0.7}
          >
            <Feather name="edit-2" size={ICON.lg} color={MUTED} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Stories row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.storiesContent}
        style={s.storiesRow}
      >
        {/* Your story circle */}
        <TouchableOpacity
          style={s.storyItem}
          onPress={() => router.push('/buyer-story-create' as never)}
          activeOpacity={0.8}
        >
          <View style={[s.storyCircle, { backgroundColor: MY_COLOR }]}>
            <Text style={s.storyInitials}>{MY_INITIALS}</Text>
            <View style={s.storyAddBadge}>
              <Feather name="plus" size={10} color={FG} />
            </View>
          </View>
          <Text style={s.storyLabel} numberOfLines={1}>Your story</Text>
        </TouchableOpacity>

        {/* Other stories */}
        {otherStories.map(story => {
          const viewed = story.viewers.some(v => v.userId === MY_USER_ID);
          return (
            <TouchableOpacity
              key={story.id}
              style={s.storyItem}
              onPress={() => {
                const allIds = allStoryIds.join(',');
                router.push(`/buyer-story-viewer?storyId=${story.id}&allStoryIds=${allIds}` as never);
              }}
              activeOpacity={0.8}
            >
              <View style={[s.storyRing, { borderColor: viewed ? MUTED : PURPLE }]}>
                <View style={[s.storyCircleInner, { backgroundColor: story.authorColor }]}>
                  <Text style={s.storyInitials}>{story.authorInitials}</Text>
                </View>
              </View>
              <Text style={s.storyLabel} numberOfLines={1}>
                {story.authorName.split(' ')[0]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Search bar */}
      <View style={s.searchBar}>
        <Feather name="search" size={ICON.sm} color={SUBTLE} style={{ marginRight: SP.sm }} />
        <TextInput
          style={s.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search conversations..."
          placeholderTextColor={SUBTLE}
          returnKeyType="search"
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x" size={ICON.sm} color={MUTED} />
          </TouchableOpacity>
        )}
      </View>

      {/* Segment tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.tabsContent}
        style={s.tabsRow}
      >
        {TABS.map(tab => {
          const isActive = activeTab === tab;
          return (
            <TouchableOpacity
              key={tab}
              style={[
                s.tabPill,
                isActive
                  ? { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE }
                  : { backgroundColor: CARD, borderColor: BORDER },
              ]}
              onPress={() => setActiveTab(tab)}
              activeOpacity={0.75}
            >
              <Text style={[s.tabText, { color: isActive ? PURPLE : MUTED }]}>{tab}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Conversations list */}
      <FlatList
        data={filteredConvs}
        keyExtractor={item => item.id}
        renderItem={renderConvRow}
        ListEmptyComponent={renderEmptyState}
        contentContainerStyle={filteredConvs.length === 0 ? s.listEmptyContainer : undefined}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
  },
  headerTitle: {
    flex: 1,
    fontSize: FS.lg,
    fontFamily: FONT.bold,
    color: FG,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
  },
  headerIconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  notifBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  notifBadgeText: {
    fontSize: 9,
    fontFamily: FONT.bold,
    color: FG,
  },

  // Stories
  storiesRow: { flexGrow: 0 },
  storiesContent: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    gap: SP.md,
  },
  storyItem: {
    alignItems: 'center',
    gap: SP.xs,
    width: 60,
  },
  storyCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  storyInitials: {
    fontSize: FS.sm,
    fontFamily: FONT.bold,
    color: '#FFFFFF',
  },
  storyAddBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: BG,
  },
  storyRing: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  storyCircleInner: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
    textAlign: 'center',
  },

  // Search
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: SP.md,
    marginBottom: SP.sm,
    height: 40,
    backgroundColor: CARD,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: SP.md,
  },
  searchInput: {
    flex: 1,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: FG,
    height: '100%',
  },

  // Tabs
  tabsRow: { flexGrow: 0, marginBottom: SP.sm },
  tabsContent: {
    paddingHorizontal: SP.md,
    gap: SP.sm,
  },
  tabPill: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.xs,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
  },
  tabText: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
  },

  // Conversation row
  convRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  avatarContainer: {
    position: 'relative',
  },
  avatar48: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: FS.base,
    fontFamily: FONT.bold,
    color: '#FFFFFF',
  },
  unreadDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: PURPLE,
    borderWidth: 2,
    borderColor: BG,
  },
  convCenter: {
    flex: 1,
    marginLeft: SP.md,
  },
  convNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  convName: {
    flex: 1,
    fontSize: FS.base,
    color: FG,
  },
  convTime: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
    marginLeft: SP.xs,
  },
  orderPill: {
    alignSelf: 'flex-start',
    backgroundColor: PURPLE_DIM,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.xs,
    paddingVertical: 2,
    marginBottom: SP.xs,
  },
  orderPillText: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: PURPLE,
  },
  convPreview: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP.xs,
    marginLeft: SP.sm,
  },
  unreadBadgeText: {
    fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: '#FFFFFF',
  },

  // Empty state
  listEmptyContainer: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    gap: SP.sm,
  },
  emptyTitle: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: MUTED,
    marginTop: SP.sm,
  },
  emptySubtitle: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: SUBTLE,
  },
});
