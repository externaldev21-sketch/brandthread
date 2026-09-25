import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, FlatList, SectionList,
  Alert, StyleSheet, ScrollView, RefreshControl,
  Modal, TextInput, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { ListSkeleton } from '@/components/layout';
import { EmptyState, SearchBar, SheetHandle } from '@/components/BrandthreadUI';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { FONT, FS, SP, RADIUS, ICON, SCREEN_BG } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  getConversations, markConversationRead, archiveConversation,
  subscribeSocial, getNotifications, markNotificationRead,
  searchProfiles, createOrGetConversation, muteUser, MY_USER_ID,
  getFriendSuggestions,
} from '@/services/socialService';
import type { Conversation, Notification, ProfileSearchResult, AccountType } from '@/services/socialTypes';
import { useApi } from '@/lib/api';
import InboxSwipeRow, { type InboxSwipeAction } from '@/components/inbox/InboxSwipeRow';
import { ConversationPreview } from '@/components/inbox/ConversationPreview';
import { IconButton } from '@/components/ui/IconButton';
import { Snackbar } from '@/components/ui/Snackbar';
import { PressableScale } from '@/components/BrandthreadUI';
import { hapticPrimaryAction, hapticDestructiveConfirm } from '@/lib/haptics';

// ─── Compose sheet: unified "person" shape ────────────────────────────────────
// Friends/followers/following come from the follow-graph endpoints in
// lib/api.ts's `social` namespace; suggested people reuse the existing (today
// stubbed-empty) getFriendSuggestions() extension point from socialService
// rather than inventing a new backend endpoint. All are buyer accounts, since
// this sheet only starts buyer_to_buyer conversations.
type ComposePerson = {
  userId: string;
  name: string;
  handle: string;
  initials: string;
  color: string;
  accountType: AccountType;
};

type ComposeSection = { key: string; title: string; data: ComposePerson[] };

function matchesQuery(p: ComposePerson, q: string): boolean {
  return p.name.toLowerCase().includes(q) || p.handle.toLowerCase().includes(q);
}

function dedupePeople(groups: ComposePerson[][]): ComposePerson[] {
  const seen = new Set<string>();
  const out: ComposePerson[] = [];
  for (const group of groups) {
    for (const p of group) {
      if (seen.has(p.userId)) continue;
      seen.add(p.userId);
      out.push(p);
    }
  }
  return out;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Relative-then-absolute timestamp: "2m" / "3h" → weekday ("Tue") → date. */
function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return new Date(ts).toLocaleDateString(undefined, { weekday: 'short' });
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
  const s = React.useMemo(() => createStyles(theme), [theme]);
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
  // Default directory shown before the person types anything: friends
  // (mutual follows) → followers → following → suggested, deduplicated.
  const [composeDirLoading, setComposeDirLoading] = useState(false);
  const [composeFriends, setComposeFriends] = useState<ComposePerson[]>([]);
  const [composeFollowers, setComposeFollowers] = useState<ComposePerson[]>([]);
  const [composeFollowing, setComposeFollowing] = useState<ComposePerson[]>([]);
  const [composeSuggested, setComposeSuggested] = useState<ComposePerson[]>([]);
  const [messagesSearchQuery, setMessagesSearchQuery] = useState('');
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);
  const snackbarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSnackbar = useCallback((message: string) => {
    if (snackbarTimer.current) clearTimeout(snackbarTimer.current);
    setSnackbarMessage(message);
    snackbarTimer.current = setTimeout(() => setSnackbarMessage(null), 2500);
  }, []);

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

  const messagesSearchLower = messagesSearchQuery.trim().toLowerCase();

  const filteredConvs = conversations.filter(conv => {
    // Tab filter
    let tabMatch = false;
    switch (activeTab) {
      case 'Follows': tabMatch = false; break;
      case 'Messages': tabMatch = !conv.isArchived && !conv.isRequest; break;
      case 'Requests': tabMatch = conv.isRequest === true && !conv.isArchived; break;
    }
    if (!tabMatch) return false;
    if (activeTab === 'Messages' && messagesSearchLower) {
      const participant = getParticipant(conv);
      const haystack = [
        participant?.name, participant?.handle, conv.lastMessage,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(messagesSearchLower)) return false;
    }
    return true;
  });

  const followNotifications = notifications.filter(notif => notif.type === 'new_follower' && !notif.isMuted);

  // ── Handlers ────────────────────────────────────────────────────────────────

  function openConversation(conv: Conversation) {
    // Don't open request conversations inline — user must accept first
    if (conv.isRequest) return;
    hapticPrimaryAction();
    markConversationRead(conv.id);
    router.push(`/buyer-conversation?id=${conv.id}` as never);
  }

  async function acceptRequest(conv: Conversation) {
    hapticPrimaryAction();
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
      Alert.alert('Couldn’t accept request', 'Please try again.');
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
              Alert.alert('Couldn’t decline request', 'Please try again.');
            } finally {
              setRequestActionLoading(null);
            }
          },
        },
      ]
    );
  }

  function longPressConversation(conv: Conversation) {
    hapticDestructiveConfirm();
    Alert.alert('Options', undefined, [
      { text: 'Archive', onPress: () => swipeArchiveConversation(conv), style: 'destructive' },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function swipeArchiveConversation(conv: Conversation) {
    await archiveConversation(conv.id);
    setConversations(prev => prev.map(item =>
      item.id === conv.id ? { ...item, isArchived: true } : item
    ));
    showSnackbar('Conversation archived');
  }

  // Swipe actions on a Messages-tab row: delete removes it from the inbox
  // (there is no true delete-conversation endpoint, so this archives it,
  // matching the existing long-press "Archive" behavior), mute silences the
  // other participant (reusing the existing user-mute feature), and mark
  // read clears the unread badge without opening the thread.
  async function swipeDeleteConversation(conv: Conversation) {
    await swipeArchiveConversation(conv);
  }

  async function swipeMuteConversation(conv: Conversation) {
    const participant = getParticipant(conv);
    if (!participant) return;
    try {
      await muteUser({
        userId: participant.userId,
        name: participant.name,
        handle: participant.handle,
        initials: participant.initials,
        color: participant.color,
      });
      showSnackbar(`Muted ${participant.name}`);
    } catch {
      Alert.alert('Couldn’t mute', 'Please try again.');
    }
  }

  async function swipeMarkReadConversation(conv: Conversation) {
    if (conv.unreadCount <= 0) return;
    try {
      await markConversationRead(conv.id);
      setConversations(prev => prev.map(item =>
        item.id === conv.id ? { ...item, unreadCount: 0 } : item
      ));
    } catch {
      Alert.alert('Couldn’t mark as read', 'Please try again.');
    }
  }

  function openCompose() {
    setComposeQuery('');
    setComposeResults([]);
    setComposeVisible(true);
  }

  function closeCompose() {
    setComposeVisible(false);
    setComposeQuery('');
    setComposeResults([]);
  }

  // Load the default directory (friends/followers/following/suggested) once
  // per sheet open, from the same follow-graph endpoints friends.tsx uses.
  useEffect(() => {
    if (!composeVisible) return;
    let cancelled = false;
    setComposeDirLoading(true);
    Promise.all([
      api.social.following().catch(() => []),
      api.social.followers().catch(() => []),
      getFriendSuggestions().catch(() => []),
    ]).then(([followingRows, followerRows, suggestionRows]) => {
      if (cancelled) return;
      const followingList = Array.isArray(followingRows) ? followingRows : [];
      const followerList = Array.isArray(followerRows) ? followerRows : [];
      const suggestionList = Array.isArray(suggestionRows) ? suggestionRows : [];
      // isFollowingBack on a follower row means the relationship is mutual
      // (I follow them and they follow me) — that's what this app's UI
      // treats as a "friend" (there is no separate friend-request table).
      const mutualIds = new Set(followerList.filter(f => f.isFollowingBack).map(f => f.userId));
      const toPerson = (u: { userId: string; name: string; handle: string; initials: string; color: string }): ComposePerson => ({
        userId: u.userId, name: u.name, handle: u.handle, initials: u.initials, color: u.color, accountType: 'buyer',
      });
      const friendsList = followerList.filter(f => mutualIds.has(f.userId)).map(toPerson);
      const followersOnly = followerList.filter(f => !mutualIds.has(f.userId)).map(toPerson);
      const followingOnly = followingList.filter(f => !mutualIds.has(f.userId)).map(toPerson);
      const alreadyShownIds = new Set([...friendsList, ...followersOnly, ...followingOnly].map(p => p.userId));
      const suggested = suggestionList.filter(s => !alreadyShownIds.has(s.userId)).map(toPerson);
      setComposeFriends(friendsList);
      setComposeFollowers(followersOnly);
      setComposeFollowing(followingOnly);
      setComposeSuggested(suggested);
    }).finally(() => {
      if (!cancelled) setComposeDirLoading(false);
    });
    return () => { cancelled = true; };
  }, [composeVisible, api]);

  // Network-wide search (people outside the loaded directory) once the
  // person types — the directory above already covers friends/followers/
  // following/suggested, so this only needs to surface everyone else.
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

  const composeDirectory = useMemo(
    () => dedupePeople([composeFriends, composeFollowers, composeFollowing, composeSuggested]),
    [composeFriends, composeFollowers, composeFollowing, composeSuggested]
  );

  const composeQueryLower = composeQuery.trim().toLowerCase();

  const composeSections: ComposeSection[] = useMemo(() => {
    if (!composeQueryLower) {
      return [
        { key: 'friends', title: 'Friends', data: composeFriends },
        { key: 'followers', title: 'Followers', data: composeFollowers },
        { key: 'following', title: 'Following', data: composeFollowing },
        { key: 'suggested', title: 'Suggested', data: composeSuggested },
      ].filter(sec => sec.data.length > 0);
    }
    const inDirectory = composeDirectory.filter(p => matchesQuery(p, composeQueryLower));
    const directoryIds = new Set(composeDirectory.map(p => p.userId));
    const morePeople: ComposePerson[] = composeResults
      .filter(r => !directoryIds.has(r.userId))
      .map(r => ({ userId: r.userId, name: r.name, handle: r.handle, initials: r.initials, color: r.color, accountType: r.accountType }));
    return [
      { key: 'in-network', title: 'In your network', data: inDirectory },
      { key: 'more-people', title: 'More people', data: morePeople },
    ].filter(sec => sec.data.length > 0);
  }, [composeQueryLower, composeDirectory, composeFriends, composeFollowers, composeFollowing, composeSuggested, composeResults]);

  async function startConversationWith(person: ComposePerson) {
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
    hapticPrimaryAction();
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
              <PressableScale
                style={[s.requestAcceptBtn, { backgroundColor: theme.accent }, isLoadingAction && s.requestBtnDisabled]}
                onPress={() => acceptRequest(conv)}
                disabled={isLoadingAction}
                activeOpacity={0.8}
              >
                <Text style={[s.requestAcceptText, { color: theme.onAccent }]}>Accept</Text>
              </PressableScale>
              <PressableScale
                style={[s.requestDeclineBtn, isLoadingAction && s.requestBtnDisabled]}
                onPress={() => declineRequest(conv)}
                disabled={isLoadingAction}
                activeOpacity={0.8}
              >
                <Text style={s.requestDeclineText}>Decline</Text>
              </PressableScale>
            </View>
          </View>
        </View>
      );
    }

    const swipeActions: InboxSwipeAction[] = [
      {
        key: 'read',
        label: 'Read',
        icon: 'check-circle',
        color: theme.accentDim,
        textColor: theme.accentLight,
        onPress: () => swipeMarkReadConversation(conv),
        accessibilityLabel: `Mark conversation with ${participant.name} as read`,
      },
      {
        key: 'mute',
        label: 'Mute',
        icon: 'bell-off',
        color: theme.cardElevated,
        textColor: theme.muted,
        onPress: () => swipeMuteConversation(conv),
        accessibilityLabel: `Mute ${participant.name}`,
      },
      {
        key: 'delete',
        label: 'Delete',
        icon: 'trash-2',
        color: theme.cardElevated,
        textColor: theme.error,
        onPress: () => swipeDeleteConversation(conv),
        accessibilityLabel: `Delete conversation with ${participant.name}`,
      },
    ];

    return (
      <InboxSwipeRow rowId={conv.id} actions={swipeActions}>
        <PressableScale
          style={s.convRow}
          onPress={() => openConversation(conv)}
          onLongPress={() => longPressConversation(conv)}
          activeOpacity={0.75}
          testID={`inbox-conversation-${conv.id}`}
        >
        {/* Avatar with unread + online dots */}
        <View style={s.avatarContainer}>
          <View style={[s.avatar48, { backgroundColor: participant.color }]}>
            <Text style={s.avatarInitials}>{participant.initials}</Text>
          </View>
          {isUnread && <View style={[s.unreadDot, { backgroundColor: theme.accent, borderColor: theme.background }]} />}
          {participant.isOnline && (
            <View
              style={[s.onlineDot, { backgroundColor: theme.success, borderColor: theme.background }]}
              testID={`inbox-online-dot-${conv.id}`}
            />
          )}
        </View>

        {/* Center content */}
        <View style={s.convCenter}>
          <View style={s.convNameRow}>
            <Text
              style={[s.convName, { color: theme.text, fontFamily: isUnread ? FONT.bold : FONT.regular }]}
              numberOfLines={1}
            >
              {participant.name}
            </Text>
            {conv.lastMessageTs ? (
              <Text style={[s.convTime, { color: theme.muted }]}>{timeAgo(conv.lastMessageTs)}</Text>
            ) : null}
          </View>
          {conv.contextOrderNumber ? (
              <View style={[s.orderPill, { backgroundColor: theme.accentDim }]}>
                <Text style={[s.orderPillText, { color: theme.accent }]}>{conv.contextOrderNumber}</Text>
            </View>
          ) : null}
          <ConversationPreview
            text={previewText(conv.lastMessage, 'No messages yet')}
            attachmentType={conv.lastMessageType}
            isFromMe={!!conv.lastMessageSenderId && conv.lastMessageSenderId === MY_USER_ID}
            bold={isUnread}
            color={isUnread ? theme.text : theme.muted}
          />
        </View>

        {/* Trailing: unread pill badge, hidden when there is nothing unread */}
        {isUnread ? (
          <View style={[s.unreadBadge, { backgroundColor: theme.accent }]} testID={`inbox-unread-badge-${conv.id}`}>
            <Text style={[s.unreadBadgeText, { color: theme.onAccent }]}>{conv.unreadCount > 99 ? '99+' : conv.unreadCount}</Text>
          </View>
        ) : (
            <Feather name="chevron-right" size={ICON.sm} color={theme.muted} />
        )}
        </PressableScale>
      </InboxSwipeRow>
    );
  }

  function renderFollowRow({ item: notif }: { item: Notification }) {
    const isUnread = !notif.isRead;
    return (
      <PressableScale
        style={s.convRow}
        onPress={() => openFollow(notif)}
        accessibilityRole="button"
        accessibilityLabel={notif.title}
      >
        <View style={s.avatarContainer}>
          <View style={[s.avatar48, { backgroundColor: notif.actorColor ?? theme.cardElevated }]}>
            <Text style={s.avatarInitials}>{notif.actorInitials ?? '?'}</Text>
          </View>
          {isUnread && <View style={[s.unreadDot, { backgroundColor: theme.accent }]} />}
        </View>
        <View style={s.convCenter}>
          <View style={s.convNameRow}>
            <Text style={[s.convName, { color: theme.text, fontFamily: isUnread ? FONT.bold : FONT.semibold }]} numberOfLines={1}>
              {notif.actorName ?? notif.title}
            </Text>
            <Text style={s.convTime}>{timeAgo(new Date(notif.createdAt).getTime())}</Text>
          </View>
          <Text style={[s.convPreview, isUnread && { color: theme.text }]} numberOfLines={2}>
            {notif.body || 'Started following you'}
          </Text>
        </View>
        <Feather name="chevron-right" size={ICON.sm} color={theme.muted} />
      </PressableScale>
    );
  }

  function renderEmptyState() {
    if (activeTab === 'Messages' && messagesSearchLower && !loadError) {
      return (
        <EmptyState
          icon="search"
          title="No matches"
          description={`No conversations match "${messagesSearchQuery.trim()}"`}
        />
      );
    }
    const { icon, title, subtitle } = EMPTY_MESSAGES[activeTab];
    const isMessages = activeTab === 'Messages';
    return (
      <EmptyState
        icon={loadError ? 'alert-circle' : icon}
        title={loadError ? 'Could not load your inbox' : title}
        description={loadError ? 'Pull to refresh and try again.' : subtitle}
        action={isMessages && !loadError ? { label: 'New message', onPress: openCompose } : undefined}
      />
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={[s.root, { backgroundColor: SCREEN_BG }]}>
      {/* Header — tab root: no back arrow, just the title and the compose action */}
      <View style={[s.header, { paddingTop: insets.top + SP.sm, borderBottomColor: theme.border }]}>
        <View style={s.headerSide} />
        <Text style={[s.headerTitle, { color: theme.text }]}>Inbox</Text>
        <IconButton
          name="edit-3"
          size={20}
          variant="plain"
          color={theme.text}
          onPress={openCompose}
          accessibilityLabel="New message"
          testID="inbox-header-compose"
        />
      </View>

      {/* Inbox categories */}
      <View style={s.primaryTabs}>
        {TABS.map(tab => {
          const isActive = activeTab === tab;
          const count = tab === 'Requests'
            ? conversations.filter(conv => conv.isRequest && !conv.isArchived).length
            : tab === 'Follows'
              ? followNotifications.filter(notif => !notif.isRead).length
              : conversations.filter(conv => !conv.isRequest && !conv.isArchived && conv.unreadCount > 0).length;
          return (
            <PressableScale
              key={tab}
              style={s.primaryTab}
              onPress={() => { hapticPrimaryAction(); setActiveTab(tab); }}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={tab}
            >
              <Text style={[s.primaryTabText, isActive && s.primaryTabTextActive, { color: isActive ? theme.text : theme.muted }]}>{tab}</Text>
              {count > 0 && <Text style={[s.primaryTabCount, { color: theme.accent }]}>{count > 99 ? '99+' : count}</Text>}
            </PressableScale>
          );
        })}
      </View>

      {/* Search conversations (Messages tab only) */}
      {activeTab === 'Messages' && !loading && (
        <View style={[s.searchRow, { borderColor: theme.border, backgroundColor: theme.cardElevated }]}>
          <Feather name="search" size={15} color={theme.muted} />
          <TextInput
            style={[s.searchInput, { color: theme.text }]}
            value={messagesSearchQuery}
            onChangeText={setMessagesSearchQuery}
            placeholder="Search conversations"
            placeholderTextColor={theme.muted}
            autoCorrect={false}
            testID="inbox-search-input"
            accessibilityLabel="Search conversations"
          />
          {messagesSearchQuery.length > 0 && (
            <PressableScale
              onPress={() => setMessagesSearchQuery('')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Feather name="x" size={15} color={theme.muted} />
            </PressableScale>
          )}
        </View>
      )}

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

      {/* New message FAB */}
      {activeTab === 'Messages' && !loading && (
        <PressableScale
          style={[s.fab, { bottom: barInset + SP.md, backgroundColor: theme.accent, shadowColor: theme.shadowColor }]}
          onPress={() => { hapticPrimaryAction(); openCompose(); }}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="New message"
          testID="inbox-fab-new-message"
        >
          <Feather name="edit-3" size={22} color={theme.onAccent} />
        </PressableScale>
      )}

      <Modal
        visible={composeVisible}
        animationType="slide"
        transparent
        onRequestClose={closeCompose}
      >
        <View style={s.composeBackdrop}>
          <View style={[s.composeSheet, { paddingBottom: insets.bottom + SP.md, backgroundColor: theme.card }]}>
            <SheetHandle />
            <View style={s.composeHeader}>
              <Text style={s.composeTitle}>New message</Text>
              <PressableScale
                onPress={closeCompose}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Feather name="x" size={22} color={theme.text} />
              </PressableScale>
            </View>
            <SearchBar
              value={composeQuery}
              onChange={setComposeQuery}
              placeholder="Search people"
              style={s.composeSearchBar}
            />
            {composeDirLoading && !composeQueryLower ? (
              <View style={s.composeCenter}><ActivityIndicator color={theme.accent} /></View>
            ) : composeSections.length === 0 ? (
              composeLoading ? (
                <View style={s.composeCenter}><ActivityIndicator color={theme.accent} /></View>
              ) : (
                <View style={s.composeCenter}>
                  <Text style={{ color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm }}>
                    {composeQueryLower ? 'No one found' : 'No one to show yet'}
                  </Text>
                </View>
              )
            ) : (
              <SectionList
                sections={composeSections}
                keyExtractor={item => item.userId}
                keyboardShouldPersistTaps="handled"
                stickySectionHeadersEnabled={false}
                ListFooterComponent={
                  composeQueryLower && composeLoading
                    ? <View style={s.composeCenter}><ActivityIndicator color={theme.accent} size="small" /></View>
                    : null
                }
                renderSectionHeader={({ section }) => (
                  <Text style={[s.composeSectionTitle, { color: theme.muted, backgroundColor: theme.card }]}>{section.title}</Text>
                )}
                renderItem={({ item }) => (
                  <PressableScale
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
                  </PressableScale>
                )}
              />
            )}
          </View>
        </View>
      </Modal>

      <Snackbar
        visible={!!snackbarMessage}
        message={snackbarMessage ?? ''}
        onDismiss={() => setSnackbarMessage(null)}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function createStyles(theme: ReturnType<typeof useAppTheme>['theme']) {
  return StyleSheet.create({
  root: { flex: 1 },

  // Compose modal
  composeBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  composeSheet: {
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingTop: SP.sm,
    paddingHorizontal: SP.md,
    height: '70%',
  },
  composeHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border, alignSelf: 'center', marginBottom: SP.sm },
  composeHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: SP.sm,
  },
  composeTitle: { fontSize: FS.md, fontFamily: FONT.bold, color: theme.text },
  composeSearchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: theme.border, borderRadius: RADIUS.md, paddingHorizontal: SP.sm, height: 44,
    marginBottom: SP.sm,
  },
  composeSearchInput: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, height: 44 },
  composeSearchBar: { marginBottom: SP.sm },
  composeSectionTitle: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingTop: SP.sm,
    paddingBottom: SP.xs,
  },
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
  },
  primaryTabs: {
    flexDirection: 'row',
    minHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
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
  primaryTabText: { fontSize: 13, fontFamily: FONT.regular },
  primaryTabTextActive: { fontFamily: FONT.semibold },
  primaryTabCount: { fontSize: 13, fontFamily: FONT.semibold },
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
    color: theme.text,
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
    borderBottomColor: theme.border,
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
    minHeight: 36,
    paddingVertical: SP.xs,
    borderRadius: RADIUS.md,
  },
  requestAcceptText: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: theme.onAccent,
  },
  requestDeclineBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    paddingVertical: SP.xs,
    backgroundColor: theme.card,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: theme.border,
  },
  requestDeclineText: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: theme.muted,
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
    borderBottomColor: theme.border,
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
    borderColor: theme.background,
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 2,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: SP.md,
    marginTop: SP.sm,
    marginBottom: SP.xs,
    paddingHorizontal: SP.sm,
    height: 40,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    height: 40,
  },
  fab: {
    position: 'absolute',
    right: SP.md,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
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
  },
  convTime: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: theme.muted,
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
    color: theme.muted,
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
    color: theme.onAccent,
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
    color: theme.muted,
    marginTop: SP.sm,
  },
  emptySubtitle: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: theme.subtle,
  },
  retryText: { fontSize: FS.sm, fontFamily: FONT.semibold, marginTop: SP.sm },
  });
}
