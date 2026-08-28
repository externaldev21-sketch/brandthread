/**
 * Seller Inbox — list of buyer conversations for the seller.
 * Reads GET /api/conversations (auth = current Clerk seller user).
 */

import React, { useState, useCallback, useRef } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, ListRenderItemInfo } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useUser } from '@clerk/expo';
import { BG, CARD, BORDER, FG, MUTED, SUBTLE, ON_DARK, FONT, FS, SP, RADIUS, ICON, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { reportNetworkError } from '@/lib/networkNotice';

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
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  const s = React.useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const { user } = useUser();
  const myId = user?.id ?? '';

  const [convs, setConvs] = useState<ConvView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const consecutiveFailuresRef = useRef(0);
  const generationRef = useRef(0);
  const requestGenerationRef = useRef<number | null>(null);

  const load = useCallback(async (generation: number, silent = false) => {
    // Keep one request in flight per focus cycle so a slow request cannot
    // overlap a later poll and corrupt the consecutive-failure count.
    if (requestGenerationRef.current === generation) return;
    requestGenerationRef.current = generation;
    try {
      const list = await api.conversations.list();
      if (generationRef.current !== generation) return;
      // Sellers only handle buyer↔seller threads
      const relevant = (list as ConvView[]).filter(
        (c) => c.type !== 'buyer_to_buyer',
      );
      setConvs(relevant);
      setLoadError(false);
      consecutiveFailuresRef.current = 0;
    } catch (e) {
      if (generationRef.current !== generation) return;
      setLoadError(true);
      reportNetworkError(e, () => load(generation, true));
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
  }, [api]);

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
  }, [load]));

  async function onRefresh() {
    setIsRefreshing(true);
    consecutiveFailuresRef.current = 0;
    await load(generationRef.current, true);
    setIsRefreshing(false);
  }

  function otherParticipant(c: ConvView): Participant | null {
    return c.participants.find((p) => p.userId !== myId) ?? c.participants[0] ?? null;
  }

  function renderItem({ item }: ListRenderItemInfo<ConvView>) {
    const other = otherParticipant(item);
    if (!other) return null;
    const hasUnread = item.unreadCount > 0;
    return (
      <TouchableOpacity
        style={s.row}
        activeOpacity={0.7}
        onPress={() => router.push(('/seller-conversation?id=' + encodeURIComponent(item.id)) as never)}
      >
        <View style={[s.avatar, { backgroundColor: other.color || PURPLE }]}>
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
              style={[s.preview, hasUnread && { color: FG, fontFamily: FONT.medium }]}
              numberOfLines={1}
            >
              {previewText(item.lastMessage)}
            </Text>
            {hasUnread && (
              <View style={s.unreadBadge}>
                <Text style={s.unreadText}>{item.unreadCount > 9 ? '9+' : item.unreadCount}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top + SP.sm }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={s.headerBack}
        >
          <Feather name="arrow-left" size={ICON.lg} color={FG} />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>Messages</Text>
          {(() => {
            const totalUnread = convs.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
            return totalUnread > 0 ? (
              <Text style={s.headerSubtitle}>{totalUnread} unread</Text>
            ) : null;
          })()}
        </View>
        <View style={{ width: ICON.lg }} />
      </View>

      {isLoading ? (
        <View style={s.centerFill}>
          <ActivityIndicator color={PURPLE} />
        </View>
      ) : loadError && convs.length === 0 ? (
        <View style={s.centerFill}>
          <Feather name="wifi-off" size={40} color={MUTED} />
          <Text style={s.emptyTitle}>Messages couldn't load</Text>
          <Text style={s.emptyBody}>Check your connection and try again.</Text>
          <TouchableOpacity
            style={s.retryButton}
            onPress={() => {
              consecutiveFailuresRef.current = 0;
              load(generationRef.current, true);
            }}
            activeOpacity={0.8}
          >
            <Feather name="refresh-cw" size={15} color={PURPLE} />
            <Text style={s.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : convs.length === 0 ? (
        <View style={s.centerFill}>
          <Feather name="message-circle" size={40} color={SUBTLE} />
          <Text style={s.emptyTitle}>No messages yet</Text>
          <Text style={s.emptyBody}>
            When buyers message you about products or orders, their conversations will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={convs}
          keyExtractor={(c) => c.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={PURPLE} />
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + SP.lg }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const createStyles = (theme: { accent: string; accentLight: string; accentDim: string; secondary: string; secondaryDim: string }) => {
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SP.md, paddingBottom: SP.sm,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  headerBack: { marginRight: SP.sm },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: {
    textAlign: 'center',
    fontSize: FS.md, fontFamily: FONT.semibold, color: FG,
  },
  headerSubtitle: {
    fontSize: FS.xs, fontFamily: FONT.medium, color: PURPLE, marginTop: 1,
  },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl },
  emptyTitle: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG, marginTop: SP.md },
  emptyBody: {
    fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED,
    textAlign: 'center', marginTop: SP.xs,
  },
   retryButton: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, marginTop: SP.md, paddingHorizontal: SP.md, paddingVertical: SP.sm, borderWidth: 1, borderColor: PURPLE, borderRadius: RADIUS.sm },
   retryText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: PURPLE },

  // Row — flat Instagram-style, no card chrome
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SP.md, paddingVertical: SP.sm + 2,
  },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center', marginRight: SP.sm,
  },
  avatarInitials: { fontSize: FS.sm, fontFamily: FONT.bold, color: ON_DARK },
  rowCenter: { flex: 1 },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  name: { flex: 1, fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  time: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginLeft: SP.sm },
  context: { fontSize: FS.xs, fontFamily: FONT.medium, color: PURPLE, marginTop: 1 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  preview: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  unreadBadge: {
    minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5,
    backgroundColor: PURPLE, alignItems: 'center', justifyContent: 'center', marginLeft: SP.sm,
  },
  unreadText: { fontSize: 11, fontFamily: FONT.bold, color: ON_DARK },
  });
};
