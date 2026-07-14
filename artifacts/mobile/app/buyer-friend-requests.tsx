import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, FlatList, TouchableOpacity,
  Alert, StyleSheet,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  RED, SUCCESS,
  GRAD_PRIMARY,
  FONT, FS, SP, RADIUS, COMP, ICON,
} from '@/lib/theme';
import {
  MY_USER_ID,
  getFriendRequests, getFriendSuggestions,
  acceptFriendRequest, declineFriendRequest, cancelFriendRequest,
  sendFriendRequest, blockUser,
  subscribeSocial,
} from '@/services/socialService';
import type { FriendRequest, FriendSuggestion } from '@/services/socialTypes';

type Tab = 'incoming' | 'sent' | 'suggested';

export default function BuyerFriendRequestsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>('incoming');
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);
  const [sentRequests, setSentRequests] = useState<FriendRequest[]>([]);
  const [suggestions, setSuggestions] = useState<FriendSuggestion[]>([]);
  const [sentSet, setSentSet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const [reqs, sugs] = await Promise.all([
        getFriendRequests(),
        getFriendSuggestions(),
      ]);
      setIncomingRequests(reqs.filter(r => r.toId === MY_USER_ID && r.status === 'pending'));
      setSentRequests(reqs.filter(r => r.fromId === MY_USER_ID && r.status === 'pending'));
      setSuggestions(sugs);
    } finally {
      setLoading(false);
    }
  }

  useFocusEffect(useCallback(() => { loadData(); }, []));

  useEffect(() => {
    const unsub = subscribeSocial(() => { loadData(); });
    return unsub;
  }, []);

  async function handleAccept(reqId: string) {
    await acceptFriendRequest(reqId);
    await loadData();
  }

  async function handleDecline(reqId: string) {
    await declineFriendRequest(reqId);
    await loadData();
  }

  async function handleCancel(reqId: string) {
    await cancelFriendRequest(reqId);
    await loadData();
  }

  async function handleSendRequest(sug: FriendSuggestion) {
    await sendFriendRequest({
      userId: sug.userId,
      name: sug.name,
      handle: sug.handle,
      initials: sug.initials,
      color: sug.color,
    });
    setSentSet(prev => new Set([...prev, sug.userId]));
  }

  function handleLongPressIncoming(req: FriendRequest) {
    Alert.alert(req.fromName, undefined, [
      {
        text: 'Block',
        style: 'destructive',
        onPress: () =>
          blockUser({
            userId: req.fromId,
            name: req.fromName,
            handle: req.fromHandle,
            initials: req.fromInitials,
            color: req.fromColor,
          }),
      },
      {
        text: 'Report',
        onPress: () =>
          router.push(
            `/buyer-report?targetType=profile&targetId=${req.fromId}&targetLabel=${encodeURIComponent(req.fromName)}&targetUserId=${req.fromId}` as never,
          ),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  // ─── Tab bar ───────────────────────────────────────────────────────────────

  const tabs: { key: Tab; label: string }[] = [
    { key: 'incoming', label: 'Incoming' },
    { key: 'sent', label: 'Sent' },
    { key: 'suggested', label: 'Suggested' },
  ];

  // ─── Render incoming ──────────────────────────────────────────────────────

  function renderIncoming() {
    if (incomingRequests.length === 0) {
      return (
        <View style={s.emptyState}>
          <Feather name="inbox" size={32} color={MUTED} />
          <Text style={s.emptyTitle}>No friend requests</Text>
          <Text style={s.emptyBody}>Requests will appear here.</Text>
        </View>
      );
    }
    return (
      <FlatList
        data={incomingRequests}
        keyExtractor={r => r.id}
        scrollEnabled={false}
        renderItem={({ item: req }) => (
          <TouchableOpacity
            activeOpacity={0.85}
            onLongPress={() => handleLongPressIncoming(req)}
            style={s.row}
          >
            <View style={[s.avatar48, { backgroundColor: req.fromColor }]}>
              <Text style={s.avatar48Text}>{req.fromInitials}</Text>
            </View>
            <View style={s.rowCenter}>
              <Text style={s.rowName}>{req.fromName}</Text>
              <Text style={s.rowHandle}>{req.fromHandle}</Text>
              {req.mutualFriends > 0 && (
                <Text style={s.rowMutual}>{req.mutualFriends} mutual friend{req.mutualFriends !== 1 ? 's' : ''}</Text>
              )}
            </View>
            <View style={s.rowActions}>
              <TouchableOpacity
                style={s.declineBtn}
                onPress={() => handleDecline(req.id)}
              >
                <Text style={s.declineBtnText}>Decline</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => handleAccept(req.id)}
              >
                <LinearGradient
                  colors={GRAD_PRIMARY}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={s.acceptBtn}
                >
                  <Text style={s.acceptBtnText}>Accept</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        )}
      />
    );
  }

  // ─── Render sent ──────────────────────────────────────────────────────────

  function renderSent() {
    if (sentRequests.length === 0) {
      return (
        <View style={s.emptyState}>
          <Feather name="send" size={32} color={MUTED} />
          <Text style={s.emptyTitle}>No sent requests</Text>
          <Text style={s.emptyBody}>People you request will appear here.</Text>
        </View>
      );
    }
    return (
      <FlatList
        data={sentRequests}
        keyExtractor={r => r.id}
        scrollEnabled={false}
        renderItem={({ item: req }) => (
          <View style={s.row}>
            <View style={[s.avatar48, { backgroundColor: req.fromColor }]}>
              <Text style={s.avatar48Text}>{req.fromInitials}</Text>
            </View>
            <View style={s.rowCenter}>
              <Text style={s.rowName}>{req.fromName}</Text>
              <Text style={s.rowHandle}>{req.fromHandle}</Text>
            </View>
            <View style={s.rowActions}>
              <View style={s.requestedPill}>
                <Text style={s.requestedPillText}>Requested</Text>
              </View>
              <TouchableOpacity
                style={s.cancelBtn}
                onPress={() => handleCancel(req.id)}
              >
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />
    );
  }

  // ─── Render suggested ─────────────────────────────────────────────────────

  function renderSuggested() {
    if (suggestions.length === 0) {
      return (
        <View style={s.emptyState}>
          <Feather name="users" size={32} color={MUTED} />
          <Text style={s.emptyTitle}>No suggestions yet</Text>
          <Text style={s.emptyBody}>Check back later.</Text>
        </View>
      );
    }
    return (
      <FlatList
        data={suggestions}
        keyExtractor={sug => sug.id}
        scrollEnabled={false}
        renderItem={({ item: sug }) => {
          const sent = sentSet.has(sug.userId);
          return (
            <View style={s.row}>
              <View style={[s.avatar48, { backgroundColor: sug.color }]}>
                <Text style={s.avatar48Text}>{sug.initials}</Text>
              </View>
              <View style={s.rowCenter}>
                <Text style={s.rowName}>{sug.name}</Text>
                <Text style={s.rowHandle}>{sug.handle}</Text>
                {sug.reason ? (
                  <Text style={s.rowMutual}>{sug.reason}</Text>
                ) : null}
              </View>
              <View style={s.rowActions}>
                {sent ? (
                  <View style={s.requestedPill}>
                    <Text style={s.requestedPillText}>Requested</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => handleSendRequest(sug)}
                  >
                    <LinearGradient
                      colors={GRAD_PRIMARY}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={s.addFriendBtn}
                    >
                      <Text style={s.addFriendBtnText}>Add Friend</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        }}
      />
    );
  }

  // ─── Layout ───────────────────────────────────────────────────────────────

  return (
    <View style={[s.container, { backgroundColor: BG }]}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + SP.sm }]}>
        <TouchableOpacity
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => router.back()}
        >
          <Feather name="arrow-left" size={ICON.lg} color={FG} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Friends</Text>
        <TouchableOpacity
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => Alert.alert('Search coming soon')}
        >
          <Feather name="search" size={ICON.lg} color={MUTED} />
        </TouchableOpacity>
      </View>

      {/* Tab bar */}
      <View style={s.tabBar}>
        {tabs.map(t => {
          const active = tab === t.key;
          const showBadge = t.key === 'incoming' && incomingRequests.length > 0;
          return (
            <TouchableOpacity
              key={t.key}
              style={[s.tabPill, active ? s.tabPillActive : s.tabPillInactive]}
              activeOpacity={0.8}
              onPress={() => setTab(t.key)}
            >
              <Text style={[s.tabLabel, active ? s.tabLabelActive : s.tabLabelInactive]}>
                {t.label}
                {showBadge ? ` (${incomingRequests.length})` : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Content */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + SP.xl }}
        showsVerticalScrollIndicator={false}
      >
        {tab === 'incoming' && renderIncoming()}
        {tab === 'sent' && renderSent()}
        {tab === 'suggested' && renderSuggested()}
      </ScrollView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingBottom: SP.md,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: FONT.semibold,
    fontSize: FS.md,
    color: FG,
  },

  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: SP.md,
    gap: SP.sm,
    marginBottom: SP.sm,
  },
  tabPill: {
    flex: 1,
    height: 36,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP.sm,
  },
  tabPillActive: {
    backgroundColor: PURPLE_DIM,
    borderColor: BORDER_ACTIVE,
  },
  tabPillInactive: {
    backgroundColor: CARD,
    borderColor: BORDER,
  },
  tabLabel: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
  },
  tabLabelActive: { color: PURPLE },
  tabLabelInactive: { color: MUTED },

  emptyState: {
    alignItems: 'center',
    paddingVertical: SP.xxl,
    paddingHorizontal: SP.xl,
    gap: SP.sm,
  },
  emptyTitle: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    color: FG,
    marginTop: SP.xs,
  },
  emptyBody: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
    textAlign: 'center',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
  },
  avatar48: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar48Text: {
    fontFamily: FONT.bold,
    fontSize: FS.base,
    color: '#fff',
  },
  rowCenter: {
    flex: 1,
    marginLeft: SP.md,
  },
  rowName: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    color: FG,
  },
  rowHandle: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
    marginTop: 1,
  },
  rowMutual: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: SUBTLE,
    marginTop: 2,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    flexShrink: 0,
  },

  declineBtn: {
    height: 36,
    paddingHorizontal: SP.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineBtnText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: MUTED,
  },
  acceptBtn: {
    height: 36,
    paddingHorizontal: SP.md,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptBtnText: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    color: '#fff',
  },

  requestedPill: {
    height: 30,
    paddingHorizontal: SP.sm,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestedPillText: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: MUTED,
  },
  cancelBtn: {
    height: 36,
    paddingHorizontal: SP.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER_ACTIVE,
    backgroundColor: CARD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: RED,
  },
  addFriendBtn: {
    height: 36,
    paddingHorizontal: SP.md,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addFriendBtnText: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    color: '#fff',
  },
});
