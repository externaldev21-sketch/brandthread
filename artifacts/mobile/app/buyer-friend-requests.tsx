import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, FlatList, TouchableOpacity,
  Alert, StyleSheet, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  BG, CARD, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE,
  RED, ON_DARK,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  getFriendSuggestions, sendFriendRequest, blockUser,
} from '@/services/socialService';
import type { FriendSuggestion } from '@/services/socialTypes';
import { useApi } from '@/lib/api';

type Tab = 'incoming' | 'sent' | 'suggested';

// ── Normalized row used for both incoming and sent ─────────────────────────────
type FollowRow = {
  userId: string;
  name: string;
  handle: string;
  initials: string;
  color: string;
  isFollowingBack?: boolean; // for incoming: have I followed back?
};

export default function BuyerFriendRequestsScreen() {
  const { theme } = useAppTheme();
  const PURPLE = theme.accent;
  const GRAD_PRIMARY = [theme.accent, theme.accentLight] as const;
  const s = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api    = useApi();

  const [tab,      setTab]      = useState<Tab>('incoming');
  const [incoming, setIncoming] = useState<FollowRow[]>([]);   // followers I haven't followed back
  const [sent,     setSent]     = useState<FollowRow[]>([]);   // people I follow who don't follow back
  const [suggestions, setSuggestions] = useState<FriendSuggestion[]>([]);
  const [sentSet,  setSentSet]  = useState<Set<string>>(new Set()); // local optimistic follows
  const [loading,  setLoading]  = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [followers, following, sugs] = await Promise.all([
        api.social.followers(),
        api.social.following(),
        getFriendSuggestions(),
      ]);

      // Incoming = people who follow me but I don't follow back
      setIncoming(
        followers
          .filter(f => !f.isFollowingBack)
          .map(f => ({
            userId:          f.userId,
            name:            f.name,
            handle:          f.handle,
            initials:        f.initials,
            color:           f.color,
            isFollowingBack: false,
          }))
      );

      // Sent = people I follow but who don't follow me back
      // Cross-reference: followersSet = set of user IDs who follow me
      const followersSet = new Set(followers.map(f => f.userId));
      setSent(
        following
          .filter(f => !followersSet.has(f.userId))
          .map(f => ({
            userId:   f.userId,
            name:     f.name,
            handle:   f.handle,
            initials: f.initials,
            color:    f.color,
          }))
      );

      setSuggestions(sugs);
    } catch {
      // Degrade to empty lists on error
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  // ── Follow back (accept incoming) ───────────────────────────────────────────
  const handleFollowBack = async (row: FollowRow) => {
    setActionId(row.userId);
    try {
      await api.social.follow(row.userId);
      setIncoming(prev => prev.filter(r => r.userId !== row.userId));
    } catch {
      Alert.alert('Error', 'Could not follow back.');
    } finally {
      setActionId(null);
    }
  };

  // ── Dismiss incoming (do nothing — they still follow me) ────────────────────
  const handleDismiss = (row: FollowRow) => {
    setIncoming(prev => prev.filter(r => r.userId !== row.userId));
  };

  // ── Cancel sent (unfollow) ───────────────────────────────────────────────────
  const handleCancel = async (row: FollowRow) => {
    setActionId(row.userId);
    try {
      await api.social.unfollow(row.userId);
      setSent(prev => prev.filter(r => r.userId !== row.userId));
    } catch {
      Alert.alert('Error', 'Could not unfollow.');
    } finally {
      setActionId(null);
    }
  };

  // ── Follow a suggestion ──────────────────────────────────────────────────────
  const handleFollowSuggestion = async (sug: FriendSuggestion) => {
    setSentSet(prev => new Set([...prev, sug.userId]));
    try {
      // Also try local service for demo suggestions
      await sendFriendRequest({ userId: sug.userId, name: sug.name, handle: sug.handle, initials: sug.initials, color: sug.color });
    } catch { /* local only */ }
  };

  // ── Navigate to profile ──────────────────────────────────────────────────────
  const goToProfile = (row: FollowRow) => {
    router.push({
      pathname: '/buyer-other-profile' as any,
      params: { userId: row.userId, name: row.name, handle: row.handle, initials: row.initials, color: row.color },
    });
  };

  // ── Tab bar ────────────────────────────────────────────────────────────────

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'incoming',  label: 'Incoming',  count: incoming.length  },
    { key: 'sent',      label: 'Sent',      count: sent.length      },
    { key: 'suggested', label: 'Suggested'                          },
  ];

  // ── Render incoming ──────────────────────────────────────────────────────

  function renderIncoming() {
    if (loading) return <ActivityIndicator style={{ marginTop: 40 }} color={PURPLE} />;
    if (incoming.length === 0) {
      return (
        <View style={s.emptyState}>
          <Feather name="inbox" size={32} color={MUTED} />
          <Text style={s.emptyTitle}>No new followers</Text>
          <Text style={s.emptyBody}>When someone follows you, they'll appear here.</Text>
        </View>
      );
    }
    return (
      <FlatList
        data={incoming}
        keyExtractor={r => r.userId}
        scrollEnabled={false}
        renderItem={({ item: row }) => (
          <TouchableOpacity
            activeOpacity={0.85}
            onLongPress={() =>
              Alert.alert(row.name, undefined, [
                { text: 'Block',  style: 'destructive', onPress: () => blockUser({ userId: row.userId, name: row.name, handle: row.handle, initials: row.initials, color: row.color }) },
                { text: 'Cancel', style: 'cancel' },
              ])
            }
            onPress={() => goToProfile(row)}
            style={s.row}
          >
            <View style={[s.avatar48, { backgroundColor: row.color }]}>
              <Text style={s.avatar48Text}>{row.initials}</Text>
            </View>
            <View style={s.rowCenter}>
              <Text style={s.rowName}>{row.name}</Text>
              <Text style={s.rowHandle}>{row.handle}</Text>
              <Text style={s.rowMutual}>Follows you</Text>
            </View>
            <View style={s.rowActions}>
              <TouchableOpacity style={s.declineBtn} onPress={() => handleDismiss(row)}>
                <Text style={s.declineBtnText}>Dismiss</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.85}
                disabled={actionId === row.userId}
                onPress={() => handleFollowBack(row)}
              >
                {actionId === row.userId
                  ? <View style={s.acceptBtn}><ActivityIndicator size="small" color="#fff" /></View>
                  : (
                    <LinearGradient colors={GRAD_PRIMARY} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.acceptBtn}>
                      <Text style={s.acceptBtnText}>Follow</Text>
                    </LinearGradient>
                  )
                }
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        )}
      />
    );
  }

  // ── Render sent ──────────────────────────────────────────────────────────

  function renderSent() {
    if (loading) return <ActivityIndicator style={{ marginTop: 40 }} color={PURPLE} />;
    if (sent.length === 0) {
      return (
        <View style={s.emptyState}>
          <Feather name="user-check" size={32} color={MUTED} />
          <Text style={s.emptyTitle}>All caught up</Text>
          <Text style={s.emptyBody}>Everyone you follow also follows you back.</Text>
        </View>
      );
    }
    return (
      <FlatList
        data={sent}
        keyExtractor={r => r.userId}
        scrollEnabled={false}
        renderItem={({ item: row }) => (
          <TouchableOpacity activeOpacity={0.85} onPress={() => goToProfile(row)} style={s.row}>
            <View style={[s.avatar48, { backgroundColor: row.color }]}>
              <Text style={s.avatar48Text}>{row.initials}</Text>
            </View>
            <View style={s.rowCenter}>
              <Text style={s.rowName}>{row.name}</Text>
              <Text style={s.rowHandle}>{row.handle}</Text>
              <Text style={s.rowMutual}>You follow them</Text>
            </View>
            <View style={s.rowActions}>
              <View style={s.requestedPill}>
                <Text style={s.requestedPillText}>Following</Text>
              </View>
              <TouchableOpacity
                style={s.cancelBtn}
                disabled={actionId === row.userId}
                onPress={() => handleCancel(row)}
              >
                {actionId === row.userId
                  ? <ActivityIndicator size="small" color={MUTED} />
                  : <Text style={s.cancelBtnText}>Unfollow</Text>
                }
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        )}
      />
    );
  }

  // ── Render suggested ───────────────────────────────────────────────────────

  function renderSuggested() {
    if (suggestions.length === 0) {
      return (
        <View style={s.emptyState}>
          <Feather name="users" size={32} color={MUTED} />
          <Text style={s.emptyTitle}>No suggestions yet</Text>
          <Text style={s.emptyBody}>Use Search to find buyers to follow.</Text>
        </View>
      );
    }
    return (
      <FlatList
        data={suggestions}
        keyExtractor={sug => sug.id}
        scrollEnabled={false}
        renderItem={({ item: sug }) => {
          const followed = sentSet.has(sug.userId);
          return (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => router.push({
                pathname: '/buyer-other-profile' as any,
                params: { userId: sug.userId, name: sug.name, handle: sug.handle, initials: sug.initials, color: sug.color },
              })}
              style={s.row}
            >
              <View style={[s.avatar48, { backgroundColor: sug.color }]}>
                <Text style={s.avatar48Text}>{sug.initials}</Text>
              </View>
              <View style={s.rowCenter}>
                <Text style={s.rowName}>{sug.name}</Text>
                <Text style={s.rowHandle}>{sug.handle}</Text>
                {sug.reason ? <Text style={s.rowMutual}>{sug.reason}</Text> : null}
              </View>
              <View style={s.rowActions}>
                {followed ? (
                  <View style={s.requestedPill}>
                    <Text style={s.requestedPillText}>Following</Text>
                  </View>
                ) : (
                  <TouchableOpacity activeOpacity={0.85} onPress={() => handleFollowSuggestion(sug)}>
                    <LinearGradient colors={GRAD_PRIMARY} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.followBtn}>
                      <Text style={s.acceptBtnText}>Follow</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          );
        }}
      />
    );
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[s.header, { paddingTop: SP.md }]}>
        <TouchableOpacity
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => router.back()}
        >
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Connections</Text>
        <TouchableOpacity
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => router.push('/(buyer)/search' as never)}
        >
          <Feather name="search" size={ICON.md} color={FG} />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={s.tabBar}>
        {tabs.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[s.tabItem, tab === t.key && s.tabItemActive]}
            onPress={() => setTab(t.key)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={[s.tabLabel, tab === t.key && s.tabLabelActive]}>
                {t.label}
              </Text>
              {t.count != null && t.count > 0 && (
                <View style={s.tabBadge}>
                  <Text style={s.tabBadgeText}>{t.count}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}>
        {tab === 'incoming'  && renderIncoming()}
        {tab === 'sent'      && renderSent()}
        {tab === 'suggested' && renderSuggested()}
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme: { accent: string }) => StyleSheet.create({
  container:       { flex: 1, backgroundColor: BG },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingBottom: SP.md, borderBottomWidth: 1, borderColor: BORDER },
  headerTitle:     { fontFamily: FONT.bold, fontSize: FS.lg, color: FG },
  tabBar:          { flexDirection: 'row', borderBottomWidth: 1, borderColor: BORDER },
  tabItem:         { flex: 1, alignItems: 'center', paddingVertical: SP.sm + 2, borderBottomWidth: 2, borderColor: 'transparent' },
  tabItemActive:   { borderColor: theme.accent },
  tabLabel:        { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED },
  tabLabelActive:  { color: theme.accent },
  tabBadge:        { backgroundColor: theme.accent, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  tabBadgeText:    { fontFamily: FONT.bold, fontSize: 10, color: ON_DARK },
  emptyState:      { alignItems: 'center', paddingVertical: SP.xl * 2, gap: SP.sm },
  emptyTitle:      { fontFamily: FONT.semibold, fontSize: FS.md, color: FG },
  emptyBody:       { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, textAlign: 'center', paddingHorizontal: SP.xl },
  row:             { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: SP.md, borderBottomWidth: 1, borderColor: BORDER },
  avatar48:        { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  avatar48Text:    { fontFamily: FONT.bold, fontSize: FS.base, color: ON_DARK },
  rowCenter:       { flex: 1, marginLeft: SP.sm, gap: 2 },
  rowName:         { fontFamily: FONT.semibold, fontSize: FS.base, color: FG },
  rowHandle:       { fontFamily: FONT.regular,  fontSize: FS.xs,   color: MUTED },
  rowMutual:       { fontFamily: FONT.regular,  fontSize: FS.xs,   color: SUBTLE },
  rowActions:      { flexDirection: 'row', alignItems: 'center', gap: SP.xs },
  acceptBtn:       { height: 32, paddingHorizontal: SP.md, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center', minWidth: 64 },
  acceptBtnText:   { fontFamily: FONT.semibold, fontSize: FS.sm, color: ON_DARK },
  declineBtn:      { height: 32, paddingHorizontal: SP.sm, borderRadius: RADIUS.pill, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  declineBtnText:  { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED },
  requestedPill:   { paddingHorizontal: SP.sm, paddingVertical: 4, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER_ACTIVE, borderRadius: RADIUS.pill },
  requestedPillText: { fontFamily: FONT.medium, fontSize: FS.xs, color: theme.accent },
  cancelBtn:       { height: 32, paddingHorizontal: SP.sm, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText:   { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED },
  followBtn:       { height: 32, paddingHorizontal: SP.md, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center', minWidth: 64 },
});
