import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, FlatList, SectionList, Image,
  Alert, StyleSheet, ScrollView, RefreshControl,
  Modal, TextInput, ActivityIndicator, Platform, Animated,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { ListSkeleton } from '@/components/layout';
import { EmptyState, SearchBar, SheetHandle, AnimatedEntrance, PressableScale, PrimaryButton, useUndoToast } from '@/components/BrandthreadUI';
import { useFocusEffect, useRouter } from 'expo-router';
import { useScrollReset } from '@/hooks/useScrollReset';
import { useAuth, useUser } from '@clerk/expo';
import { LinearGradient } from 'expo-linear-gradient';
import { FONT, FS, SP, RADIUS, SCREEN_BG, CONTENT_MAX_WIDTH } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  getConversations, markConversationRead, archiveConversation,
  subscribeSocial,
  searchProfiles, createOrGetConversation, muteUser, MY_USER_ID,
  getFriendSuggestions, cacheStoriesForViewer, setConversationPinned,
} from '@/services/socialService';
import type { Conversation, ProfileSearchResult, AccountType, Story } from '@/services/socialTypes';
import { getSuggestedPeople, dismissSuggestedPerson, type SuggestedPerson } from '@/services/activityService';
import { getCachedTabData, setCachedTabData } from '@/lib/tabDataCache';
import { useApi } from '@/lib/api';
import InboxSwipeRow, { type InboxSwipeAction } from '@/components/inbox/InboxSwipeRow';
import { ConversationPreview } from '@/components/inbox/ConversationPreview';
import { LiveHostRing } from '@/components/live/LiveAvatarRing';
import { getLiveDirectory } from '@/lib/live/useLiveDirectory';
import { Snackbar } from '@/components/ui/Snackbar';
import { hapticPrimaryAction, hapticDestructiveConfirm } from '@/lib/haptics';
import {
  isPreviewInboxEnabled, isPreviewConversationId, getPreviewConversations,
  subscribePreviewTyping, setPreviewConversationPinned,
} from '@/lib/previewInbox';
import {
  scheduleDeleteConversationRequest, undoDeleteConversationRequest, blockConversationRequestUser,
} from '@/lib/requestActions';
import { subscribePendingConversationDeletes } from '@/lib/pendingRequestDeletes';
import { confirmDestructiveActionSheet } from '@/lib/actionSheet';
import { BLOCK_EXPLAINER } from '@/lib/safety';
import {
  isPreviewStoriesEnabled, getPreviewStoryTrayRows, getPreviewStoryFor,
  markPreviewStorySeen, PREVIEW_MY_STORY,
} from '@/lib/previewStories';
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

/** Fire-and-forget "mark read" for a conversation row tap. A seeded preview
 *  conversation (see lib/previewInbox.ts) has no real backend record, so a
 *  real PATCH for it 401s with no signed-in user — skip the network call
 *  entirely there, and everywhere else swallow the rejection so a slow/failed
 *  read receipt never surfaces as an uncaught error. */
function markReadSafely(conversationId: string): void {
  if (isPreviewConversationId(conversationId)) return;
  void markConversationRead(conversationId).catch(() => {});
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

// ─── Stories tray ───────────────────────────────────────────────────────────
// One row per followed person who is either LIVE right now or has an active
// (< 24h old) story, ordered LIVE → unseen → seen (newest first within each
// group) — replaces the old "people I've messaged" rail entirely. "Your
// story" is always a separate, first slot (see MyStorySlot below), not part
// of this list.
type StoryTrayRow = {
  authorId: string;
  name: string;
  handle: string;
  initials: string;
  color: string;
  avatarUri?: string;
  /** Latest active story id for this author, or null if they only qualify
   *  for the tray by being LIVE (tapping them opens the live pager, never
   *  the story viewer, so no story needs to be resolved). */
  storyId: string | null;
  seen: boolean;
  latestCreatedAt: number;
};

function sortStoryTray(rows: StoryTrayRow[], isLive: (authorId: string) => boolean): StoryTrayRow[] {
  return [...rows].sort((a, b) => {
    const aLive = isLive(a.authorId), bLive = isLive(b.authorId);
    if (aLive !== bLive) return aLive ? -1 : 1;
    if (a.seen !== b.seen) return a.seen ? 1 : -1;
    return b.latestCreatedAt - a.latestCreatedAt;
  });
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function InboxScreen() {
  // Only one of the three page-level containers below (two empty-state
  // ScrollViews, one FlashList) mounts at a time, so sharing this ref is safe.
  const scrollResetRef = useScrollReset<any>();
  const insets = useSafeAreaInsets();
  // Matches TabPageHeader's own topPad exactly, so the search-mode header row
  // sits at the identical vertical position as the title/icon row it swaps
  // with — see that component for why web needs the fixed 67 fallback.
  const headerTopPad = Platform.OS === 'web' ? 67 : insets.top;
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
  const [loading, setLoading] = useState(!cachedInbox);
  // Requests deleted (or "Delete all"-ed) in this session sit in a ~4s undo
  // window (lib/pendingRequestDeletes.ts) before the real delete actually
  // fires. Tracked here purely to force a re-render + filter them out of
  // every derived list — the module itself is the source of truth, not this
  // state — so navigating away and back never resurrects a row mid-undo.
  const [pendingDeleteIds, setPendingDeleteIds] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => subscribePendingConversationDeletes(setPendingDeleteIds), []);
  const { showUndo } = useUndoToast();
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
  // Instagram-style header search: the header's title + icon row swaps for a
  // focused text field + Cancel when the search icon is tapped, instead of
  // the search box living permanently under the header.
  const [isSearchBarOpen, setIsSearchBarOpen] = useState(false);
  const messagesSearchInputRef = useRef<TextInput>(null);
  // Quick, non-bouncy fade for the header <-> search-field swap (timing, not
  // a spring — AnimatedEntrance's spring bounce doesn't fit this transition).
  const searchHeaderFade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isSearchBarOpen) { searchHeaderFade.setValue(0); return; }
    Animated.timing(searchHeaderFade, {
      toValue: 1,
      duration: 140,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [isSearchBarOpen, searchHeaderFade]);
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

  // Stories tray — see loadStoryTray() below. `myStoryId` is null when the
  // buyer has no active story ("Your story" then shows the add/"+" badge).
  const { user: clerkUser } = useUser();
  const [storyTrayRows, setStoryTrayRows] = useState<StoryTrayRow[]>([]);
  const [myStoryId, setMyStoryId] = useState<string | null>(null);
  const myAvatarUri = clerkUser?.hasImage ? clerkUser.imageUrl : undefined;
  const myDisplayName = clerkUser?.fullName || clerkUser?.firstName || clerkUser?.username || 'You';
  const myInitials = myDisplayName.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase() || 'Y';

  // Re-renders whenever the shared LIVE directory changes (same singleton
  // LiveHostRing reads from), so sorting the tray by "is this author live
  // right now" always reflects the latest state without a per-row hook.
  const liveDirectory = getLiveDirectory();
  React.useSyncExternalStore(liveDirectory.subscribe, liveDirectory.version, liveDirectory.version);
  const isAuthorLive = useCallback((authorId: string) => !!liveDirectory.streamFor(authorId), [liveDirectory]);

  const loadStoryTray = useCallback(async () => {
    if (!userId) {
      if (isPreviewStoriesEnabled()) {
        setStoryTrayRows(getPreviewStoryTrayRows().map(r => ({
          authorId: r.authorId, name: r.authorName, handle: r.authorHandle, initials: r.authorInitials,
          color: r.authorColor, avatarUri: r.avatarUrl, storyId: r.isLive ? null : getPreviewStoryFor(r.authorId)?.id ?? null,
          seen: r.seen, latestCreatedAt: r.latestCreatedAt,
        })));
        setMyStoryId(PREVIEW_MY_STORY.id);
        cacheStoriesForViewer([
          PREVIEW_MY_STORY,
          ...getPreviewStoryTrayRows().map(r => getPreviewStoryFor(r.authorId)).filter((s): s is Story => !!s),
        ]).catch(() => {});
      } else {
        setStoryTrayRows([]);
        setMyStoryId(null);
      }
      return;
    }
    try {
      const rows = await api.social.storiesFollowing();
      if (accountRef.current !== userId) return;
      const others = rows.filter(r => !r.isMe);
      const mine = rows.find(r => r.isMe);
      setMyStoryId(mine?.storyIds?.[mine.storyIds.length - 1] ?? null);
      setStoryTrayRows(others.map(r => ({
        authorId: r.authorId, name: r.authorName, handle: r.authorHandle, initials: r.authorInitials,
        color: r.authorColor, avatarUri: r.avatarUrl ?? undefined,
        storyId: r.storyIds[r.storyIds.length - 1] ?? null, seen: r.seen, latestCreatedAt: r.latestCreatedAt,
      })));
      // Resolve the real (media-bearing) Story objects so the viewer — which
      // reads its queue purely from local storage — can actually show them.
      const fetches: Promise<Story[]>[] = [];
      if (mine) fetches.push(api.social.myStories().catch(() => []) as Promise<Story[]>);
      for (const o of others) fetches.push(api.social.storiesForUser(o.authorId).catch(() => []) as Promise<Story[]>);
      const fetched = (await Promise.all(fetches)).flat();
      if (fetched.length) cacheStoriesForViewer(fetched).catch(() => {});
    } catch {
      if (isPreviewStoriesEnabled()) {
        setStoryTrayRows(getPreviewStoryTrayRows().map(r => ({
          authorId: r.authorId, name: r.authorName, handle: r.authorHandle, initials: r.authorInitials,
          color: r.authorColor, avatarUri: r.avatarUrl, storyId: r.isLive ? null : getPreviewStoryFor(r.authorId)?.id ?? null,
          seen: r.seen, latestCreatedAt: r.latestCreatedAt,
        })));
        setMyStoryId(PREVIEW_MY_STORY.id);
        cacheStoriesForViewer([
          PREVIEW_MY_STORY,
          ...getPreviewStoryTrayRows().map(r => getPreviewStoryFor(r.authorId)).filter((s): s is Story => !!s),
        ]).catch(() => {});
      } else {
        setStoryTrayRows([]);
        setMyStoryId(null);
      }
    }
  }, [userId, api]);

  // Preview-only overlay for the "typing…" row treatment: real accounts get
  // it purely from `conv.agentTyping` below (polled via GET /api/conversations
  // — the only real "someone is typing" signal that exists today, and only
  // ever true for the Brandthread Agent thread; there is no presence/typing
  // mechanism for ordinary human buyer<->seller or buyer<->buyer threads).
  // This just simulates that same field, on that same seeded Agent thread,
  // for the seeded dev/preview inbox — a no-op outside that environment.
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
    loadStoryTray();
  }, [loadData, loadSuggested, loadStoryTray]));

  useEffect(() => {
    const unsub = subscribeSocial(() => { loadData(); loadSuggested(); loadStoryTray(); });
    return unsub;
  }, [loadData, loadSuggested, loadStoryTray]);

  // ── Filter logic ────────────────────────────────────────────────────────────

  const messagesSearchLower = messagesSearchQuery.trim().toLowerCase();

  // The primary list: ordinary (non-request, non-archived) conversations,
  // optionally filtered by the search bar, pinned threads (e.g. the official
  // Brandthread Agent welcome thread — see the isPinned comment on
  // Conversation in services/socialTypes.ts) always sorted first.
  const filteredConvs = conversations
    .filter(conv => {
      if (conv.isArchived || conv.isRequest || pendingDeleteIds.has(conv.id)) return false;
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

  const requestConvs = conversations.filter(conv =>
    conv.isRequest === true && !conv.isArchived && !pendingDeleteIds.has(conv.id)
  );

  // ── Handlers ────────────────────────────────────────────────────────────────

  function openConversation(conv: Conversation) {
    // Don't open request conversations inline — user must accept first
    if (conv.isRequest) return;
    hapticPrimaryAction();
    markReadSafely(conv.id);
    router.push(`/buyer-conversation?id=${conv.id}` as never);
  }

  // Stories tray — ordered LIVE → unseen → seen (newest first within each
  // group); "Your story" isn't part of this array, it's prepended separately
  // wherever the queue for the full-screen viewer is built.
  const orderedStoryTray = sortStoryTray(storyTrayRows, isAuthorLive);

  // The story-viewer's queue: every tray entry that actually has a story to
  // show (LIVE-only entries are skipped — tapping those opens the live pager
  // instead), in the same LIVE→unseen→seen order as the tray, with "Your
  // story" first when the buyer has one active.
  const storyQueue: Array<{ authorId: string; storyId: string }> = [
    ...(myStoryId ? [{ authorId: 'me', storyId: myStoryId }] : []),
    ...orderedStoryTray.filter((r): r is StoryTrayRow & { storyId: string } => !!r.storyId)
      .map(r => ({ authorId: r.authorId, storyId: r.storyId })),
  ];

  function openStoryViewerFor(authorId: string) {
    const idx = storyQueue.findIndex(q => q.authorId === authorId);
    if (idx < 0) return;
    hapticPrimaryAction();
    // Optimistic "seen" — the real seen flag is authoritative on next
    // load (trackStoryView / api.social.viewStory), but this keeps the
    // tray from flashing a person back into the unseen group before that
    // round-trip lands, and is the only signal preview mode gets at all.
    setStoryTrayRows(prev => prev.map(r => r.authorId === authorId ? { ...r, seen: true } : r));
    markPreviewStorySeen(authorId);
    const allStoryIds = storyQueue.map(q => q.storyId).join(',');
    router.push(`/buyer-story-viewer?storyId=${encodeURIComponent(storyQueue[idx].storyId)}&allStoryIds=${encodeURIComponent(allStoryIds)}` as never);
  }

  function openMyStorySlot() {
    hapticPrimaryAction();
    if (myStoryId) {
      openStoryViewerFor('me');
    } else {
      router.push('/buyer-story-create' as never);
    }
  }

  // Requests-tab row tap: opens the conversation in request mode (see
  // buyer-conversation.tsx's isRequestMode branch — hidden composer, bottom
  // accept/delete/block panel). Deliberately does NOT call markReadSafely —
  // per the Instagram-style request flow, the sender shouldn't see a read
  // receipt until the recipient actually accepts.
  function openRequestConversation(conv: Conversation) {
    hapticPrimaryAction();
    router.push(`/buyer-conversation?id=${conv.id}` as never);
  }

  // Delete with a real, working Undo: the row leaves the list immediately,
  // but the real (irreversible — see conversations.ts's hard DELETE) API
  // call is deferred ~4s behind lib/pendingRequestDeletes.ts, so "Undo" can
  // still cancel it in time.
  function deleteRequestConversation(conv: Conversation) {
    const participant = getParticipant(conv);
    hapticDestructiveConfirm();
    scheduleDeleteConversationRequest(conv.id, api);
    showUndo({
      message: `Deleted request from ${participant?.name ?? 'this person'}`,
      undo: () => undoDeleteConversationRequest(conv.id),
    });
  }

  function deleteAllRequests() {
    if (requestConvs.length === 0) return;
    hapticDestructiveConfirm();
    const ids = requestConvs.map(c => c.id);
    ids.forEach(id => scheduleDeleteConversationRequest(id, api));
    showUndo({
      message: ids.length === 1 ? 'Deleted 1 request' : `Deleted ${ids.length} requests`,
      undo: () => ids.forEach(id => undoDeleteConversationRequest(id)),
    });
  }

  async function blockRequestConversation(conv: Conversation) {
    const participant = getParticipant(conv);
    if (!participant) return;
    const confirmed = await confirmDestructiveActionSheet({
      title: `Block ${participant.name}?`,
      message: BLOCK_EXPLAINER,
      confirmLabel: 'Block',
    });
    if (!confirmed) return;
    hapticDestructiveConfirm();
    try {
      await blockConversationRequestUser(conv.id, participant);
      setConversations(prev => prev.filter(c => c.id !== conv.id));
      showSnackbar(`Blocked ${participant.name}`);
    } catch {
      Alert.alert('Couldn’t block', 'Please try again.');
    }
  }

  function longPressConversation(conv: Conversation) {
    hapticDestructiveConfirm();
    Alert.alert('Options', undefined, [
      { text: 'Archive', onPress: () => swipeArchiveConversation(conv), style: 'destructive' },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function swipeArchiveConversation(conv: Conversation) {
    // archiveConversation() re-fetches the real conversation list first — a
    // seeded preview conversation has no real backend record, so that would
    // 401 with no signed-in user. Just update local state there instead.
    if (isPreviewConversationId(conv.id)) {
      setConversations(prev => prev.map(item =>
        item.id === conv.id ? { ...item, isArchived: true } : item
      ));
      showSnackbar('Conversation archived');
      return;
    }
    try {
      await archiveConversation(conv.id);
      setConversations(prev => prev.map(item =>
        item.id === conv.id ? { ...item, isArchived: true } : item
      ));
      showSnackbar('Conversation archived');
    } catch {
      Alert.alert('Couldn’t archive', 'Please try again.');
    }
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

  // Swipe > Pin (item 62): optimistic toggle — the row's icon/label and sort
  // position update immediately, before the request lands, then roll back +
  // surface an alert if the request fails. The official Brandthread Agent
  // thread is always pinned (see isPinned's comment in socialTypes.ts) and
  // has no real per-participant row to toggle, so it's excluded here the
  // same way it's excluded from every other swipe action on this row.
  async function swipePinConversation(conv: Conversation) {
    if (conv.isOfficial) return;
    const nextPinned = !conv.isPinned;
    setConversations(prev => prev.map(item =>
      item.id === conv.id ? { ...item, isPinned: nextPinned } : item
    ));
    try {
      if (isPreviewConversationId(conv.id)) {
        setPreviewConversationPinned(conv.id, nextPinned);
      } else {
        await setConversationPinned(conv.id, nextPinned);
      }
      showSnackbar(nextPinned ? 'Conversation pinned' : 'Conversation unpinned');
    } catch {
      // Roll back to the pre-toggle state on failure.
      setConversations(prev => prev.map(item =>
        item.id === conv.id ? { ...item, isPinned: conv.isPinned } : item
      ));
      Alert.alert(nextPinned ? 'Couldn’t pin' : 'Couldn’t unpin', 'Please try again.');
    }
  }

  async function swipeMarkReadConversation(conv: Conversation) {
    if (conv.unreadCount <= 0) return;
    // A seeded preview conversation has no real backend record to PATCH —
    // just update local state, matching openConversation's markReadSafely.
    if (isPreviewConversationId(conv.id)) {
      setConversations(prev => prev.map(item =>
        item.id === conv.id ? { ...item, unreadCount: 0 } : item
      ));
      return;
    }
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

  function openMessagesSearch() {
    setIsSearchBarOpen(true);
    // Ref isn't attached until this render commits the search field in.
    setTimeout(() => messagesSearchInputRef.current?.focus(), 0);
  }

  function cancelMessagesSearch() {
    messagesSearchInputRef.current?.blur();
    setIsSearchBarOpen(false);
    setMessagesSearchQuery('');
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
    // Real signal: `conv.agentTyping` (only ever true for the Brandthread
    // Agent thread — see the field's comment on Conversation in
    // services/socialTypes.ts). `typingConvId` is the preview-only overlay
    // above, which flips the exact same seeded Agent thread's state so the
    // row treatment demos the same real field rather than a fake parallel
    // mechanism — it is never set for an ordinary buyer<->seller/buyer row.
    const isTyping = conv.agentTyping === true || typingConvId === conv.id;

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
      // Instagram-inspired action (icon/naming borrowed from its DM
      // pin/mute/delete set — see the Mobbin citation in this PR's
      // description); kept on Brandthread's existing swipe gesture rather
      // than switching to Instagram's long-press menu. Not shown on the
      // always-pinned official Brandthread Agent thread, which has nothing
      // for the viewer to toggle.
      ...(conv.isOfficial ? [] : [{
        key: 'pin',
        label: conv.isPinned ? 'Unpin' : 'Pin',
        icon: 'bookmark' as const,
        color: theme.cardElevated,
        textColor: theme.muted,
        onPress: () => swipePinConversation(conv),
        accessibilityLabel: conv.isPinned
          ? `Unpin conversation with ${participant.name}`
          : `Pin conversation with ${participant.name}`,
      }]),
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
            {/* Avatar — Threads-style: no unread/online dot chrome on the
                avatar itself, unread is conveyed by the name/preview weight
                and the trailing dot instead (see below). The LIVE ring
                (LiveHostRing) is the only badge that still lives here.

                Every row's slot is a fixed 56x56 box (s.avatarContainer,
                below) so the row layout never shifts based on live state.
                The photo itself renders at 48x48, centered in that box —
                for a live row this leaves exactly the 2pt ring + 2pt gap
                LiveAvatarRing draws at its default ringWidth (2) and
                ringGap={2} room to sit fully *inside* the 56 box:
                ring outer edge = 48 + 2*ringGap(2) + 2*ringWidth(2) = 56.
                Previously the ring was drawn *outside* a full 56x56 photo
                (ring outer edge = 66), which is what bled past the row's
                left edge on live rows (Atelier Noire, Maison Vela, Kuro
                Line) while non-live rows (no ring at all) rendered fine. */}
            <View style={s.avatarContainer}>
              {conv.isOfficial ? (
                <View style={[s.avatar56, s.officialAvatar, { backgroundColor: theme.background, borderColor: theme.border }]}>
                  <BrandthreadLogo size={28} />
                </View>
              ) : (
                // LIVE ring while this person is streaming; tapping the
                // ringed avatar opens their live instead of the thread.
                <LiveHostRing hostId={participant.userId} hostName={participant.name} size={48} ringGap={2} pressToWatch>
                  {participant.avatarUri ? (
                    <Image source={{ uri: participant.avatarUri }} style={s.avatar48} testID={`inbox-avatar-image-${conv.id}`} />
                  ) : (
                    <View style={[s.avatar48, { backgroundColor: participant.color }]}>
                      <Text style={s.avatarInitials}>{participant.initials}</Text>
                    </View>
                  )}
                </LiveHostRing>
              )}
            </View>

            {/* Center content — flex:1 + minWidth:0 (s.convCenter) so a long
                name/preview truncates instead of pushing the trailing
                time/dot column off the row. The order chip that used to be
                its own row is now folded into the preview line itself
                (ConversationPreview's orderNumber prop) — that's what kept
                Kuro Line's row 3 lines tall instead of the shared ~72pt
                every other row uses. */}
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
                    <Feather name="check-circle" size={12} color={theme.accent} />
                    <View style={[s.aiTag, { backgroundColor: theme.accentDim }]}>
                      <Text style={[s.aiTagText, { color: theme.accent }]}>AI</Text>
                    </View>
                  </View>
                )}
              </View>
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
                  orderNumber={conv.contextOrderNumber}
                />
              )}
            </View>

            {/* Trailing column — time above, unread dot below, both
                right-aligned to the same edge (Threads style). No numeric
                badge, no chevron. */}
            <View style={s.convTrailing}>
              {conv.lastMessageTs ? (
                <Text style={[s.convTime, { color: theme.muted, marginLeft: 0 }]} numberOfLines={1}>{timeAgo(conv.lastMessageTs)}</Text>
              ) : null}
              {isUnread ? (
                <View style={[s.unreadDotTrailing, { backgroundColor: theme.accent }]} testID={`inbox-unread-badge-${conv.id}`} />
              ) : null}
            </View>
          </PressableScale>
        </InboxSwipeRow>
      </AnimatedEntrance>
    );
  }

  // Requests-tab row — deliberately styled IDENTICAL to an Inbox row
  // (renderConvRow above: same avatarContainer/avatar48 sizing, same left
  // inset, same name/preview/time typography, same trailing unread dot).
  // Per the redesign spec, no Accept/Decline buttons live in the list itself
  // — tapping the row just opens the conversation in request mode; Block/
  // Delete are reachable via swipe, matching the rest of the Messages tab's
  // swipe-action convention (InboxSwipeRow), and Accept/Delete/Block all
  // live in the conversation screen's own bottom panel.
  function renderRequestRow({ item: conv, index }: { item: Conversation; index: number }) {
    const participant = getParticipant(conv);
    if (!participant) return null;
    const isUnread = conv.unreadCount > 0;

    const swipeActions: InboxSwipeAction[] = [
      {
        key: 'block',
        label: 'Block',
        icon: 'slash',
        color: theme.cardElevated,
        textColor: theme.error,
        onPress: () => blockRequestConversation(conv),
        accessibilityLabel: `Block ${participant.name}`,
      },
      {
        key: 'delete',
        label: 'Delete',
        icon: 'trash-2',
        color: theme.cardElevated,
        textColor: theme.error,
        onPress: () => deleteRequestConversation(conv),
        accessibilityLabel: `Delete request from ${participant.name}`,
      },
    ];

    return (
      <AnimatedEntrance delay={Math.min(index, 6) * 30} distance={10}>
        <InboxSwipeRow rowId={conv.id} actions={swipeActions}>
          <PressableScale
            style={[s.convRow, { backgroundColor: theme.background }]}
            onPress={() => openRequestConversation(conv)}
            activeOpacity={0.75}
            rippleEnabled={NO_RIPPLE}
            testID={`inbox-request-row-${conv.id}`}
          >
            <View style={s.avatarContainer}>
              {participant.avatarUri ? (
                <Image source={{ uri: participant.avatarUri }} style={s.avatar48} testID={`inbox-request-avatar-image-${conv.id}`} />
              ) : (
                <View style={[s.avatar48, { backgroundColor: participant.color }]}>
                  <Text style={s.avatarInitials}>{participant.initials}</Text>
                </View>
              )}
            </View>

            <View style={s.convCenter}>
              <View style={s.convNameRow}>
                <Text
                  style={[s.convName, { color: theme.text, fontFamily: isUnread ? FONT.bold : FONT.regular }]}
                  numberOfLines={1}
                >
                  {participant.name}
                </Text>
              </View>
              <ConversationPreview
                text={previewText(conv.lastMessage, 'Sent you a message')}
                attachmentType={conv.lastMessageType}
                isFromMe={false}
                bold={isUnread}
                color={isUnread ? theme.text : theme.muted}
              />
            </View>

            <View style={s.convTrailing}>
              {conv.lastMessageTs ? (
                <Text style={[s.convTime, { color: theme.muted, marginLeft: 0 }]} numberOfLines={1}>{timeAgo(conv.lastMessageTs)}</Text>
              ) : null}
              {isUnread ? (
                <View style={[s.unreadDotTrailing, { backgroundColor: theme.accent }]} testID={`inbox-request-unread-${conv.id}`} />
              ) : null}
            </View>
          </PressableScale>
        </InboxSwipeRow>
      </AnimatedEntrance>
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

  const requestsTabContent = (
    <ScrollView
      contentContainerStyle={[{ paddingBottom: barInset + SP.md, paddingHorizontal: gutter }]}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.accent} />}
    >
      {requestConvs.length === 0 ? (
        <EmptyState icon="mail" illustration="envelope" title="No message requests" description="Requests from people you don't follow appear here" />
      ) : (
        <>
          <View style={s.requestsHeaderRow}>
            <Text style={[s.requestsHeaderText, { color: theme.muted }]}>
              Open a chat to get info about who's messaging you. They won't know you've seen it until you accept.
            </Text>
            <PressableScale
              style={s.requestsDeleteAllPressable}
              onPress={deleteAllRequests}
              rippleEnabled={NO_RIPPLE}
              accessibilityRole="button"
              accessibilityLabel="Delete all requests"
              testID="inbox-requests-delete-all"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[s.requestsDeleteAll, { color: theme.muted }]}>Delete all</Text>
            </PressableScale>
          </View>
          {requestConvs.map((conv, index) => (
            <React.Fragment key={conv.id}>{renderRequestRow({ item: conv, index })}</React.Fragment>
          ))}
        </>
      )}
    </ScrollView>
  );

  return (
    <View style={[s.root, { backgroundColor: SCREEN_BG }]}>
      {isSearchBarOpen ? (
        <Animated.View style={{ opacity: searchHeaderFade }}>
          <View style={[s.searchHeaderRow, { paddingTop: headerTopPad + 12, paddingHorizontal: gutter }]}>
            <View
              style={[
                s.searchRow,
                s.searchRowInHeader,
                {
                  backgroundColor: theme.cardElevated,
                  borderColor: messagesSearchFocused ? theme.border : 'transparent',
                },
              ]}
            >
              <Feather name="search" size={16} color={theme.muted} />
              <TextInput
                ref={messagesSearchInputRef}
                style={[s.searchInput, { color: theme.text }, Platform.OS === 'web' && s.searchInputWebNoOutline]}
                value={messagesSearchQuery}
                onChangeText={setMessagesSearchQuery}
                placeholder="Search"
                placeholderTextColor={theme.muted}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
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
            <PressableScale
              style={s.searchCancelPressable}
              onPress={cancelMessagesSearch}
              rippleEnabled={NO_RIPPLE}
              accessibilityRole="button"
              accessibilityLabel="Cancel search"
              testID="inbox-search-cancel"
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
            >
              <Text style={[s.searchCancelText, { color: theme.text }]}>Cancel</Text>
            </PressableScale>
          </View>
        </Animated.View>
      ) : (
        <TabPageHeader
          title="Messages"
          gutter={gutter}
          actions={[
            { name: 'search', onPress: openMessagesSearch, accessibilityLabel: 'Search messages', testID: 'inbox-header-search' },
            { name: 'edit-3', onPress: openCompose, accessibilityLabel: 'New message', testID: 'inbox-header-compose' },
          ]}
        />
      )}

      {/* Stories tray — Instagram-DM-style: "Your story" first, then people
          the buyer follows who are LIVE or have an active (<24h) story.
          Always renders (even with nobody but "Your story") — see the
          storyTrayRows.length check below, which only ever hides the *rest*
          of the row, never the whole thing. */}
      {!loading && !messagesSearchLower && (
        <AnimatedEntrance distance={12}>
          <View style={s.storyTrayWrap}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={[s.activeRail, { marginVertical: -2 }]}
              contentContainerStyle={{ paddingHorizontal: gutter, gap: SP.md, paddingVertical: 2 }}
            >
              {/* "Your story" — always first. */}
              <PressableScale
                style={s.activeRailItem}
                onPress={openMyStorySlot}
                rippleEnabled={NO_RIPPLE}
                accessibilityRole="button"
                accessibilityLabel={myStoryId ? 'Your story' : 'Add to your story'}
                testID="inbox-my-story"
              >
                <View style={s.activeRailAvatar1}>
                  {myStoryId ? (
                    <View style={[s.storyRing, s.storyRingUnseen, { borderColor: theme.text }]} />
                  ) : null}
                  {myAvatarUri ? (
                    <Image source={{ uri: myAvatarUri }} style={s.activeRailAvatar} />
                  ) : (
                    <View style={[s.activeRailAvatar, { backgroundColor: theme.cardElevated }]}>
                      <Text style={[s.activeRailInitials, { color: theme.text }]}>{myInitials}</Text>
                    </View>
                  )}
                  {!myStoryId && (
                    <View style={[s.addStoryBadge, { backgroundColor: theme.accent, borderColor: theme.background }]} pointerEvents="none">
                      <Feather name="plus" size={12} color={theme.onAccent} />
                    </View>
                  )}
                </View>
                <Text style={[s.activeRailName, { color: theme.muted }]} numberOfLines={1}>Your story</Text>
              </PressableScale>

              {orderedStoryTray.map(row => {
                const live = isAuthorLive(row.authorId);
                if (live) {
                  // A single Pressable (LiveHostRing's own pressToWatch), not
                  // nested inside another one — tapping opens the live pager.
                  return (
                    <View key={row.authorId} style={s.activeRailItem}>
                      <LiveHostRing hostId={row.authorId} hostName={row.name} size={64} ringGap={-2} pressToWatch>
                        {row.avatarUri ? (
                          <Image source={{ uri: row.avatarUri }} style={s.activeRailAvatar} />
                        ) : (
                          <View style={[s.activeRailAvatar, { backgroundColor: row.color }]}>
                            <Text style={s.activeRailInitials}>{row.initials}</Text>
                          </View>
                        )}
                      </LiveHostRing>
                      <Text style={[s.activeRailName, { color: theme.muted }]} numberOfLines={1}>{railDisplayName(row.name)}</Text>
                    </View>
                  );
                }
                return (
                  <PressableScale
                    key={row.authorId}
                    style={s.activeRailItem}
                    onPress={() => openStoryViewerFor(row.authorId)}
                    rippleEnabled={NO_RIPPLE}
                    accessibilityRole="button"
                    accessibilityLabel={`${row.name}${row.seen ? '' : ', new story'}`}
                    testID={`inbox-story-tray-${row.authorId}`}
                  >
                    <View style={s.activeRailAvatar1}>
                      <View
                        style={[
                          s.storyRing,
                          row.seen ? s.storyRingSeen : s.storyRingUnseen,
                          { borderColor: row.seen ? theme.border : theme.text },
                        ]}
                      />
                      {row.avatarUri ? (
                        <Image source={{ uri: row.avatarUri }} style={s.activeRailAvatar} />
                      ) : (
                        <View style={[s.activeRailAvatar, { backgroundColor: row.color }]}>
                          <Text style={s.activeRailInitials}>{row.initials}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[s.activeRailName, { color: theme.muted }]} numberOfLines={1}>{railDisplayName(row.name)}</Text>
                  </PressableScale>
                );
              })}
            </ScrollView>
            {/* Right-edge fade softening the ScrollView's cut edge, so the
                row reads as "more to scroll" rather than a hard clip. */}
            <LinearGradient
              pointerEvents="none"
              colors={['transparent', SCREEN_BG]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={s.storyTrayFade}
            />
          </View>
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
            contentContainerStyle={StyleSheet.flatten([s.listContent, { paddingBottom: barInset + SP.lg, paddingHorizontal: gutter }])}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
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
                keyboardDismissMode="on-drag"
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

  // Instagram-DM-style stories tray (below search, above the tabs) — chrome
  // (sizes/spacing) unchanged from the old "active people" rail this
  // replaced; only what the circles represent and do is new.
  storyTrayWrap: { position: 'relative', marginBottom: SP.md },
  activeRail: {},
  activeRailItem: { width: 72, alignItems: 'center', gap: 6 },
  activeRailAvatar: {
    width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center',
  },
  // Wraps the 64x64 avatar so a story ring can be drawn on its own edge
  // (absolute, -2/+2 inset like LiveHostRing's ringGap={-2}) without ever
  // growing the 64x64 box the ScrollView lays rows out against.
  activeRailAvatar1: { width: 64, height: 64, position: 'relative' },
  storyRing: {
    position: 'absolute', left: -2, top: -2, right: -2, bottom: -2, borderRadius: 34,
  },
  storyRingUnseen: { borderWidth: 2 },
  storyRingSeen: { borderWidth: 1.5 },
  // "Add to your story" badge — pure visual decoration on top of the single
  // "Your story" Pressable, never its own tappable element.
  addStoryBadge: {
    position: 'absolute', right: -2, bottom: -2, width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, alignItems: 'center', justifyContent: 'center',
  },
  activeRailInitials: { fontSize: FS.md, fontFamily: FONT.bold, color: '#FFFFFF' },
  activeRailName: { fontSize: 11, fontFamily: FONT.medium, width: 72, textAlign: 'center' },
  storyTrayFade: {
    position: 'absolute', top: 0, bottom: 0, right: 0, width: 28,
  },

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

  // Requests-tab header: a small gray explainer line + a quiet "Delete all"
  // text action, right-aligned on its own line beneath — Instagram-style.
  requestsHeaderRow: {
    paddingTop: SP.sm,
    paddingBottom: SP.md,
    gap: SP.xs,
  },
  requestsHeaderText: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    lineHeight: 17,
  },
  requestsDeleteAllPressable: {
    alignSelf: 'flex-end',
  },
  requestsDeleteAll: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
  },

  // Conversation row — Threads style: no per-row hairline (rhythm from
  // spacing/height alone, not chrome), consistent height regardless of a
  // row's optional content (order pill, AI badge).
  convRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SP.sm,
    minHeight: 72,
  },
  // Fixed slot, every row: nothing (ring included) renders outside this
  // 56x56 box, so the row's left edge never shifts based on live state.
  avatarContainer: {
    width: 56,
    height: 56,
    position: 'relative',
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
  // Live rows' photo — see the avatarContainer comment above for why this
  // is 48 (not 56) inside the same 56x56 slot.
  avatar48: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: FS.md,
    fontFamily: FONT.bold,
    color: '#FFFFFF',
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
  // The header's search-open state: the field sits inline with Cancel
  // instead of stacked full-width below a title, so it drops searchRow's own
  // bottom margin and grows to fill the space Cancel doesn't need.
  searchHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingBottom: 20,
  },
  searchRowInHeader: {
    flex: 1,
    marginBottom: 0,
  },
  // Explicit height + centered content, matching searchRowInHeader's own
  // 44pt box, rather than leaning on the parent row's alignItems: 'center'
  // — a Text node's line-height/font-metric box doesn't always center the
  // same way a sibling View's cross-axis size does, which read as Cancel
  // sitting a few px above the field's true vertical center.
  searchCancelPressable: {
    height: 44,
    justifyContent: 'center',
  },
  searchCancelText: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
  },
  searchInput: {
    flex: 1,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    height: 40,
  },
  // The web <input> underneath RNW's TextInput otherwise keeps the browser's
  // own default focus ring (a thick amber/orange outline) on top of our
  // themed border — suppressed here the same way buyer-search.tsx does for
  // its own web text fields.
  searchInputWebNoOutline: { outlineStyle: 'none', outlineWidth: 0 } as any,
  // minWidth: 0 is required for a flex:1 row to actually truncate its text
  // instead of growing past its share and pushing convTrailing off-row —
  // React Native (like web flexbox) defaults a flex item's min-width to its
  // content size, not 0.
  convCenter: {
    flex: 1,
    minWidth: 0,
    marginLeft: SP.md,
  },
  convNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
  },
  convName: {
    flex: 1,
    fontSize: FS.base,
  },
  convTime: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    marginLeft: SP.xs,
  },
  // Trailing column: time above, unread dot below, right-aligned to the
  // row's own right edge — replaces time living inline in convNameRow.
  convTrailing: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
    marginLeft: SP.sm,
  },
  convPreview: {
    fontSize: 14,
    fontFamily: FONT.regular,
  },
  // Threads-style unread marker: one small dot at the row's right edge,
  // replacing the old numeric badge/chevron.
  unreadDotTrailing: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: SP.sm,
  },

  // Empty state
  // Opaque, matching every row's own `theme.background` fill (see convRow's
  // PressableScale) — was `transparent`, which on FlashList's web renderer
  // let a 1px cell-measurement rounding gap between rows show whatever sits
  // behind the whole screen stack instead of the row color, reading as a
  // faint gray hairline "divider" the app never actually draws.
  listSurface: { flex: 1, backgroundColor: theme.background },
  listContent: { paddingBottom: 112 },
  listEmptyContainer: {
    flex: 1,
  },
  });
}
