import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, ScrollView, TouchableOpacity,
  Alert, StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@clerk/expo';
import {
  BG, SCREEN_BG, CARD, CARD_ELEVATED, BORDER,
  FG, MUTED, SUBTLE, RED,
  SURFACE, FONT, FS, SP, RADIUS, COMP, ICON,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  getConversations, getStories, markConversationRead, archiveConversation,
  subscribeSocial, MY_USER_ID, MY_COLOR, MY_INITIALS, MY_NAME,
  getNotifications,
} from '@/services/socialService';
import type { Conversation, Story } from '@/services/socialTypes';
import { useApi } from '@/lib/api';
import SwipeActionRow from '@/components/SwipeActionRow';

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

function previewText(lastMessage: string | undefined, fallback: string): string {
  return lastMessage?.trim() || fallback;
}

// ─── Segment tabs ─────────────────────────────────────────────────────────────

const TABS = ['Highlights', 'Messages', 'Requests'] as const;
type Tab = typeof TABS[number];

const EMPTY_MESSAGES: Record<Tab, { icon: keyof typeof Feather.glyphMap; title: string; subtitle: string }> = {
  Highlights: { icon: 'star', title: 'No highlights yet', subtitle: 'Unread conversations appear here' },
  Messages: { icon: 'message-circle', title: 'No messages yet', subtitle: 'Start a conversation' },
  Requests: { icon: 'mail', title: 'No message requests', subtitle: 'Requests from new senders appear here' },
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function InboxScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const { theme } = useAppTheme();
  const { userId } = useAuth();
  const accountRef = useRef(userId);
  accountRef.current = userId;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('Messages');
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [requestActionLoading, setRequestActionLoading] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadData = useCallback(async () => {
    if (!userId) {
      setConversations([]);
      setStories([]);
      setUnreadNotifCount(0);
      setLoading(false);
      return;
    }
    setLoadError(false);
    try {
      const [convs, strs, notifs] = await Promise.all([getConversations(), getStories(), getNotifications()]);
      if (accountRef.current !== userId) return;
      setConversations(convs);
      setStories(strs);
      setUnreadNotifCount(notifs.filter(n => !n.isRead).length);
    } catch {
      setLoadError(false);
      setConversations([]);
      setStories([]);
      setUnreadNotifCount(0);
    } finally {
      setLoading(false);
    }
  }, [userId]);

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
      case 'Highlights': tabMatch = !conv.isArchived && !conv.isRequest && conv.unreadCount > 0; break;
      case 'Messages': tabMatch = !conv.isArchived && !conv.isRequest; break;
      case 'Requests': tabMatch = conv.isRequest === true && !conv.isArchived; break;
    }
    if (!tabMatch) return false;
    return true;
  });

  const myStories = stories.filter(s => s.authorId === MY_USER_ID);
  const otherStories = stories.filter(s => s.authorId !== MY_USER_ID);
  const allStoryIds = stories.map(s => s.id);

  // ── Handlers ────────────────────────────────────────────────────────────────

  function openConversation(conv: Conversation) {
    // Don't open request conversations inline — user must accept first
    if (conv.isRequest) return;
    Haptics.selectionAsync();
    markConversationRead(conv.id);
    router.push(`/buyer-conversation?id=${conv.id}` as never);
  }

  async function acceptRequest(conv: Conversation) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRequestActionLoading(conv.id);
    try {
      await api.conversations.accept(conv.id);
      // Refresh conversation list
      const convs = await getConversations();
      setConversations(convs);
      // Open the accepted conversation
      markConversationRead(conv.id);
      router.push(`/buyer-conversation?id=${conv.id}` as never);
    } catch {
      Alert.alert('Error', 'Could not accept request. Try again.');
    } finally {
      setRequestActionLoading(null);
    }
  }

  async function declineRequest(conv: Conversation) {
    const participant = getParticipant(conv);
    Alert.alert(
      'Decline request',
      `Remove message request from ${participant?.name ?? 'this user'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: async () => {
            setRequestActionLoading(conv.id);
            try {
              await api.conversations.decline(conv.id);
              setConversations(prev => prev.filter(c => c.id !== conv.id));
            } catch {
              Alert.alert('Error', 'Could not decline request. Try again.');
            } finally {
              setRequestActionLoading(null);
            }
          },
        },
      ]
    );
  }

  function longPressConversation(conv: Conversation) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Options', undefined, [
      { text: 'Archive', onPress: () => archiveConversation(conv.id), style: 'destructive' },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function swipeArchiveConversation(conv: Conversation) {
    await archiveConversation(conv.id);
    setConversations(prev => prev.map(item =>
      item.id === conv.id ? { ...item, isArchived: true } : item
    ));
  }

  function openCompose() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
    const isRequest = conv.isRequest === true;
    const isLoadingAction = requestActionLoading === conv.id;

    // Requests get a distinct card with Accept/Decline instead of the usual row
    if (isRequest) {
      return (
        <View style={s.requestCard}>
          {/* Avatar */}
          <View style={[s.avatar48, { backgroundColor: participant.color }]}>
            <Text style={s.avatarInitials}>{participant.initials}</Text>
          </View>

          {/* Info */}
          <View style={s.convCenter}>
            <View style={s.convNameRow}>
              <Text style={[s.convName, { fontFamily: FONT.semibold }]} numberOfLines={1}>{participant.name}</Text>
              {conv.lastMessageTs ? <Text style={s.convTime}>{timeAgo(conv.lastMessageTs)}</Text> : null}
            </View>
            <Text style={[s.convPreview]} numberOfLines={1}>
              {previewText(conv.lastMessage, 'Sent you a message')}
            </Text>

            {/* Accept / Decline buttons */}
            <View style={s.requestActions}>
              <TouchableOpacity
                style={[s.requestAcceptBtn, { backgroundColor: theme.accent }, isLoadingAction && s.requestBtnDisabled]}
                onPress={() => acceptRequest(conv)}
                disabled={isLoadingAction}
                activeOpacity={0.8}
              >
                <Text style={[s.requestAcceptText, { color: theme.onAccent }]}>Accept</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.requestDeclineBtn, isLoadingAction && s.requestBtnDisabled]}
                onPress={() => declineRequest(conv)}
                disabled={isLoadingAction}
                activeOpacity={0.8}
              >
                <Text style={s.requestDeclineText}>Decline</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      );
    }

    return (
      <SwipeActionRow
        label="Archive"
        icon="archive"
        color={RED}
        onAction={() => swipeArchiveConversation(conv)}
        accessibilityLabel={`Archive conversation with ${participant.name}`}
      >
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
          {isUnread && <View style={[s.unreadDot, { backgroundColor: theme.accent }]} />}
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
              <View style={[s.orderPill, { backgroundColor: theme.accentDim }]}>
                <Text style={[s.orderPillText, { color: theme.accent }]}>{conv.contextOrderNumber}</Text>
            </View>
          ) : null}
          <Text
            style={[s.convPreview, isUnread && { color: FG }]}
            numberOfLines={1}
          >
            {previewText(conv.lastMessage, 'No messages yet')}
          </Text>
        </View>

        {/* Trailing */}
          {isUnread ? (
          <View style={[s.unreadBadge, { backgroundColor: theme.accent }]}>
            <Text style={[s.unreadBadgeText, { color: theme.onAccent }]}>{conv.unreadCount > 99 ? '99+' : conv.unreadCount}</Text>
          </View>
        ) : (
            <Feather name="chevron-right" size={ICON.sm} color="#8A8A8E" />
        )}
        </TouchableOpacity>
      </SwipeActionRow>
    );
  }

  function renderEmptyState() {
    if (loading) return <View style={s.emptyState}><Text style={s.emptySubtitle}>Loading conversations…</Text></View>;
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
        <TouchableOpacity
          style={s.headerSide}
          onPress={() => router.back()}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="arrow-left" size={22} color="#111111" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Inbox</Text>
        <TouchableOpacity
          style={s.headerSide}
          onPress={openCompose}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="New conversation"
        >
          <Feather name="edit-3" size={21} color="#111111" />
          {unreadNotifCount > 0 && <View style={[s.headerUnreadDot, { backgroundColor: theme.accent }]} />}
        </TouchableOpacity>
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
            <View style={[s.storyAddBadge, { backgroundColor: theme.accent }]}>
              <Feather name="plus" size={10} color={theme.onAccent} />
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
              <View style={[s.storyRing, { borderColor: viewed ? MUTED : theme.accent }]}>
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

      {/* Reference-style message categories */}
      <View style={s.primaryTabs}>
        {TABS.map(tab => {
          const isActive = activeTab === tab;
          const count = tab === 'Requests'
            ? conversations.filter(conv => conv.isRequest && !conv.isArchived).length
            : tab === 'Highlights'
              ? conversations.filter(conv => !conv.isRequest && !conv.isArchived && conv.unreadCount > 0).length
              : conversations.filter(conv => !conv.isRequest && !conv.isArchived).length;
          return (
            <TouchableOpacity
              key={tab}
              style={s.primaryTab}
              onPress={() => setActiveTab(tab)}
              activeOpacity={0.8}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
            >
              <Text style={[s.primaryTabText, isActive && s.primaryTabTextActive]}>{tab}</Text>
              {count > 0 && <Text style={s.primaryTabCount}>{count > 99 ? '99+' : count}</Text>}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Conversations list */}
      <FlatList
        data={filteredConvs}
        keyExtractor={item => item.id}
        renderItem={renderConvRow}
        ListEmptyComponent={renderEmptyState}
        style={s.listSurface}
        contentContainerStyle={[s.listContent, filteredConvs.length === 0 && s.listEmptyContainer]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: SCREEN_BG },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.sm,
    paddingBottom: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#1C1C1E',
  },
  headerSide: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  headerTitle: {
    fontSize: FS.md,
    fontFamily: FONT.semibold,
    color: '#111111',
  },
  headerUnreadDot: {
    position: 'absolute', top: 8, right: 7, width: 7, height: 7, borderRadius: 4,
    borderWidth: 1.5, borderColor: '#FFFFFF',
  },
  primaryTabs: {
    flexDirection: 'row',
    minHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: '#E1E1E1',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: SP.sm,
  },
  primaryTab: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  primaryTabText: { fontSize: 13, fontFamily: FONT.regular, color: '#8A8A8E' },
  primaryTabTextActive: { fontFamily: FONT.semibold, color: '#111111' },
  primaryTabCount: { fontSize: 13, fontFamily: FONT.semibold, color: '#E23B45' },
  notifBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  notifBadgeText: {
    fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: FG,
  },

  // Stories
  storiesRow: {
    flexGrow: 0,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#ECECEC',
  },
  storiesContent: {
    paddingHorizontal: SP.md,
    paddingTop: 12,
    paddingBottom: 11,
    gap: 14,
  },
  storyItem: {
    alignItems: 'center',
    gap: SP.xs,
    width: 62,
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
    color: '#5A5A5F',
    textAlign: 'center',
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

  // Request card (replaces convRow for Requests tab)
  requestCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 10,
    marginTop: 10,
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    gap: SP.md,
  },
  requestActions: {
    flexDirection: 'row',
    gap: SP.sm,
    marginTop: SP.sm,
  },
  requestAcceptBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SP.xs,
    borderRadius: RADIUS.md,
  },
  requestAcceptText: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: '#FFFFFF',
  },
  requestDeclineBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SP.xs,
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
  },
  requestDeclineText: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: MUTED,
  },
  requestBtnDisabled: {
    opacity: 0.5,
  },

  // Conversation row
  convRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 10,
    marginTop: 10,
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
    minHeight: 78,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
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
    color: '#111111',
  },
  convTime: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: '#8A8A8E',
    marginLeft: SP.xs,
  },
  orderPill: {
    alignSelf: 'flex-start',
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.xs,
    paddingVertical: 2,
    marginBottom: SP.xs,
  },
  orderPillText: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
  },
  convPreview: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: '#5A5A5F',
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
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
  listSurface: { flex: 1, backgroundColor: '#F5F5F5' },
  listContent: { paddingBottom: 112 },
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
  retryText: { fontSize: FS.sm, fontFamily: FONT.semibold, marginTop: SP.sm },
});
