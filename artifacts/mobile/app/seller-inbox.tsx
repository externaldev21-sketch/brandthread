/**
 * Seller Inbox — list of buyer conversations for the seller.
 * Reads GET /api/conversations (auth = current Clerk seller user).
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, RefreshControl, Alert, Image } from 'react-native';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { FONT, FS, SP } from '@/lib/theme';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { PressableScale, SearchBar, useUndoToast } from '@/components/BrandthreadUI';
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
import { CommunityInboxRow } from '@/components/community-inbox/CommunityInboxRow';
import { openInboxComposeMenu } from '@/components/community-inbox/InboxComposeMenu';
import { mergeInboxRows, communityMatchesQuery, type InboxMergedRow } from '@/lib/communities/inboxModel';
import { useInboxCommunities } from '@/lib/communities/useCommunityInbox';
import {
  scheduleDeleteSellerConversationRequest, undoDeleteSellerConversationRequest, blockSellerConversationRequestUser,
} from '@/lib/sellerRequestActions';
import { subscribePendingConversationDeletes, DELETE_GRACE_MS } from '@/lib/pendingRequestDeletes';
import { confirmDestructiveActionSheet } from '@/lib/actionSheet';
import { BLOCK_EXPLAINER } from '@/lib/safety';
import { FirstRunTip } from '@/components/first-run-tips/FirstRunTip';
import { SELLER_INBOX_GESTURE } from '@/lib/firstRunTips/content';
import { radius } from '@/constants/radii';

interface Participant {
  userId: string; name: string; handle: string;
  initials: string; color: string; accountType: string;
  avatarUri?: string;
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
  // New every-role-pair DM/message-request routing: a buyer with no
  // follow-back and no real paid order now lands in the seller's Requests
  // tab too, same isRequest/requestedBy shape buyer<->buyer already used —
  // see app/(buyer)/inbox.tsx's identical fields and
  // artifacts/api-server/src/routes/conversations.ts's buildConversationView.
  isRequest?: boolean;
  requestedBy?: string;
}

type InboxTab = 'inbox' | 'requests';

// ─── Inbox / Requests pill row ─────────────────────────────────────────────
// Same Inbox/Requests pattern as app/(buyer)/inbox.tsx's InboxPillRow
// (pills with a live unread-count badge on Requests), restyled to this
// screen's own theming (AppThemePreset, not the buyer screen's useAppTheme
// return shape) rather than pasted verbatim — no filter icon here, this
// screen has no equivalent affordance.
function InboxPillRow({
  value, onChange, requestsCount, theme,
}: {
  value: InboxTab;
  onChange: (tab: InboxTab) => void;
  requestsCount: number;
  theme: AppThemePreset;
}) {
  const pills: { key: InboxTab; label: string; count?: number }[] = [
    { key: 'inbox', label: 'Inbox' },
    { key: 'requests', label: 'Requests', count: requestsCount },
  ];
  return (
    <View style={[pillS.row, { paddingHorizontal: SP.md }]}>
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
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            testID={`seller-inbox-tab-${pill.key}`}
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
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 36, paddingHorizontal: SP.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth,
  },
  pillLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, letterSpacing: 0.1 },
  pillCount: { minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  pillCountText: { fontSize: 11, fontFamily: FONT.bold },
});

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
  const { showUndo } = useUndoToast();

  const [activeTab, setActiveTab] = useState<InboxTab>('inbox');
  // Requests deleted (or "Delete all"-ed) in this session sit in a ~4s undo
  // window (lib/pendingRequestDeletes.ts) before the real delete actually
  // fires — see app/(buyer)/inbox.tsx's identical pendingDeleteIds state for
  // why this is tracked here (force a re-render + filter) rather than read
  // directly off the module, which is the real source of truth.
  const [pendingDeleteIds, setPendingDeleteIds] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => subscribePendingConversationDeletes(setPendingDeleteIds), []);

  // Joined community group chats sit beside buyer DMs, merged by recency.
  const { communities: joinedCommunities, toggleMute: toggleCommunityMute } = useInboxCommunities();
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

  // Requests-tab row tap — deliberately does NOT optimistically clear
  // unreadCount/mark read (unlike openConversation above): per the
  // Instagram-style request flow (app/(buyer)/inbox.tsx's identical
  // openRequestConversation), the buyer who sent a pending request shouldn't
  // see a read receipt until the seller actually accepts it.
  function openRequestConversation(conversationId: string) {
    hapticPrimaryAction();
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

  function renderRow({ item: row }: ListRenderItemInfo<InboxMergedRow<ConvView>>) {
    if (row.kind === 'community') {
      return (
        <CommunityInboxRow
          community={row.community}
          horizontalPad={SP.md}
          minHeight={88}
          onPress={() => {
            hapticPrimaryAction();
            router.push(('/community-chat?id=' + encodeURIComponent(row.community.id)) as never);
          }}
          onToggleMute={() => toggleCommunityMute(row.community)}
        />
      );
    }
    return renderItem({ item: row.dm } as ListRenderItemInfo<ConvView>);
  }

  // ── Requests-tab actions (Block / Delete) ───────────────────────────────
  // Same shape as app/(buyer)/inbox.tsx's identical handlers, through
  // lib/sellerRequestActions.ts's preview-aware wrappers instead of
  // lib/requestActions.ts's buyer ones. Accept lives only in
  // app/seller-conversation.tsx's request-mode panel — not on this list, per
  // the same Instagram-reference design the buyer Requests tab already uses
  // (a row tap opens the thread; Block/Delete are the only per-row actions).
  function deleteRequestConversation(c: ConvView) {
    const other = otherParticipant(c);
    hapticDestructiveConfirm();
    scheduleDeleteSellerConversationRequest(c.id, api, () => {
      setConvs((current) => current.filter((row) => row.id !== c.id));
    });
    showUndo({
      message: `Deleted request from ${other?.name ?? 'this buyer'}`,
      undo: () => undoDeleteSellerConversationRequest(c.id),
      durationMs: DELETE_GRACE_MS,
    });
  }

  function deleteAllRequests() {
    if (requestConvs.length === 0) return;
    hapticDestructiveConfirm();
    const ids = requestConvs.map((c) => c.id);
    ids.forEach((id) => scheduleDeleteSellerConversationRequest(id, api, () => {
      setConvs((current) => current.filter((row) => row.id !== id));
    }));
    showUndo({
      message: ids.length === 1 ? 'Deleted 1 request' : `Deleted ${ids.length} requests`,
      undo: () => ids.forEach((id) => undoDeleteSellerConversationRequest(id)),
      durationMs: DELETE_GRACE_MS,
    });
  }

  async function blockRequestConversation(c: ConvView) {
    const other = otherParticipant(c);
    if (!other) return;
    const confirmed = await confirmDestructiveActionSheet({
      title: `Block ${other.name}?`,
      message: BLOCK_EXPLAINER,
      confirmLabel: 'Block',
    });
    if (!confirmed) return;
    hapticDestructiveConfirm();
    try {
      await blockSellerConversationRequestUser(c.id, other);
      setConvs((current) => current.filter((row) => row.id !== c.id));
    } catch {
      Alert.alert('Couldn’t block', 'Please try again.');
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

  // Requests-tab row — same row visuals/interactions as an ordinary Inbox
  // row above (renderItem), just filtered to isRequest and with Block/Delete
  // as its only swipe actions (Accept lives in the conversation screen's own
  // request panel, matching app/(buyer)/inbox.tsx's identical row).
  function renderRequestRow({ item }: ListRenderItemInfo<ConvView>) {
    const other = otherParticipant(item);
    if (!other) return null;
    const hasUnread = item.unreadCount > 0;

    const swipeActions: InboxSwipeAction[] = [
      {
        key: 'block',
        label: 'Block',
        icon: 'slash',
        color: theme.cardElevated,
        textColor: theme.error,
        onPress: () => blockRequestConversation(item),
        accessibilityLabel: `Block ${other.name || other.handle || 'this buyer'}`,
      },
      {
        key: 'delete',
        label: 'Delete',
        icon: 'trash-2',
        color: theme.cardElevated,
        textColor: theme.error,
        onPress: () => deleteRequestConversation(item),
        accessibilityLabel: `Delete request from ${other.name || other.handle || 'this buyer'}`,
      },
    ];

    return (
      <InboxSwipeRow rowId={item.id} actions={swipeActions}>
        <PressableScale
          testID={`seller-inbox-request-${item.id}`}
          style={[s.row, { backgroundColor: theme.background }]}
          activeOpacity={0.7}
          onPress={() => openRequestConversation(item.id)}
          accessibilityRole="button"
          accessibilityLabel={`Open message request from ${other.name || other.handle || 'this buyer'}`}
        >
          <View style={[s.avatar, { backgroundColor: other.color || theme.accent }]}>
            {other.avatarUri ? (
              <Image source={{ uri: other.avatarUri }} style={s.avatarImage} />
            ) : (
              <Text style={s.avatarInitials}>{other.initials || (other.name?.[0] ?? '?').toUpperCase()}</Text>
            )}
          </View>
          <View style={s.rowCenter}>
            <View style={s.rowTop}>
              <Text style={[s.name, { fontFamily: hasUnread ? FONT.bold : FONT.regular }]} numberOfLines={1}>
                {other.name || other.handle || 'Buyer'}
              </Text>
              <Text style={s.time}>{timeAgo(item.lastMessageTs)}</Text>
            </View>
            <View style={s.rowBottom}>
              <Text
                style={[s.preview, hasUnread && { color: theme.text, fontFamily: FONT.bold }]}
                numberOfLines={1}
              >
                {previewText(item.lastMessage)}
              </Text>
              {hasUnread && (
                <View testID={`seller-inbox-request-unread-${item.id}`} style={[s.unreadDot, { backgroundColor: theme.accent }]} />
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
      if (c.isArchived || c.isRequest || pendingDeleteIds.has(c.id)) return false;
      if (!queryLower) return true;
      const other = otherParticipant(c);
      const haystack = [other?.name, other?.handle, c.lastMessage, c.contextOrderNumber, c.contextProductName]
        .filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(queryLower);
    })
    .sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0)),
  [convs, queryLower, pendingDeleteIds]);

  const requestConvs = useMemo(() => convs.filter((c) =>
    c.isRequest === true && !c.isArchived && !pendingDeleteIds.has(c.id)
  ), [convs, pendingDeleteIds]);

  // Header subtitle reflects the Inbox tab's own unread total now that
  // Requests has its own badge on the pill row below — a pending request's
  // unreadCount would otherwise double up in both places.
  const totalUnread = visibleConvs.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  const inboxRows = useMemo(() => mergeInboxRows(
    visibleConvs,
    joinedCommunities.filter((c) => communityMatchesQuery(c, queryLower)),
    { getKey: (c) => c.id, getTs: (c) => c.lastMessageTs, isPinned: (c) => !!c.isPinned },
  ), [visibleConvs, joinedCommunities, queryLower]);

  return (
    <View style={s.root}>
      <ScreenHeader
        title="Messages"
        actions={[
          {
            icon: 'search',
            onPress: () => setSearchOpen((open) => !open),
            accessibilityLabel: searchOpen ? 'Close search' : 'Search messages',
          },
          {
            icon: 'plus',
            onPress: () => openInboxComposeMenu(router, undefined, true),
            accessibilityLabel: 'Create or join a group',
          },
        ]}
      />

      {searchOpen && (
        <View style={s.searchWrap}>
          <SearchBar value={query} onChange={setQuery} placeholder="Search messages…" />
        </View>
      )}

      {!isLoading && (
        <InboxPillRow value={activeTab} onChange={setActiveTab} requestsCount={requestConvs.length} theme={theme} />
      )}

      {isLoading ? (
        <View style={[s.listPad, { paddingTop: SP.md }]}>
          <ListSkeleton rows={6} />
        </View>
      ) : activeTab === 'requests' ? (
        requestConvs.length === 0 ? (
          <View style={s.centerFill}>
            <EmptyState
              icon="mail"
              title="No message requests"
              // Every role pair can land here now, not just buyers you don't
              // follow — a buyer with no real paid order can also message you
              // first, per the new DM routing rules.
              message="Requests from buyers who don't follow you, or haven't ordered from you, appear here."
            />
          </View>
        ) : (
          <FlashList
            data={requestConvs}
            keyExtractor={(c) => c.id}
            renderItem={renderRequestRow}
            refreshControl={
              <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={theme.accent} />
            }
            contentContainerStyle={{ paddingBottom: insets.bottom + SP.lg, paddingTop: SP.xs }}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <View style={s.requestsHeaderRow}>
                <Text style={s.requestsHeaderText}>
                  Open a chat to get info about who's messaging you. They won't know you've seen it until you accept.
                </Text>
                <PressableScale
                  onPress={deleteAllRequests}
                  accessibilityRole="button"
                  accessibilityLabel="Delete all requests"
                  testID="seller-inbox-requests-delete-all"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={s.requestsDeleteAll}>Delete all</Text>
                </PressableScale>
              </View>
            }
          />
        )
      ) : loadError && convs.length === 0 ? (
        <View style={s.centerFill}>
          <ErrorState
            message="Couldn't load messages. Pull to refresh."
            onRetry={onRefresh}
          />
        </View>
      ) : convs.length === 0 && joinedCommunities.length === 0 ? (
        <View style={s.centerFill}>
          <EmptyState
            icon="message-circle"
            title="No messages yet"
            message="When buyers message you about products or orders, their conversations will appear here."
          />
        </View>
      ) : inboxRows.length === 0 ? (
        <View style={s.centerFill}>
          <EmptyState
            icon="search"
            title="No matches"
            message="Try a different name, handle, or order number."
          />
        </View>
      ) : (
        <FlashList
          data={inboxRows}
          keyExtractor={(row) => row.key}
          renderItem={renderRow}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={theme.accent} />
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + SP.lg }}
          showsVerticalScrollIndicator={false}
        />
      )}
      <FirstRunTip
        id="seller-inbox"
        variant="gesture"
        contentReady={!isLoading}
        gesture={SELLER_INBOX_GESTURE}
      />
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
    overflow: 'hidden',
  },
  avatarImage: { width: 56, height: 56 },
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

  // Requests tab — explainer line + "Delete all", above the request rows.
  requestsHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, paddingBottom: SP.sm, gap: SP.sm,
  },
  requestsHeaderText: { flex: 1, fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, lineHeight: 16 },
  requestsDeleteAll: { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.muted },
  });
};
