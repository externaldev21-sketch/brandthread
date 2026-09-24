import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  Alert, StyleSheet, ScrollView, RefreshControl,
  Modal, TextInput, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { EmptyState, ListSkeleton } from '@/components/layout';
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
  getConversations, markConversationRead, archiveConversation,
  subscribeSocial, getNotifications, markNotificationRead,
  searchProfiles, createOrGetConversation,
} from '@/services/socialService';
import type { Conversation, Notification, ProfileSearchResult } from '@/services/socialTypes';
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

const TABS = ['Follows', 'Messages', 'Requests'] as const;
type Tab = typeof TABS[number];

const EMPTY_MESSAGES: Record<Tab, { icon: keyof typeof Feather.glyphMap; title: string; subtitle: string }> = {
  Follows: { icon: 'user-plus', title: 'No new followers', subtitle: 'New followers appear here' },
  Messages: { icon: 'message-circle', title: 'No messages yet', subtitle: 'Start a conversation' },
  Requests: { icon: 'mail', title: 'No message requests', subtitle: 'Requests from new senders appear here' },
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function InboxScreen() {
  const insets = useSafeAreaInsets();
  const barInset = useBuyerTabBarInset();
  const router = useRouter();
  const api = useApi();
  const { theme } = useAppTheme();
  const palette = theme as typeof theme & { background?: string; };
  const { userId } = useAuth();
  const accountRef = useRef(userId);
  accountRef.current = userId;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('Messages');
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [requestActionLoading, setRequestActionLoading] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [composeVisible, setComposeVisible] = useState(false);
  const [composeQuery, setComposeQuery] = useState('');
  const [composeResults, setComposeResults] = useState<ProfileSearchResult[]>([]);
  const [composeLoading, setComposeLoading] = useState(false);
  const [composeStartingId, setComposeStartingId] = useState<string | null>(null);
  const composeSearchSeq = useRef(0);

  const loadData = useCallback(async () => {
    if (!userId) {
      setConversations([]);
      setNotifications([]);
      setUnreadNotifCount(0);
      setLoading(false);
      return;
    }
    setLoadError(false);
    try {
      const [convs, notifs] = await Promise.all([getConversations(), getNotifications()]);
      if (accountRef.current !== userId) return;
      setConversations(convs);
      setNotifications(notifs);
      setUnreadNotifCount(notifs.filter(n => !n.isRead).length);
    } catch {
      setLoadError(true);
      setConversations([]);
      setNotifications([]);
      setUnreadNotifCount(0);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadData();
    } finally {
      setRefreshing(false);
    }
  }, [loadData]);

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
      case 'Follows': tabMatch = false; break;
      case 'Messages': tabMatch = !conv.isArchived && !conv.isRequest; break;
      case 'Requests': tabMatch = conv.isRequest === true && !conv.isArchived; break;
    }
    if (!tabMatch) return false;
    return true;
  });

  const followNotifications = notifications.filter(notif => notif.type === 'new_follower' && !notif.isMuted);

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
    setComposeQuery('');
    setComposeResults([]);
    setComposeVisible(true);
  }

  function closeCompose() {
    setComposeVisible(false);
    setComposeQuery('');
    setComposeResults([]);
  }

  useEffect(() => {
    if (!composeVisible) return;
    const q = composeQuery.trim();
    if (!q) {
      setComposeResults([]);
      setComposeLoading(false);
      return;
    }
    const seq = ++composeSearchSeq.current;
    setComposeLoading(true);
    const timer = setTimeout(() => {
      searchProfiles(q)
        .then(results => {
          if (composeSearchSeq.current !== seq) return;
          setComposeResults(results);
        })
        .catch(() => {
          if (composeSearchSeq.current !== seq) return;
          setComposeResults([]);
        })
        .finally(() => {
          if (composeSearchSeq.current !== seq) return;
          setComposeLoading(false);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [composeQuery, composeVisible]);

  async function startConversationWith(person: ProfileSearchResult) {
    if (composeStartingId) return;
    setComposeStartingId(person.userId);
    try {
      const conv = await createOrGetConversation({
        type: 'buyer_to_buyer',
        participant: {
          userId: person.userId,
          name: person.name,
          handle: person.handle,
          initials: person.initials,
          color: person.color,
          accountType: person.accountType,
        },
      });
      closeCompose();
      router.push(`/buyer-conversation?id=${conv.id}` as never);
    } catch {
      Alert.alert('Couldn’t start conversation', 'Try again.');
    } finally {
      setComposeStartingId(null);
    }
  }

  function openFollow(notif: Notification) {
    Haptics.selectionAsync();
    if (!notif.isRead) {
      markNotificationRead(notif.id);
      setNotifications(prev => prev.map(item =>
        item.id === notif.id ? { ...item, isRead: true } : item
      ));
    }
    if (notif.targetId) {
      router.push(`/buyer-other-profile?userId=${encodeURIComponent(notif.targetId)}` as never);
    }
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

  function renderFollowRow({ item: notif }: { item: Notification }) {
    const isUnread = !notif.isRead;
    return (
      <TouchableOpacity
        style={s.convRow}
        onPress={() => openFollow(notif)}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={notif.title}
      >
        <View style={s.avatarContainer}>
          <View style={[s.avatar48, { backgroundColor: notif.actorColor ?? CARD }]}>
            <Text style={s.avatarInitials}>{notif.actorInitials ?? '?'}</Text>
          </View>
          {isUnread && <View style={[s.unreadDot, { backgroundColor: theme.accent }]} />}
        </View>
        <View style={s.convCenter}>
          <View style={s.convNameRow}>
            <Text style={[s.convName, { fontFamily: isUnread ? FONT.bold : FONT.semibold }]} numberOfLines={1}>
              {notif.actorName ?? notif.title}
            </Text>
            <Text style={s.convTime}>{timeAgo(new Date(notif.createdAt).getTime())}</Text>
          </View>
          <Text style={[s.convPreview, isUnread && { color: FG }]} numberOfLines={2}>
            {notif.body || 'Started following you'}
          </Text>
        </View>
        <Feather name="chevron-right" size={ICON.sm} color={MUTED} />
      </TouchableOpacity>
    );
  }

  function renderEmptyState() {
    const { icon, title, subtitle } = EMPTY_MESSAGES[activeTab];
    return (
      <EmptyState
        icon={loadError ? 'alert-circle' : icon}
        message={loadError ? 'Could not load your inbox. Pull to refresh and try again.' : `${title} — ${subtitle}`}
        variant={loadError ? 'error' : 'empty'}
      />
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={[s.root, { backgroundColor: palette.background ?? BG }]}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + SP.sm }]}>
        <TouchableOpacity
          style={s.headerSide}
          onPress={() => router.back()}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="arrow-left" size={22} color={FG} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Inbox</Text>
        <TouchableOpacity
          style={s.headerSide}
          onPress={openCompose}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="New conversation"
        >
          <Feather name="edit-3" size={21} color={FG} />
          {unreadNotifCount > 0 && <View style={[s.headerUnreadDot, { backgroundColor: theme.accent }]} />}
        </TouchableOpacity>
      </View>

      {/* Inbox categories */}
      <View style={s.primaryTabs}>
        {TABS.map(tab => {
          const isActive = activeTab === tab;
          const count = tab === 'Requests'
            ? conversations.filter(conv => conv.isRequest && !conv.isArchived).length
            : tab === 'Follows'
              ? followNotifications.filter(notif => !notif.isRead).length
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
      {loading ? (
        <View style={[s.listSurface, s.listContent, { paddingBottom: barInset + SP.md }]}>
          <ListSkeleton rows={6} />
        </View>
      ) : activeTab === 'Follows' ? (
        followNotifications.length === 0 ? (
          <ScrollView
            style={s.listSurface}
            contentContainerStyle={[s.listContent, { paddingBottom: barInset + SP.md }, s.listEmptyContainer]}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.accent} />}
          >
            {renderEmptyState()}
          </ScrollView>
        ) : (
          <View style={s.listSurface}>
            <FlashList
              data={followNotifications}
              keyExtractor={item => item.id}
              renderItem={renderFollowRow}
              contentContainerStyle={StyleSheet.flatten([s.listContent, { paddingBottom: barInset + SP.md }])}
              showsVerticalScrollIndicator={false}
              refreshing={refreshing}
              onRefresh={handleRefresh}
            />
          </View>
        )
      ) : filteredConvs.length === 0 ? (
        <ScrollView
          style={s.listSurface}
          contentContainerStyle={[s.listContent, { paddingBottom: barInset + SP.md }, s.listEmptyContainer]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.accent} />}
        >
          {renderEmptyState()}
        </ScrollView>
      ) : (
        <View style={s.listSurface}>
          <FlashList
            data={filteredConvs}
            keyExtractor={item => item.id}
            renderItem={renderConvRow}
            contentContainerStyle={StyleSheet.flatten([s.listContent, { paddingBottom: barInset + SP.md }])}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshing={refreshing}
            onRefresh={handleRefresh}
          />
        </View>
      )}

      <Modal
        visible={composeVisible}
        animationType="slide"
        transparent
        onRequestClose={closeCompose}
      >
        <View style={s.composeBackdrop}>
          <View style={[s.composeSheet, { paddingBottom: insets.bottom + SP.md, backgroundColor: theme.card }]}>
            <View style={s.composeHandle} />
            <View style={s.composeHeader}>
              <Text style={s.composeTitle}>New message</Text>
              <TouchableOpacity
                onPress={closeCompose}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Feather name="x" size={22} color={theme.text} />
              </TouchableOpacity>
            </View>
            <View style={[s.composeSearchRow, { borderColor: theme.border }]}>
              <Feather name="search" size={16} color={theme.muted} />
              <TextInput
                style={[s.composeSearchInput, { color: theme.text }]}
                value={composeQuery}
                onChangeText={setComposeQuery}
                placeholder="Search people"
                placeholderTextColor={theme.muted}
                autoFocus
                autoCorrect={false}
              />
            </View>
            {composeLoading ? (
              <View style={s.composeCenter}><ActivityIndicator color={theme.accent} /></View>
            ) : composeQuery.trim() && composeResults.length === 0 ? (
              <View style={s.composeCenter}><Text style={{ color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm }}>No one found</Text></View>
            ) : (
              <FlatList
                data={composeResults}
                keyExtractor={item => item.userId}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={s.composeResultRow}
                    onPress={() => startConversationWith(item)}
                    disabled={!!composeStartingId}
                    accessibilityRole="button"
                    accessibilityLabel={`Message ${item.name}`}
                  >
                    <View style={[s.composeAvatar, { backgroundColor: theme.cardElevated }]}>
                      <Text style={{ color: theme.text, fontFamily: FONT.bold, fontSize: FS.sm }}>{item.initials}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm }} numberOfLines={1}>{item.name}</Text>
                      <Text style={{ color: theme.muted, fontFamily: FONT.regular, fontSize: FS.xs }} numberOfLines={1}>{item.handle}</Text>
                    </View>
                    {composeStartingId === item.userId && <ActivityIndicator color={theme.accent} size="small" />}
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: SCREEN_BG },

  // Compose modal
  composeBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  composeSheet: {
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingTop: SP.sm,
    paddingHorizontal: SP.md,
    height: '70%',
  },
  composeHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: 'center', marginBottom: SP.sm },
  composeHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: SP.sm,
  },
  composeTitle: { fontSize: FS.md, fontFamily: FONT.bold, color: FG },
  composeSearchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SP.sm, height: 44,
    marginBottom: SP.sm,
  },
  composeSearchInput: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, height: 44 },
  composeCenter: { paddingVertical: SP.xl, alignItems: 'center' },
  composeResultRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: SP.sm, minHeight: 52,
  },
  composeAvatar: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.sm,
    paddingBottom: 10,
    backgroundColor: 'transparent',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
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
    color: FG,
  },
  headerUnreadDot: {
    position: 'absolute', top: 8, right: 7, width: 7, height: 7, borderRadius: 4,
    borderWidth: 1.5, borderColor: BG,
  },
  primaryTabs: {
    flexDirection: 'row',
    minHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: 'transparent',
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
  primaryTabText: { fontSize: 13, fontFamily: FONT.regular, color: MUTED },
  primaryTabTextActive: { fontFamily: FONT.semibold, color: FG },
  primaryTabCount: { fontSize: 13, fontFamily: FONT.semibold, color: RED },
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
    marginHorizontal: 0,
    marginTop: 0,
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: 'transparent',
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
    marginHorizontal: 0,
    marginTop: 0,
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
    minHeight: 78,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: 'transparent',
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
    color: MUTED,
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
  listSurface: { flex: 1, backgroundColor: 'transparent' },
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
