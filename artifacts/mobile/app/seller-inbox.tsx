/**
 * Seller Inbox — list of buyer conversations for the seller.
 * Reads GET /api/conversations (auth = current Clerk seller user).
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, RefreshControl, Alert } from 'react-native';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { FONT, FS, SP } from '@/lib/theme';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { PressableScale, SearchBar } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState, ListSkeleton } from '@/components/layout';
import { ErrorState } from '@/components/ui/ErrorState';
import { showActionSheet } from '@/components/ui/ActionSheet';
import { hapticPrimaryAction, hapticDestructiveConfirm } from '@/lib/haptics';
import { useApi } from '@/lib/api';
import { requestContextualPushPermission } from '@/lib/contextualPushPermission';
import { subscribeConversationReadFailure } from '@/lib/conversationReadEvents';
import { markConversationRead, archiveConversation, muteUser, setConversationPinned } from '@/services/socialService';
import InboxSwipeRow, { type InboxSwipeAction } from '@/components/inbox/InboxSwipeRow';
import {
  isPreviewInboxEnabled, getSellerPreviewConversations,
  isSellerPreviewConversationId, setPreviewConversationPinned,
} from '@/lib/previewInbox';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';

interface Participant {
  userId: string; name: string; handle: string;
  initials: string; color: string; accountType: string;
}
interface ConvView {
  id: string; type: string;
  participants: Participant[];
  lastMessage?: string; lastMessageTs?: number;
  unreadCount: number;
  contextOrderNumber?: string; contextProductName?: string;
  updatedAt: string;
  isPinned?: boolean;
  isArchived?: boolean;
}

function timeAgo(ts?: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function previewText(lastMessage?: string): string {
  return lastMessage?.trim() || 'No messages yet';
}

export default function SellerInboxScreen() {
  const { theme } = useAppTheme();
  const s = React.useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  // useAuth().userId (not useUser()'s isLoaded) — matches
  // app/(buyer)/inbox.tsx's identical guard. useUser()'s `isLoaded` can stay
  // false well after `userId` itself has already resolved (e.g. whenever
  // Clerk's own script/environment fetch is slow or unreachable, which is
  // exactly the situation on the dev-web preview this bypass exists for);
  // gating on it left the seller inbox stuck on its loading skeleton
  // forever instead of ever reaching the `!myId` preview branch below.
  const { userId } = useAuth();
  const myId = userId ?? '';

  const [convs, setConvs] = useState<ConvView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const consecutiveFailuresRef = useRef(0);
  const generationRef = useRef(0);
  const requestGenerationRef = useRef<number | null>(null);
  // A list response can have been queued before the conversation screen's
  // mark-as-read request completes. Keep those older unread counts suppressed
  // until a response contains a message newer than the one we opened.
  const optimisticReadsRef = useRef(new Map<string, number>());

  useEffect(() => {
    // Do not let a previous Clerk identity remain visible while auth changes.
    generationRef.current += 1;
    requestGenerationRef.current = null;
    optimisticReadsRef.current.clear();
    setConvs([]);
    setLoadError(false);
    setIsLoading(true);
  }, [myId]);

  const load = useCallback(async (generation: number, silent = false) => {
    // isSellerDevPreview() (not just !myId): a stubbed/fake-signed-in Clerk
    // session (e.g. this app's own audit/e2e harnesses, which fake a signed
    // -in user so protected screens render at all) still reports a truthy
    // myId, which used to fall through to the real api.conversations.list()
    // call below and 404 against a harness with no backend — a real,
    // avoidable console error, not a genuine failure. bt_preview is read
    // straight off the URL/persisted role (lib/devPreview.ts), independent
    // of Clerk's auth state, so it still routes to the branch below however
    // Clerk is stubbed.
    if (!myId || isSellerDevPreview()) {
      // The dev-web ?bt_preview=seller bypass never signs in through Clerk
      // (see lib/devPreview.ts), so `myId` is empty here in that mode —
      // without this branch the seller inbox had nothing to show at all in
      // preview (see app/(buyer)/inbox.tsx's identical buyer-side guard,
      // which this mirrors). Real accounts always have a myId and never hit
      // this branch.
      // The seeded seller inbox is a populated DEMO dataset — never the
      // default. Fresh preview (the default) shows the honest, genuinely
      // empty "0 conversations" state; only the explicit ?bt_preview=
      // seller&demo=1 opt-in renders it (isPreviewDemoMode(), lib/devPreview.ts).
      if (isPreviewInboxEnabled() && isPreviewDemoMode()) {
        setConvs(getSellerPreviewConversations() as unknown as ConvView[]);
        setLoadError(false);
      } else {
        setConvs([]);
        setLoadError(false);
      }
      setIsLoading(false);
      return;
    }
    // Keep one request in flight per focus cycle so a slow request cannot
    // overlap a later poll and corrupt the consecutive-failure count.
    if (requestGenerationRef.current === generation) return;
    requestGenerationRef.current = generation;
    try {
      const list = await api.conversations.list();
      if (generationRef.current !== generation) return;
      // Sellers only handle buyer↔seller threads
      const relevant = (list as ConvView[])
        .filter(
        (c) => c.type !== 'buyer_to_buyer',
        )
        .map((conversation) => {
          const openedMessageTs = optimisticReadsRef.current.get(conversation.id);
          if (openedMessageTs === undefined) return conversation;

          if (
            conversation.lastMessageTs !== undefined
            && conversation.lastMessageTs > openedMessageTs
          ) {
            optimisticReadsRef.current.delete(conversation.id);
            return conversation;
          }

          return conversation.unreadCount > 0
            ? { ...conversation, unreadCount: 0 }
            : conversation;
        });
      setConvs(relevant);
      // Only a buyer-originated unread thread is an inbound buyer message.
      // This list is server-backed, not the manufacturer/demo conversation data.
      if (relevant.some((c) =>
        c.unreadCount > 0 && c.participants.some((p) => p.userId !== myId && p.accountType === 'buyer'),
      )) {
        void requestContextualPushPermission(myId, api);
      }
      setLoadError(false);
      consecutiveFailuresRef.current = 0;
    } catch (e) {
      if (generationRef.current !== generation) return;
      // Dev/preview only, and only when the real API genuinely can't be
      // reached (e.g. a real Clerk session is active — bt_preview=seller
      // doesn't require signing out — but the backend the web preview talks
      // to 401s or is unreachable) — never for a real signed-in account,
      // and dead code in production. Mirrors app/(buyer)/inbox.tsx's
      // identical catch-block fallback, which this previously lacked: on
      // web preview this branch left the seller inbox stuck on its loading
      // skeleton forever instead of showing the seeded preview data.
      if (isPreviewInboxEnabled()) {
        setConvs(getSellerPreviewConversations() as unknown as ConvView[]);
        setLoadError(false);
      } else {
        setLoadError(true);
      }
      consecutiveFailuresRef.current += 1;
      if (consecutiveFailuresRef.current >= 3 && pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    } finally {
      if (generationRef.current === generation) setIsLoading(false);
      if (requestGenerationRef.current === generation) {
        requestGenerationRef.current = null;
      }
    }
  }, [api, myId]);

  useEffect(() => subscribeConversationReadFailure((conversationId) => {
    // A failed mark-as-read must not leave the inbox suppressing the server's
    // unread count indefinitely. Refetch so returning to this screen reflects
    // the authoritative participant count.
    if (!optimisticReadsRef.current.delete(conversationId)) return;
    void load(generationRef.current, true);
  }), [load, myId]);

  useFocusEffect(useCallback(() => {
    const generation = ++generationRef.current;
    consecutiveFailuresRef.current = 0;
    load(generation);
    pollRef.current = setInterval(() => load(generation, true), 30_000);
    return () => {
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [load, myId]));

  async function onRefresh() {
    setIsRefreshing(true);
    consecutiveFailuresRef.current = 0;
    await load(generationRef.current, true);
    setIsRefreshing(false);
  }

  function otherParticipant(c: ConvView): Participant | null {
    return c.participants.find((p) => p.userId !== myId) ?? c.participants[0] ?? null;
  }

  function openConversation(conversationId: string) {
    hapticPrimaryAction();
    // Keep the inbox truthful while the conversation screen completes its
    // server-side mark-as-read request and avoid an inflated header total.
    const openedConversation = convs.find((conversation) => conversation.id === conversationId);
    if ((openedConversation?.unreadCount ?? 0) > 0) {
      optimisticReadsRef.current.set(
        conversationId,
        openedConversation?.lastMessageTs ?? Date.now(),
      );
    }
    setConvs((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, unreadCount: 0 }
          : conversation,
      ),
    );
    router.push(('/seller-conversation?id=' + encodeURIComponent(conversationId)) as never);
  }

  function longPressConversation(c: ConvView) {
    hapticDestructiveConfirm();
    showActionSheet('Options', undefined, [
      { text: 'Archive', onPress: () => swipeArchiveConversation(c), style: 'destructive' },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  // Swipe actions mirror app/(buyer)/inbox.tsx's InboxSwipeRow set (mark
  // read, pin, mute, delete/archive) — same shared component, same
  // services/socialService.ts mutations, so a seeded preview conversation
  // (no real backend record) is handled the same way there too: update
  // local state only, never a network call.
  async function swipeMarkReadConversation(c: ConvView) {
    if (c.unreadCount <= 0) return;
    setConvs((current) => current.map((row) => (row.id === c.id ? { ...row, unreadCount: 0 } : row)));
    if (isSellerPreviewConversationId(c.id)) return;
    try {
      await markConversationRead(c.id);
    } catch {
      Alert.alert('Couldn’t mark as read', 'Please try again.');
    }
  }

  async function swipePinConversation(c: ConvView) {
    const nextPinned = !c.isPinned;
    setConvs((current) => current.map((row) => (row.id === c.id ? { ...row, isPinned: nextPinned } : row)));
    try {
      if (isSellerPreviewConversationId(c.id)) {
        setPreviewConversationPinned(c.id, nextPinned);
      } else {
        await setConversationPinned(c.id, nextPinned);
      }
    } catch {
      setConvs((current) => current.map((row) => (row.id === c.id ? { ...row, isPinned: c.isPinned } : row)));
      Alert.alert(nextPinned ? 'Couldn’t pin' : 'Couldn’t unpin', 'Please try again.');
    }
  }

  async function swipeMuteConversation(c: ConvView) {
    const other = otherParticipant(c);
    if (!other) return;
    try {
      await muteUser({
        userId: other.userId, name: other.name, handle: other.handle,
        initials: other.initials, color: other.color,
      });
    } catch {
      Alert.alert('Couldn’t mute', 'Please try again.');
    }
  }

  async function swipeArchiveConversation(c: ConvView) {
    setConvs((current) => current.map((row) => (row.id === c.id ? { ...row, isArchived: true } : row)));
    if (isSellerPreviewConversationId(c.id)) return;
    try {
      await archiveConversation(c.id);
    } catch {
      setConvs((current) => current.map((row) => (row.id === c.id ? { ...row, isArchived: false } : row)));
      Alert.alert('Couldn’t archive', 'Please try again.');
    }
  }

  function renderItem({ item }: ListRenderItemInfo<ConvView>) {
    const other = otherParticipant(item);
    if (!other) return null;
    const hasUnread = item.unreadCount > 0;

    const swipeActions: InboxSwipeAction[] = [
      {
        key: 'read',
        label: 'Read',
        icon: 'check-circle',
        color: theme.accentDim,
        textColor: theme.accentLight,
        onPress: () => swipeMarkReadConversation(item),
        accessibilityLabel: `Mark conversation with ${other.name || other.handle || 'buyer'} as read`,
      },
      {
        key: 'pin',
        label: item.isPinned ? 'Unpin' : 'Pin',
        icon: 'bookmark',
        color: theme.cardElevated,
        textColor: theme.muted,
        onPress: () => swipePinConversation(item),
        accessibilityLabel: item.isPinned
          ? `Unpin conversation with ${other.name || other.handle || 'buyer'}`
          : `Pin conversation with ${other.name || other.handle || 'buyer'}`,
      },
      {
        key: 'mute',
        label: 'Mute',
        icon: 'bell-off',
        color: theme.cardElevated,
        textColor: theme.muted,
        onPress: () => swipeMuteConversation(item),
        accessibilityLabel: `Mute ${other.name || other.handle || 'buyer'}`,
      },
      {
        key: 'delete',
        label: 'Delete',
        icon: 'trash-2',
        color: theme.cardElevated,
        textColor: theme.error,
        onPress: () => swipeArchiveConversation(item),
        accessibilityLabel: `Delete conversation with ${other.name || other.handle || 'buyer'}`,
      },
    ];

    return (
      <InboxSwipeRow rowId={item.id} actions={swipeActions}>
        <PressableScale
          testID={`seller-conversation-${item.id}`}
          style={[s.row, { backgroundColor: theme.background }]}
          activeOpacity={0.7}
          onPress={() => openConversation(item.id)}
          onLongPress={() => longPressConversation(item)}
          accessibilityRole="button"
          accessibilityLabel={`Open conversation with ${other.name || other.handle || 'buyer'}`}
        >
          <View style={[s.avatar, { backgroundColor: other.color || theme.accent }]}>
            <Text style={s.avatarInitials}>{other.initials || (other.name?.[0] ?? '?').toUpperCase()}</Text>
          </View>
          <View style={s.rowCenter}>
            <View style={s.rowTop}>
              <Text style={[s.name, { fontFamily: hasUnread ? FONT.bold : FONT.regular }]} numberOfLines={1}>
                {other.name || other.handle || 'Buyer'}
              </Text>
              <Text style={s.time}>{timeAgo(item.lastMessageTs)}</Text>
            </View>
            {item.contextOrderNumber ? (
              <Text style={s.context} numberOfLines={1}>
                Order {item.contextOrderNumber}{item.contextProductName ? ` · ${item.contextProductName}` : ''}
              </Text>
            ) : null}
            <View style={s.rowBottom}>
              <Text
                style={[s.preview, hasUnread && { color: theme.text, fontFamily: FONT.bold }]}
                numberOfLines={1}
              >
                {previewText(item.lastMessage)}
              </Text>
              {hasUnread && (
                <View testID={`seller-unread-badge-${item.id}`} style={[s.unreadDot, { backgroundColor: theme.accent }]} />
              )}
            </View>
          </View>
        </PressableScale>
      </InboxSwipeRow>
    );
  }

  const queryLower = query.trim().toLowerCase();
  const visibleConvs = useMemo(() => convs
    .filter((c) => {
      if (c.isArchived) return false;
      if (!queryLower) return true;
      const other = otherParticipant(c);
      const haystack = [other?.name, other?.handle, c.lastMessage, c.contextOrderNumber, c.contextProductName]
        .filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(queryLower);
    })
    .sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0)),
  [convs, queryLower]);

  return (
    <View style={s.root}>
      <ScreenHeader
        title="Messages"
        actions={[{
          icon: 'search',
          onPress: () => setSearchOpen((open) => !open),
          accessibilityLabel: searchOpen ? 'Close search' : 'Search messages',
        }]}
      />

      {searchOpen && (
        <View style={s.searchWrap}>
          <SearchBar value={query} onChange={setQuery} placeholder="Search messages…" />
        </View>
      )}

      {isLoading ? (
        <View style={[s.listPad, { paddingTop: SP.md }]}>
          <ListSkeleton rows={6} />
        </View>
      ) : loadError && convs.length === 0 ? (
        <View style={s.centerFill}>
          <ErrorState
            message="Couldn't load messages. Pull to refresh."
            onRetry={onRefresh}
          />
        </View>
      ) : convs.length === 0 ? (
        <View style={s.centerFill}>
          <EmptyState
            icon="message-circle"
            title="No messages yet"
            message="When buyers message you about products or orders, their conversations will appear here."
          />
        </View>
      ) : visibleConvs.length === 0 ? (
        <View style={s.centerFill}>
          <EmptyState
            icon="search"
            title="No matches"
            message="Try a different name, handle, or order number."
          />
        </View>
      ) : (
        <FlashList
          data={visibleConvs}
          keyExtractor={(c) => c.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={theme.accent} />
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + SP.lg }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const createStyles = (theme: AppThemePreset) => {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  listPad: { paddingHorizontal: SP.md },
  searchWrap: { paddingHorizontal: SP.md, paddingBottom: SP.sm },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl },

  // Row — flat, roomy list row (Bumble-style spacing, no card chrome)
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SP.md, paddingVertical: SP.md,
    minHeight: 88,
  },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center', marginRight: SP.md,
  },
  avatarInitials: { fontSize: FS.sm, fontFamily: FONT.bold, color: theme.onAccent },
  rowCenter: { flex: 1 },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  name: { flex: 1, fontSize: FS.base, fontFamily: FONT.regular, color: theme.text },
  time: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, marginLeft: SP.sm },
  context: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.accent, marginTop: 1 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  preview: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted },
  // Threads/buyer-inbox-style trailing dot (matches
  // app/(buyer)/inbox.tsx's unreadDotTrailing) — was previously a numeric
  // count badge, a different visual convention from the buyer side's dot.
  unreadDot: {
    width: 8, height: 8, borderRadius: 4, marginLeft: SP.sm,
  },
  });
};
