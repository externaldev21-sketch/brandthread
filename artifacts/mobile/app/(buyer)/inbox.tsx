import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, FlatList, SectionList, Image,
  Alert, StyleSheet, ScrollView, RefreshControl,
  Modal, TextInput, ActivityIndicator, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { ListSkeleton } from '@/components/layout';
import { EmptyState, SearchBar, SheetHandle, AnimatedEntrance, PressableScale, PrimaryButton } from '@/components/BrandthreadUI';
import { useFocusEffect, useRouter } from 'expo-router';
import { useScrollReset } from '@/hooks/useScrollReset';
import { useAuth } from '@clerk/expo';
import { FONT, FS, SP, RADIUS, ICON, SCREEN_BG, CONTENT_MAX_WIDTH } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  getConversations, markConversationRead, archiveConversation,
  subscribeSocial,
  searchProfiles, createOrGetConversation, muteUser, MY_USER_ID,
  getFriendSuggestions,
} from '@/services/socialService';
import type { Conversation, ProfileSearchResult, AccountType } from '@/services/socialTypes';
import { getSuggestedPeople, dismissSuggestedPerson, type SuggestedPerson } from '@/services/activityService';
import { getCachedTabData, setCachedTabData } from '@/lib/tabDataCache';
import { useApi } from '@/lib/api';
import InboxSwipeRow, { type InboxSwipeAction } from '@/components/inbox/InboxSwipeRow';
import { ConversationPreview } from '@/components/inbox/ConversationPreview';
import { Button } from '@/components/ui/Button';
import { LiveHostRing } from '@/components/live/LiveAvatarRing';
import { Snackbar } from '@/components/ui/Snackbar';
import { hapticPrimaryAction, hapticDestructiveConfirm } from '@/lib/haptics';
import {
  isPreviewInboxEnabled, getPreviewConversations,
  subscribePreviewTyping,
} from '@/lib/previewInbox';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { TabPageHeader } from '@/components/layout/TabPageHeader';

// This screen's Pressables opt out of the shared android_ripple treatment
// (see rippleEnabled on PressableScale/IconButton) — the translucent ripple
// circle read as an unwanted extra layer of chrome on these dense list rows
// and pill controls. Scale/opacity press feedback is unaffected.
const NO_RIPPLE = false;

// ─── Inbox / Requests pill row (Threads-style chips, replaces the old
// underline-tab segmented control) ──────────────────────────────────────────

type InboxTab = 'inbox' | 'requests';

function InboxPillRow({
  value, onChange, requestsCount, theme, gutter, onFilterPress,
}: {
  value: InboxTab;
  onChange: (tab: InboxTab) => void;
  requestsCount: number;
  theme: ReturnType<typeof useAppTheme>['theme'];
  gutter: number;
  onFilterPress: () => void;
}) {
  const pills: { key: InboxTab; label: string; count?: number }[] = [
    { key: 'inbox', label: 'Inbox' },
    { key: 'requests', label: 'Requests', count: requestsCount },
  ];
  return (
    <View style={[pillS.row, { paddingHorizontal: gutter }]}>
      <PressableScale
        style={[pillS.iconPill, { borderColor: theme.border }]}
        onPress={onFilterPress}
        rippleEnabled={NO_RIPPLE}
        accessibilityRole="button"
        accessibilityLabel="Filter messages"
        testID="inbox-filter-pill"
      >
        <Feather name="sliders" size={15} color={theme.text} />
      </PressableScale>
      {pills.map(pill => {
        const active = value === pill.key;
        return (
          <PressableScale
            key={pill.key}
            style={[
              pillS.pill,
              active
                ? { backgroundColor: theme.cardElevated, borderColor: theme.cardElevated }
                : { backgroundColor: 'transparent', borderColor: theme.border },
            ]}
            onPress={() => onChange(pill.key)}
            rippleEnabled={NO_RIPPLE}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            testID={`inbox-tab-${pill.key}`}
          >
            <Text style={[pillS.pillLabel, { color: active ? theme.text : theme.muted }]}>
              {pill.label}
            </Text>
            {!!pill.count && pill.count > 0 && (
              <View style={[pillS.pillCount, { backgroundColor: active ? theme.accent : theme.cardElevated }]}>
                <Text style={[pillS.pillCountText, { color: active ? theme.onAccent : theme.muted }]}>
                  {pill.count > 99 ? '99+' : pill.count}
                </Text>
              </View>
            )}
          </PressableScale>
        );
      })}
    </View>
  );
}

const pillS = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.md },
  iconPill: {
    width: 36, height: 36, borderRadius: RADIUS.pill, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center',
  },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 36, paddingHorizontal: SP.md, borderRadius: RADIUS.pill, borderWidth: StyleSheet.hairlineWidth,
  },
  pillLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, letterSpacing: 0.1 },
  pillCount: { minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  pillCountText: { fontSize: 10, fontFamily: FONT.bold },
});

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

// Active-people rail names must read on one line at a 64pt-avatar column
// width without mid-word ellipsis ("Atelier No…"): prefer the full name when
// it's short enough to plausibly fit, otherwise fall back to just its first
// word ("Atelier Noire" → "Atelier", "Brandthread Agent" → "Brandthread"),
// and only let numberOfLines={1} ellipsize as a last resort for a single
// word that's still too long on its own.
const RAIL_NAME_MAX_CHARS = 11;
function railDisplayName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= RAIL_NAME_MAX_CHARS) return trimmed;
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function InboxScreen() {
  // Only one of the three page-level containers below (two empty-state
  // ScrollViews, one FlashList) mounts at a time, so sharing this ref is safe.
  const scrollResetRef = useScrollReset<any>();
  const insets = useSafeAreaInsets();
  const barInset = useBuyerTabBarInset();
  const router = useRouter();
  const api = useApi();
  const { theme } = useAppTheme();
  // The buyer tab shell already centers route content in a max-width column
  // on wide/web viewports, so this only needs the ordinary phone gutter —
  // an extra centered-padding calculation here would double up with that
  // shell and over-constrain the header at very wide viewports.
  const gutter = SP.md;
  const s = React.useMemo(() => createStyles(theme, gutter), [theme, gutter]);
  const { userId } = useAuth();
  const accountRef = useRef(userId);
  accountRef.current = userId;

  // Real content on the very first frame, not a skeleton: seed from whatever
  // `warmBuyerTabs` (or a previous visit this session) already cached for
  // this tab. A cold start with nothing cached yet falls back to the
  // skeleton exactly as before.
  const cachedInbox = getCachedTabData<{ conversations: Conversation[] }>('inbox');
  const [conversations, setConversations] = useState<Conversation[]>(cachedInbox?.conversations ?? []);
  const [requestActionLoading, setRequestActionLoading] = useState<string | null>(null);
  const [loading, setLoading] = useState(!cachedInbox);
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
  const [messagesSearchFocused, setMessagesSearchFocused] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<InboxTab>('inbox');
  const [typingConvId, setTypingConvId] = useState<string | null>(null);
  const snackbarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "Suggested" section (Instagram/Threads-style people-to-message list) —
  // reuses the real /api/social/suggested endpoint that already backs the
  // Activity screen's suggestions, rather than the still-stubbed
  // getFriendSuggestions() used only for the compose sheet's default
  // directory. Loaded once per mount/account, independent of the compose
  // sheet so it can show up under the Inbox pill without opening compose.
  const [suggestedPeople, setSuggestedPeople] = useState<SuggestedPerson[]>([]);
  const [suggestedLoading, setSuggestedLoading] = useState(true);
  const [messagingSuggestedId, setMessagingSuggestedId] = useState<string | null>(null);

  // Preview-only: simulate a transient "typing…" row for one seeded thread
  // (see lib/previewInbox.ts) — a no-op outside the dev/preview environment.
  useEffect(() => {
    const unsub = subscribePreviewTyping(setTypingConvId);
    return unsub;
  }, []);

  const showSnackbar = useCallback((message: string) => {
    if (snackbarTimer.current) clearTimeout(snackbarTimer.current);
    setSnackbarMessage(message);
    snackbarTimer.current = setTimeout(() => setSnackbarMessage(null), 2500);
  }, []);

  const loadData = useCallback(async () => {
    if (!userId) {
      // The dev-web ?bt_preview=buyer bypass never signs in through Clerk
      // (see lib/devPreview.ts / boost.tsx's isSellerDevPreview pattern), so
      // `userId` is null here in that mode — without this check the seeded
      // preview inbox was unreachable no matter what getConversations()
      // would have returned, and every preview load showed "No messages
      // yet". Real accounts always have a userId and never hit this branch.
      if (isPreviewInboxEnabled()) {
        setConversations(getPreviewConversations());
        setLoading(false);
        return;
      }
      setConversations([]);
      setLoading(false);
      return;
    }
    setLoadError(false);
    try {
      const convs = await getConversations();
      if (accountRef.current !== userId) return;
      // Dev/preview only, and only when the real API genuinely has nothing to
      // show (see lib/previewInbox.ts) — never for a real signed-in account,
      // never when the API returned real rows, and dead code in production.
      if (isPreviewInboxEnabled() && convs.length === 0) {
        setConversations(getPreviewConversations());
      } else {
        setConversations(convs);
        setCachedTabData('inbox', { conversations: convs });
      }
    } catch {
      // A real, reachable backend failing is a real error. In dev/preview
      // (e.g. the web preview with no backend at all) fall back to the same
      // seeded data instead of showing an error state for something that
      // was never going to have a backend to begin with.
      if (isPreviewInboxEnabled()) {
        setLoadError(false);
        setConversations(getPreviewConversations());
      } else {
        setLoadError(true);
        setConversations([]);
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Load the "Suggested" people-to-message list once per account, and again
  // whenever the social pub/sub fires (e.g. after a follow/unfollow changes
  // who counts as a suggestion).
  const loadSuggested = useCallback(async () => {
    if (!userId) {
      setSuggestedPeople([]);
      setSuggestedLoading(false);
      return;
    }
    try {
      const rows = await getSuggestedPeople(8);
      if (accountRef.current !== userId) return;
      setSuggestedPeople(rows);
    } catch {
      // Non-critical: the Suggested section just stays empty on failure.
    } finally {
      setSuggestedLoading(false);
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
    loadSuggested();
  }, [loadData, loadSuggested]));

  useEffect(() => {
    const unsub = subscribeSocial(() => { loadData(); loadSuggested(); });
    return unsub;
  }, [loadData, loadSuggested]);

  // ── Filter logic ────────────────────────────────────────────────────────────

  const messagesSearchLower = messagesSearchQuery.trim().toLowerCase();

  // The primary list: ordinary (non-request, non-archived) conversations,
  // optionally filtered by the search bar, pinned threads (e.g. the official
  // Brandthread Agent welcome thread — see the isPinned comment on
  // Conversation in services/socialTypes.ts) always sorted first.
  const filteredConvs = conversations
    .filter(conv => {
      if (conv.isArchived || conv.isRequest) return false;
      if (messagesSearchLower) {
        const participant = getParticipant(conv);
        const haystack = [
          participant?.name, participant?.handle, conv.lastMessage,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(messagesSearchLower)) return false;
      }
      return true;
    })
    .sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));

  const requestConvs = conversations.filter(conv => conv.isRequest === true && !conv.isArchived);

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
      setActiveTab('inbox');
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

  // Message a person from the "Suggested" section (Threads/Instagram-style
  // people-to-message list) — same createOrGetConversation + navigate
  // pattern as startConversationWith in the compose sheet.
  async function messageSuggested(person: SuggestedPerson) {
    if (messagingSuggestedId) return;
    hapticPrimaryAction();
    setMessagingSuggestedId(person.userId);
    try {
      const conv = await createOrGetConversation({
        type: 'buyer_to_buyer',
        participant: {
          userId: person.userId,
          name: person.name,
          handle: person.handle,
          initials: person.initials,
          color: person.color,
          accountType: 'buyer',
        },
      });
      router.push(`/buyer-conversation?id=${conv.id}` as never);
    } catch {
      Alert.alert('Could not start conversation', 'Check your connection and try again.');
    } finally {
      setMessagingSuggestedId(null);
    }
  }

  function dismissSuggested(person: SuggestedPerson) {
    hapticDestructiveConfirm();
    // Optimistic, local-first removal — a real dismiss endpoint exists
    // (activityService.dismissSuggestedPerson), so tell the backend too, but
    // don't block or roll back the UI on a failed request.
    setSuggestedPeople(prev => prev.filter(p => p.userId !== person.userId));
    dismissSuggestedPerson(person.userId).catch(() => {});
  }

  function openFilterMenu() {
    Alert.alert('Filter messages', 'Coming soon.');
  }

  // ── Render helpers ──────────────────────────────────────────────────────────

  function renderConvRow({ item: conv, index }: { item: Conversation; index: number }) {
    const participant = getParticipant(conv);
    if (!participant) return null;
    const isUnread = conv.unreadCount > 0;
    const isTyping = typingConvId === conv.id;

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
      <AnimatedEntrance delay={Math.min(index, 6) * 30} distance={10}>
        <InboxSwipeRow rowId={conv.id} actions={swipeActions}>
          <PressableScale
            style={[s.convRow, { backgroundColor: theme.background }]}
            onPress={() => openConversation(conv)}
            onLongPress={() => longPressConversation(conv)}
            activeOpacity={0.75}
            rippleEnabled={NO_RIPPLE}
            testID={`inbox-conversation-${conv.id}`}
          >
            {/* Avatar with unread + online dots */}
            <View style={s.avatarContainer}>
              {conv.isOfficial ? (
                <View style={[s.avatar60, s.officialAvatar, { backgroundColor: theme.background, borderColor: theme.border }]}>
                  <BrandthreadLogo size={30} />
                </View>
              ) : (
                // LIVE ring while this person is streaming; tapping the
                // ringed avatar opens their live instead of the thread.
                <LiveHostRing hostId={participant.userId} hostName={participant.name} size={60} pressToWatch>
                  {participant.avatarUri ? (
                    <Image source={{ uri: participant.avatarUri }} style={s.avatar60} testID={`inbox-avatar-image-${conv.id}`} />
                  ) : (
                    <View style={[s.avatar60, { backgroundColor: participant.color }]}>
                      <Text style={s.avatarInitials}>{participant.initials}</Text>
                    </View>
                  )}
                </LiveHostRing>
              )}
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
                {conv.isOfficial && (
                  <View style={s.officialBadgeRow} testID={`inbox-official-badge-${conv.id}`}>
                    <Feather name="check-circle" size={13} color={theme.accent} style={{ marginLeft: 4 }} />
                    <View style={[s.aiTag, { backgroundColor: theme.accentDim }]}>
                      <Text style={[s.aiTagText, { color: theme.accent }]}>AI</Text>
                    </View>
                  </View>
                )}
                {conv.lastMessageTs ? (
                  <Text style={[s.convTime, { color: isUnread ? theme.accent : theme.muted }]}>{timeAgo(conv.lastMessageTs)}</Text>
                ) : null}
              </View>
              {conv.contextOrderNumber ? (
                <View style={[s.orderPill, { backgroundColor: theme.accentDim }]}>
                  <Text style={[s.orderPillText, { color: theme.accent }]}>{conv.contextOrderNumber}</Text>
                </View>
              ) : null}
              {isTyping ? (
                <Text style={[s.convPreview, { color: theme.accent, fontFamily: FONT.semibold }]} testID={`inbox-typing-${conv.id}`}>
                  typing…
                </Text>
              ) : (
                <ConversationPreview
                  text={previewText(conv.lastMessage, 'No messages yet')}
                  attachmentType={conv.lastMessageType}
                  isFromMe={!!conv.lastMessageSenderId && conv.lastMessageSenderId === MY_USER_ID}
                  bold={isUnread}
                  color={isUnread ? theme.text : theme.muted}
                />
              )}
            </View>

            {/* Trailing: unread pill badge, hidden when there is nothing unread */}
            {isUnread ? (
              <View style={[s.unreadBadge, { backgroundColor: theme.accent }]} testID={`inbox-unread-badge-${conv.id}`}>
                <Text style={[s.unreadBadgeText, { color: theme.onAccent }]}>{conv.unreadCount > 99 ? '99+' : conv.unreadCount}</Text>
              </View>
            ) : (
              <Feather name="chevron-right" size={ICON.sm} color={theme.subtle} />
            )}
          </PressableScale>
        </InboxSwipeRow>
      </AnimatedEntrance>
    );
  }

  function renderRequestRow(conv: Conversation) {
    const participant = getParticipant(conv);
    if (!participant) return null;
    const isLoadingAction = requestActionLoading === conv.id;
    return (
      <View key={conv.id} style={s.requestCard}>
        <View style={[s.avatar56, { backgroundColor: participant.color }]}>
          <Text style={s.avatarInitials}>{participant.initials}</Text>
        </View>
        <View style={s.convCenter}>
          <View style={s.convNameRow}>
            <Text style={[s.convName, { color: theme.text, fontFamily: FONT.semibold }]} numberOfLines={1}>{participant.name}</Text>
            {conv.lastMessageTs ? <Text style={[s.convTime, { color: theme.muted }]}>{timeAgo(conv.lastMessageTs)}</Text> : null}
          </View>
          <Text style={[s.convPreview, { color: theme.muted }]} numberOfLines={1}>
            {previewText(conv.lastMessage, 'Sent you a message')}
          </Text>
          <View style={s.requestActions}>
            <Button
              label="Accept"
              variant="primary"
              size="compact"
              style={s.requestActionBtn}
              loading={isLoadingAction}
              disabled={isLoadingAction}
              onPress={() => acceptRequest(conv)}
              testID={`inbox-request-accept-${conv.id}`}
            />
            <Button
              label="Decline"
              variant="secondary"
              size="compact"
              style={s.requestActionBtn}
              disabled={isLoadingAction}
              onPress={() => declineRequest(conv)}
              testID={`inbox-request-decline-${conv.id}`}
            />
          </View>
        </View>
      </View>
    );
  }

  function renderEmptyState() {
    // Only reached for the search-no-matches and load-error cases — the
    // true zero-conversations empty state is the hand-rolled Threads-style
    // treatment below (renderInboxEmptyState).
    if (messagesSearchLower && !loadError) {
      return (
        <EmptyState
          icon="search"
          title="No matches"
          description={`No conversations match "${messagesSearchQuery.trim()}"`}
        />
      );
    }
    return (
      <EmptyState
        icon="alert-circle"
        title="Could not load your inbox"
        description="Pull to refresh and try again."
      />
    );
  }

  // Threads-style empty inbox: centered circular dark badge + envelope icon,
  // bold headline, gray subtitle, full-width filled "Send a message" button.
  function renderInboxEmptyState() {
    return (
      <View style={s.inboxEmptyWrap}>
        <View style={[s.inboxEmptyBadge, { backgroundColor: theme.cardElevated }]}>
          <Feather name="mail" size={30} color={theme.text} />
        </View>
        <Text style={[s.inboxEmptyTitle, { color: theme.text }]}>Keep it real in DMs</Text>
        <Text style={[s.inboxEmptySubtitle, { color: theme.muted }]}>
          Send a message to someone in your network
        </Text>
        <PrimaryButton
          label="Send a message"
          onPress={openCompose}
          style={s.inboxEmptyButton}
          small
        />
      </View>
    );
  }

  // "Suggested" section — people to message, from the real
  // /api/social/suggested endpoint (activityService.getSuggestedPeople).
  // Rendered as the empty state's trailing content, and again as a list
  // footer once there are conversations (Threads/IG show it mainly in the
  // empty state; showing it as a low-risk trailing section too surfaces it
  // without displacing the conversation list).
  function renderSuggestedSection() {
    if (suggestedLoading || suggestedPeople.length === 0) return null;
    return (
      <View style={s.suggestedSection} testID="inbox-suggested-section">
        <Text style={[s.composeSectionTitleLoose, { color: theme.muted }]}>Suggested</Text>
        {suggestedPeople.map(person => (
          <View key={person.userId} style={s.suggestedRow} testID={`inbox-suggested-${person.userId}`}>
            {person.avatarUrl ? (
              <Image source={{ uri: person.avatarUrl }} style={s.suggestedAvatar} />
            ) : (
              <View style={[s.suggestedAvatar, { backgroundColor: person.color }]}>
                <Text style={s.avatarInitials}>{person.initials}</Text>
              </View>
            )}
            <View style={s.convCenter}>
              <Text style={[s.convName, { color: theme.text, fontFamily: FONT.semibold }]} numberOfLines={1}>
                {person.name}
              </Text>
              <Text style={[s.suggestedReason, { color: theme.muted }]} numberOfLines={1}>
                {person.reason}
              </Text>
            </View>
            <View style={s.suggestedActions}>
              <PrimaryButton
                label="Message"
                onPress={() => messageSuggested(person)}
                small
                loading={messagingSuggestedId === person.userId}
                disabled={!!messagingSuggestedId}
                style={s.suggestedMessageBtn}
              />
              <PressableScale
                onPress={() => dismissSuggested(person)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel={`Dismiss suggestion for ${person.name}`}
                testID={`inbox-suggested-dismiss-${person.userId}`}
              >
                <Feather name="x" size={16} color={theme.subtle} />
              </PressableScale>
            </View>
          </View>
        ))}
      </View>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  // Instagram-Notes-style slim avatar rail: the small set of people the buyer
  // is actively talking to.
  const activeRail = filteredConvs.slice(0, 10);

  const requestsTabContent = (
    <ScrollView
      contentContainerStyle={[{ paddingBottom: barInset + SP.md, paddingHorizontal: gutter }]}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.accent} />}
    >
      {requestConvs.length === 0 ? (
        <EmptyState icon="mail" title="No message requests" description="Requests from people you don't follow appear here" />
      ) : (
        requestConvs.map(renderRequestRow)
      )}
    </ScrollView>
  );

  return (
    <View style={[s.root, { backgroundColor: SCREEN_BG }]}>
      <TabPageHeader
        title="Messages"
        gutter={gutter}
        actions={[
          { name: 'edit-3', onPress: openCompose, accessibilityLabel: 'New message', testID: 'inbox-header-compose' },
        ]}
      />

      {/* Search — always available, not gated behind a tab */}
      {!loading && (
        <View style={{ paddingHorizontal: gutter }}>
          <View
            style={[
              s.searchRow,
              {
                backgroundColor: theme.cardElevated,
                borderColor: messagesSearchFocused ? theme.border : 'transparent',
              },
            ]}
          >
            <Feather name="search" size={16} color={theme.muted} />
            <TextInput
              style={[s.searchInput, { color: theme.text }]}
              value={messagesSearchQuery}
              onChangeText={setMessagesSearchQuery}
              placeholder="Search"
              placeholderTextColor={theme.muted}
              autoCorrect={false}
              onFocus={() => setMessagesSearchFocused(true)}
              onBlur={() => setMessagesSearchFocused(false)}
              testID="inbox-search-input"
              accessibilityLabel="Search conversations"
            />
            {messagesSearchQuery.length > 0 && (
              <PressableScale
                onPress={() => setMessagesSearchQuery('')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                rippleEnabled={NO_RIPPLE}
              >
                <Feather name="x" size={16} color={theme.muted} />
              </PressableScale>
            )}
          </View>
        </View>
      )}

      {/* Notes-style active-people rail */}
      {!loading && !messagesSearchLower && activeRail.length > 0 && (
        <AnimatedEntrance distance={12}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.activeRail}
            contentContainerStyle={{ paddingHorizontal: gutter, gap: SP.md }}
          >
            {activeRail.map(conv => {
              const participant = getParticipant(conv);
              if (!participant) return null;
              return (
                <PressableScale
                  key={conv.id}
                  style={s.activeRailItem}
                  onPress={() => openConversation(conv)}
                  rippleEnabled={NO_RIPPLE}
                  accessibilityRole="button"
                  accessibilityLabel={participant.name}
                  testID={`inbox-active-rail-${conv.id}`}
                >
                  {conv.isOfficial ? (
                    <View style={[s.activeRailAvatar, s.officialAvatar, { backgroundColor: theme.background, borderColor: theme.border }]}>
                      <BrandthreadLogo size={26} />
                    </View>
                  ) : (
                    // Ring drawn on the avatar edge: this horizontal
                    // ScrollView clips anything outside the 64pt avatar.
                    <LiveHostRing hostId={participant.userId} hostName={participant.name} size={64} ringGap={-2} pressToWatch>
                      {participant.avatarUri ? (
                        <Image source={{ uri: participant.avatarUri }} style={s.activeRailAvatar} />
                      ) : (
                        <View style={[s.activeRailAvatar, { backgroundColor: participant.color }]}>
                          <Text style={s.activeRailInitials}>{participant.initials}</Text>
                        </View>
                      )}
                    </LiveHostRing>
                  )}
                  <Text style={[s.activeRailName, { color: theme.muted }]} numberOfLines={1}>{railDisplayName(participant.name)}</Text>
                </PressableScale>
              );
            })}
          </ScrollView>
        </AnimatedEntrance>
      )}

      {/* Inbox / Requests pill row */}
      {!loading && (
        <InboxPillRow
          value={activeTab}
          onChange={setActiveTab}
          requestsCount={requestConvs.length}
          theme={theme}
          gutter={gutter}
          onFilterPress={openFilterMenu}
        />
      )}

      {/* Tab content */}
      {loading ? (
        <View style={[s.listSurface, s.listContent, { paddingBottom: barInset + SP.md, paddingHorizontal: gutter }]}>
          <ListSkeleton rows={6} />
        </View>
      ) : activeTab === 'requests' ? (
        requestsTabContent
      ) : filteredConvs.length === 0 ? (
        <ScrollView
          ref={scrollResetRef}
          style={s.listSurface}
          contentContainerStyle={[s.listContent, { paddingBottom: barInset + SP.md }, s.listEmptyContainer]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.accent} />}
        >
          <View style={{ paddingHorizontal: gutter }}>
            {messagesSearchLower || loadError ? renderEmptyState() : renderInboxEmptyState()}
            {!messagesSearchLower && !loadError && renderSuggestedSection()}
          </View>
        </ScrollView>
      ) : (
        <View style={s.listSurface}>
          <FlashList
            ref={scrollResetRef}
            data={filteredConvs}
            keyExtractor={item => item.id}
            renderItem={renderConvRow}
            contentContainerStyle={StyleSheet.flatten([s.listContent, { paddingBottom: barInset + SP.md, paddingHorizontal: gutter }])}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshing={refreshing}
            onRefresh={handleRefresh}
            ListFooterComponent={!messagesSearchLower ? renderSuggestedSection : undefined}
          />
        </View>
      )}

      {/* New message is started from the header pencil icon above — a second
          floating "New message" FAB was a duplicate of that same action and
          has been removed (see item 17: no duplicate compose actions). */}

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
              <Text style={[s.composeTitle, { color: theme.text }]}>New message</Text>
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

function createStyles(theme: ReturnType<typeof useAppTheme>['theme'], gutter: number) {
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
    maxWidth: Platform.OS === 'web' ? CONTENT_MAX_WIDTH + SP.xl * 2 : undefined,
    width: '100%',
    alignSelf: 'center',
  },
  composeHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: SP.sm,
  },
  composeTitle: { fontSize: FS.lg, fontFamily: FONT.bold },
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

  // Instagram-Notes-style active-people rail (below search, above the tabs)
  activeRail: { marginBottom: SP.md },
  activeRailItem: { width: 72, alignItems: 'center', gap: 6 },
  activeRailAvatar: {
    width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center',
  },
  activeRailInitials: { fontSize: FS.md, fontFamily: FONT.bold, color: '#FFFFFF' },
  activeRailName: { fontSize: 11, fontFamily: FONT.medium, width: 72, textAlign: 'center' },

  // Threads-style empty inbox (centered badge + headline + full-width button)
  inboxEmptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: SP.xxl,
    paddingBottom: SP.lg,
    gap: SP.sm,
  },
  inboxEmptyBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SP.sm,
  },
  inboxEmptyTitle: {
    fontSize: FS.lg,
    fontFamily: FONT.bold,
    textAlign: 'center',
  },
  inboxEmptySubtitle: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    textAlign: 'center',
    maxWidth: 300,
    marginBottom: SP.md,
  },
  inboxEmptyButton: {
    width: '100%',
  },

  // "Suggested" section (people to message) — below the conversation list,
  // or trailing the empty state, when on the Inbox pill.
  suggestedSection: { marginTop: SP.lg },
  composeSectionTitleLoose: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: SP.sm,
  },
  suggestedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SP.sm,
    gap: SP.md,
  },
  suggestedAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestedReason: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    marginTop: 2,
  },
  suggestedActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
  },
  suggestedMessageBtn: {
    minWidth: 84,
  },

  // Official / AI-agent row treatment (Brandthread Agent — see the
  // isOfficial comment on Conversation in services/socialTypes.ts)
  officialAvatar: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  officialBadgeRow: { flexDirection: 'row', alignItems: 'center', marginRight: SP.xs },
  aiTag: {
    marginLeft: 4, paddingHorizontal: 5, height: 15, borderRadius: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  aiTagText: { fontSize: 9, fontFamily: FONT.bold, letterSpacing: 0.3 },

  // Request card (inline in the Requests tab)
  requestCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: SP.md,
    gap: SP.md,
  },
  requestActions: {
    flexDirection: 'row',
    gap: SP.sm,
    marginTop: SP.sm,
  },
  requestActionBtn: {
    minWidth: 88,
  },

  // Conversation row — roomier, no per-row hairline (rhythm from spacing,
  // not chrome); bigger avatar for a real visual step up from the prior pass.
  convRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SP.md,
    minHeight: 96,
  },
  avatarContainer: {
    position: 'relative',
  },
  avatar60: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar56: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: FS.md,
    fontFamily: FONT.bold,
    color: '#FFFFFF',
  },
  unreadDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: theme.background,
  },
  onlineDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: SP.md,
    paddingHorizontal: SP.md,
    height: 44,
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    height: 40,
  },
  convCenter: {
    flex: 1,
    marginLeft: SP.md,
  },
  convNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
  },
  convName: {
    flex: 1,
    fontSize: FS.md,
  },
  convTime: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
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
  },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP.xs,
    marginLeft: SP.sm,
  },
  unreadBadgeText: {
    fontSize: FS.xs,
    fontFamily: FONT.bold,
  },

  // Empty state
  listSurface: { flex: 1, backgroundColor: 'transparent' },
  listContent: { paddingBottom: 112 },
  listEmptyContainer: {
    flex: 1,
  },
  });
}
