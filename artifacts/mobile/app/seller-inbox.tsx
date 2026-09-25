/**
 * Seller Inbox — list of buyer conversations for the seller.
 * Reads GET /api/conversations (auth = current Clerk seller user).
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, RefreshControl } from 'react-native';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useUser } from '@clerk/expo';
import { FONT, FS, SP } from '@/lib/theme';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { PressableScale } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ListSkeleton } from '@/components/layout';
import { ErrorState } from '@/components/ui/ErrorState';
import { hapticPrimaryAction } from '@/lib/haptics';
import { useApi } from '@/lib/api';
import { requestContextualPushPermission } from '@/lib/contextualPushPermission';
import { subscribeConversationReadFailure } from '@/lib/conversationReadEvents';

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
  const { user, isLoaded: clerkLoaded = true } = useUser();
  const myId = user?.id ?? '';

  const [convs, setConvs] = useState<ConvView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
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
    setIsLoading(!clerkLoaded);
  }, [clerkLoaded, myId]);

  const load = useCallback(async (generation: number, silent = false) => {
    if (!clerkLoaded || !myId) return;
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
      setLoadError(true);
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
  }, [api, clerkLoaded, myId]);

  useEffect(() => subscribeConversationReadFailure((conversationId) => {
    // A failed mark-as-read must not leave the inbox suppressing the server's
    // unread count indefinitely. Refetch so returning to this screen reflects
    // the authoritative participant count.
    if (!optimisticReadsRef.current.delete(conversationId)) return;
    void load(generationRef.current, true);
  }), [load, clerkLoaded, myId]);

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
  }, [load, clerkLoaded, myId]));

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

  function renderItem({ item }: ListRenderItemInfo<ConvView>) {
    const other = otherParticipant(item);
    if (!other) return null;
    const hasUnread = item.unreadCount > 0;
    return (
      <PressableScale
        testID={`seller-conversation-${item.id}`}
        style={s.row}
        activeOpacity={0.7}
        onPress={() => openConversation(item.id)}
        accessibilityRole="button"
        accessibilityLabel={`Open conversation with ${other.name || other.handle || 'buyer'}`}
      >
        <View style={[s.avatar, { backgroundColor: other.color || theme.accent }]}>
          <Text style={s.avatarInitials}>{other.initials || (other.name?.[0] ?? '?').toUpperCase()}</Text>
        </View>
        <View style={s.rowCenter}>
          <View style={s.rowTop}>
            <Text style={[s.name, hasUnread && { fontFamily: FONT.bold }]} numberOfLines={1}>
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
              style={[s.preview, hasUnread && { color: theme.text, fontFamily: FONT.medium }]}
              numberOfLines={1}
            >
              {previewText(item.lastMessage)}
            </Text>
            {hasUnread && (
              <View testID={`seller-unread-badge-${item.id}`} style={s.unreadBadge}>
                <Text style={s.unreadText}>{item.unreadCount > 9 ? '9+' : item.unreadCount}</Text>
              </View>
            )}
          </View>
        </View>
      </PressableScale>
    );
  }

  const totalUnread = convs.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  return (
    <View style={s.root}>
      <ScreenHeader
        title="Messages"
        subtitle={totalUnread > 0 ? `${totalUnread} unread` : undefined}
      />

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
          <Feather name="message-circle" size={40} color={theme.subtle} />
          <Text style={s.emptyTitle}>No messages yet</Text>
          <Text style={s.emptyBody}>
            When buyers message you about products or orders, their conversations will appear here.
          </Text>
        </View>
      ) : (
        <FlashList
          data={convs}
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
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl },
  emptyTitle: { fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text, marginTop: SP.md },
  emptyBody: {
    fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted,
    textAlign: 'center', marginTop: SP.xs,
  },

  // Row — flat Instagram-style, no card chrome
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SP.md, paddingVertical: SP.sm + 2,
  },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center', marginRight: SP.sm,
  },
  avatarInitials: { fontSize: FS.sm, fontFamily: FONT.bold, color: theme.onAccent },
  rowCenter: { flex: 1 },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  name: { flex: 1, fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text },
  time: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, marginLeft: SP.sm },
  context: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.accent, marginTop: 1 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  preview: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted },
  unreadBadge: {
    minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5,
    backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center', marginLeft: SP.sm,
  },
  unreadText: { fontSize: 11, fontFamily: FONT.bold, color: theme.onAccent },
  });
};
